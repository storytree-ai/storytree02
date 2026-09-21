---
id: "phase-scoped-write-wall"
tier: capability
story: drive-machinery
title: "The per-phase write wall on the tool surface"
outcome: "A leaf write outside the current phase's scope is refused before it reaches the real executor, and the refusal is recorded."
status: proposed
proof_mode: integration-test
depends_on: [red-green-phase-machine]
---

# The per-phase write wall on the tool surface

**Outcome —** A leaf write outside the current phase's scope is refused before it reaches the real executor, and the refusal is recorded.

**Depends on —** [`red-green-phase-machine`](red-green-phase-machine.md)

> **Proof status (honest) — `proposed`.** Fully covered by a real, passing, offline suite
> (`packages/orchestrator/src/write-scoped-executor.test.ts`, part of `@storytree/orchestrator`
> 99/99 — I ran it 2026-06-13). This greenfield capability has no current signed pass; the standing
> suite does not make it brownfield (ADR-0395).

## Guidance

ADR-0020 §2 ENFORCEMENT for the owned loop: V1's process-isolation walls re-created as one agent's
time-sliced write-ownership. `WriteScopedToolExecutor`
(`packages/orchestrator/src/write-scoped-executor.ts:62-129`) decorates a real `ToolExecutor`:

- a tool absent from the `WriteToolSpec` map is a NON-write and passes straight through;
- a write tool's path(s) are extracted and EACH checked against `scope.isWriteAllowed(phase, path)`
  — if ANY path is denied, the inner executor is **never invoked**: an `is_error` tool result names
  the refused path and phase (the model sees the wall and can adapt), and the violation is recorded
  on `violations` so the gate and tests can assert the wall held;
- an extractor returning `null` (no scoped path) passes through but is noted on `noPathCalls`;
- the spine flips the phase via `setPhase` as it advances the leaf — the same write that was denied
  in one phase is allowed in the next.

This is the OWNED-LOOP wall. The live SDK leaf enforces the same predicate a different way — a
fail-closed `PreToolUse` deny hook inside `ClaudeAgentAuthor` (`packages/agent/src/sdk-author.ts`,
ADR-0030) wired to the same `isWriteAllowed` signature by
[`prove-spec-resolution`](prove-spec-resolution.md) — one predicate, two enforcement points (see
the story's executor-seam note).

The code edge for the `depends_on`: `write-scoped-executor.ts:16` imports `Phase` + `WriteScope`
from `./phase-machine.js` (type-only — the wall's whole contract is the phase machine's ownership
predicate, called at `write-scoped-executor.ts:107-110`).

## Integration test

**Goal —** The wall holds inside the real gate walk, not just in isolation: the e2e proof
(`packages/orchestrator/src/prove-it-gate.e2e.test.ts:160`) drives
[`owned-loop-phase-author`](owned-loop-phase-author.md) — which wraps its real `FileToolExecutor`
in this decorator — through both authoring slices, with the test file written ONLY in AUTHOR_TEST
and the impl ONLY in IMPLEMENT against the real `PathWriteScope`.

## Contracts (8)

1. **`in-scope-write-delegates`** — a TEST write in AUTHOR_TEST and a SOURCE write in IMPLEMENT reach the inner executor
   - **asserts —** the inner executor is called; no violation recorded.
   - **covers —** `packages/orchestrator/src/write-scoped-executor.ts:107-127`
   - **proven by —** `packages/orchestrator/src/write-scoped-executor.test.ts:76` and `:98` (REAL, passing)
2. **`out-of-scope-write-refused-and-recorded`** — a TEST write in IMPLEMENT and a SOURCE write in AUTHOR_TEST/CONFIRM_RED/GATE are `is_error` refusals
   - **asserts —** the result names the path and phase; the violation is recorded.
   - **covers —** `write-scoped-executor.ts:112-124`
   - **proven by —** `write-scoped-executor.test.ts:85` and `:107` (REAL, passing)
3. **`non-write-tools-bypass`** — a tool not in the write map passes through in any phase, no scope check
   - **asserts —** read/list-shaped calls always delegate.
   - **covers —** `write-scoped-executor.ts:94-97`
   - **proven by —** `write-scoped-executor.test.ts:121` (REAL, passing)
4. **`set-phase-flips-the-wall`** — the same write is denied in one phase and allowed after `setPhase`
   - **asserts —** denied then allowed across a flip.
   - **covers —** `write-scoped-executor.ts:87-89`
   - **proven by —** `write-scoped-executor.test.ts:143` (REAL, passing)
5. **`inner-never-invoked-on-deny`** — a denied write never touches the real executor
   - **asserts —** the spy counter stays 0 on a refusal.
   - **covers —** `write-scoped-executor.ts:112-124`
   - **proven by —** `write-scoped-executor.test.ts:166` (REAL, passing)
6. **`multi-path-any-deny`** — a write naming several paths is refused if ANY is out of scope
   - **asserts —** one bad path poisons the whole call; every denied path is recorded.
   - **covers —** `write-scoped-executor.ts:107-117`
   - **proven by —** `write-scoped-executor.test.ts:175` (REAL, passing)
7. **`null-extractor-passes-and-notes`** — a write whose extractor finds no scoped path passes through but lands on `noPathCalls`
   - **asserts —** delegation + the note.
   - **covers —** `write-scoped-executor.ts:101-105`
   - **proven by —** `write-scoped-executor.test.ts:200` (REAL, passing)
8. **`an-existing-test-the-scope-named-is-the-test-writers`** — the wall also admits the EXISTING test files the unit's scope reached, exactly, and they stay the code-writer's to leave alone
    - **asserts —** a path in `PathWriteScopeConfig.existingTestFiles` is writable in `AUTHOR_TEST` and refused in `IMPLEMENT`, `CONFIRM_RED`, `CONFIRM_GREEN` and `GATE` — it is a TEST path, so `IMPLEMENT`'s existing `isSource && !isTest` term excludes it with no second rule about who may write a test. The set is matched EXACTLY, not as globs: it admits the files it names, refuses one that merely shares their directory, their basename or a nested path below them — which is what keeps the grant to files that EXISTED when the scope was derived rather than to the whole package — and a Windows-separated path from a leaf still matches. A scope declaring no existing test files behaves exactly as it did before ADR-0590, its declared globs untouched.
    - **covers —** `PathWriteScopeConfig.existingTestFiles` and `PathWriteScope.isWriteAllowed` (`packages/orchestrator/src/phase-machine.ts`)
    - **proven by —** `packages/orchestrator/src/phase-machine.test.ts` (session-authored; no signed verdict)
