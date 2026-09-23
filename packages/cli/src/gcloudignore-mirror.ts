/**
 * `.gcloudignore` MUST MIRROR `.gitignore`'s CREDENTIAL LINES — the pure judge (ADR-0544 D5,
 * `prove-unproven-capabilities-arc-inc-30`). The shell that reads the two files and exits is
 * `check-gcloudignore-mirror.ts`; nothing here touches the filesystem.
 *
 * ── WHY THIS IS A SECURITY CONTROL AND NOT TIDINESS ────────────────────────────────────────────
 *
 * `apps/studio/Dockerfile` is `COPY . .`, and the documented build path is `gcloud builds submit`,
 * which filters the upload by `.gcloudignore`. That file says so in its own first lines: its
 * presence means **`.gitignore` is not consulted**. So a credential-shaped path being gitignored
 * buys NOTHING here — it has to be repeated in `.gcloudignore` or it is baked, unread, into a
 * published image. ADR-0544 D1 closed the live instance of that (`.env` / `.env.*` were gitignored
 * and not gcloudignored); D5 parked this rung, because **nothing enforced the mirror afterwards**
 * and a hand-maintained copy of a security control is exactly the thing that drifts in silence.
 *
 * The exposure is the BY-HAND build, which uploads a working tree as it actually is. CI checks out
 * clean, so only committed files exist there.
 *
 * ⚠ IT IS A MERGE WALL AS WELL AS A GATE RUNG (ADR-0547 D1, 2026-09-08). It was written for CI's
 * `verify` job from the start — a control over what reaches a published image belongs at the
 * merge, not only on the branch of whoever remembered to gate — and was local-only at first for a
 * CREDENTIAL reason, never a judgement one: this repo's OAuth credential carried `repo` but not
 * `workflow`, so GitHub refused the push that added the step. The owner directed the promotion and
 * authorised the SSH push that landed it. (This paragraph said "LOCAL-ONLY TODAY" until 2026-09-24,
 * sixteen days after that stopped being true.)
 *
 * ⚠ AND IT READS ONLY THE TOP-LEVEL `.gitignore`. A NESTED ignore file is invisible to it: on
 * 2026-09-24 `infra/.gitignore`'s Terraform lines (`terraform.tfvars` — the operator's email — and
 * local state) were found missing from `.gcloudignore`, with this rung green. They are held by hand
 * there now; whether the image filter should keep copying ignore lines at all is the owner's open
 * question `oq-image-filter-stops-copying-gitignore`, so this rung was deliberately NOT widened to
 * walk nested files meanwhile — that would deepen the copy it may yet replace.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ NOT A SCAN OF THE DOCKERFILE FOR SUSPICIOUS STRINGS. The Dockerfile is `COPY . .` and names no
 * files at all, so such a scan would assert nothing while looking like it asserted a great deal
 * (the increment names this trap explicitly). The load-bearing statement is the RECONCILIATION.
 *
 * ⚠ AND IT IS NOT A SUBSTITUTE FOR GITHUB'S SECRET SCANNING, which is a different control over a
 * different hole. Re-measured 2026-09-08 against the API rather than inherited from ADR-0544 D6:
 * `secret_scanning` and `secret_scanning_push_protection` are both **disabled** on this **public**
 * repository. Those cover a credential that reaches a COMMIT; this covers one that reaches an
 * IMAGE without ever being committed. Neither implies the other.
 *
 * ── THE ONE THING THAT MAKES IT UN-VACUOUS ─────────────────────────────────────────────────────
 *
 * ⚠⚠ {@link requiredMirror} REFUSES rather than returning an empty set when it cannot find the
 * block it is supposed to be reading. A judge whose subject list can silently become empty passes
 * forever: rename `# Env / secrets`, or move the member-data lines, and a lenient reader would go
 * on reporting a mirror it was no longer comparing. Empty is not "nothing to check" here — it is
 * "I could not find my subject", and it is a hard error.
 */

/** One `.gitignore` line that must appear in `.gcloudignore`, with why it is in the set. */
export interface MirrorSubject {
  /** The `.gitignore` line, verbatim and trimmed — including a leading `!` negation. */
  readonly pattern: string;
  /** Which rule put it in the set — for the failure message, so a red names its own basis. */
  readonly reason: "env-secrets-block" | "studio-runtime-data";
}

/** What the judge found. */
export interface MirrorVerdict {
  /** Every `.gitignore` line the mirror covers. */
  readonly subjects: readonly MirrorSubject[];
  /** Those with no twin in `.gcloudignore` — empty is the mirror holding. */
  readonly missing: readonly MirrorSubject[];
}

/** The `.gitignore` section header this reads. Changing it means changing {@link requiredMirror}. */
export const ENV_SECRETS_HEADER = "# Env / secrets";

/**
 * The studio's app-owned runtime state under `apps/studio/data/` (member identities, attestations,
 * the runtime asset view). Not credentials, but the same class of thing: gitignored, never
 * committed, and not to be baked into a published image either (ADR-0043 / ADR-0044).
 */
const STUDIO_RUNTIME_DATA = /^!?apps\/studio\/data\/[^/]+\.json$/;

/** A meaningful ignore line: not blank, not a comment. `!` negations ARE meaningful. */
function isPattern(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && !t.startsWith("#");
}

/**
 * The lines `.gcloudignore` has to repeat, read out of `.gitignore`.
 *
 * The `# Env / secrets` block runs from its header to the first blank line — the shape the file
 * already uses to separate its sections. The studio runtime-data lines are matched by PATTERN
 * wherever they sit, because they are scattered through `.gitignore`'s body with their own
 * explanatory comments and a positional rule would miss the next one somebody adds.
 *
 * @throws if the header is absent, if the block under it holds no patterns, or if no runtime-data
 * line is found — see the module header: an empty subject set is a lost subject, not a clean bill.
 */
export function requiredMirror(gitignore: string): MirrorSubject[] {
  const lines = gitignore.replace(/\r\n/g, "\n").split("\n");
  const headerAt = lines.findIndex((l) => l.trim() === ENV_SECRETS_HEADER);
  if (headerAt < 0) {
    throw new Error(
      `gcloudignore-mirror: .gitignore has no "${ENV_SECRETS_HEADER}" section — this judge cannot find its subject, and reporting a mirror it did not compare would be worse than failing`,
    );
  }
  const out: MirrorSubject[] = [];
  for (let i = headerAt + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim().length === 0) break;
    if (isPattern(line)) out.push({ pattern: line.trim(), reason: "env-secrets-block" });
  }
  if (out.length === 0) {
    throw new Error(
      `gcloudignore-mirror: the "${ENV_SECRETS_HEADER}" section is empty — the block moved or was renamed, and an empty subject set passes forever`,
    );
  }
  const runtime = lines
    .filter((l) => isPattern(l) && STUDIO_RUNTIME_DATA.test(l.trim()))
    .map((l): MirrorSubject => ({ pattern: l.trim(), reason: "studio-runtime-data" }));
  if (runtime.length === 0) {
    throw new Error(
      "gcloudignore-mirror: .gitignore names no apps/studio/data/*.json runtime state — that set has never been empty, so this is a moved subject rather than a clean repo",
    );
  }
  out.push(...runtime);
  return out;
}

/** Every meaningful line of an ignore file, trimmed — the set a subject is looked up in. */
export function ignorePatterns(text: string): Set<string> {
  return new Set(
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(isPattern)
      .map((l) => l.trim()),
  );
}

/** The reconciliation: every subject from `.gitignore`, and the ones `.gcloudignore` does not repeat. */
export function judgeGcloudignoreMirror(gitignore: string, gcloudignore: string): MirrorVerdict {
  const subjects = requiredMirror(gitignore);
  const present = ignorePatterns(gcloudignore);
  return { subjects, missing: subjects.filter((s) => !present.has(s.pattern)) };
}

/** The report — a PASS naming what it compared, or a FAIL naming each gap and what it costs. */
export function formatMirrorVerdict(verdict: MirrorVerdict): string {
  if (verdict.missing.length === 0) {
    return `check:gcloudignore-mirror PASS — all ${verdict.subjects.length} credential/runtime line(s) in .gitignore are repeated in .gcloudignore.`;
  }
  const rows = verdict.missing.map((m) => `  ${m.pattern}   (${m.reason})`).join("\n");
  return [
    `check:gcloudignore-mirror FAIL — ${verdict.missing.length} of ${verdict.subjects.length} line(s) are in .gitignore and NOT in .gcloudignore:`,
    rows,
    "",
    "`.gcloudignore` BYPASSES `.gitignore` (its own first lines say so), and apps/studio/Dockerfile",
    "is `COPY . .` — so a path listed only in .gitignore is uploaded by `gcloud builds submit` and",
    "baked into a published image, unread. Add each line above to .gcloudignore's credential block.",
  ].join("\n");
}
