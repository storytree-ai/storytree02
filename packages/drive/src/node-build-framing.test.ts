// A refused build's honest framing stops claiming a signed verdict persisted
// (`verification-integrity-arc`, increment `refused-build-framing-stops-claiming-a-signature`).
//
// THE MEASURED FAILURE. Run `real-mtsqwotf` printed `verdict: NONE — failed closed at CONFIRM_GREEN`
// and then, in the same envelope, "What DID persist: the signed verdict — events.verdict". The
// framing read `persisted`, which says where a verdict WOULD go — `true` for every `--store pg`
// build — and never whether the gate signed one. `--real` always persists (ADR-0060/0081), so every
// refused real build told its reader that a signature existed.
//
// WHY THE RENDERERS ARE CALLED DIRECTLY. `nodeBuild`'s `--real` and `--live` arms cannot be reached
// offline: `NodeBuildOpts` has no author seam, by design (ADR-0243 D4). So `nodeBuild` hands its
// `ProveResult` to these two renderers as an identifier, and every decision about the outcome is
// made inside them, where a test can see it.
//
// Proof: pnpm --filter @storytree/drive exec bun test --preload ../../scripts/tsx-cache-off.mjs src/node-build-framing.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { honestFramingLive, honestFramingReal, nodeHelp } from "./node-build.js";

const REFUSED = { ok: false };
const SIGNED = { ok: true };
const PERSISTED = true;
const IN_MEMORY = false;

test("a REFUSED real build on the shared store claims no signed verdict, and says none was signed", () => {
  const framing = honestFramingReal(PERSISTED, REFUSED, undefined, undefined, "codex");
  assert.doesNotMatch(framing, /signed verdict/, framing);
  assert.doesNotMatch(framing, /What DID persist/, framing);
  assert.match(framing, /No verdict was signed/, framing);
});

test("a SIGNED real build on the shared store still names the signed verdict that persisted", () => {
  const framing = honestFramingReal(PERSISTED, SIGNED, undefined, "green", "codex");
  assert.match(framing, /What DID persist: the signed verdict — events\.verdict in the shared store/, framing);
});

test("a REFUSED real build in memory does not say a verdict landed there", () => {
  const framing = honestFramingReal(IN_MEMORY, REFUSED, undefined, undefined, "claude");
  assert.doesNotMatch(framing, /the verdict\s+landed/, framing);
  assert.match(framing, /No verdict was signed/, framing);
});

test("a real build refused by its backstop does not say the verdict was signed after the typecheck ran", () => {
  const framing = honestFramingReal(PERSISTED, REFUSED, undefined, "red", "claude");
  assert.doesNotMatch(framing.replace(/\s+/g, " "), /BEFORE the verdict was signed/, framing);
});

test("a REFUSED live smoke claims no persisted verdict, on either store", () => {
  for (const persisted of [PERSISTED, IN_MEMORY]) {
    const framing = honestFramingLive(persisted, REFUSED, "codex", "library-cli");
    assert.doesNotMatch(framing, /signed verdict PERSISTED/, framing);
    assert.doesNotMatch(framing, /the verdict landed/, framing);
    assert.match(framing, /no verdict was signed/, framing);
  }
});

test("a SIGNED live smoke on the shared store still says its signed verdict persisted", () => {
  const framing = honestFramingLive(PERSISTED, SIGNED, "codex", "library-cli");
  assert.match(framing, /the signed verdict PERSISTED to the shared store/, framing);
});

// ---------- the OPENING follows the phase the walk actually reached ----------
//
// (`verification-integrity-arc`, increment `node-build-framing-opening-follows-the-phase`.)
//
// PR #1944 fixed the persistence CLAUSE and left the OPENING, which narrated the pass path in the
// past tense whatever happened: "the node's declared REAL proof command run by the spine for both
// red and green, a spine-side commit of the authored files, and a GATE that read genuine
// `git status`" — printed a few lines above the envelope's own
// `verdict: NONE — failed closed at AUTHOR_TEST`. The live framing opened the same way, with "the
// spine observed the genuine red→green those writes caused".
//
// The phases are ORDERED — AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE (ADR-0020) —
// so `failedAt` says exactly how far the walk got, and nothing after it happened.
//
// THE COMMIT IS GATE'S OWN FIRST ACT, which is the non-obvious one and the reason the commit clause
// moved too. `commitAuthored` is called by the `treeState` seam (`resolve-prove-spec.ts`), and GATE
// is what calls that seam — so a refusal BEFORE gate has no commit behind it at all, and must not
// say "the authored commit was not promoted".

const AT_AUTHOR_TEST = { ok: false, failedAt: "AUTHOR_TEST" } as const;
const AT_CONFIRM_RED = { ok: false, failedAt: "CONFIRM_RED" } as const;
const AT_IMPLEMENT = { ok: false, failedAt: "IMPLEMENT" } as const;
const AT_CONFIRM_GREEN = { ok: false, failedAt: "CONFIRM_GREEN" } as const;
const AT_GATE = { ok: false, failedAt: "GATE" } as const;

test("a real build refused at AUTHOR_TEST does not claim the proof command ran or a gate read the tree", () => {
  const framing = honestFramingReal(PERSISTED, AT_AUTHOR_TEST, undefined, undefined, "codex");
  assert.doesNotMatch(framing, /run by the spine for\s+both red and green/, framing);
  assert.doesNotMatch(framing, /a GATE that read genuine/, framing);
  assert.match(framing, /never ran the proof command/, framing);
});

test("a real build refused BEFORE the gate does not speak of an authored commit", () => {
  for (const outcome of [AT_AUTHOR_TEST, AT_CONFIRM_RED, AT_IMPLEMENT, AT_CONFIRM_GREEN]) {
    const framing = honestFramingReal(PERSISTED, outcome, undefined, undefined, "claude");
    assert.doesNotMatch(framing, /the authored commit was not promoted/, framing);
    assert.match(framing, /no commit was made/, framing);
  }
});

test("a real build refused at CONFIRM_RED says the red was not observed, and claims no implementation", () => {
  const framing = honestFramingReal(PERSISTED, AT_CONFIRM_RED, undefined, undefined, "claude");
  assert.match(framing, /did not observe the required red/, framing);
  assert.doesNotMatch(framing, /test\/impl files/, framing);
});

test("a real build refused at CONFIRM_GREEN credits the red it DID observe and denies the green", () => {
  const framing = honestFramingReal(PERSISTED, AT_CONFIRM_GREEN, undefined, undefined, "claude");
  assert.match(framing, /did not observe the green/, framing);
  assert.doesNotMatch(framing, /both red and green/, framing);
});

test("a real build refused at GATE is the one refusal that DID commit and DID read the tree", () => {
  const framing = honestFramingReal(PERSISTED, AT_GATE, undefined, undefined, "claude");
  assert.match(framing, /a GATE that read genuine/, framing);
  assert.doesNotMatch(framing, /no commit was made/, framing);
});

test("a PASSING real build keeps its original opening", () => {
  const framing = honestFramingReal(PERSISTED, SIGNED, PROMOTED, "green", "codex");
  assert.match(framing, /run by the spine for\s+both red and green/, framing);
  assert.match(framing, /a GATE that read genuine/, framing);
});

test("a refusal with NO recorded phase says so rather than narrating a walk it cannot vouch for", () => {
  const framing = honestFramingReal(PERSISTED, REFUSED, undefined, undefined, "claude");
  assert.match(framing, /which phase it\s+reached was not recorded/, framing);
  assert.doesNotMatch(framing, /a GATE that read genuine/, framing);
});

// The backstop clause sat in the SAME sentence and asserted the proof command had run. Fixing the
// opening made it a self-contradiction a reader meets in one breath: "the spine never ran the proof
// command … ; and only the node's registered proof command ran". The typecheck backstop runs INSIDE
// gate, so a walk that refused before CONFIRM_RED ran neither it nor the proof command.
test("a real build refused at AUTHOR_TEST does not also claim its proof command ran", () => {
  const framing = honestFramingReal(PERSISTED, AT_AUTHOR_TEST, undefined, undefined, "claude");
  assert.doesNotMatch(framing, /only the\s+node's registered proof command ran/, framing);
  assert.match(framing, /the package typecheck never ran either/, framing);
});

// Every phase from CONFIRM_RED onward DID run the proof command, so each must still say so — and
// each needs its OWN case with NO backstop, because a backstop observation takes a different arm of
// the backstop clause entirely and leaves `ranProofCommand` unconsulted. (`check:mutation-diff` found
// exactly that hole: the only CONFIRM_GREEN case here passed a red backstop, so deleting the
// `CONFIRM_GREEN` arm changed nothing any test could see.)
for (const [phase, outcome] of [
  ["CONFIRM_RED", AT_CONFIRM_RED],
  ["IMPLEMENT", AT_IMPLEMENT],
  ["CONFIRM_GREEN", AT_CONFIRM_GREEN],
  ["GATE", AT_GATE],
] as const) {
  test(`a real build refused at ${phase} DID run its proof command, and still says so`, () => {
    const framing = honestFramingReal(PERSISTED, outcome, undefined, undefined, "claude");
    assert.match(framing, /only the\s+node's registered proof command ran/, framing);
    assert.doesNotMatch(framing, /the package typecheck never ran either/, framing);
  });
}

test("a live smoke refused at AUTHOR_TEST does not claim the spine observed a red→green", () => {
  const framing = honestFramingLive(PERSISTED, AT_AUTHOR_TEST, "codex", "library-cli");
  assert.doesNotMatch(framing, /observed the genuine red→green/, framing);
  assert.doesNotMatch(framing, /authored the test and impl/, framing);
});

test("a live smoke refused at CONFIRM_GREEN credits the red and denies the green", () => {
  const framing = honestFramingLive(PERSISTED, AT_CONFIRM_GREEN, "claude", "library-cli");
  assert.match(framing, /did not observe the green/, framing);
  assert.doesNotMatch(framing, /observed the genuine red→green/, framing);
});

test("a PASSING live smoke keeps its original opening", () => {
  const framing = honestFramingLive(PERSISTED, SIGNED, "codex", "library-cli");
  assert.match(framing, /observed the genuine red→green/, framing);
});

// ---------- the whole framing, pinned per shape ----------
//
// A framing is prose, so `check:mutation-diff` charges every changed literal in it as its own
// mutant, and a probe such as `assert.match(framing, /No verdict was signed/)` kills only the words
// it quotes. So each shape is pinned whole. That is deliberately brittle: changing this wording is
// meant to fail HERE, where the change gets read. Each expected string was captured from the
// renderers and read for truth before it was pinned.

const PROMOTED = {
  branch: "claude/real/verdict-line-real-fixture",
  commitSha: "0123456789abcdef0123",
  pushed: true,
  detail: "pushed to origin",
};

const GOLDENS = [
  {
    name: "real, REFUSED at AUTHOR_TEST on the shared store, no backstop",
    render: () => honestFramingReal(PERSISTED, AT_AUTHOR_TEST, undefined, undefined, "codex"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, and the ChatGPT-subscription Codex leaf via exact replica promotion\nasked to author the test. The walk stopped there: the spine never ran the proof command,\nnothing was committed, and the GATE never read that worktree. no commit was made, so there was nothing to promote; and the package typecheck never ran either — the walk refused\nbefore the gate could reach it.\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "real, REFUSED at CONFIRM_RED on the shared store",
    render: () => honestFramingReal(PERSISTED, AT_CONFIRM_RED, undefined, undefined, "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, a test authored at its real repo\npath by the Claude Agent SDK leaf under hook-enforced write scope, and the node's declared REAL proof command run by the\nspine — which did not observe the required red. No implementation was authored, nothing was\ncommitted, and the GATE never read that worktree. no commit was made, so there was nothing to promote; and only the\nnode's registered proof command ran (no package typecheck — a no-install, builtins-only\ntarget, or a walk that stopped before the gate's backstop).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "real, REFUSED at IMPLEMENT in memory",
    render: () => honestFramingReal(IN_MEMORY, AT_IMPLEMENT, undefined, undefined, "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, a test authored at its real repo\npath by the Claude Agent SDK leaf under hook-enforced write scope, and a genuine RED observed by the spine. The walk\nstopped at the implementation: the proof command was never re-run for green, nothing was\ncommitted, and the GATE never read that worktree. no commit was made, so there was nothing to promote; and only the\nnode's registered proof command ran (no package typecheck — a no-install, builtins-only\ntarget, or a walk that stopped before the gate's backstop).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: this run's own events landed in an in-memory store and are gone.",
  },
  {
    name: "real, REFUSED at CONFIRM_GREEN on the shared store by a red backstop",
    render: () => honestFramingReal(PERSISTED, AT_CONFIRM_GREEN, undefined, "red", "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, the node's REAL test/impl files at\ntheir real repo paths authored by the Claude Agent SDK leaf under hook-enforced write scope, and the proof command re-run\nby the spine — which did not observe the green. Nothing was committed, and the GATE never\nread that worktree. no commit was made, so there was nothing to promote; and the node's proof command ran AND the package typecheck was observed RED\nin the installed worktree BEFORE the gate ruled, so no signed PASS can out-run it (the proof run is\ntsx-driven — types stripped — so only the typecheck sees type-illegal code).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "real, REFUSED at GATE — the one refusal that DID commit and DID read the tree",
    render: () => honestFramingReal(PERSISTED, AT_GATE, undefined, undefined, "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, the node's REAL test/impl files at\ntheir real repo paths authored by the Claude Agent SDK leaf under hook-enforced write scope, the node's declared REAL proof\ncommand run by the spine for both red and green, a spine-side commit of the authored files,\nand a GATE that read genuine `git status` off that worktree — and refused. the authored commit was not promoted (see the promotion line above); and only the\nnode's registered proof command ran (no package typecheck — a no-install, builtins-only\ntarget, or a walk that stopped before the gate's backstop).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "real, REFUSED with NO recorded phase, in memory",
    render: () => honestFramingReal(IN_MEMORY, REFUSED, undefined, undefined, "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo. The walk then refused, and which phase it\nreached was not recorded — so nothing about the authoring, the observations or the commit is\nclaimed here. no commit was made, so there was nothing to promote; and the package typecheck never ran either — the walk refused\nbefore the gate could reach it.\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: this run's own events landed in an in-memory store and are gone.",
  },
  {
    name: "real, REFUSED at GATE on the shared store by a red typecheck",
    render: () => honestFramingReal(PERSISTED, AT_GATE, undefined, "red", "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, the node's REAL test/impl files at\ntheir real repo paths authored by the Claude Agent SDK leaf under hook-enforced write scope, the node's declared REAL proof\ncommand run by the spine for both red and green, a spine-side commit of the authored files,\nand a GATE that read genuine `git status` off that worktree — and refused. the authored commit was not promoted (see the promotion line above); and the node's proof command ran AND the package typecheck was observed RED\nin the installed worktree BEFORE the gate ruled, so no signed PASS can out-run it (the proof run is\ntsx-driven — types stripped — so only the typecheck sees type-illegal code).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nNo verdict was signed: the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "real, SIGNED on the shared store, promoted, typecheck green",
    render: () => honestFramingReal(PERSISTED, SIGNED, PROMOTED, "green", "codex"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, the\nnode's REAL test/impl files at their real repo paths authored by the ChatGPT-subscription Codex leaf via exact replica promotion,\nthe node's declared REAL proof command run by the spine for\nboth red and green, a spine-side commit of the authored files, and a GATE that read genuine\n`git status` off that worktree. the authored commit is PARKED on claude/real/verdict-line-real-fixture\n(landing rides the PR/CI gate — merge NON-SQUASH so the verdict's commit stays an ancestor of main); and the node's proof command ran AND the package typecheck was observed GREEN\nin the installed worktree BEFORE the gate ruled, so no signed PASS can out-run it (the proof run is\ntsx-driven — types stripped — so only the typecheck sees type-illegal code).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).\nWhat DID persist: the signed verdict — events.verdict in the shared store (the rollup can\nderive from it across sessions).",
  },
  {
    name: "real, SIGNED in memory, no typecheck (a no-install node)",
    render: () => honestFramingReal(IN_MEMORY, SIGNED, undefined, undefined, "claude"),
    expected:
      "honest framing: a REAL build (ADR-0031). What was real: a fresh git worktree of THIS repo, the\nnode's REAL test/impl files at their real repo paths authored by the Claude Agent SDK leaf under hook-enforced write scope,\nthe node's declared REAL proof command run by the spine for\nboth red and green, a spine-side commit of the authored files, and a GATE that read genuine\n`git status` off that worktree. the authored commit was not promoted (see the promotion line above); the verdict\nlanded in an in-memory store and is gone; and only the\nnode's registered proof command ran (no package typecheck — a no-install, builtins-only\ntarget, or a walk that stopped before the gate's backstop).\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2).",
  },
  {
    name: "live, REFUSED at AUTHOR_TEST in memory",
    render: () => honestFramingLive(IN_MEMORY, AT_AUTHOR_TEST, "codex", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Codex CLI with saved ChatGPT subscription authentication\n(ADR-0030/0232) was asked to author the test under phase-enforced write\nscope, and the walk stopped there — no implementation, and no red→green to observe. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and this run's own events landed in an in-memory store and are gone.",
  },
  {
    name: "live, REFUSED at CONFIRM_RED on the shared store",
    render: () => honestFramingLive(PERSISTED, AT_CONFIRM_RED, "claude", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Claude Agent SDK with subscription authentication\n(ADR-0030/0232) genuinely authored the test under phase-enforced write\nscope, and the spine did not observe the required red. No implementation was authored. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "live, REFUSED at IMPLEMENT on the shared store",
    render: () => honestFramingLive(PERSISTED, AT_IMPLEMENT, "claude", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Claude Agent SDK with subscription authentication\n(ADR-0030/0232) genuinely authored the test under phase-enforced write\nscope, the spine observed the genuine RED, and the walk stopped at the implementation. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "live, REFUSED at CONFIRM_GREEN in memory",
    render: () => honestFramingLive(IN_MEMORY, AT_CONFIRM_GREEN, "claude", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Claude Agent SDK with subscription authentication\n(ADR-0030/0232) genuinely authored the test and impl under phase-enforced write\nscope, and the spine did not observe the green. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and this run's own events landed in an in-memory store and are gone.",
  },
  {
    name: "live, REFUSED at GATE on the shared store",
    render: () => honestFramingLive(PERSISTED, AT_GATE, "codex", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Codex CLI with saved ChatGPT subscription authentication\n(ADR-0030/0232) genuinely authored the test and impl under phase-enforced write\nscope and the spine observed the genuine red→green those writes caused — and the GATE\nrefused after. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "live, REFUSED with NO recorded phase, on the shared store",
    render: () => honestFramingLive(PERSISTED, REFUSED, "claude", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Claude Agent SDK with subscription authentication\n(ADR-0030/0232) ran under phase-enforced write scope and then refused;\nwhich phase it reached was not recorded, so nothing about the authoring or the observations\nis claimed here. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; no verdict was signed, and the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict.",
  },
  {
    name: "live, SIGNED on the shared store",
    render: () => honestFramingLive(PERSISTED, SIGNED, "codex", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Codex CLI with saved ChatGPT subscription authentication\n(ADR-0030/0232) genuinely authored the test and impl under phase-enforced write\nscope, and the spine observed the genuine red→green those writes caused. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; the signed verdict PERSISTED to the shared store (events.verdict — the rollup can derive from it across sessions).",
  },
  {
    name: "live, SIGNED in memory",
    render: () => honestFramingLive(IN_MEMORY, SIGNED, "claude", "library-cli"),
    expected:
      "honest framing: a live smoke proves the LIVE LOOP through the gate — the Claude Agent SDK with subscription authentication\n(ADR-0030/0232) genuinely authored the test and impl under phase-enforced write\nscope, and the spine observed the genuine red→green those writes caused. The TASK is still the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\nThe node's authored status is untouched; the verdict landed in an in-memory store and is gone.",
  },
];

for (const golden of GOLDENS) {
  test(`the framing is pinned whole: ${golden.name}`, () => {
    assert.equal(golden.render(), golden.expected);
  });
}

// ---------- the help text promises the same backstop the framing reports ----------
//
// ADR-0580 D2 took the package suite out of the build. The help text used to promise "a package-suite
// regression run", so it is pinned here, beside the framing that reports what a run actually did:
// the operator reads the promise before a paid build and the framing after it, and the two must agree.

test("node help says a --real build typechecks its package before signing and never runs the package suite", () => {
  const body = nodeHelp().body.replace(/\s+/g, " ");
  assert.ok(
    body.includes(
      "via PR with a NON-SQUASH merge. Nodes with real.install get a lockfile-only pnpm install in " +
        "the worktree plus a package typecheck before signing (tsx strips types; tsc must agree) — a " +
        "red refuses the verdict. The build never runs the package's own test suite; the landing gate " +
        "and CI do (ADR-0580 D2).",
    ),
    body,
  );
  assert.doesNotMatch(body, /regression run/, "the help must not promise a package-suite run");
});

// ---------- the help text offers the FREE read that precedes a paid build ----------
//
// `node peek` (ADR-0588) answers "is this build working or is it stuck" from what a build already
// writes, and it costs nothing. The help is where an operator meets it, so the block is pinned here
// beside the rest of the promise: a verb nothing points at is a verb nobody runs, and this one's
// whole value is being reached BEFORE the expensive decision it informs.

test("node help offers `node peek`, naming what it joins, what it needs, and that it states its own limits", () => {
  const body = nodeHelp().body.replace(/\s+/g, " ");
  assert.ok(
    body.includes(
      "storytree node peek <id> [--pg] FREE, read-only: is a --real build of this unit RUNNING, " +
        "ENDED or UNKNOWN (ADR-0588)? Joins this machine's process registry to the appended phase " +
        "marks — the two halves that answer nothing on their own. Elapsed is read against the budget " +
        "the build was actually launched with, never an assumed default. The registry half needs NO " +
        "store, so this still answers without --pg; it prints what it cannot see, every time. " +
        // Reaching INTO the next block is deliberate: it pins that `peek` sits immediately before
        // `walls`, i.e. that the two FREE reads stay together and ahead of anything that spends.
        // It also closes the gap a tail-anchored assertion leaves — text inserted after the last
        // word it quotes is invisible to it.
        "storytree node walls [<id>] --pg",
    ),
    body,
  );
});
