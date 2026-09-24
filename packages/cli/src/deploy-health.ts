// ⚠ UNWIRED — part of retired `check:deploy-health`, which ADR-0311 D2 removed from the gate on
// 2026-08-05. This module is the signal classifier; its entrypoint `check-deploy-health.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
export interface DeployRun {
  status: string; // "completed" | "in_progress" | "queued" | ...
  conclusion: string | null; // "success" | "failure" | "cancelled" | ... ; null/"" while running
  updatedAt: string; // ISO timestamp
  url: string;
  databaseId?: number;
}

export interface DeployHealth {
  verdict: "ok" | "red" | "unknown";
  streak: number; // consecutive completed non-success runs from the newest completed backward (0 unless red)
  redSince: string | null; // updatedAt of the OLDEST run in that red streak
  latestRedUrl: string | null; // URL of the NEWEST red run
  lastGreenAt: string | null; // updatedAt of the newest completed success anywhere in the page, else null
  inFlight: boolean; // true when a non-completed run is newer than the newest completed one
}

function isCompleted(run: DeployRun): boolean {
  return run.status === "completed";
}

function isSuccess(run: DeployRun): boolean {
  return isCompleted(run) && run.conclusion === "success";
}

export function classifyDeployHealth(runs: DeployRun[]): DeployHealth {
  const newestCompletedIndex = runs.findIndex((run) => isCompleted(run));

  // Newest completed success anywhere in the page (independent of streak position).
  let lastGreenAt: string | null = null;
  for (const run of runs) {
    if (isSuccess(run)) {
      lastGreenAt = run.updatedAt;
      break;
    }
  }

  if (newestCompletedIndex === -1) {
    return {
      verdict: "unknown",
      streak: 0,
      redSince: null,
      latestRedUrl: null,
      lastGreenAt: null,
      inFlight: false,
    };
  }

  const newestCompleted = runs[newestCompletedIndex]!;
  const inFlight = newestCompletedIndex > 0;

  if (isSuccess(newestCompleted)) {
    return {
      verdict: "ok",
      streak: 0,
      redSince: null,
      latestRedUrl: null,
      lastGreenAt,
      inFlight,
    };
  }

  // Red: count consecutive completed non-success runs from the newest completed backward,
  // stopping at the first completed success (in-flight runs before the newest completed one
  // are skipped since we start scanning from newestCompletedIndex).
  let streak = 0;
  let redSinceRun: DeployRun = newestCompleted;
  for (let i = newestCompletedIndex; i < runs.length; i++) {
    const run = runs[i]!;
    if (!isCompleted(run)) {
      continue;
    }
    if (isSuccess(run)) {
      break;
    }
    streak += 1;
    redSinceRun = run;
  }

  return {
    verdict: "red",
    streak,
    redSince: redSinceRun.updatedAt,
    latestRedUrl: newestCompleted.url,
    lastGreenAt,
    inFlight,
  };
}

export function formatDeployHealth(health: DeployHealth): string[] {
  const prefix = "[check:deploy-health]";

  if (health.verdict === "unknown") {
    return [
      `${prefix} deploy health is UNVERIFIED — no completed deploy-studio CD run was found on the newest-first page.`,
    ];
  }

  if (health.verdict === "ok") {
    const inFlightNote = health.inFlight ? " (an in-flight deploy is running above it)" : "";
    return [
      `${prefix} OK — last green deploy at ${health.lastGreenAt}${inFlightNote}.`,
    ];
  }

  // red
  const lastGreen = health.lastGreenAt ?? "unknown";
  return [
    `${prefix} WARN — deploy-studio CD is RED: ${health.streak} consecutive non-success run(s), red since ${health.redSince}.`,
    `${prefix} Newest red run: ${health.latestRedUrl}`,
    `${prefix} Consequence: the hosted studio is serving the image from the last green deploy (${lastGreen}).`,
    `${prefix} Forensics: run \`gh run view <id> --log-failed\` against ${health.latestRedUrl} to diagnose.`,
  ];
}
