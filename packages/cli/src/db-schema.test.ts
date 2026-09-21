import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SCHEMA_SQL_PATH } from "@storytree/library/store";

import {
  classifyStatement,
  renderSchemaApplied,
  renderSchemaPreview,
  runDbSchema,
  splitSqlStatements,
  summariseSchemaDdl,
  wantsWrite,
  WRITE_FLAG,
  type SchemaSource,
} from "./db-schema.js";

/**
 * Every shape the bundled DDL uses, in one file: both comment kinds, a semicolon inside a string
 * literal, a `DO $$ … $$` block carrying semicolons of its own, an additive ALTER and a destructive
 * one, and a statement the classifier has never been taught.
 */
const FIXTURE = [
  "-- a leading comment",
  "CREATE SCHEMA IF NOT EXISTS events;",
  "",
  "/* block comment */",
  "CREATE TABLE IF NOT EXISTS events.thing (",
  "  id   TEXT PRIMARY KEY,",
  "  note TEXT NOT NULL DEFAULT 'a;b'   -- a semicolon inside a string literal",
  ");",
  "",
  "CREATE INDEX IF NOT EXISTS thing_note_ix ON events.thing (note);",
  "CREATE UNIQUE INDEX IF NOT EXISTS thing_id_ix ON events.thing (id);",
  "",
  "ALTER TABLE events.thing ADD COLUMN IF NOT EXISTS extra TEXT;",
  "ALTER TABLE events.thing DROP COLUMN IF EXISTS extra;",
  "",
  "DO $$",
  "BEGIN",
  "  ALTER TABLE events.thing DROP CONSTRAINT IF EXISTS thing_check;",
  "END $$;",
  "",
  "DROP TABLE IF EXISTS events.gone;",
  "",
  "TRUNCATE events.thing;",
].join("\n");

const ADDITIVE_ONLY = "CREATE SCHEMA IF NOT EXISTS events;\nCREATE TABLE IF NOT EXISTS events.thing (id TEXT);\n";

// ── splitting ────────────────────────────────────────────────────────────────

test("split: every statement comes back whitespace-normalised, comment-free, and in file order", () => {
  assert.deepEqual(splitSqlStatements(FIXTURE), [
    "CREATE SCHEMA IF NOT EXISTS events",
    "CREATE TABLE IF NOT EXISTS events.thing ( id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT 'a;b' )",
    "CREATE INDEX IF NOT EXISTS thing_note_ix ON events.thing (note)",
    "CREATE UNIQUE INDEX IF NOT EXISTS thing_id_ix ON events.thing (id)",
    "ALTER TABLE events.thing ADD COLUMN IF NOT EXISTS extra TEXT",
    "ALTER TABLE events.thing DROP COLUMN IF EXISTS extra",
    "DO $$ BEGIN ALTER TABLE events.thing DROP CONSTRAINT IF EXISTS thing_check; END $$",
    "DROP TABLE IF EXISTS events.gone",
    "TRUNCATE events.thing",
  ]);
});

test("split: a trailing semicolon and trailing whitespace yield no empty statement", () => {
  assert.deepEqual(splitSqlStatements("CREATE SCHEMA a;   \n\n  "), ["CREATE SCHEMA a"]);
});

test("split: a statement with no trailing semicolon is still returned", () => {
  assert.deepEqual(splitSqlStatements("CREATE SCHEMA a"), ["CREATE SCHEMA a"]);
});

test("split: `$1` is a positional parameter, not a dollar-quote tag", () => {
  assert.deepEqual(splitSqlStatements("SELECT $1; SELECT 2"), ["SELECT $1", "SELECT 2"]);
});

test("split: a named dollar tag protects its semicolons, and only its OWN tag closes it", () => {
  assert.deepEqual(splitSqlStatements("DO $tag$ a; $$ b; $tag$; NEXT one"), ["DO $tag$ a; $$ b; $tag$", "NEXT one"]);
});

test("split: `''` inside a literal is an escaped quote, not the end of it", () => {
  assert.deepEqual(splitSqlStatements("INSERT VALUES ('a''b;c'); NEXT one"), ["INSERT VALUES ('a''b;c')", "NEXT one"]);
});

test("split: an unterminated literal consumes the rest — never resumes splitting inside a string", () => {
  assert.deepEqual(splitSqlStatements("SELECT 'open; still open"), ["SELECT 'open; still open"]);
});

test("split: an unterminated dollar block consumes the rest", () => {
  assert.deepEqual(splitSqlStatements("DO $$ a; b"), ["DO $$ a; b"]);
});

test("split: an unterminated block comment consumes the rest, leaving nothing to classify", () => {
  assert.deepEqual(splitSqlStatements("CREATE SCHEMA a; /* never closed"), ["CREATE SCHEMA a"]);
});

test("split: a mid-statement comment leaves a separator, so the words either side stay apart", () => {
  assert.deepEqual(splitSqlStatements("CREATE -- why\nSCHEMA a"), ["CREATE SCHEMA a"]);
});

// ── classifying ──────────────────────────────────────────────────────────────

test("classify: every shape the bundled DDL uses, with the object it names", () => {
  assert.deepEqual(summariseSchemaDdl(FIXTURE), [
    { kind: "CREATE SCHEMA", object: "events", posture: "additive" },
    { kind: "CREATE TABLE", object: "events.thing", posture: "additive" },
    { kind: "CREATE INDEX", object: "thing_note_ix", posture: "additive" },
    { kind: "CREATE UNIQUE INDEX", object: "thing_id_ix", posture: "additive" },
    { kind: "ALTER TABLE", object: "events.thing", posture: "additive" },
    { kind: "ALTER TABLE", object: "events.thing", posture: "destructive" },
    { kind: "DO block", object: null, posture: "opaque" },
    { kind: "DROP TABLE", object: "events.gone", posture: "destructive" },
    { kind: "TRUNCATE", object: null, posture: "opaque" },
  ]);
});

test("classify: an ALTER's posture is read from its BODY, not its identical opening words", () => {
  assert.equal(classifyStatement("ALTER TABLE ONLY events.x ADD COLUMN y TEXT").posture, "additive");
  assert.equal(classifyStatement("ALTER TABLE IF EXISTS events.x DROP CONSTRAINT c").posture, "destructive");
  assert.equal(classifyStatement("ALTER TABLE ONLY events.x ADD COLUMN y TEXT").object, "events.x");
  assert.equal(classifyStatement("ALTER TABLE IF EXISTS events.x DROP CONSTRAINT c").object, "events.x");
});

test("classify: DROP INDEX is destructive and names its index", () => {
  assert.deepEqual(classifyStatement("DROP INDEX IF EXISTS events.thing_ix"), {
    kind: "DROP INDEX",
    object: "events.thing_ix",
    posture: "destructive",
  });
});

test("classify: `IF NOT EXISTS` is skipped, so the object is the object and never the keyword", () => {
  assert.equal(classifyStatement("CREATE TABLE events.bare (id TEXT)").object, "events.bare");
  assert.equal(classifyStatement("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix ON t (c)").object, "ix");
  assert.equal(classifyStatement("CREATE UNIQUE INDEX CONCURRENTLY ux ON t (c)").kind, "CREATE UNIQUE INDEX");
});

test("classify: an object glued to its opening paren is still read whole", () => {
  assert.equal(classifyStatement("CREATE TABLE events.thing(id TEXT)").object, "events.thing");
});

test("classify: an unknown shape is OPAQUE labelled by its opening word — never guessed additive", () => {
  assert.deepEqual(classifyStatement("truncate events.thing"), {
    kind: "TRUNCATE",
    object: null,
    posture: "opaque",
  });
  assert.equal(classifyStatement("GRANT SELECT ON t TO r").posture, "opaque");
});

// ── the write posture ────────────────────────────────────────────────────────

test("posture: the bare form is a read, and the flag is what makes it a write", () => {
  assert.equal(wantsWrite([]), false);
  assert.equal(wantsWrite(["--", "schema"]), false);
  assert.equal(wantsWrite(["--", "schema", WRITE_FLAG]), true);
  assert.equal(wantsWrite(["schema", WRITE_FLAG]), true);
});

test("posture: a flag that merely LOOKS like the write posture is not it", () => {
  assert.equal(wantsWrite(["schema", "--writes"]), false);
  assert.equal(wantsWrite(["schema", "-write"]), false);
  assert.equal(wantsWrite(["schema", "write"]), false);
});

// ── the renders ──────────────────────────────────────────────────────────────

const FIXTURE_DDL = { path: "/ddl/schema.sql", statements: summariseSchemaDdl(FIXTURE) };

test("render: the preview names every statement kind and reads out what is not purely additive", () => {
  assert.equal(
    renderSchemaPreview(FIXTURE_DDL),
    [
      "db:schema — PREVIEW. Nothing was applied, and no database connection was opened.",
      "",
      "  ddl:        /ddl/schema.sql",
      "  statements: 9 top-level statements, in file order",
      "",
      "    ALTER TABLE             2",
      "    CREATE INDEX            1",
      "    CREATE SCHEMA           1",
      "    CREATE TABLE            1",
      "    CREATE UNIQUE INDEX     1",
      "    DO block                1",
      "    DROP TABLE              1",
      "    TRUNCATE                1",
      "",
      "  NOT PURELY ADDITIVE (4) — a DROP destroys what the object held, and an opaque",
      "  statement does not disclose its effect. Read these in the file before applying:",
      "    #6  destructive ALTER TABLE events.thing",
      "    #7  opaque      DO block",
      "    #8  destructive DROP TABLE events.gone",
      "    #9  opaque      TRUNCATE",
      "",
      "This DDL runs against the ONE shared Cloud SQL instance every session on this box uses, so",
      "applying it is a write whose blast radius is every other session. Nothing above has happened.",
      "",
      "To apply it:  pnpm db:schema --write",
    ].join("\n"),
  );
});

test("render: an all-additive DDL says so, rather than printing an empty warning block", () => {
  assert.equal(
    renderSchemaPreview({ path: "/ddl/schema.sql", statements: summariseSchemaDdl(ADDITIVE_ONLY) }),
    [
      "db:schema — PREVIEW. Nothing was applied, and no database connection was opened.",
      "",
      "  ddl:        /ddl/schema.sql",
      "  statements: 2 top-level statements, in file order",
      "",
      "    CREATE SCHEMA     1",
      "    CREATE TABLE      1",
      "",
      "  every statement is additive — nothing in this DDL drops an object or hides its effect behind",
      "  a procedural block.",
      "",
      "This DDL runs against the ONE shared Cloud SQL instance every session on this box uses, so",
      "applying it is a write whose blast radius is every other session. Nothing above has happened.",
      "",
      "To apply it:  pnpm db:schema --write",
    ].join("\n"),
  );
});

test("render: the applied form tallies what it applied, by posture", () => {
  assert.equal(
    renderSchemaApplied(FIXTURE_DDL),
    [
      "db:schema — APPLIED to the live store.",
      "",
      "  ddl:        /ddl/schema.sql",
      "  statements: 9 applied · 2 destructive · 2 opaque",
      "",
      "DDL only — this verb runs no data migration, and never has. What it applied is the file above,",
      "in file order, and nothing else.",
    ].join("\n"),
  );
});

// ── the action: no write without the posture ─────────────────────────────────

interface Run {
  readonly lines: string[];
  readonly applied: number;
  readonly ddlReads: number;
}

async function runWith(argv: readonly string[], sql: string = FIXTURE): Promise<Run> {
  const lines: string[] = [];
  const counts = { applied: 0, ddlReads: 0 };
  await runDbSchema({
    argv,
    readDdl: (): Promise<SchemaSource> => {
      counts.ddlReads += 1;
      return Promise.resolve({ path: "/ddl/schema.sql", sql });
    },
    applyDdl: (): Promise<void> => {
      counts.applied += 1;
      return Promise.resolve();
    },
    out: (line) => lines.push(line),
  });
  return { lines, applied: counts.applied, ddlReads: counts.ddlReads };
}

test("action: THE BARE FORM APPLIES NOTHING — the write effect is never even reached", async () => {
  const run = await runWith(["--", "schema"]);
  assert.equal(run.applied, 0);
  assert.equal(run.ddlReads, 1);
  assert.deepEqual(run.lines, [renderSchemaPreview(FIXTURE_DDL)]);
});

test("action: the authorised form applies the DDL exactly once, then says so", async () => {
  const run = await runWith(["--", "schema", WRITE_FLAG]);
  assert.equal(run.applied, 1);
  assert.equal(run.ddlReads, 1);
  assert.deepEqual(run.lines, [renderSchemaApplied(FIXTURE_DDL)]);
});

test("action: the preview is summarised from the DDL it was handed, not from a remembered shape", async () => {
  const run = await runWith(["--", "schema"], ADDITIVE_ONLY);
  assert.deepEqual(run.lines, [
    renderSchemaPreview({ path: "/ddl/schema.sql", statements: summariseSchemaDdl(ADDITIVE_ONLY) }),
  ]);
});

// ── the real bundled DDL ─────────────────────────────────────────────────────

test("the bundled DDL: its two DROP TABLEs and two DO blocks are surfaced, not summed away", async () => {
  const statements = summariseSchemaDdl(await readFile(SCHEMA_SQL_PATH, "utf8"));

  // A naive `split(";")` shreds a `DO $$ … END $$;` block into fragments and reports NO `DO block`
  // at all, so this count is the regression guard on the dollar-quote walk against the real file.
  assert.equal(statements.filter((statement) => statement.kind === "DO block").length, 2);

  assert.deepEqual(
    statements
      .filter((statement) => statement.posture === "destructive")
      .map((statement) => `${statement.kind} ${statement.object ?? ""}`),
    ["DROP TABLE events.session_event", "DROP TABLE events.session"],
  );

  // Every statement classified, and none of them introduced by the comment that precedes it: a
  // comment surviving into the statement text would make `kind` the comment's first word.
  for (const statement of statements) {
    assert.notEqual(statement.kind, "");
    assert.ok(!statement.kind.startsWith("--"), `comment leaked into a statement: ${statement.kind}`);
  }
});

test("the bundled DDL: the preview reports it as something other than purely additive", () => {
  const sql = "DROP TABLE IF EXISTS events.session;";
  assert.ok(renderSchemaPreview({ path: SCHEMA_SQL_PATH, statements: summariseSchemaDdl(sql) }).includes("NOT PURELY ADDITIVE (1)"));
});
