// The gate's ORDERING invariant — the PURE half (`green-gate`, stories/ci-cd).
//
// This module owns the canonical, ordered {@link GATE_PLAN} walked by `pnpm gate`. The runner runs
// every step and reports every verdict: one red never turns later proof into an invisible skip.
//
// THE PLAN IS DECLARED LITERAL, AND THE RUNNER MAY NARROW IT (ADR-0304 D1). {@link GATE_PLAN} always
// names the full `pnpm -r typecheck` / `pnpm -r test`; `gate-run.ts` rewrites those two commands to
// the affected scope (`pnpm --filter ...<name> …`) just before running them, using CI's own
// classifier. This module therefore recognises BOTH forms ({@link isExpensiveStep}) — the ordering
// invariant below has to be judgeable over the plan that actually runs, not only over the one on the
// page. Scoping changes how much each leg covers; it changes nothing about order or whether a red
// blocks.
//
// TWO AXES, both fail-closed, both about WHEN a verdict arrives rather than about what it says.
//
// AXIS 1 — CHEAP FIRST. The four retained branch-local `check:*` steps precede the two independent
// minutes-cost legs, `pnpm -r typecheck` and `pnpm -r test`.
//
// AXIS 2 — THE SESSION'S OWN WORK BEFORE THE SHARED ENVIRONMENT (parked entry
// `gate-runs-every-step-and-reports-per-step` on `verification-integrity-arc`, from friction
// `gate-aborts-early-hiding-thirteen-later-steps`). The retained projection checks read the live
// Library, and `check:verification-decay` can red on shared proof state, so all three run AFTER both
// expensive legs.
//
// Deliberately NOT a `check:gate-order` gate rung: the invariant is about the shape of the gate plan,
// so a rung inside that plan would be a step checking the list it is a member of. The honest home is
// a test in `pnpm -r test` (`gate-order.test.ts`), which holds the plan to the sets below AND to the
// real root `package.json` — every planned step must name a script that exists, and every retained
// `check:*` script must be in the plan or carry an explicit non-gate reason.
//
// Pure: no I/O. The caller supplies the plan and the root package.json's script names.

/**
 * The chain's minutes-cost legs, in the form {@link GATE_PLAN} DECLARES them. The plan is literal —
 * it always names the full `-r` run — so this is what a reader of the plan sees and what
 * `gate-order.test.ts` holds the plan to.
 */
export const EXPENSIVE_STEPS: readonly string[] = [
  "pnpm -r --no-bail typecheck",
  "pnpm -r --no-bail test",
  // ADR-0458. The third minutes-cost leg, and the only one that is a `check:*` — it runs a real
  // mutation pass over this branch's changed lines, so it belongs on the expensive side of the
  // ordering wall even though it names a check rather than a `-r` leg. It is NOT pinned into
  // PRE_EXPENSIVE_CHECKS: those must precede the wall, and this one IS past it.
  "pnpm check:mutation-diff",
];

/*
 * WHY `--no-bail` IS PART OF THE DECLARED LEG (ADR-0276 increment 4, the last of its three elements).
 *
 * Without it `pnpm -r` halts at the FIRST failing workspace, so one package's red hides every later
 * package's verdict INSIDE this one step. That is the inner half of the 2026-07-29 evidence recorded
 * in `gate-runner.ts`: an `apps/studio` `waitFor` flake aborted `pnpm -r test`, `packages/cli` never
 * ran, and it held a REAL break the session then pushed. The runner's per-step scoreboard fixed the
 * OUTER half — a red no longer hides later STEPS — and this fixes the same defect one level down,
 * inside the step. Both halves are the same rule: a gate must report what it did not verify.
 *
 * IT CANNOT MAKE THE GATE GREENER. `--no-bail` changes only how far the leg gets before reporting;
 * pnpm still exits non-zero if any workspace failed, so every red that blocked before blocks now. The
 * trade is wall clock — a failing leg runs every workspace instead of stopping at the first — which
 * is the same trade the runner already made at step granularity and the reason `asset:merge-ceremony`
 * step 2 mandates `pnpm gate:bg`.
 */

/**
 * The same two legs in the AFFECTED-SCOPE form (ADR-0304 D1): `pnpm --filter ...<name> typecheck`.
 *
 * Recognising this form is load-bearing, not cosmetic. `gate-run.ts` rewrites the plan's `-r` to the
 * scope actually being tested before running it, and {@link evaluateGateOrder} FAILS CLOSED when it
 * cannot find an expensive leg — so a matcher that only knew the literal form would declare the plan
 * that actually runs unjudgeable. The runner re-evaluates the invariant over the SCOPED plan for
 * exactly that reason; this is what lets it.
 *
 * Anchored (`^`/`$`) so it cannot swallow a neighbour: `pnpm check:unit-test` ends in
 * `check:unit-test`, not `test`, and no `check:*` step begins with `-r`, `--filter` or `--no-bail`.
 *
 * The leading group is an ENUMERATION of the three token forms the gate actually emits — `-r`, one
 * `--filter ...<name>`, and `--no-bail` — rather than a permissive `.+?`. That is deliberate: a
 * wildcard here would classify any `pnpm <anything> test` as an expensive leg, and this predicate
 * decides where the ordering wall sits. Recognising a step the plan never emits is the failure that
 * would be silent.
 */
const SCOPED_EXPENSIVE_LEG =
  /^pnpm(?:\s+(?:-r|--no-bail|--filter\s+\S+))+\s+(?:typecheck|test)$/;

/**
 * Is this step one of the two minutes-cost legs — in either the declared `-r` form or the
 * affected-scoped `--filter` one? The single place the classification lives, so the ordering axes,
 * the plan rewrite and the cost assertion can never disagree about where the wall is.
 */
export function isExpensiveStep(command: string): boolean {
  const trimmed = command.trim();
  if (EXPENSIVE_STEPS.some((leg) => trimmed.includes(leg))) return true;
  return SCOPED_EXPENSIVE_LEG.test(trimmed);
}

/**
 * WHO a red is about — the axis-2 classification, and the only judgement in this module that is not
 * mechanical.
 *
 * The criterion is deliberately narrow and testable: a step is `own-work` when a red can ONLY be
 * caused by something in this branch's diff. If a red can be caused by state the session did not
 * author, it is `shared-environment` — even when it can ALSO be caused by the diff. The asymmetry is
 * the point: a step that is sometimes not yours must not gate the arrival of a step that is always
 * yours.
 */
export type GateSubject = "own-work" | "shared-environment";

/** Wall-clock class — the axis-1 classification. `minutes` is exactly the two `-r` legs. */
export type GateCost = "seconds" | "minutes";

/** One step of the gate, in plan order. */
export interface GateStep {
  /** The step's command text, trimmed (e.g. `pnpm check:boundaries`). */
  readonly command: string;
  /** Its `check:*` script name, or `undefined` for a step that runs no check (typecheck/test). */
  readonly check: string | undefined;
}

/** A {@link GateStep} carrying the two classifications the invariant judges, and why. */
export interface GatePlanStep extends GateStep {
  readonly subject: GateSubject;
  readonly cost: GateCost;
  /** One line: WHY this subject classification, so the call is auditable rather than asserted. */
  readonly why: string;
}

/**
 * THE GATE, in the order it runs. The single source of truth for `pnpm gate` — the root
 * `package.json` `gate` script is now just the runner that walks this list.
 *
 * Three blocks, and the block boundaries are the invariant:
 *   A. own-work / seconds  — fast feedback on this branch's diff
 *   B. own-work / minutes  — the two `-r` legs, still this branch's diff
 *   C. shared-environment  — seconds each, but a red may be a sibling's; never ahead of B
 *
 * Adding a step is a deliberate edit in three places at once (here, its `subject`, and its `why`),
 * and `gate-order.test.ts` refuses a `check:*` script absent here unless it has an explicit
 * non-gate reason.
 */
/*
 * SURVIVAL AUDIT (bounded, authoritative; gate-machinery-audit-arc).
 * Each retained standalone rung has demonstrated a concrete catch and names the escape it blocks:
 * - pnpm lint — RATCHET MAINTENANCE (anti-slop-adoption-arc inc-07, added 2026-08-24). The rung
 *   the arc's end-state FOUR held to `gate-machinery-audit-arc`'s inverted burden, and it arrives
 *   carrying catches rather than a promise.
 *
 *   WHAT IT CAUGHT, WHEN, AND WHAT SHIPPED WITHOUT IT. Nine rules reached `error` at zero across
 *   inc-03/06/11 and inc-08/09/10. Each was enforced only at the moment it landed, because nothing
 *   ran `pnpm lint` afterwards — not the gate, not CI. The ratchet slipped back every time:
 *     · 2026-08-23, within 24 h of `no-conditional-empty-object-spread` reaching `error` (inc-11),
 *       EIGHT fresh violations landed on `main` and `pnpm lint` was exit 1 on `main` with nobody
 *       aware. That is the finding that motivated this rung and it was found by hand.
 *     · 2026-08-23/24, across ONE session's three merges from `main`, TWELVE more arrived: one
 *       `no-known-value-widening` during inc-10, then six `no-conditional-empty-object-spread`
 *       plus one widening with inc-09's first merge, then two inline anonymous-object return
 *       annotations and an assertion chain with its second (arriving alongside `library search`).
 *   Twenty fresh violations of already-adopted rules, all hours old, all on `main`. "What would
 *   ship without it" is not hypothetical here: it already had, twenty times, in two days.
 *
 *   MEASURED COST, not assumed. 2.7 s on a full run over the whole repo (three runs: 2755 / 2671 /
 *   2682 ms, this box, warm). The arc was explicit that oxlint being written in Rust proves
 *   nothing, because the JS-plugin path these rules run on is Node and not the Rust fast path —
 *   so it was measured. It is the CHEAPEST step in the gate, an order of magnitude under the next
 *   one, and it does not narrow: it lints the whole repo every time, which is what a ratchet needs.
 *
 *   WHY A RUNG AND NOT A LOCAL COMMAND. The arc reserved the right to say no, and the honest test
 *   was whether anything had regressed. Everything had. A rule at `error` in a config nothing runs
 *   is not a standard, it is a comment.
 * - check:manifest-fragments — FACTORY BOOKKEEPING (ADR-0556 D4, added 2026-09-15 by
 *   `repo-manifest-aggregate-leaves-git`). PREVENTIVE rather than catch-evidenced, on the
 *   `check:hierarchy-camps` precedent, and each escape it blocks is one no other rung can see. A
 *   committed `repo-manifest.json` is read by nothing, so it would pass every semantic check while
 *   quietly becoming the merge surface the arc removed; and a fragment written out of form composes to
 *   the same manifest, so every reader passes over it while its bytes — and every later diff of it —
 *   depend on who edited it last. What it absorbs rather than adds: a refused fragment set already
 *   redded `check:boundaries`, `check:ownership-totality` and `check:hierarchy-camps` under their own
 *   names, and now reds first under the manifest's. MEASURED cost, three warm runs on the dev box:
 *   3010 / 3042 / 2964 ms, almost all of it the pnpm-and-tsx start those three neighbours pay too.
 * - check:boundaries — FACTORY BOOKKEEPING. Commit 8b588085 caught a real dependency cycle, and
 *   04939391 / PR425 caught undeclared imports; without it invisible cycles and cross-story
 *   coupling ship.
 * - check:ownership-totality — FACTORY BOOKKEEPING (ADR-0317 D2, added 2026-08-14). PR #1326
 *   introduced two `packages/cli/src/typecheck-aperture*.ts` files under no declared subtree and a
 *   FULL gate went green with the ownership map already incomplete — `storytree ownership` is
 *   report-only and `check:boundaries` is package-grain, so nothing sat between the author and the
 *   decay; without it the map silently stops being total and the arc that owns it hand-repairs on
 *   every increment.
 * - check:hierarchy-camps — PROOF INTEGRITY (ADR-0445 D1, added 2026-08-26). PREVENTIVE rather than
 *   catch-evidenced, on the `check:web-experience-closure` precedent, and the class it prevents is
 *   MEASURED rather than imagined: `readCorpusStoryDocs` walks every story directory and no UAT
 *   instrument filters `status: retired`, so every instrument built over it inherited that blindness
 *   for free (ADR-0396's Context). ADR-0445 D1 created a second, permanent way for that to happen —
 *   the tree is now disk-canonical for proving and live-canonical for rendering — and its own
 *   Consequences name the failure mode: "a THIRD reader added later without asking which camp it is
 *   in". Without it a rendering surface acquires a checkout read (the 2026-08-25 yellow-island
 *   incident, structurally) or a proving rung acquires a live one (a proof validating a tree the
 *   branch is not at), and nothing sits between the author and either.
 * - check:mirror-conformance — PROOF INTEGRITY. Commit 3ef84c96 records a historical studio-only
 *   docs change producing 256+4 divergences; without it desktop and studio behavior diverge.
 * - check:mirror-conformance-live — PROOF INTEGRITY (ADR-0496 D2, added 2026-09-01). The same
 *   instrument as the rung above, over the REAL `events.node_claim` ledger instead of a fixture.
 *   Its catch-evidence is INHERITED rather than its own, and honestly so: `/api/activity` is the
 *   pair whose originating defect was a re-composed SELECT that lost the ADR-0200 `grade` column,
 *   and this is the only arm that folds rows the fixture author did not write. What it adds is the
 *   input nobody chose — the fixture proves the branches someone thought of, and a corpus supplies
 *   the ones nobody did (the `docs-trees` two-arm precedent, where the real `docs/` tree is exactly
 *   that second arm). It exists at all because the reason there had never been one — "CI is
 *   DB-free" — was measured FALSE (ADR-0495 / ADR-0496 D1).
 * - check:palette-transcription — PROOF INTEGRITY (added 2026-08-28,
 *   `the-shipped-canvas-third-status-palette` on adopt-the-land-into-the-shipped-map-arc).
 *   CATCH-EVIDENCED, not preventive: the drift it watches for had already landed three times and
 *   was live on the public site when the rung was written. The map's colour is what it REPORTS
 *   about a capability's proof state, so a palette no decision authorises is a map asserting
 *   states nobody decided — which this arc named as the one way it can do real harm.
 *
 * - check:guidance — FACTORY BOOKKEEPING. A clean worktree on 2026-08-05 caught stale
 *   definitions.generated.json after the live source moved; without it root operating guidance and
 *   definitions ship stale.
 * - check:agents — FACTORY BOOKKEEPING. Commit 66b70db3 / PR232 caught stale corpus-investigator
 *   and librarian projections; without it harness agents run stale instructions.
 * - check:web-grounding — FACTORY BOOKKEEPING. Commit ae90d950 records escaped stale doctrine after
 *   ADR-0040; without it public copy cites missing or superseded decisions.
 * - check:web-engine — FACTORY BOOKKEEPING. Commit 59b6504d / PR650 caught parent/web gitlink drift;
 *   without it the public site runs a stale forest engine.
 * - check:web-experience-closure — PROOF INTEGRITY (ADR-0336, added 2026-08-09). Re-wires only the
 *   static-import-closure third of the retired check:web-experience (ADR-0311 D2); the two
 *   runtime-marker assertions stayed retired until ADR-0454 (below). Preventive rather than
 *   catch-evidenced — it SKIPs (bootstrap allowance) until the story's Act 1 entry ships — but is a
 *   cheap, deterministic, offline machine expression of the ADR-0216 D2/D4 no-WebGL-in-Act-1
 *   constraint that no other rung watches for.
 * - check:web-experience-markers — PROOF INTEGRITY (ADR-0454, added 2026-08-26, narrowing ADR-0336
 *   D2). Re-wires the other two-thirds of the retired check:web-experience: the
 *   `data-experience-skip` / `data-experience-fallback` marker-presence assertions. ADR-0336 D2 left
 *   these retired on the premise that re-wiring needed a live-site network fetch; ADR-0454 found that
 *   premise did not match the retired judge's actual implementation (a static string search over the
 *   same `web/` submodule source the closure walk already reads) and re-wired them the same way,
 *   same posture, same cost. Preventive rather than catch-evidenced, on the check:web-experience-closure
 *   precedent — it protects owner decision 6 on `website-experience` (the skip/fallback affordances
 *   are load-bearing from the first increment), not a specific production catch.
 * - pnpm -r typecheck — PROOF INTEGRITY. CI run 27761462602, fix 34f320dc, PR224 caught a moved,
 *   nonexistent export after other gates and build were green; without it a stale loader ships.
 * - pnpm -r test — PROOF INTEGRITY. CI run 30976384824, fix 327151fb, PR1151 caught
 *   credential-dependent suites after typecheck was green; without it behavior regressions ship.
 * - check:verification-decay — PROOF INTEGRITY. PR1119 on 2026-08-03 fired on
 *   unproven-seam-default; without it vacuous filters, skipped tests credited as proof, and
 *   fake-only defaults can ship.
 *
 * ★ THIS PLAN AND CI DIFFER BY EXACTLY ONE STEP, AND THE DIFFERENCE IS DECIDED, NOT DRIFT.
 * `check:verification-decay` runs here and is deliberately absent from `.github/workflows/ci.yml`;
 * every other step in this plan is a CI step too. It is not a wiring omission and adding it would
 * REVERSE an accepted, load-bearing decision — ADR-0252 D3 makes the decay ceiling a DRAIN
 * OBLIGATION on the session (the `check:friction-drain` shape, ADR-0168 D4) rather than a barrier on
 * the trunk, because these instruments are heuristics with a measured ~75% false-positive rate and a
 * CI step is a merge barrier. The rung's own module header states this at the source
 * (`check-verification-decay.ts`), together with the cost accepted knowingly: a landing that never
 * runs the local gate can grow the backlog unseen. Note "it could not run in CI" is NOT the reason
 * and never was — it could; it is not asked to. (This sentence read "the rung is OFFLINE and
 * read-only" until 2026-08-24: it is read-only still, but ADR-0424 gave it a sixth instrument whose
 * subject is the DECISION LOG, a database since ADR-0403 dec 1, so it now dials the store like its
 * `check:adr-health` and `check:web-grounding` neighbours. CI holds the ADR-0302 D3 keyless
 * credential, so the conclusion is untouched and only its premise moved.)
 * Recorded here because this plan is where a reader compares the two lists, and a `why` line
 * indistinguishable from its three CI-bound `shared-environment` neighbours is what made this look
 * like a missing rung to a reviewer (`decision-log-readers-arc` inc-06 item 7). If the trade-off is
 * ever to be revisited, that is a new decision superseding ADR-0252 D3, not an edit to a workflow.
 *
 * TOMBSTONE (bounded). The complete 16 original deletions — three by ADR-0302 and thirteen by this
 * audit — are DECLARED in {@link RETIRED_CHECKS} below rather than recited here, because twelve of
 * them left source behind and prose cannot be held to that source. No surviving rung was weakened
 * and no ceiling was raised.
 */
export const GATE_PLAN: readonly GatePlanStep[] = [
  // ── A. own-work, seconds ───────────────────────────────────────────────────
  {
    command: "pnpm lint",
    check: undefined,
    subject: "own-work",
    cost: "seconds",
    why: "reds on a fresh violation of any anti-slop rule this repo has already driven to ZERO; the rules are enforced at the moment each landed and this is what stops the ratchet slipping back (anti-slop-adoption-arc inc-07)",
  },
  {
    command: "pnpm check:manifest-fragments",
    check: "check:manifest-fragments",
    subject: "own-work",
    cost: "seconds",
    why: "reds when the repo manifest's fragment tree under `repo-manifest/` does not compose, when a fragment is not written exactly as the composer writes it (`--write` repairs that), or when a `repo-manifest.json` sits beside the tree (ADR-0556 D4). The committed aggregate left Git in `repo-manifest-aggregate-leaves-git`, so the fragments are the manifest's only bytes and this is the rung that holds that end state. Disk only — no git, no store — and FIRST among the manifest's readers, so a refused set is named once, under the manifest's own name, before `check:boundaries`, `check:ownership-totality` and `check:hierarchy-camps` each stand down on it",
  },
  {
    command: "pnpm check:boundaries",
    check: "check:boundaries",
    subject: "own-work",
    cost: "seconds",
    why: "reds on a cross-organism dependency this diff added without a declared story edge",
  },
  {
    command: "pnpm check:ownership-totality",
    check: "check:ownership-totality",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff adds a source file under no declared `sourceOwnership` subtree, or un-owns one that WAS declared; a breach already on the merge base is reported and never charged, so a red here can only be this branch's (ADR-0317 D2 charged by ADR-0301)",
  },
  {
    command: "pnpm check:hierarchy-camps",
    check: "check:hierarchy-camps",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff adds a module that reads the work hierarchy and declares no CAMP, or declares one and reads the other clock. ADR-0445 D1 made the tree disk-canonical for proving and live-canonical for rendering, and its Consequences name the failure mode this watches for — a third reader added later without asking which camp it is in. Offline and disk-only, so it sits with its `check:boundaries` / `check:ownership-totality` neighbours; its store-reading sibling `check:hierarchy-drift` asks a different question and stays in block C",
  },
  {
    command: "pnpm check:gcloudignore-mirror",
    check: "check:gcloudignore-mirror",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff adds a credential- or runtime-state-shaped path to `.gitignore` without repeating it in `.gcloudignore` (ADR-0544 D5). `.gcloudignore` BYPASSES `.gitignore` — it says so in its own first lines — and `apps/studio/Dockerfile` is `COPY . .`, so a path listed only in `.gitignore` is uploaded by `gcloud builds submit` and baked into a published image, unread. ADR-0544 D1 closed the live instance and left the mirror hand-maintained, which is exactly what drifts in silence; this fires on the branch that introduces the drift rather than at deploy time. Two file reads, no git and no network, so it sits with its `check:boundaries` / `check:ownership-totality` neighbours. ⚠ IT IS A MERGE WALL AS WELL AS A GATE RUNG since ADR-0547 D1 (2026-09-08) — the gate is the habit, CI is the wall, and this rung sits on both like `check:contract-grammar`. It was local-only until then for a credential reason rather than a judgement one: the CI step was written and the push REFUSED (`repo` but not `workflow` scope), and the owner directed the promotion and authorised the SSH push that landed it. It is NO LONGER in `DECLARED_LOCAL_ONLY`",
  },
  {
    command: "pnpm check:contract-grammar",
    check: "check:contract-grammar",
    subject: "own-work",
    cost: "seconds",
    why: "reds when a contract this diff ADDED or EDITED does not parse as a contract sentence — no `asserts —` bullet at all, or a system named nowhere mechanically (ADR-0459, realising ADR-0447 D4). A ratchet, never a migration: the corpus's 133 standing breaches are not charged to a branch that did not author them. Disk and git only, like its `check:ownership-totality` neighbour, whose `chooseBaseRef` it reuses rather than copying",
  },
  {
    command: "pnpm check:reliability-gate-parity",
    check: "check:reliability-gate-parity",
    subject: "own-work",
    cost: "seconds",
    why: "reds when a story DECLARES a reliability gate — a `pnpm --filter <pkg> <script>` command in its `## Reliability Gates` block — that no gate step, no CI step and no repo-wide `-r` leg runs. ADR-0251's mirror-conformance class, applied to the declaration↔execution pair: `pnpm --filter studio uat` was named as the machine proof obligation for all thirteen `studio` legs, the corpus's only end-to-end acceptance journey, and was run by NOTHING — so the gate and CI were both green on the very change that broke it. Demonstrated inside the current commit range rather than argued: 3ea9c3cc retired the Sources pane, updated every unit test it broke, and left the UAT journey red, because nothing runs it. Judges the class whose runnability is MECHANICALLY decidable and says on every run what it did not judge; `exec`-form witness checks and `storytree gate run` ceremonies name no package script and are excluded deliberately. A ratchet, never a migration, exactly like its `check:contract-grammar` neighbour: the one pre-existing breach is carried in a declared baseline that FAILS when it goes stale, so it drains rather than accumulating. Disk only — no git, no store, no network — so it sits in the cheap-first block",
  },
  {
    command: "pnpm check:mirror-conformance",
    check: "check:mirror-conformance",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff moves one mirrored surface and not its twin",
  },
  {
    command: "pnpm check:desktop-route-coverage",
    check: "check:desktop-route-coverage",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff leaves the desktop backend serving no route for a path the shared frontend calls — the ABSENCE half its `check:mirror-conformance` neighbour is structurally blind to, since a route the desktop never mirrored has no payload to be unequal. Three surfaces shipped broken that way (`/api/arcs` #1191, `/api/floor-health` #1228, the Traversal tab's three reads), each found by a human opening the app while the gate stayed green. Disk and source text only, so it sits beside the mirror pair it completes",
  },
  {
    command: "pnpm check:web-engine",
    check: "check:web-engine",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff moves packages/forest-world without re-syncing the vendored copy",
  },
  {
    command: "pnpm check:web-experience-closure",
    check: "check:web-experience-closure",
    subject: "own-work",
    cost: "seconds",
    why: "reds when Act 1's static import closure in this diff's web/ pin reaches three or @react-three/* (ADR-0336)",
  },
  {
    command: "pnpm check:web-experience-markers",
    check: "check:web-experience-markers",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff's web/ pin's experience entry page drops the data-experience-skip or data-experience-fallback marker (ADR-0454, narrowing ADR-0336 D2)",
  },
  {
    command: "pnpm check:ground-space",
    check: "check:ground-space",
    subject: "own-work",
    cost: "seconds",
    why: "reds when this diff leaves a point-to-point distance undeclared in a file that mints projected coordinates from the lattice (`ground-space-truth-arc-inc-01`). ADR-0367 D1 gave the land a camera, so a distance between two PROJECTED points silently over-enforces on the depth axis and starves marks out — measured four times, in four different surfaces. It sits with the `check:web-*` family because it is the only other rung that reads `web/src`, which is where the instance that survived PR #1356 lived; but unlike them it does NOT skip on an absent submodule (the parent's own surfaces are always scannable, so a skip would misreport what ran) and it prints a NARROWED line instead",
  },
  {
    command: "pnpm check:land-art",
    check: "check:land-art",
    subject: "own-work",
    cost: "seconds",
    why: "reds when the land art is wrong. ADR-0418 D3 lifted the closed-palette fence on `forest-world-r3f/harness/` and D4 required a replacement that can still FAIL; PR #1673 built it into `capture.mjs` and mutation-tested it, and then nothing ever ran it \u2014 it appeared in no gate step, in no CI step, and is not reachable from the package's `test` script, which collects `*.test.ts` while capture is a `.mjs` driver. An instrument that CAN fail, that no build asks, cannot fail a build, which is what this arc's fence 3 requires. The rung starts its own vite server on an ephemeral port (so a sibling worktree's harness on the pinned 5184 cannot answer it), drives the three pages that between them carry all three parts of D4, and refuses both when `capture.mjs` refuses AND when a page audited less than it is declared to prove \u2014 the second being the half capture cannot assert about the run it is inside. ~29 s, browser-backed but SwiftShader-only, so it needs no GPU",
  },
  {
    command: "pnpm check:palette-transcription",
    check: "check:palette-transcription",
    subject: "own-work",
    cost: "seconds",
    why: "reds when the three copies of the status palette stop saying one thing. The land's colour IS a capability's proof state (ADR-0392 D5 / ADR-0398 D7), and it is written down in `apps/studio/src/index.css` (canonical), `forest-world-r3f/harness/palette-band.ts` (a declared transcription) and `forest-world-r3f/src/ForestWorldCanvas.tsx` (what the shipped map draws). Nothing compared any pair of them until 2026-08-28, and the CSS said so in terms; by then the shipped canvas disagreed with the other two on ALL SIX states \u2014 `mapped` blue where ADR-0470 settled a clay, `unhealthy` brown where the decision says charred, `building` still owning a colour ADR-0462 merged away \u2014 and the public site's chapter 2 had begun opening on that canvas. It is a RUNG rather than only the `node:test` suite beside it because `apps/studio` does not depend on `forest-world-r3f`: under ADR-0304 D1's affected-scope narrowing, a branch that retunes the CANONICAL surface runs no test in that package at all, and the canonical surface is the copy that MOVES. Pure fs reads and string parsing, single-digit milliseconds, never skips",
  },
  // ── B. own-work, minutes ───────────────────────────────────────────────────
  {
    command: "pnpm -r --no-bail typecheck",
    check: undefined,
    subject: "own-work",
    cost: "minutes",
    why: "the session's own diff, and the first of the two answers a session actually came for",
  },
  {
    command: "pnpm -r --no-bail test",
    check: undefined,
    subject: "own-work",
    cost: "minutes",
    why: "the session's own diff; independent of typecheck because tests run transpile-only via tsx",
  },
  {
    command: "pnpm check:mutation-diff",
    check: "check:mutation-diff",
    subject: "own-work",
    cost: "minutes",
    why: "asks whether the tests this branch wrote actually CATCH bugs in the lines this branch changed — the red phase proves a test went red, never that it would have gone red for a slightly different defect (ADR-0447 D2, ADR-0458). Runs AFTER the test leg deliberately: mutation results over a red suite describe the breakage, not the tests",
  },

  // ── C. shared environment ──────────────────────────────────────────────────
  {
    command: "pnpm check:web-grounding",
    check: "check:web-grounding",
    subject: "shared-environment",
    cost: "seconds",
    why: "it validates the public site's ADR citations against the DECISION LOG, which is shared live state since ADR-0403 dec 1 — a sibling's status flip can red it, so it cannot run ahead of this branch's own work. It was `own-work` while the corpus was files in this diff; only its SUBJECT moved. Still skip-capable on an absent web/ submodule, and the skip is decided BEFORE the store is dialled so a DB outage can never read as the submodule skip",
  },
  {
    command: "pnpm check:adr-health",
    check: "check:adr-health",
    subject: "shared-environment",
    cost: "seconds",
    why: "the decision-binding gate (ADR-0037 §3–4), reading the decision ROWS since ADR-0403 dec 1. It sits in block C rather than A because its subject is SHARED live state — another session's `adr new` or status flip can red it, exactly like check:guidance. It was a case inside `pnpm -r test` until the log became a database; that suite is credential-free by ADR-0302 D3, and ADR-0307 D4 puts real-corpus assertions on a rung that may hold a connection",
  },
  {
    command: "pnpm check:guidance",
    check: "check:guidance",
    subject: "shared-environment",
    cost: "seconds",
    why: "the committed views are branch-local, but their live Library source can move under a sibling",
  },
  {
    command: "pnpm check:agents",
    check: "check:agents",
    subject: "shared-environment",
    cost: "seconds",
    why: "the harness projections are branch-local, but their live Library source is shared",
  },
  {
    command: "pnpm check:verification-decay",
    check: "check:verification-decay",
    subject: "shared-environment",
    cost: "seconds",
    why: "reds every session the moment any instrument breaches on main — the measured case behind the parked entry `verification-decay-charges-by-authorship`. LOCAL-ONLY BY DECISION: the one step in this plan `.github/workflows/ci.yml` deliberately does not run — see the note below, and do not 'fix' the difference by adding it",
  },
  {
    command: "pnpm check:library-dag-acyclic",
    check: "check:library-dag-acyclic",
    subject: "shared-environment",
    cost: "seconds",
    why: "a dependsOn cycle is authored by a live artifact write, so ANY session's edit can red it — the corpus it judges is shared even when this branch touched none of it (ADR-0223 D3)",
  },
  {
    command: "pnpm check:definition-adjudication",
    check: "check:definition-adjudication",
    subject: "shared-environment",
    cost: "seconds",
    why: "reds when a `definition` row is neither carrying an authored dependsOn edge nor named as deliberately carrying none (ADR-0468 D3). It sits beside check:library-dag-acyclic for the same reason: the tier it judges is live state, so ANY session's artifact edit can red it even on a branch that touched no corpus. Deliberately NOT the weaker `every definition carries an edge` — that shape prices the tier toward padding, which is the failure ADR-0464's candidate-D refusal names",
  },
  {
    command: "pnpm check:mirror-conformance-live",
    check: "check:mirror-conformance-live",
    subject: "shared-environment",
    cost: "seconds",
    why: "the SAME `/api/activity` pair its block-A sibling proves over fixtures, folded over a snapshot of the REAL `events.node_claim` ledger (ADR-0496 D2). It is a SECOND STEP rather than an extra arm on the first because the two differ in SUBJECT: a live arm can red on a row this branch did not author, and axis 2 is explicit that a step which is sometimes not yours must not gate the arrival of one that always is — folding it into `check:mirror-conformance` would drag all nine of that step's rows into block C to buy one arm a connection, and would make every mirror red ambiguous about whose it is. It fails LOUDLY on an unreachable store rather than falling back to the fixtures, the same posture as its `check:hierarchy-drift` neighbour and for the same reason (ADR-0302)",
  },
  {
    command: "pnpm check:hierarchy-drift",
    check: "check:hierarchy-drift",
    subject: "shared-environment",
    cost: "seconds",
    why: "the live store's mirror of `stories/**` (ADR-0445 D1) is regenerated by whichever PR last merged, so a sibling's landing moves it under this branch — the same shared-live-state reason as check:guidance. It fails LOUDLY on a stale mirror rather than falling back to disk, because a fallback would report health while a reader is served the stale tree (ADR-0302's lesson)",
  },
  {
    command: "pnpm check:uat-revision-continuity",
    check: "check:uat-revision-continuity",
    subject: "shared-environment",
    cost: "seconds",
    why: "ADR-0560 D3/D4's production-catch wall compares this branch's existing UAT criterion revisions with its merge base and requires the candidate revision's exact current signed pass. The hierarchy is this branch's, but the proof stream is shared live state, so a sibling can move the answer and the rung belongs after both expensive legs beside check:hierarchy-drift; an unreadable base, store, identity or revision is a red, never a skip",
  },
];

/**
 * `check:*` scripts in the root `package.json` that are deliberately NOT gate steps. Keyed to a
 * reason, because `gate-order.test.ts` otherwise refuses any script absent from {@link GATE_PLAN} —
 * that refusal is what stops a new check from being added to `package.json` and silently never run.
 */
export const NON_GATE_CHECK_SCRIPTS: ReadonlyMap<string, string> = new Map([
  ["check:claude", "a back-compat alias for `check:guidance`, which the plan already runs"],
]);

/**
 * Gate steps that may legitimately verify NOTHING in some environment, and declare it by exiting
 * `GATE_SKIP_EXIT_CODE` (ADR-0276 increment 4). Keyed to the condition under which they opt out.
 *
 * THE ENTRY IS NOT DOCUMENTATION — `gate-order.test.ts` holds each one's ROOT SCRIPT to an invocation
 * form that actually preserves a child's exit code, and that fence exists because pnpm silently does
 * not. MEASURED 2026-08-08, all four combinations, with a positive control:
 *
 *     pnpm --filter <pkg> exec node -e "process.exit(3)"   → exit 1    ← COLLAPSES
 *     pnpm -C <dir>       exec node -e "process.exit(3)"   → exit 3
 *     pnpm --filter <pkg> run  <script>                    → exit 3, and 75 → 75
 *     pnpm -C <dir>       run  <script>                    → exit 75
 *
 * READ THE TABLE, NOT THE FIRST ROW. It is the RECURSIVE `exec` that collapses —
 * `--filter … exec` reports `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` and normalises any non-zero child
 * code to 1. `--filter … run` does NOT, which is why `pnpm db:up`'s documented exit-75 (`EX_TEMPFAIL`
 * = "started, still warming") protocol is intact and must not be "fixed": it goes through
 * `--filter … run`. A session that generalises this hazard to `--filter` would go looking for a bug
 * that is not there.
 *
 * Every other `check:*` script uses the collapsing form, and for them it is harmless — they only ever
 * mean pass or fail, and 1 is fail. For a skip-capable check it is silently destructive in the worst
 * direction: the declared SKIP would arrive at the runner as 1, i.e. as a FAILURE, redding the gate
 * on every local checkout without the `web/` submodule. The bug would look like a broken check rather
 * than a broken protocol.
 *
 * So a session normalising these scripts back to the house `--filter` form must fail a test rather
 * than discover this in a red gate. Adding a skip-capable check means adding it here.
 */
export const SKIP_CAPABLE_CHECKS: ReadonlyMap<string, string> = new Map([
  [
    "check:web-grounding",
    "the `web/` submodule is absent locally (it is cloned in CI, where an absent web/ is a hard failure instead)",
  ],
  [
    "check:web-experience-closure",
    "the `web/` submodule is absent locally (it is cloned in CI, where an absent web/ is a hard failure instead)",
  ],
  [
    "check:web-experience-markers",
    "the `web/` submodule is absent locally (it is cloned in CI, where an absent web/ is a hard failure instead)",
  ],
  [
    "check:web-engine",
    "the `web/` submodule is absent locally (a hard failure in CI, as for its two siblings), or no synced package dir has been adopted by the site yet — in both cases it compares nothing",
  ],
  [
    "check:land-art",
    "Playwright's Chromium was never downloaded in this checkout, so no page can be driven \u2014 the ONLY skippable condition, deliberately: vite failing, a page 404ing or capture crashing are all reds. A skip here audits NOTHING, so it is printed as such rather than as a narrowing",
  ],
  [
    "check:mutation-diff",
    "this branch changes no mutable TypeScript under a workspace project's `src/`, so there are no mutants to generate — the ordinary shape of a corpus, docs or config landing, and the commonest outcome of this rung",
  ],
]);

/**
 * The token whose presence in a skip-capable check's root script means its exit code will NOT
 * survive — see {@link SKIP_CAPABLE_CHECKS}. Kept beside the set so the test and the reason cannot
 * drift apart.
 *
 * DELIBERATELY BROADER THAN THE MEASURED CAUSE, and only sound because of the domain it is applied
 * to. The collapse needs `--filter` AND `exec` together; `--filter … run` is safe. Matching on
 * `--filter` alone therefore over-matches in general — but every `check:*` script in this repo is an
 * `exec` form, so within {@link SKIP_CAPABLE_CHECKS} the two coincide, and the broader token is the
 * conservative fence. Narrowing it to `exec` would WEAKEN it. Do not lift this constant out of that
 * domain to reason about `run` scripts, where `--filter` is harmless.
 */
export const EXIT_CODE_COLLAPSING_INVOCATION = "--filter";

/** One retired rung: the decision that retired it, and the source it left behind. */
export interface RetiredCheck {
  /** The decision that retired it, e.g. `"ADR-0311 D2"`. */
  readonly retiredBy: string;
  /**
   * Surviving files under `packages/cli/src/`, ENTRYPOINT FIRST — empty when the check was deleted
   * outright. A file may appear under more than one check when they shared it.
   */
  readonly sources: readonly string[];
}

/**
 * THE TOMBSTONE, DECLARED — the 16 rungs the gate no longer runs, and the source each left behind.
 *
 * WHY THIS IS A LITERAL AND NOT A COMMENT. ADR-0311 kept the retired implementations on purpose
 * (D5: re-wiring stays cheap) and named the price in its own Consequences: it "leaves discoverable
 * code whose unwired status must not be mistaken for a forgotten gate rung." That price was left
 * unpaid. Twelve of the sixteen left source behind — 23 files that still compile and still carry
 * confident headers, while no `check:*` script invokes any of them. (Their CODE is not all
 * unreached: three are imported by companions that do run — see below. What no longer runs is any
 * of them AS A CHECK.) A session grepping for the
 * rule finds a complete, tested, plausible fence and concludes it is enforced. That already
 * happened one layer up: the `test-creation-principles` artifact asserted the wall-clock rule was
 * "enforced rather than merely advised" by `check:test-timing` a full day after it was retired.
 * This is the same defect the gate exists to refuse — believing something is watching when nothing
 * is.
 *
 * THIS INVENTORY COVERS THE PRODUCTION SOURCES ONLY, AND THEIR `.test.ts` COMPANIONS ARE NOT ALL
 * INERT. An earlier revision of this paragraph said the leftovers' "own unit tests still run GREEN
 * under `pnpm -r test` while enforcing NOTHING". That is false, and it fails in the direction that
 * costs something: three companions still assert repo-wide invariants over the real tree from
 * inside `pnpm -r test` — {@link GATE_PLAN} step 6, which CI runs too. They are declared, with what
 * each one still enforces, in {@link RETIRED_TEST_COMPANIONS}.
 *
 * So the inventory is DATA, and `gate-order.test.ts` holds the repo to it three ways: no retired
 * name may reappear as a root script unnoticed, every file named here must carry the `UNWIRED`
 * banner, and every check-shaped source file must be either wired or listed here. A new orphan
 * cannot be introduced silently, and a re-wiring cannot leave a stale banner behind.
 *
 * A NAME HERE IS HISTORY, NOT POLICY. Re-adding any of these needs fresh production-catch evidence
 * and an ADR (D5) — never merely the wiring.
 */
export const RETIRED_CHECKS: ReadonlyMap<string, RetiredCheck> = new Map<string, RetiredCheck>([
  // ── retired by ADR-0302 D4: deleted outright, no source survives ────────────
  ["check:agents-sync", { retiredBy: "ADR-0302 D4", sources: [] }],
  ["check:corpus-sync", { retiredBy: "ADR-0302 D4", sources: [] }],
  ["check:corpus-content", { retiredBy: "ADR-0302 D4", sources: [] }],

  // ── retired by ADR-0311 D2 ─────────────────────────────────────────────────
  ["check:manifest", { retiredBy: "ADR-0311 D2", sources: [] }],
  ["check:process-graph", { retiredBy: "ADR-0311 D2", sources: ["check-process-graph.ts"] }],
  [
    "check:test-timing",
    {
      retiredBy: "ADR-0311 D2",
      sources: ["check-test-timing.ts", "test-timing-gate.ts", "test-timing-drain.ts"],
    },
  ],
  ["check:web-experience", { retiredBy: "ADR-0311 D2", sources: ["web-experience-check.ts"] }],
  ["check:declared", { retiredBy: "ADR-0311 D2", sources: ["check-declared.ts"] }],
  [
    "check:friction-drain",
    {
      retiredBy: "ADR-0311 D2",
      sources: ["check-friction-drain.ts", "friction-drain.ts", "db-required.ts"],
    },
  ],
  [
    "check:arc-proposal-drain",
    {
      retiredBy: "ADR-0311 D2",
      sources: ["check-arc-proposal-drain.ts", "arc-proposal-drain.ts", "db-required.ts"],
    },
  ],
  [
    "check:coverage",
    {
      retiredBy: "ADR-0311 D2",
      // NOT `coverage.ts` — that one stays LIVE behind the `storytree` coverage verb (`commands.ts`).
      sources: ["check-coverage.ts", "coverage-gate.ts", "coverage-drain.ts"],
    },
  ],
  [
    "check:surface-coverage",
    {
      retiredBy: "ADR-0311 D2",
      sources: [
        "check-surface-coverage.ts",
        "surface-coverage-gate.ts",
        "surface-coverage-drain.ts",
        "db-required.ts",
      ],
    },
  ],
  [
    "check:graduation-worklist",
    {
      retiredBy: "ADR-0311 D2",
      sources: ["check-graduation-worklist.ts", "graduation-drain.ts"],
    },
  ],
  ["check:node-version", { retiredBy: "ADR-0311 D2", sources: ["check-node-version.ts"] }],
  ["check:dist-drift", { retiredBy: "ADR-0311 D2", sources: ["check-dist-drift.ts"] }],
  [
    "check:deploy-health",
    { retiredBy: "ADR-0311 D2", sources: ["check-deploy-health.ts", "deploy-health.ts"] },
  ],
]);

/**
 * What a surviving retired source's `.test.ts` companion still does — the only classification here
 * that decides whether DELETING a file is free.
 *
 * - `load-bearing` — it asserts an invariant over the REAL tree that nothing else asserts. Deleting
 *   it drops that invariant, silently and repo-wide. These carry {@link LOAD_BEARING_MARKER}.
 * - `repo-coupled` — it reads the real tree, so it CAN red on a change the session did not expect,
 *   but every assertion is about the retired module's own coherence. Deleting it drops nothing.
 * - `unit-only` — pure; it exercises the retired module's logic and touches no disk.
 *
 * The middle class exists because collapsing it into either neighbour would be a false statement of
 * exactly the kind this inventory was written to correct: calling it `unit-only` denies a real red
 * it can produce, and calling it `load-bearing` would protect a file whose loss costs nothing.
 */
export type CompanionRole = "load-bearing" | "repo-coupled" | "unit-only";

/** One surviving `.test.ts` companion of a retired check's source. */
export interface RetiredCompanion {
  /** The {@link RetiredCheck} source it tests, e.g. `"coverage-gate.ts"`. */
  readonly of: string;
  readonly role: CompanionRole;
  /**
   * WHAT DELETING THIS FILE WOULD COST, in one line — the whole point of the entry. For a
   * `load-bearing` companion this names the invariant that would silently lapse; for the others it
   * records why nothing would.
   */
  readonly cost: string;
}

/**
 * THE COMPANION HALF OF THE TOMBSTONE — every `.test.ts` beside a {@link RETIRED_CHECKS} source, and
 * what deleting it would cost.
 *
 * WHY THIS EXISTS SEPARATELY FROM {@link RETIRED_CHECKS}. That inventory tracks the PRODUCTION files
 * and `gate-order.test.ts` bannered exactly those, so sixteen companions sat untracked and
 * unbannered beside them — and three of those sixteen are not leftovers at all. They run inside
 * `pnpm -r test` (GATE_PLAN step 6, and a CI step) and assert invariants over the real repo:
 * `test-timing-drain.test.ts` sweeps every gate-tier workspace's test files for wall-clock calls,
 * and the two `coverage-*` companions sweep the real `stories/` tree. A tidy-up deleting "the
 * unwired ADR-0311 leftovers" would have taken them with it and dropped those invariants in
 * silence, because nothing on disk said otherwise.
 *
 * SO THE ENTRY IS THE MECHANISM, NOT THE DOCUMENTATION. `gate-order.test.ts` holds the repo to it
 * three ways: a companion that exists on disk must be declared here (so one cannot appear
 * untracked), a companion declared here must still exist (so deleting the FILE reds immediately,
 * naming the cost below), and the `load-bearing` set is additionally pinned BY NAME in that test.
 * Dropping one is therefore three deliberate edits — the file, this entry, and that literal — and
 * the middle one puts the sentence describing what is being abandoned into the diff. That is the
 * whole ask: not that deletion is impossible, but that it cannot be silent.
 *
 * A `load-bearing` companion is NOT a gate rung and re-reading it as one would be the original
 * defect wearing new clothes. It is an ordinary test that happens to assert something repo-wide;
 * ADR-0311 D2 retired the RUNG, and ADR-0311 D5 still governs re-wiring one.
 */
export const RETIRED_TEST_COMPANIONS: ReadonlyMap<string, RetiredCompanion> = new Map<
  string,
  RetiredCompanion
>([
  // ── load-bearing: deleting these drops a repo-wide invariant ────────────────
  [
    "test-timing-drain.test.ts",
    {
      of: "test-timing-drain.ts",
      role: "load-bearing",
      cost: "its BASELINE test is the only surviving enforcement of ADR-0276's no-wall-clock-in-tests rule — it sweeps every gate-tier workspace's test files for `performance.now` / `process.hrtime` behind an anti-vacuity floor (>=20 workspaces, >=300 files) and asserts the unsanctioned list is empty, so a new timing call anywhere in the repo reds `pnpm -r test` through this file",
    },
  ],
  [
    "coverage-gate.test.ts",
    {
      of: "coverage-gate.ts",
      role: "load-bearing",
      cost: "its end-to-end test walks the real `stories/` tree and pins live proof bindings — that `deploy-health-signal` and `act2-regrow-camera-zoom-out` are scanned and fully covered, and act2's two literal `apps/studio/` proof paths — so moving or renaming one of those files reds here and nowhere else",
    },
  ],
  [
    "coverage-drain.test.ts",
    {
      of: "coverage-drain.ts",
      role: "load-bearing",
      cost: "its live-corpus test is the only surviving enforcement of the contract-coverage ceiling (ADR-0252 D3) — it sweeps the real `stories/` tree and asserts the drain verdict is not red, so the uncovered/unbound backlog cannot grow past its ceiling unnoticed",
    },
  ],

  // ── repo-coupled: reads the real tree, but asserts only its own module ──────
  [
    "check-surface-coverage.test.ts",
    {
      of: "check-surface-coverage.ts",
      role: "repo-coupled",
      cost: "little, but no longer nothing — most of it joins a FIXTURE process tier to the real root `package.json`, so removing a script it names (`pnpm db:up`, `pnpm --filter desktop start`) reds it. Since the prescriptive-command axis landed, one test also derives the MOUNTED COMMAND REGISTER from the real `packages/cli/src` and asserts both directions over it: that today's verbs resolve, and that the three Library verbs PR #1148 deleted do not. That is the non-vacuity control for the derivation — delete it and the axis can silently stop recognising anything while its fixture tests stay green",
    },
  ],
  [
    "surface-coverage-drain.test.ts",
    {
      of: "surface-coverage-drain.ts",
      role: "repo-coupled",
      cost: "nothing — its own BASELINE comment concedes it no longer pins the real repo (ADR-0302 D1 deleted the seed it read), and its verdict assertion accepts `ok` or `red`; what it still pins is the retired module's 0/0 ceiling pair",
    },
  ],
  [
    "check-dist-drift.test.ts",
    {
      of: "check-dist-drift.ts",
      role: "repo-coupled",
      cost: "nothing — it reads the real `infra/install.ps1` and reds if the advertised URL stops matching the retired module's `PUBLISHED_URL`, which is a coherence check on dead code: no gate rung verifies that URL either way",
    },
  ],

  // ── unit-only: pure, no disk ────────────────────────────────────────────────
  [
    "check-process-graph.test.ts",
    { of: "check-process-graph.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "test-timing-gate.test.ts",
    { of: "test-timing-gate.ts", role: "unit-only", cost: "nothing — pure; the repo sweep it powers is asserted by `test-timing-drain.test.ts`" },
  ],
  [
    "web-experience-check.test.ts",
    { of: "web-experience-check.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "check-declared.test.ts",
    { of: "check-declared.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "friction-drain.test.ts",
    { of: "friction-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "db-required.test.ts",
    { of: "db-required.ts", role: "unit-only", cost: "nothing — pure, over injected env" },
  ],
  [
    "arc-proposal-drain.test.ts",
    { of: "arc-proposal-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "graduation-drain.test.ts",
    { of: "graduation-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "check-node-version.test.ts",
    { of: "check-node-version.ts", role: "unit-only", cost: "nothing — pure, over injected version strings" },
  ],
  [
    "deploy-health.test.ts",
    { of: "deploy-health.ts", role: "unit-only", cost: "nothing — pure, over injected run records" },
  ],
]);

/** The `.test.ts` companion filename a retired source would have, e.g. `coverage-gate.ts` → `coverage-gate.test.ts`. */
export function companionFileFor(source: string): string {
  return source.replace(/\.ts$/, ".test.ts");
}

/**
 * The banner every surviving retired source must carry, and the token the test greps for.
 *
 * Deliberately a bare ASCII word rather than a decorated string: it has to survive reformatting and
 * be greppable by a session that does not know this module exists.
 */
export const UNWIRED_MARKER = "UNWIRED";

/**
 * The banner a `load-bearing` {@link RetiredCompanion} must carry, and the one an inert companion
 * must NOT — the second direction is the anti-rot half, so a file that stops enforcing cannot keep
 * the claim that it does.
 *
 * A distinct token from {@link UNWIRED_MARKER} on purpose: a session sweeping the leftovers greps
 * one word to find what is safe to delete and hits the other word on what is not.
 */
export const LOAD_BEARING_MARKER = "LOAD-BEARING";

/**
 * THE GATE'S VOICE — phrasings that assert MERGE-BLOCKING authority over the reader.
 *
 * {@link RETIRED_CHECKS} guards a check-shaped FILE that enforces nothing. This guards the other
 * half of the same defect, which that inventory cannot see: a command that TELLS THE READER
 * something must be fixed before merging, while no {@link GATE_PLAN} step runs it. A grep for the
 * rule finds an authoritative sentence and concludes it is enforced — the identical failure
 * {@link RETIRED_CHECKS} exists to refuse, arriving through prose instead of through a source file.
 *
 * MEASURED 2026-08-08, the instance that motivated this: `storytree library --check` printed
 * `GATE BROKEN: … — fix before merge` on a live-corpus report that NO root script and NO CI job has
 * ever run. ADR-0026 §5 had decided that surface was deliberately not a gate — "only an occasional
 * operator `storytree library --check --pg` does — by design, not every push" — so the sentence was
 * wrong at birth, and a session settling an unrelated question read it as a real merge gate.
 *
 * DELIBERATELY NARROW. These are claims of BLOCKING authority, not every mention of merging.
 * `adr.ts`'s "catch a collision before merge (it will fail the PR…)" is TRUE and wired, and
 * `graduate.ts`'s "await a librarian pass before merge" describes operating discipline rather than a
 * machine that refuses — neither is listed, and widening this set to catch them would price the
 * check into noise and then into an allowlist nobody reads.
 */
export const GATE_AUTHORITY_PHRASES: readonly string[] = [
  "GATE BROKEN",
  "fix before merge",
  "blocks the merge",
  "blocks a merge",
];

/** One assertion of merge-blocking authority found in a source file. */
export interface GateVoiceHit {
  /** 1-indexed line number. */
  readonly line: number;
  /** The {@link GATE_AUTHORITY_PHRASES} member that matched. */
  readonly phrase: string;
  /** The matching source line, trimmed — so a failure names the sentence, not just a location. */
  readonly text: string;
}

/**
 * Every {@link GATE_AUTHORITY_PHRASES} occurrence in one source file. Pure: the caller supplies the
 * text, as with every other judgement in this module.
 *
 * COMMENTS ARE SCANNED TOO, and that is the fail-closed choice rather than an oversight. Restricting
 * to string literals would need a parser here (this module has none, by design) and would miss the
 * maintainer-facing half of the same lie — a docstring claiming a function "blocks the merge" sends
 * the next session down the same road as a printed banner. The price is that a NEGATION
 * ("a deploy failure never blocks a merge") also matches; it is paid once, in an exemption whose
 * reason records that someone checked. Over-reporting costs an entry; under-reporting costs the
 * whole point.
 */
export function findGateVoice(source: string): GateVoiceHit[] {
  const hits: GateVoiceHit[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const phrase of GATE_AUTHORITY_PHRASES) {
      if (text.includes(phrase)) hits.push({ line: i + 1, phrase, text: text.trim() });
    }
  });
  return hits;
}

/**
 * The key {@link GATE_VOICE_EXEMPTIONS} is written in: `<file>::<phrase>`, where `<file>` is the
 * path relative to the repo root. Built here so the map and the sweep cannot disagree about the
 * shape.
 */
export function gateVoiceKey(file: string, phrase: string): string {
  return `${file}::${phrase}`;
}

/**
 * Sentences that MAY claim merge-blocking authority, each keyed to why the claim is honest.
 *
 * An entry is a statement that someone traced the claim to a step the gate actually runs, or
 * established that it is not a claim at all. `gate-order.test.ts` refuses any unlisted hit, so a new
 * one cannot be introduced silently — and the reason is the durable half: without it the next
 * session re-verifies the same sentence from scratch.
 *
 * The DECLARING module and its test are not scanned; they hold the phrase list itself as data, and a
 * scanner that flagged its own inventory could only ever be answered by exempting itself.
 */
export const GATE_VOICE_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  [
    gateVoiceKey("packages/cli/src/check-deploy-health.ts", "blocks a merge"),
    "states the OPPOSITE — it records that a deploy failure never blocked one, which is why ADR-0311 D2 retired the rung; the file carries the UNWIRED banner",
  ],
  [
    gateVoiceKey("packages/cli/src/friction.ts", "blocks the merge"),
    "TRUE and wired: `friction-inbox.test.ts` runs `validateInboxDir` over the committed `docs/friction-inbox/` inside `pnpm -r test`, which is GATE_PLAN step 6 (verified 2026-08-08)",
  ],
]);

/**
 * The packages the gate-voice sweep reads — where this repo's CLI output and its shared drivers
 * live, and therefore where a printed claim of merge authority can originate.
 *
 * NAMING THE APERTURE IS PART OF THE CHECK (`asset:an-observable-is-evidence-only-for-what-it-observes`).
 * A clean sweep says nothing about `apps/**` or `stories/**`: the same false claim can and has lived
 * in a Library artifact and in a story spec, where no mechanical reader reaches it. Widen this list
 * rather than reading its silence as coverage.
 */
export const GATE_VOICE_SCAN_ROOTS: readonly string[] = ["packages/cli/src", "packages/drive/src"];

/**
 * The seconds-cost steps that MUST run BEFORE {@link EXPENSIVE_STEPS} — axis 1.
 *
 * Membership means all three things at once: the check costs SECONDS, its answer does not depend on
 * the code compiling or the tests passing, and a red is THIS branch's to fix — so nothing is learned
 * and nobody is helped by making it wait.
 *
 * Adding or removing a name is a deliberate edit, not a formality: dropping one here is how a check
 * silently slides back behind the expensive legs, which is one of the two regressions this exists to
 * catch. Derived-by-hand rather than computed from {@link GATE_PLAN} on purpose — a set computed from
 * the plan would agree with the plan by construction and could never contradict it.
 */
export const PRE_EXPENSIVE_CHECKS: ReadonlySet<string> = new Set([
  "check:manifest-fragments",
  "check:boundaries",
  "check:ownership-totality",
  "check:hierarchy-camps",
  "check:contract-grammar",
  "check:mirror-conformance",
  "check:desktop-route-coverage",
  // `check:web-grounding` left this set for `SHARED_ENVIRONMENT_CHECKS` (ADR-0403 dec 1): it reads
  // the DECISION LOG, which is shared live state now, so it can red on a sibling's status flip. Its
  // two web/ neighbours stay — they compare this diff's submodule pin against this repo's source.
  "check:web-engine",
  "check:web-experience-closure",
  "check:web-experience-markers",
]);

/**
 * The steps that MUST run AFTER {@link EXPENSIVE_STEPS} — axis 2. Each can red on state this session
 * did not author, so none of them may precede the session's own answer.
 */
export const SHARED_ENVIRONMENT_CHECKS: ReadonlySet<string> = new Set([
  "check:web-grounding",
  // ⚠ NOT its `check:mirror-conformance` sibling, which stays in PRE_EXPENSIVE_CHECKS. The two run
  // the same instrument over different INPUTS, and the input is what decides the subject: fixtures
  // are this branch's, the live ledger is everyone's (ADR-0496 D1).
  "check:mirror-conformance-live",
  "check:adr-health",
  "check:guidance",
  "check:agents",
  "check:verification-decay",
  "check:library-dag-acyclic",
  "check:definition-adjudication",
  "check:hierarchy-drift",
  "check:uat-revision-continuity",
]);

/** The index of the plan's FIRST minutes-cost leg, or -1 when it runs none. */
export function firstExpensiveIndex(steps: readonly GateStep[]): number {
  return steps.findIndex((s) => isExpensiveStep(s.command));
}

/** The index of the plan's LAST minutes-cost leg, or -1 when it runs none. */
export function lastExpensiveIndex(steps: readonly GateStep[]): number {
  let at = -1;
  steps.forEach((s, i) => {
    if (isExpensiveStep(s.command)) at = i;
  });
  return at;
}

export interface GateOrderVerdict {
  readonly verdict: "ok" | "fail";
  readonly message: string;
  /** {@link PRE_EXPENSIVE_CHECKS} members that run AFTER the first expensive leg. */
  readonly misordered: readonly string[];
  /** {@link SHARED_ENVIRONMENT_CHECKS} members that run BEFORE the last expensive leg. */
  readonly premature: readonly string[];
  /** Declared members (either set) the plan does not run at all. */
  readonly missing: readonly string[];
}

/**
 * Judge one gate plan against both ordering axes.
 *
 * FAIL-CLOSED on the ways this could report a clean sweep over a plan it never understood: a plan
 * with NO expensive leg (the classifier failed to recognise `pnpm -r typecheck` / `pnpm -r test`, so
 * "nothing is on the wrong side of them" is vacuous) and a declared check the plan does not run at
 * all (dropped or renamed — a check that vanished is not a check that passed).
 */
export function evaluateGateOrder(input: {
  steps: readonly GateStep[];
  earlyChecks: ReadonlySet<string>;
  lateChecks?: ReadonlySet<string>;
}): GateOrderVerdict {
  const { steps, earlyChecks } = input;
  const lateChecks = input.lateChecks ?? new Set<string>();
  const firstWall = firstExpensiveIndex(steps);
  const lastWall = lastExpensiveIndex(steps);
  if (firstWall === -1) {
    return {
      verdict: "fail",
      message:
        "the gate plan runs none of " +
        `${EXPENSIVE_STEPS.map((s) => `\`${s}\``).join(" / ")} — the ordering invariant cannot be ` +
        "judged against a plan whose expensive legs were not recognised (renamed? re-shaped?).",
      misordered: [],
      premature: [],
      missing: [],
    };
  }

  const positions = new Map<string, number>();
  steps.forEach((step, i) => {
    if (step.check !== undefined && !positions.has(step.check)) positions.set(step.check, i);
  });

  const declared = [...earlyChecks, ...lateChecks];
  const missing = declared.filter((name) => !positions.has(name));
  const misordered = [...earlyChecks].filter((name) => {
    const at = positions.get(name);
    return at !== undefined && at > firstWall;
  });
  const premature = [...lateChecks].filter((name) => {
    const at = positions.get(name);
    return at !== undefined && at < lastWall;
  });

  if (missing.length === 0 && misordered.length === 0 && premature.length === 0) {
    return {
      verdict: "ok",
      message:
        `${earlyChecks.size} cheap-first check(s) run before \`${steps[firstWall]?.command}\`, and ` +
        `${lateChecks.size} shared-environment check(s) run after \`${steps[lastWall]?.command}\`.`,
      misordered: [],
      premature: [],
      missing: [],
    };
  }

  const lines: string[] = [];
  if (misordered.length > 0) {
    lines.push(
      `${misordered.length} seconds-cost check(s) run AFTER \`${steps[firstWall]?.command}\`: ` +
        `${misordered.join(", ")}.`,
      "A session waits the whole ~8-10 minute run to read a verdict that was available in seconds.",
      "Move them ahead of the expensive legs in GATE_PLAN (packages/cli/src/gate-order.ts).",
    );
  }
  if (premature.length > 0) {
    lines.push(
      `${premature.length} shared-environment check(s) run BEFORE \`${steps[lastWall]?.command}\`: ` +
        `${premature.join(", ")}.`,
      "A red there may be a sibling session's, and it must not precede the session's own answer.",
      "Move them after the expensive legs in GATE_PLAN (packages/cli/src/gate-order.ts).",
    );
  }
  if (missing.length > 0) {
    lines.push(
      `${missing.length} declared check(s) are not in the plan at all: ${missing.join(", ")}. ` +
        "Re-add them, or drop them from PRE_EXPENSIVE_CHECKS / SHARED_ENVIRONMENT_CHECKS deliberately.",
    );
  }
  return { verdict: "fail", message: lines.join("\n"), misordered, premature, missing };
}
