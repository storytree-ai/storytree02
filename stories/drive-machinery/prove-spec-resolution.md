---
id: "prove-spec-resolution"
tier: capability
story: drive-machinery
title: "Node specs, the build registry, and ProveSpec resolution"
outcome: "Any registered node id resolves into a runnable ProveSpec for the chosen mode with nothing left to hand-wire."
status: proposed
proof_mode: integration-test
depends_on: [red-green-phase-machine, shell-test-observer, prove-it-gate, owned-loop-phase-author, real-build-worktree]
decisions: [232, 390, 555]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/orchestrator", "--filter", "@storytree/cli", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/codex-leaf-prompt.test.ts"
    sourceGlobs: ["packages/orchestrator/src/resolve-prove-spec.ts"]
  # ADR-0353: the READ-ONLY coverage surface. Contracts 14-17 and contract 18 are named by their own test
  # files; the route and both write scopes are unchanged.
  coverage:
    testGlobs:
      - "packages/orchestrator/src/resolve-prove-spec.per-test.test.ts"
      - "packages/orchestrator/src/resolve-prove-spec.walkthrough.test.ts"
  real:
    testFile: "packages/cli/src/codex-leaf-prompt.test.ts"
    sourceFile: "packages/orchestrator/src/resolve-prove-spec.ts"
    scope:
      testGlobs:
        - "packages/cli/src/codex-leaf-prompt.test.ts"
      sourceGlobs: ["packages/orchestrator/src/resolve-prove-spec.ts"]
    install: true
    editsExisting: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/cli", "exec", "node", "--import", "../../scripts/tsx-cache-off.mjs", "--import", "tsx", "--test", "../../packages/orchestrator/src/resolve-prove-spec.test.ts", "src/codex-leaf-prompt.test.ts"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/orchestrator", "--filter", "@storytree/cli", "typecheck"]
---

# Node specs, the build registry, and ProveSpec resolution

**Outcome —** Any registered node id resolves into a runnable ProveSpec for the chosen mode with nothing left to hand-wire.

**Depends on —** [`red-green-phase-machine`](red-green-phase-machine.md), [`shell-test-observer`](shell-test-observer.md), [`prove-it-gate`](prove-it-gate.md), [`owned-loop-phase-author`](owned-loop-phase-author.md), [`real-build-worktree`](real-build-worktree.md)

> **Proof status (honest) — `proposed`, with live-leaf acceptance still incomplete.** The
> resolver, the spec loader, the registry, the prompts, the feedback-tool arming, and BOTH offline
> end-to-end walks (dry-run glue and the REAL-mode worktree walk with a scripted author) are
> covered by a real, passing, offline suite (`packages/orchestrator/src/resolve-prove-spec.test.ts`,
> part of `@storytree/orchestrator` 99/99 — I ran it 2026-06-13). The pocket: live mode binds a
> REAL author selected at the injection layer — `CodexPhaseAuthor` is the omitted-runtime default
> with saved ChatGPT authentication, while `--runtime claude` selects `ClaudeAgentAuthor` explicitly
> (ADR-0555). Offline
> tests verify construction and scope arming but never run the subscription leaf; the
> genuinely-live legs are need-gated, not standing tests.

**Runtime repair status — cumulative candidate, acceptance incomplete.** Ordinary omitted-default
Terra run `real-mtteizuv` signed `0bf3005d07d875f8099ed787e680eb6486c1b0ee`, repairing net-new
IMPLEMENT permission for an optional literal source target. Its cumulative unlanded ancestry also
contains `aaf966f34c54c029530228654e2635432ee04451` (wildcard-admitted sole-literal authority),
`5ba4b5530e1d890f52ac0982d0c0afc27ef936e8` (wildcard-only zero-literal wording), and
`fccb80dfb5b72fa0e288933d4610bb9d97ee1fc7` (explicit-Claude wildcard/legacy authority retaining
`PathWriteScope`). These are signed source-backed partials, not interchangeable prose. The unchanged
registered command has also exercised the opt-in current-live REAL-role observation (103 pass,
0 fail, 0 skip); it is an unsigned construction observation at its asserted two-false-claims
granularity.

One source-backed C9/C10 defect remains. Codex live-smoke says that no automated feedback tool exists,
but does not explicitly prohibit treating shell proof/test/typecheck/build commands as feedback. The
common adapter's statement that the spine runs commands after stop and owns the verdict does not grant
or deny that substitute. This violates the same selected-runtime feedback boundary that REAL already
states. Earlier rejected results are evidence only, never a seed to restore. Capturing final stdin
with an injected process runner observes prompt composition; it is not a real author run or a signed
verdict.

**Authoring prerequisite under the 2026-09-09 owner re-steer.** Continuity's implementation is a
pure event resolver, but its ordinary REAL build is not: `nodeBuild` calls `buildNodeReal`, which
calls `resolveProveSpec`/`resolveReal`; an omitted runtime constructs `CodexPhaseAuthor` and passes
the Codex `realPrompts` result into its phases. Main's false default-Codex instructions therefore
reach a default GPT-5.6 Terra continuity leaf before its own proof can begin. Repair the remaining
shared default-REAL authoring path first. Land the remaining live-smoke consistency repair in that
same minimum runtime PR because this unit owns C9/C10, not because continuity calls live-smoke. This
is an execution prerequisite, not a new `depends_on` edge for
[`capability-proof-continuity`](capability-proof-continuity.md).

> **Overtaken 2026-09-19:** `capability-proof-continuity` retired unbuilt under ADR-0580 D3, and its
> arc (`rendering-engine-structure-arc`) is closed. No continuity build waits on this prerequisite any
> longer, and the ordering "before continuity" in the next paragraph names no pending build.

The next runtime revision has one source-backed behavior: Codex live-smoke explicitly withholds shell
proof/test/typecheck/build feedback in both phases. It carries only the corresponding representative
production-composed smoke observations; it retains, rather than duplicates, the signed REAL action
repairs, the explicit-Claude scope result, and the current-live REAL observation. The registered
proof command already executes substantive resolver cases for C1–8, the original Claude portion of
C10, and C11; do not clone them into the CLI spotlight. A fresh anchored plan must drive this revision
with the repository-default GPT-5.6 Terra leaf before continuity, then the renderer rename, four-way
capability split, and safe downstream fan-out.

## Guidance

### C9 final bounded revision — Codex live-smoke has no shell feedback substitute

> **Overtaken in part 2026-09-15 (ADR-0570 D1).** Contracts
> [`codex-feedback-commands-run-in-the-replica`](codex-feedback-commands-run-in-the-replica.md) and
> [`codex-builds-arm-feedback`](codex-builds-arm-feedback.md) arm every Codex build with `run_proof`,
> plus `run_typecheck` for an installed node that registers one, retargeted into its replica, and
> brief it to iterate against them. The clauses below that require empty feedback tools, disabled MCP,
> or a brief naming no feedback tool no longer hold. The shell-feedback prohibition this revision
> introduced still does (ADR-0232 D5). Contracts 9, 10 and 13 below carry the current assertions.

Retain all eighteen contracts, IDs, titles, commands and fences. The read-only resolver suite remains
the substantive executed baseline for C1–8, C10's original Claude oracle/typecheck composition,
and C11; existing parent CLI corroboration remains frozen. Preserve every existing CLI body,
shared fixture and assertion, especially the signed `0bf`, `aaf966f`, `5ba4b553`, and `fccb80df`
cases and helpers, **except** the existing C9 body
`prompts-brief-the-real-constraints: default Codex LIVE-SMOKE brief never claims run_proof or denies native shell authoring`.
Amend that body only, preserving its current assertions while adding the Codex live-smoke
shell-feedback boundary. This revision does not complete C9 until its retained baseline and all
evidence below pass review.

Production composition is rendered role, then `## Phase brief`, then adapter spine/target/output text.
C9 helpers preserve existing callers and capture that production `CodexPhaseAuthor` launch, not a
reconstructed command. For every captured phase, couple final stdin, actual exec args and that same
author's `feedbackToolNames`; a static argument builder is not this observation. Helpers prepare
only this witness and cannot vouch for other contracts.

1. Build one synthetic live-smoke fixture through production resolution with omitted Codex runtime,
   neutral test-owned rendered roles, and the existing injected Codex runner. Capture each phase's
   final adapter-composed stdin, actual exec args, and that same author's `feedbackToolNames`.
   Preserve the smoke's synthetic pair, its exact required targets, and its deliberate absence of
   real contract IDs. Run the same assertion against opt-in current-live roles; this is a live-store
   construction observation, not a paid model call or a signature.
2. Bound the assertion to the composed phase input. Both phases must retain native authoring, empty
   feedback tools, disabled MCP, the selected default model, spine-owned observation and stopping;
   neither may instruct a shell proof, test, typecheck, or build command as feedback. A qualified
   reference that assigns those commands to the spine is allowed. Do not build a generalized
   sentence classifier or a Cartesian fixture matrix: this test distinguishes the actual prohibition
   from its absence in the smoke brief and retains earlier representative REAL observations.
3. Derive red from the missing live-smoke prohibition, then change only
   `packages/orchestrator/src/resolve-prove-spec.ts` so both Codex live-smoke phases explicitly
   withhold that shell substitute. Preserve native authoring, finite promotion, selected-runtime
   defaults, exact required outputs, all Claude behavior, and spine signing. No other CLI or resolver
   body is rewritten.

## Runtime reference

Three files, one act — turn a unit id into everything `proveUnit` needs:

- **`node-spec.ts`** — a LIGHT frontmatter loader for `stories/<story>/<unit>.md`
  (`loadNodeSpec`, `node-spec.ts`): validates JUST the fields the resolver needs (the `Frontmatter`
  zod schema, unknown keys tolerated), carries the `## Guidance` prose for prompt assembly
  (`guidanceSection`), and is LOUD on a missing/unterminated frontmatter block. `findNodeSpecFile`
  (`node-spec.ts`) locates a capability at `stories/<story>/<id>.md` and a story at
  `stories/<id>/story.md`; `mapProofMode` (`node-spec.ts`) maps the seed's test-kind vocabulary onto
  core's tier ladder.
- **`test-command-registry.ts`** — the EXPLICIT node→build-config map
  (`NODE_BUILD_REGISTRY`, `test-command-registry.ts`): for each buildable node, the REAL
  proof command and the per-phase write-scope globs; `real:` entries (ADR-0031 §2) add the REAL
  test/source files, exact-file walls, `install` and the REQUIRED-when-installed `typecheck`.
  Explicit by design — a node is buildable only once someone deliberately registers how to prove
  it; a miss is `null`, never a guess.
- **`resolve-prove-spec.ts`** — the injection layer (`resolveProveSpec` + `resolveReal`,
  `resolve-prove-spec.ts`), three modes:
  **dry-run** (offline, zero cost: a scripted phase-aware model behind
  [`owned-loop-phase-author`](owned-loop-phase-author.md), a temp workspace, a real Node test
  runner over a planted red→green pair — proves the GLUE, not the node's proofs);
  **live-smoke** (ADR-0030 Phase D: the selected REAL author — Codex by default, Claude via
  `--runtime claude` under ADR-0555 — authors the synthetic pair under phase-enforced scope); **real** (Phase F:
  nothing synthetic — the registry's real files in a
  fresh git worktree, the registry's REAL proof command, and a tree seam that COMMITS the
  authored files spine-side before reading genuine `git status` — `resolveReal`'s default
  `treeState`, which calls `commitAuthored` then `gitTreeState`).
  For the Claude runtime, `feedbackCommandsFor` arms the leaf's bounded
  ADR-0035 tools — `run_proof` spawns
  the SAME command the spine's observations spawn (one oracle, two consumers), `run_typecheck`
  only when registered. For the Codex runtime, `codexFeedbackCommandsFor` arms the same two tools
  from the same command objects, each retargeted from the worktree to the phase's replica, `cwd`
  and absolute arguments alike (ADR-0570 D3). The prompt builders (`assemblePrompts`, `realPrompts`) splice the node's
  REAL outcome + guidance into the phase briefs, including the
  no-node_modules / typecheck-wall constraints.

**Runtime-accurate phase briefs (contracts 9 and 10).** The selected runtime is an input to
the REAL and live-smoke briefs. Omitted runtime remains Codex; the existing Codex model default,
explicit Claude selection, subscription authentication and no-fallback policy are unchanged.
Codex authors with native shell/`apply_patch` in its disposable replica. Since ADR-0570 D1 every
Codex build also hands it the spine's registered `run_proof`, plus `run_typecheck` for an installed
node that registers one, built by `codexFeedbackCommandsFor` from the same command objects the spine
observes and retargeted into the replica. Its brief tells it to run and iterate against those tools
as Claude's does, and must not claim that no feedback tool exists or that shell authoring is
unavailable. Available shell authoring still grants no shell-based substitute for registered
proof/typecheck feedback (ADR-0232 D5). It reads and authors
within the phase's exact declared targets, then stops for the deterministic spine to observe.
The Codex write boundary is the existing complete-diff observation and exact-target promotion;
no obsolete `PreToolUse` hook or OS containment is promised. Claude's briefs retain its actual
file-tool/write-hook boundary and bounded feedback tools, with no arbitrary shell command tool.
Both runtimes retain author-only duties, dependency restrictions, the wrong-test objection route — the
`escalate` tool since ADR-0582 D7, never "stop and say so plainly" — and
the spine's sole red/green/promotion/verdict authority. Preserve the synthetic smoke's distinct
purpose and the dry-run's scripted behavior.

**Existing helper-call compatibility.** The existing standalone three-argument
`realPrompts(spec, real, proofDisplay)` call retains its legacy Claude-tool prose, as exercised by
the unchanged resolver suite. The runtime-aware call accepts the selected runtime explicitly;
production REAL and live-smoke resolution always supplies that selection, including Codex when
the build caller omits `runtime`. The final-input regression exercises those production resolution
boundaries for omitted and explicit runtime choices, so legacy helper compatibility cannot stand
in for truthful default-Codex instructions. This is a prompt-helper compatibility rule, not a
change to which provider or model any build selects.

**Test revision brief (contract 12, ADR-0571 D4).** A REAL build can be handed a `TestRevision`: the
escalation a failed run returned, plus, for an IMPLEMENT escalation, the CONFIRM_GREEN observation
behind it. With one, the AUTHOR_TEST brief gains a revision section appended after everything the
brief says without it, in all three REAL arms and for every runtime. The section names:

- the ADR-0563 D6 `revised-test` attempt it consumes;
- the prior run id, the raising phase and its kind, and the test id;
- the statement and assertion, verbatim;
- the spine's observation, with each stream tail-kept at 8,000 characters.

The IMPLEMENT brief is byte-identical with or without a revision, and a build handed none briefs
exactly as before. `realPrompts` takes the revision as an optional fifth argument, and
`RealResolveOptions.testRevision` threads it through `resolveReal`. It is built through its own
spec-borne contract, [`real-brief-carries-test-revision`](real-brief-carries-test-revision.md). That
contract's proof block and write scope are its own. The authored-source paragraph below describes
this capability's proof, not that contract's.

**Per-test observation and its brief (contracts 14 and 15, ADR-0573).** `resolveReal` arms per-test
observation (D2, D3) on exactly the routes that run the node's own test file through node:test, vitest
or `bun test`: it adds the runner's report flags to the ONE resolved proof command, wires
`ShellTestResolver.perTestReport` with a per-build report file, and hands the gate a `perTestPolicy`
that reviews CONFIRM_RED per test only for an `editsExisting` unit and CONFIRM_GREEN on every armed
route. Every other route is observed as before. On an armed route `realPrompts` states the per-test
rules in the AUTHOR_TEST brief — the brief ADR-0573's Consequences call for — before the ADR-0571
revision section, which stays last.

**Cluster brief (contracts 16 and 17, ADR-0573 D3).** A unit whose spec declares `real.cluster` — two or
more of its own contract ids, the ones sharing a fixture or seam — is briefed to write those contracts'
tests in ONE AUTHOR_TEST slice and to implement against them together. `resolveReal` admits a cluster
only where red is reviewed per test: an `editsExisting` unit on an armed route, naming contracts the unit
declares, each once. Anywhere else it refuses before any authoring turn, and never falls back to a
one-test brief or to a file-level red. An admitted cluster reaches the gate's policy as `briefContracts`,
so C7 refuses a red in which a named contract has no new vouching test, and the red evidence names the
cluster. `realPrompts` names the cluster in both briefs of the `editsExisting` arm: AUTHOR_TEST asks for
at least one NEW failing test per contract in the one test file, and says a rewritten existing test does
not count; IMPLEMENT asks for every test of the cluster green, iterating against `run_proof`. A unit
without a cluster, and a cluster on any route where it could not be held, briefs byte for byte as before.

**Proof walkthrough in the briefs (contract 18, `brief-carries-the-units-proof-walkthrough`).**
`loadNodeSpec` reads a unit's proof walkthrough — the body section under any heading that begins
`## Proof walkthrough` — onto `NodeSpec.proofWalkthrough`. `realPrompts` (every arm) and `assemblePrompts`
splice it into both phase briefs right after the guidance. AUTHOR_TEST is told it is the acceptance setup
the test must build, with no double or shortcut it rules out; IMPLEMENT is told it is the setup the test
builds. It is the leaf's INPUT and never a judge of the authored test (ADR-0447; ADR-0563 D1). A unit
without a walkthrough briefs byte for byte as before. Measured when it landed: 56 specs carried one, from 5
to 211 lines (median 20), and none of that text had reached a leaf — so a guidance line telling both phases
to read "this whole file" named a file the brief never gave.

**In-build repair (contract 19, ADR-0581 D4 / ADR-0582).** Every REAL resolution arms the gate's repair
loop — `resolveReal` stamps `ProveSpec.repair` with four things, three of them read off the unit's OWN
walls so the loop routes by exactly the scope the workers wrote under: the build's BUDGET
(`RealResolveOptions.repairBudget`, else a `wallClockBudget` of two hours started at resolution, which is
immediately before the walk; `workers-have-what-they-need-arc-inc-01`'s per-build budget arrives through
the same seam, so a build keeps ONE budget); the SET-ASIDE, which puts every IMPLEMENT-scope file back to
the commit the walk began at for a revised test's red re-observation and then restores it; and the
TYPECHECK ROUTER over `isWriteAllowed("AUTHOR_TEST", …)`, anchored on the unit's declared test and source
files because tsc names files relative to the package it checks. The fourth is the SCOPE FINGERPRINT
(`worktreeScopeFingerprint` over the whole workspace), which the gate takes either side of a repair slice:
a slice that left it identical wrote nothing, and that ends the loop instead of spending the rest of the
budget on a worker that is not writing (ADR-0582 D6 — the bound measured on this landing's own gate). A
dry run and the live smoke carry no policy and walk the straight ladder (ADR-0582 D9). Two related facts: the walk's base commit is read ONCE
and the proved-span binding (ADR-0534) accumulates each scoped commit's IMPLEMENT-scope files, so a second
GATE visit after a repair — and the drive's backstop reading the tree seam again — can no longer narrow
the binding to one commit's diff or to an empty range; and every REAL IMPLEMENT brief now directs an
objection to the `escalate` tool (`IMPLEMENT_OBJECTION`), because a prose objection records no escalation
and the spine reads it as a failed implementation.

**Authored source and proof ownership.** IMPLEMENT may edit only
`packages/orchestrator/src/resolve-prove-spec.ts`. AUTHOR_TEST edits only the existing
`packages/cli/src/codex-leaf-prompt.test.ts`, the single declared test spotlight and required
test output. The existing `packages/orchestrator/src/resolve-prove-spec.test.ts` is read-only
and remains in the explicit proof command as a regression floor. This single-file authoring
scope and required output remain unchanged. The CLI file already exists; its revised behavioral
assertions must be present before the spine observes red. An absent CLI test, syntax error or
broken test import is not the required runtime regression.
The CLI integration home already consumes Library, drive, orchestrator and agent dependencies,
so it can use the production role renderer, resolver and existing injected Codex runner without
adding a dependency cycle or changing the agent adapter. The live check uses the same integration
assertions in an explicit opt-in mode; ordinary tests remain offline and need no database or model.
The offline test supplies neutral role artifacts in its own injected Library store; the shared
historical corpus fixture's Claude-specific role wording is not a current runtime specification
and must not force an adapter sanitizer or a shared-fixture source edit.
Live red/green role wording is supplied by the guidance curator. This leaf authors no Library
artifact, manifest or dependency change.

The gate-time coverage reader remains name-granular and reads the CLI spotlight. Its eleven names
are not a claim that every semantic assertion lives there. The registered proof command executes
the resolver baseline named above, and the C9 cases supply the new selected-Codex composition and
launch evidence, including Codex's armed feedback tools and its shell-feedback prohibition
(contract `codex-builds-arm-feedback`). Do not claim an unchanged contract merely because a matching title exists: its retained
resolver or CLI case must remain substantive. This work does not change the coverage reader or
promotion manifest.

Code edges for the `depends_on`, all imports in `resolve-prove-spec.ts`: `PathWriteScope` (from
`./phase-machine.js`), `OwnedLoopAuthor` (`./owned-loop-author.js`), `ShellTestExecutor` +
`runShellCommand` (`./shell-test-executor.js`), `gitTreeState` (`./prove-it-gate.js`),
`commitAuthored` + `platformShellCommand` (`./build-worktree.js`); plus the type edges
`test-command-registry.ts` imports — `ShellCommand` (`./shell-test-executor.js`) and
`PathWriteScopeConfig` (`./phase-machine.js`). The VALUE imports of `ClaudeAgentAuthor` and
`CodexPhaseAuthor` from `@storytree/agent` are the one place the consumed executor seam goes
concrete — deliberately HERE, in the injection layer, so the gate itself stays author-agnostic.
Whichever author is selected, its proof feedback remains untrusted: the deterministic spine reruns
the registered command out of band and remains the sole red/green/verdict authority (see the
story's executor-seam section).

### Required contract observations

These retain the capability's total acceptance while Guidance selects the current revision. Each
named contract requires its full assertion; a matching title alone is insufficient.

The shell-feedback prohibition in contracts 9 and 10 also rejects optional suggestions to run
proof, test, typecheck or build commands as substitute feedback. Final-stdin assertions must reject
that grant even when the same text correctly reserves observations or signing to the spine.
A prohibition or runtime comparison may name an unavailable tool; test the instruction's meaning
rather than requiring the tool name's erasure.

- **`spec-files-locate-and-load`** — `findNodeSpecFile` resolves both layouts; real library specs load; no frontmatter is LOUD.
- **`proof-mode-vocabulary-maps`** — integration-test→capability, UAT→story, contract-test→contract, operator-attested shared.
- **`registry-is-explicit`** — the library story + capabilities are covered; unknown ids return null.
- **`real-walls-really-wall`** — the verdict-line and notice-board entries' walls hold; every install-bearing entry registers a typecheck (the registry-wide invariant).
- **`unregistered-is-not-buildable`** — both refusals carry guidance, never a guess.
- **`prove-spec-fields-come-off-the-real-spec`** — the resolved ProveSpec mirrors the node's identity.
- **`dry-run-glue-end-to-end`** — the whole chain over an InMemoryStore.
- **`real-mode-walk-earns-its-tree`** — the verdict's commitSha is the spine's commit; `git status` is genuinely clean.
- **`prompts-brief-the-real-constraints`** — BOTH phases in all three REAL arms preserve outcome, guidance, contract IDs, the exact declared test/source scope, dependency restrictions, required outputs and the wrong-test objection route — the `escalate` tool since ADR-0582 D7, never "stop and say so plainly". For multiple literal test targets, AUTHOR_TEST names the complete permitted set instead of claiming only the spotlight is writable; IMPLEMENT may read those tests but writes only its source targets. Additional allowed paths remain optional unless already required by the existing manifest, and wildcard scope never becomes Codex promotion authority. A machine capturing actual final Codex stdin after rendered-role and adapter composition sees available native shell/`apply_patch` authoring in a disposable replica and exact observed promotion, no promised `PreToolUse`/OS containment, an instruction to run and iterate against `run_proof` — and `run_typecheck` exactly when the node registers one — and an explicit prohibition on substituting shell proof/typecheck feedback; it never sees a claim that no feedback tool exists or that shell authoring is unavailable, and outside the tooling sentence the Codex and Claude phase actions are identical for a literal scope. The spine alone observes and signs. The same runtime truthfulness holds for live-smoke while its synthetic pair and deliberate absence of real contract IDs remain unchanged. Explicit Claude retains its actual tool and enforcement instructions. The standalone three-argument `realPrompts` helper retains its legacy Claude prose, while production REAL/live-smoke resolution explicitly supplies the selected runtime; omitted build runtime therefore remains Codex. The existing Codex model default and all proof/scoping/promotion inputs are unchanged.
- **`feedback-tools-spawn-the-same-oracle`** — explicit Claude's `run_proof` spawns the exact CONFIRM oracle in REAL and live-smoke, and `run_typecheck` is armed and advertised only with its registered installed-node command. A Codex build is armed from the same registered command objects through `codexFeedbackCommandsFor`, retargeted into its replica: its actual `feedbackToolNames` is `mcp__spine__run_proof`, plus `mcp__spine__run_typecheck` exactly when an installed node registers a typecheck, in REAL and live-smoke alike, and BOTH phases of every REAL arm and live-smoke tell it to run and iterate against those tools without authorizing a shell substitute. Native authoring tool availability, default runtime/model, registered commands and spine observation/signing authority are unchanged.
- **`briefs-name-the-declared-contract-ids`** — `assemblePrompts` and all three `realPrompts` arms enumerate every declared id in BOTH phases and carry the ADR-0122 naming rule in AUTHOR_TEST; the ids arrive even when the spec's own `## Guidance` names none; a unit declaring no contracts gets no block (brief parity); the live-smoke brief carries none by design.
- **`test-revision-reaches-only-the-author-test-brief`** — a supplied `TestRevision` reaches the AUTHOR_TEST brief after its unchanged text, in all three REAL arms and both runtimes, carrying the escalation and a tail-bounded observation. The IMPLEMENT brief is byte-identical with or without it, and real-mode `resolveProveSpec` threads it into the AUTHOR_TEST brief only.
- **`codex-feedback-runs-in-the-replica`** — `retargetShellCommand` moves `cwd` and every absolute argument at or inside the worktree into the replica, judged by path and not by string prefix, and keeps everything else; `codexFeedbackCommandsFor` builds `run_proof`, and `run_typecheck` when one is registered, from the spine's own command objects with their own bound, each run spawning the retargeted command.
- **`real-routes-arm-per-test-observation`** — contract 14's full assertion.
- **`real-author-test-brief-states-the-per-test-rules`** — contract 15's full assertion.
- **`real-cluster-is-admitted-only-where-red-is-observed-per-test`** — contract 16's full assertion.
- **`real-cluster-brief-names-the-cluster-in-both-phases`** — contract 17's full assertion.
- **`briefs-carry-the-proof-walkthrough`** — contract 18's full assertion.
- **`real-build-arms-the-repair-loop`** — contract 19's full assertion.

## Integration test

**Goal —** A REAL node spec resolves and drives through the REAL gate offline, twice over:
(1) dry-run glue — the real `library-cli` spec → ProveSpec → `proveUnit` → signed pass → rollup
`healthy` (`packages/orchestrator/src/resolve-prove-spec.test.ts`, the test named
`dry-run glue: real library-cli spec → ProveSpec → proveUnit → signed pass → rollup healthy`);
(2) the REAL-mode walk — a fresh worktree of a throwaway repo, the registry's real proof command,
a scripted author via the `authorOverride` test seam, the spine's commit, a signed pass on a
genuinely clean tree (`resolve-prove-spec.test.ts`, the test named `REAL mode offline walk: fresh
worktree + real proof command + spine commit → signed pass on a genuinely clean tree`).

The runtime amendment adds the actual final-stdin walk above in
`packages/cli/src/codex-leaf-prompt.test.ts`, alongside that file's substantive resolver regressions.
The existing resolver suite stays unchanged and runs in the same declared proof command. Its scripted
walks remain offline tests of machinery; they are not a substitute author or signed proof for this
repair. The declared REAL proof runs both test files, and the build typechecks both packages before
it signs; the two package suites are the landing gate's and CI's regression floor, not the build's
(ADR-0580 D2).

## Contracts (19)

1. **`spec-files-locate-and-load`** — capability and story specs are found and parse to typed NodeSpecs with guidance prose
   - **asserts —** `findNodeSpecFile` resolves both layouts; real library specs load; no frontmatter is LOUD.
   - **covers —** `packages/orchestrator/src/node-spec.ts` — `loadNodeSpec` (with the `Frontmatter` zod schema and `guidanceSection`) and `findNodeSpecFile`
   - **proven by —** `packages/orchestrator/src/resolve-prove-spec.test.ts` — the tests `findNodeSpecFile locates a capability and a story's own spec`, `loadNodeSpec parses the real library-cli frontmatter`, `loadNodeSpec parses the real library story spec`, `loadNodeSpec is loud on a file without frontmatter`, and `loadNodeSpec wraps a malformed 'proof:' block with the file path` (REAL, passing)
2. **`proof-mode-vocabulary-maps`** — the seed's test-kind words map onto core's tier ladder
   - **asserts —** integration-test→capability, UAT→story, contract-test→contract, operator-attested shared.
   - **covers —** `node-spec.ts` — `mapProofMode` (and its `FrontmatterProofMode` vocabulary)
   - **proven by —** `resolve-prove-spec.test.ts` — the test `mapProofMode maps the frontmatter vocabulary onto core ProofMode` (REAL, passing)
3. **`registry-is-explicit`** — the registered nodes resolve to commands+scopes; a miss is null
   - **asserts —** the library story + capabilities are covered; unknown ids return null.
   - **covers —** `test-command-registry.ts` — `NODE_BUILD_REGISTRY` plus `lookupNodeBuildConfig` / `registeredNodeIds`
   - **proven by —** `resolve-prove-spec.test.ts` — the test `the registry covers the library story + its seven capabilities; a miss is null` (REAL, passing)
4. **`real-walls-really-wall`** — every REAL entry's write scope allows exactly its test file in AUTHOR_TEST and its source file in IMPLEMENT
   - **asserts —** the verdict-line and notice-board entries' walls hold; every install-bearing entry registers a typecheck (the registry-wide invariant).
   - **covers —** `test-command-registry.ts` — the `real:` arms of the `NODE_BUILD_REGISTRY` entries (`verdict-line`, `noticeboard-cli`, `tree-view`, `ambient-integration`, `verdict-glyphs`), plus `realBuildableNodeIds`
   - **proven by —** `resolve-prove-spec.test.ts` — the tests `the verdict-line entry carries a REAL proof config whose write walls really wall`, `the ambient-integration entry is REAL-buildable with install and exact-file walls`, `the noticeboard-cli entry is REAL-buildable with install and walls excluding the dispatch`, `the tree-view entry is REAL-buildable with install and walls excluding the dispatch`, and `every install-bearing REAL entry registers a typecheck command` (REAL, passing)
5. **`unregistered-is-not-buildable`** — resolution fails closed with the buildable ids; REAL mode additionally requires a real-proof config
   - **asserts —** both refusals carry guidance, never a guess.
   - **covers —** `resolve-prove-spec.ts` — the no-proof-config refusal in `resolveProveSpec` (returning `registeredNodeIds()`) and the no-`real:`-arm refusal in `resolveReal` (returning `realBuildableNodeIds()`)
   - **proven by —** `resolve-prove-spec.test.ts` — the tests `resolveProveSpec refuses a node with NEITHER a spec block NOR a registry entry` and `real mode fails closed on a registered node WITHOUT a real-proof config` (REAL, passing)
6. **`prove-spec-fields-come-off-the-real-spec`** — unitId, mapped proofMode, testId, runId, signer fill from the loaded spec
   - **asserts —** the resolved ProveSpec mirrors the node's identity.
   - **covers —** `resolve-prove-spec.ts` — the `ProveSpec` object literal `resolveProveSpec` returns (`unitId` / `proofMode` via `mapProofMode` / `testId` / `runId` / `signerInputs`)
   - **proven by —** `resolve-prove-spec.test.ts` — the test `resolveProveSpec fills the real fields off the spec (unitId, mapped proofMode, testId, runId)` (REAL, passing)
7. **`dry-run-glue-end-to-end`** — real spec → ProveSpec → proveUnit → signed pass → rollup healthy, offline
   - **asserts —** the whole chain over an InMemoryStore.
   - **covers —** `resolve-prove-spec.ts` — `resolveProveSpec`'s dry-run arm: the synthetic `ShellTestExecutor` / `PathWriteScope` seams, the `OwnedLoopAuthor` over `dryRunModel`, and `assemblePrompts`
   - **proven by —** `resolve-prove-spec.test.ts` — the test `dry-run glue: real library-cli spec → ProveSpec → proveUnit → signed pass → rollup healthy` (REAL, passing)
8. **`real-mode-walk-earns-its-tree`** — fresh worktree + real proof command + spine commit → signed pass on a genuinely clean tree
   - **asserts —** the verdict's commitSha is the spine's commit; `git status` is genuinely clean.
   - **covers —** `resolve-prove-spec.ts` — `resolveReal`, including its default `treeState` seam (`commitAuthored` then `gitTreeState`)
   - **proven by —** `resolve-prove-spec.test.ts` — the test `REAL mode offline walk: fresh worktree + real proof command + spine commit → signed pass on a genuinely clean tree` (REAL, passing — via the `authorOverride` seam; the live-leaf default is the `proposed` pocket)
9. **`prompts-brief-the-real-constraints`** — the final leaf instructions truthfully brief the selected runtime while preserving the unit and phase obligations
   - **asserts —** BOTH phases in all three REAL arms preserve outcome, guidance, contract IDs, the exact declared test/source scope, dependency restrictions, required outputs and the wrong-test objection route — the `escalate` tool since ADR-0582 D7, never "stop and say so plainly". For multiple literal test targets, AUTHOR_TEST names the complete permitted set instead of claiming only the spotlight is writable; IMPLEMENT may read those tests but writes only its source targets. Additional allowed paths remain optional unless already required by the existing manifest, and wildcard scope never becomes Codex promotion authority. A machine capturing actual final Codex stdin after rendered-role and adapter composition sees available native shell/`apply_patch` authoring in a disposable replica and exact observed promotion, no promised `PreToolUse`/OS containment, an instruction to run and iterate against `run_proof` — and `run_typecheck` exactly when the node registers one — and an explicit prohibition on substituting shell proof/typecheck feedback; it never sees a claim that no feedback tool exists or that shell authoring is unavailable, and outside the tooling sentence the Codex and Claude phase actions are identical for a literal scope. The spine alone observes and signs. The same runtime truthfulness holds for live-smoke while its synthetic pair and deliberate absence of real contract IDs remain unchanged. Explicit Claude retains its actual tool and enforcement instructions. The standalone three-argument `realPrompts` helper retains its legacy Claude prose, while production REAL/live-smoke resolution explicitly supplies the selected runtime; omitted build runtime therefore remains Codex. The existing Codex model default and all proof/scoping/promotion inputs are unchanged.
   - **covers —** `packages/orchestrator/src/resolve-prove-spec.ts` — `assemblePrompts`, `realPrompts`, `liveSmokePrompts` and selected-runtime brief wiring in `resolveProveSpec` / `resolveReal`; the final composition assertion consumes the existing drive role renderer and Codex adapter without granting them implementation scope.
   - **proven by —** `packages/cli/src/codex-leaf-prompt.test.ts` — substantive runtime/phase/mode, finite test-target and manifest assertions, including actual final stdin with an offline rendered Library fixture and the same assertions against explicitly loaded current live roles. `packages/orchestrator/src/resolve-prove-spec.test.ts` remains a regression floor. The armed-Codex amendment (2026-09-15) is built through contract [`codex-builds-arm-feedback`](codex-builds-arm-feedback.md), signed PASS on its second attempt (run `real-mu253ak1`). The first attempt (`real-mu2420cm`) went red→green and was refused at its GATE backstop by the coverage-drain ceiling, which an unbuilt sibling spec committed ahead of it had breached, not by its own work. The opt-in live-role observation records no signature.
10. **`feedback-tools-spawn-the-same-oracle`** — advertised feedback matches the selected runtime's armed tools without adding Codex proof authority
    - **asserts —** explicit Claude's `run_proof` spawns the exact CONFIRM oracle in REAL and live-smoke, and `run_typecheck` is armed and advertised only with its registered installed-node command. A Codex build is armed from the same registered command objects through `codexFeedbackCommandsFor`, retargeted into its replica: its actual `feedbackToolNames` is `mcp__spine__run_proof`, plus `mcp__spine__run_typecheck` exactly when an installed node registers a typecheck, in REAL and live-smoke alike, and BOTH phases of every REAL arm and live-smoke tell it to run and iterate against those tools without authorizing a shell substitute. Native authoring tool availability, default runtime/model, registered commands and spine observation/signing authority are unchanged.
    - **covers —** `packages/orchestrator/src/resolve-prove-spec.ts` — `feedbackCommandsFor`, the selected-runtime arming and brief wiring in `resolveProveSpec` / `resolveReal` (including `codexFeedbackCommandsFor` at both Codex author sites), and REAL/live-smoke feedback wording.
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.test.ts` — `feedbackCommandsFor: run_proof always (the SAME command, really spawnable); run_typecheck only when registered` executes supplied proof/typecheck commands, while the explicit-Claude REAL installed/no-install and live-smoke resolution tests observe the selected armed tools. `resolveReal` supplies the same REAL proof command to the spine executor and feedback helper, so this is substantive collaborator-level evidence rather than a callback invocation through one resolved author. The armed-Codex amendment (2026-09-15) is built through contract [`codex-builds-arm-feedback`](codex-builds-arm-feedback.md) (signed PASS, run `real-mu253ak1`), whose cases in `packages/cli/src/codex-leaf-prompt.test.ts` observe Codex's armed `feedbackToolNames` and its iterate-with-feedback briefs after production resolution; the retargeted commands themselves are proven by contract 13. Neither replaces the Claude baseline.
11. **`briefs-name-the-declared-contract-ids`** — the phase briefs carry the unit's declared contract ids, independent of what `## Guidance` restates
    - **asserts —** `assemblePrompts` and all three `realPrompts` arms enumerate every declared id in BOTH phases and carry the ADR-0122 naming rule in AUTHOR_TEST; the ids arrive even when the spec's own `## Guidance` names none; a unit declaring no contracts gets no block (brief parity); the live-smoke brief carries none by design.
    - **covers —** `resolve-prove-spec.ts` — the `contractsBrief` helper and its splice sites in `assemblePrompts` and the three `realPrompts` arms
    - **proven by —** `resolve-prove-spec.test.ts` — the five tests whose titles begin `briefs-name-the-declared-contract-ids —`, covering `assemblePrompts enumerates the declared ids in BOTH phases`; `the ids arrive though` the spec's own `## Guidance` restates none; `ALL THREE realPrompts arms carry them`; `a unit declaring NONE gets no block`; and `the live-SMOKE brief deliberately carries NONE` (REAL, passing)
12. **`test-revision-reaches-only-the-author-test-brief`** — a test revision handed to a REAL build reaches the AUTHOR_TEST brief, after everything that brief says today, and no other brief
    - **asserts —** given a `TestRevision`, `realPrompts` returns, in all three REAL arms and under both runtimes, an AUTHOR_TEST brief that begins byte for byte with the brief returned without one. The brief continues with the ADR-0563 D6 `revised-test` attempt, the prior run id, phase, kind and test id, the statement and assertion verbatim, and the spine's observation with each stream tail-kept at 8,000 characters. The IMPLEMENT brief is byte-identical with or without the revision, and `resolveProveSpec` threads `testRevision` into the AUTHOR_TEST brief only.
    - **covers —** `realPrompts`, `RealResolveOptions.testRevision` and its pass-through in `resolveReal` (`packages/orchestrator/src/resolve-prove-spec.ts`), and the `TestRevision` type export through `packages/orchestrator/src/index.ts`
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.revision.test.ts` through contract [`real-brief-carries-test-revision`](real-brief-carries-test-revision.md), signed PASS (run `real-mu1xkwj2`). Not exercised by that proof: either kind literal or the phase label (the section calls an AUTHOR_TEST escalation's phase "test-authoring"), an IMPLEMENT observation's exit code, an IMPLEMENT revision with no observation, and a stream of exactly 8,000 characters.
13. **`codex-feedback-runs-in-the-replica`** — the Codex leaf's feedback commands run the spine's own command objects against the phase's replica instead of the worktree
    - **asserts —** `retargetShellCommand` moves a command's `cwd` and every absolute argument at or inside the workspace to the same relative location under the replica root, judged by path and not by string prefix, and keeps `file`, every other argument, `env` and `timeoutMs` unchanged, returning a new object without mutating its input. `codexFeedbackCommandsFor` returns `run_proof`, plus `run_typecheck` only when a typecheck command is given; each carries its command's own `timeoutMs` or `DEFAULT_PROOF_TIMEOUT_MS` and a description naming the replica, and each `run(replicaRoot)` spawns the retargeted command and returns its exit code as data, while the command object the spine observes still names the workspace.
    - **covers —** `retargetShellCommand` and `codexFeedbackCommandsFor` (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.codex-feedback.test.ts` through contract [`codex-feedback-commands-run-in-the-replica`](codex-feedback-commands-run-in-the-replica.md), signed PASS on the first attempt (run `real-mu23r803`), with the `@storytree/orchestrator` suite and typecheck as its pre-signature backstops at the time (ADR-0580 D2 has since taken the suite out of the build). No mutation rung reaches `packages/orchestrator` (ADR-0563 D3), so its test's strength is unscored.
14. **`real-routes-arm-per-test-observation`** — the resolver arms per-test observation on exactly the routes that run the node's OWN test file through a runner whose per-test report was measured
    - **asserts —** the default node:test route, a declared node:test command over the own file that names `--test`, `vitest run <own file>` directly or through a package manager, and `bun test <own file>` are armed, while whole-package or multi-file suites, a node command without `--test`, and foreign or unrecognised runners stay unarmed and are observed as before; the flags ride the ONE resolved command, so the CONFIRM observations and `run_proof` still spawn one object — node gets the spine's reporter with `spec` to stdout right after `--test`, bun gets `--reporter=junit` right after `test`, and vitest gets `--reporter=json` appended; `realProofCommand`'s preview is unchanged, so the default command stays byte-identical; the observer is wired with the per-build report file; the gate gets a per-test policy that reviews CONFIRM_RED per test only for `editsExisting` and CONFIRM_GREEN on every armed route; a `bun test <own file>` route is classified `bun-test-own-file`, not a package-manager suite, and is spawned as declared, while a single bun test file that is not the node's own is refused at resolve; and end to end, a real build on the default route refuses a hollow test per test and signs a clean one.
    - **covers —** `resolveReal` and `realProofCommand` (`packages/orchestrator/src/resolve-prove-spec.ts`); `perTestChannelOf`, `withPerTestReport` and `classifyProofRoute`'s bun branch (`packages/orchestrator/src/proof/proof-route.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.per-test.test.ts` (session-authored; no signed verdict)
15. **`real-author-test-brief-states-the-per-test-rules`** — on an armed route, the AUTHOR_TEST brief states the per-test rules
    - **asserts —** on an armed route, the AUTHOR_TEST brief from `realPrompts` says every test in the test file reports on its own and must pass at green, and to give each test a literal title, because a `.each` table or a runtime-built title is refused, naming its contract in the title or the enclosing describe; for an `editsExisting` unit it adds that every NEW test must fail now with an assertion, and that an early pass is refused unless every contract it names declares a guard-rail; an unarmed route's brief carries none of this; and the clause sits before the ADR-0571 revision block, which stays the brief's last part.
    - **covers —** `realPrompts` (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.per-test.test.ts` (session-authored; no signed verdict)
16. **`real-cluster-is-admitted-only-where-red-is-observed-per-test`** — the resolver briefs a cluster only where CONFIRM_RED is reviewed per test, and arms C7 with it
    - **asserts —** `resolveReal` refuses a `real.cluster` on a structural red, on a route without a per-test channel, naming a contract the unit does not declare, and naming fewer than two contracts or one twice — each with a reason naming ADR-0573, before any authoring turn; an admitted cluster reaches the gate's per-test policy as `briefContracts`, and a unit without one is armed exactly as before; end to end on the default route, a cluster build whose new tests leave a named contract without one is refused at CONFIRM_RED by C7, the same test with the cluster undeclared signs, and a build writing the whole cluster signs with a red evidence note naming it.
    - **covers —** `resolveReal` and `realClusterRefusal` (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.per-test.test.ts` (session-authored; no signed verdict)
17. **`real-cluster-brief-names-the-cluster-in-both-phases`** — a cluster unit's two briefs name the cluster, and every other brief is unchanged
    - **asserts —** for an `editsExisting` unit on an armed route declaring a cluster, the AUTHOR_TEST brief names exactly the cluster's contracts, with titles and in their declared order, asks for a CLUSTER of regression tests in one slice with at least one NEW failing test per contract, says a rewritten existing test does not count and that C7 refuses a contract left without a new test, and still carries the per-test rules; the IMPLEMENT brief names the same contracts and asks for every test of the cluster green together, iterating against `run_proof`; a unit without a cluster keeps the one-test brief, and a cluster on a structural red or an unarmed route briefs byte for byte as it would without one.
    - **covers —** `realPrompts` (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.per-test.test.ts` (session-authored; no signed verdict)
18. **`briefs-carry-the-proof-walkthrough`** — both phase briefs carry the unit's own proof walkthrough, right after its guidance
    - **asserts —** for a spec whose body carries a proof walkthrough, every `realPrompts` arm — net-new, edits-existing, a cluster and refactor-for-tests — places it right after the guidance in BOTH briefs, led in AUTHOR_TEST as the acceptance setup the test must build with no double or shortcut it rules out, and in IMPLEMENT as the setup the test builds; removing that block leaves exactly the brief the same spec gets without a walkthrough; `assemblePrompts` appends the same two blocks; and a real spec's walkthrough reaches both of its briefs verbatim.
    - **covers —** `realPrompts`, `assemblePrompts` and `proofWalkthroughBrief` (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.walkthrough.test.ts` (session-authored; no signed verdict)
19. **`real-build-arms-the-repair-loop`** — every REAL resolution hands the gate a repair policy read off the unit's own write scope, and a dry run hands it none
    - **asserts —** `resolveReal` stamps `ProveSpec.repair` on every REAL resolution: the build's budget (`RealResolveOptions.repairBudget`, else a wall-clock budget started at resolution), a set-aside against the commit the walk began at, and a typecheck router that answers `test` for a diagnostic naming the unit's declared test file and `code` for one naming its source file, both off the same `PathWriteScope` the phases write under; a dry-run resolution carries no `repair`, so it walks the straight ladder. Every REAL IMPLEMENT brief directs an objection to the `escalate` tool, quoting the assertion and naming an EXISTING test the change legitimately needs updated, and none says "stop and say so plainly". The walk's base commit is read once and the proved-span binding accumulates every scoped commit's IMPLEMENT-scope files, so it survives the tree seam being read again — which both a second GATE visit and the drive's backstop do — instead of narrowing to an empty range. End to end over a fresh worktree with the registry's real proof command and real git: a failed green goes back to the code-writer, both code-writer briefs carry the spine's CONFIRM_RED observation, and the signed verdict still carries its anchors; and an IMPLEMENT escalation goes to a test revision, re-observed red against the real base with the implementation set aside and green against the restored implementation, with the escalation's statement verbatim in the test-writer's brief and both authored files in the spine's commit.
    - **covers —** `resolveReal`'s repair wiring and its one-read walk base, `RealResolveOptions.repairBudget`, the accumulating `proved` span, and `IMPLEMENT_OBJECTION` in every `realPrompts` arm (`packages/orchestrator/src/resolve-prove-spec.ts`)
    - **proven by —** `packages/orchestrator/src/resolve-prove-spec.repair.test.ts` (session-authored; no signed verdict)
