---
id: "native-semantic-hit-records"
tier: capability
story: website-experience
title: "Native semantic hit records — actual capability props carry host-ready identity and extent"
outcome: "Every attributable native capability tree, dead tree and coverage flora placement yields one immutable semantic hit record with its real story, capability, folded status, root, relief and canonical scaled footprint/height; decorative, UAT and unattributed placements yield none, while the canonical placement and caster inputs remain unchanged."
status: proposed
proof_mode: integration-test
depends_on: [coverage-flora-native-placement]
decisions: [608]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs: ["packages/forest-world-r3f/src/native-prop-hit-records.test.ts"]
    sourceGlobs: ["packages/forest-world-r3f/src/native-prop-hit-records.ts"]
  real:
    testFile: "packages/forest-world-r3f/src/native-prop-hit-records.test.ts"
    sourceFile: "packages/forest-world-r3f/src/native-prop-hit-records.ts"
    scope:
      testGlobs: ["packages/forest-world-r3f/src/native-prop-hit-records.test.ts"]
      sourceGlobs: ["packages/forest-world-r3f/src/native-prop-hit-records.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/native-prop-hit-records.test.ts"]
---

# Native semantic hit records — actual capability props carry host-ready identity and extent

**Outcome —** The one canonical `GroundInput.placements` list already drives both actual native
props and their ground casters. This capability reads that supplied list, its existing
`islandByPlacement` provenance and a supplied semantic-status lookup keyed by those exact placement
objects. It returns records only for native `tree`, `deadTree` and `coverageFlora` capability props.
Each record carries the owning story and capability, folded status, actual root and relief, and the
canonical footprint/height after placement scale. It neither recreates placement nor derives status
from a tint.

**Depends on —** [`coverage-flora-native-placement`](coverage-flora-native-placement.md) delivers
the attributable `coverageFlora` role in the canonical placement stream. The status lookup remains
Canvas-private glue over the existing `GroundInput` identity; this capability accepts it as supplied
semantic input and exports no descriptor-status map or second placement pass.

## Proof walkthrough

1. Build a supplied `GroundInput` with its canonical placements and island provenance: capability
   `tree` and `deadTree` placements on different stories, plus one `coverageFlora` placement with
   non-unit scale. Supply their folded statuses through the placement-keyed semantic lookup. The
   initial test is red because no semantic hit-record module exists.
2. Derive exactly one record per eligible placement. It preserves the supplied story id, capability
   id and semantic status, and reports the placement's real `at` root and relief `y`. Its footprint
   and height are the existing frozen role dimensions multiplied by that placement's scale; the
   coverage record therefore keeps its source-derived scale rather than a generic plant extent.
3. Add decorative `bush`/`tuft`/`flowerPatch`, UAT `bloom`/`bud`/`wilt`, a missing island provenance
   and a missing semantic-status lookup. None yields a record or guessed identity/status. In
   particular, healthy tree and unhealthy dead-tree fixtures both use null tint, proving the record
   reads the supplied semantic lookup rather than attempting to reverse a material colour.
4. Snapshot the original placement list, its island-attribution map and caster inputs before and
   after deriving records. They remain unchanged. The module is pure: it imports no React, DOM,
   WebGL, camera/projection, clock, fetch or renderer component.

## Contracts (3)

1. **`native-semantic-hit-records-carry-attributed-prop-identity-status-and-extent`** — each
   attributable tree, dead tree and coverage-flora placement yields one record with its supplied
   story/capability/status, actual root and relief, and scaled canonical footprint/height.
   - **asserts —** given supplied canonical placements, island provenance and a placement-keyed
     semantic-status lookup, `native-prop-hit-records.ts` yields one immutable record for each
     eligible tree, dead tree and coverage-flora prop, preserving its supplied story, capability,
     folded status, root and relief while multiplying the frozen role footprint and height by its
     placement scale.
   - **covers —** `native-prop-hit-records.ts` — test:
     `native-prop-hit-records.test.ts`
2. **`native-semantic-hit-records-never-invent-decorative-uat-or-missing-semantics`** — decorative
   cover, UAT props and placements missing provenance or supplied semantic status yield no record;
   tint is never a status input.
   - **asserts —** when `native-prop-hit-records.ts` receives decorative cover, UAT props, or a
     placement without provenance or supplied semantic status, it returns no record for that
     placement and never infers its status from tint.
   - **covers —** `native-prop-hit-records.ts` — test:
     `native-prop-hit-records.test.ts`
3. **`native-semantic-hit-records-preserve-canonical-ground-inputs`** — deriving records does not
   mutate or replace placements, island attribution or caster inputs and creates no second
   placement/caster path.
   - **asserts —** after `native-prop-hit-records.ts` derives records from supplied canonical
     ground inputs, the placement list, island-attribution map and caster inputs retain their
     original identities and values, and no replacement placement or caster collection exists.
   - **covers —** `native-prop-hit-records.ts` — test:
     `native-prop-hit-records.test.ts`

## Boundary

This is the pure semantic record seam only. A later capability consumes these records to project
deterministic root-to-crown SVG envelopes in the host, where retained `sceneTapSelect`, focus and
keyboard behavior remain authoritative. That later work owns host projection and integration after
the relevant canvas claim is free; this capability adds no SVG target, camera, picking, renderer
loop, clock, network request or flat-picture retirement.
