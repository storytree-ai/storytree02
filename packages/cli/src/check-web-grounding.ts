/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
skip:
  when: >-
    the `web/` submodule is absent locally (it is cloned in CI, where an absent web/ is a hard
    failure instead)
  inCi: failure
why: >-
  it validates the public site's ADR citations against the DECISION LOG, which is shared live state
  since ADR-0403 dec 1 — a sibling's status flip can red it, so it cannot run ahead of this branch's
  own work. It was `own-work` while the corpus was files in this diff; only its SUBJECT moved. Still
  skip-capable on an absent web/ submodule, and the skip is decided BEFORE the store is dialled so a
  DB outage can never read as the submodule skip

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING. Commit ae90d950 records escaped
  stale doctrine after ADR-0040; without it public copy cites missing or superseded decisions.
*/
// The drift gate that binds the PUBLIC website (the `web` submodule, storytree-web) back to this
// repo's decision record (ADR-0056). Load-bearing factual claims on the site carry a
// `data-grounds="ADR-NNNN[,…]"` attribute — invisible on the page, discoverable in the repo. This
// check runs in the PARENT repo (the only side that can see the private ADR/Library corpus) and
// fails when a cited ADR is missing or SUPERSEDED — so a doctrine change can't silently leave the
// public copy overclaiming (the "a person signs off" drift that ADR-0040 made stale).
//
//   pnpm check:web-grounding
//
// TWO AUTHORED FORMS, one validator: the `data-grounds="…"` attribute in markup, and a
// `grounds: ['ADR-NNNN']` array in a script that writes that attribute at runtime (chapter 2's TELL
// overlay). The second was added when the site started speaking from a script — see SCRIPT_GROUNDS.
//
// References live in storytree-web; validation lives here — the web repo can't self-check. In CI the
// pinned web SHA is cloned first (storytree-web is public). Locally an absent `web/` is a SKIP
// (`git submodule update --init web` to enable it); in CI an absent `web/` is a hard failure (the
// clone step must have run). Today only `ADR-NNNN` ids are validated; any other scheme is flagged
// as unvalidated rather than silently trusted.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadTitledAdrMetasFromStore } from "@storytree/drive";

import { GATE_SKIP_EXIT_CODE } from "./gate-runner.js";
import { stripComments } from "./web-experience-check.js";

export interface GroundingRef {
  /** web-relative path, e.g. "src/pages/index.astro". */
  readonly file: string;
  readonly ids: readonly string[];
}

export interface GroundingProblem {
  readonly file: string;
  readonly id: string;
  readonly reason: string;
}

const DATA_GROUNDS = /data-grounds\s*=\s*"([^"]*)"/g;
/**
 * The SCRIPT-AUTHORED form of the same claim.
 *
 * ⚠ WHY A SECOND SHAPE EXISTS AT ALL, because a single one would obviously be better. The markup
 * regex above can only see a claim written as an attribute in a `.astro`/`.html` source file. Since
 * `website-refresh-arc-pitch-overlays` the site also speaks from a SCRIPT: chapter 2's TELL overlay
 * holds its copy as data in `web/src/scripts/act2-tell.ts` and writes `data-grounds` into the DOM at
 * runtime, so the attribute exists in the browser and NOWHERE in any source file. Every one of those
 * claims was therefore invisible to this rung — it reported "OK: 2 references" on a page that had
 * just acquired four more, which is the worst answer a check can give: a green that reads like
 * coverage.
 *
 * Matching `grounds: [ … ]` closes it. The ids inside are extracted verbatim and handed to the same
 * validator, so a script-authored claim citing a missing or superseded decision reds exactly as an
 * attribute-authored one does. An unrecognised scheme is still FLAGGED rather than skipped, which is
 * what stops this widening from becoming a way to launder a citation past the rung.
 */
const SCRIPT_GROUNDS = /\bgrounds\s*:\s*\[([^\]]*)\]/g;
const QUOTED = /['"`]([^'"`]+)['"`]/g;
const ADR_ID = /^ADR-(\d{3,4})$/;

const pad = (n: number): string => String(n).padStart(4, "0");

/**
 * Pull every grounding id-list out of one file's text — both the markup and the script form.
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS A CORRECTNESS FIX RATHER THAN TIDINESS. Both patterns
 * are lexical, so before this the rung could not tell a CLAIM from a file merely WRITING ABOUT one:
 * a source comment explaining the mechanism — `the \`data-grounds="…"\` attribute form` — was
 * extracted as a live citation of an id called `…` and BLOCKED the gate. That is the same class as
 * everything else this repo guards against, pointing the other way: an instrument reporting a
 * problem that does not exist on the page, in a message that names a file whose page-visible copy is
 * fine. Stripping also means a commented-OUT claim stops being validated, which is right — a claim
 * nobody can read is not a claim. `stripComments` is the closure rung's, string- and
 * template-literal-aware, so an id inside a real string still counts.
 */
export function extractGroundingRefs(file: string, rawContent: string): GroundingRef[] {
  const content = stripComments(rawContent);
  const refs: GroundingRef[] = [];
  for (const m of content.matchAll(DATA_GROUNDS)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length > 0) refs.push({ file, ids });
  }
  for (const m of content.matchAll(SCRIPT_GROUNDS)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const ids = [...raw.matchAll(QUOTED)]
      .map((q) => (q[1] ?? "").trim())
      .filter((s) => s.length > 0);
    if (ids.length > 0) refs.push({ file, ids });
  }
  return refs;
}

/**
 * Validate grounding refs against the ADR index (number → status). Pure, so the test drives it with
 * fixtures. A referenced ADR that is missing or fully `superseded` is a problem; a partially
 * superseded ADR (an edge, not a status) still stands and is fine. Non-ADR schemes (e.g. a library
 * artifact id) are flagged as unvalidated — extend here to resolve them.
 */
export function validateGrounding(
  refs: readonly GroundingRef[],
  adrStatusByNumber: ReadonlyMap<number, string>,
): GroundingProblem[] {
  const problems: GroundingProblem[] = [];
  for (const ref of refs) {
    for (const id of ref.ids) {
      const m = ADR_ID.exec(id);
      if (m === null) {
        problems.push({
          file: ref.file,
          id,
          reason:
            "unsupported reference scheme — only ADR-NNNN is validated today (extend check-web-grounding to resolve library ids)",
        });
        continue;
      }
      const num = Number(m[1]);
      const status = adrStatusByNumber.get(num);
      if (status === undefined) {
        problems.push({ file: ref.file, id, reason: `references ADR-${pad(num)}, which is not in the decision log` });
      } else if (status === "superseded") {
        problems.push({
          file: ref.file,
          id,
          reason: `references ADR-${pad(num)}, which is SUPERSEDED — repoint the claim to the current decision`,
        });
      }
    }
  }
  return problems;
}

const TEXT_EXT = new Set([".astro", ".html", ".md", ".mdx", ".jsx", ".tsx", ".ts", ".js", ".json"]);

/** Recursively collect web-relative text-file paths under a dir (the fs shell around the pure core). */
function walkTextFiles(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTextFiles(full, base, out);
    else if (TEXT_EXT.has(path.extname(name).toLowerCase())) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

// ASYNC since ADR-0403 dec 1: the decision index is a store read now. The skip branch still
// decides and prints BEFORE any connection is opened, so an absent `web/` submodule can never
// be reported as a database failure, or the reverse.
async function main(): Promise<void> {
  // packages/cli/src/check-web-grounding.ts → four dirs up (the build-claude-md.ts pattern).
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const webRoot = path.join(repoRoot, "web");
  const webSrc = path.join(webRoot, "src");
  const inCi = process.env.CI === "true";

  if (!existsSync(webSrc)) {
    if (inCi) {
      console.error(
        "check:web-grounding — web/ is not checked out in CI. The workflow must clone the pinned " +
          "storytree-web submodule before this step.",
      );
      process.exit(1);
    }
    // DECLARE the skip to the gate runner rather than exiting 0 (ADR-0276 increment 4). Exiting 0
    // here printed `PASS` on the gate's scoreboard for a step that read nothing at all — the runner
    // computes status from the exit code, so opting out and verifying were indistinguishable to
    // every reader of the summary. The reserved code makes it a visible SKIP; it still does not red
    // the gate, because an absent `web/` is a legitimate local state (`gateExitCode`).
    console.log(
      "check:web-grounding — SKIP: web/ submodule not checked out " +
        "(run `git submodule update --init web` to enable this check locally).",
    );
    process.exit(GATE_SKIP_EXIT_CODE);
  }

  // ★ THE DECISION INDEX COMES FROM THE STORE (ADR-0403 dec 1), which makes this the first gate rung
  // with BOTH a legitimate skip and a hard DB dependency — and the two must stay distinguishable.
  // The skip above fires on an absent `web/` submodule and is a real local state; an unreachable
  // store is a FAILURE and says so. Collapsing them would make a DB outage read as the familiar
  // submodule skip, which is the one confusion this ordering exists to prevent: the skip is decided
  // and printed BEFORE the store is dialled, so a skip can never be a disguised connection failure.
  const { createPool, closePool, PgLibraryStore } = await import("@storytree/library/store");
  let handle: Awaited<ReturnType<typeof createPool>>;
  try {
    handle = await createPool();
  } catch (err) {
    console.error(
      "check:web-grounding — could not open the decision log, which lives in the store since " +
        `ADR-0403: ${err instanceof Error ? err.message : String(err)}\n` +
        "  This is a FAILURE, not the submodule skip above: the references were never checked.\n" +
        "  Bring the DB up (pnpm db:up) and re-run.",
    );
    process.exit(1);
  }
  let statusByNumber: Map<number, string>;
  try {
    const { adrs, parseErrors, unreadable } = await loadTitledAdrMetasFromStore(
      new PgLibraryStore(handle.pool),
    );
    if (unreadable || adrs.length === 0) {
      // Zero decisions is never a clean index: it means an unmigrated or wrong database, and
      // validating every web reference against an empty index would pass nothing and fail everything.
      console.error(
        "check:web-grounding — the decision index is empty or unreadable, so no reference could be " +
          `checked:\n  ${parseErrors.join("\n  ")}`,
      );
      process.exit(1);
    }
    if (parseErrors.length > 0) {
      // adr-health owns decision health; here a parse failure just means we can't trust the index.
      console.error(
        "check:web-grounding — could not read the whole decision index (fix adr-health first):\n  " +
          parseErrors.join("\n  "),
      );
      process.exit(1);
    }
    statusByNumber = new Map(adrs.map((a) => [a.number, a.status]));
  } finally {
    await closePool(handle.pool, handle.connector);
  }

  const refs: GroundingRef[] = [];
  for (const rel of walkTextFiles(webSrc, webRoot)) {
    refs.push(...extractGroundingRefs(rel, readFileSync(path.join(webRoot, rel), "utf8")));
  }

  const problems = validateGrounding(refs, statusByNumber);
  const idCount = refs.reduce((n, r) => n + r.ids.length, 0);

  if (problems.length > 0) {
    console.error(
      `check:web-grounding — BLOCKED: ${problems.length} grounding reference(s) in storytree-web no ` +
        "longer hold against the corpus:\n",
    );
    for (const p of problems) console.error(`  ✗ web/${p.file}: ${p.id} — ${p.reason}`);
    console.error(
      "\nThe public site's claim drifted from the decision it cites. Update the copy in storytree-web " +
        "(and its data-grounds), or repoint the reference.",
    );
    process.exit(1);
  }

  console.log(
    `check:web-grounding — OK: ${idCount} grounding reference(s) across ${refs.length} claim(s) all ` +
      "resolve to current ADRs.",
  );
}

// Run only when invoked directly (`tsx src/check-web-grounding.ts`), not when the test imports the
// pure functions above.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
