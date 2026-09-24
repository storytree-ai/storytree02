---
id: "frontend-builder-semantic-capture"
tier: story
title: "Semantic forest capture framing for frontend builders"
outcome: "A frontend builder can name a forest capture target and receive the exact camera frame the Studio applied or a typed reason it cannot be applied."
status: proposed
proof_mode: UAT
uat_witness: machine
arc: frontend-builder-semantic-capture-arc
capabilities: [forest-capture-camera-seam]
# This tooling is hosted in the existing Studio surface. The later CLI/browser driver consumes the
# seam delivered here; Studio's interactive map does not consume a new runtime package.
depends_on: [studio]
artifact_edges: [studio]
consumed_by: []
decisions: []
---

# Semantic forest capture framing for frontend builders

**Outcome —** A frontend builder can name a forest capture target and receive the exact camera frame
the Studio applied or a typed reason it cannot be applied.

## Journey

A frontend builder preparing a visual review does not reconstruct the map with wheel events and drag
deltas. They name one semantic target to the Studio capture seam: a world-space square, a story node,
an island, or the canonical `resting` / `fit` views. Given the real loaded world and capture frame,
Studio either applies one deterministic camera and reports the resolved target plus `{ tx, ty, scale }`,
or refuses without changing the camera and names why. The later CLI/browser increment invokes that seam
and writes PNGs; this story delivers the reliable framing contract that makes that orchestration possible.

## Capabilities

| # | capability | outcome | depends on |
|---|---|---|---|
| 1 | [`forest-capture-camera-seam`](forest-capture-camera-seam.md) | A named forest capture target resolves to one exact camera receipt or a typed refusal through Studio's testable capture seam. | — |

Dependency graph: `forest-capture-camera-seam`.

## Boundary and ownership

This story owns the semantic target vocabulary and Studio-facing capture-camera seam, physically hosted
in `apps/studio/src/lib` and the `TreeView` controller. It consumes Studio's existing world layout,
bounds, camera limits and canonical resting/fit functions; it does not fork any of those models. It is
deliberately not a screenshot driver: browser launch, PNG writing, baseline comparison, contact sheets,
CLI argument parsing and frontend-builder guidance are later increments that consume this seam through
one command path.

## UAT Test Criteria

**Goal —** A builder can make a repeatable visual-review framing request without mouse navigation.

1. **A semantic capture request has one honest result** _(witness: machine)_ _(criterion-id: uatc_a289667bf18e5f471e57c0fc)_ _(revision-id: uatr1:cf2bdf732dd4aa48)_
   - With a loaded Studio forest and a positive capture frame, request each supported target kind:
     a world square, a story node, an island, `resting`, and `fit`. Observe a receipt containing the
     canonical target and exact applied `{ tx, ty, scale }`; project the reported bounds back through
     that camera to confirm the subject is framed. Request a missing id, malformed square and unusable
     frame; observe a typed refusal and the prior camera unchanged.

## Reliability Gates

1. **The focused Studio capture-seam suite is green** _(gate: observe)_
   _(covers: forest-capture-camera-seam)_
   `pnpm --filter studio exec vitest run src/components/TreeView.captureCamera.test.tsx`.

`healthy` remains derived from signed evidence; authored status stays `proposed`.
