---
id: "forest-semantic-capture-cli"
tier: capability
story: cli
arc: frontend-builder-semantic-capture-arc
title: "One CLI invocation captures named forest targets without pointer replay"
outcome: "A frontend builder can name semantic forest targets once and receive only settled, attested PNGs with exact camera receipts."
status: proposed
proof_mode: integration-test
depends_on: [forest-capture-camera-seam]
decisions: []
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/forest-semantic-capture.test.ts"]
    sourceGlobs: ["packages/cli/src/forest-semantic-capture.ts"]
  real:
    testFile: "packages/cli/src/forest-semantic-capture.test.ts"
    sourceFile: "packages/cli/src/forest-semantic-capture.ts"
    editsExisting: false
    scope:
      testGlobs: ["packages/cli/src/forest-semantic-capture.test.ts"]
      sourceGlobs: ["packages/cli/src/forest-semantic-capture.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/cli", "exec", "bun", "test", "src/forest-semantic-capture.test.ts"]
---

# One CLI invocation captures named forest targets without pointer replay

**Outcome —** A frontend builder can name semantic forest targets once and receive only settled,
attested PNGs with exact camera receipts.

## Why this belongs in the CLI

The builder has one capture journey: name one or more review targets and obtain files that say exactly
what the live forest rendered. The CLI owns argument grammar, server/browser lifetime, browser calls,
settlement observation, file publication and the typed command result. Studio owns a different,
upstream outcome: resolving a canonical target and committing the camera through its mounted map
controller. This capability consumes [`forest-capture-camera-seam`](../studio/forest-capture-camera-seam.md)
instead of duplicating camera math or translating a target into mouse input.

The shared walkthrough has one precondition — a reachable Studio map with the capture seam — and one
observable — a settled PNG/receipt pair for each requested target, or a typed refusal with no such
pair. Splitting browser startup, target dispatch or receipt writing would make a successful image
impossible to attribute to the camera that actually ran.

## Guidance

**One target grammar, one invocation.** `storytree forest capture` accepts repeatable, mutually
exclusive target occurrences: `--square <x,y,size>`, `--story <id>`, `--island <id>`, `--resting`, and
`--fit`. It normalizes `--story` to Studio's `story-node` target, preserves the other canonical target
kinds, and rejects malformed/non-finite square input before a browser command. One invocation may
request several targets and uses one browser session for all of them. It must expose viewport and
padding explicitly; no wheel, drag, keyboard zoom or screenshot-coordinate inference is an alternative
path to framing.

**Reuse deliberately; own deliberately.** A supplied Studio URL reuses that served Studio session. A
supplied browser connection reuses that browser session when its target is compatible; otherwise the
command starts and later tears down the server and browser it owns. Both routes call the same page
seam, never a CLI reimplementation of square/node/island/resting/fit camera policy. A missing or stale
seam is a typed refusal, not a reason to fall back to gesture replay.

**Settle before publish.** For every target, invoke the mounted
`window.__storytreeForestCaptureCamera` command, wait for a fresh successful
`window.__storytreeMotionSettled` attestation after that command, and compare its applied camera with
the seam receipt. Only then may the CLI write the PNG and its JSON sidecar. The receipt records the
canonical requested target, any resolved id/bounds, the applied `{ tx, ty, scale }`, explicit viewport
and padding, the served Studio revision, and the settled attestation used for this image. A reused
server must report its own revision; the CLI must not substitute its checkout's `HEAD` for an unknown
remote page revision.

**Fail closed at the file boundary.** Invalid options, target-not-found, unavailable world, missing or
unsettled page signal, browser/server failure, revision ambiguity, screenshot failure, or a mismatch
between seam and motion result returns a typed non-zero envelope. Write candidate image/receipt paths
privately and publish neither until the full pair is coherent; clean abandoned candidates. A prior
image for another requested target is not evidence for a failed target and must never be relabelled or
returned as one.

**This is not comparative capture or visual approval.** The capability does not compare branches,
choose a baseline, grade the visual composition, change the ordinary Studio opening camera, or update
frontend-builder guidance. A later comparative workflow consumes this command; a human may still judge
taste from its files, but machine proof here judges target delivery, receipt truthfulness and refusal.

## Proof walkthrough

Run the real CLI command against a controlled served Studio fixture exposing the real page-global names
and a deterministic screenshot writer. First pass square, story, island, resting and fit targets in one
call; assert their canonical page requests in order, a single reused browser session, explicit viewport
and padding, a fresh settled attestation after each request, and one PNG plus JSON receipt per target.
For each receipt compare the seam's resolved bounds and committed camera byte-for-byte with its recorded
values and assert the served page revision rather than a local substitute.

Then drive both reuse routes (supplied Studio URL and supplied compatible browser connection) and the
owned server/browser route; assert the command neither creates nor tears down a resource it did not
own. Finally make malformed squares, unknown ids, a missing/stale seam, a false or absent settled signal,
camera disagreement, revision absence and screenshot write failure each return the declared non-zero
refusal while leaving no target PNG or receipt. The tests call the semantic seam and synthetic screenshot
transport directly; they never send mouse, wheel or keyboard framing input.

## Integration test

**Goal —** Prove that the CLI produces a traceable capture only after the app applied and settled its
semantic camera target.

1. Start the controlled Studio fixture and invoke the real CLI once with each target form. Assert the
   normalized seam calls, one browser reuse, the requested viewport/padding, fresh settlement and complete
   paired outputs.
2. Read every receipt and compare its requested target, resolved bounds, applied camera, viewport,
   served revision and settle attestation to the fixture's actual seam/motion records. Assert the image
   path was published only after that evidence existed.
3. Repeat with a supplied Studio URL, a supplied compatible browser connection, and no supplied session.
   Assert lifecycle ownership is correct in each route and camera resolution is still solely page-owned.
4. Inject every refusal boundary: malformed target, missing id, unavailable/missing seam, stale or false
   settled state, camera mismatch, missing served revision and image-write failure. Assert a typed non-zero
   result and no PNG/receipt pair for the rejected target.

## Contracts (5)

1. **`fsc-cli-normalizes-one-semantic-target-grammar`** — target flags become exactly one page target
   - **asserts —** repeatable `--square`, `--story`, `--island`, `--resting` and `--fit` forms parse to
     the canonical Studio target vocabulary (`--story` becomes `story-node`); non-finite, incomplete or
     non-positive squares refuse before a browser action, and no pointer-replay fallback exists.
   - **covers —** `packages/cli/src/forest-semantic-capture.ts`
2. **`fsc-cli-reuses-or-owns-the-session-explicitly`** — lifecycle does not change capture semantics
   - **asserts —** supplied compatible Studio/browser sessions are reused without being torn down, while
     absent supplied sessions cause one owned server/browser lifecycle for the invocation; every route
     invokes the same app-owned capture seam for every target.
   - **covers —** `packages/cli/src/forest-semantic-capture.ts`
3. **`fsc-cli-publishes-an-applied-settled-receipt`** — an image has a machine-checkable account of itself
   - **asserts —** each published PNG has one sidecar receipt containing canonical target, resolved
     bounds/id, the applied `{ tx, ty, scale }`, viewport/padding, served revision and the fresh
     `window.__storytreeMotionSettled` attestation; the recorded applied camera agrees exactly with the
     page seam receipt.
   - **covers —** `packages/cli/src/forest-semantic-capture.ts`
4. **`fsc-cli-never-labels-local-head-as-an-external-page-revision`** — provenance identifies the rendered page
   - **asserts —** an owned server may supply its known revision, but a reused Studio URL requires a
     page-provided served revision and refuses when it cannot obtain one; local checkout `HEAD` never
     fills that unknown value.
   - **covers —** `packages/cli/src/forest-semantic-capture.ts`
5. **`fsc-cli-refuses-without-a-misleading-capture`** — incomplete evidence never looks successful
   - **asserts —** target/seam/world failures, absent or false settlement, receipt disagreement,
     revision ambiguity and PNG/sidecar write failures return typed non-zero envelopes and publish no
     image or receipt for the failed target, including no partial pair.
   - **covers —** `packages/cli/src/forest-semantic-capture.ts`

