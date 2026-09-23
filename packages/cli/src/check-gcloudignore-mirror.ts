/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds when this diff adds a credential- or runtime-state-shaped path to `.gitignore` without
  repeating it in `.gcloudignore` (ADR-0544 D5). `.gcloudignore` BYPASSES `.gitignore` — it says so
  in its own first lines — and `apps/studio/Dockerfile` is `COPY . .`, so a path listed only in
  `.gitignore` is uploaded by `gcloud builds submit` and baked into a published image, unread.
  ADR-0544 D1 closed the live instance and left the mirror hand-maintained, which is exactly what
  drifts in silence; this fires on the branch that introduces the drift rather than at deploy time.
  Two file reads, no git and no network, so it sits with its `check:boundaries` /
  `check:ownership-totality` neighbours. ⚠ IT IS A MERGE WALL AS WELL AS A GATE RUNG since ADR-0547
  D1 (2026-09-08) — the gate is the habit, CI is the wall, and this rung sits on both like
  `check:contract-grammar`. It was local-only until then for a credential reason rather than a
  judgement one: the CI step was written and the push REFUSED (`repo` but not `workflow` scope), and
  the owner directed the promotion and authorised the SSH push that landed it. It is placed `runs:
  "both"`; the parity capability's `DECLARED_LOCAL_ONLY` set it left went with that capability's
  comparison (ADR-0606 D4)
*/
/**
 * `pnpm check:gcloudignore-mirror` — the thin I/O SHELL. It reads two files and hands them to the
 * pure judge next door ({@link file://./gcloudignore-mirror.ts}), which owns the rule and the
 * report; this module only gathers and exits.
 *
 * Same gatherer/judge split as `check-hierarchy-camps.ts` / `hierarchy-camps.ts` and its
 * neighbours, for the same reason: the rule stays exhaustively unit-testable offline while the
 * glue stays dumb and total.
 *
 * OFFLINE, READ-ONLY, MILLISECONDS. Two files, no git, no network, no Docker, no cloud — which is
 * what lets it sit with the branch-local checks at the cheap end of the plan and fire on the branch
 * that introduces the drift rather than at deploy time, when the image is already published.
 *
 * ⚠ IT FAILS RATHER THAN SKIPS WHEN A FILE IS ABSENT. Both files are committed at the repo root and
 * neither is optional; a missing one means the aperture moved, and this rung's whole value is that
 * it cannot quietly compare nothing (see the judge's header).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatMirrorVerdict, judgeGcloudignoreMirror } from "./gcloudignore-mirror.js";

const TAG = "check:gcloudignore-mirror";

/** Repo root: packages/cli/src/check-gcloudignore-mirror.ts → four dirs up. */
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

function read(name: string): string {
  const file = path.join(repoRoot, name);
  if (!existsSync(file)) {
    console.error(`${TAG} FAIL — ${name} is missing at the repo root; this rung compares it and cannot report on a file that is not there.`);
    process.exit(1);
  }
  return readFileSync(file, "utf8");
}

const verdict = judgeGcloudignoreMirror(read(".gitignore"), read(".gcloudignore"));
const body = formatMirrorVerdict(verdict);
if (verdict.missing.length > 0) {
  console.error(body);
  process.exit(1);
}
console.log(body);
