/* gate-check
retired: ADR-0311 D2
*/
// ⚠ UNWIRED — `check:declared` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
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
// Claim-gate check (ADR-0200 D3). It WAS wired into `pnpm gate` — never into CI — until ADR-0311 D2
// removed it.
//
// ADR-0142 made `noticeboard declare --node` take the work-time story claim (the wisp), and
// ADR-0200 made the notice board the claim LEDGER: a session is born claimed (`worktree create`,
// D3) or claims deliberately (`noticeboard claim` / `declare --node`). This check is the gate-side
// enforcement of that ceremony — the rung moved from advisory (the ADR-0143 WARN on a missing
// presence declaration) to ENFORCING: a session that holds NO live claim FAILS the gate
// (ADR-0200 D3: an unclaimed session cannot reach the merge ceremony). Any grade counts —
// an `exploring` birth claim and a `work` declare claim both pass. The LOBBY arm below runs first
// and independently, for every session. The SKIP arms stay exit-0 (CI is DB-free and MUST stay
// green):
//
//   - not a .claude/worktrees/* session -> no claim to check, SKIP silently.
//   - no DB creds / DB unreachable / timeout / unexpected error             -> SKIP.
//   - session holds >= 1 live claim (any grade)                             -> OK.
//   - session holds ZERO live claims                                        -> FAIL (exit 1),
//     naming the claim ceremony.
//
// THE LOBBY ARM (ADR-0245 D5.2) closes the SKIP that failed OPEN for exactly the misbehaving
// session. A session working in the PRIMARY CHECKOUT has no worktree identity, so `deriveIdentity()`
// is null: it cannot hold a claim, cannot appear in `events.node_claim`, and is invisible to the
// board — which is why the pre-0245 gate returned silently for it. Ahead of the identity branch,
// this check asks a question that needs no identity and no DB, only git:
//
//   managed worktrees present + the PRIMARY CHECKOUT's tree is DIRTY        -> FAIL (exit 1),
//     naming the CONDITION and the worktree ceremony — never a session.
//
// THE SUBJECT IS THE PRIMARY CHECKOUT, NOT THE CALLER. The arm shipped scoped to a caller standing
// IN the lobby — `evaluateLobbyFromGit()` was reached only inside `if (identity === null)` and then
// skipped itself again unless the toplevel WAS the primary checkout. Both gates are gone. The
// coverage that produced was backwards: it refused only a session running the gate FROM the lobby,
// which since ADR-0257's static `permissions.deny` block (the primary checkout is unwritable to the
// file tools) is the session least likely to be running a gate at all, while every worktree
// session — i.e. all of them — landed work past a dirty lobby in silence. ADR-0245 D5.2 and
// ADR-0257 both describe this arm as the general "the gate notices a dirty lobby" backstop, and
// ADR-0257 leans on it as the only arm that covers a **shell**; it now is one. The lobby question
// is pure git and needs no session identity, so it is asked for EVERY session, from wherever the
// gate is invoked: `git status --porcelain` runs with `cwd` = the primary checkout, which reports
// that checkout's tree ALONE — a worktree's own dirt lives in its own index and is never the
// subject here.
//
// Keyed on DIRTY, never on PRESENT: the lobby is a legitimate place (ADR-0200 D3 opens sessions
// there; ADR-0220's auto-repair does git surgery there), so orienting, reading, `db:status` and
// `worktree create` must all see nothing. Attribution is deliberately NOT attempted — an
// uncommitted tree records no session identity, so the message describes a condition and never
// accuses. Pure git, so it runs BEFORE the DB probe and is unaffected by an offline store; CI and
// plain clones lack `.claude/worktrees/` (untracked) and keep their silent SKIP.
//
// Read-only against the ledger and the working tree; only the two FAIL arms set a non-zero exit.

import { execFileSync } from "node:child_process";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { deriveIdentity } from "@storytree/drive";
import { createPool, closePool } from "@storytree/library/store";
import { PgClaimStore } from "@storytree/notice-board/store";

import { loadLocalSecrets, presentEnv } from "./secrets.js";

const TAG = "[check:declared]";
/** Bound the live read so a stopped DB can't hang the gate (> the ~6s Cloud SQL cold handshake). */
const LIVE_READ_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface EvaluateDeclaredResult { verdict: "ok" | "fail"; message: string }

/**
 * PURE: the claim-gate decision (ADR-0200 D3). "ok" while the session holds >= 1 live claim of ANY
 * grade — a `worktree create` exploring claim and a `declare --node` work claim both pass (an
 * absent grade IS the work claim, ADR-0200 D2 back-compat) — "fail" on zero claims, with guidance
 * that names the claim ceremony. The SKIP arms (offline, no creds, not a session worktree) are I/O
 * conditions and live in main(), not here.
 */
export function evaluateDeclared(input: {
  sessionId: string;
  claims: readonly { unitId: string; grade?: string }[];
}): EvaluateDeclaredResult {
  if (input.claims.length > 0) {
    const held = input.claims.map((c) => `${c.unitId} (${c.grade ?? "work"})`).join(", ");
    return {
      verdict: "ok",
      message: `${TAG} OK — session "${input.sessionId}" holds ${input.claims.length} live claim(s): ${held}.`,
    };
  }
  return {
    verdict: "fail",
    message:
      `${TAG} FAIL — session "${input.sessionId}" holds NO live claim: an unclaimed session cannot reach ` +
      "the merge ceremony (ADR-0200 D3). Claim the capability you are writing — the story only for " +
      "cross-capability work (ADR-0270 D1): " +
      'pnpm storytree noticeboard claim <unit-id> --grade exploring --intent "<why>" --pg, or anchor with ' +
      'pnpm storytree noticeboard declare --working-on "<what>" --node <unit-id> --pg, or be born claimed via ' +
      'pnpm storytree worktree create --node <unit-id> --intent "<what>" --pg.',
  };
}

/** How many dirty paths the FAIL message lists before truncating (the gate output stays readable). */
const DIRTY_PATHS_SHOWN = 3;

export interface EvaluateLobbyResult { verdict: "skip" | "fail"; message: string }

/**
 * PURE: the lobby decision (ADR-0245 D5.2) — is the shared primary checkout carrying uncommitted
 * work that no claim can name? "fail" only on the full CONJUNCTION; every other shape is "skip"
 * with an empty message, so the caller stays silent exactly as it did before. The git probes that
 * gather these facts are I/O and live in {@link evaluateLobbyFromGit}, mirroring
 * {@link evaluateDeclared}.
 *
 * Every field describes the PRIMARY CHECKOUT, never the caller: there is deliberately no
 * `isPrimaryCheckout` leg, because where the gate happens to be invoked from has no bearing on
 * whether the lobby is dirty. It was such a leg until 2026-08-02, which scoped the arm to a
 * lobby-resident caller and let every worktree session past in silence (see the header).
 *
 * - `hasManagedWorktreesDir` — `.claude/worktrees/` exists: this checkout drives managed sessions.
 *   UNTRACKED in git, so a CI checkout or a plain clone is false here and always skips.
 * - `dirtyPaths` — the primary checkout's `git status --porcelain` lines; EMPTY means a clean
 *   lobby, which is legitimate.
 * - `branch` — the primary checkout's branch, reported for orientation; null (detached HEAD) still
 *   fails, it never crashes.
 */
export function evaluateLobby(input: {
  hasManagedWorktreesDir: boolean;
  branch: string | null;
  primaryCheckout: string;
  dirtyPaths: readonly string[];
}): EvaluateLobbyResult {
  if (!input.hasManagedWorktreesDir || input.dirtyPaths.length === 0) {
    return { verdict: "skip", message: "" };
  }
  const shown = input.dirtyPaths.slice(0, DIRTY_PATHS_SHOWN).map((l) => l.trim());
  const rest = input.dirtyPaths.length - shown.length;
  const where = input.branch === null ? "detached HEAD" : `branch ${input.branch}`;
  return {
    verdict: "fail",
    message: [
      `${TAG} FAIL — the PRIMARY CHECKOUT is dirty and no claim can name it (ADR-0245 D5.2).`,
      `  checkout:    ${input.primaryCheckout} (${where})`,
      `  uncommitted: ${input.dirtyPaths.length} path(s) — ${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}`,
      "",
      "The primary checkout is the shared lobby: work there has NO worktree identity, so it cannot",
      "hold a claim, is invisible on the notice board, and can be swept into an unrelated session's",
      "commit or red another session's gate. This is reported from wherever the gate runs — the",
      "subject is the lobby, not your worktree (your own uncommitted work is never counted here).",
      "",
      "If the work IS yours, move it to a managed worktree:",
      '  pnpm storytree worktree create --node <unit-id> --intent "<what>" --pg',
      "",
      "If the work is NOT yours — the common case from a worktree — leave it exactly as it is:",
      "attribution is unprovable from an uncommitted tree, and stashing or committing a stranger's",
      "work destroys it. Steer the owning session instead (`pnpm storytree noticeboard --pg` shows",
      "who is claimed where).",
    ].join("\n"),
  };
}

/**
 * Run a git command from `cwd`, returning trimmed stdout — or null on any failure. git's own stderr
 * is swallowed: every failure here is a SKIP, so letting a `fatal: not a git repository` through
 * would print an alarming line into an otherwise silent, passing gate.
 */
function git(args: readonly string[], cwd?: string): string | null {
  try {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    };
    if (cwd !== undefined) options.cwd = cwd;
    return (execFileSync("git", [...args], options) as string).trim();
  } catch {
    return null;
  }
}

export interface EvaluateLobbyFromGitResult { verdict: "skip" | "fail"; message: string }

/**
 * Gather the lobby facts from git alone (no DB, no network) and decide. Returns "skip" on ANY git
 * failure — a check that cannot read the repo must never invent a red gate.
 *
 * Callable from ANY session: the common git dir resolves to the same place from the primary
 * checkout and from every worktree hanging off it, so the primary checkout is located — and its
 * dirtiness read — identically either way. `cwd` defaults to the process cwd and exists so the
 * tests can point the whole probe at a throwaway fixture repo instead of chdir-ing.
 */
export function evaluateLobbyFromGit(cwd?: string): EvaluateLobbyFromGitResult {
  // Shared across the primary checkout and all its worktrees; its parent IS the primary checkout.
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (commonDir === null) return { verdict: "skip", message: "" };

  const primaryCheckout = path.dirname(commonDir);
  // Run FROM the primary checkout, so this reports that tree alone and never the caller's worktree.
  const porcelain = git(["status", "--porcelain"], primaryCheckout);
  if (porcelain === null) return { verdict: "skip", message: "" };

  const branchRaw = git(["rev-parse", "--abbrev-ref", "HEAD"], primaryCheckout);
  return evaluateLobby({
    hasManagedWorktreesDir: existsSync(path.join(primaryCheckout, ".claude", "worktrees")),
    branch: branchRaw === null || branchRaw === "HEAD" ? null : branchRaw,
    primaryCheckout: primaryCheckout.replaceAll("\\", "/"),
    dirtyPaths: porcelain === "" ? [] : porcelain.split(/\r?\n/).filter((l) => l.trim() !== ""),
  });
}

async function main(): Promise<void> {
  // The lobby question (ADR-0245 D5.2) is pure git: it needs no session identity and no DB, and its
  // subject — the shared primary checkout — is the same one for every session. So it is asked FIRST
  // and UNCONDITIONALLY, ahead of the identity branch and the live read. Scoping it to
  // `identity === null` is what made it miss every worktree session (see the header).
  const lobby = evaluateLobbyFromGit();
  if (lobby.verdict === "fail") {
    console.error(lobby.message);
    process.exitCode = 1;
  }

  const identity = deriveIdentity();
  // Not a session worktree: no claim to check. The lobby arm above has already had its say.
  if (identity === null) return;

  loadLocalSecrets();
  if (presentEnv("STORYTREE_DB_USER") === undefined) {
    console.log(`${TAG} SKIP — no STORYTREE_DB_USER (DB creds absent); claim unverified.`);
    return;
  }

  let handle: Awaited<ReturnType<typeof createPool>> | undefined;
  try {
    handle = await createPool();
    const claims = new PgClaimStore(handle.pool);
    const own = await withTimeout(
      claims.claimsBySession(identity.sessionId),
      LIVE_READ_TIMEOUT_MS,
      "live read",
    );
    const decision = evaluateDeclared({ sessionId: identity.sessionId, claims: own });
    if (decision.verdict === "ok") {
      console.log(decision.message);
    } else {
      console.error(decision.message);
      process.exitCode = 1;
    }
  } catch (err) {
    console.log(
      `${TAG} SKIP — live DB not reachable (${(err as Error).message}); claim unverified, offline gate unaffected.`,
    );
  } finally {
    if (handle) await closePool(handle.pool, handle.connector).catch(() => {});
  }
}

// Run only as an entrypoint — the test imports evaluateDeclared without triggering the live read.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // An UNEXPECTED error is still a SKIP, never a red gate — CI and offline sessions are DB-free.
    console.log(`${TAG} SKIP — unexpected error (${(err as Error).message}); claim unverified.`);
  });
}
