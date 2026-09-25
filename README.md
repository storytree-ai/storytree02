# storytree

> **New here? Read [CLAUDE.md](CLAUDE.md) first.** It is the orientation doc for a
> fresh session — current truth, the active reversals, and where the source lives.

An agentic software-builder. Work is modeled as a **DAG of stories** — each
story a **bounded context** (an organism) proven by a **UAT** acceptance
walkthrough, composed of **capabilities** proven by **integration tests** (real
in-story collaborators), down to **contracts**, the isolated unit-test leaf — and
a fleet of AI coding agents grows the tree, one proven story at a time. You **watch it
grow**: every state change is a typed event rendered live in a game-like
(city-builder) view, so the system's internals are visible rather than
buried.

This is **storytree 0.2**, a greenfield rebuild (now frozen while 0.3 is rebuilt in a fresh repo). The first tree (`C:\code\Agentic`, a
Rust + Claude-Code corpus) proved the *idea* — stories, contracts, a
commit-time gate, UAT promotion — but its internals were vibed and are hard
to see. 0.2's bet: **design observability up front, go slow, own every layer,
stay model-agnostic.**

## North star

Set up the building blocks so **storytree can build itself** — agents author,
test, and UAT-prove stories on the tree, and the tree's own growth is the
product you watch. 0.2 is currently being *bootstrapped* by hand (Claude Code
over the Agentic repo as the midwife harness); the goal is for that scaffolding
to fall away as the tree becomes self-building.

## Architecture (the layers)

```
┌─────────────────────────────────────────────────────────────┐
│  studio (web IDE)   React shell + SVG hex-forest world        │  apps/studio
│  watch + DRIVE: diffs, approvals, steering, per-node chat     │
└───────────────▲───────────────────────────┬─────────────────┘
                │ events out                 │ commands in
┌───────────────┴───────────────────────────▼─────────────────┐
│  orchestrator   DAG scheduler · event store · the story tree  │  packages/orchestrator
│  concurrency-safe on a typed Postgres store — parallel from   │
│  day one (no store-lock races, conflict-free story IDs)       │
└───────────────▲───────────────────────────┬─────────────────┘
                │ normalized events          │ run / steer / approve
┌───────────────┴───────────────────────────▼─────────────────┐
│  agent        wraps an owned-loop session per node           │  packages/agent
│  maps the owned loop's lifecycle event stream + diffs → ours │
└──────────────────────────────┬───────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  owned loop (the     │  agent loop built on
                    │  loop that writes    │  the Anthropic
                    │  the code per story) │  Messages API
                    └─────────────────────┘

   packages/core — shared types: story / capability / contract / event schema (the
                   single source of truth every layer speaks)
```

The orchestrator owns only what the owned loop does **not**: multi-node DAG scheduling and
concurrency-safe shared state on a typed Postgres store. Everything an agent does inside a node
— the model loop, steering, diffs, approvals — belongs to **the owned loop**. Observability
is **ours**: the owned loop's event stream + orchestrator events land in our own event
store and render in our own UI. No external trace SaaS.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language / runtime | TypeScript, Node 24, pnpm workspaces | model-agnostic, owns the loop |
| Per-node coding agent | `PhaseAuthor` seam: Codex subscription leaf by default, Claude subscription leaf explicitly, owned loop offline/pivot-out | the deterministic spine keeps the proof boundary and exact-file promotion independent of the selected leaf |
| Runtime store | **Cloud SQL Postgres** via typed `node-pg` (`packages/library/src/store` — the old `packages/store` dissolved, ADR-0077) | concurrency-safe shared state; JSONB + zod-validated. DBOS is deferred (ADR-0019), so this is a plain typed Postgres connection — durable workflows stay a reserved future target |
| Orchestration | thin custom layer | the story-DAG + event store; small, ours |
| Observability | own event store | owned-loop events + orchestrator events → typed event log → UI. No per-trace SaaS |
| Tree UI | **SVG** hex-forest world (ADR-0036/0069; PixiJS was rejected) | procedural SVG scenes, no engine dependency; R3F/WebGL stays a far-future website target (ADR-0145) |
| Models | via `PhaseAuthor` | Codex reuses saved ChatGPT auth by default; Claude is explicit; owned loop stays offline/pivot-out |

See ADR-0001 — `storytree library artifact adr-0001` — for how this was chosen (and what was rejected — Mastra, LangGraph/LangSmith,
Google ADK; the Claude Agent SDK, initially passed over, later became the first default **live**
runtime per ADR-0030, with the owned loop demoted to the offline executor; ADR-0232 added a
ChatGPT-subscription Codex leaf through the same proof boundary, and ADR-0555 made it the default).

## Principles

- **Observability-first.** The event model is designed before features. If a
  state change isn't a typed event the UI can render, it doesn't exist.
- **Go slow, own the layers.** No vibing the load-bearing parts.
- **Parallel from day one.** Concurrency-safe state is a foundation, not a
  retrofit — learned the hard way from 0.1's store-lock races and story-ID
  collisions.
- **Model-agnostic, self-hosted.** Subscription-funded leaves behind one seam; your data and traces
  stay in Storytree's own store.

## Repo layout

```
packages/core          shared types: story / capability / contract + event + Library schema
packages/orchestrator  DAG scheduler, event store, the prove-it (red-green) gate
packages/agent         owned-loop session wrapper → normalized events
packages/library       library schema + node-pg store subpath over Cloud SQL Postgres (keyless IAM)
packages/cli           the choose-your-own-adventure Library CLI (ADR-0023)
apps/studio            web IDE: React + SVG forest world, and the Library browser
apps/studio/data       comments + the gitignored offline runtime store (the Library lives in the DB)
docs/research          long-form decision-provenance behind specific ADRs
```

The decisions are not in this tree: they are `adr` rows in the shared store (ADR-0403).

## Documentation & the Library

Durable project knowledge lives in the **Library** — a typed artifact tier
(`definition` / `principle` / `pattern` / `guardrail` / `techstack` / `template` /
`adr` / `open-question`), not in a sprawl of standalone docs. Its structured source is
the shared Cloud SQL Postgres store (ADR-0017 / ADR-0019), browsed in the studio, and explored from
the CLI (`pnpm storytree library`).

The live store is the ONLY source of truth (ADR-0302 D1) — no committed file mirrors it. Term
definitions are authoritative as Library `definition` artifacts, looked up just-in-time (ADR-0135
retired the old generated `docs/glossary.md`; ADR-0210 retired the generated
`apps/studio/data/assets.json`; ADR-0302 D1 deleted `apps/studio/data/knowledge.json`, the last
committed mirror). To change the Library, use the CLI against the live DB
(`pnpm storytree library artifact edit <id> --pg`) or the studio.

**The decision log is in the store too, and is no longer a directory** (ADR-0403). The ADRs were
`docs/decisions/*.md` until 2026-08-22; all 403 are now ordinary `adr` artifacts alongside the rest
of the Library. A decision's address is its NUMBER, not a path — read one, or list the current set,
with a verb:

```
storytree library artifact adr-0001      # one decision
storytree adr list --current             # every accepted, non-superseded decision
storytree adr list --load-bearing        # the calibrate-to-these set
```

What remains under `docs/` is therefore intentionally lean — everything else durable has
folded into the Library:

- **`docs/open-questions.md`** — the deferred-decisions backlog, cited by section number
  (`§n`) from the ADRs and Library units.
- **`docs/research/`** — long-form decision-provenance behind specific ADRs.

The one-read orientation for a fresh agent session is [CLAUDE.md](CLAUDE.md) — it assumes the
machine is already provisioned. Two onboarding guides sit upstream of it, and they answer different
questions:

- **[`docs/machine-onboarding.md`](docs/machine-onboarding.md)** — a computer that has never run
  storytree becomes a working dev box (toolchain, the three sign-ins, the secrets file, worktrees,
  write-authority, and how to prove each).
- **[`docs/model-onboarding.md`](docs/model-onboarding.md)** — a new model or harness is brought onto
  a checkout that already works.

## Development (bootstrap phase)

storytree is built via Claude Code during bootstrap. The 0.1 tree is vendored as a
**read-only submodule** at `legacy/Agentic` (no longer a live sibling repo you
`--add-dir` into) — it's kept for reference, not edited.

```bash
corepack enable pnpm   # Node 24 ships corepack; no global install needed
pnpm install
```

That is the short form, and it assumes git, Node 24 and the GitHub CLI are already present and
authenticated. **Provisioning a machine from nothing is
[`docs/machine-onboarding.md`](docs/machine-onboarding.md)** — it covers the toolchain, the three
browser sign-ins, `~/.storytree/secrets.json`, worktree discipline and the write-authority wall,
with a proof for each step.

The runtime store is **Cloud SQL Postgres with keyless IAM auth** (ADR-0021) — no
local Docker Postgres, no `DATABASE_URL`, no password. Bring the store up/down
through the Auth Proxy via pnpm scripts:

```bash
pnpm db:up      # start the Cloud SQL instance + Auth Proxy (IAM, ambient ADC)
pnpm db:down    # stop it (cost posture — see infra/README.md)
```

Copy `.env.example` → `.env` and set `ANTHROPIC_API_KEY` (the Anthropic SDK is
the only model provider). DB auth is keyless; there is no connection secret to
fill in. See [infra/README.md](infra/README.md) for the one-time gcloud auth.

## Status

**Foundation built and green.** The foundation packages — `packages/core` (the
shared story/capability/contract + event schema), `packages/agent` (the owned
loop on the Anthropic Messages API), `packages/orchestrator` (DAG scheduler,
event store, and the **prove-it red-green gate**, ADR-0020), and `packages/store`
(the typed Postgres client) — are implemented and passing. The library/knowledge
tier already migrated into the shared Cloud SQL store (ADR-0017 / Phase-2,
keyless IAM per ADR-0021). DBOS-style durable workflows remain **deferred**
(ADR-0019, reaffirmed ADR-0020) — a named, reserved future target, not a
dependency today. Next up: growing outward from the foundation onto the live
story tree.
