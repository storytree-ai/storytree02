/**
 * `a-real-build-runs-on-one-wall-clock` (ADR-0584 D1, increment
 * `workers-have-what-they-need-arc-inc-01`): the spine wiring that makes the budget real.
 *
 * The worker half landed first (PR #1981) and changed no live build, because nothing passed a
 * budget: both authors could stop on one, and none was ever given one. These tests are the other
 * half — that resolving a REAL build constructs ONE clock and hands that same object to every
 * consumer of it.
 *
 * How the author half is observed WITHOUT any spend: ADR-0584 D2 has both runtimes ask the budget
 * before anything else — the Claude worker before the SDK session, the Codex worker before even its
 * login probe — and report a spent budget as `exhausted` with one shared wording. So a genuine
 * `ClaudeAgentAuthor` / `CodexPhaseAuthor` built by the resolver, handed a spent clock, refuses at
 * its own first statement. That refusal is the proof the object reached it: nothing else in either
 * author produces that string, and an author that never received the budget would instead try to
 * run. No network, no login, no subscription spend.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { budgetSpentError } from "@storytree/agent";
import { InMemoryStore } from "@storytree/storage-protocol";

import { loadNodeSpec } from "./node-spec.js";
import { DEFAULT_BUILD_BUDGET_MS } from "./repair.js";
import type { BuildBudget } from "./repair.js";
import { resolveProveSpec } from "./resolve-prove-spec.js";
import type { RealResolveOptions } from "./resolve-prove-spec.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const STORIES_DIR = path.join(REPO_ROOT, "stories");
/** A node with a real arm, resolved off disk — the same one the feedback-wiring tests use. */
const SPEC_FILE = path.join(STORIES_DIR, "notice-board", "tree-view.md");

/**
 * Both live authors resolve their phase prompt BEFORE they ask the budget, and fail closed without
 * one. That ordering costs nothing — a missing brief and a spent clock are both refusals with no
 * spend, so ADR-0584 D2's "before any spend" holds either way — but it does mean a test that omits
 * the prompts never reaches the budget check at all, and would pass or fail for the wrong reason.
 * Supplied here so every assertion below is about the clock.
 */
const PHASE_PROMPTS = {
  AUTHOR_TEST: "you are the red builder",
  IMPLEMENT: "you are the green builder",
};

function realOptions(extra: Partial<RealResolveOptions> = {}): RealResolveOptions {
  return {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-budget",
    signerInputs: { flag: "tester@example.com" },
    phasePrompts: PHASE_PROMPTS,
    ...extra,
  };
}

/** A clock with nothing left: what both authors must refuse before spending anything. */
function spentBudget(budgetMs: number): BuildBudget {
  return {
    budgetMs,
    remainingMs: () => 0,
    mayRepair: () => Promise.resolve({ ok: false, reason: "spent" }),
  };
}

test("a-real-build-runs-on-one-wall-clock: the Claude author and the repair loop are handed the SAME object", async () => {
  const budget = spentBudget(90 * 60_000);
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    runtime: "claude",
    buildBudget: budget,
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  // Identity, not equivalence. Two clocks that merely agree today would drift the moment one is
  // extended, and ADR-0584 D1's whole point is that there is nothing to drift: one object.
  assert.equal(resolved.spec.repair?.budget, budget, "the repair loop polls this exact object");
  assert.equal(resolved.buildBudget, budget, "and the resolver returns that same object to its caller");

  // The author half, observed through its own pre-spend refusal.
  const author = resolved.liveAuthor;
  assert.ok(author !== undefined);
  const result = await author.author("IMPLEMENT", "author the implementation");
  assert.deepEqual(result, {
    ok: false,
    exhausted: true,
    error: budgetSpentError("IMPLEMENT", 90 * 60_000),
  });
});

test("a-real-build-runs-on-one-wall-clock: the Codex author is handed the same object too", async () => {
  const budget = spentBudget(30 * 60_000);
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    runtime: "codex",
    buildBudget: budget,
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.spec.repair?.budget, budget);

  const author = resolved.liveAuthor;
  assert.ok(author !== undefined);
  // Codex asks the budget before its login probe (ADR-0584 D2), so this refuses on a machine with
  // no Codex login at all — which is what makes it a real assertion about the wiring rather than
  // an accident of the environment.
  const result = await author.author("AUTHOR_TEST", "author the test");
  assert.deepEqual(result, {
    ok: false,
    exhausted: true,
    error: budgetSpentError("AUTHOR_TEST", 30 * 60_000),
  });
});

test("a-real-build-runs-on-one-wall-clock: an unset --time-budget leaves the owner's two-hour default", () => {
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({ runtime: "claude" }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const budget = resolved.buildBudget;
  assert.ok(budget !== undefined, "a REAL build always has a clock — there is no unbudgeted real route");
  assert.equal(budget.budgetMs, DEFAULT_BUILD_BUDGET_MS);
  assert.equal(budget.budgetMs, 2 * 60 * 60 * 1000, "two hours, the owner's figure (ADR-0581 D2)");
  // Freshly constructed, so essentially all of it is left. Asserted as a RANGE rather than an exact
  // number because this reads a real clock: what matters is that it counts DOWN from the budget, not
  // that resolution took some particular number of milliseconds.
  const remaining = budget.remainingMs();
  assert.ok(remaining > DEFAULT_BUILD_BUDGET_MS - 60_000, `remaining ${remaining} should be near the whole budget`);
  assert.ok(remaining <= DEFAULT_BUILD_BUDGET_MS, "and never more than the budget itself");
});

test("a-real-build-runs-on-one-wall-clock: the orchestrator's --time-budget sets the clock, and 2h is only a default", () => {
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    runtime: "claude",
    timeBudgetMs: 45 * 60_000,
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.buildBudget?.budgetMs, 45 * 60_000);
  assert.notEqual(resolved.buildBudget?.budgetMs, DEFAULT_BUILD_BUDGET_MS);
});

test("a-real-build-runs-on-one-wall-clock: an injected budget wins over --time-budget, which is only the figure a clock is built FROM", () => {
  // The two options are not alternatives at the same level: `timeBudgetMs` is a NUMBER the resolver
  // builds a clock from, `buildBudget` is the clock itself. A caller supplying both means the clock.
  const budget = spentBudget(5 * 60_000);
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    runtime: "claude",
    timeBudgetMs: 45 * 60_000,
    buildBudget: budget,
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.buildBudget, budget);
  assert.equal(resolved.buildBudget?.budgetMs, 5 * 60_000);
});

test("a-real-build-runs-on-one-wall-clock: a budget is wired even behind an injected author, so an offline walk repairs on a clock", () => {
  // The budget is constructed before the `authorOverride` fork: an offline wiring walk still drives
  // the in-build repair loop, and a loop with no budget would never terminate on time.
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    authorOverride: { author: () => Promise.resolve({ ok: true as const }) },
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.liveAuthor, undefined, "an injected author is not a live leaf");
  assert.ok(resolved.buildBudget !== undefined, "but the walk still has a clock");
  assert.equal(resolved.spec.repair?.budget, resolved.buildBudget);
});

test("a-real-build-runs-on-one-wall-clock: an explicit --max-turns is still honoured beside the budget (ADR-0584 D5)", async () => {
  // The turn cap stops being the BRAKE, not the flag. This asserts the budget still refuses first —
  // an operator who set both gets the clock, because that is the one that bounds the whole build.
  const budget = spentBudget(60 * 60_000);
  const resolved = resolveProveSpec(loadNodeSpec(SPEC_FILE), realOptions({
    runtime: "claude",
    maxTurns: 40,
    buildBudget: budget,
  }));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const author = resolved.liveAuthor;
  assert.ok(author !== undefined);
  const result = await author.author("IMPLEMENT", "author the implementation");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.exhausted : undefined, true);
});
