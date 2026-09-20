---
id: "live-codex-leaf"
tier: capability
story: agent
title: "The live Codex runtime runs through authenticated, pinned, externally owned process boundaries, with no self-verdict"
outcome: "A caller uses the live Codex runtime only after ChatGPT-managed login is proven with metered credentials scrubbed, through pinned process boundaries whose runtime-produced identity, filesystem effects, ownership, and termination stay externally observable, while red/green and verdicts remain outside the runtime."
status: proposed
proof_mode: integration-test
# Code-derived (ADR-0010 §3): codex-author.ts imports AuthoringPhase/AuthorResult/PhaseAuthor (type)
# from ./phase-author.js (phase-author-seam) and TokenUsage (type) from ./model-events.js
# (model-runtime-seam). Type-only imports count, per the agent story's dependency-graph rule.
# live-sdk-leaf added 2026-09-15: codex-feedback-endpoint.ts (contract codex-feedback-endpoint,
# ADR-0570) imports executeFeedback (value) and FeedbackCommand/FeedbackRunOutput/SdkFeedbackRun
# (type) from ./sdk-author.js. It also imports AuthoringPhase (type) from ./phase-author.js.
# Still phase-author-seam, no new edge (contract codex-leaf-escalates, ADR-0569): the endpoint also
# imports parseAuthoringEscalation (value) and AuthoringEscalation (type) from ./phase-author.js, and
# codex-author.ts adds AuthoringEscalation (type) to its import from the same module.
depends_on: [phase-author-seam, model-runtime-seam, live-sdk-leaf]
decisions: [232, 356, 390, 555, 569]
---

# The live Codex leaf — pinned, externally observed runtime boundaries

**Outcome —** A caller uses the live Codex runtime only after ChatGPT-managed login is proven with
metered credentials scrubbed, through pinned process boundaries whose runtime-produced identity,
filesystem effects, ownership, and termination stay externally observable, while red/green and
verdicts remain outside the runtime.

> **Proof status (honest) — `proposed`, with a live leg that is need-gated and operator-attested only.**
> `codex-author.test.ts` holds 36 tests over an injectable `CodexRunner` process seam; the few that need
> a real child process drive the production runner against the pinned CLI's `--version` or a stand-in
> executable, so no test spends a subscription turn. Re-run 2026-09-15 on Windows: 34 pass, 2 skip (the
> POSIX signal-forwarding test, and a case-distinct-path test that needs a case-sensitive filesystem),
> 0 fail. Every existing `CodexPhaseAuthor` decision is therefore offline-testable: the login proof (`isChatGptManagedLogin`), the
> credential scrub (`scrubMeteredCodexAuth`), the pinned command (`buildCodexExecArgs`), the one-turn
> JSONL contract (`parseCodexJsonl`), manifest validation, replica promotion and its rollback, and the
> spawn bound (`resolveCodexTimeoutMs`). The genuinely LIVE leg — a real `codex exec` turn drawing on a
> ChatGPT subscription — is need-gated and operator-attested: live builds have driven it, but no
> standing test in this package does. Contract `codex-detached-app-server` is authored but not yet
> implemented, proof-registered or signed: its source, named test and `proof.real` arm must land
> together. No `healthy` — no capability verdict (ADR-0020).

This is the second live `PhaseAuthor` (ADR-0232) and, since ADR-0555, the one the build path binds when
no runtime is named — `--runtime claude` selects [`live-sdk-leaf`](live-sdk-leaf.md) instead. It runs
the official Codex CLI wrapper pinned by `@openai/codex` (or one absolute executable named by
`STORYTREE_CODEX_EXECUTABLE`), on `gpt-5.6-terra` unless a Codex model is named explicitly. It depends
by code on `phase-author-seam` — `codex-author.ts` imports `AuthoringPhase` / `AuthorResult` /
`PhaseAuthor`, and `CodexPhaseAuthor` IS a seam implementation — and on `model-runtime-seam`, whose
model-event vocabulary supplies the `TokenUsage` shape its run record reports (both type-only). Since
2026-09-15 it also depends by code on [`live-sdk-leaf`](live-sdk-leaf.md), and not type-only:
`codex-feedback-endpoint.ts` runs every feedback call through that leaf's `executeFeedback` and imports
its `FeedbackCommand` / `FeedbackRunOutput` / `SdkFeedbackRun` types, so both leaves share one budget
decision and one output framing (ADR-0570 D5). The spine authors each phase's write globs and exact
promotion manifest before either phase starts, so what may be promoted is never the model's to decide.

The honesty walls sit OUTSIDE the model (ADR-0020), and each fails closed:

- **Stage identity before work (`codex-detached-app-server`).** The role-neutral public seam opens one
  detached app-server from the repository-pinned Codex dependency, initializes it, and obtains a
  thread without starting a turn. It returns only response-produced thread/model/effort identity plus
  an OS-observed positive pid and a platform-honest opaque owner: a POSIX process group or a Windows
  owned process tree, never one mislabeled as the other. Only after a caller has independently checked
  and persisted those observations may it call the same handle's bounded `startTurn`; bounded `probe`
  and idempotent `terminate` retain exact POSIX group ownership, or exact Windows root identity only
  while `tasklist` re-observes the same live token. Windows may then use rooted `taskkill /T`; root exit
  or token change ends that authority, is dead-for-controller, and proves nothing about escaped
  descendants. The seam claims no broader Windows containment. This is a **contract**,
  not a seventh capability: its honest proof is one isolated automated test surface with injected
  auth, protocol, clock, process and OS collaborators, while its live runtime boundary is already the
  independently viable capability described here. The seam carries no Mintbox or model-role policy.

- **Subscription or nothing (ADR-0232 D3).** Before every slice, `codex login status` runs with
  `OPENAI_API_KEY`, `CODEX_API_KEY` and `CODEX_ACCESS_TOKEN` removed in every case variant, and only an
  exit-zero `Logged in using ChatGPT` — the sole line, on a single output channel — admits the turn. An
  API-key login, a logged-out or ambiguous status, and quota or auth failures all refuse the slice;
  there is no API-key or metered fallback. On the live path a missing or empty rendered phase prompt, a
  missing or malformed promotion manifest, malformed write globs or an empty brief refuse before the
  probe runs.
- **The disposable replica, inside Codex's own sandbox (ADR-0390, ADR-0583).** Each turn authors in a fresh copy of the
  build workspace, cut under the checkout's gitignored `.gate-logs/codex-replicas` without `.git`,
  `.codex`, `.claude`, `.gate-logs` or `node_modules`; an armed phase links the installed dependencies
  back in before its before-snapshot (ADR-0570 D3). The command is pinned (`buildCodexExecArgs`): one
  ephemeral `--json` turn that ignores user config and rules, never asks for approval, forces ChatGPT
  login on the `openai` provider, disables web search, subagents, hooks, apps, remote plugins, unified
  exec and every MCP server except the spine's own loopback endpoint an armed phase is given (ADR-0570
  D2), and keeps the legacy shell tool that carries `apply_patch`. It runs Codex's own
  `--sandbox workspace-write` (on Windows the `unelevated` sandbox): the replica is the one writable
  root, temp directories excluded, and the shell has no network. The child environment carries no
  secret-shaped variable, store pointer or git locator, plus a git ceiling at the replica's parent, so
  the worker's git cannot discover the build's repository (ADR-0583). *(Corrected 2026-09-20: this
  said the phase ran `--sandbox danger-full-access` with network enabled and the real workspace within
  reach, which was true until ADR-0583.)* The promotion wall below still decides what the spine
  copies.
- **Observed promotion against an exact finite manifest (ADR-0356).** The spine hands each phase an
  explicit packing list — `allowedTargets` containing a non-empty `requiredTargets` — and a list carrying
  a wildcard, an absolute or traversing path, a Windows-unsafe component, or two entries that collide
  once normalized or case-folded is refused before Codex starts. After the turn the replica is
  snapshotted and diffed against its pre-turn snapshot; that filesystem diff, never Codex's file-change
  report or final response, is the evidence. One observed path that is unlisted (matched exact-case) or
  refused by the phase predicate refuses the WHOLE phase before anything is copied, and is recorded as a
  violation. Otherwise every required target must exist as a regular file and at least one must have
  changed; the observed allowed subset is staged, checked against the real workspace (a target that
  changed meanwhile, has more than one hard link, or sits under a symlinked parent is refused), applied,
  verified, and on failure rolled back with every target attempted. The replica is discarded on every
  exit path.
- **Authoring only, never proof (ADR-0232 D5).** The brief tells the leaf it works in a replica, names
  its allowed and required targets, and says the spine runs every registered proof after it stops.
  Every build arms the leaf (ADR-0570 D1, contract `codex-builds-arm-feedback` under
  `prove-spec-resolution`): it is handed the spine's registered `run_proof`, and `run_typecheck` for an
  installed node that registers one, exposed on the spine's loopback endpoint and run against its own
  replica, with Codex's tool timeout above the longest proof bound the commands carry. Each executed run
  is recorded on `feedbackRuns`, and the build envelope reports them (contract
  `node-build-renders-codex-feedback-runs`). The same endpoint carries `escalate` (ADR-0569): the first
  valid escalation in a slice ends it with nothing promoted. Its native shell still carries no
  proof-feedback authority, and red/green, promotion and the verdict stay the spine's. *(Corrected in
  place 2026-09-15, when builds armed the leaf; until then no build handed it feedback commands and
  `feedbackToolNames` was `[]`.)*
- **One turn, parsed fail-closed, accounted honestly (ADR-0232 D6).** `parseCodexJsonl` requires exactly
  one `turn.started` and one `turn.completed` carrying readable token usage; a malformed event, a failed
  turn, or a missing or extra turn fails the slice. The run record keeps the model, the single turn,
  input / cache-write / cache-read / output and reasoning tokens, and the observed changed paths — and
  no USD figure, because a list-price estimate is not subscription spend.
- **Every spawn is bounded (`inner-loop-exit-arc-inc-05`, PR #1909).** A spawn that outlives its bound is
  killed and reported `timedOut`. `resolveCodexTimeoutMs` takes an explicit bound, else the per-machine
  `STORYTREE_CODEX_TIMEOUT_MS`, else ten minutes (`DEFAULT_CODEX_TIMEOUT_MS`); a non-numeric, zero or
  negative override falls back to the default, so a typo cannot disable authoring. The login probe has
  its own 60-second bound. A timed-out probe or exec refuses as UNVERIFIED — never as an auth failure or
  a malformed turn, because nothing was observed. The bound signals the pinned wrapper; measured on
  codex-cli 0.145.0 it reaches the native binary on both platforms (`inner-loop-exit-arc-inc-07`). A
  POSIX test pins that the wrapper forwards the signal and waits for its child; the native binary's own
  response and the Windows reach are measurements without a test.

## Proof

The existing `CodexPhaseAuthor` decisions above are integration-proven offline against the injected `CodexRunner` (ADR-0010 §2):
the exact login proof and the scrub, the pinned command, the one-turn JSONL contract, manifest refusal,
whole-phase refusal before any copy, multi-file promotion, rollback under injected promotion faults, and
the bound under an injected clock. A real `codex exec` turn is need-gated and operator-attested, not a
free/offline standing test — the boundary every live leg in storytree carries (a subscription turn
cannot be a free standing test). This capability carries no `real:` arm, so it is not in the story's
buildable set. The staged detached-process behaviour is authored one grain down in
[`codex-detached-app-server`](codex-detached-app-server.md), but remains deliberately unregistered and
unbuildable until its implementation, named test and `proof.real` arm land together. That future child
proof will not invent the missing capability-level live integration proof.
