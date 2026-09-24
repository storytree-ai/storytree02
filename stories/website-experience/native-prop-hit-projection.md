---
id: "native-prop-hit-projection"
tier: capability
story: website-experience
title: "Native prop hit projection — semantic records become yaw-safe drawing-world envelopes"
outcome: "Every native semantic hit record becomes an immutable absolute drawing-world root, crown and conservative envelope that preserves its story, capability and status while containing its scaled full-width native prop at every yaw, with no new camera, clock, placement stream or world-offset transform."
status: proposed
proof_mode: integration-test
depends_on: [native-semantic-hit-records]
decisions: [608]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs: ["packages/forest-world-r3f/src/native-prop-hit-projection.test.ts"]
    sourceGlobs: ["packages/forest-world-r3f/src/native-prop-hit-projection.ts"]
  real:
    testFile: "packages/forest-world-r3f/src/native-prop-hit-projection.test.ts"
    sourceFile: "packages/forest-world-r3f/src/native-prop-hit-projection.ts"
    scope:
      testGlobs: ["packages/forest-world-r3f/src/native-prop-hit-projection.test.ts"]
      sourceGlobs: ["packages/forest-world-r3f/src/native-prop-hit-projection.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/native-prop-hit-projection.test.ts"]
---

# Native prop hit projection — semantic records become yaw-safe drawing-world envelopes

**Outcome —** The landed `NativePropHitRecord` is already an immutable, attributable native-ground
fact: its root includes the mapper's ancestor translation, its relief/height and scaled footprint
are the frozen native dimensions, and its status is semantic. This capability converts that fact
once to absolute drawing-world root, crown and bounds. It uses the core elevation helpers supplied
by its caller; it does not reconstruct a placement, read SVG, make a camera or receive host pixels.

**Depends on —** [`native-semantic-hit-records`](native-semantic-hit-records.md) supplies the only
eligible semantic record stream. Its records contain no yaw, so this capability conservatively
encloses every yaw from the measured full-width footprint rather than opening another placement
stream.

## Proof walkthrough

1. Supply immutable tree, dead-tree and coverage-flora records with distinct story/capability/status,
   nonzero absolute roots and relief, and scaled full-width footprints/heights. The initial test is
   red because no projection module exists.
2. Project each record at an explicit existing elevation. The output keeps its semantic fields and
   makes its root from the ground projection less relief through upright foreshortening; its crown
   is the same root less its height through upright foreshortening. Its conservative bounds contain
   both endpoints.
3. Treat each supplied footprint as a full width, never a radius. With no yaw field in the landed
   record, use the `sqrt(2)` full-plan span that contains every yaw of a native plan box whose two
   measured axes are at most that width; prove all four 45-degree corners remain inside the drawing
   bounds after ground projection.
4. Snapshot each record and nested root before projection. Afterwards they are unchanged and the
   result is immutable. The projection receives no world offset and emits no camera/CSS transform,
   so the mapper's absolute root is neither offset nor transformed a second time. The pure module
   imports no React, DOM, SVG, WebGL/Three, clock, fetch, renderer or host component.

## Contracts (3)

1. **`native-prop-hit-projection-preserves-native-semantic-records-in-drawing-world`** — supplied
   semantic records become immutable drawing-world root, crown and bounds retaining their story,
   capability and status, with actual relief and height carried through the core elevation helpers.
   - **asserts —** given a landed `NativePropHitRecord` and explicit elevation,
     `projectNativePropHitEnvelope` returns immutable drawing-world root, crown and bounds with the
     same story, capability and status, applying core ground and upright foreshortening to its
     supplied relief and height.
   - **covers —** `native-prop-hit-projection.ts` — test:
     `native-prop-hit-projection.test.ts`
2. **`native-prop-hit-projection-encloses-full-width-native-props-at-any-yaw`** — a record's
   footprint is full width rather than radius, and the envelope contains every tree, dead-tree or
   coverage-flora yaw without recovering a placement or SVG anchor.
   - **asserts —** given a record with full footprint width `w`,
     `projectNativePropHitEnvelope` emits the `sqrt(2) * w` yaw-independent plan span whose
     ground-projected bounds contain the four 45-degree corners of an admissible native prop.
   - **covers —** `native-prop-hit-projection.ts` — test:
     `native-prop-hit-projection.test.ts`
3. **`native-prop-hit-projection-keeps-records-and-host-transforms-single-source`** — projection
   does not mutate the supplied record or create a second placement/camera/offset path.
   - **asserts —** after `projectNativePropHitEnvelope` projects a supplied record, that record and
     its nested root retain their values and identities, while the output accepts no world offset
     and carries no camera or CSS transform.
   - **covers —** `native-prop-hit-projection.ts` — test:
     `native-prop-hit-projection.test.ts`
