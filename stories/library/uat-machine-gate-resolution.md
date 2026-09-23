---
id: "uat-machine-gate-resolution"
tier: capability
story: library
title: "Exact fail-closed UAT gate resolution"
outcome: "Each parsed machine UAT leg resolves only to its named command-bearing observe gate, with every missing or ineligible binding refused."
status: proposed
proof_mode: integration-test
depends_on: [uat-machine-proof-binding]
decisions: [106, 180]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/library", "test"]
  scope:
    testGlobs:
      - "packages/library/src/witness-resolution.test.ts"
    sourceGlobs:
      - "packages/library/src/witness-resolution.ts"
  real:
    testFile: "packages/library/src/witness-resolution.test.ts"
    sourceFile: "packages/library/src/witness-resolution.ts"
    scope:
      testGlobs:
        - "packages/library/src/witness-resolution.test.ts"
      sourceGlobs:
        - "packages/library/src/witness-resolution.ts"
    install: true
    editsExisting: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/library", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/library", "typecheck"]
---

# Exact fail-closed UAT gate resolution

**Outcome —** Each parsed machine UAT leg resolves only to its named command-bearing observe gate,
with every missing or ineligible binding refused.

**Depends on —** [`uat-machine-proof-binding`](uat-machine-proof-binding.md) — resolution consumes
the parser's exact optional `proofGateId`; it does not reparse prose or infer a replacement.

> **Proof status (honest) — authored `proposed`, REAL-proven.** Run `real-mrf0xzoc` drove the
> literal `witness-resolution.{ts,test.ts}` pair red→green and produced proof commit `28be1de`.
> The signed verdict, not authored frontmatter, derives proof health (ADR-0020). No adopt or
> verdict-signing behaviour is claimed here. Advisory `check:coverage` still reports this contract
> `0/1` because no test title carries `resolves-only-the-declared-gate`; the substantive resolver
> assertions pass, but that static contract-name link remains unresolved.

## Proof walkthrough (written first)

Given parsed UAT legs and a story declaring two observe gates with distinguishable commands:

1. resolve a machine leg bound to the second gate and observe that exact gate regardless of order;
2. reverse gate declaration order and observe the same resolution;
3. remove the binding, name an unknown gate, name a non-observe gate, or name a commandless observe
   gate and observe an explicit refusal for each case; and
4. resolve explicit human and undecided either legs and observe their existing fail-closed human
   result unchanged.

The single observable is the pure resolver result: one exact eligible gate or one refusal reason.

## Guidance

`resolveWitness` remains pure. For an explicit machine leg it looks up exactly
`leg.proofGateId`. It returns an observe resolution only when that full id names a declared
`observe` reliability gate carrying a proof command.

No binding, an unknown id, a non-observe gate, or a commandless observe gate returns an explicit
refusal. There is no first-observe fallback, ordering inference, covers-based inference, or silent
downgrade to human. Explicit human and undecided `either` legs retain the existing fail-closed
human resolution.

The resolver returns the bound gate data needed by the drive, but does not execute its command or
sign a verdict. That consumption belongs to
[`uat-bound-command-adoption`](../drive-machinery/uat-bound-command-adoption.md).

## Integration test

**Goal —** Against the real parser-produced UAT shape and real reliability-gate shape, exact gate
identity is stable under declaration reordering and every invalid machine binding is refused.

Fixtures use at least two observe gates with distinguishable commands and reverse their order, so
choosing the first observe gate cannot accidentally pass. No DB, subprocess, or network is needed.

## Contracts (1)

1. **`resolves-only-the-declared-gate`** — a machine leg resolves to its named eligible observe gate, never a positional fallback.
   - **asserts —** declaration order does not affect the selected full id; unbound, unknown,
     non-observe, and commandless bindings each produce an explicit refusal; human/either preserve
     their existing human resolution.
   - **covers —** `packages/library/src/witness-resolution.ts`.
   - **proven by —** `packages/library/src/witness-resolution.test.ts`, the literal REAL pair.

## Follow-up machine-witness authoring

[`uat-bound-command-adoption`](../drive-machinery/uat-bound-command-adoption.md) is now REAL-proven, and the separate
story-author migration has bound existing machine legs to exact command-bearing observe gates.
Human legs whose full live success condition still lacks a standing command remain human.
