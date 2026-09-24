// @storytree/drive — the build/orchestrate runtime barrel (the `.` export, ADR: the drive
// extraction). The drivers that compose the orchestrator spine + the agent leaf + the live stores
// into node/story builds, adoption, and the headless orchestrator, returning the CLI Envelope.
// Consumed by the terminal CLI (`@storytree/cli`, which re-exports for back-compat) and the studio
// server. HARD INVARIANT: this package imports NOTHING from `@storytree/cli` (no cycle).
//
// Re-exports every moved module's public surface so the consumers that used to import `./x.js`
// from cli now import the same names from `@storytree/drive`. The `./build` and `./secrets`
// subpaths carry the narrow build seam + secrets hydration separately (studio imports those lazily).

export * from "./envelope.js";
export * from "./secrets.js";
export * from "./store-door.js";
export * from "./corpus-store.js";
export * from "./adr-frontmatter.js";
export * from "./adr-metas.js";
// The derived arc → children join (ADR-0183 D3 / ADR-0267 D4) used to be re-exported here. It moved
// to `@storytree/arc` with the rest of the arc domain (`arc-tier-extraction-arc`), and the arrow now
// runs arc → drive: the join reads this package's ADR-frontmatter and work-hierarchy scanners, so
// drive cannot import it back without a cycle. Every surface that served the rollup — the CLI, the
// studio server, the desktop backend — imports `@storytree/arc` directly, which is still ONE join.
// The write STAMP for a local-process library write (`cli@<branch>`) — here rather than in
// `@storytree/cli` for the `envelope.ts`/`secrets.ts` reason, now that the arc write verbs live in a
// third package that must stamp identically and cannot import the CLI (ADR-0112's reach-move).
export * from "./cli-actor.js";
// The work-hierarchy ref resolver (ADR-0306 D1): `story:`/`capability:` pointers turned into the
// units they name, against ONE checkout — reported when they dangle, never refused on write.
export * from "./work-hierarchy.js";
// The work-hierarchy PROJECTOR (ADR-0445 D1, `map-freshness-arc` inc-02): the same tree read into
// the shape the live store mirrors, so the forest map's question half can eventually come off the
// same clock as its proof half. It CHANGES NO READER — `readTree` is untouched, and inc-03 owns the
// switch. Its sibling above resolves POINTERS at a checkout; this one projects the whole tree.
export * from "./hierarchy-projection.js";
// The build's LIVENESS channel (`diagnosis-honesty-arc`): a long run names the leg holding its
// clock, so a redirected log tells "slow but progressing" apart from "wedged on a precondition".
export * from "./build-hold.js";
export * from "./build-peek.js";
export * from "./build-progress.js";
// The SPAWN REGISTRY (`shared-box-session-ownership-arc` inc 1): which long-running process belongs
// to which session, so a session can inventory its own work on a shared box — and so reclaiming it
// never needs the start-time heuristic that reaches across sessions.
export * from "./spawn-registry.js";
export * from "./spawn-stop.js";
export * from "./node-build.js";
export type { BuildGuard, BuildGuardResult } from "./build-guard.js";
// ADR-0378: the stale negative-existence-claim REAL-mode precondition — a declared sourceFile that
// already exists on disk while the spec's own prose still (anchored) says it does not.
export * from "./stale-existence-claim.js";
export * from "./time-budget.js";
// The paid-build entry's before-spend preflight (ADR-0576): resolving the increment a build is
// filed under, and preflighting every unit it will drive against the attempt ledger.
export * from "./inner-loop-entry.js";
// Per-slice token-usage persistence (accounting, never proof): the SdkRunInfo → UsageEventDoc
// mapping + the advisory append the build paths run after proveUnit.
export * from "./usage.js";
export * from "./scope-walls.js";
export * from "./story-build.js";
export * from "./adopt.js";
export * from "./adopt-capability.js";
export * from "./orchestrate.js";
export * from "./chat-stream.js";
// The ADR-0137 spawn-deps composition (`buildSpawnDeps`) and the ADR-0152 landing-deps composition
// (`buildLandingDeps`) were exported here until ADR-0175 retired both surfaces with the interactive
// orchestrator (ADR-0174) rather than re-aiming them into `app-guide`. Deliberately absent — see
// apps/desktop/src/backend/{spawn,landing}-surface-retired.test.ts, the guards that keep them gone.
// The inspect-deps composition (ADR-0173): `buildInspectDeps` — the desktop sidecar composes the real
// read-only `gh`/`git` inspection deps and threads them through the chat mount → startChatStream →
// orchestrate (the CI/git diagnosis surface). Observation only; each tool refuses a mutating arg.
export * from "./inspect-deps.js";
export * from "./wisp-smoke.js";
export * from "./resolve-report.js";
export * from "./curate.js";
export * from "./noticeboard.js";
// The graded claim-ledger verbs (ADR-0200 D2): claim / upgrade / downgrade / release / claims —
// the noticeboard IS the claim ledger; declare/done live in ./noticeboard.js as the claim-taking
// anchor ceremony + bulk release (presence retired, ADR-0200 D7).
export * from "./noticeboard-claims.js";
// The claim NAMESPACE (ADR-0310 D2, `first-class-edges-arc` increment 2): a claim names a KIND and
// an id that resolves to a real object of that kind, or it is refused at the point of claiming with
// the near-miss named. `claim-namespace.js` is the pure resolver + the declared inventory of the 26
// phantom ids that accumulated before it existed; `claim-universe.js` gathers the namespace from the
// disk tree, the live Library and the declared subtree map, and carries the guard every
// claim-taking verb calls.
export * from "./claim-namespace.js";
export * from "./claim-universe.js";
// The declared subtree ownership map (ADR-0317 D2), read ONCE for both of its consumers: the
// `storytree ownership` report in `cli` (which re-exports the matcher) and the claim namespace
// above, which makes each declaration claimable (D3). Two readers could disagree about what is
// declared, which is the divergence `first-class-edges-arc` exists to close.
export * from "./source-ownership-map.js";
export * from "./subtree-match.js";
// The manifest FRAGMENT contract and its one composer (ADR-0556, `repo-manifest-fragmentation-arc`):
// what a fragment is, where it lives, and how a set of them composes into the manifest's one view —
// refusing, never guessing, whenever the set does not say one thing. Every section is authored as
// fragments under `repo-manifest/` and read through it; no committed aggregate sits beside them
// (`repo-manifest-aggregate-leaves-git`).
export * from "./manifest-fragments.js";
export * from "./manifest-fragments-read.js";
// `noticeboard history` — the READ verb over the claim AUDIT log (ADR-0310 D1): the ledger verbs
// above and the board render STATE, this reads TRANSITIONS (holdings, refusals, the summary). A
// refusal leaves no state behind, so no state read can answer for it.
export * from "./noticeboard-history.js";
// The report-only factory-floor health instrument (ADR-0316, `factory-floor-health-arc`): the
// recurrence-since-route and distinct-bottleneck computations over the Library's primary sources,
// and the rate-normalise-or-refuse coupling-churn walk over git. Here rather than in `cli` for the
// `arc-rollup` reason — ADR-0316 D5 names ADR-0314 D7's floor-health strip as the first committed
// CONSUMER, and the studio server cannot import `@storytree/cli`. The CLI renders these; nothing
// here writes, gates or adjudicates (D1/D4).
export * from "./factory-health.js";
// The store-reading half of that instrument — the ONE composition that turns a live store into the
// floor-health reading, so `storytree factory health` and `GET /api/floor-health` cannot compose the
// same three reads slightly differently.
export * from "./factory-health-read.js";
export * from "./coupling-churn.js";
// Claim-release honesty (the second instance of the ADR-0199 class): a run releases only the claim
// its OWN take created, and every release that is not an explicit ceremony names the claim, the
// caller and the time — so a silently-cleared claim is discovered when it happens, not a full gate
// cycle later at `check:declared`.
export * from "./claim-release.js";
// The session-isolation wall (ADR-0255 D1, ADR-0257 D1, narrowed by ADR-0284): the STATIC
// `permissions.deny` block that makes the primary checkout unwritable by the agent's file tools,
// generated from the repo manifest's `root` so the lobby surface and the wall cannot drift apart.
//
// This is the WHOLE wall. The claim-aware `PreToolUse` half — the decision core, the claim receipt
// and the Claude adapter — was RETIRED by ADR-0284 D2/D4, never registered, and deleted rather than
// parked: a hook blocks only on exit code 2, so an absent script or a crash lets the write through,
// which is not an authority boundary. Recover it from git if the Codex adapter (ADR-0257 D2/D3/D7)
// ever needs the containment logic.
export * from "./write-authority-rules.js";
// The ambient session surface (statusline glance + the worktree-activity sweep + the SessionStart
// nudge + the never-blocking-hooks audit) — ledger-sourced since the presence retirement
// (ADR-0200 D5/D7). The claim HEARTBEAT is no longer a self-report: ADR-0535 D3 retired the
// status-bar bump, and liveness is now OBSERVED from file change inside each claimed worktree.
export * from "./ambient-presence.js";
export * from "./db-control.js";
// The read/orientation surface (the ADR-0112 pattern, applied to the ADR-0108 orientation gap):
// the tree view, the library dashboard + its health checks and doctrine pointers, and the
// composed read-only orientation runner the desktop sidecar hands to the chat session.
export * from "./tree.js";
export * from "./tree-verdicts.js";
export * from "./tree-attestations.js";
export * from "./health.js";
export * from "./doctrine.js";
export * from "./library-dashboard.js";
export * from "./orientation-runner.js";
export * from "./orientation-reads.js";
