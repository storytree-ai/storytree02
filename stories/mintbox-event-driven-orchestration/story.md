---
id: "mintbox-event-driven-orchestration"
tier: story
title: "Mintbox event-driven orchestration — fresh Astra decisions, sustained Terra execution"
outcome: "Unattended Mintbox graphics work continues safely through compact event-driven Astra coordination and Terra lane execution without retaining a coordinator through worker activity."
status: proposed
proof_mode: UAT
uat_witness: machine
arc: mintbox-event-driven-orchestration-arc
capabilities: [mintbox-supervisor-events, mintbox-protected-driver-transition, mintbox-terra-lane-launch]
depends_on: [agent, notice-board, arc]
artifact_edges: [arc]
decisions: [604, 505]
---

# Mintbox event-driven orchestration — fresh Astra decisions, sustained Terra execution

**Outcome —** Unattended Mintbox graphics work continues safely through compact event-driven Astra
coordination and Terra lane execution without retaining a coordinator through worker activity.

> **Current status —** ADR-0604 supersedes the dispatcher decision recorded as ADR-0561. Manual lane
> launch is the current Mintbox route. These retained legacy components, walkthroughs, contracts and
> UAT criteria document existing proof rather than the delivery now wanted; their code and story
> retirement is already parked as `mintbox-dispatcher-retirement`, and this interim record does not
> claim that retirement complete.

## Proof walkthrough first

Seed one running Terra rendering proof, a durable claim/handle snapshot, and a bounded event stream.
Deliver a duplicate completion event and observe one fresh coordinator launch with a bounded digest,
not a raw transcript; then deliver its safe green-boundary release and observe a verified Terra driver
take the released lane. Finally deliver a GPU-intensive ready lane beside existing 3D drivers and
observe the capacity/serialisation decision plus the compact usage delta report. The same precondition
(Mintbox supervisor state plus durable programme state) and observable (safe continued work) holds for
the whole walkthrough, so the story stays one journey.

## Capabilities

| capability | outcome | depends on |
| --- | --- | --- |
| [`mintbox-supervisor-events`](mintbox-supervisor-events.md) | Meaningful programme events deterministically wake at most one compact Astra coordinator with bounded recovery/report input. | — |
| [`mintbox-protected-driver-transition`](mintbox-protected-driver-transition.md) | An active rendering proof is observed but never migrated until its own green boundary releases it. | `mintbox-supervisor-events` |
| [`mintbox-terra-lane-launch`](mintbox-terra-lane-launch.md) | A coordinator launches and verifies Terra drivers under claims, model policy, and 3D/GPU capacity fences. | `mintbox-supervisor-events`, `mintbox-protected-driver-transition` |

## UAT Test Criteria

1. **A meaningful event wakes one compact coordinator and leaves an auditable digest.** _(witness: machine)_ _(detail: mintbox-event-driven-orchestration#uat-1)_ _(criterion-id: uatc_a6c0e9b10e4f52a8d9160c11)_ _(revision-id: uatr1:00c747f3222ee25b)_
   Deliver duplicate completion/failure/dependency/empty-ready/owner-gate events to the deterministic
   supervisor. **Success —** one deduplicated coordinator handle is launched per event key; its input
   contains only the bounded programme digest; and its three-hour report records health, actual
   model/effort, lanes, last outcome, blockers, weekly usage, delta, and action.
2. **The live renderer changes driver only at its safe green boundary.** _(witness: machine)_ _(detail: mintbox-event-driven-orchestration#uat-2)_ _(criterion-id: uatc_b417c89fd2a0e63c5b8a1742)_ _(revision-id: uatr1:45d3ac9f5394f666)_
   Observe a live rendering-proof handle before and after its terminal green/release event.
   **Success —** observation never stops, reclaims, or replaces the active handle; only the emitted
   green boundary makes its released work eligible for a new coordinator decision.
3. **A dispatched lane is a verified Terra driver within the 3D/GPU fence.** _(witness: machine)_ _(detail: mintbox-event-driven-orchestration#uat-3)_ _(criterion-id: uatc_c93d51e7a482b0f6c5d8e309)_ _(revision-id: uatr1:ab5bdd38e739a677)_
   Dispatch ready lanes from a coordinator snapshot containing claims and current 3D/GPU occupancy.
   **Success —** every launched driver records GPT-5.6 Terra and its handle/claim; the coordinator is
   GPT-6 Astra at high unless the recorded decision is architectural; no more than three disjoint 3D
   lanes run, and GPU-intensive lanes serialize.
