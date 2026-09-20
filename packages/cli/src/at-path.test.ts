import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";

import {
  expandAtPathFlags,
  formatAtPathRefusal,
  LITERAL_FLAGS,
  PROSE_FLAGS,
} from "./at-path.js";
import { CLI_OPTIONS, run } from "./commands.js";

/**
 * The `@path` boundary (cli-write-fidelity-arc): long prose is expanded from its file ONCE, where
 * flags are parsed, so no write verb can store the literal `@C:/…/scratch.txt` as its durable
 * record by forgetting to call a helper — the measured defect on `library artifact retire --reason`
 * and `library graduate park --reason`.
 *
 * The load-bearing test in this file is the EXHAUSTIVENESS guard: it is what turns "the convention
 * held for the three verbs that remembered it" into "a new flag cannot skip the decision".
 */

/** Every string-typed flag the CLI declares — the population the classification must cover. */
function declaredStringFlags(): string[] {
  return Object.entries(CLI_OPTIONS)
    .filter(([, spec]) => (spec as { type: string }).type === "string")
    .map(([name]) => name)
    .sort();
}

// ---------------------------------------------------------------------------
// The class fence: the classification is exhaustive and disjoint
// ---------------------------------------------------------------------------

test("EVERY declared string flag is classified prose or literal — a new flag cannot skip the decision", () => {
  const unclassified = declaredStringFlags().filter(
    (f) => !PROSE_FLAGS.has(f) && !LITERAL_FLAGS.has(f),
  );
  assert.deepEqual(
    unclassified,
    [],
    "Add each of these to PROSE_FLAGS (a durable prose record, @path-expandable) or to " +
      "LITERAL_FLAGS (an id/path/enum/ref, taken verbatim) in at-path.ts. LITERAL is the safe " +
      "default — it preserves today's behaviour exactly. Leaving a flag out is how the @path hole " +
      "re-opened three times.",
  );
});

test("`traversal origin`'s three flags are LITERAL — an enum word and two canonical ids, never prose", () => {
  // ADR-0484 D7. Each is named rather than left to the generic sweep above, because the sweep only
  // asks that a flag be classified SOMEHOW — it would stay green if all three drifted into PROSE,
  // which would make `--cut-by @notes.md` read a file where a session id belongs.
  for (const flag of ["origin", "cut-by", "cut-for"]) {
    assert.equal(LITERAL_FLAGS.has(flag), true, `${flag} must be literal`);
    assert.equal(PROSE_FLAGS.has(flag), false, `${flag} is an identity or an enum, never a record`);
  }
});

test("`node build --revise-test` is LITERAL — a run id naming a revision record, never prose", () => {
  // ADR-0571 D3. Named rather than left to the generic sweep above, because the sweep only asks that
  // a flag be classified SOMEHOW: were `--revise-test` to drift into PROSE, `--revise-test @notes.md`
  // would read a file where a run id belongs — the hand-relayed escalation the flag exists to remove.
  assert.equal(LITERAL_FLAGS.has("revise-test"), true, "revise-test must be literal");
  assert.equal(PROSE_FLAGS.has("revise-test"), false, "a run id is an identity, never a record");
});

test("`node build --increment` is LITERAL — an increment id naming the work an attempt is filed under, never prose", () => {
  // ADR-0575 D1. Named rather than left to the generic sweep above, because the sweep only asks that
  // a flag be classified SOMEHOW: were `--increment` to drift into PROSE, `--increment @notes.md`
  // would read a file where an increment id belongs.
  assert.equal(LITERAL_FLAGS.has("increment"), true, "increment must be literal");
  assert.equal(PROSE_FLAGS.has("increment"), false, "an increment id is an identity, never a record");
});

test("`resteer new`'s six flags are classified on the right side of the prose/literal line", () => {
  // ADR-0515. Named rather than left to the generic exhaustiveness sweep above, because that sweep
  // only asks that a flag be classified SOMEHOW — it stays green if a PROSE flag drifts into LITERAL,
  // which is precisely the mistake made here first: `--doing`/`--redirect`/`--self-report` were
  // added to LITERAL_FLAGS, where `--doing @notes.md` would have stored the literal path string
  // instead of the file. That is the `graduate-park-reason-ignores-at-path` defect, one tier over.
  for (const flag of ["doing", "redirect", "self-report"]) {
    assert.equal(PROSE_FLAGS.has(flag), true, `${flag} is a durable prose record and must be @path-expandable`);
    assert.equal(LITERAL_FLAGS.has(flag), false, `${flag} must not be literal`);
  }
  // The other three are closed enum words the schema fences, so a leading `@` could only be a typo.
  for (const flag of ["disposition", "by", "mode"]) {
    assert.equal(LITERAL_FLAGS.has(flag), true, `${flag} is an enum word, taken verbatim`);
    assert.equal(PROSE_FLAGS.has(flag), false, `${flag} must never read a file`);
  }
});

test("no flag is classified BOTH prose and literal", () => {
  const both = [...PROSE_FLAGS].filter((f) => LITERAL_FLAGS.has(f));
  assert.deepEqual(both, [], "a flag is expanded or it is not — never both");
});

test("the classification names no flag the CLI does not declare (no stale entries)", () => {
  const declared = new Set(declaredStringFlags());
  const phantom = [...PROSE_FLAGS, ...LITERAL_FLAGS].filter((f) => !declared.has(f)).sort();
  assert.deepEqual(phantom, [], "these are classified but no longer declared in CLI_OPTIONS");
});

test("no BOOLEAN flag is classified — expansion is a string-value concern only", () => {
  const booleans = Object.entries(CLI_OPTIONS)
    .filter(([, spec]) => (spec as { type: string }).type === "boolean")
    .map(([name]) => name);
  const misfiled = booleans.filter((f) => PROSE_FLAGS.has(f) || LITERAL_FLAGS.has(f));
  assert.deepEqual(misfiled, []);
});

test("the flags whose LITERAL storage was the measured defect are classified PROSE", () => {
  // `library artifact retire --reason` / `library graduate park --reason` stored the @path string
  // itself; four park records held nothing but a path into a scratchpad the reaper takes.
  for (const flag of ["reason", "evidence", "intent", "outcome", "note", "end-state"]) {
    assert.ok(PROSE_FLAGS.has(flag), `--${flag} must expand @path`);
  }
});

// ---------------------------------------------------------------------------
// expandAtPathFlags
// ---------------------------------------------------------------------------

/** A reader over a fixed path→contents map; anything else throws the way `readFile` would. */
function fakeReader(files: Record<string, string>) {
  const read: string[] = [];
  return {
    read,
    async readTextFile(p: string): Promise<string> {
      read.push(p);
      const hit = files[p];
      if (hit === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      }
      return hit;
    },
  };
}

test("a prose flag with @path is replaced by the file's contents, newlines intact", async () => {
  const reader = fakeReader({ "/tmp/why.txt": "line one\n\nline two — with an em dash\n" });
  const out = await expandAtPathFlags({ reason: "@/tmp/why.txt" }, reader.readTextFile);
  assert.equal(out.ok, true);
  assert.ok(out.ok);
  assert.equal(out.values.reason, "line one\n\nline two — with an em dash\n");
  assert.deepEqual(reader.read, ["/tmp/why.txt"]);
});

test("a prose flag WITHOUT a leading @ is passed through untouched, and no file is read", async () => {
  const reader = fakeReader({});
  const out = await expandAtPathFlags({ reason: "inline prose" }, reader.readTextFile);
  assert.ok(out.ok);
  assert.equal(out.values.reason, "inline prose");
  assert.deepEqual(reader.read, [], "a plain value must never touch the filesystem");
});

test("a LITERAL flag starting with @ is the caller's own bytes — never a file read", async () => {
  const reader = fakeReader({ "/tmp/x": "should not be read" });
  const out = await expandAtPathFlags(
    { title: "@storytree/cli", node: ["@weird-unit-id"], file: "@/tmp/x" },
    reader.readTextFile,
  );
  assert.ok(out.ok);
  assert.equal(out.values.title, "@storytree/cli");
  assert.deepEqual(out.values.node, ["@weird-unit-id"]);
  assert.equal(out.values.file, "@/tmp/x");
  assert.deepEqual(reader.read, []);
});

test("a REPEATABLE prose flag expands element-wise, mixing @path and inline values", async () => {
  const reader = fakeReader({ "/tmp/a.txt": "from a file" });
  const out = await expandAtPathFlags(
    { change: ["inline one", "@/tmp/a.txt", "inline two"] },
    reader.readTextFile,
  );
  assert.ok(out.ok);
  assert.deepEqual(out.values.change, ["inline one", "from a file", "inline two"]);
});

test("an UNRESOLVABLE @path REFUSES — the literal string is never returned as the value", async () => {
  const reader = fakeReader({});
  const out = await expandAtPathFlags({ reason: "@/tmp/gone.txt" }, reader.readTextFile);
  assert.equal(out.ok, false);
  assert.ok(!out.ok);
  assert.equal(out.refusal.flag, "reason");
  assert.equal(out.refusal.path, "/tmp/gone.txt");
  assert.match(out.refusal.message, /ENOENT/);
});

test("the refusal body names the flag, the path, and why the literal is not stored instead", () => {
  const body = formatAtPathRefusal({
    flag: "reason",
    path: "/tmp/gone.txt",
    message: "ENOENT: no such file or directory, open '/tmp/gone.txt'",
  });
  assert.match(body, /--reason "@\/tmp\/gone\.txt" could not be read/);
  assert.match(body, /ENOENT/);
  assert.match(body, /store a path where the prose belongs/);
});

test("unset flags and non-string values are left exactly as they were", async () => {
  const reader = fakeReader({});
  const input = { pg: true, help: false, node: ["a"], reason: undefined };
  const out = await expandAtPathFlags(input, reader.readTextFile);
  assert.ok(out.ok);
  assert.deepEqual(out.values, input);
  assert.deepEqual(reader.read, []);
});

// ---------------------------------------------------------------------------
// The boundary is WIRED — proven through `run`, not just the module
// ---------------------------------------------------------------------------

test("run(): an unreadable @path on a prose flag refuses the command before any verb runs", async () => {
  const env = await run(
    ["arc", "new", "some-arc", "--title", "T", "--intent", "@/definitely/not/here.txt", "--end-state", "x"],
    { store: new InMemoryStore() },
  );
  assert.equal(env.ok, false, env.body);
  assert.match(env.body, /--intent "@\/definitely\/not\/here\.txt" could not be read/);
  assert.match(env.body, /ENOENT|no such file/i);
});

test("run(): the refusal fires for a flag whose verb NEVER expanded @path itself — the defect", async () => {
  // `library artifact retire --reason` stored the literal `@path` string as the durable record.
  // It calls no resolver of its own and never will again: the boundary refuses first.
  const env = await run(
    ["library", "artifact", "retire", "some-id", "--reason", "@/definitely/not/here.txt"],
    { store: new InMemoryStore() },
  );
  assert.equal(env.ok, false, env.body);
  assert.match(env.body, /--reason "@\/definitely\/not\/here\.txt" could not be read/);
});

test("`arc gate`'s two flags split across the prose/literal line — --needs literal, --reason prose", () => {
  // ADR-0523 D5. Named rather than left to the generic exhaustiveness sweep above, because that
  // sweep only asks that a flag be classified SOMEHOW — it stays green if `--needs` drifts into
  // PROSE, where `--needs @notes.md` would read a file where an ARC ID belongs and then gate the arc
  // behind whatever that file's first line happened to say.
  assert.equal(LITERAL_FLAGS.has("needs"), true, "--needs names an arc, taken verbatim");
  assert.equal(PROSE_FLAGS.has("needs"), false, "--needs is an identity, never a durable record");
  // Its sibling on the same command goes the other way, and the pair splitting is correct.
  assert.equal(PROSE_FLAGS.has("reason"), true, "--reason is the durable why, and must be @path-expandable");
  assert.equal(LITERAL_FLAGS.has("reason"), false, "--reason must not be taken verbatim");
});

test("`node build --time-budget` is LITERAL — a number of minutes, never prose", () => {
  // ADR-0581 D2. Named rather than left to the generic sweep above, because the sweep only asks that
  // a flag be classified SOMEHOW: were `--time-budget` to drift into PROSE, `--time-budget @notes.md`
  // would hand `Number(...)` a file path, which is NaN — and a NaN budget is refused, so the operator
  // would meet a "not a number" refusal for a file they never meant to read.
  assert.equal(LITERAL_FLAGS.has("time-budget"), true, "time-budget must be literal");
  assert.equal(PROSE_FLAGS.has("time-budget"), false, "a count of minutes is a figure, never a record");
});
