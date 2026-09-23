/**
 * Proof for the `.gcloudignore` mirror judge (ADR-0544 D5,
 * `prove-unproven-capabilities-arc-inc-30`) — the mechanical half of `container-image`'s
 * `no-secrets-in-image` contract: *"every 'Env / secrets' entry in .gitignore is mirrored in
 * .gcloudignore, which is the only filter standing between a working tree and the Dockerfile's
 * `COPY . .`"*.
 *
 * ⚠⚠ THE HARDEST THING TO GET RIGHT HERE IS NOT THE COMPARISON, IT IS THE SUBJECT SET. A mirror
 * check whose subject list can quietly become empty reports a perfect mirror forever — it is the
 * repo's commonest fault class wearing a security control's name. So the refusals below are the
 * load-bearing tests, not the happy path: rename the block, empty it, or move the runtime-data
 * lines, and this judge THROWS rather than passing.
 *
 * Offline, pure, no filesystem — the shell (`check-gcloudignore-mirror.ts`) does the two reads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENV_SECRETS_HEADER,
  formatMirrorVerdict,
  ignorePatterns,
  judgeGcloudignoreMirror,
  requiredMirror,
} from "./gcloudignore-mirror.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/**
 * ⚠ EVERY ODDITY IN THIS FIXTURE IS LOAD-BEARING, and each was added because a mutant survived
 * without it. The indented lines pin the `.trim()` calls; the comment INSIDE the block pins the
 * `isPattern` guard (without it a lenient reader takes `# a note` as a credential pattern); and the
 * two near-misses at the bottom pin the `^` and `$` anchors of the runtime-data pattern — a rule
 * anchored at neither end would sweep in `xapps/...` and `....jsonc`, which is over-detection in a
 * fence whose whole value is knowing exactly what it compares.
 */
const GITIGNORE = [
  "node_modules/",
  "",
  "# Env / secrets",
  "  .env  ",
  "# a note inside the block",
  ".env.*",
  "!.env.example",
  "",
  "# Logs",
  "*.log",
  "",
  "# member data",
  "  apps/studio/data/users.json",
  "apps/studio/data/attestations.json  ",
  "xapps/studio/data/notmine.json",
  "apps/studio/data/notmine.jsonc",
  "apps/studio/data/nested/deep.json",
].join("\n");

const MIRRORED = [
  "# heavy",
  ".git",
  "node_modules/",
  ".env",
  ".env.*",
  "!.env.example",
  "apps/studio/data/users.json",
  "apps/studio/data/attestations.json",
].join("\n");

test("the subject set is the Env/secrets BLOCK plus every apps/studio/data/*.json line, wherever it sits — trimmed, comment-free, and anchored at both ends", () => {
  const subjects = requiredMirror(GITIGNORE);
  assert.deepEqual(
    subjects.map((s) => s.pattern),
    [".env", ".env.*", "!.env.example", "apps/studio/data/users.json", "apps/studio/data/attestations.json"],
  );
  // ⚠ A COMMENT INSIDE THE BLOCK IS NOT A SUBJECT. `.gitignore`'s credential block carries prose;
  // taking it as a pattern would put a line into the mirror that can never be satisfied.
  assert.ok(!subjects.some((x) => x.pattern.startsWith("#")));
  // ⚠ AND THE RUNTIME-DATA RULE IS ANCHORED AT BOTH ENDS. `xapps/...` is a different directory and
  // `.jsonc` is a different file type; a rule loose at either end asks `.gcloudignore` to repeat
  // lines that are not the app's runtime state, and a fence that over-detects gets edited until it
  // under-detects. `nested/deep.json` is out for the same reason — the rule names ONE directory.
  for (const near of ["xapps/studio/data/notmine.json", "apps/studio/data/notmine.jsonc", "apps/studio/data/nested/deep.json"]) {
    assert.ok(!subjects.some((x) => x.pattern === near), `${near} must not be a subject`);
  }
  // ⚠ THE NEGATION IS A SUBJECT TOO. `!.env.example` un-ignores a file; dropping it from the mirror
  // would leave `.gcloudignore` excluding the example the README tells you to copy, which is a
  // DIFFERENT bug from a leak and would be invisible to a check that only looked for ignores.
  assert.ok(subjects.some((s) => s.pattern === "!.env.example"));
  // The block stops at the blank line — `# Logs` and `*.log` are not credential material.
  assert.ok(!subjects.some((s) => s.pattern === "*.log"));
  assert.ok(!subjects.some((s) => s.pattern === "node_modules/"));
  // Each subject says which rule put it there, so a failure names its own basis.
  assert.deepEqual(
    subjects.map((s) => s.reason),
    ["env-secrets-block", "env-secrets-block", "env-secrets-block", "studio-runtime-data", "studio-runtime-data"],
  );
});

test("a mirrored file passes; a missing line is reported with its rule, and comments/order/blank lines never matter", () => {
  const ok = judgeGcloudignoreMirror(GITIGNORE, MIRRORED);
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.subjects.length, 5);

  const gap = judgeGcloudignoreMirror(GITIGNORE, MIRRORED.replace("\n.env.*", ""));
  assert.deepEqual(
    gap.missing.map((m) => m.pattern),
    [".env.*"],
  );
  assert.equal(gap.missing[0]?.reason, "env-secrets-block");

  // ⚠ NON-VACUITY ON THE MATCHER: a line that merely CONTAINS the pattern is not the pattern.
  // `.env.*` inside `# see .env.* below` must not count as a mirror.
  const commentOnly = judgeGcloudignoreMirror(GITIGNORE, MIRRORED.replace("\n.env.*", "\n# .env.*"));
  assert.deepEqual(
    commentOnly.missing.map((m) => m.pattern),
    [".env.*"],
  );
});

test("⚠⚠ LAST MATCH WINS — a later `!x` undoes `x`, so appended negations RED the mirror and name the negating line", () => {
  // The seeded escape: the set-based matcher still saw `.env` and `users.json` and passed, while
  // gitignore semantics would have re-included both secrets in the upload.
  const negated = [MIRRORED, "!.env", "!apps/studio/data/users.json"].join("\n");
  const verdict = judgeGcloudignoreMirror(GITIGNORE, negated);
  assert.deepEqual(
    verdict.missing.map((m) => [m.pattern, m.undoneBy?.line, m.undoneBy?.text]),
    [
      [".env", 9, "!.env"],
      ["apps/studio/data/users.json", 10, "!apps/studio/data/users.json"],
    ],
  );
  const report = formatMirrorVerdict(verdict);
  assert.match(report, /^check:gcloudignore-mirror FAIL — 2 of 5 line\(s\)/);
  assert.match(report, /\.env   \(env-secrets-block\) — present, but UNDONE by later line 9: `!\.env`/);

  // The reverse polarity: a `!x` subject followed by a plain `x` re-ignores the file again.
  const reignored = judgeGcloudignoreMirror(GITIGNORE, [MIRRORED, ".env.example"].join("\n"));
  assert.deepEqual(
    reignored.missing.map((m) => [m.pattern, m.undoneBy?.text]),
    [["!.env.example", ".env.example"]],
  );
});

test("a negation BEFORE the subject line is overridden by it — order resolves green", () => {
  const before = ["!.env", "!apps/studio/data/users.json", MIRRORED].join("\n");
  assert.deepEqual(judgeGcloudignoreMirror(GITIGNORE, before).missing, []);
});

test("⚠⚠ IT REFUSES rather than reporting a clean mirror when it cannot find its subject — three ways", () => {
  // 1. the header renamed
  assert.throws(
    () => requiredMirror(GITIGNORE.replace(ENV_SECRETS_HEADER, "# Secrets")),
    /has no "# Env \/ secrets" section/,
  );
  // 2. the header present but the block emptied — built rather than string-surgeried, so the
  //    fixture's own shape cannot quietly stop reproducing this case.
  const emptied = ["# Env / secrets", "", "apps/studio/data/users.json"].join("\n");
  assert.throws(() => requiredMirror(emptied), /section is empty/);
  // ...and a block whose only remaining lines are COMMENTS is empty too, which is the shape a
  // half-finished edit actually leaves behind.
  const commentsOnly = ["# Env / secrets", "# moved, see below", "", "apps/studio/data/users.json"].join("\n");
  assert.throws(() => requiredMirror(commentsOnly), /section is empty/);
  // 3. the runtime-data lines moved out
  const noRuntime = ["# Env / secrets", ".env", ".env.*"].join("\n");
  assert.throws(() => requiredMirror(noRuntime), /names no apps\/studio\/data/);
  // ⚠ AND THE REASON THESE ARE THE LOAD-BEARING TESTS: under a lenient reader each of the three
  // returns an EMPTY subject set, and an empty set has no missing member, so the rung would report
  // a perfect mirror while comparing nothing at all — forever, and with no symptom.
  for (const broken of [GITIGNORE.replace(ENV_SECRETS_HEADER, "# Secrets"), noRuntime, emptied]) {
    assert.throws(() => judgeGcloudignoreMirror(broken, ""), /gcloudignore-mirror:/);
  }
});

test("ignorePatterns reads meaningful lines only, trimmed — comments, blanks and indentation are not patterns", () => {
  const set = ignorePatterns(["# a comment", "", "  .env  ", "!keep", "   ", "#.env.*"].join("\n"));
  assert.deepEqual([...set].sort(), [".env", "!keep"].sort());
  assert.equal(set.has("#.env.*"), false, "a commented-out pattern is not a pattern");
});

test("the report NAMES what it compared on a pass and what is missing on a fail, and says what a gap costs", () => {
  const pass = formatMirrorVerdict(judgeGcloudignoreMirror(GITIGNORE, MIRRORED));
  assert.match(pass, /^check:gcloudignore-mirror PASS/);
  // ⚠ THE COUNT IS IN THE PASS LINE ON PURPOSE: "PASS" alone cannot distinguish a mirror that held
  // from a subject set that shrank, and the count is the cheapest thing a reader can sanity-check.
  assert.match(pass, /all 5 credential\/runtime line\(s\)/);

  const fail = formatMirrorVerdict(judgeGcloudignoreMirror(GITIGNORE, MIRRORED.replace("\n.env.*", "")));
  assert.match(fail, /^check:gcloudignore-mirror FAIL — 1 of 5 line\(s\)/);
  assert.match(fail, /\.env\.\*   \(env-secrets-block\)/);
  assert.match(fail, /baked into a published image/, "the report says what the gap costs, not only that there is one");
});

test("⚠ THE REPO'S OWN TWO FILES, held here as well as by the rung — the mirror is what ships", () => {
  const verdict = judgeGcloudignoreMirror(
    readFileSync(path.join(repoRoot, ".gitignore"), "utf8"),
    readFileSync(path.join(repoRoot, ".gcloudignore"), "utf8"),
  );
  assert.deepEqual(
    verdict.missing.map((m) => m.pattern),
    [],
    formatMirrorVerdict(verdict),
  );
  // ⚠ AND NOT VACUOUSLY: the real .gitignore must actually be handing over a real subject set. Six
  // lines the day this landed — `.env`, `.env.*`, `!.env.example` and three apps/studio/data files,
  // the third of which (`assets.runtime.json`) this rung FOUND missing from .gcloudignore.
  assert.ok(verdict.subjects.length >= 6, `${verdict.subjects.length} subjects — the set shrank`);
  assert.ok(verdict.subjects.some((s) => s.pattern === "apps/studio/data/assets.runtime.json"));
});

test("⚠ CRLF, a header on the FIRST line, and a block that runs to end-of-file are all read correctly", () => {
  // CRLF: the file may be written on Windows, and a reader that did not normalise would carry a
  // trailing \r into every pattern, so NOTHING would ever match .gcloudignore and the rung would
  // red on a repo that is perfectly mirrored.
  const crlf = GITIGNORE.split("\n").join("\r\n");
  assert.deepEqual(requiredMirror(crlf).map((x) => x.pattern), requiredMirror(GITIGNORE).map((x) => x.pattern));
  assert.deepEqual([...ignorePatterns(".env\r\n!keep\r\n")], [".env", "!keep"]);

  // The header on line ZERO — an index-0 header is a found header, and an off-by-one that treated
  // it as absent would REFUSE a perfectly good file.
  const atTop = ["# Env / secrets", ".env", "", "apps/studio/data/users.json"].join("\n");
  assert.deepEqual(requiredMirror(atTop).map((x) => x.pattern), [".env", "apps/studio/data/users.json"]);

  // The block running to the END of the file with no trailing blank line — the scan must stop at the
  // last real line rather than walking one past it.
  const toEof = ["apps/studio/data/users.json", "", "# Env / secrets", ".env", ".env.*"].join("\n");
  assert.deepEqual(requiredMirror(toEof).map((x) => x.pattern), [".env", ".env.*", "apps/studio/data/users.json"]);
});

test("⚠ WHITESPACE IS NOT CONTENT, at either end of the block — an indented header is still the header, and a whitespace-only line still ENDS it", () => {
  // `.gitignore` is hand-edited prose-and-patterns; a stray space is the likeliest edit there is,
  // and both of these read as "no change" to a human while changing the subject set completely.
  //
  // 1. THE HEADER, indented and trailing-spaced. A reader comparing the raw line would not find it
  //    and would REFUSE a file that is perfectly well formed — a fence that cries wolf gets deleted.
  const indentedHeader = ["  # Env / secrets  ", ".env", "", "apps/studio/data/users.json"].join("\n");
  assert.deepEqual(requiredMirror(indentedHeader).map((x) => x.pattern), [".env", "apps/studio/data/users.json"]);

  // 2. THE TERMINATOR, a line of spaces rather than a truly empty one. A reader comparing raw
  //    length would walk straight PAST it into the next section and pull `*.log` — an unmirrorable
  //    line — into a security control's subject set, which reds the gate for the wrong reason.
  const spacedTerminator = ["# Env / secrets", ".env", "   ", "# Logs", "*.log", "", "apps/studio/data/users.json"].join("\n");
  assert.deepEqual(
    requiredMirror(spacedTerminator).map((x) => x.pattern),
    [".env", "apps/studio/data/users.json"],
    "the block ends at the whitespace-only line, so no log pattern joins the credential set",
  );
});

test("⚠ the FAIL report is a BLOCK: one row per gap, a blank line, then what a gap costs — asserted line by line", () => {
  // Two gaps, so "one row per gap" is a statement the fixture can actually make.
  const lines = formatMirrorVerdict(
    judgeGcloudignoreMirror(GITIGNORE, MIRRORED.replace("\n.env.*", "").replace("\napps/studio/data/users.json", "")),
  ).split("\n");
  assert.match(lines[0] as string, /^check:gcloudignore-mirror FAIL — 2 of 5 line\(s\)/);
  assert.equal(lines[1], "  .env.*   (env-secrets-block)");
  assert.equal(lines[2], "  apps/studio/data/users.json   (studio-runtime-data)");
  assert.equal(lines[3], "", "a blank line separates the gaps from the explanation");
  // The explanation is three sentences and each carries a load: what bypasses what, how it gets in,
  // and what to do. A report that lost the middle would still look substantial.
  assert.match(lines[4] as string, /BYPASSES `\.gitignore`/);
  assert.match(lines[5] as string, /COPY \. \./);
  assert.match(lines[5] as string, /gcloud builds submit/);
  assert.match(lines[6] as string, /baked into a published image/);
  assert.match(lines[6] as string, /Add each line above/);
  assert.equal(lines.length, 7, `the report is exactly seven lines: ${JSON.stringify(lines)}`);
});
