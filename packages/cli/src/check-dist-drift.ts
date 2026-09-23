/* gate-check
retired: ADR-0311 D2
*/
// ⚠ UNWIRED — `check:dist-drift` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
// invokes this file: it appears in no root `package.json` script, no `GATE_PLAN` step
// (`gate-order.ts`), and no CI job. Its own unit tests still run under `pnpm -r test`, so they
// stay GREEN while this enforces NOTHING — a passing test here is not evidence that the rule
// below is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding it needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: `RETIRED_CHECKS` in `gate-order.ts`, pinned by `gate-order.test.ts`.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// Best-effort PUBLISHED-installer drift check (ADR-0207 D5), wired into `pnpm gate`.
//
// D5 serves `install.ps1` as a public object from the `storytree-dist` bucket, and that published
// copy — NOT the repo's — is what a fresh explorer machine downloads and EXECUTES. Publishing is
// currently a manual `gcloud storage cp` (the publish-on-merge automation is a follow-on), so editing
// `infra/install.ps1` does not reach the bucket. Nothing today makes that gap visible: the URL keeps
// answering 200 with the OLD script, so a dev is silently onboarded by a stale installer.
//
// This WARNs when the published object differs from the repo copy:
//
//   - published matches the repo         -> OK.
//   - published differs                  -> WARN naming the fix (`gcloud storage cp …`).
//   - nothing published yet (404)        -> WARN (the one-liner in the docs does not work).
//   - offline / bucket unreachable       -> SKIP (never a failure; the gate runs offline by default).
//
// It ALWAYS exits 0 — like check:corpus-sync / check:agents-sync, it is a nudge, never a block. A
// drifted publish is an owner action (a credentialed write to a public bucket), so failing the gate
// would punish every contributor for something only the owner can resolve.
//
// COMPARISON IS LINE-ENDING INSENSITIVE. The repo copy is checked out with the platform's endings
// (CRLF on Windows) while the published object carries whatever was uploaded, so a raw byte compare
// would report permanent phantom drift on a Windows checkout — the check would cry wolf and be
// ignored, which is worse than not having it. Only real content changes are reported.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const TAG = "[check:dist-drift]";

/** The public object the D1 one-liner fetches (ADR-0207 D5). */
export const PUBLISHED_URL = "https://storage.googleapis.com/storytree-dist/install.ps1";

/** Bound the fetch so an unreachable bucket cannot hang the gate. */
const FETCH_TIMEOUT_MS = 8_000;

/** What the comparison concluded. */
export type DriftStatus = "match" | "drift" | "unpublished" | "skipped";

export interface DriftVerdict {
  readonly status: DriftStatus;
  readonly message: string;
}

/**
 * PURE: normalise a script for comparison. Line endings are NOT content — a Windows checkout holds
 * CRLF while the uploaded object may hold LF, and treating that as drift would make the check a
 * permanent false alarm. A trailing-newline difference is likewise noise.
 */
export function normaliseScript(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

/** PURE: the content hash used for the comparison (short, for legible output). */
export function scriptHash(text: string): string {
  return createHash("sha256").update(normaliseScript(text), "utf8").digest("hex").slice(0, 12);
}

/**
 * PURE: decide the verdict. `published` is the fetched body, `null` when the object does not exist,
 * and `undefined` when the bucket could not be reached at all (offline) — three genuinely different
 * outcomes, only one of which is the owner's problem.
 */
export function classifyDrift(local: string, published: string | null | undefined): DriftVerdict {
  if (published === undefined) {
    return { status: "skipped", message: `${TAG} SKIP — could not reach the distribution bucket; publish state unverified.` };
  }
  if (published === null) {
    return {
      status: "unpublished",
      message:
        `${TAG} WARN — nothing is published at ${PUBLISHED_URL}, so the one-liner in infra/install.md ` +
        "does NOT work. Publish it: gcloud storage cp infra/install.ps1 gs://storytree-dist/install.ps1",
    };
  }
  const localHash = scriptHash(local);
  const publishedHash = scriptHash(published);
  if (localHash === publishedHash) {
    return { status: "match", message: `${TAG} OK — the published installer matches infra/install.ps1 (${localHash}).` };
  }
  return {
    status: "drift",
    message:
      `${TAG} WARN — the PUBLISHED installer is STALE: published ${publishedHash} vs repo ${localHash}. ` +
      "A fresh explorer machine would execute the old script. Re-publish: " +
      "gcloud storage cp infra/install.ps1 gs://storytree-dist/install.ps1 " +
      "(use gcloud storage, NOT gsutil — see infra/dist-bucket.md).",
  };
}

/** Fetch the published object: its body, `null` if absent (404), `undefined` if unreachable. */
async function fetchPublished(url: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) return undefined; // a 5xx/403 says nothing about drift — treat as unverified.
    return await res.text();
  } catch {
    return undefined; // offline / DNS / timeout.
  }
}

/** Repo root: packages/cli/src/check-dist-drift.ts → four dirs up (the doctor.ts repoRoot pattern). */
function repoRoot(): string {
  return path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
}

async function main(): Promise<void> {
  const local = readFileSync(path.join(repoRoot(), "infra", "install.ps1"), "utf8");
  const verdict = classifyDrift(local, await fetchPublished(PUBLISHED_URL));
  console.log(verdict.message);
  // WARN-only: never sets a non-zero exit code.
}

// Only run when invoked as a script, so the pure helpers stay importable by the test without the
// import triggering a network fetch (the check-declared.ts / check-web-grounding.ts convention).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((err: unknown) => {
    console.log(`${TAG} SKIP — unexpected error (${(err as Error).message}); publish state unverified.`);
  });
}
