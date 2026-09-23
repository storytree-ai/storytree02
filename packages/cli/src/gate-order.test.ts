import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_CODE_COLLAPSING_INVOCATION,
  EXPENSIVE_STEPS,
  GATE_AUTHORITY_PHRASES,
  GATE_PLAN,
  GATE_VOICE_EXEMPTIONS,
  GATE_VOICE_SCAN_ROOTS,
  type GateStep,
  LIVE_STORE_READING_CHECKS,
  LOAD_BEARING_MARKER,
  NON_GATE_CHECK_SCRIPTS,
  PRE_EXPENSIVE_CHECKS,
  RETIRED_CHECKS,
  RETIRED_TEST_COMPANIONS,
  SHARED_ENVIRONMENT_CHECKS,
  SKIP_CAPABLE_CHECKS,
  UNWIRED_MARKER,
  ciIdentityFor,
  companionFileFor,
  evaluateGateOrder,
  findGateVoice,
  firstExpensiveIndex,
  gateVoiceKey,
  lastExpensiveIndex,
  readsLiveStore,
  stepsFor,
} from "./gate-order.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliSrc = fileURLToPath(new URL(".", import.meta.url));

/** The REAL root scripts — a missing `gate` script is a failure, never a skip. */
function rootScripts(): Record<string, string> {
  const raw: unknown = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const scripts = (raw as { scripts?: Record<string, string> }).scripts;
  assert.ok(scripts !== undefined, "the root package.json must declare scripts");
  assert.equal(typeof scripts["gate"], "string", "the root package.json must declare a `gate` script");
  return scripts;
}

/** Terse fixture builder for the evaluator's unit tests. */
function chain(spec: string): GateStep[] {
  return spec
    .split("&&")
    .map((raw) => raw.trim())
    .filter((command) => command !== "")
    .map((command) => {
      const name = /\bpnpm\s+(check:[\w-]+)/.exec(command)?.[1];
      return { command, check: name ?? undefined };
    });
}

// ── the walls ────────────────────────────────────────────────────────────────

test("firstExpensiveIndex finds the earliest minutes-cost leg, lastExpensiveIndex the latest", () => {
  const steps = chain("pnpm check:boundaries && pnpm -r typecheck && pnpm -r test && pnpm check:late");
  assert.equal(firstExpensiveIndex(steps), 1);
  assert.equal(lastExpensiveIndex(steps), 2);
});

// ── axis 1: cheap-first ──────────────────────────────────────────────────────

test("evaluateGateOrder passes a plan whose cheap checks all precede the expensive legs", () => {
  const v = evaluateGateOrder({
    steps: chain("pnpm check:boundaries && pnpm -r typecheck && pnpm -r test && pnpm check:late"),
    earlyChecks: new Set(["check:boundaries"]),
  });
  assert.equal(v.verdict, "ok");
  assert.deepEqual(v.misordered, []);
});

test("evaluateGateOrder FAILS a cheap check stranded behind the expensive legs, naming the fix", () => {
  const v = evaluateGateOrder({
    steps: chain("pnpm check:boundaries && pnpm -r typecheck && pnpm -r test && pnpm check:agents"),
    earlyChecks: new Set(["check:boundaries", "check:agents"]),
  });
  assert.equal(v.verdict, "fail");
  assert.deepEqual(v.misordered, ["check:agents"]);
  assert.match(v.message, /run AFTER/);
  assert.match(v.message, /GATE_PLAN/);
});

// ── axis 2: the session's own work before the shared environment ─────────────

test("evaluateGateOrder FAILS a shared-environment check that runs before the expensive legs", () => {
  // The axis-2 regression: a check that can red on a sibling's state, ahead of the session's own answer.
  const v = evaluateGateOrder({
    steps: chain("pnpm check:verification-decay && pnpm -r typecheck && pnpm -r test"),
    earlyChecks: new Set<string>(),
    lateChecks: new Set(["check:verification-decay"]),
  });
  assert.equal(v.verdict, "fail");
  assert.deepEqual(v.premature, ["check:verification-decay"]);
  assert.match(v.message, /may be a sibling session's/);
});

test("evaluateGateOrder measures axis 2 against the LAST expensive leg, not the first", () => {
  // Between typecheck and test is still ahead of the session's own answer.
  const v = evaluateGateOrder({
    steps: chain("pnpm -r typecheck && pnpm check:verification-decay && pnpm -r test"),
    earlyChecks: new Set<string>(),
    lateChecks: new Set(["check:verification-decay"]),
  });
  assert.equal(v.verdict, "fail");
  assert.deepEqual(v.premature, ["check:verification-decay"]);
});

// ── fail-closed ──────────────────────────────────────────────────────────────

test("evaluateGateOrder fails CLOSED on a plan with no recognised expensive leg", () => {
  // "nothing is on the wrong side of the wall" is vacuously true when the wall was never found.
  const v = evaluateGateOrder({
    steps: chain("pnpm check:boundaries && pnpm check:verification-decay"),
    earlyChecks: new Set(["check:boundaries"]),
  });
  assert.equal(v.verdict, "fail");
  assert.match(v.message, /expensive legs were not recognised/);
});

test("evaluateGateOrder fails CLOSED on a declared check the plan no longer runs — either set", () => {
  const early = evaluateGateOrder({
    steps: chain("pnpm -r typecheck && pnpm -r test"),
    earlyChecks: new Set(["check:boundaries"]),
  });
  assert.equal(early.verdict, "fail");
  assert.deepEqual(early.missing, ["check:boundaries"]);
  assert.match(early.message, /not in the plan at all/);

  const late = evaluateGateOrder({
    steps: chain("pnpm -r typecheck && pnpm -r test"),
    earlyChecks: new Set<string>(),
    lateChecks: new Set(["check:verification-decay"]),
  });
  assert.equal(late.verdict, "fail");
  assert.deepEqual(late.missing, ["check:verification-decay"]);
});

// ── the REAL plan ────────────────────────────────────────────────────────────

test("the REAL gate plan honours BOTH ordering axes", () => {
  const v = evaluateGateOrder({
    steps: GATE_PLAN,
    earlyChecks: PRE_EXPENSIVE_CHECKS,
    lateChecks: SHARED_ENVIRONMENT_CHECKS,
  });
  assert.equal(v.verdict, "ok", v.message);
});

test("the REAL gate plan still runs both expensive legs (the wall the axes are measured against)", () => {
  for (const leg of EXPENSIVE_STEPS) {
    assert.ok(
      GATE_PLAN.some((s) => s.command.includes(leg)),
      `the gate plan must still run \`${leg}\``,
    );
  }
});

test("the REAL gate plan is exactly the nine ADR-0311 survivors plus the ADR-0336, ADR-0454, ADR-0223, ADR-0317, ADR-0403, ADR-0445, ADR-0458, ADR-0459, ADR-0556, ADR-0606, ground-space, land-art, palette-transcription, desktop-route-coverage, reliability-gate-parity, control-bytes and anti-slop additions, in order", () => {
  assert.deepEqual(
    GATE_PLAN.map((step) => step.command),
    [
      // `pnpm lint` leads block A: it is the cheapest step in the gate (2.7 s over the whole repo,
      // measured) and it is what stops the anti-slop ratchet slipping back — twenty fresh
      // violations of already-adopted rules reached `main` in the two days before it existed
      // (anti-slop-adoption-arc inc-07).
      "pnpm lint",
      // Added 2026-09-22 alongside `pnpm lint`, and for the same shape of reason: a whole-repo text
      // property, sub-second, that no reader can enforce by looking. A heredoc-written control byte
      // is invisible to tsc, oxlint, grep, `git diff` and the Read tool alike — it had already made
      // one assertion unfalsifiable in `land-sand.test.ts` and put a raw NUL in a harness source
      // that grep could not even list.
      "pnpm check:control-bytes",
      // ADR-0556 D4, added 2026-09-15 (`repo-manifest-aggregate-leaves-git`): the fragment tree is the
      // manifest's only bytes once the aggregate left Git. It runs before the three rungs that read the
      // composed manifest, so a refused set is named once, under the manifest's own name.
      "pnpm check:manifest-fragments",
      "pnpm check:boundaries",
      "pnpm check:ownership-totality",
      // The ADR-0445 D1 camp fence, added 2026-08-26: offline, disk-only and this branch's to fix,
      // so it sits with its two declared-ownership neighbours rather than beside the store-reading
      // `check:hierarchy-drift` it shares an arc with.
      "pnpm check:hierarchy-camps",
      // ADR-0544 D5, added 2026-09-08: `.gcloudignore` must repeat every credential- or
      // runtime-state-shaped line in `.gitignore`, because it BYPASSES `.gitignore` and the studio
      // Dockerfile is `COPY . .`. Two file reads and this branch's to fix, so it sits with its
      // offline, disk-only neighbours rather than near the deploy it protects — the point is to fire
      // on the branch that introduces the drift, not when the image is already published.
      "pnpm check:gcloudignore-mirror",
      // The ADR-0459 contract-line grammar, added 2026-08-27: disk-and-git only and charged strictly
      // to this branch's own added/edited contracts, so it belongs with its `check:ownership-totality`
      // neighbour, whose `chooseBaseRef` anchor it reuses.
      "pnpm check:contract-grammar",
      // `declared-reliability-gate-is-run-by-a-rung` (verification-integrity-arc), added
      // 2026-09-22: a story's declared `## Reliability Gates` command, held to something that
      // actually runs it. Disk-only and no git, so it sits with its offline neighbours; it is on
      // the CI wall as well as in the gate, because the escape it catches is CI-shaped — 3ea9c3cc
      // retired a pane, updated every unit test it broke, and left the `studio` UAT journey red
      // precisely because nothing runs it.
      "pnpm check:reliability-gate-parity",
      "pnpm check:mirror-conformance",
      // The ABSENCE half of the line above (`traversal-panel-arc`, increment
      // `desktop-route-coverage-is-unasked`, 2026-08-29): conformance compares the payloads of
      // routes the desktop ALREADY serves, so a route it never mirrored has no payload to be
      // unequal and the rung is vacuously green on it. Placed immediately after its neighbour
      // because it completes that neighbour's question and costs the same order of nothing.
      "pnpm check:desktop-route-coverage",
      "pnpm check:web-engine",
      "pnpm check:web-experience-closure",
      // ADR-0454, added 2026-08-26: the marker-presence third of the retired check:web-experience,
      // narrowing ADR-0336 D2 on the corrected premise that it needs no network fetch either.
      "pnpm check:web-experience-markers",
      // `ground-space-truth-arc-inc-01`, added 2026-08-27: the ADR-0367 screen-space-distance guard.
      // Last in block A because it belongs with the `check:web-*` family — it is the only other rung
      // that reads `web/src`, and `web/src` is where the instance that survived PR #1356 lived. It
      // is NOT skip-capable, unlike its three neighbours: the parent's own surfaces are always
      // scannable, so an absent submodule narrows what it covers rather than excusing the run.
      "pnpm check:ground-space",
      // The art rung. ADR-0418 D4's replacement for the lifted palette fence existed and was
      // mutation-tested (PR #1673) but no build ever ran it, so nothing could red for the art
      // being wrong. Browser-backed, but SwiftShader-only and ~29 s, so it sits in block A with
      // the other own-work checks rather than beside the two expensive legs.
      "pnpm check:land-art",
      // The palette guard runs beside its `check:land-art` neighbour and for the same reason:
      // both defend what the map REPORTS rather than how it looks. This one is the cheaper and
      // the wider — pure fs reads over the three copies of the status vocabulary, and it is the
      // only step that can see a retune of `apps/studio/src/index.css` at all, since that package
      // does not depend on the one whose tests would otherwise catch it.
      "pnpm check:palette-transcription",
      "pnpm -r --no-bail typecheck",
      "pnpm -r --no-bail test",
      // ADR-0458's diff-scoped mutation rung. Own-work, but the third MINUTES-cost leg, and placed
      // after `test` on purpose: mutation results gathered over a red suite describe the breakage,
      // not the strength of the tests, so running it before the suite is green would produce a
      // confident answer to a question nobody asked.
      "pnpm check:mutation-diff",
      // ADR-0606, added 2026-09-23: the studio build, which CI ran as its own workflow step and the
      // local gate never did. It is in the ONE plan now, placed `runs: "ci"`, in the slot it held in
      // `ci.yml` — after the mutation rung and ahead of the shared environment.
      "pnpm -r build",
      // Both of these read the DECISION LOG, which is shared live state since ADR-0403 dec 1, so both
      // sit in block C. `check:adr-health` is an ADDITION to the plan and a MOVE overall (it was a
      // case inside `pnpm -r test`); `check:web-grounding` did not move in or out of the plan — its
      // SUBJECT moved, from files in this diff to a shared store, and its position followed.
      "pnpm check:web-grounding",
      "pnpm check:adr-health",
      "pnpm check:guidance",
      "pnpm check:agents",
      "pnpm check:verification-decay",
      "pnpm check:library-dag-acyclic",
      // ADR-0468 D5, added 2026-08-28: the `definition` tier's adjudication rung. Beside its
      // acyclicity neighbour and for the same reason — the tier it judges is live state, so any
      // session's artifact edit can red a branch that touched no corpus.
      "pnpm check:definition-adjudication",
      // ADR-0496 D1/D2, added 2026-09-01: the LIVE half of the mirror harness — the same instrument
      // its block-A sibling runs, over a snapshot of the real `events.node_claim` ledger instead of
      // a fixture. Down here because a sibling's landing moves that ledger, which is what makes it
      // shared-environment; splitting it out is what keeps the nine fixture rows in block A.
      "pnpm check:mirror-conformance-live",
      // ADR-0445 D1 (`map-freshness-arc` inc-02): the live store's mirror of `stories/**` is
      // regenerated by whichever PR last merged, so it is shared state exactly like the two
      // projection checks above — a sibling's landing can move it under this branch.
      "pnpm check:hierarchy-drift",
      // ADR-0560 D3/D4: a changed existing criterion revision must carry an exact current signed
      // pass. Its candidate hierarchy belongs to this branch, but its verdict stream is shared live
      // state, so it sits beside the mirror check in block C.
      "pnpm check:uat-revision-continuity",
    ],
  );
});

test("every step DECLARES a subject, and the declaration matches the order axis 2 asserts", () => {
  // AXIS 2 is stated in this module's header as a fact about the plan, and each step's `subject` is
  // the plan's own record of which side of it that step is on. Nothing else reads the field, so
  // without this the two can disagree — a step could sit in block A carrying `shared-environment`,
  // or carry no subject at all, and the header would go on describing a partition that had stopped
  // being true. This holds the declared subject to the position.
  const subjects = GATE_PLAN.map((s) => s.subject);
  for (const [i, subject] of subjects.entries()) {
    assert.ok(
      subject === "own-work" || subject === "shared-environment",
      `step ${i + 1} (${GATE_PLAN[i]?.command}) declares no recognised subject: ${JSON.stringify(subject)}`,
    );
  }
  const lastOwnWork = subjects.lastIndexOf("own-work");
  const firstShared = subjects.indexOf("shared-environment");
  assert.ok(firstShared > lastOwnWork, "every own-work step must precede every shared-environment one");
  // …and both sides are non-empty, so the assertion above is not satisfied by a plan that lost one.
  assert.ok(lastOwnWork >= 0 && firstShared >= 0);
  // Every step also says WHY, in a sentence — the field exists so a subject call is auditable
  // rather than asserted, and an empty one turns the classification back into a bare claim.
  for (const step of GATE_PLAN) {
    assert.ok(step.why.trim().length > 20, `step \`${step.command}\` gives no reason for its subject`);
  }
});

test("the ten live/shared checks are pinned LATE", () => {
  for (const check of [
    // Both of these are shared-environment for the same reason as their neighbours: another
    // session's `adr new` or status flip can red them, so neither may run ahead of this branch's
    // own work (ADR-0311's ordering axis).
    "check:web-grounding",
    "check:adr-health",
    "check:guidance",
    "check:agents",
    "check:verification-decay",
    "check:library-dag-acyclic",
    "check:definition-adjudication",
    "check:mirror-conformance-live",
    "check:hierarchy-drift",
    "check:uat-revision-continuity",
  ]) {
    assert.ok(SHARED_ENVIRONMENT_CHECKS.has(check));
    assert.ok(!PRE_EXPENSIVE_CHECKS.has(check));
    const at = GATE_PLAN.findIndex((s) => s.check === check);
    assert.notEqual(at, -1, `the gate plan must still run ${check}`);
    assert.ok(at > lastExpensiveIndex(GATE_PLAN), `${check} must run after the expensive legs`);
  }
});

test("the two ordering sets are disjoint — no check may be pinned both early and late", () => {
  const both = [...PRE_EXPENSIVE_CHECKS].filter((n) => SHARED_ENVIRONMENT_CHECKS.has(n));
  assert.deepEqual(both, [], "a check pinned to both sides makes the invariant unsatisfiable");
});

test("every step in the plan carries a subject, a cost, and a stated reason", () => {
  for (const step of GATE_PLAN) {
    assert.ok(step.why.length > 0, `${step.command} must record WHY it is ${step.subject}`);
    assert.equal(
      step.cost,
      EXPENSIVE_STEPS.some((leg) => step.command.includes(leg)) ? "minutes" : "seconds",
      `${step.command}: declared cost must match whether it is an expensive leg`,
    );
  }
});

test("the mutation rung is declared own-work and minutes-cost, past the expensive wall", () => {
  // It is the one check in neither pinned set: own-work (only this branch's diff can red it) but
  // AFTER the expensive legs, so its subject and cost have to be asserted directly.
  const step = GATE_PLAN.find((s) => s.check === "check:mutation-diff");
  assert.ok(step !== undefined, "the plan must run check:mutation-diff");
  assert.equal(step.subject, "own-work");
  assert.equal(step.cost, "minutes");
  assert.equal(PRE_EXPENSIVE_CHECKS.has("check:mutation-diff"), false);
  assert.equal(SHARED_ENVIRONMENT_CHECKS.has("check:mutation-diff"), false);
  assert.ok(SKIP_CAPABLE_CHECKS.has("check:mutation-diff"), "it declares a skip and must say so");
});

test("the plan's subject classification agrees with the two pinned sets", () => {
  for (const step of GATE_PLAN) {
    if (step.check === undefined) continue;
    if (SHARED_ENVIRONMENT_CHECKS.has(step.check)) {
      assert.equal(step.subject, "shared-environment", `${step.check} is pinned late`);
    } else if (PRE_EXPENSIVE_CHECKS.has(step.check)) {
      assert.equal(step.subject, "own-work", `${step.check} is pinned cheap-first`);
    }
  }
});

// ── where each step runs, and as whom (ADR-0606 D3/D4) ───────────────────────
//
// ONE list drives both runs now: `pnpm gate` walks `both` + `local`, `pnpm gate --ci` (the CI
// `verify` job) walks `both` + `ci`. There is no second list to hold this one to, so the placements
// themselves are pinned — a step moving sides is then a visible, reasoned edit here, which is the
// whole of what ADR-0486's two-list parity check used to buy, at the cost of one literal instead of
// two lists and a comparator. (ADR-0606 D1's discovery step replaces even this literal.)

test("every step declares where it runs, with no default to fall back on", () => {
  for (const step of GATE_PLAN) {
    assert.ok(
      step.runs === "both" || step.runs === "local" || step.runs === "ci",
      `\`${step.command}\` declares no recognised placement: ${JSON.stringify(step.runs)}`,
    );
  }
});

test("the local-only and CI-only steps are exactly the ones decided, and everything else runs on both", () => {
  const placed = (runs: string): string[] =>
    GATE_PLAN.filter((s) => s.runs === runs).map((s) => s.command);
  // LOCAL — session discipline, never a merge barrier (ADR-0252 D3 for the decay ceiling; ADR-0486
  // D2(b)'s class for the other two, which ADR-0606 D8 leaves where they are).
  assert.deepEqual(placed("local"), [
    "pnpm check:desktop-route-coverage",
    "pnpm check:verification-decay",
    "pnpm check:definition-adjudication",
  ]);
  // CI — environmental: only CI's clean checkout is asked to prove the studio build.
  assert.deepEqual(placed("ci"), ["pnpm -r build"]);
  assert.equal(placed("both").length, GATE_PLAN.length - 4);
});

test("a local run walks both + local and a CI run walks both + ci, each in plan order", () => {
  const local = stepsFor(GATE_PLAN, "local").map((s) => s.command);
  const ci = stepsFor(GATE_PLAN, "ci").map((s) => s.command);
  assert.deepEqual(
    local,
    GATE_PLAN.filter((s) => s.runs !== "ci").map((s) => s.command),
    "the local run is the plan minus its CI-only steps, order untouched",
  );
  assert.deepEqual(
    ci,
    GATE_PLAN.filter((s) => s.runs !== "local").map((s) => s.command),
    "the CI run is the plan minus its local-only steps, order untouched",
  );
  assert.ok(!local.includes("pnpm -r build"));
  assert.ok(ci.includes("pnpm -r build"));
  assert.ok(local.includes("pnpm check:verification-decay"));
  assert.ok(!ci.includes("pnpm check:verification-decay"));
});

test("stepsFor keeps `both` on both sides and never reorders", () => {
  const plan = [
    { id: 1, runs: "ci" },
    { id: 2, runs: "both" },
    { id: 3, runs: "local" },
    { id: 4, runs: "both" },
  ] as const;
  assert.deepEqual(stepsFor(plan, "local").map((s) => s.id), [2, 3, 4]);
  assert.deepEqual(stepsFor(plan, "ci").map((s) => s.id), [1, 2, 4]);
});

test("the ordering invariant holds on each side's run, not only on the whole plan", () => {
  // `gate-run.ts` judges the WHOLE plan (the declared sets name steps from both sides) and then
  // filters it. That is only sound if filtering cannot break the order — checked here by judging
  // each side's run against the sets narrowed to the steps that side actually runs.
  for (const mode of ["local", "ci"] as const) {
    const run = stepsFor(GATE_PLAN, mode);
    const runs = new Set(run.map((s) => s.check).filter((c) => c !== undefined));
    const v = evaluateGateOrder({
      steps: run,
      earlyChecks: new Set([...PRE_EXPENSIVE_CHECKS].filter((c) => runs.has(c))),
      lateChecks: new Set([...SHARED_ENVIRONMENT_CHECKS].filter((c) => runs.has(c))),
    });
    assert.equal(v.verdict, "ok", `${mode}: ${v.message}`);
  }
});

test("every store-reading step signs in in CI, and the verdict-history reader signs in as itself (ADR-0560)", () => {
  for (const step of stepsFor(GATE_PLAN, "ci")) {
    const identity = ciIdentityFor(step);
    if (step.check === "check:uat-revision-continuity") {
      assert.equal(identity, "ci-webverdict", "ADR-0560's split: presence cannot read verdict history");
    } else if (readsLiveStore(step)) {
      assert.equal(identity, "ci-presence", `${step.command} reads the store, so it needs the presence identity`);
    } else {
      assert.equal(identity, undefined, `${step.command} reads no store and must run with NO credential`);
    }
  }
});

test("an identity is DECLARED only to override, and only on a step that reads the store", () => {
  // The derived default already covers every store reader; a declaration on any other step would
  // hand a credential to a step whose verdict needs none.
  const declared = GATE_PLAN.filter((s) => s.ciIdentity !== undefined);
  assert.deepEqual(declared.map((s) => s.check), ["check:uat-revision-continuity"]);
  for (const step of declared) {
    assert.ok(step.check !== undefined && LIVE_STORE_READING_CHECKS.has(step.check), `${step.command}`);
  }
});

test("ciIdentityFor: an override wins, a store reader defaults to presence, anything else gets none", () => {
  assert.equal(
    ciIdentityFor({ command: "pnpm check:adr-health", check: "check:adr-health", ciIdentity: "ci-webverdict" }),
    "ci-webverdict",
  );
  assert.equal(ciIdentityFor({ command: "pnpm check:adr-health", check: "check:adr-health" }), "ci-presence");
  assert.equal(ciIdentityFor({ command: "pnpm check:boundaries", check: "check:boundaries" }), undefined);
  assert.equal(ciIdentityFor({ command: "pnpm -r build", check: undefined }), undefined);
});

// ── the plan vs. the real package.json ───────────────────────────────────────

test("every step the plan names is a script the root package.json actually declares", () => {
  const scripts = rootScripts();
  for (const step of GATE_PLAN) {
    if (step.check === undefined) continue;
    assert.ok(
      Object.hasOwn(scripts, step.check),
      `GATE_PLAN runs \`${step.check}\`, which the root package.json does not declare`,
    );
  }
});

test("every check:* script the repo declares is IN the plan, or excluded with a reason", () => {
  // THE LOAD-BEARING ONE. Without it, adding a check to package.json and forgetting the plan makes
  // the gate silently never run it — a new instance of the exact defect class this arc guards
  // (`asset:unrun-check-is-unverified-not-refuted`). A silent skip must be impossible to introduce.
  const planned = new Set(GATE_PLAN.map((s) => s.check).filter((c) => c !== undefined));
  const unplanned = Object.keys(rootScripts())
    .filter((name) => name.startsWith("check:"))
    .filter((name) => !planned.has(name) && !NON_GATE_CHECK_SCRIPTS.has(name));

  assert.deepEqual(
    unplanned,
    [],
    `these check:* scripts exist but the gate never runs them: ${unplanned.join(", ")}. ` +
      `Add each to GATE_PLAN, or to NON_GATE_CHECK_SCRIPTS with the reason it is deliberately out.`,
  );
});

test("every deliberate exclusion still names a real script — a stale exemption is removed, not kept", () => {
  const scripts = rootScripts();
  for (const [name, reason] of NON_GATE_CHECK_SCRIPTS) {
    assert.ok(Object.hasOwn(scripts, name), `NON_GATE_CHECK_SCRIPTS excludes \`${name}\`, which no longer exists`);
    assert.ok(reason.length > 0, `${name} must record why it is out of the gate`);
  }
});

// ── the skip protocol vs. the invocation form that silently destroys it ──────

test("every skip-capable check is invoked through a form that PRESERVES its exit code", () => {
  // MEASURED 2026-08-08: `pnpm --filter <pkg> exec node -e "process.exit(3)"` exits 1, while
  // `pnpm -C <dir> exec …` exits 3. pnpm's recursive exec normalises any non-zero child code, so a
  // skip-capable check on that form would deliver its declared SKIP to the runner as a FAILURE and
  // red the gate for every checkout that legitimately opts out. Harmless for the other checks (they
  // only ever mean pass or fail); silently destructive for these.
  const scripts = rootScripts();
  for (const [name] of SKIP_CAPABLE_CHECKS) {
    const script = scripts[name] ?? "";
    assert.ok(script.length > 0, `SKIP_CAPABLE_CHECKS names \`${name}\`, which no longer exists`);
    assert.ok(
      !script.includes(EXIT_CODE_COLLAPSING_INVOCATION),
      `\`${name}\` may declare a SKIP, but is invoked via \`${EXIT_CODE_COLLAPSING_INVOCATION}\`, ` +
        `which collapses its exit code to 1 — the skip would arrive as a FAILURE. ` +
        `Use \`pnpm -C <dir> exec …\`. Script: ${script}`,
    );
  }
});

test("a skip-capable check is a step the gate actually runs, and records why it may opt out", () => {
  const planned = new Set(GATE_PLAN.map((s) => s.check).filter((c) => c !== undefined));
  for (const [name, condition] of SKIP_CAPABLE_CHECKS) {
    assert.ok(planned.has(name), `${name} is declared skip-capable but is not a gate step`);
    assert.ok(condition.length > 0, `${name} must record the condition under which it verifies nothing`);
  }
});

test("the root `gate` script invokes the runner, so GATE_PLAN is what actually runs", () => {
  // The plan is only the source of truth while the script points at the runner that walks it. If the
  // `gate` script is ever reverted to an `&&` chain, every assertion above becomes decoration.
  assert.match(rootScripts()["gate"] ?? "", /gate-run\.ts/);
});

test("the root `gate` script itself PRESERVES exit codes — it now carries a protocol of its own", () => {
  // The same hazard as the skip protocol above, one level out. The re-run surface (`gate-rerun.ts`)
  // makes the gate exit GATE_PARTIAL_EXIT_CODE (4) for "every step I selected passed, and I was not a
  // whole gate". MEASURED here 2026-08-14, both forms, on this repo:
  //
  //     pnpm --filter @storytree/cli exec node -e "process.exit(4)"  -> exit 1   <- COLLAPSES
  //     pnpm -C packages/cli         exec node -e "process.exit(4)"  -> exit 4
  //
  // On the collapsing form a partial run's 4 arrives as 1, i.e. as an ordinary red, and the one
  // distinction the re-run surface exists to draw — "the flake cleared" vs "it is genuinely red" —
  // is destroyed silently, in the direction that reads as a failure. Nothing else about the gate
  // changes: 0 stays 0 and 1 stays 1 through both forms.
  const script = rootScripts()["gate"] ?? "";
  assert.ok(script.length > 0, "the root `gate` script is gone");
  assert.ok(
    !script.includes(EXIT_CODE_COLLAPSING_INVOCATION),
    "`gate` reports GATE_PARTIAL_EXIT_CODE for a partial re-run, but is invoked via " +
      `\`${EXIT_CODE_COLLAPSING_INVOCATION}\`, which collapses it to 1. Use \`pnpm -C packages/cli ` +
      `exec …\`. Script: ${script}`,
  );
});

// ── the tombstone vs. the real source tree (ADR-0311 D2/D5) ──────────────────
//
// The three tests above guard a check that EXISTS but never runs. These guard the mirror image: a
// check that RUNS NOWHERE but still exists. ADR-0311 kept the retired implementations deliberately
// and named the cost in its Consequences — "discoverable code whose unwired status must not be
// mistaken for a forgotten gate rung" — without paying it. These pay it, mechanically, so the
// status cannot rot back into prose.

/** Every distinct file the tombstone claims survived, deduped across checks that shared one. */
function retiredSources(): string[] {
  return [...new Set([...RETIRED_CHECKS.values()].flatMap((entry) => entry.sources))].sort();
}

/** The `src/<name>.ts` entrypoints the root `check:*` scripts actually invoke. */
function wiredEntrypoints(): Set<string> {
  const wired = new Set<string>();
  for (const [name, command] of Object.entries(rootScripts())) {
    if (!name.startsWith("check:")) continue;
    for (const [, file] of command.matchAll(/\bsrc\/([\w.-]+\.ts)\b/g)) {
      if (file !== undefined) wired.add(file);
    }
  }
  return wired;
}

test("no retired check has quietly returned as a root script", () => {
  // A retired name reappearing in package.json is either a deliberate re-wiring — which ADR-0311 D5
  // says needs fresh production-catch evidence and an ADR, not just a script line — or an
  // accident. Either way the tombstone above is then lying, and this is where that surfaces.
  const resurrected = [...RETIRED_CHECKS.keys()].filter((name) => Object.hasOwn(rootScripts(), name));

  assert.deepEqual(
    resurrected,
    [],
    `these checks are declared RETIRED but the root package.json declares them: ${resurrected.join(", ")}. ` +
      "Re-wiring a retired rung needs new evidence and an ADR (ADR-0311 D5); if that happened, remove " +
      "it from RETIRED_CHECKS, add it to GATE_PLAN, and drop its UNWIRED banner.",
  );
});

test("every surviving retired source exists and carries the UNWIRED banner", () => {
  // THE LOAD-BEARING ONE. This is what stops a tested, confident-looking, wired-to-nothing fence
  // from reading as enforcement — the defect that put a false "enforced rather than merely advised"
  // claim into the `test-creation-principles` artifact a day after `check:test-timing` was retired.
  const unmarked: string[] = [];
  const missing: string[] = [];

  for (const file of retiredSources()) {
    let body: string;
    try {
      body = readFileSync(path.join(cliSrc, file), "utf8");
    } catch {
      missing.push(file);
      continue;
    }
    if (!body.includes(UNWIRED_MARKER)) unmarked.push(file);
  }

  assert.deepEqual(
    missing,
    [],
    `RETIRED_CHECKS names ${missing.join(", ")}, which no longer exist. A deleted source is fine — ` +
      "drop it from the inventory so the tombstone keeps describing the real tree.",
  );
  assert.deepEqual(
    unmarked,
    [],
    `these retired sources do not carry the \`${UNWIRED_MARKER}\` banner: ${unmarked.join(", ")}. ` +
      "Each still compiles and its own tests still pass, so without the banner a reader has no way " +
      "to tell it enforces nothing. Add the banner, or — if it was re-wired — update RETIRED_CHECKS.",
  );
});

// ── the tombstone's COMPANION half ───────────────────────────────────────────
//
// The tests above judge the retired PRODUCTION sources, which is the half that was tracked. Their
// `.test.ts` companions were not — and three of them are not leftovers at all: they run inside
// `pnpm -r test` (GATE_PLAN step 6, and a CI step) and assert invariants over the real tree. A
// tidy-up deleting "the unwired ADR-0311 leftovers" would have taken them along and dropped those
// invariants in silence. These make that impossible to do quietly.

test("every `.test.ts` companion of a retired source is DECLARED — one cannot sit untracked", () => {
  // The completeness half, and the direction that rots on its own: a companion nobody inventoried is
  // exactly how the three load-bearing ones went unbannered beside genuinely dead code for a week.
  const undeclared = retiredSources()
    .map(companionFileFor)
    .filter((file) => existsSync(path.join(cliSrc, file)))
    .filter((file) => !RETIRED_TEST_COMPANIONS.has(file))
    .sort();

  assert.deepEqual(
    undeclared,
    [],
    `these test files sit beside a retired source but are not in RETIRED_TEST_COMPANIONS: ` +
      `${undeclared.join(", ")}. Declare each with its role and what deleting it would cost — an ` +
      "undeclared companion is indistinguishable from a leftover, which is how a live invariant " +
      "gets swept up by a tidy-up.",
  );
});

test("every declared companion still EXISTS — deleting one reds here, naming what it enforced", () => {
  // THE LOAD-BEARING ONE. This is the mechanism, not the documentation: removing the FILE fails here
  // with its `cost` sentence, so dropping a repo-wide invariant takes three deliberate edits (the
  // file, its entry, and the pinned set below) and each one lands visibly in the diff.
  const gone: string[] = [];
  for (const [file, companion] of RETIRED_TEST_COMPANIONS) {
    if (!existsSync(path.join(cliSrc, file))) gone.push(`${file} (${companion.role}) — ${companion.cost}`);
  }

  assert.deepEqual(
    gone,
    [],
    `these declared companions no longer exist: ${gone.join(" | ")}. If the deletion was deliberate, ` +
      "remove the entry too — and for a `load-bearing` one, say in the commit which invariant is " +
      "being abandoned and where it moved.",
  );
});

test("every companion carries the banner its ROLE demands, and no inert one claims to enforce", () => {
  // Both directions on `LOAD-BEARING`, because both fail: a missing banner leaves a live invariant
  // looking like dead code, and a stale one leaves dead code looking protected. The second is the
  // half that rots — a companion can stop enforcing without anyone touching this map.
  const unbannered: string[] = [];
  const overclaiming: string[] = [];

  for (const [file, companion] of RETIRED_TEST_COMPANIONS) {
    assert.ok(companion.cost.length > 0, `${file} must record what deleting it would cost`);
    assert.ok(
      retiredSources().includes(companion.of),
      `${file} claims to companion \`${companion.of}\`, which RETIRED_CHECKS does not list`,
    );
    assert.equal(
      companionFileFor(companion.of),
      file,
      `${file} is declared against \`${companion.of}\`, whose companion would be ${companionFileFor(companion.of)}`,
    );

    let body: string;
    try {
      body = readFileSync(path.join(cliSrc, file), "utf8");
    } catch {
      continue; // the test above owns the missing-file failure; don't report it twice
    }
    const claims = body.includes(LOAD_BEARING_MARKER);
    if (companion.role === "load-bearing" && !claims) unbannered.push(file);
    if (companion.role !== "load-bearing" && claims) overclaiming.push(file);
  }

  assert.deepEqual(
    unbannered,
    [],
    `these still enforce a repo-wide invariant but carry no \`${LOAD_BEARING_MARKER}\` banner: ` +
      `${unbannered.join(", ")}. Without it they read as ADR-0311 leftovers and get tidied away.`,
  );
  assert.deepEqual(
    overclaiming,
    [],
    `these claim \`${LOAD_BEARING_MARKER}\` but are not declared load-bearing: ${overclaiming.join(", ")}. ` +
      "Either the banner is stale — remove it — or the file started enforcing something, in which " +
      "case say what in its RETIRED_TEST_COMPANIONS entry.",
  );
});

test("the load-bearing companions are pinned BY NAME, so dropping one is a visible edit", () => {
  // Derived by hand rather than read off the map — the same reason PRE_EXPENSIVE_CHECKS is. A set
  // computed from the map would agree with it by construction and could never contradict it, which
  // is precisely the contradiction this exists to force: quietly deleting a load-bearing entry has
  // to fail a literal that spells out the three files.
  const loadBearing = [...RETIRED_TEST_COMPANIONS]
    .filter(([, companion]) => companion.role === "load-bearing")
    .map(([file]) => file)
    .sort();

  assert.deepEqual(
    loadBearing,
    ["coverage-drain.test.ts", "coverage-gate.test.ts", "test-timing-drain.test.ts"],
    "the set of companions that still enforce a repo-wide invariant changed. Adding one is fine — " +
      "update this literal. REMOVING one means a repo-wide invariant is being abandoned or has " +
      "moved; say which, and where it went.",
  );
});

test("each load-bearing companion's banner NAMES the invariant, not just the marker", () => {
  // A bare `LOAD-BEARING` token satisfies the banner test while telling a reader nothing about what
  // is at stake, which is how a marker decays into decoration. The banner has to be readable on its
  // own, by a session that never opens this module.
  for (const [file, companion] of RETIRED_TEST_COMPANIONS) {
    if (companion.role !== "load-bearing") continue;
    const body = readFileSync(path.join(cliSrc, file), "utf8");
    const banner = body.split(/\r?\n/).findIndex((line) => line.includes(LOAD_BEARING_MARKER));
    const paragraph = body.split(/\r?\n/).slice(banner, banner + 12).join("\n");
    assert.match(
      paragraph,
      /pnpm -r|GATE_PLAN|do not delete|DO NOT DELETE/i,
      `${file}'s ${LOAD_BEARING_MARKER} banner must say where it runs and that it must survive a ` +
        "leftover sweep — a bare marker is decoration",
    );
  }
});

// ── the gate's VOICE vs. the real source tree ────────────────────────────────
//
// The tombstone tests above judge FILES. These judge SENTENCES, which is the half no inventory of
// check-shaped files can reach: `storytree library --check` is not a `check:*` script and leaves no
// `check-*.ts` behind, so every test above swept past it while it printed
// `GATE BROKEN: … — fix before merge` on a report nothing has ever run.

/** The module that DECLARES the phrases, and its test — scanning them would only flag their own data. */
const GATE_VOICE_SELF: ReadonlySet<string> = new Set([
  "packages/cli/src/gate-order.ts",
  "packages/cli/src/gate-order.test.ts",
]);

/** Every `.ts` under {@link GATE_VOICE_SCAN_ROOTS}, repo-root-relative with forward slashes. */
function gateVoiceFiles(): string[] {
  const out: string[] = [];
  for (const root of GATE_VOICE_SCAN_ROOTS) {
    for (const entry of readdirSync(path.join(repoRoot, root), { recursive: true })) {
      const rel = `${root}/${String(entry).split(path.sep).join("/")}`;
      if (rel.endsWith(".ts") && !GATE_VOICE_SELF.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

test("findGateVoice reports each phrase with its line and the sentence, and stays quiet otherwise", () => {
  // The non-vacuity control: the sweep below asserts an EMPTY list, which a scanner that finds
  // nothing would also satisfy. This proves it can speak before that one proves nobody is speaking.
  assert.deepEqual(findGateVoice("const ok = 1;\n// nothing to declare here\n"), []);

  const hits = findGateVoice('a\nlines.push("GATE BROKEN: x — fix before merge.");\nb\n');
  assert.deepEqual(
    hits.map((h) => [h.line, h.phrase]),
    [
      [2, "GATE BROKEN"],
      [2, "fix before merge"],
    ],
  );
  assert.match(hits[0]?.text ?? "", /lines\.push/);
});

test("a mention of merging that claims no blocking authority is NOT a hit", () => {
  // The two real sentences the narrow phrase list deliberately spares — widening it to catch these
  // would bury the check in an allowlist nobody reads.
  assert.deepEqual(findGateVoice("catch a collision before merge (it will fail the PR)"), []);
  assert.deepEqual(findGateVoice("N candidate(s) await a librarian pass before merge (ADR-0095)"), []);
});

test("no source claims merge-blocking authority unless it is exempted with a reason", () => {
  // THE LOAD-BEARING ONE, and the mirror of `every check:* script is IN the plan`: that test stops a
  // check from existing unrun, this one stops a command from SOUNDING enforced while unrun. Both
  // refuse the same conclusion — that something is watching when nothing is.
  const unexplained: string[] = [];
  for (const file of gateVoiceFiles()) {
    for (const hit of findGateVoice(readFileSync(path.join(repoRoot, file), "utf8"))) {
      if (GATE_VOICE_EXEMPTIONS.has(gateVoiceKey(file, hit.phrase))) continue;
      unexplained.push(`${file}:${hit.line} — ${hit.text}`);
    }
  }

  assert.deepEqual(
    unexplained,
    [],
    `these assert merge-blocking authority: ${unexplained.join(" | ")}. Either the claim is FALSE — ` +
      "reword it to report rather than to refuse (ADR-0311 D5: wiring a rung needs new " +
      "production-catch evidence and an ADR, never merely the wiring) — or it is true, in which case " +
      "trace it to its GATE_PLAN step and add it to GATE_VOICE_EXEMPTIONS with that reason.",
  );
});

test("every gate-voice exemption still names a real, still-claiming sentence", () => {
  // A stale exemption is removed, not kept — the same rule the NON_GATE_CHECK_SCRIPTS test applies,
  // and the reason a reworded sentence cannot leave a permanent licence behind for the next author.
  const live = new Set<string>();
  for (const file of gateVoiceFiles()) {
    for (const hit of findGateVoice(readFileSync(path.join(repoRoot, file), "utf8"))) {
      live.add(gateVoiceKey(file, hit.phrase));
    }
  }
  for (const [key, reason] of GATE_VOICE_EXEMPTIONS) {
    assert.ok(live.has(key), `GATE_VOICE_EXEMPTIONS exempts \`${key}\`, which no longer says it`);
    assert.ok(reason.length > 0, `${key} must record WHY the claim is honest`);
  }
});

test("every declared phrase is a distinct claim of blocking authority", () => {
  assert.ok(GATE_AUTHORITY_PHRASES.length > 0, "an empty phrase list makes the sweep vacuous");
  assert.equal(new Set(GATE_AUTHORITY_PHRASES).size, GATE_AUTHORITY_PHRASES.length);
});

test("every check-shaped source file is either wired into the gate or declared retired", () => {
  // The completeness half: the two tests above only judge files someone remembered to inventory.
  // This one judges the DIRECTORY, so a newly orphaned check cannot slip in unlisted and a session
  // reading `RETIRED_CHECKS` can trust it to be the whole tombstone rather than a sample.
  const wired = wiredEntrypoints();
  const retired = new Set(retiredSources());
  const unaccounted = readdirSync(cliSrc)
    .filter((file) => /^check-.+\.ts$|.+-check\.ts$/.test(file) && !file.endsWith(".test.ts"))
    .filter((file) => !wired.has(file) && !retired.has(file))
    .sort();

  assert.deepEqual(
    unaccounted,
    [],
    `these files look like gate checks but are neither invoked by a root check:* script nor listed ` +
      `in RETIRED_CHECKS: ${unaccounted.join(", ")}. Wire it, or declare it retired and banner it — ` +
      "an unaccounted check-shaped file is exactly the ambiguity this inventory exists to remove.",
  );
});


test("a rung promoted to a merge wall does not keep describing itself as local-only", () => {
  // ADR-0547 D1 moved `check:gcloudignore-mirror` from gate-only onto the CI merge wall. Its own
  // `why` prose said "LOCAL-ONLY today", which the promotion made false — and prose inside a plan
  // entry is exactly the kind of claim nothing else reads, so nothing else would have caught it.
  // This asserts the CORRECTED state rather than the edit: the entry must name the promotion and
  // must not still be advertising the credential limit that was lifted.
  const step = GATE_PLAN.find((entry) => entry.command === "pnpm check:gcloudignore-mirror");
  assert.ok(step, "check:gcloudignore-mirror must still be in the gate plan — CI is the wall, the gate is the habit, and ADR-0547 D1 put it on BOTH");

  assert.match(
    step.why,
    /MERGE WALL AS WELL AS A GATE RUNG/,
    "the entry must say it runs at the merge as well as in the gate (ADR-0547 D1)",
  );
  assert.doesNotMatch(
    step.why,
    /LOCAL-ONLY today/,
    "the entry still claims to be local-only, which ADR-0547 D1 made false",
  );
  assert.match(
    step.why,
    /NO LONGER in `DECLARED_LOCAL_ONLY`/,
    "the entry must record that it left the local-only set, since gate-ci-parity's declaration is the thing a reader cross-checks",
  );
});

test("the manifest's own rung runs before every rung that reads the manifest — a refused fragment tree is named once, under its own name", () => {
  // ADR-0556 D4 (`repo-manifest-aggregate-leaves-git`): the committed aggregate left Git, so the fragments are the
  // manifest's only bytes. Three rungs read the composed manifest and each stands down on a refused set; this one
  // judges the set itself, so its verdict has to arrive first.
  const at = (command: string) => GATE_PLAN.findIndex((entry) => entry.command === command);
  const step = GATE_PLAN[at("pnpm check:manifest-fragments")];
  assert.ok(step, "check:manifest-fragments must be in the gate plan");
  assert.deepEqual(
    { command: step.command, check: step.check, subject: step.subject, cost: step.cost },
    { command: "pnpm check:manifest-fragments", check: "check:manifest-fragments", subject: "own-work", cost: "seconds" },
  );
  for (const reader of ["pnpm check:boundaries", "pnpm check:ownership-totality", "pnpm check:hierarchy-camps"]) {
    assert.ok(at("pnpm check:manifest-fragments") < at(reader), `the manifest's rung must run before ${reader}`);
  }
  assert.ok(
    PRE_EXPENSIVE_CHECKS.has("check:manifest-fragments"),
    "it costs seconds and a red there is this branch's, so it runs ahead of the expensive legs",
  );
  assert.match(
    step.why,
    /does not compose, when a fragment is not written exactly as the composer writes it .*when a `repo-manifest\.json` sits beside the tree \(ADR-0556 D4\)/,
  );
});
