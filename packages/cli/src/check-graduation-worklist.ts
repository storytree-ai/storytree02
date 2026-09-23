/* gate-check
retired: ADR-0311 D2
sources: [graduation-drain.ts]
*/
// ⚠ UNWIRED — `check:graduation-worklist` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
// invokes this file: it appears in no root `package.json` script, no gate step
// (`gate-order.ts`), and no CI job. Its own unit tests still run under `pnpm -r test`, so they
// stay GREEN while this enforces NOTHING — a passing test here is not evidence that the rule
// below is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding it needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// Best-effort OFFLINE agent-memory graduation nudge (ADR-0095 Decision 7, park-lease-filtered per
// ADR-0202), wired into `pnpm gate`.
//
// The graduation engine is offline — it reads the harness agent-memory dir + the seed snapshot +
// the machine-local park ledger, no DB — so unlike check:corpus-sync this ALWAYS runs (no creds, no
// network). It surfaces, at the pre-merge moment, how many LIVE durable-memory CANDIDATES await a
// librarian pass: only candidates that are NEW (no park record), CHANGED (their content hash broke
// since review), or LEASE-EXPIRED count (ADR-0202 D4 — the WARN is normally zero and meaningful
// when it isn't; parked candidates are silenced while their lease holds, their count surfaced on
// the OK line). It NEVER writes and NEVER fails the gate.
//
//   - memory store present + live candidates  -> WARN naming the new/changed/expired breakdown.
//   - memory store present + zero live        -> OK (naming the parked count).
//   - memory store / seed absent (fresh worktree, CI, web container) -> SKIP.
//
// The judgment stays the librarian-curator's: this only counts candidates, it does not decide which
// are genuinely durable or whether a park verdict holds.
//
// FAIL-CLOSED AT A DRAIN CEILING (added by `verification-integrity-arc` under ADR-0252 D3, in
// ADR-0168 D4's shape). This was WARN-only, exit 0 always — and it is the very queue ADR-0168 cites as
// the evidence that a WARN-backed worklist with no drain OBLIGATION rots ("grew 31→58 in one session
// and drained nothing"). The ceiling itself lives in the pure `graduation-drain.ts`; this shell reads
// disk, injects the clock, and sets the exit code. The OK/WARN levels are UNCHANGED — RED is layered
// above them, so this check is strictly stronger than before and never quieter.
//
// Reachability policy is unchanged and now matters more: every SKIP path below still exits 0, and a
// breach computed against an absent/unreadable park ledger is reported but NOT enforced (fail-closed
// on the queue, fail-open on the substrate).
//
// CHARGED BY AUTHORSHIP (ADR-0301), in TWO halves that do different work and must not be conflated.
// The EXCLUSION drops this session's own just-written memories from the charge — the
// `friction-drain.ts` `isOwnItem` move, so a retro that writes memories cannot trip its own ceiling.
// The REPORT prints the full authorship split on every path with a live queue, charged or not. Only
// the second one addresses the failure that was actually measured: in PR #1124 a verified drain went
// RED again at 7 live within ~15 minutes and ALL SEVEN were siblings', which an own-homework exclusion
// does not suppress by construction. The exclusion closes a real asymmetry with the friction ceiling;
// the printed split turns "are these mine?" from a hand investigation into a line of output. Neither
// makes the queue safe from a concurrent re-fill — that residual is parked, and named in the report.

import { existsSync } from "node:fs";
import os from "node:os";

import {
  classifyWorklist,
  graduationCandidates,
  leaseExpiresOn,
  novelCandidates,
  type LibrarySnapshot,
} from "@storytree/library";

import { currentGitBranch, inFlightBranches } from "./cli-actor.js";
import {
  GRADUATION_NUDGE_TAG as TAG,
  defaultLedgerPath,
  defaultMemoryDir,
  graduationNudge,
  readMemoryDir,
  readParkLedger,
  readLiveSnapshot,
  type MemoryReadResult,
} from "./graduate.js";
import { evaluateGraduationDrain, type GraduationCandidate } from "./graduation-drain.js";

async function main(): Promise<void> {
  const memoryDir = defaultMemoryDir(os.homedir());

  let read: MemoryReadResult;
  try {
    read = readMemoryDir(memoryDir);
  } catch {
    // No harness agent-memory store here (fresh worktree / CI / web container) — nothing to surface.
    console.log(`${TAG} SKIP — no agent-memory store at ${memoryDir}; nothing to surface.`);
    return;
  }

  let snapshot: LibrarySnapshot;
  try {
    snapshot = await readLiveSnapshot();
  } catch (e) {
    // FAIL-OPEN on the SUBSTRATE, exactly as this rung already does for a missing memory store: an
    // unreachable corpus means the worklist is UNVERIFIED, not that the backlog is clear. The
    // ceiling below is fail-closed on the QUEUE; both arms keep their existing shapes.
    console.log(`${TAG} SKIP — could not read the live corpus (${(e as Error).message}); worklist unverified.`);
    return;
  }

  const now = new Date().toISOString().slice(0, 10);
  const novel = novelCandidates(graduationCandidates(read.memories, snapshot, { now }));
  const novelNames = new Set(novel.map((c) => c.source));
  const ledgerPath = defaultLedgerPath(memoryDir);
  const { ledger, problem } = readParkLedger(ledgerPath);
  const worklist = classifyWorklist(
    read.memories.filter((m) => novelNames.has(m.name)),
    ledger,
    { now },
  );
  const nudge = graduationNudge(worklist.counts);
  const emit = nudge.level === "WARN" ? console.warn : console.log;
  for (const line of nudge.lines) emit(line);

  // ---- the drain ceiling (ADR-0168 D4's shape) ------------------------------------------------
  //
  // The ledger is USABLE only when it was both present and parseable. Absent is the normal
  // pre-backfill state and unreadable is surfaced as `problem`; either way every candidate then
  // classifies `new`, which would turn a substrate failure into a queue breach.
  const candidates: GraduationCandidate[] = worklist.entries.map((e) => {
    const record = ledger.parks[e.memory.name];
    const candidate: GraduationCandidate = {
      name: e.memory.name,
      status: e.status,
    };
    if (e.status === "expired" && record !== undefined) {
      candidate.leaseExpiredOn = leaseExpiresOn(record);
    }
    // Provenance (ADR-0301) — absent on every memory written before the stamp existed, and on every
    // one written by a session that does not stamp. Absent is charged, never excused.
    if (e.memory.branch !== undefined) candidate.branch = e.memory.branch;
    return candidate;
  });
  const drain = evaluateGraduationDrain(candidates, {
    currentBranch: currentGitBranch(),
    // ADR-0371 — a LOCAL git ref read, so this check remains offline by contract.
    inFlightBranches: inFlightBranches(now),
    currentDate: now,
    ledgerUsable: problem === undefined && existsSync(ledgerPath),
  });

  // THE AUTHORSHIP SPLIT, PRINTED ON EVERY PATH THAT HAS A LIVE QUEUE — including the ones that do not
  // red (ADR-0301). This is the half of the change that actually removes measured cost. The #1124
  // drain session's question was "are these mine?", and answering it took a hand investigation; the
  // exclusion cannot answer it, because by construction it only ever suppresses the candidates that
  // were never the problem. Printing it does. A count of siblings is deliberately NOT an excuse — they
  // are charged, and the line says so — but a session reading a red now knows what it is looking at.
  if (drain.liveCount > 0) {
    const stamped = drain.ownCount + drain.siblingCount;
    console.warn(
      `${TAG}   authorship: ${drain.ownCount} yours (not charged), ${drain.inFlightCount} other sessions ` +
        `still in flight (not charged), ${drain.siblingCount - drain.inFlightCount} other sessions' merged, ` +
        `${drain.unattributedCount} unstamped — ${drain.chargedCount} of ${drain.liveCount} charged against N=${drain.config.liveCeiling}.` +
        (stamped === 0
          ? " No memory on this machine carries a `metadata.branch` stamp yet, so nothing is excluded" +
            " — the stamp only exists going forward (ADR-0301)."
          : ""),
    );
    // NAMED RATHER THAN GLOSSED: the queue is machine-shared (ADR-0202) and a sibling's write lands in
    // it mid-session, so a drain this session verifies can be undone by another before it merges. The
    // exclusion above does NOT fix that — measured in PR #1124, where all 7 candidates that re-reddened
    // a verified drain within 15 minutes were siblings', which an own-homework exclusion never
    // suppresses. That residual is parked on `verification-integrity-arc`, not silently carried.
    if (drain.siblingCount > 0) {
      console.warn(
        `${TAG}   (Another session's memory is charged once its BRANCH HAS MERGED — the drain is a ` +
          "librarian pass over the whole queue, which any session may run; unlike an export it commits " +
          "nothing under your name. While that branch is still in flight the memory is not yet anyone's " +
          "obligation and is excluded (ADR-0371), so a verified drain can no longer be undone by a " +
          "sibling session writing between your drain and your merge.)",
      );
    }
  }

  // An existing-but-invalid ledger is treated as EMPTY (everything shows live) — surfaced, never
  // silent (ADR-0095), but still advisory: the librarian fixes the ledger, the gate never reds.
  if (problem !== undefined) {
    console.warn(`${TAG}   (park ledger unreadable — treated as empty: ${problem})`);
  }
  // Surface unparseable memory files too — honesty over a silent drop (ADR-0095) — but never fail.
  // These are DROPPED from the worklist, so they can only ever under-count the backlog: an
  // unparseable memory file can never push the ceiling over.
  if (read.unparseable.length > 0) {
    console.warn(`${TAG}   (${read.unparseable.length} memory file(s) unparseable — see \`storytree library graduate --review\`.)`);
  }

  // A breach the ledger could not support is REPORTED, never enforced and never dropped.
  if (drain.suppressed !== undefined) {
    console.warn(`${TAG}   (drain ceiling not enforced — ${drain.suppressed}.)`);
    for (const b of drain.breaches) console.warn(`${TAG}     would breach: ${b}`);
    return;
  }

  if (drain.level !== "red") return;

  console.error(
    `${TAG} RED — graduation drain ceiling breached: ${drain.chargedCount} charged of ${drain.liveCount} live ` +
      `(${drain.newCount} new, ${drain.changedCount} changed, ${drain.expiredCount} lease-expired) · ` +
      `${drain.parkedCount} parked.`,
  );
  for (const b of drain.breaches) console.error(`${TAG}   ${b}`);
  console.error(
    `${TAG}   Landing is blocked until the pre-merge LIBRARIAN PASS drains this queue (ADR-0095 D7 /`,
  );
  console.error(
    `${TAG}   ADR-0168 D4): \`pnpm storytree library graduate --review\`, then spawn the`,
  );
  console.error(
    `${TAG}   librarian-curator — graduate the genuinely durable, PARK the keepers with a reason`,
  );
  console.error(
    `${TAG}   (\`storytree library graduate park <name> --reason "…"\`), clearing the backlog below`,
  );
  console.error(
    `${TAG}   N=${drain.config.liveCeiling} / M=${drain.config.overdueCeilingDays}d.`,
  );
  console.error(
    `${TAG}   (Queue hygiene only — this never decides what graduates. Machine-local; CI SKIPs it.)`,
  );
  // FAIL-CLOSED: only a genuine ceiling breach against a usable ledger sets a non-zero exit.
  process.exitCode = 1;
}

// `await`ed via .catch rather than a bare try/catch: `main` is async since it reads the live corpus
// (ADR-0302 D1), so a synchronous try would no longer see a rejection and the advisory-only posture
// below would silently become an unhandled rejection.
main().catch((err: unknown) => {
  // Even an unexpected error is advisory only — never fail the gate on the graduation nudge.
  console.log(`${TAG} SKIP — unexpected error (${(err as Error).message}); worklist unverified.`);
});
