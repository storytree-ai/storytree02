import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import { discoverChecks, loadGatePlan } from "./gate-checks.js";
import { BUILT_IN_LEGS, type GatePlanStep, type GateStep, readsLiveStore } from "./gate-order.js";
import type { GateStepResult, GateStepStatus } from "./gate-runner.js";
import {
  GATE_RUN_RECORD_VERSION,
  type GateRunRecord,
  type GateSelection,
  INSTALLED_LOCKFILE_ABSENT,
  compareRerun,
  computeTreeDigest,
  encodeGateRunRecord,
  parseGateRunRecord,
  parseSelectionRequest,
  recordFromResults,
  renderRerunComparison,
  resolveSelection,
  treeChangedSince,
} from "./gate-rerun.js";

// The real plan's SHAPE without its cost: five cheap checks, two expensive legs. Nothing here spawns.
const PLAN: GateStep[] = [
  { command: "pnpm check:boundaries", check: "check:boundaries" },
  { command: "pnpm check:guidance", check: "check:guidance" },
  { command: "pnpm check:agents", check: "check:agents" },
  { command: "pnpm -r --no-bail typecheck", check: undefined },
  { command: "pnpm -r --no-bail test", check: undefined },
];

/**
 * The real checkout, asked of git: under `check:mutation-diff` this suite runs from a copy inside the
 * git-ignored `.stryker-tmp/`, where discovery rooted at the copy would find nothing.
 */
function checkoutRoot(): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `git rev-parse --show-toplevel: ${res.stderr}`);
  return res.stdout.trim();
}

let foundPlan: readonly GatePlanStep[] | undefined;

/** The REAL plan, found exactly as `pnpm gate` finds it (ADR-0606 D1) — once. */
function realPlan(): readonly GatePlanStep[] {
  if (foundPlan !== undefined) return foundPlan;
  const root = checkoutRoot();
  const loaded = loadGatePlan(root, discoverWorkspaceProjects(root).map((p) => p.dir), BUILT_IN_LEGS);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
  foundPlan = loaded.plan;
  return foundPlan;
}

/** The package specifier that IS the live-store seam: importing it is dialling the store. */
const STORE_MODULE = "@storytree/library/store";

/**
 * Drive's shared store opener. Five of the ten members reach the store through this rather than
 * through a direct `createPool`, so a scan looking only for {@link STORE_MODULE} would report half
 * the declared set as disk-only — the failure that would be silent and in the reassuring direction.
 */
const STORE_OPENER = "openCorpusStore";

/** One import this module performs: the binding clause (may be empty) and the specifier. */
interface ModuleImport {
  readonly clause: string;
  readonly spec: string;
}

/**
 * Every import in one module — STATIC and DYNAMIC.
 *
 * ⚠ BOTH FORMS, and the dynamic one is not a completeness flourish: `check-mirror-conformance.ts`
 * reaches the store ONLY through `await import("@storytree/library/store")`, deliberately lazy so its
 * fixtures arm never opens a connection. A scanner reading static imports alone called that file
 * disk-only — an UNDER-approximation, which is the dangerous direction here: it would have restored
 * the false `flake-signature` for a store-reading step, the exact defect this axis removes.
 */
function importsOf(src: string): ModuleImport[] {
  const out: ModuleImport[] = [];
  for (const m of src.matchAll(/import\s+([^;]*?)\s*from\s+"([^"]+)"/g)) {
    out.push({ clause: m[1] ?? "", spec: m[2] ?? "" });
  }
  for (const m of src.matchAll(/(?:^|[^.\w])import\s*\(\s*"([^"]+)"\s*\)/g)) {
    out.push({ clause: "", spec: m[1] ?? "" });
  }
  return out;
}

/**
 * Does this entry's transitive LOCAL import closure reach the live-store seam?
 *
 * ⚠ IT READS IMPORT STATEMENTS, NEVER THE FILE'S TEXT, and that is a correction rather than a
 * refinement: a plain substring scan for the seam's NAME matched this very repo's prose — the
 * doc comment on the store-reading map `gate-order.ts` then kept named `@storytree/library/store` while importing
 * nothing — and reported `check:reliability-gate-parity`, a disk-only rung, as a store reader. A
 * fence whose evidence is "the string appears somewhere" is evidence for the wrong thing
 * (`asset:an-observable-is-evidence-only-for-what-it-observes`).
 *
 * Local (`./x.js`) imports are followed; a package boundary is where the seam lives, so the walk
 * stops there and judges the specifier instead. Unresolvable specifiers are skipped rather than
 * guessed, and the vacuity control below is what keeps that from being silent.
 */
function closureReachesStoreSeam(entryPath: string): boolean {
  const seen = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const { clause, spec } of importsOf(readFileSync(file, "utf8"))) {
      if (spec === STORE_MODULE) return true;
      if (clause.includes(STORE_OPENER)) return true;
      if (spec.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts")));
      }
    }
  }
  return false;
}

/**
 * A one-step record for a REAL plan command, so a test can name any gate step rather than only the
 * five in {@link PLAN}. The step's `check` is resolved off the real plan when it has one.
 */
function soloRecord(command: string, status: GateStepStatus): GateRunRecord {
  const check = realPlan().find((s) => s.command === command)?.check;
  return record({ [command]: status }, [{ command, check }]);
}

/**
 * The REAL classifier, resolved off the REAL plan — deliberately not a hand-written predicate.
 *
 * A stub would let these tests keep agreeing with themselves after a check's declared identity
 * moved, which is the drift this arc exists to refuse. An unknown command answers TRUE, matching the
 * runner's own fail-closed default.
 */
function realReadsLiveStore(command: string): boolean {
  const step = realPlan().find((s) => s.command === command);
  return step === undefined || readsLiveStore(step);
}

function result(command: string, status: GateStepStatus): GateStepResult {
  return {
    command,
    status,
    exitCode: status === "pass" ? 0 : status === "fail" ? 1 : status === "skip" ? 3 : null,
    durationMs: 10,
  };
}

function record(statuses: Record<string, GateStepStatus>, over: readonly GateStep[] = PLAN): GateRunRecord {
  return recordFromResults({
    results: over.map((s) => result(s.command, statuses[s.command] ?? "pass")),
    finishedAt: "2026-08-14T02:00:00.000Z",
    head: "abc1234",
    treeDigest: "digest-A",
    scope: "full run",
  });
}

/** Narrow an ok verdict, failing loudly rather than silently testing a refusal. */
function selected(v: ReturnType<typeof resolveSelection>): GateSelection {
  assert.ok(v.ok, `expected a selection, got refusal: ${v.ok ? "" : v.message}`);
  return v;
}

// ── the fence: a partial run can never look like a whole gate ────────────────

test("--only leaves every unselected step in the plan, each carrying WHY it did not run", () => {
  // The defect this closes is a partial run reporting a COMPLETE table. Every planned step must still
  // be accounted for; the selection changes what ran, never what is reported.
  const v = selected(resolveSelection({ steps: PLAN, request: { mode: "only", patterns: ["check:agents"] } }));

  assert.equal(v.partial, true);
  assert.deepEqual([...v.selected], ["pnpm check:agents"]);
  assert.equal(v.unselected.size, PLAN.length - 1, "every other planned step is accounted for");
  for (const [, reason] of v.unselected) assert.match(reason, /not selected \(--only check:agents\)/);
});

test("--only matching EVERY step is a full run, not a partial one", () => {
  // Otherwise `--only pnpm` would run the whole gate and then refuse to call it a verdict — and, worse,
  // would decline to record it, quietly breaking the next --rerun-failed.
  const v = selected(resolveSelection({ steps: PLAN, request: { mode: "only", patterns: ["pnpm"] } }));
  assert.equal(v.partial, false);
  assert.equal(v.unselected.size, 0);
});

test("--only matching NOTHING is refused — a table of NOT RUN rows is not a cheap gate run", () => {
  const v = resolveSelection({ steps: PLAN, request: { mode: "only", patterns: ["check:nope"] } });
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.message.includes("verify nothing"), v.ok ? "" : v.message);
  // It has to name the plan, or the session's next move is to guess again.
  assert.ok(!v.ok && v.message.includes("pnpm check:boundaries"));
});

test("--only matches case-insensitively on a SUBSTRING, so a session need not know the exact command", () => {
  const v = selected(resolveSelection({ steps: PLAN, request: { mode: "only", patterns: ["TYPECHECK"] } }));
  assert.deepEqual([...v.selected], ["pnpm -r --no-bail typecheck"]);
});

// ── --rerun-failed ───────────────────────────────────────────────────────────

test("--rerun-failed re-runs exactly the FAIL and NOT RUN steps, and nothing that passed", () => {
  const v = selected(
    resolveSelection({
      steps: PLAN,
      request: { mode: "rerun-failed" },
      record: record({ "pnpm -r --no-bail test": "fail", "pnpm check:agents": "not-run" }),
    }),
  );

  assert.deepEqual([...v.selected].sort(), ["pnpm -r --no-bail test", "pnpm check:agents"].sort());
  assert.equal(v.partial, true);
  assert.match(
    v.unselected.get("pnpm check:boundaries") ?? "",
    /passed in the run at 2026-08-14T02:00:00.000Z — NOT re-executed/,
  );
});

test("a step the record SKIPPED is not re-run, and its row says skipped rather than passed", () => {
  const v = selected(
    resolveSelection({
      steps: PLAN,
      request: { mode: "rerun-failed" },
      record: record({ "pnpm check:agents": "fail", "pnpm check:guidance": "skip" }),
    }),
  );
  assert.equal(v.selected.has("pnpm check:guidance"), false);
  assert.match(v.unselected.get("pnpm check:guidance") ?? "", /^skipped in the run at /);
});

test("a step in today's plan the record never saw is NOT RUN, never assumed passed", () => {
  // The plan grew between the two runs. The new step has no recorded verdict to stand on, so it must
  // not inherit one by being absent from the record.
  const shorter = PLAN.slice(0, 3);
  const v = selected(
    resolveSelection({
      steps: PLAN,
      request: { mode: "rerun-failed" },
      record: record({ "pnpm check:agents": "fail" }, shorter),
    }),
  );
  assert.match(
    v.unselected.get("pnpm -r --no-bail test") ?? "",
    /not in the recorded run at .* — NOT executed here/,
  );
});

test("--rerun-failed with no record is refused, and says a partial run never writes one", () => {
  const v = resolveSelection({
    steps: PLAN,
    request: { mode: "rerun-failed" },
    record: null,
    recordPath: ".gate-logs/last-run.json",
  });
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.message.includes(".gate-logs/last-run.json"));
  assert.ok(!v.ok && v.message.includes("A partial run never writes a record"));
});

test("--rerun-failed over a clean record is refused rather than re-asserting a verdict it did not produce", () => {
  const v = resolveSelection({ steps: PLAN, request: { mode: "rerun-failed" }, record: record({}) });
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.message.includes("nothing to re-run"));
});

test("--rerun-failed is refused when the recorded failure is not in today's plan", () => {
  // The usual cause is the affected-scope rewrite (ADR-0304 D1): the diff moved, so the expensive legs
  // carry different --filter args and the recorded command no longer exists.
  const stale = recordFromResults({
    results: [result("pnpm --filter ...@storytree/forest-world test", "fail")],
    finishedAt: "2026-08-14T02:00:00.000Z",
    head: "abc1234",
    treeDigest: "digest-A",
    scope: "affected: 1 project",
  });
  const v = resolveSelection({ steps: PLAN, request: { mode: "rerun-failed" }, record: stale });
  assert.equal(v.ok, false);
  assert.ok(!v.ok && v.message.includes("the plan has moved"));
  assert.ok(!v.ok && v.message.includes("affected: 1 project"), "names what the recorded run covered");
});

// ── argv ─────────────────────────────────────────────────────────────────────

test("--only accepts a repeated flag, an =form and a comma list", () => {
  const a = parseSelectionRequest(["--only", "check:agents", "--only=check:guidance"]);
  assert.ok(a.ok);
  assert.deepEqual(a.request, { mode: "only", patterns: ["check:agents", "check:guidance"] });

  const b = parseSelectionRequest(["--only", "test,typecheck"]);
  assert.ok(b.ok);
  assert.deepEqual(b.request, { mode: "only", patterns: ["test", "typecheck"] });
});

test("no selection flag is the ordinary whole-plan run", () => {
  const v = parseSelectionRequest(["--full", "--fail-fast"]);
  assert.ok(v.ok);
  assert.deepEqual(v.request, { mode: "all" });
});

test("--only and --rerun-failed together are refused rather than one silently winning", () => {
  const v = parseSelectionRequest(["--rerun-failed", "--only", "test"]);
  assert.equal(v.ok, false);
});

test("--only with no pattern is refused, including when the next token is another flag", () => {
  assert.equal(parseSelectionRequest(["--only"]).ok, false);
  assert.equal(parseSelectionRequest(["--only", "--full"]).ok, false);
});

// ── the record ───────────────────────────────────────────────────────────────

test("a record round-trips through encode/parse", () => {
  const r = record({ "pnpm check:agents": "fail" });
  assert.deepEqual(parseGateRunRecord(encodeGateRunRecord(r)), r);
});

test("anything a build does not fully recognise parses as null, never as a half-read record", () => {
  // A half-understood record would decide which steps a re-run declines to execute. The only safe
  // failure is to have no record at all, which routes the caller to a full run.
  assert.equal(parseGateRunRecord("not json"), null);
  assert.equal(parseGateRunRecord(JSON.stringify({ ...record({}), version: GATE_RUN_RECORD_VERSION + 1 })), null);
  assert.equal(parseGateRunRecord(JSON.stringify({ ...record({}), steps: "nope" })), null);
  const badStatus = { ...record({}), steps: [{ command: "x", status: "green", exitCode: 0, durationMs: 1 }] };
  assert.equal(parseGateRunRecord(JSON.stringify(badStatus)), null);
});

// ── what a fail→pass is allowed to be called ─────────────────────────────────

test("fail -> pass over a PROVABLY unchanged tree is a flake signature", () => {
  // The measured shape: a storage-protocol worker exited non-zero naming no assertion, then passed
  // 19/19 in isolation with nothing changed. That is what this verdict exists to say out loud.
  const rec = record({ "pnpm -r --no-bail test": "fail" });
  const [c] = compareRerun({
    record: rec,
    results: [result("pnpm -r --no-bail test", "pass")],
    selected: new Set(["pnpm -r --no-bail test"]),
    treeChanged: false,
    // A repository-only step: `pnpm -r test` runs credential-free and reads no live store, so an
    // unchanged tree really is the whole picture and the acquittal is earned.
    readsLiveStore: realReadsLiveStore,
  });
  assert.equal(c?.verdict, "flake-signature");
  const rendered = renderRerunComparison([c!], rec).join("\n");
  assert.match(rendered, /FLAKE SIGNATURE/);
  assert.match(
    rendered,
    /None of this is a gate verdict/,
    "an acquittal must still say what it is NOT",
  );
});

test("fail -> pass with the tree CHANGED is a fix, and is never called a flake", () => {
  const [c] = compareRerun({
    record: record({ "pnpm check:agents": "fail" }),
    results: [result("pnpm check:agents", "pass")],
    selected: new Set(["pnpm check:agents"]),
    treeChanged: true,
    readsLiveStore: realReadsLiveStore,
  });
  // `check:agents` DOES read the live store, and it makes no difference here: a changed tree is a
  // fix whatever the step reads, so the store axis never weakens a verdict that was already weak.
  assert.equal(c?.verdict, "fixed");
});

test("fail -> pass with the tree state UNKNOWABLE acquits nothing", () => {
  // `null` is "cannot tell", not a weak "no". Collapsing it into `flake-signature` would let the tool
  // acquit a red on evidence it never had — this arc's own defect, with the sign flipped.
  const [c] = compareRerun({
    record: record({ "pnpm check:agents": "fail" }),
    results: [result("pnpm check:agents", "pass")],
    selected: new Set(["pnpm check:agents"]),
    treeChanged: null,
    readsLiveStore: realReadsLiveStore,
  });
  assert.equal(c?.verdict, "passed-on-rerun");
  assert.match(renderRerunComparison([c!], record({})).join("\n"), /acquits nothing/);
});

test("fail -> fail across two independent runs is a real red", () => {
  const [c] = compareRerun({
    record: record({ "pnpm check:agents": "fail" }),
    results: [result("pnpm check:agents", "fail")],
    selected: new Set(["pnpm check:agents"]),
    treeChanged: false,
    readsLiveStore: realReadsLiveStore,
  });
  assert.equal(c?.verdict, "still-failing");
});

test("a step this run did NOT execute produces no comparison row", () => {
  // Inventing an 'unchanged' row for an unexecuted step would be the report asserting continuity it
  // never observed — the same move as printing PASS over a step that verified nothing.
  const comparisons = compareRerun({
    record: record({ "pnpm check:agents": "fail" }),
    results: [result("pnpm check:agents", "pass"), result("pnpm check:boundaries", "not-run")],
    selected: new Set(["pnpm check:agents"]),
    treeChanged: false,
    readsLiveStore: realReadsLiveStore,
  });
  assert.deepEqual(comparisons.map((c) => c.command), ["pnpm check:agents"]);
});

/** Newline built at runtime rather than typed, per `asset:escape-sequences-in-tool-arguments-become-real-bytes`. */
const LF = String.fromCharCode(10);

/**
 * The store-unobserved paragraph, pinned WHOLE and REGENERATED from the renderer.
 *
 * Four of its literals survived the mutation rung under `match` assertions: a regex over one line
 * says nothing about the three beside it, and this paragraph's whole job is to explain WHY an
 * unchanged repository is not an acquittal. A sentence that can be silently emptied here turns the
 * withheld claim back into a bare PASS.
 */
const GOLDEN_STORE_UNOBSERVED = [
  "",
  "  === against the recorded run ===",
  "    PASSED, STORE UNOBSERVED  pnpm check:verification-decay",
  "      FAILED in the run at 2026-08-14T02:00:00.000Z and PASSED here, with HEAD and the working tree PROVABLY unchanged —",
  "      but this step's verdict also reads the SHARED LIVE STORE, which the tree digest does",
  "      not observe. So repository sameness rules out a code fix and rules out nothing about",
  "      the store: a real store-side repair (yours, or a sibling session's `--pg` write) and",
  "      infrastructure noise look identical from here. This is NOT a flake signature and the",
  "      earlier red is NOT acquitted. If you repaired live state, this is that repair working.",
  "",
  "    None of this is a gate verdict — it compares two runs, and the steps this one did not",
  "    re-execute are NOT RUN above. `pnpm gate` is what gates.",
].join(LF);

// ── the store axis: an unchanged REPOSITORY is not unchanged STATE ───────────

test("fail -> pass over an unchanged tree is NOT a flake when the step reads the live store", () => {
  // The defect this closes: `check:verification-decay` reds on shared proof state, a session repairs
  // that state with a `--pg` write, and the rerun passes with the repository untouched. Calling that
  // a flake signature says "nothing was fixed in between" about the one thing that WAS fixed.
  const rec = soloRecord("pnpm check:verification-decay", "fail");
  const [c] = compareRerun({
    record: rec,
    results: [result("pnpm check:verification-decay", "pass")],
    selected: new Set(["pnpm check:verification-decay"]),
    treeChanged: false,
    readsLiveStore: realReadsLiveStore,
  });
  assert.equal(c?.verdict, "store-unobserved");

  const rendered = renderRerunComparison([c!], rec).join(LF);
  assert.equal(rendered, GOLDEN_STORE_UNOBSERVED);
  // The one claim a golden does not make obvious to a later reader: the ACQUITTING label appears
  // nowhere in it. That is the whole point of the verdict, and it is worth stating separately.
  assert.doesNotMatch(rendered, /FLAKE SIGNATURE/);
});

test("the SAME evidence splits on what the step reads — the control is a repository-only step", () => {
  // A positive control alongside the case above: identical record, identical tree evidence, and the
  // verdicts differ ONLY because one step reads the store. Without this, the test above would pass
  // just as well if every fail->pass had been relabelled.
  const verdicts = ["pnpm check:verification-decay", "pnpm -r --no-bail test"].map((command) => {
    const [c] = compareRerun({
      record: soloRecord(command, "fail"),
      results: [result(command, "pass")],
      selected: new Set([command]),
      treeChanged: false,
      readsLiveStore: realReadsLiveStore,
    });
    return c?.verdict;
  });
  assert.deepEqual(verdicts, ["store-unobserved", "flake-signature"]);
});

test("every declared store-reading check gets the withheld verdict, not just the one in the example", () => {
  // Totality over the declared set, so a check that starts declaring an identity later is covered
  // without a new test — and one that STOPS declaring it changes this assertion, which is the point.
  //
  // THE NON-EMPTINESS GUARD IS THE ASSERTION, not decoration: an emptied set makes the loop below
  // iterate nothing and PASS, while every store-reading step silently returns to claiming
  // `flake-signature`. A test that gets greener as its subject disappears is the fault class this
  // whole arc exists to remove, and it would be reported as coverage.
  const readers = realPlan().filter((step) => step.ciIdentity !== undefined);
  assert.ok(
    readers.length > 5,
    "the plan declares almost no store-reading check, so this test verifies nothing and every " +
      "store-reading step is back to being acquitted by an unchanged repository",
  );
  for (const step of readers) {
    const [c] = compareRerun({
      record: soloRecord(step.command, "fail"),
      results: [result(step.command, "pass")],
      selected: new Set([step.command]),
      treeChanged: false,
      readsLiveStore: realReadsLiveStore,
    });
    assert.equal(c?.verdict, "store-unobserved", `${step.command} reads the live store and must withhold the flake claim`);
  }
});

test("an UNCLASSIFIABLE command withholds the flake claim rather than asserting it", () => {
  // The runner's own default: a command today's plan does not contain answers TRUE. A predicate that
  // answered false for the unknown case would acquit a red on a classification nobody established.
  const command = "pnpm check:a-step-this-plan-does-not-have";
  const [c] = compareRerun({
    record: soloRecord(command, "fail"),
    results: [result(command, "pass")],
    selected: new Set([command]),
    treeChanged: false,
    readsLiveStore: realReadsLiveStore,
  });
  assert.equal(c?.verdict, "store-unobserved");
});

test("readsLiveStore is FALSE for a check that declares no identity, and for a fixed leg", () => {
  // The three answers must differ for the right reasons: `check:boundaries` is disk-only and one of
  // the cheapest rungs in the gate, so it must stay acquittable by an unchanged tree.
  const plan = realPlan();
  const disk = plan.find((s) => s.check === "check:boundaries");
  assert.ok(disk !== undefined);
  assert.equal(readsLiveStore(disk), false);
  const member = plan.find((s) => s.check === "check:agents");
  assert.ok(member !== undefined);
  assert.equal(readsLiveStore(member), true);
  const leg = plan.find((s) => s.check === undefined);
  assert.ok(leg !== undefined);
  assert.equal(readsLiveStore(leg), false, "a fixed leg names no check and reads no store");
});

test("every check's declared identity matches the REAL import closure of its own file", () => {
  // THE MECHANICAL FENCE, so a declaration cannot become prose (ADR-0606 D1: "Keep its import-closure
  // derivation test as the check that a declaration tells the truth about the code"). A check reads the
  // store iff its file's transitive local imports reach the store seam — and since the mirror harness's
  // live arm moved into its own file, that is exact, with no exemption to keep.
  const root = checkoutRoot();
  const discovery = discoverChecks(root, discoverWorkspaceProjects(root).map((p) => p.dir));
  assert.ok(discovery.live.length > 20, "the real tree holds the gate's checks");
  for (const check of discovery.live) {
    const reaches = closureReachesStoreSeam(path.join(root, check.path));
    const declared = check.declaration.ciIdentity !== undefined;
    assert.equal(
      declared,
      reaches,
      reaches
        ? `${check.name}'s imports reach the store seam, but its declaration names no ciIdentity`
        : `${check.name} declares ciIdentity ${String(check.declaration.ciIdentity)}, but its imports never reach the store seam`,
    );
  }
});

test("the store seam scan is not vacuous — a known reader reaches it and a known non-reader does not", () => {
  // Without this control the fence above passes whenever the scan finds nothing at all, which would
  // silently permit every declaration to be wrong in the same direction.
  const src = path.join(checkoutRoot(), "packages/cli/src");
  assert.ok(closureReachesStoreSeam(path.join(src, "check-adr-health.ts")), "check-adr-health dials the store directly");
  assert.ok(
    closureReachesStoreSeam(path.join(src, "check-library-dag-acyclic.ts")),
    "check-library-dag-acyclic reaches it through drive's openCorpusStore, not a direct import",
  );
  assert.ok(
    closureReachesStoreSeam(path.join(src, "check-mirror-conformance-live.ts")),
    "the live mirror arm reaches it through a LAZY import",
  );
  assert.equal(closureReachesStoreSeam(path.join(src, "check-boundaries.ts")), false, "check-boundaries is disk-only");
  assert.equal(
    closureReachesStoreSeam(path.join(src, "check-mirror-conformance.ts")),
    false,
    "the fixtures arm no longer carries the live arm's store import",
  );
});

test("treeChangedSince answers null whenever either side is missing, never false", () => {
  const rec = record({});
  assert.equal(treeChangedSince(rec, "abc1234", "digest-A"), false);
  assert.equal(treeChangedSince(rec, "abc1234", "digest-B"), true);
  assert.equal(treeChangedSince(rec, "def5678", "digest-A"), true, "HEAD moved is a change too");
  assert.equal(treeChangedSince(rec, "abc1234", null), null);
  assert.equal(treeChangedSince(rec, null, "digest-A"), null);
  assert.equal(treeChangedSince({ ...rec, treeDigest: null }, "abc1234", "digest-A"), null);
});

// ── the digest folds in the INSTALLED dependency state ───────────────────────
//
// The escape: fail → `pnpm install` → pass changes nothing git can see, so a git-only digest stayed
// equal and the re-run called the install's fix a FLAKE SIGNATURE ("nothing was fixed in between").

const gitParts = {
  status: () => " M packages/cli/src/a.ts\n",
  diff: () => "diff --git a/packages/cli/src/a.ts b/packages/cli/src/a.ts\n",
  untrackedContent: () => "",
};

test("computeTreeDigest: a changed INSTALLED lockfile moves the digest even when git sees nothing", () => {
  const before = computeTreeDigest({ ...gitParts, installedLockfile: () => "lockfileVersion: '9.0'\nold\n" });
  const after = computeTreeDigest({ ...gitParts, installedLockfile: () => "lockfileVersion: '9.0'\nnew\n" });
  assert.ok(before !== null && after !== null);
  assert.notEqual(before, after, "a `pnpm install` between the runs is a change, not a flake");

  // Carried through to the verdict: the recorded run and this one differ only by the install.
  const rec = { ...record({}), head: "abc1234", treeDigest: before };
  assert.equal(treeChangedSince(rec, "abc1234", after), true);
  assert.equal(treeChangedSince(rec, "abc1234", before), false, "an untouched install is still equal");
});

test("computeTreeDigest: an ABSENT installed lockfile is its own state, distinct from any content", () => {
  const absent = computeTreeDigest({ ...gitParts, installedLockfile: () => undefined });
  const empty = computeTreeDigest({ ...gitParts, installedLockfile: () => "" });
  const constant = computeTreeDigest({ ...gitParts, installedLockfile: () => INSTALLED_LOCKFILE_ABSENT });
  assert.ok(absent !== null);
  assert.notEqual(absent, empty);
  assert.notEqual(absent, constant, "the absent marker is not hashed as if it were file content");
  assert.equal(absent, computeTreeDigest({ ...gitParts, installedLockfile: () => undefined }), "deterministic");
  // A file whose content is the word the reader returns for "absent" is still a PRESENT file.
  assert.notEqual(absent, computeTreeDigest({ ...gitParts, installedLockfile: () => "undefined" }));
  // The marker's exact text: an empty marker would still differ from every content, so only the
  // text itself pins it.
  assert.equal(INSTALLED_LOCKFILE_ABSENT, "installed-lockfile:absent");
});

test("computeTreeDigest: is a sha256 hex digest, and moving a BOUNDARY between two inputs moves it", () => {
  const digest = (status: string, diff: string, untracked: string, lock: string | undefined) =>
    computeTreeDigest({
      status: () => status,
      diff: () => diff,
      untrackedContent: () => untracked,
      installedLockfile: () => lock,
    });
  assert.match(String(digest("s", "d", "u", "l")), /^[0-9a-f]{64}$/);
  // Each pair concatenates to the same bytes, so only the separator between the two fields tells
  // them apart — one pair per separator.
  assert.notEqual(digest("ab", "c", "u", "l"), digest("a", "bc", "u", "l"), "status | diff");
  assert.notEqual(digest("s", "ab", "c", "l"), digest("s", "a", "bc", "l"), "diff | untracked");
  assert.notEqual(
    digest("s", "d", "xinstalled-lockfile:content:", "c"),
    digest("s", "d", "x", "installed-lockfile:content:c"),
    "untracked | installed lockfile",
  );
});

test("computeTreeDigest: any unreadable input is null (cannot tell), never a digest", () => {
  assert.equal(computeTreeDigest({ ...gitParts, installedLockfile: () => null }), null);
  assert.equal(computeTreeDigest({ ...gitParts, status: () => null, installedLockfile: () => "x" }), null);
  assert.equal(computeTreeDigest({ ...gitParts, diff: () => null, installedLockfile: () => "x" }), null);
  assert.equal(computeTreeDigest({ ...gitParts, untrackedContent: () => null, installedLockfile: () => "x" }), null);
});

test("computeTreeDigest: git-visible changes still move the digest", () => {
  const base = computeTreeDigest({ ...gitParts, installedLockfile: () => "x" });
  assert.notEqual(base, computeTreeDigest({ ...gitParts, diff: () => "other", installedLockfile: () => "x" }));
  assert.notEqual(base, computeTreeDigest({ ...gitParts, untrackedContent: () => "h\n", installedLockfile: () => "x" }));
  assert.notEqual(base, computeTreeDigest({ ...gitParts, status: () => "?? b.ts\n", installedLockfile: () => "x" }));
});

test("gate-run.ts's treeDigest reads the installed lockfile node_modules/.pnpm/lock.yaml", () => {
  // gate-run.ts is a script (top-level await), so the one filesystem read is asserted on its source.
  const source = readFileSync(fileURLToPath(new URL("./gate-run.ts", import.meta.url)), "utf8");
  assert.match(source, /installedLockfile: \(\) => \{[\s\S]*?"node_modules", "\.pnpm", "lock\.yaml"/);
  assert.match(source, /code === "ENOENT" \? undefined : null/, "absent is a state; unreadable is null");
});
