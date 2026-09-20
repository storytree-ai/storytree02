/**
 * `--runtime pi` IS WIRED (ADR-0449, `pi-harness-admission-arc` increment 3) — the offline half of
 * the live run, pinned.
 *
 * Increments 1 and 2 built the fence and the leaf and left `resolveLiveRuntime` REFUSING `pi`, with
 * a test asserting that refusal, precisely so the path could not open by someone widening a union.
 * This file is the deliberate replacement: it asserts the ADMISSION, and — more usefully — it
 * asserts the two properties that admission could plausibly have broken.
 *
 * ## THE COLLISION THESE TESTS EXIST FOR
 *
 * ADR-0449 says point the run at ANTHROPIC. `validatePiEndpoint` (wall 1) refuses a `providerId`
 * that is a pi BUILT-IN, and `anthropic` is one. A session reading only the ADR writes
 * `providerId: "anthropic"` and meets its own first wall; a session reading only the wall widens
 * the wall and re-opens pi's environment-variable key resolution, which is the door the leaf exists
 * to shut. Neither is right. So the composed endpoint is asserted to satisfy BOTH: a fresh provider
 * id that wall 1 accepts, carrying the subscription credential that wall 5 accepts.
 *
 * That works because pi's OAuth dispatch keys on the TOKEN VALUE and never on `model.provider` —
 * `pi-ai`'s `dist/api/anthropic-messages.js`, `isOAuthToken(apiKey)`. These tests cannot reach that
 * (it is pi's code and needs a live call), so they pin OUR half: the composition our walls admit.
 * The live half was measured — 2026-09-01, this exact composition drove a full
 * AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE walk to a signed PASS.
 *
 * ## AND WHAT IS DELIBERATELY *NOT* WIDENED
 *
 * ADR-0449 authorised ONE trial run through the live smoke. `--real` authors at real repo paths and
 * promotes a commit toward main; admitting an as-yet-unproven third harness to that is a separate
 * decision nobody has taken. So the narrowing did not disappear when `resolveLiveRuntime` opened —
 * it MOVED, and these tests are where that is held.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PiPhaseAuthor, validatePiEndpoint } from "@storytree/agent";
import {
  PI_SUBSCRIPTION_DEFAULT_MODEL,
  PI_SUBSCRIPTION_PROVIDER_ID,
  composePiSubscriptionEndpoint,
} from "@storytree/orchestrator";

import {
  PI_LEAF_ENDPOINT_LABEL,
  honestFramingLive,
  liveLeafLines,
  nodeBuild,
  nodeHelp,
  resolveLiveRuntime,
} from "./node-build.js";
import { storyBuild, storyHelp } from "./story-build.js";
// Every --real/--live storyBuild here injects a scripted curator, so no mutant that lets a refusal
// through can reach the live SDK curator (a test process is refused it anyway, `curate.ts`).
import { ScriptedCuratorRunner } from "./curate.js";
import { cannedLiveAuthor } from "./real-chain-fixture.js";

/** A token shaped like the real subscription credential. NOT a credential — no such account. */
const FAKE_SUBSCRIPTION_TOKEN = "sk-ant-oat01-not-a-real-token-fixture";
/** A token shaped like a METERED per-token key — the thing ADR-0449 forbids. */
const FAKE_METERED_KEY = "sk-ant-api03-not-a-real-key-fixture";

test("resolveLiveRuntime ADMITS pi — the increment-2 refusal, changed on purpose", () => {
  const pi = resolveLiveRuntime("pi");
  assert.equal(pi.ok, true);
  assert.equal(pi.ok && pi.runtime, "pi");

  // ADR-0555 makes Codex the omitted-value default; both explicit routes remain available, and an
  // unknown runtime still fails closed naming all three.
  assert.deepEqual(resolveLiveRuntime("claude"), { ok: true, runtime: "claude" });
  assert.deepEqual(resolveLiveRuntime("codex"), { ok: true, runtime: "codex" });
  assert.deepEqual(resolveLiveRuntime(undefined), { ok: true, runtime: "codex" });
  const unknown = resolveLiveRuntime("llama");
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok === false ? unknown.reason : "", /unknown --runtime "llama"/);
  assert.match(unknown.ok === false ? unknown.reason : "", /"pi"/);
});

test("Codex-default help and invalid-runtime recovery are visible on both build verbs", async () => {
  const nodeMode = await nodeBuild("verdict-line", {
    dryRun: false,
    actor: "t@example.com",
  });
  assert.equal(nodeMode.ok, false);
  assert.match(nodeMode.body, /add\(2,3\) pair through the gate \(default: codex\)/);

  const nodeRuntime = await nodeBuild("verdict-line", {
    dryRun: false,
    live: true,
    runtime: "llama" as never,
    actor: "t@example.com",
  });
  assert.deepEqual(nodeRuntime, {
    ok: false,
    body: 'unknown --runtime "llama" — choose "claude", "codex" or "pi"',
    next: ["storytree node build verdict-line --live --runtime codex"],
  });

  const storyMode = await storyBuild("library", {
    dryRun: false,
    actor: "t@example.com",
  });
  assert.equal(storyMode.ok, false);
  assert.match(storyMode.body, /--runtime claude\|codex; Codex default/);

  const storyRuntime = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "llama" as never,
    actor: "t@example.com",
  });
  assert.deepEqual(storyRuntime, {
    ok: false,
    body: 'unknown --runtime "llama" — choose "claude", "codex" or "pi"',
    next: ["storytree story build library --live --runtime codex"],
  });

  assert.match(
    String(nodeHelp().body),
    /the live smoke: a REAL subscription-funded leaf \(Codex by default, Claude explicit\) authors/,
  );
  assert.match(
    String(storyHelp().body),
    /the same chain with a REAL subscription leaf per node \(Codex default, Claude explicit\)/,
  );
});

test("the node and story help put --increment on the paid --real form, say it is required, and list the node ledger verbs one line each", () => {
  const node = nodeHelp().body.split("\n");
  assert.ok(
    node.includes(
      "  storytree node build <id> --real --increment <id> [--runtime claude|codex] [--model <id>] [--budget <usd>] [--max-turns <n>] [--time-budget <minutes>] [--actor <email>]",
    ),
    nodeHelp().body,
  );
  const nodeAt = node.indexOf(
    "      --increment <id> is REQUIRED with --real and refused without it: the arc increment the attempt",
  );
  assert.deepEqual(node.slice(nodeAt, nodeAt + 8), [
    "      --increment <id> is REQUIRED with --real and refused without it: the arc increment the attempt",
    "      is filed under. The unit's attempt ledger is read before any spend and can refuse the build (ADR-0576).",
    "",
    "  storytree node attempts <id> --pg                read a unit's attempt ledger and the entry state it leaves",
    "  storytree node grant <id> --attempts <n> --kind <kind> --difference <text|@file> --pg   record further attempts past the decision point",
    "  storytree node adjudicate <id> --run <run-id> [--objection <kind> --statement <text|@file>] --pg   rule on a run's signed pass",
    "",
    "  --store     (--live/--real) ALWAYS pg (ADR-0060/0081): the build owns the DB — it",
  ]);

  const story = storyHelp().body.split("\n");
  assert.ok(
    story.includes(
      "  storytree story build <story-id> --real --increment <id> [--runtime claude|codex] [--budget <usd>] [--model <id>] [--max-turns <n>] [--time-budget <minutes>] [--actor <email>]",
    ),
    storyHelp().body,
  );
  const storyAt = story.indexOf("      refuses a fake USD cap.");
  assert.deepEqual(story.slice(storyAt, storyAt + 4), [
    "      refuses a fake USD cap.",
    "      --increment <id> is REQUIRED with --real and refused without it: the whole chain is ONE unit on",
    "      the attempt ledger, the story id, preflighted with every driven member before any spend (ADR-0576 D7).",
    "",
  ]);
});

test("the build verbs' argument refusals print every paid --real retry with the increment it must name, and no --live retry with one", async () => {
  // ADR-0576 D1: a paid REAL build names `--increment <id>` or is refused as written, so a refusal
  // that suggests one prints the flag; a `--live` or `--dry-run` suggestion never carries it.
  const nodeMode = await nodeBuild("verdict-line", { dryRun: false, actor: "t@example.com" });
  assert.deepEqual(nodeMode.next, [
    "storytree node build verdict-line --dry-run",
    "storytree node build verdict-line --live",
    "storytree node build verdict-line --real --increment <increment-id>",
  ]);
  const storyMode = await storyBuild("library", { dryRun: false, actor: "t@example.com" });
  assert.deepEqual(storyMode.next, [
    "storytree story build library --dry-run",
    "storytree story build library --live",
    "storytree story build library --real --increment <increment-id>",
  ]);
  const noStory = await storyBuild(undefined, { dryRun: true, actor: "t@example.com" });
  assert.deepEqual(noStory, {
    ok: false,
    body: "story build needs a story id: storytree story build <story-id> --dry-run | --live | --real --increment <increment-id>",
    next: ["storytree story build library --dry-run"],
  });

  // The two Codex refusals (a USD cap, a turn count other than 1), on both verbs, in both paid-leaf modes.
  const nodeRealBudget = await nodeBuild("verdict-line", {
    dryRun: false,
    real: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.deepEqual(nodeRealBudget.next, ["storytree node build verdict-line --real --increment <increment-id> --runtime codex"]);
  const nodeLiveBudget = await nodeBuild("verdict-line", {
    dryRun: false,
    live: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.deepEqual(nodeLiveBudget.next, ["storytree node build verdict-line --live --runtime codex"]);
  const nodeRealTurns = await nodeBuild("verdict-line", {
    dryRun: false,
    real: true,
    runtime: "codex",
    maxTurns: 2,
    actor: "t@example.com",
  });
  assert.deepEqual(nodeRealTurns.next, ["storytree node build verdict-line --real --increment <increment-id> --runtime codex"]);
  const nodeLiveTurns = await nodeBuild("verdict-line", {
    dryRun: false,
    live: true,
    runtime: "codex",
    maxTurns: 2,
    actor: "t@example.com",
  });
  assert.deepEqual(nodeLiveTurns.next, ["storytree node build verdict-line --live --runtime codex"]);

  const storyRealBudget = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.deepEqual(storyRealBudget.next, ["storytree story build library --real --increment <increment-id> --runtime codex"]);
  const storyLiveBudget = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.deepEqual(storyLiveBudget.next, ["storytree story build library --live --runtime codex"]);
  const storyRealTurns = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    runtime: "codex",
    maxTurns: 2,
    actor: "t@example.com",
  });
  assert.deepEqual(storyRealTurns.next, ["storytree story build library --real --increment <increment-id> --runtime codex"]);
  const storyLiveTurns = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "codex",
    maxTurns: 2,
    actor: "t@example.com",
  });
  assert.deepEqual(storyLiveTurns.next, ["storytree story build library --live --runtime codex"]);
});

test("the composed endpoint satisfies OUR OWN walls — wall 1 does not have to be widened", () => {
  const composed = composePiSubscriptionEndpoint({
    env: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_SUBSCRIPTION_TOKEN },
  });
  assert.equal(composed.ok, true);
  if (!composed.ok) return;

  // Wall 1: NOT a pi built-in. This is the assertion that fails the day someone "fixes" the
  // collision by pointing the endpoint at `anthropic`.
  assert.notEqual(composed.endpoint.providerId, "anthropic");
  assert.equal(composed.endpoint.providerId, PI_SUBSCRIPTION_PROVIDER_ID);

  // Wall 5: the credential clauses. `anthropic-messages` is the ONLY dialect under which pi
  // inspects the token's shape; under any other the same string goes out as a plain bearer key,
  // which is the metered wire shape wearing the right string.
  assert.equal(composed.endpoint.api, "anthropic-messages");
  assert.equal(composed.endpoint.apiKey, FAKE_SUBSCRIPTION_TOKEN);
  assert.equal(composed.endpoint.baseUrl, "https://api.anthropic.com");
  assert.equal(composed.endpoint.modelId, PI_SUBSCRIPTION_DEFAULT_MODEL);

  // The whole endpoint, through the leaf's own validator — every wall at once, not a re-derivation.
  assert.equal(validatePiEndpoint(composed.endpoint).ok, true);
});

test("a METERED key in the credential variable is refused by wall 5, not quietly spent", () => {
  // The composer does not judge the token — it is a composition root, not a wall — so this proves
  // the refusal is the LEAF's and would fire however the endpoint was assembled.
  const composed = composePiSubscriptionEndpoint({
    env: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_METERED_KEY },
  });
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  const walls = validatePiEndpoint(composed.endpoint);
  assert.equal(walls.ok, false);
  assert.match(walls.ok === false ? walls.error : "", /not a Claude subscription token/);
});

test("an ABSENT or BLANK credential is refused at composition, naming the variable", () => {
  for (const env of [{}, { CLAUDE_CODE_OAUTH_TOKEN: "" }, { CLAUDE_CODE_OAUTH_TOKEN: "   " }]) {
    const composed = composePiSubscriptionEndpoint({ env });
    assert.equal(composed.ok, false, `expected refusal for ${JSON.stringify(env)}`);
    // Naming the variable is the point: wall 5 would refuse a blank credential too, but it cannot
    // say WHICH variable was empty, and `VAR=` is how a shell says "not configured".
    assert.match(composed.ok === false ? composed.reason : "", /CLAUDE_CODE_OAUTH_TOKEN/);
    // And it must never suggest a fallback: there is no metered route to reach for (ADR-0198).
    assert.doesNotMatch(composed.ok === false ? composed.reason : "", /ANTHROPIC_API_KEY/);
  }
});

test("--model overrides the endpoint's model id but nothing else about the endpoint", () => {
  const composed = composePiSubscriptionEndpoint({
    model: "claude-opus-5",
    env: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_SUBSCRIPTION_TOKEN },
  });
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.equal(composed.endpoint.modelId, "claude-opus-5");
  // Still fresh, still the credential dialect — a model override cannot walk the endpoint onto a
  // built-in provider or off the one adapter that recognises a subscription token.
  assert.equal(composed.endpoint.providerId, PI_SUBSCRIPTION_PROVIDER_ID);
  assert.equal(composed.endpoint.api, "anthropic-messages");
  assert.equal(validatePiEndpoint(composed.endpoint).ok, true);
});

// ── The two REPORTING surfaces, which only a live run otherwise reaches ─────────────────────────

test("the pi build envelope NAMES ADR-0449's frontier-model gap — the requirement, not a comment", () => {
  // ADR-0449's Consequences: "If pi is admitted on the strength of this run alone, that gap should
  // be named in the admission record, not silently dropped." This is where that is discharged, and
  // it is discharged by a MECHANISM (printed on every pi build) rather than by whoever writes the
  // admission up remembering. Deleting the clause reds this test.
  // A SIGNED walk throughout: the refusal wording is pinned in node-build-framing.test.ts.
  const pi = honestFramingLive(false, { ok: true }, "pi", "library-cli");
  // The WHOLE clause, newlines collapsed — asserted as one sentence rather than three keywords,
  // because a keyword set survives having most of the sentence deleted around it.
  assert.match(
    pi.replace(/\s+/g, " "),
    /ADR-0449 GAP, NAMED: this run exercised pi's fence under a FRONTIER model \(the subscription Claude endpoint\), NOT the weaker local open-weight model pi would run day to day — which is the kind of model the trial exists to find an alternative to\. A pass here is evidence about the fence under a capable model only\./,
  );
  // And it names the leaf that actually ran, not the Codex default.
  assert.match(pi, /pi agent loop against Anthropic on the subscription credential/);
  assert.match(pi, /under pi's in-process tool_call fence/);
  // The shared tail is still present — the gap is APPENDED to the framing, never a replacement.
  assert.match(pi, /The node's authored status is untouched/);
  assert.match(pi, /the verdict landed in an in-memory store and is gone/);
  assert.match(honestFramingLive(true, { ok: true }, "pi", "library-cli"), /signed verdict PERSISTED/);

  // The gap clause is pi-SPECIFIC: the other two runtimes do not carry a claim about pi's fence,
  // and each still names its OWN leaf (so "no pi text" is not satisfied by an empty framing).
  const claude = honestFramingLive(false, { ok: true }, "claude", "library-cli");
  assert.doesNotMatch(claude, /ADR-0449 GAP/);
  assert.doesNotMatch(claude, /pi agent loop/);
  assert.match(claude, /the Claude Agent SDK with subscription authentication/);
  const codex = honestFramingLive(false, { ok: true }, "codex", "library-cli");
  assert.doesNotMatch(codex, /ADR-0449 GAP/);
  assert.match(codex, /the Codex CLI with saved ChatGPT subscription authentication/);
  // The non-pi framings must end with NOTHING appended — `doesNotMatch(/ADR-0449 GAP/)` alone would
  // hold while some other string was being tacked on. Asserted as an exact ending.
  const tail = "the verdict landed in an in-memory store and is gone.";
  assert.ok(claude.endsWith(tail), `claude framing must end at ${tail}, got: ${claude.slice(-120)}`);
  assert.ok(codex.endsWith(tail), `codex framing must end at ${tail}, got: ${codex.slice(-120)}`);
});

test("liveLeafLines renders a pi run EXACTLY, and keeps the two wall kinds apart", () => {
  // A genuine leaf instance with pushed rows — the `cannedLiveAuthor` shape. Nothing is driven and
  // no endpoint is contacted; this exercises the REPORTING fold, which a live run would otherwise
  // be the only way to reach.
  //
  // ⚠ ASSERTED AS EXACT LINES, and that is not pedantry — it is a correction. This test first
  // checked the leaf line with `clean.includes(PI_LEAF_ENDPOINT_LABEL)`, which is an expectation
  // DERIVED FROM ITS SUBJECT: blank the constant and `includes("")` is still true, so the assertion
  // could not fail. The mutation rung is what caught it. The label is spelled out below instead.
  const author = new PiPhaseAuthor({
    cwd: process.cwd(),
    isWriteAllowed: () => true,
    endpoint: {
      providerId: PI_SUBSCRIPTION_PROVIDER_ID,
      baseUrl: "https://api.anthropic.com",
      modelId: PI_SUBSCRIPTION_DEFAULT_MODEL,
      api: "anthropic-messages",
      contextWindow: 200_000,
      maxTokens: 8_192,
      apiKey: FAKE_SUBSCRIPTION_TOKEN,
    },
  });

  const COST =
    "cost:        not metered — Claude subscription draw via CLAUDE_CODE_OAUTH_TOKEN " +
    "(ADR-0449; no API/list-price USD asserted)";
  const FEEDBACK = "feedback:    none — the spine reruns every registered proof command out of band";

  // BEFORE any slice: the empty-runs fallback. A leaf that ran nothing must SAY so — an empty
  // parenthesis would read as a run that happened and reported nothing. And no tokens line at all,
  // rather than an empty one.
  assert.deepEqual(liveLeafLines(author), [
    "leaf:        pi → Anthropic on the subscription credential (fresh provider id) (no slices ran)",
    COST,
    "scope walls: no write refusals",
    "tool surface: no off-surface tool calls",
    FEEDBACK,
  ]);

  // TWO slices, and deliberately only ONE of them reporting usage. A single row cannot observe a
  // join separator (nothing to join) and cannot observe the usage filter at all (every row looks
  // the same), so a one-row fixture leaves both silently unproven.
  author.runs.push({
    phase: "AUTHOR_TEST",
    source: "pi-leaf",
    subtype: "success",
    turns: 2,
    model: "m",
    usage: {
      inputTokens: 2,
      outputTokens: 122,
      cacheReadInputTokens: 27974,
      cacheCreationInputTokens: 174,
    },
  });
  author.runs.push({
    phase: "IMPLEMENT",
    source: "pi-leaf",
    subtype: "success",
    turns: 3,
    model: "m",
    usage: {
      inputTokens: 2,
      outputTokens: 40,
      cacheReadInputTokens: 11967,
      cacheCreationInputTokens: 115,
    },
  });
  // A THIRD slice reporting no usage at all. Two-with-usage is what makes the tokens separator
  // observable; the third is what makes the additive-accounting filter observable. One fixture
  // cannot do both, which is why there are three rows and not two.
  author.runs.push({ phase: "IMPLEMENT", source: "pi-leaf", subtype: "refused-preflight", turns: 0, model: "m" });

  assert.deepEqual(liveLeafLines(author), [
    "leaf:        pi → Anthropic on the subscription credential (fresh provider id) " +
      "(AUTHOR_TEST: success, 2 turns; IMPLEMENT: success, 3 turns; " +
      "IMPLEMENT: refused-preflight, 0 turns)",
    COST,
    // Only the slices that REPORTED usage appear — accounting is additive, and inventing a zero row
    // for the third would be a claim about tokens nobody counted.
    "tokens:      AUTHOR_TEST: 122 out / 2 in / 27974 cache-read / 174 cache-write; " +
      "IMPLEMENT: 40 out / 2 in / 11967 cache-read / 115 cache-write",
    "scope walls: no write refusals",
    "tool surface: no off-surface tool calls",
    FEEDBACK,
  ]);
  // NEVER a USD figure: pi meters nothing this process can read, and printing a zero would be a
  // claim about spend rather than the absence of one (ADR-0232's reasoning, ADR-0449's credential).
  assert.doesNotMatch(liveLeafLines(author).join("\n"), /\$[0-9]/);

  // Now the two wall kinds together. They must NOT be folded: a `tool-surface` refusal carries no
  // path and is not a write-fence firing, so counting it as one inflates the single number that
  // line exists to report (the ADR-0446 split, applied to the human-readable surface).
  //
  // The two refusals are given DIFFERENT phases and paths on purpose. Sharing them would let a
  // fold-them-together bug render something that still reads correct: the shell refusal's path is
  // "(no path)", so a scope line that wrongly swallowed it would not contain the word "bash" and a
  // `doesNotMatch(/bash/)` check would pass over the very bug it was written for.
  author.violations.push({
    phase: "AUTHOR_TEST",
    tool: "write",
    path: "impl.cjs",
    reason: "write refused by phase scope",
    kind: "scope",
  });
  author.violations.push({
    phase: "IMPLEMENT",
    tool: "bash",
    path: "(no path)",
    reason: "not on the authoring tool surface",
    kind: "tool-surface",
  });
  author.violations.push({
    phase: "IMPLEMENT",
    tool: "edit",
    path: "unit.test.cjs",
    reason: "write refused by phase scope",
    kind: "scope",
  });
  author.violations.push({
    phase: "AUTHOR_TEST",
    tool: "powershell",
    path: "(no path)",
    reason: "not on the authoring tool surface",
    kind: "tool-surface",
  });
  const walls = liveLeafLines(author);
  assert.equal(walls[3], "scope walls: AUTHOR_TEST:impl.cjs, IMPLEMENT:unit.test.cjs");
  assert.equal(walls[4], "tool surface: IMPLEMENT:bash, AUTHOR_TEST:powershell");
});

test("liveLeafLines routes a NON-pi runtime away from the pi branch", () => {
  // The pi branch is selected on `runtime`, so a mutant that makes that test always-true would
  // render a Claude run as a pi run — and no pi-only test can see that. Cheap structural control.
  const claude = liveLeafLines(cannedLiveAuthor([])).join("\n");
  assert.match(claude, /leaf: +Claude Agent SDK/);
  assert.doesNotMatch(claude, /Anthropic on the subscription credential/);
  assert.doesNotMatch(claude, /^tool surface:/m, "only pi has a tool-surface wall");
  // And the Claude leaf DOES assert a USD figure — the line pi deliberately omits.
  assert.match(claude, /cost: +\$0\.0000 SDK-reported/);
});

// ── The narrowing, asserted IN THIS PACKAGE ────────────────────────────────────────────────────
//
// `packages/cli` drives both verbs through `run()` and asserts the same refusals. These are not
// duplicates of those: the refusals LIVE here, and a guard whose only test sits in another package
// is one the mutation rung cannot attribute — it reported these very lines as reached by nothing.
// Same reason the fence's scope predicate is proved where it is consumed rather than where it is
// declared. Neither call spends: both refuse before any leaf is constructed.

test("nodeBuild REFUSES --runtime pi with --real, and refuses a USD cap on it", async () => {
  const real = await nodeBuild("library-cli", {
    dryRun: false,
    real: true,
    runtime: "pi",
    actor: "t@example.com",
  });
  assert.equal(real.ok, false);
  // The WHOLE message. A regex on its first clause leaves the continuation strings unpinned, and
  // the refusal's value is precisely that it says what it is protecting rather than just saying no.
  assert.equal(
    real.body,
    "--runtime pi is admitted for --live only (ADR-0449 authorises ONE trial run through the "
      + "live smoke, not a promotion path). A --real build authors at real repo paths and promotes "
      + "a commit toward main; widening pi to that is a separate decision.",
  );

  const budget = await nodeBuild("library-cli", {
    dryRun: false,
    live: true,
    runtime: "pi",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.equal(budget.ok, false);
  assert.equal(
    budget.body,
    "--budget is unavailable with --runtime pi: the run draws on the Claude subscription "
      + "credential (ADR-0449) and pi reports no honest USD spend. Drop --budget — --max-turns is "
      + "the leaf's real cost guard.",
  );

  // CONTROL for the budget guard: pi + --live with NO budget must fall THROUGH it. An unknown node
  // id is what makes that free — the "no node spec" refusal sits just past these guards, so this
  // never reaches a leaf. Under a mutant that drops the `budgetUsd !== undefined` test, this would
  // be refused by the budget guard instead, and the assertions below are that discrimination.
  const piNoBudget = await nodeBuild("no-such-node-fixture", {
    dryRun: false,
    live: true,
    runtime: "pi",
    actor: "t@example.com",
  });
  assert.equal(piNoBudget.ok, false);
  assert.doesNotMatch(piNoBudget.body, /--budget is unavailable/);
  assert.match(piNoBudget.body, /no node spec "no-such-node-fixture"/);

  // The retry hint must point at the shape that WORKS. A refusal that names no way forward is the
  // thing this repo's envelopes exist to avoid.
  assert.ok(
    (real.next ?? []).some((n) => n.includes("--live") && n.includes("--runtime pi")),
    `the refusal must offer the admitted shape: ${JSON.stringify(real.next)}`,
  );
  assert.ok((budget.next ?? []).some((n) => n.includes("--runtime pi")));

  // THE CONTROL — a NON-pi runtime with `--real`, which must fall THROUGH these guards.
  //
  // Its shape is chosen so it costs nothing, and that took two wrong attempts worth recording. The
  // `&&` is only distinguishable from `||` on an input where exactly one operand is true: `pi`
  // without `--real`, or `--real` without `pi`. The first drives a live pi chain; the second, on a
  // real-buildable node, drives a REAL build — measured at 151s and 112s of genuine spend before
  // each was removed. A test must never be the thing that spends.
  //
  // `codex + --real + --budget` is the way out: the codex guards sit immediately AFTER the pi
  // guards, so this falls through the ones under test and is refused by the next one, in
  // milliseconds. Under the `||` mutant it would be refused by the PI guard instead, and the two
  // assertions below are exactly that discrimination.
  const codexReal = await nodeBuild("verdict-line", {
    dryRun: false,
    real: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.equal(codexReal.ok, false);
  assert.doesNotMatch(codexReal.body, /--runtime pi is admitted/);
  assert.doesNotMatch(codexReal.body, /--budget is unavailable with --runtime pi/);
  assert.match(codexReal.body, /--budget is unavailable with --runtime codex/);
});

test("storyBuild REFUSES --runtime pi with --real, and refuses a USD cap on it", async () => {
  const real = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    runtime: "pi",
    actor: "t@example.com",
  });
  assert.equal(real.ok, false);
  assert.equal(
    real.body,
    "--runtime pi is admitted for --live only (ADR-0449 authorises ONE trial run through the "
      + "live smoke, not a promotion path). A --real build authors at real repo paths and promotes "
      + "a commit toward main; widening pi to that is a separate decision.",
  );

  const budget = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "pi",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.equal(budget.ok, false);
  assert.equal(
    budget.body,
    "--budget is unavailable with --runtime pi: the run draws on the Claude subscription "
      + "credential (ADR-0449) and pi reports no honest USD spend. Drop --budget — --max-turns is "
      + "the leaf's real cost guard.",
  );

  // The same free control as the node arm: an unknown story id refuses just past these guards.
  const piNoBudget = await storyBuild("no-such-story-fixture", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "pi",
    actor: "t@example.com",
  });
  assert.equal(piNoBudget.ok, false);
  assert.doesNotMatch(piNoBudget.body, /--budget is unavailable/);

  assert.ok(
    (real.next ?? []).some((n) => n.includes("--live") && n.includes("--runtime pi")),
    `the refusal must offer the admitted shape: ${JSON.stringify(real.next)}`,
  );
  assert.ok((budget.next ?? []).some((n) => n.includes("--runtime pi")));

  // The same control, for the same reason — see the note in the nodeBuild test above.
  const codexReal = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    runtime: "codex",
    budgetUsd: 1,
    actor: "t@example.com",
  });
  assert.equal(codexReal.ok, false);
  assert.doesNotMatch(codexReal.body, /--runtime pi is admitted/);
  assert.doesNotMatch(codexReal.body, /--budget is unavailable with --runtime pi/);
  assert.match(codexReal.body, /--budget is unavailable with --runtime codex/);
});
