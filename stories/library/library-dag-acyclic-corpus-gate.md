---
id: "library-dag-acyclic-corpus-gate"
tier: capability
story: library
arc: directional-dag-arc
title: "A fail-closed gate rung refuses a cycle in the authored standsOn DAG"
outcome: "A pure judge projects the stored corpus onto the shipped cycle detector and returns a verdict with its denominators, and a gate rung reads the live corpus through it so no standsOn cycle can sit on main unseen."
status: proposed
proof_mode: integration-test
depends_on: ["library-standson-schema-admission"]
decisions: [223]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/library", "test"]
  scope:
    testGlobs: ["packages/library/src/knowledge-dag-corpus.test.ts"]
    sourceGlobs: ["packages/library/src/knowledge-dag.ts"]
  real:
    testFile: "packages/library/src/knowledge-dag-corpus.test.ts"
    sourceFile: "packages/library/src/knowledge-dag.ts"
    scope:
      testGlobs: ["packages/library/src/knowledge-dag-corpus.test.ts"]
      sourceGlobs: ["packages/library/src/knowledge-dag.ts"]
    install: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/library", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/library", "typecheck"]
---

# A fail-closed gate rung refuses a cycle in the authored `standsOn` DAG

**Outcome —** A pure judge projects the stored corpus onto the shipped cycle detector and returns a
verdict with its denominators, and a gate rung reads the live corpus through it so no `standsOn`
cycle can sit on `main` unseen.

ADR-0223 D3 requires a fail-closed acyclicity gate — "the guarantee citations could never give".
`library-dag-acyclic-core` shipped the detector; this capability is the corpus-shaped judge around it
and the rung that runs it.

**Why a `check:*` rung rather than a test inside `pnpm -r test`.** ADR-0223 D3 called for a guard
"sibling to `adr-number-unique`", which was buildable when it was written: the corpus was a committed
file a hermetic test could read. ADR-0302 D1 deleted that file and ADR-0302 D3 keeps `pnpm -r test`
credential-free, so a corpus test would now take the whole leg down on every DB-less checkout.
ADR-0307 D4 states the resulting line: assertions about the REAL corpus belong on a `check:*` rung,
which may hold a connection. The rule ADR-0223 decided is unchanged; only its address moved.

## Proof walkthrough first

Hand the judge literal stored rows. Observe that an `asset:` pointer resolves onto the node it names
— and that a two-node ring built from pointers is REPORTED, which is the regression the projection
exists for, since unprojected pointers would make every corpus report clean. Observe that a `doc:`
ADR target stays absent from the graph and therefore cannot close a ring. Hand it hostile rows — null,
non-object, wrong-typed and mixed-element payloads — and observe every one projects to an edge-free
node rather than throwing. Observe an empty corpus and a real acyclic one both report their document
and edge counts. Finally observe a corpus carrying a self-loop and a three-node ring report both, each
as a closed rendered path.

## Build boundary

Author only:

- `packages/library/src/knowledge-dag.ts` (extend — do NOT write a second detector)
- `packages/library/src/knowledge-dag-corpus.test.ts`
- `packages/library/src/index.ts` (barrel re-export only)
- `packages/cli/src/check-library-dag-acyclic.ts` (the rung — and the wiring: the `/* gate-check`
  declaration it opens with is the whole registration, since the gate finds a check by its file name
  and reads its placement, subject and CI identity from that header, ADR-0606 D1)
- `package.json` (the root `check:library-dag-acyclic` script — a by-hand convenience; the gate does
  not read it)

*(Corrected in place 2026-09-24 for ADR-0606 D1: the last bullet named `package.json`,
`packages/cli/src/gate-order.ts`, `packages/cli/src/gate-order.test.ts` and `.github/workflows/ci.yml`
as the wiring. The gate's hand-kept plan and CI's check steps are gone — a check is found from its own
file — so none of those is where a rung is registered any more.)*

Every rule lives in the pure judge; the rung reads the corpus, prints, and sets an exit code. The
rung is `shared-environment` on both ordering axes — a cycle is authored by a live artifact write, so
any session's edit can red it — and it fails CLOSED on an unreadable corpus rather than declaring a
skip. Do not bootstrap any corpus edge and do not touch the Studio.

## Contracts

1. **`library-dag-corpus-projects-pointers-to-node-ids`** — stored pointers become graph nodes.
   - **asserts —** an `asset:<id>` entry resolves onto the node with that bare id, so a ring authored
     as pointers is reported as a cycle; a `doc:<relpath>` ADR entry is carried through unstripped and
     stays absent from the graph, so ADRs are natural sinks that cannot close a ring (ADR-0223 D4).
   - **proven by —** `packages/library/src/knowledge-dag-corpus.test.ts`, with a test title beginning
     with this exact contract id.
2. **`library-dag-corpus-projection-is-total-over-untrusted-rows`** — a surprise row is not a red.
   - **asserts —** null, undefined, non-object, missing-field, wrong-typed and mixed-element payloads
     each project to an edge-free node and never throw, so an unexpected row cannot take the gate down
     in a way indistinguishable from a genuine cycle.
   - **proven by —** `packages/library/src/knowledge-dag-corpus.test.ts`, with a test title beginning
     with this exact contract id.
3. **`library-dag-corpus-reports-its-denominators`** — a pass names how much it judged.
   - **asserts —** the verdict carries the document and authored-edge counts alongside the boolean, so
     "no cycles" and "read nothing" cannot print the same way; an empty corpus reports zero for both.
   - **proven by —** `packages/library/src/knowledge-dag-corpus.test.ts`, with a test title beginning
     with this exact contract id.
4. **`library-dag-corpus-reports-every-distinct-cycle`** — every ring is returned, rendered.
   - **asserts —** a corpus carrying a self-loop and a longer ring reports both; each is a closed path
     whose rendered line is that path, so an operator can see which edge to drop rather than a count.
   - **proven by —** `packages/library/src/knowledge-dag-corpus.test.ts`, with a test title beginning
     with this exact contract id.

## Integration test

Run `pnpm --filter @storytree/library test`, then `pnpm --filter @storytree/library typecheck`. The
judge's proof is literal rows against the real shipped detector — no DB, socket, live Library row or
human witness participates. The rung's WIRING is its own `/* gate-check` declaration
(`subject: shared-environment`, `ciIdentity: ci-presence`), and `pnpm -r test` holds it in two
places: `gate-checks.test.ts` requires every check-shaped file in the repo to declare itself cleanly
and the real plan to run every live check the tree declares, once each; `gate-rerun.test.ts` holds a
declared `ciIdentity` to the check file's real import closure, so this rung cannot stop declaring the
store it reads. *(Corrected in place 2026-09-24 for ADR-0606 D1/D2: this said the wiring was held by
`gate-order.test.ts` — the plan pinned by name, every planned step naming a real root script. Both went
with the hand-kept plan they policed.)*
