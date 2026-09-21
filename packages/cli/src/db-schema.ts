// `pnpm db:schema` — the write posture, and the preview that makes the bare form honest.
//
// WHY THE BARE FORM STOPPED APPLYING (`tool-signal-gaps-arc`, increment
// `db-schema-requires-explicit-write-posture`). `db:schema` reached `applySchema` immediately. Its
// noun-shaped name, its read-only sibling `db:probe`, and the absence of any pre-write signal let a
// session that meant to INSPECT the database surface mutate it instead — and the store it mutates is
// the ONE shared Cloud SQL instance every session on the box reads and writes, so the blast radius
// of the mistake is every other session, not the one that made it. The command only revealed its
// mutation after the mutation had happened, which is this arc's own class of defect.
//
// ★ AND THE DDL IS NOT MERELY ADDITIVE, WHICH IS WHY A PREVIEW IS WORTH BUILDING RATHER THAN A
// WARNING LINE. `db-cli.ts` used to describe this DDL as "SCHEMA ONLY — touches no row", and that is
// true of INSERT/UPDATE and false of the file: the bundled schema carries two top-level
// `DROP TABLE IF EXISTS` statements (ADR-0200 D7's retirement of the session-presence tables) and two
// `DO $$ … $$` procedural blocks that drop and re-add constraints. Dropping a table destroys its rows
// as surely as a DELETE does. A caller is owed that fact BEFORE the write, and no prose in a comment
// reaches the caller at the moment they type the command.
//
// ★★ THE PREVIEW OPENS NO CONNECTION, AND THAT IS STRUCTURAL RATHER THAN CAREFUL. The bare form
// reads one bundled file and renders; the pool, the secrets hydration and `applySchema` all sit
// behind `applyDdl`, a thunk {@link runDbSchema} calls only on the `--write` branch. So "no mutation
// without explicit write authority" is provable by a test that watches whether the thunk was called
// at all, rather than argued from reading the happy path.
//
// ★★★ AN UNRECOGNISED STATEMENT READS AS `opaque`, NEVER AS `additive`. The classifier knows the
// shapes this DDL actually uses; anything else is reported as a statement whose effect is not visible
// from its shape. A summariser that guessed "probably harmless" for what it could not parse would
// reproduce, one level down, exactly the reassuring-but-wrong signal this increment exists to remove.
//
// Pure and I/O-free: `db-cli.ts` supplies the file read, the pool and the printing. That split is
// what makes the decision testable at all — `db-cli.ts` runs `main()` at import, so nothing in it can
// be reached from a test.

/**
 * What a statement DOES to the schema, as far as its shape can be trusted to say.
 *
 * Three values rather than a boolean because "I can see this only adds" and "I cannot see what this
 * does" are different facts, and collapsing them is what would make the preview lie.
 */
export type StatementPosture =
  /** Adds an object that was missing, and removes nothing. */
  | "additive"
  /** Removes an object, or a column or constraint on one. Destroys whatever the object held. */
  | "destructive"
  /** A procedural block, or a shape this classifier does not know. Its effect is not visible here. */
  | "opaque";

/** One top-level statement the DDL would apply. */
export interface SchemaStatement {
  /** `CREATE TABLE`, `DROP TABLE`, `DO block` — the shape, and what the counts group by. */
  readonly kind: string;
  /** The object the statement names, or `null` for a shape that names none. */
  readonly object: string | null;
  readonly posture: StatementPosture;
}

/** The bundled DDL, summarised — the subject of both renders. */
export interface SchemaDdl {
  /** Where the DDL was read from, so a reader can go and look at it. */
  readonly path: string;
  /** Every top-level statement, in file order. */
  readonly statements: readonly SchemaStatement[];
}

/** The DDL as it was read off disk. */
export interface SchemaSource {
  readonly path: string;
  readonly sql: string;
}

/**
 * The flag that turns `db:schema` from a reading into a write.
 *
 * Spelled out rather than abbreviated, and matching the `storytree write-authority` precedent the
 * increment names: a posture a caller has to TYPE is one they cannot reach by habit.
 */
export const WRITE_FLAG = "--write";

/**
 * Did the caller ask for the write?
 *
 * Scans the WHOLE argv rather than a fixed position, because the root script reaches this through
 * `pnpm --filter @storytree/cli run db -- schema`, and what pnpm hands through around that `--` is
 * not a shape this should depend on. An explicit posture is explicit wherever it was typed.
 */
export function wantsWrite(argv: readonly string[]): boolean {
  return argv.includes(WRITE_FLAG);
}

// ---------------------------------------------------------------------------
// Splitting the DDL — the part that has to be right, or the summary is fiction
// ---------------------------------------------------------------------------

/**
 * Everything a top-level `;` cannot be inside, plus the `;` itself — one pass, in one pattern.
 *
 * ★ THIS IS THE WHOLE REASON THE SPLIT IS NOT `sql.split(";")`. The bundled DDL's two
 * `DO $$ … END $$;` blocks carry semicolons of their own, and a naive split shreds them into
 * fragments — inventing a dozen statements that are not there and reporting NO `DO block` at all,
 * which is exactly the "not purely additive" line a caller most needs. Comments and string literals
 * carry semicolons too.
 *
 * Read the alternatives in order:
 *   `--[^\n]*`                    a line comment, to end of line
 *   `/*[\s\S]*?(?:*​/|$)`          a block comment; an unterminated one runs to EOF
 *   `'[^']*'?`                    a string literal; an unterminated one runs to EOF
 *   `$tag$ … $tag$`               a dollar-quoted block, closed only by its OWN tag
 *   `;`                           a top-level statement boundary
 *
 * ⚠ `''` IS NOT TREATED AS AN ESCAPE, and that is deliberate rather than an oversight. Postgres reads
 * `'a''b'` as one literal; this reads it as two adjacent ones — and the REGIONS are identical either
 * way, because the second literal opens exactly where the first closed. No input can distinguish the
 * two through this function's output, so the escape branch this used to carry did no work.
 *
 * ⚠ A positional parameter (`$1`) is not a tag: the tag must be empty (`$$`) or start with a letter
 * or underscore.
 */
const SQL_TOKEN =
  /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'[^']*'?|\$(?<tag>[A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?(?:\$\k<tag>\$|$)|;/g;

/** One line per statement, single-spaced — the form every classifier regex below is written against. */
function normaliseWhitespace(statement: string): string {
  return statement.replace(/\s+/g, " ").trim();
}

/** A comment is replaced by a separator; everything else a token matched is kept verbatim. */
function isComment(token: string): boolean {
  return token.startsWith("--") || token.startsWith("/*");
}

/**
 * Split SQL into its top-level statements, dropping comments and never splitting inside a string or
 * a dollar-quoted block.
 *
 * Comments are dropped rather than carried: the classifier reads a statement's leading words, and a
 * leading `-- …` comment (which is how nearly every statement in the bundled DDL is introduced) would
 * otherwise BE the leading words. They leave a space behind, so the words either side of a
 * mid-statement comment do not run together.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let cursor = 0;

  for (const match of sql.matchAll(SQL_TOKEN)) {
    const token = match[0];
    current += sql.slice(cursor, match.index);
    cursor = match.index + token.length;

    if (token === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += isComment(token) ? " " : token;
  }
  statements.push(current + sql.slice(cursor));

  return statements.map(normaliseWhitespace).filter((statement) => statement.length > 0);
}

// ---------------------------------------------------------------------------
// Classifying one statement
// ---------------------------------------------------------------------------

interface StatementShape {
  readonly re: RegExp;
  readonly kind: string;
  readonly posture: StatementPosture;
}

/**
 * The shapes the bundled DDL actually uses, matched against the whitespace-normalised statement.
 *
 * First match wins. Anything not here falls through to `opaque`, which is the point: this table is a
 * record of what has been LOOKED AT, not a claim about SQL in general.
 */
const STATEMENT_SHAPES: readonly StatementShape[] = [
  { re: /^CREATE SCHEMA (?:IF NOT EXISTS )?([^\s(]+)/i, kind: "CREATE SCHEMA", posture: "additive" },
  { re: /^CREATE TABLE (?:IF NOT EXISTS )?([^\s(]+)/i, kind: "CREATE TABLE", posture: "additive" },
  {
    re: /^CREATE UNIQUE INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?([^\s(]+)/i,
    kind: "CREATE UNIQUE INDEX",
    posture: "additive",
  },
  { re: /^CREATE INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?([^\s(]+)/i, kind: "CREATE INDEX", posture: "additive" },
  { re: /^DROP TABLE (?:IF EXISTS )?([^\s(]+)/i, kind: "DROP TABLE", posture: "destructive" },
  { re: /^DROP INDEX (?:IF EXISTS )?([^\s(]+)/i, kind: "DROP INDEX", posture: "destructive" },
];

/** `ALTER TABLE [IF EXISTS] [ONLY] <name>` — handled apart, because its posture is in its BODY. */
const ALTER_TABLE = /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([^\s(]+)/i;

/** An `ALTER` carrying a `DROP` removes something, whatever else it also adds. */
const DROPS_SOMETHING = /\bDROP\b/i;

/** `DO $$ … $$` — a procedural block whose effect its first word does not disclose. */
const DO_BLOCK = /^DO\b/i;

/**
 * The statement's opening word, upper-cased — the only honest label for a shape not in the table.
 *
 * Written against the whole string rather than `split(" ")[0]`, which under
 * `noUncheckedIndexedAccess` needs a `?? ""` fallback no input can reach: every statement classified
 * here came through {@link splitSqlStatements}' own non-empty filter.
 */
function leadingWord(statement: string): string {
  const end = statement.indexOf(" ");
  return (end === -1 ? statement : statement.slice(0, end)).toUpperCase();
}

/**
 * What one normalised statement is, and what it does.
 *
 * `ALTER TABLE` is tried first because it is the one shape whose posture cannot be read off its
 * leading words: `ALTER TABLE x ADD COLUMN IF NOT EXISTS y` and `ALTER TABLE x DROP COLUMN y` open
 * identically and do opposite things.
 */
export function classifyStatement(statement: string): SchemaStatement {
  const alter = ALTER_TABLE.exec(statement);
  if (alter !== null) {
    return {
      kind: "ALTER TABLE",
      object: alter[1] ?? null,
      posture: DROPS_SOMETHING.test(statement) ? "destructive" : "additive",
    };
  }

  for (const shape of STATEMENT_SHAPES) {
    const match = shape.re.exec(statement);
    if (match !== null) return { kind: shape.kind, object: match[1] ?? null, posture: shape.posture };
  }

  if (DO_BLOCK.test(statement)) return { kind: "DO block", object: null, posture: "opaque" };
  return { kind: leadingWord(statement), object: null, posture: "opaque" };
}

/** Every top-level statement in the DDL, in file order, classified. */
export function summariseSchemaDdl(sql: string): readonly SchemaStatement[] {
  return splitSqlStatements(sql).map(classifyStatement);
}

// ---------------------------------------------------------------------------
// The two renders
// ---------------------------------------------------------------------------

/** `CREATE TABLE events.library_event`, or just `DO block` where the shape names nothing. */
function statementLabel(statement: SchemaStatement): string {
  return statement.object === null ? statement.kind : `${statement.kind} ${statement.object}`;
}

/** Counts per kind, commonest first and alphabetical within a tie, so the block is deterministic. */
function kindCountLines(statements: readonly SchemaStatement[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const statement of statements) counts.set(statement.kind, (counts.get(statement.kind) ?? 0) + 1);

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const width = Math.max(0, ...rows.map(([kind]) => kind.length));
  return rows.map(([kind, count]) => `    ${kind.padEnd(width)}  ${String(count).padStart(4)}`);
}

/** Statements that are not provably additive, each with its position in the file. */
function notAdditiveLines(statements: readonly SchemaStatement[]): readonly string[] {
  const flagged = statements
    .map((statement, index) => ({ statement, ordinal: index + 1 }))
    .filter(({ statement }) => statement.posture !== "additive");

  if (flagged.length === 0) {
    return [
      "  every statement is additive — nothing in this DDL drops an object or hides its effect behind",
      "  a procedural block.",
    ];
  }

  return [
    `  NOT PURELY ADDITIVE (${flagged.length}) — a DROP destroys what the object held, and an opaque`,
    "  statement does not disclose its effect. Read these in the file before applying:",
    ...flagged.map(({ statement, ordinal }) => `    #${ordinal}  ${statement.posture.padEnd(11)} ${statementLabel(statement)}`),
  ];
}

/** How many statements carry each non-additive posture — the one line the applied render owes. */
function postureTally(statements: readonly SchemaStatement[]): string {
  const destructive = statements.filter((statement) => statement.posture === "destructive").length;
  const opaque = statements.filter((statement) => statement.posture === "opaque").length;
  return `${statements.length} applied · ${destructive} destructive · ${opaque} opaque`;
}

/**
 * The bare form's whole output: what WOULD be applied, and how to actually apply it.
 *
 * It is a reading, so it exits 0 and refuses nothing — the posture flag is the gate, not this render.
 */
export function renderSchemaPreview(ddl: SchemaDdl): string {
  return [
    "db:schema — PREVIEW. Nothing was applied, and no database connection was opened.",
    "",
    `  ddl:        ${ddl.path}`,
    `  statements: ${ddl.statements.length} top-level statements, in file order`,
    "",
    ...kindCountLines(ddl.statements),
    "",
    ...notAdditiveLines(ddl.statements),
    "",
    "This DDL runs against the ONE shared Cloud SQL instance every session on this box uses, so",
    "applying it is a write whose blast radius is every other session. Nothing above has happened.",
    "",
    `To apply it:  pnpm db:schema ${WRITE_FLAG}`,
  ].join("\n");
}

/** What the authorised form says once the DDL is on the instance. */
export function renderSchemaApplied(ddl: SchemaDdl): string {
  return [
    "db:schema — APPLIED to the live store.",
    "",
    `  ddl:        ${ddl.path}`,
    `  statements: ${postureTally(ddl.statements)}`,
    "",
    "DDL only — this verb runs no data migration, and never has. What it applied is the file above,",
    "in file order, and nothing else.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export interface SchemaRunDeps {
  /** The process argv as `db-cli.ts` received it, `--` and all. */
  readonly argv: readonly string[];
  /** Read the bundled DDL. Never opens a connection. */
  readonly readDdl: () => Promise<SchemaSource>;
  /**
   * Hydrate secrets, open the pool, apply the DDL, close the pool.
   *
   * The WHOLE write effect behind one thunk, so the preview branch can be proven never to reach a
   * pool by watching whether this was called — rather than by reading the code and believing it.
   * It re-reads the same bundled file `readDdl` did, which is `applySchema`'s own contract.
   */
  readonly applyDdl: () => Promise<void>;
  readonly out: (line: string) => void;
}

/**
 * `db:schema`, both postures.
 *
 * The DDL is summarised on BOTH branches and from the same file, so the applied render reports the
 * statements that were actually applied rather than a count derived some other way.
 */
export async function runDbSchema(deps: SchemaRunDeps): Promise<void> {
  const source = await deps.readDdl();
  const ddl: SchemaDdl = { path: source.path, statements: summariseSchemaDdl(source.sql) };

  if (!wantsWrite(deps.argv)) {
    deps.out(renderSchemaPreview(ddl));
    return;
  }

  await deps.applyDdl();
  deps.out(renderSchemaApplied(ddl));
}
