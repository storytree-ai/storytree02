import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import { discoverChecks, loadGatePlan } from "./gate-checks.js";
import {
  BUILT_IN_LEGS,
  EXIT_CODE_COLLAPSING_INVOCATION,
  GATE_AUTHORITY_PHRASES,
  GATE_VOICE_EXEMPTIONS,
  GATE_VOICE_SCAN_ROOTS,
  type GatePlanStep,
  LOAD_BEARING_MARKER,
  RETIRED_TEST_COMPANIONS,
  UNWIRED_MARKER,
  companionFileFor,
  evaluateGateOrder,
  findGateVoice,
  gateVoiceKey,
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

/**
 * The real checkout, asked of git: under `check:mutation-diff` this suite runs from a copy inside the
 * git-ignored `.stryker-tmp/`, where discovery rooted at the copy would find nothing.
 */
function checkoutRoot(): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(res.status, 0, `git rev-parse --show-toplevel: ${res.stderr}`);
  return res.stdout.trim();
}

/** The REAL plan, found exactly as `pnpm gate` finds it. */
function realPlan(): readonly GatePlanStep[] {
  const root = checkoutRoot();
  const loaded = loadGatePlan(root, discoverWorkspaceProjects(root).map((p) => p.dir), BUILT_IN_LEGS);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
  return loaded.plan;
}

/** A synthetic plan step for the evaluator's unit tests. */
function planStep(
  command: string,
  subject: GatePlanStep["subject"],
  cost: GatePlanStep["cost"],
  check: string | undefined = command.startsWith("check:") ? command : undefined,
): GatePlanStep {
  return { command, check, runs: "both", subject, cost, why: "a synthetic step" };
}

// ── the fixed legs ───────────────────────────────────────────────────────────────────────────
//
// The only steps the gate names itself (ADR-0606 D1: "the gate's built-ins, not a list anyone
// extends"). Every CHECK is found from its own file; these four are pinned here because nothing else
// declares them.

test("the fixed legs are lint, the two `-r` legs and the studio build — each in its slot, placement and class", () => {
  const summary = (legs: readonly GatePlanStep[]) =>
    legs.map((leg) => [leg.command, leg.check, leg.runs, leg.subject, leg.cost]);
  assert.deepEqual(summary(BUILT_IN_LEGS.lead), [["pnpm lint", undefined, "both", "own-work", "seconds"]]);
  assert.deepEqual(summary(BUILT_IN_LEGS.wall), [
    ["pnpm -r --no-bail typecheck", undefined, "both", "own-work", "minutes"],
    ["pnpm -r --no-bail test", undefined, "both", "own-work", "minutes"],
  ]);
  // CI-only by placement (ADR-0606 D4): only CI's clean checkout is asked to prove the studio build.
  assert.deepEqual(summary(BUILT_IN_LEGS.trail), [["pnpm -r build", undefined, "ci", "own-work", "seconds"]]);
  for (const leg of [...BUILT_IN_LEGS.lead, ...BUILT_IN_LEGS.wall, ...BUILT_IN_LEGS.trail]) {
    assert.ok(leg.why.trim().length > 40, `\`${leg.command}\` gives no reason it is in the gate`);
    assert.equal(leg.invocation, undefined, `a fixed leg runs its own command: ${leg.command}`);
    assert.equal(leg.ciIdentity, undefined, `a fixed leg reads no store: ${leg.command}`);
    assert.equal(leg.skip, undefined, `a fixed leg never skips: ${leg.command}`);
  }
});

// ── the ordering invariant, judged from declarations ─────────────────────────────────────────

test("evaluateGateOrder passes a plan in the derived shape, and says so", () => {
  const v = evaluateGateOrder([
    planStep("check:first", "own-work", "seconds"),
    planStep("pnpm lint", "own-work", "seconds"),
    planStep("check:cheap", "own-work", "seconds"),
    planStep("pnpm -r test", "own-work", "minutes"),
    planStep("check:slow", "own-work", "minutes"),
    planStep("pnpm -r build", "own-work", "seconds"),
    planStep("check:shared", "shared-environment", "seconds"),
    planStep("check:shared-last", "shared-environment", "minutes"),
  ]);
  assert.deepEqual(v, { verdict: "ok", message: "both ordering axes hold.", misordered: [], premature: [] });
});

test("evaluateGateOrder fails CLOSED on a plan with no minutes-cost step", () => {
  const v = evaluateGateOrder([planStep("check:a", "own-work", "seconds"), planStep("check:b", "shared-environment", "seconds")]);
  assert.deepEqual(v, {
    verdict: "fail",
    message:
      "the gate plan runs no minutes-cost step — the ordering invariant cannot be judged against a " +
      "plan whose `-r` legs never arrived.",
    misordered: [],
    premature: [],
  });
});

test("axis 1: only an own-work, seconds-cost CHECK after a minutes step is misordered", () => {
  const v = evaluateGateOrder([
    planStep("pnpm -r test", "own-work", "minutes"),
    planStep("check:late", "own-work", "seconds"),
    planStep("pnpm -r build", "own-work", "seconds"),
    planStep("check:slow", "own-work", "minutes"),
    planStep("check:shared", "shared-environment", "seconds"),
  ]);
  assert.deepEqual(v.misordered, ["check:late"]);
  assert.deepEqual(v.premature, []);
  assert.equal(v.verdict, "fail");
  assert.equal(
    v.message,
    "1 own-work, seconds-cost check(s) run AFTER a minutes-cost step: check:late. A session waits the " +
      "whole run to read a verdict that was available in seconds.\n" +
      "The plan is derived from each check's declaration (packages/cli/src/gate-checks.ts), so this is a " +
      "defect in the derivation, not in any one check.",
  );
});

test("axis 2: a shared-environment step with own work still to run after it is premature", () => {
  const v = evaluateGateOrder([
    planStep("check:early-shared", "shared-environment", "seconds"),
    planStep("pnpm -r test", "own-work", "minutes"),
    planStep("check:shared", "shared-environment", "seconds"),
    planStep("check:also-shared", "shared-environment", "seconds"),
  ]);
  assert.deepEqual(v.premature, ["check:early-shared"]);
  assert.deepEqual(v.misordered, []);
  assert.equal(
    v.message,
    "1 shared-environment step(s) run BEFORE the session's own work is done: check:early-shared. A red " +
      "there may be a sibling session's, and it must not precede the session's own answer.\n" +
      "The plan is derived from each check's declaration (packages/cli/src/gate-checks.ts), so this is a " +
      "defect in the derivation, not in any one check.",
  );
});

test("both axes are reported together when both break, every breach named in plan order", () => {
  const v = evaluateGateOrder([
    planStep("check:shared-a", "shared-environment", "seconds"),
    planStep("check:shared-b", "shared-environment", "seconds"),
    planStep("pnpm -r test", "own-work", "minutes"),
    planStep("check:late-a", "own-work", "seconds"),
    planStep("check:late-b", "own-work", "seconds"),
  ]);
  assert.deepEqual(v.misordered, ["check:late-a", "check:late-b"]);
  assert.deepEqual(v.premature, ["check:shared-a", "check:shared-b"]);
  const [axisOne, axisTwo, cause] = v.message.split("\n");
  assert.match(axisOne ?? "", /^2 own-work, seconds-cost check\(s\) run AFTER a minutes-cost step: check:late-a, check:late-b\. /);
  assert.match(axisTwo ?? "", /^2 shared-environment step\(s\) run BEFORE the session's own work is done: check:shared-a, check:shared-b\. /);
  assert.match(cause ?? "", /a defect in the derivation, not in any one check\.$/);
});

test("the REAL plan honours both ordering axes", () => {
  const v = evaluateGateOrder(realPlan());
  assert.equal(v.verdict, "ok", v.message);
});

// ── where each step runs (ADR-0606 D3/D4) ────────────────────────────────────────────────────
//
// ONE plan drives both runs: `pnpm gate` walks `both` + `local`, `pnpm gate --ci` walks `both` + `ci`.
// Which checks sit on which side is each check's own declaration; nothing here pins them by name,
// because that would be a list. What is pinned is the two DECIDED placements.

test("placement-selects-each-run: every step of the real plan declares a placement, with no default to fall back on", () => {
  const plan = realPlan();
  assert.ok(plan.length > 20, "the real plan is not vacuous");
  for (const step of plan) {
    assert.ok(
      step.runs === "both" || step.runs === "local" || step.runs === "ci",
      `\`${step.command}\` declares no recognised placement: ${JSON.stringify(step.runs)}`,
    );
  }
});

test("placement-selects-each-run: a local run walks both + local and a CI run walks both + ci, each in plan order", () => {
  const plan = realPlan();
  const local = stepsFor(plan, "local").map((s) => s.command);
  const ci = stepsFor(plan, "ci").map((s) => s.command);
  assert.deepEqual(local, plan.filter((s) => s.runs !== "ci").map((s) => s.command));
  assert.deepEqual(ci, plan.filter((s) => s.runs !== "local").map((s) => s.command));
  assert.ok(!local.includes("pnpm -r build"));
  assert.ok(ci.includes("pnpm -r build"));
});

test("placement-selects-each-run: stepsFor keeps `both` on both sides and never reorders", () => {
  const plan = [
    { id: 1, runs: "ci" },
    { id: 2, runs: "both" },
    { id: 3, runs: "local" },
    { id: 4, runs: "both" },
  ] as const;
  assert.deepEqual(stepsFor(plan, "local").map((s) => s.id), [2, 3, 4]);
  assert.deepEqual(stepsFor(plan, "ci").map((s) => s.id), [1, 2, 4]);
});

test("placement-selects-each-run: the ordering invariant holds on each side's run, not only on the whole plan", () => {
  const plan = realPlan();
  for (const mode of ["local", "ci"] as const) {
    const v = evaluateGateOrder(stepsFor(plan, mode));
    assert.equal(v.verdict, "ok", `${mode}: ${v.message}`);
  }
});

test("placement-selects-each-run: check:verification-decay stays LOCAL — moving it into CI would reverse ADR-0252 D3", () => {
  // A drain obligation on the session, never a merge barrier: these instruments run at a measured
  // ~75% false-positive rate, and a CI step is a merge barrier. The placement is one word in the
  // check's own declaration, which is exactly why the decision is pinned here.
  const decay = realPlan().find((s) => s.check === "check:verification-decay");
  assert.ok(decay !== undefined, "check:verification-decay must still be a gate check");
  assert.equal(decay.runs, "local");
});

// ── which identity each step signs in as (ADR-0560, ADR-0606 D3) ──────────────────────────────

test("ci-step-gets-only-its-declared-identity: a step reads the live store exactly when it declares an identity", () => {
  assert.equal(readsLiveStore({ ciIdentity: "ci-presence" }), true);
  assert.equal(readsLiveStore({ ciIdentity: "ci-webverdict" }), true);
  assert.equal(readsLiveStore({}), false);
});

test("ci-step-gets-only-its-declared-identity: the verdict-history reader signs in as ci-webverdict, as ADR-0560's split requires", () => {
  const plan = realPlan();
  const continuity = plan.find((s) => s.check === "check:uat-revision-continuity");
  assert.ok(continuity !== undefined, "check:uat-revision-continuity must still be a gate check");
  assert.equal(continuity.ciIdentity, "ci-webverdict");
});

// ── the root `gate` script ───────────────────────────────────────────────────────────────────
test("the root `gate` script invokes the runner, so the found plan is what actually runs", () => {
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

// ── the tombstone, declared in the files themselves (ADR-0606 D6, ADR-0311 D2/D5) ──────────────
//
// A retired check keeps its file so re-wiring stays cheap, and says it is retired in its own
// declaration; the gate lists it and never runs it. These guard what that declaration cannot say
// about the files AROUND it: that the helpers it left behind still exist and still read as dead code.

/** Every distinct file the retired checks left behind — each entry, and the helpers it names. */
function retiredSources(): string[] {
  const root = checkoutRoot();
  const discovery = discoverChecks(root, discoverWorkspaceProjects(root).map((p) => p.dir));
  const files = discovery.retired.flatMap((check) => [
    path.posix.basename(check.path),
    ...check.declaration.sources,
  ]);
  return [...new Set(files)].sort();
}

test("every retired check lives beside the helpers it declares, in packages/cli/src", () => {
  // The companion inventory below is keyed by bare file name under this directory; a retired check
  // declared anywhere else would be invisible to it, so say so rather than letting it slip past.
  const root = checkoutRoot();
  const discovery = discoverChecks(root, discoverWorkspaceProjects(root).map((p) => p.dir));
  assert.ok(discovery.retired.length > 0, "no retired check found — the tombstone would be vacuous");
  for (const check of discovery.retired) {
    assert.equal(path.posix.dirname(check.path), "packages/cli/src", `${check.name} lives elsewhere`);
  }
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
    `a retired declaration names ${missing.join(", ")}, which no longer exist. A deleted helper is ` +
      "fine — drop it from the declaration's `sources` so the tombstone keeps describing the real tree.",
  );
  assert.deepEqual(
    unmarked,
    [],
    `these retired sources do not carry the \`${UNWIRED_MARKER}\` banner: ${unmarked.join(", ")}. ` +
      "Each still compiles and its own tests still pass, so without the banner a reader has no way " +
      "to tell it enforces nothing. Add the banner, or — if it was re-wired — make its declaration live.",
  );
});

// ── the tombstone's COMPANION half ───────────────────────────────────────────
//
// The tests above judge the retired PRODUCTION sources, which is the half that was tracked. Their
// `.test.ts` companions were not — and three of them are not leftovers at all: they run inside
// `pnpm -r test` (the test leg, which the gate and CI both run) and assert invariants over the real tree. A
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
      `${file} claims to companion \`${companion.of}\`, which no retired declaration names`,
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
  // Derived by hand rather than read off the map — the same reason a decision is pinned rather than derived. A set
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
      /pnpm -r|test leg|do not delete|DO NOT DELETE/i,
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
  // THE LOAD-BEARING ONE, and the mirror of discovery REFUSING an undeclared check file: that stops a
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
      "trace it to the gate step that runs it and add it to GATE_VOICE_EXEMPTIONS with that reason.",
  );
});

test("every gate-voice exemption still names a real, still-claiming sentence", () => {
  // A stale exemption is removed, not kept — the same rule a retired declaration's `sources` obeys,
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

test("a rung promoted to a merge wall does not keep describing itself as local-only", () => {
  // ADR-0547 D1 moved `check:gcloudignore-mirror` from gate-only onto the CI merge wall. Its own
  // reason said "LOCAL-ONLY today", which the promotion made false — and prose inside a declaration
  // is exactly the kind of claim nothing else reads, so nothing else would have caught it. This
  // asserts the CORRECTED state rather than the edit: the declaration must name the promotion and
  // must not still be advertising the credential limit that was lifted.
  const step = realPlan().find((entry) => entry.check === "check:gcloudignore-mirror");
  assert.ok(step, "check:gcloudignore-mirror must still be a gate check — CI is the wall, the gate is the habit, and ADR-0547 D1 put it on BOTH");

  assert.match(
    step.why,
    /MERGE WALL AS WELL AS A GATE RUNG/,
    "the declaration must say it runs at the merge as well as in the gate (ADR-0547 D1)",
  );
  assert.doesNotMatch(
    step.why,
    /LOCAL-ONLY today/,
    "the declaration still claims to be local-only, which ADR-0547 D1 made false",
  );
  // The placement is a DECLARED value, so the claim is checked against it — the prose may not say one
  // thing while the check is placed another.
  assert.equal(step.runs, "both", "the merge wall runs on both sides");
  assert.match(
    step.why,
    /placed `runs: "both"`/,
    "the declaration must name its placement, which is the thing a reader cross-checks",
  );
});

test("no found check is run through an invocation that collapses its exit code", () => {
  // A declared SKIP only survives as 3 through `pnpm -C <dir> exec`; `--filter … exec` turns it into 1,
  // i.e. into a failure, on every checkout that legitimately opts out (measured 2026-08-08). The gate
  // builds each check's invocation itself now, so this holds that construction to the measured form.
  for (const step of realPlan()) {
    if (step.invocation === undefined) continue;
    assert.ok(
      !step.invocation.includes(EXIT_CODE_COLLAPSING_INVOCATION),
      `\`${step.command}\` would run through ${EXIT_CODE_COLLAPSING_INVOCATION}: ${step.invocation}`,
    );
  }
});
