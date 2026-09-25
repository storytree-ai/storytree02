import test from "node:test";
import assert from "node:assert/strict";

import { runDoctor, NODE_MAJOR_FLOOR, type DoctorObservations, type DoctorReport } from "./doctor.js";
import { measureGuidanceSurface } from "./session-cost.js";
import { planRepairs } from "./repair-planner.js";
import { buildEscalationBlob, formatEscalationBlob, redact, escalationCategoryOf, REDACTED } from "./escalation-blob.js";

/**
 * The machine floor for the D6 escalation blob (ADR-0207). The guide generates a secrets-redacted
 * diagnostic blob for the dev to paste to the owner *only* when doctor cannot fix (access revoked,
 * subscription lapsed). Proven here by a red->green sweep over the pure {@link buildEscalationBlob},
 * plus the load-bearing D3 boundary: the blob is structured data that provably carries NO credential —
 * never the contents or path of `~/.claude/.credentials.json`.
 */

/** A fully-healthy environment — every probe PASSes (mirrors repair-planner.test.ts). */
const HEALTHY: DoctorObservations = {
  gitPresent: true,
  nodeMajor: NODE_MAJOR_FLOOR,
  provisioned: true,
  unlinked: false,
  dependencyCurrency: "current",
  remoteReachable: true,
  claudeCliPresent: true,
  claudeLoggedIn: true,
  claudeTokenPresent: false,
  checkoutBehind: 0,
  hostedRead: "ok",
  // The eagerly-loaded guidance surface is empty in this fixture — a determined zero, so the
  // preamble-budget probe reads PASS and stays out of the way of what this suite is about.
  guidanceSurface: measureGuidanceSurface([]),
};

// --- (1) a healthy report needs no escalation ---------------------------------------------------
test("GREEN: a healthy report yields NO escalation (nothing needs the owner)", () => {
  const blob = buildEscalationBlob(runDoctor(HEALTHY));
  assert.equal(blob.needed, false);
  assert.equal(blob.unmet.length, 0);
  assert.equal(blob.environment.length, 0);
  assert.equal(formatEscalationBlob(blob), "No escalation needed — setup is either healthy or self-repairable.");
});

test("a report whose ONLY failures are installer-repairable yields NO escalation (that's the repair loop's job)", () => {
  // git + node + provision missing — all fixable by re-running an installer step, so NOT owner-escalation.
  const blob = buildEscalationBlob(
    runDoctor({ ...HEALTHY, gitPresent: false, nodeMajor: null, provisioned: false, dependencyCurrency: "unknown" }),
  );
  assert.equal(blob.needed, false, "local tooling gaps are self-repairable, never an owner escalation");
  assert.equal(blob.unmet.length, 0);
});

test("offline-but-otherwise-healthy yields NO escalation (undetermined remote is not 'access revoked')", () => {
  const blob = buildEscalationBlob(runDoctor({ ...HEALTHY, remoteReachable: null, checkoutBehind: 3 }));
  assert.equal(blob.needed, false, "offline-undetermined & freshness WARNs are advisory, never escalation");
});

// --- (2) a non-installer-fixable failure escalates, naming the unmet invariants -----------------
test("RED: no logged-in Claude CLI (subscription/identity) escalates to the owner", () => {
  const blob = buildEscalationBlob(runDoctor({ ...HEALTHY, claudeLoggedIn: false }));
  assert.equal(blob.needed, true);
  const login = blob.unmet.find((u) => u.probe === "claude-credential");
  assert.ok(login, "the claude-credential block must be named");
  assert.equal(login.category, "identity");
  assert.ok(login.ownerAction.length > 0);
});

test("RED: a refused remote (GitHub access revoked) escalates to the owner", () => {
  const blob = buildEscalationBlob(runDoctor({ ...HEALTHY, remoteReachable: false }));
  assert.equal(blob.needed, true);
  const access = blob.unmet.find((u) => u.probe === "repo-fetchable");
  assert.ok(access, "the access block must be named");
  assert.equal(access.category, "access");
  // ADR-0622: 0.2 is `storytree-ai/storytree02`; the bare name now belongs to the 0.3 rebuild, so
  // pointing the owner at `storytree-ai/storytree` would send him to check the wrong repo's grant.
  assert.match(access.ownerAction, /storytree-ai\/storytree02\b/);
});

test("the blob carries redacted full environment context and preserves probe order", () => {
  const report = runDoctor({ ...HEALTHY, claudeLoggedIn: false });
  const blob = buildEscalationBlob(report);
  assert.deepEqual(
    blob.environment.map((e) => e.probe),
    report.probes.map((p) => p.name),
    "environment is the full doctor sweep, in order — the owner sees the whole picture",
  );
});

test("triedRepairs carries the installer @steps the dev already re-ran (from the repair plan)", () => {
  // A broken env with BOTH self-repairable failures and an owner-side one.
  const obs: DoctorObservations = {
    ...HEALTHY,
    gitPresent: false,
    provisioned: false,
    dependencyCurrency: "unknown",
    claudeLoggedIn: false,
    claudeTokenPresent: false,
  };
  const report = runDoctor(obs);
  const blob = buildEscalationBlob(report, { plan: planRepairs(report) });
  assert.equal(blob.needed, true);
  assert.ok(blob.triedRepairs.includes("git"), "git is a self-repair the dev tried before escalating");
  assert.ok(blob.triedRepairs.includes("provision"), "provision likewise");
  assert.ok(
    !blob.triedRepairs.includes("claude-credential"),
    "the credential is the escalation, not a self-repair try",
  );
});

test("formatEscalationBlob renders a paste-able, structured escalation", () => {
  const text = formatEscalationBlob(buildEscalationBlob(runDoctor({ ...HEALTHY, claudeLoggedIn: false })));
  assert.match(text, /escalation to owner/i);
  assert.match(text, /Blocked on/);
  assert.match(text, /claude-credential/);
  assert.match(text, /Full setup status/, "the redacted environment is included for context");
});

// --- (3) D3: the blob provably carries NO credential --------------------------------------------
test("D3: redact() strips a credentials path, an sk-ant token, and a long opaque token", () => {
  const home = "C:/Users/dev/.claude/.credentials.json";
  const token = "sk-ant-oat01-AAAABBBBCCCCDDDDEEEEFFFF0000111122223333";
  const opaque = "abcdef0123456789abcdef0123456789abcdef0123456789";
  const cleaned = redact(`path=${home} token=${token} blob=${opaque}`);
  assert.ok(!cleaned.includes(".credentials.json"), "the credentials-file path is redacted");
  assert.ok(!cleaned.includes(token), "an sk-ant token is redacted");
  assert.ok(!cleaned.includes(opaque), "a long opaque token blob is redacted");
  assert.match(cleaned, new RegExp(REDACTED.replace(/[[\]]/g, "\\$&")));
});

test("D3: even if a probe detail LEAKED the credentials path/token, the blob and its text carry neither", () => {
  // Craft a doctor report whose claude-credential detail maliciously embeds the credential file + a token.
  const poisoned: DoctorReport = {
    probes: [
      {
        name: "claude-credential",
        level: "FAIL",
        detail: "token sk-ant-oat01-SECRETSECRETSECRETSECRETSECRETSECRET at ~/.claude/.credentials.json",
        fixHint: "sign in",
      },
    ],
    failing: 1,
    warning: 0,
    passing: 0,
    ok: false,
    scope: "explorer",
  };
  const blob = buildEscalationBlob(poisoned);
  const serialized = JSON.stringify(blob) + "\n" + formatEscalationBlob(blob);
  assert.ok(!serialized.includes(".credentials.json"), "the credentials-file path never survives into the blob (D3)");
  assert.ok(!serialized.includes("sk-ant-oat01-SECRET"), "no credential token survives into the blob (D3)");
});

test("escalationCategoryOf is narrow: PASS/installer-repairable/advisory probes are not escalation", () => {
  const report = runDoctor({ ...HEALTHY, gitPresent: false, remoteReachable: null, checkoutBehind: 5 });
  for (const p of report.probes) {
    if (p.name === "git") assert.equal(escalationCategoryOf(p), null, "a self-repairable FAIL is not escalation");
    if (p.name === "repo-fetchable") assert.equal(escalationCategoryOf(p), null, "offline-undetermined is not 'revoked'");
    if (p.name === "checkout-current") assert.equal(escalationCategoryOf(p), null, "a freshness WARN is not escalation");
  }
});

// --- D4 hosted live read: the second half of the invite ceremony ---------------------------------

test("hosted-read REFUSED escalates as access — the owner's IAP grant, not GitHub", () => {
  const blob = buildEscalationBlob(runDoctor({ ...HEALTHY, hostedRead: "refused" }));
  assert.equal(blob.needed, true, "a refused hosted read is owner-side and must escalate");
  const unmet = blob.unmet.find((u) => u.probe === "hosted-read")!;
  assert.equal(unmet.category, "access");
  // The owner must be sent to the RIGHT console: IAP membership, not the GitHub Read grant.
  assert.match(unmet.ownerAction, /IAP/i);
  assert.doesNotMatch(unmet.ownerAction, /GitHub Read/i);
});

test("hosted-read: unconfigured / unreachable never bother the owner", () => {
  for (const hostedRead of ["unconfigured", "unreachable"] as const) {
    const blob = buildEscalationBlob(runDoctor({ ...HEALTHY, hostedRead }));
    assert.equal(blob.needed, false, `${hostedRead} is not an owner escalation`);
  }
});

test("the two access blocks keep DISTINCT owner actions (repo grant vs IAP grant)", () => {
  const both = buildEscalationBlob(runDoctor({ ...HEALTHY, remoteReachable: false, hostedRead: "refused" }));
  const repo = both.unmet.find((u) => u.probe === "repo-fetchable")!;
  const hosted = both.unmet.find((u) => u.probe === "hosted-read")!;
  assert.equal(repo.category, "access");
  assert.equal(hosted.category, "access");
  assert.notEqual(repo.ownerAction, hosted.ownerAction, "same category, genuinely different remedies");
});
