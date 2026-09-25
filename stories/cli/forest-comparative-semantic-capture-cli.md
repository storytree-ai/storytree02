---
id: "forest-comparative-semantic-capture-cli"
tier: capability
story: cli
arc: frontend-builder-semantic-capture-arc
title: "One comparative CLI batch publishes branch and baseline forest evidence on identical semantic frames"
outcome: "A frontend builder can review several named forest targets across branch and baseline from one coherent contact sheet and receipts, without mouse framing or per-target relaunches."
status: proposed
proof_mode: integration-test
depends_on: [forest-semantic-capture-cli]
decisions: []
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/forest-comparative-capture.test.ts", "packages/cli/src/forest-capture-command.test.ts"]
    sourceGlobs: ["packages/cli/src/forest-comparative-capture.ts", "packages/cli/src/forest-capture-command.ts"]
  real:
    testFile: "packages/cli/src/forest-comparative-capture.test.ts"
    sourceFile: "packages/cli/src/forest-comparative-capture.ts"
    editsExisting: false
    scope:
      testGlobs: ["packages/cli/src/forest-comparative-capture.test.ts", "packages/cli/src/forest-capture-command.test.ts"]
      sourceGlobs: ["packages/cli/src/forest-comparative-capture.ts", "packages/cli/src/forest-capture-command.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/cli", "exec", "bun", "test", "src/forest-comparative-capture.test.ts"]
---

# One comparative CLI batch publishes branch and baseline forest evidence on identical semantic frames

**Outcome —** A frontend builder can review several named forest targets across branch and baseline
from one coherent contact sheet and receipts, without mouse framing or per-target relaunches.

## Why this is one capability

Comparison is a single evidence transaction. It has one precondition — a branch arm and baseline arm
that can both execute the existing semantic capture grammar under the same frame — and one observable:
a compact, reviewable set whose two images, receipts and numeric comparison all name the same targets.
Splitting arm dispatch, equivalence checks, count extraction and contact-sheet publication would permit
the harmful state this journey removes: a polished comparison that silently pairs different cameras or
leaves a failed arm behind a successful-looking sheet.

[`forest-semantic-capture-cli`](forest-semantic-capture-cli.md) remains the only ordinary capture
boundary. It owns target parsing, app-seam invocation, settlement and one-arm PNG/receipt truth. This
capability consumes those results twice; it neither reimplements square/story-node/island/resting/fit
resolution nor changes that capability into a branch-comparison tool.

## Guidance

**One semantic request is replayed identically on both arms.** `storytree forest compare` accepts the
same repeatable target occurrences as `forest capture`: `--square <x,y,size>`, `--story <id>`,
`--island <id>`, `--resting`, and `--fit`. It forwards one normalized ordered target list, one explicit
viewport and one explicit four-sided padding value to the branch and baseline capture arms. A caller may
provide already-running branch/baseline Studio URLs or let the command provision them, but lifecycle
choice must not alter target grammar, frame or output meaning. There is no pointer replay, DOM-coordinate
framing, wheel/drag alternative or browser relaunch between targets.

**Receipts prove comparability before imagery is published.** For each arm and target, read the
underlying semantic capture receipt: requested canonical target, resolved id/bounds, applied camera,
viewport, padding, served revision and settlement attestation. The two receipts must agree on canonical
request, resolved subject/bounds and viewport/padding; each arm's own applied camera remains arm-specific
evidence and is never fabricated equal. A target absent on either arm, a target-kind/order mismatch, a
refusal, stale/missing settlement, invalid revision, or an incoherent receipt stops the batch before
comparative publication.

**Publish a review set, not a loose pile of screenshots.** Only after every requested target passes
both-arm receipt validation, publish atomically as one batch: paired `baseline`/`branch` PNGs for every
target, each original per-view receipt, the existing corpus element-count comparison, and a compact
target-indexed contact sheet/index. The index names target order and both served revisions; the contact
sheet makes several views scannable in one opening rather than making a reviewer pan/zoom the map or
restart capture. Candidate files remain private until the complete batch is coherent; a failed batch
publishes neither a contact sheet nor a partial comparison advertised as complete.

**Keep visual judgment outside the machine claim.** The command makes framing, provenance and
comparability inspectable. It does not decide which branch looks better, grade visual taste, mutate
either map, change the normal opening camera, or replace the existing element-count computation with a
second census. A human can judge composition from the published set; this capability proves that the
set means what it says.

## Proof walkthrough

Drive a controlled branch and baseline fixture through one real comparative command containing square,
story, island, resting and fit targets, unequal explicit padding and one viewport. Record each arm's page
seam and settlement calls. Assert the command sends the same normalized ordered requests and frame to
both arms, keeps each arm's session alive across the full target batch, and never sends mouse, wheel or
keyboard input. For every target, compare the published receipt to the fixture record and assert paired
files, the existing count-comparison result, and the contact-sheet index all refer to that target and its
two revisions.

Then make the arms disagree: missing target, changed resolved bounds/id, reversed target order, unequal
viewport/padding, a refusal, missing settlement, invalid revision and a failed sheet/index write. Assert
each returns a typed non-zero result before comparative publication, preserving no ready-looking contact
sheet or complete-result index. The test uses the real semantic-capture transport abstraction and image
writer with deterministic fixtures; it never substitutes gesture replay for semantic targeting.

## Integration test

**Goal —** Prove that comparative forest evidence pairs exactly the semantic views both live arms
actually applied before presenting them together.

1. Invoke the real comparative CLI with square, story, island, resting and fit targets plus one viewport
   and unequal padding. Assert both arms receive the exact normalized ordered requests and frame, while
   each arm stays open for the whole batch.
2. Read every arm receipt and compare it to its fixture seam/motion record. Assert paired counterparts
   agree on canonical target, resolved subject/bounds, viewport and padding, while each retains its own
   applied camera, served revision and settlement attestation.
3. Assert one successful batch publishes all target PNG pairs and per-view receipts with the pre-existing
   corpus element-count comparison and a compact target-indexed contact sheet/index; the index maps every
   thumbnail to its branch/baseline pair and revision.
4. Inject missing/reordered/mismatched targets, unequal frame values, an arm refusal, stale settlement,
   invalid revision and publication failure. Assert a typed non-zero result before comparative
   publication and no contact sheet/index that represents the batch as reviewable.

## Contracts (5)

1. **`fcsc-cli-replays-one-canonical-target-list-to-both-arms`** — comparison begins with the same semantic request
   - **asserts —** repeatable square, story, island, resting and fit flags normalize once and are sent in
     the same order to branch and baseline, with one explicit viewport and four-sided padding; pointer
     replay, screenshot-coordinate framing and per-target browser relaunch are absent.
   - **covers —** `packages/cli/src/forest-comparative-capture.ts`, `packages/cli/src/forest-capture-command.ts`
2. **`fcsc-cli-validates-applied-receipt-pairs-before-output`** — a pair proves it framed the same subject
   - **asserts —** each arm receipt must carry a successful semantic request, matching canonical target
     and resolved id/bounds, and identical viewport/padding, alongside its own exact applied camera,
     served revision and settlement attestation; mismatch or refusal stops before comparative output.
   - **covers —** `packages/cli/src/forest-comparative-capture.ts`
3. **`fcsc-cli-publishes-a-complete-target-indexed-review-set`** — several views are reviewable without map navigation
   - **asserts —** a successful batch atomically publishes paired images and per-view receipts for every
     target, the existing corpus element-count comparison, and a compact contact sheet/index that maps
     each target to its branch/baseline images and revisions.
   - **covers —** `packages/cli/src/forest-comparative-capture.ts`
4. **`fcsc-cli-keeps-arm-provenance-separate-and-explicit`** — comparison never pretends two renders are one revision
   - **asserts —** branch and baseline receipts retain their own served revision and applied camera;
     neither a local checkout head nor the opposite arm's receipt fills an absent provenance field.
   - **covers —** `packages/cli/src/forest-comparative-capture.ts`
5. **`fcsc-cli-refuses-without-a-ready-looking-partial-comparison`** — broken batches cannot masquerade as evidence
   - **asserts —** absent/mismatched/reordered targets, unequal framing, arm refusal, missing or stale
     settlement, invalid revision and any paired/image/count/sheet/index write failure return typed
     non-zero results and leave no published comparative contact sheet or complete-batch index.
   - **covers —** `packages/cli/src/forest-comparative-capture.ts`
