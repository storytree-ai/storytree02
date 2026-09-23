/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds when this diff moves one mirrored surface and not its twin

  Survival audit (gate-machinery-audit-arc): PROOF INTEGRITY. Commit 3ef84c96 records a historical
  studio-only docs change producing 256+4 divergences; without it desktop and studio behavior
  diverge.
*/
/**
 * `pnpm check:mirror-conformance` — the cross-surface conformance harness
 * (verification-integrity-arc inc 2). A sibling of `check:boundaries` / `check:manifest`: wired
 * into `pnpm gate` and CI's `verify` job as a ROOT step, deliberately OUTSIDE the ADR-0195
 * affected-only narrowing. That placement is load-bearing — drift here is introduced by editing
 * EITHER surface, and the affected filter would run only the edited one's suite. This check has to
 * see both on every PR or it only fences half the class.
 *
 * WHAT IT PROVES. Two surfaces are required to serve the same `/api/*` payloads and are forbidden
 * to share code: the desktop backend re-composes `apps/studio/server/apiRouter.ts`'s routes verbatim
 * over its own seam and may never import the studio (ADR-0176's one-wired-backend rule). The
 * duplication is the DECISION; the drift it invites is the defect. So each surface is run in its OWN
 * process by its own probe over ONE shared input, and the two decoded payloads are compared here by
 * a third party. No surface imports the other, at build time or at run time — the harness encodes
 * the boundary rather than punching through it.
 *
 * THE INPUTS, one set per `MirrorInputSet` (a row names the set its two probes run over):
 *
 *   `docs-trees` — `GET /api/docs`, compared over two things:
 *     1. a synthetic FIXTURE built here, exercising the branches a corpus may not currently contain
 *        (an unterminated frontmatter block, a doc with no H1, an over-long first sentence, a
 *        nested doc, a doc with no frontmatter at all, a non-`.md` file);
 *     2. the repo's REAL `docs/` tree, which catches whatever the corpus actually exercises and the
 *        fixture author didn't think of. Content changes can't destabilise it — the assertion is
 *        equality between two implementations over the same input, not against a recorded value.
 *
 *   `activity-fixtures` — `GET /api/activity`, compared over two SYNTHETIC fixtures under
 *     `--arm fixtures`, and over a THIRD, real-corpus input under `--arm live`. The fixtures carry
 *     RAW claim rows and a FIXED `now`, which each probe folds through its own surface's
 *     re-composed fold — the grade defect is inside the assertion rather than upstream of it — and
 *     they cover both the populated shape (every ADR-0200 grade branch, the back-compat
 *     absent/unknown grade, a stale row both folds must drop) and the ADVISORY-ABSENCE shape
 *     (`null` layers, zero rows), which is the arm that catches a route emitting `[]` where its
 *     mirror emits `null`.
 *
 *     ⚠ THE SYNTHETIC ARMS ARE NOT MADE REDUNDANT BY THE LIVE ONE AND MUST NOT BE DELETED. They
 *     exercise branches the corpus need not currently contain — measured 2026-09-01, every row in
 *     the live ledger was past the stale window, so the live arm folded them all away and reached
 *     no grade branch at all. The live arm adds what the fixture author did not think of; it
 *     removes nothing. Same relationship as `docs-trees`' two arms.
 *
 *     THE REASON THERE WAS NO LIVE ARM UNTIL 2026-09-01 WAS FALSE: "this payload's real input is
 *     `events.node_claim` in Cloud SQL, and CI is DB-free". CI authenticates to the live store with
 *     a keyless WIF step, and ADR-0302 dropped offline support outright; this check was DB-free by
 *     PLACEMENT (it ran ahead of that auth step in `ci.yml`), not by necessity — ADR-0495 recorded
 *     the refutation and ADR-0496 reclaimed what it cost.
 *
 *   `arc-fixtures` — `GET /api/arcs`, compared over two synthetic fixture DIRECTORIES. Each carries
 *     the three inputs the arc rollup joins over (a doc set, a `docs/decisions` tree, a `stories/`
 *     tree) plus the request list both probes replay. What is at risk here is the ENVELOPE rather
 *     than the payload — the join itself is shared code in @storytree/drive, which both surfaces
 *     call — so each probe prints the STATUS as well as the body, and the second arm wires NO
 *     document store: the only way to catch a mirror answering `{ arcs: [] }` where its reference
 *     answers `{ arcs: null }`, or 404-ing one id where its reference 503s.
 *
 *   `floor-health-fixtures` — `GET /api/floor-health`, compared over three synthetic fixture FILES,
 *     each carrying the two reads the floor-health composition makes (friction/increment docs and the
 *     raw event log) plus the request list both probes replay. The docs and events are served
 *     VERBATIM by each probe's store rather than recorded through one: the `Store` seam's
 *     `appendEvent` accepts no `at`, so a recording store would stamp the wall clock — which dates
 *     every route to today, reads every reinforcement as PRE-route (leaving `loudest` absent and the
 *     interesting half unexercised), and, because the two probes are separate processes at different
 *     moments, is nondeterminism ACROSS the payloads being compared. What is at risk here is the
 *     ENVELOPE, not the figure — the reading is shared `@storytree/drive` code both surfaces call —
 *     so each probe prints the STATUS as well as the body, and THREE arms are needed rather than two:
 *     `populated` (a loud floor), `quiet` (a store with nothing post-route — `loudest` absent), and
 *     `no-store` (the advisory-absence arm). The last two are the pair that matters most: they are
 *     the only way to catch a mirror answering a quiet READING where its reference answers
 *     `{ reading: null }`, and the compiled band renders "no instrument here" and "all clear"
 *     differently on purpose.
 *
 *   `tree-fixtures` — `GET /api/tree`, compared over three synthetic fixture DIRECTORIES, each a
 *     `stories/` tree plus the four reads the fold makes (the work-hierarchy seam and the three
 *     advisory proof layers) and the request list. THREE arms because this route's question has two
 *     sources and each surface re-composes both: `tree-disk` drives the two independent disk walks
 *     (`readTree` against `readTreeWithCaps`), `tree-live` the two independent adapters over the one
 *     shared projection fold (`foldedToTreeWalk` against `toDesktopTree`), and `tree-absent` wires no
 *     projection seam at all with every proof layer silent — the advisory-absence arm, the only one
 *     that catches a mirror emitting `builds: []` where its reference omits the key. This is the
 *     WIDEST pair here: on every other row the substance is shared code and only the envelope is
 *     hand-copied, while here the walks, the adapters and all four enrichment passes exist once per
 *     surface. It found two real, present divergences on its first run (see the `MIRRORS` row).
 *
 * FAIL-CLOSED, and never vacuous. A probe that dies, prints unparseable output, or returns an
 * EMPTY payload for a non-empty input is a FAILURE, not a skip: two silent surfaces agree
 * perfectly, and "a proof that cannot fail is not a proof" is the class this arc exists to fence.
 * The judge that owns the comparison rules is the pure {@link file://./mirror-conformance.ts}.
 *
 * TWO ARMS, TWO GATE STEPS, AND THE SPLIT IS THE DECISION (`--arm`, ADR-0496 D1).
 *
 *   `--arm fixtures` (the default, and what `pnpm check:mirror-conformance` runs) — every registered
 *     pair over the synthetic inputs above. Opens no connection, holds no credential, needs no
 *     network. Stays in the gate's OWN-WORK block and ahead of CI's auth step, where it always was.
 *
 *   `--arm live` (`pnpm check:mirror-conformance-live`) — the `/api/activity` pair ONLY, over a
 *     SNAPSHOT of the real `events.node_claim` ledger. Runs in the gate's SHARED-ENVIRONMENT block
 *     and below CI's keyless-WIF auth step, because it can red for a reason that is not this diff.
 *
 * WHY NOT ONE STEP THAT DOES BOTH. Giving the whole harness a live source would move ALL its rows
 * into the shared-environment block by the gate's own ordering rule (`gate-order.ts` axis 2: a step
 * that is sometimes not yours must not gate the arrival of a step that is always yours) — nine rows
 * losing their early feedback to buy one arm a connection. Worse, it would make every mirror red
 * ambiguous in SUBJECT: the per-step scoreboard exists so a reader can tell whose red it is, and a
 * row that is own-work eight times out of nine answers that question with a shrug.
 *
 * WHY THE HARNESS SNAPSHOTS AND THE PROBES DO NOT. The rows are read ONCE, here, and handed to both
 * probes as an ordinary fixture path — so the two surfaces fold IDENTICAL bytes. Two probes each
 * dialling the store would be separate processes at different moments, which is nondeterminism
 * ACROSS the payloads being compared (the trap `floor-health-fixtures` already records) and would
 * report a sibling's heartbeat as cross-surface drift. It is also the only shape the DESKTOP side
 * can have at all: that surface is architecturally forbidden from opening a DB connection
 * (ADR-0117 d.1/d.5), so a probe that dialled the store could not be its mirror.
 *
 * THE LIVE ARM FAILS LOUDLY ON AN UNREACHABLE STORE and never falls back to the synthetic fixtures.
 * A fallback would report health for a comparison that never happened — ADR-0302's lesson, and the
 * posture `check:hierarchy-drift` and `build:guidance` already take.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { appendTraversalEvents } from "@storytree/context-traversal-capture";
import type { TraversalLineIdentity } from "@storytree/context-traversal-capture";
// The criterion binding the `tree-fixtures` stories carry. Computed rather than typed: a
// `(revision-id:)` that does not bind its item's content is a spec-load ERROR, and two surfaces
// failing identically is a comparison that passes having proved nothing.
import { canonicalUatCriterionContent, parseUatTestCriteria } from "@storytree/library";
import { Attestation, Verdict, criterionRevisionId } from "@storytree/proof-protocol";

import {
  MIRRORS,
  compareMirrors,
  formatDivergences,
  projectActivityPayload,
  projectArcsPayload,
  projectCommentsPayload,
  projectFloorHealthPayload,
  projectTraversalPayload,
  projectTreePayload,
  projectAttestationsPayload,
  projectClaimsPayload,
  projectUatAttestPayload,
  type Divergence,
  type Entry,
  type MirrorInputSet,
  type Probe,
} from "./mirror-conformance.js";
import { nodeExecutable } from "./node-executable.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// ---------- the fixtures ----------

/**
 * Build the synthetic docs tree both probes walk — one file per branch the two walks actually have.
 *
 * ## THE ADR HALF OF THIS FIXTURE IS GONE, AND THE DOCBLOCK THAT ADVERTISED IT WAS THE DEFECT
 *
 * It used to stage `status` / `load_bearing` / `supersedes` / `amends` — and `supersedes_in_part`,
 * a field ADR-0139 retired outright — across seven `decisions/NNNN-*.md` files, and to claim
 * coverage of two ADR-specific branches: a lineage edge naming no ADR on disk, and an explicit
 * `load_bearing: false`. NO WALKER HAS READ ANY OF IT since PR #1546 deleted the docs walk's ADR
 * half, and `decision-log-readers-arc` increment 01 then removed the four matching fields from
 * `DocMeta` in both the studio type and its desktop mirror — so neither probe could surface them
 * even if it wanted to. `DocMeta` is `{ id, title, group, excerpt }`, and `group` is the constant
 * `'Reference'`: the `Decisions` group has no producer at all now (ADR-0403 dec 1).
 *
 * That was NOT an instrument reporting a false zero, and NOT a fixture hiding a defect — both
 * probes ignored the dead frontmatter IDENTICALLY, so the comparison they perform stayed sound. The
 * damage was to a reader, who was told this harness covered two branches that no longer exist
 * anywhere. Two files existed only to carry them (`0002-explicitly-not-load-bearing`,
 * `0003-edge-to-nowhere`) and are deleted; the rest are renamed off the ADR vocabulary, because a
 * file called `0007-nested-decision.md` makes the same claim the docblock did. What was a
 * `decisions/` directory is now `guides/` — still NESTED, which is the live axis it was carrying.
 *
 * ## THE BRANCHES IT COVERS, EACH THE REASON ONE FILE IS HERE
 *
 *   - a terminated frontmatter block, an H1, and a short first sentence — `stripFrontmatter`,
 *     `deriveTitle` and `deriveExcerpt` on their ordinary path;
 *   - an UNTERMINATED frontmatter block, which the strip must leave alone rather than swallowing
 *     the whole document;
 *   - a doc with NO H1, where `deriveTitle` falls back to the filename;
 *   - a first sentence past the excerpt cap, which `deriveExcerpt` truncates at 200;
 *   - NESTING, in two depths — both walks recurse, and a doc's id is its relpath under the root;
 *   - a doc at the ROOT carrying no frontmatter at all;
 *   - a non-`.md` file both walks must skip.
 *
 * Adding a branch here means adding it to that list. A file staged for a branch nothing reads is
 * how this fixture drifted the first time.
 */
function buildDocsFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "storytree-mirror-"));
  mkdirSync(join(dir, "guides", "nested"), { recursive: true });
  mkdirSync(join(dir, "notes", "deep"), { recursive: true });

  const write = (rel: string, body: string): void => writeFileSync(join(dir, rel), body, "utf8");

  // The ordinary path: a frontmatter block that closes, an H1, one short sentence.
  write(
    "guides/0001-frontmatter-and-heading.md",
    "---\nupdated: 2026-01-02\n---\n" +
      "# Frontmatter and heading\n\nThe ordinary path both walks take.\n",
  );
  // The strip's other branch: a block that never closes must not swallow the document.
  write(
    "guides/0002-unterminated-frontmatter.md",
    "---\nupdated: 2026-01-02\n# Unterminated\n\nThe block never closes.\n",
  );
  // `deriveTitle`'s fallback: no H1, so the title is the filename minus `.md`.
  write("guides/0003-no-heading.md", "---\nupdated: 2026-01-02\n---\nNo H1 at all; the filename is the title.\n");
  // `deriveExcerpt`'s cap: a first sentence well past 200 characters.
  write(
    "guides/0004-long-first-sentence.md",
    "---\nupdated: 2026-01-02\n---\n# Long\n\n" +
      `${"A very long opening clause that keeps going and going ".repeat(8)}and finally stops.\n`,
  );
  // Recursion, depth 1 — the id is the relpath, so a walk that flattened would diverge here.
  write(
    "guides/nested/0005-nested-doc.md",
    "---\nupdated: 2026-01-02\n---\n# Nested\n\nA doc below a subdirectory.\n",
  );
  // A doc at the ROOT carrying no frontmatter at all — the strip must be a no-op, not a truncation.
  write("overview.md", "# Overview\n\nA doc with no frontmatter at all.\n");
  // Recursion, depth 2.
  write("notes/deep/handbook.md", "# Handbook\n\nA doc two directories down.\n");
  // Both walks must skip a non-`.md` file, including one sitting beside real docs.
  write("guides/not-markdown.txt", "Both walks must skip a non-.md file.\n");
  return dir;
}

/**
 * Build the two synthetic `/api/activity` fixtures both probes fold. Each carries RAW
 * `events.node_claim` rows plus a FIXED `now` (so the 2 h stale-reclaim window is decided by data,
 * never by wall-clock), and the two already-folded pass-through layers.
 *
 * The row set covers every branch the two re-composed folds have to agree on: each ADR-0200 grade,
 * the back-compat normalisations (grade ABSENT and grade NULL are both the work claim — the exact
 * shape a re-composed SELECT that dropped the column produces), an UNRECOGNISED grade that must
 * normalise rather than pass through, a row past the stale window that BOTH folds must drop, and
 * several sessions on one unit (the composite PK the graded ledger allows).
 */
function buildActivityFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-activity-"));
  const at = (hhmm: string): string => `2026-07-29T${hhmm}:00.000Z`;
  const fixtures: { label: string; file: string; body: unknown }[] = [
    {
      label: "populated",
      file: "activity-populated.json",
      body: {
        now: at("12:00"),
        claimRows: [
          { unit_id: "cli", session_id: "s-work", branch: "claude/a", intent: "orchestrate",
            grade: "work", claimed_at: at("11:00"), heartbeat_at: at("11:59") },
          { unit_id: "cli", session_id: "s-explore", branch: "claude/b", intent: "reading",
            grade: "exploring", claimed_at: at("11:10"), heartbeat_at: at("11:58") },
          { unit_id: "cli", session_id: "s-wait", branch: "claude/c", intent: "queued",
            grade: "waiting", claimed_at: at("11:20"), heartbeat_at: at("11:57") },
          // Grade ABSENT — the pre-grade row, and the shape a SELECT that lost the column yields.
          { unit_id: "studio", session_id: "s-legacy", branch: "claude/d", intent: "pre-grade",
            claimed_at: at("11:30"), heartbeat_at: at("11:56") },
          // Grade NULL — the same fact as the DB spells it.
          { unit_id: "studio", session_id: "s-null", branch: "claude/e", intent: "null grade",
            grade: null, claimed_at: at("11:35"), heartbeat_at: at("11:55") },
          // Unrecognised — must normalise to `work`, never reach the wire verbatim.
          { unit_id: "studio", session_id: "s-bogus", branch: "claude/f", intent: "bad grade",
            grade: "sideways", claimed_at: at("11:40"), heartbeat_at: at("11:54") },
          // STALE: heartbeat 6.5 h back, past the 2 h reclaim window — both folds must DROP it.
          { unit_id: "library", session_id: "s-stale", branch: "claude/g", intent: "crashed",
            grade: "work", claimed_at: at("05:00"), heartbeat_at: at("05:30") },
        ],
        builds: [
          { unitId: "cli", tier: "story", runId: "run-1", at: at("11:58"), phase: "IMPLEMENT" },
        ],
        departures: [
          { unitId: "notice-board", sessionId: "s-gone", branch: "claude/h", at: at("11:50") },
        ],
      },
    },
    {
      // The ADVISORY-ABSENCE arm: both surfaces promise `null` (never a 503, never `[]`) when a
      // layer cannot be answered. Without this input, a route that swapped `null` for `[]` would
      // agree with its mirror on every populated fixture.
      label: "advisory-absence",
      file: "activity-absent.json",
      body: { now: at("12:00"), claimRows: [], builds: null, departures: null },
    },
  ];
  const inputs: { label: string; arg: string }[] = [];
  for (const f of fixtures) {
    const path = join(dir, f.file);
    writeFileSync(path, JSON.stringify(f.body), "utf8");
    inputs.push({ label: f.label, arg: path });
  }
  return { dir, inputs };
}

/**
 * Build the three synthetic `/api/claims` fixtures both probes replay — the claim-ledger DOCK view
 * (ADR-0200 D7), registered by ADR-0496 D3.
 *
 * WHY THIS ROW EXISTS AT ALL, since neither the query nor the fold is re-composed: what the two
 * surfaces hand-copy is the ENVELOPE. `PgClaimStore.listAllClaims` is one shared implementation
 * both call, and `groupClaimsBySession` is one shared fold both call — so the drift surface is the
 * 405 that makes the route read-only, the advisory `{ sessions: null }` a down store or a seam-less
 * backend must answer INSTEAD of a 503, and the `null`-versus-`[]` distinction the dock renders as
 * two different sentences. That is the `/api/arcs` argument exactly, and it was registered on it.
 *
 * THREE ARMS, and the two absence arms are what carry the row. Without them both surfaces agree on
 * every populated request and a `[]`-for-`null` swap ships. `advisory-null` (a seam that ANSWERS
 * null) and `seam-absent` (a backend that does not OFFER `sessionClaims`) are different code paths
 * — `?.()` versus the null check — and both are postures the surfaces promise.
 *
 * THE TIMESTAMPS ARE MINTED HERE RATHER THAN WRITTEN DOWN, and that is forced rather than stylish.
 * Neither route takes an injectable clock: both call `groupClaimsBySession(claims, new Date())`. A
 * fixture carrying fixed dates would age past the 2 h stale window and silently stop exercising the
 * live branch — the arm would keep passing while proving strictly less every day, which is the
 * decaying-proof shape this whole harness exists to refuse. So the rows are minted relative to NOW,
 * an hour clear of the boundary on the live side and four hours clear on the stale side.
 *
 * AND `now` RIDES THE FIXTURE, which is what makes the arm deterministic rather than merely fresh.
 * Each probe pins its own clock to it before replaying anything (`freezeClockAt`), so the grouped
 * payload's `ageMs` / `heartbeatAgeMs` leaves are decided by the data. Without it the two probes —
 * separate processes launched one after the other — diverged on eight leaves by the 307 ms between
 * their launches, and the row reported cross-surface drift where the only difference was elapsed
 * time. That is the `activity-fixtures` rule ("a FIXED `now`, so the window is decided by data,
 * never by wall-clock") reaching a route whose fold sits inside the handler instead of behind the
 * seam.
 */
function buildClaimsFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-claims-"));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ago = (ms: number): string => new Date(now - ms).toISOString();
  const HOUR = 60 * 60 * 1_000;

  // The SAME requests against every arm — the point of the absence arms is that an identical ask
  // gives a different honest answer, so asking something different would defeat them.
  const requests = [
    { label: "read", method: "GET", path: "/api/claims" },
    // Read-only is a DECISION on this route, and a status is the only place it is expressed.
    { label: "write", method: "POST", path: "/api/claims" },
  ];

  const claim = (over: Record<string, unknown>) => ({
    unitId: "notice-board",
    sessionId: "sess-1",
    branch: "claude/dock",
    intent: "wiring the dock",
    grade: "work",
    claimedAt: ago(HOUR),
    heartbeatAt: ago(HOUR),
    ...over,
  });

  const fixtures = [
    {
      label: "populated",
      file: "claims-populated.json",
      body: {
        now: nowIso,
        seamAbsent: false,
        claims: [
          // Two claims on ONE session — the fold's grouping is what the dock renders.
          claim({ unitId: "notice-board", grade: "work" }),
          claim({ unitId: "library", grade: "exploring", intent: "reading" }),
          // A SECOND session, so a fold that collapsed sessions would be visible.
          claim({ unitId: "cli", sessionId: "sess-2", branch: "claude/other", grade: "waiting" }),
          // Past the 2 h reclaim window — both surfaces must drop a crashed holder's row.
          claim({ unitId: "drive", sessionId: "sess-stale", claimedAt: ago(6 * HOUR), heartbeatAt: ago(6 * HOUR) }),
        ],
        requests,
      },
    },
    {
      // The seam ANSWERS null — a stopped store, or the json backend. 200 `{ sessions: null }`.
      label: "advisory-null",
      file: "claims-advisory-null.json",
      body: { now: nowIso, seamAbsent: false, claims: null, requests },
    },
    {
      // The seam is not OFFERED at all — a narrow backend. A different branch (`?.()`), same answer.
      label: "seam-absent",
      file: "claims-seam-absent.json",
      body: { now: nowIso, seamAbsent: true, claims: null, requests },
    },
  ];

  const inputs: { label: string; arg: string }[] = [];
  for (const f of fixtures) {
    const path = join(dir, f.file);
    writeFileSync(path, JSON.stringify(f.body), "utf8");
    inputs.push({ label: f.label, arg: path });
  }
  return { dir, inputs };
}

/**
 * Build the two synthetic `/api/arcs` fixtures both probes replay. Each is a DIRECTORY carrying the
 * three inputs the arc rollup joins over — a doc set (`arcs.json`), a `docs/decisions` tree and a
 * `stories/` tree — plus the REQUEST LIST both probes replay against it.
 *
 * WHY THE REQUESTS RIDE THE FIXTURE. Each probe could hold its own list of what to ask, and that
 * would be two hand-kept lists of the same fact — the exact drift class this harness exists to
 * fence, one level up from the payloads. A probe replays what it is handed and decides nothing.
 *
 * WHY TWO ARMS, and why the second one is not optional. `populated` proves the join reaches the
 * wire (arcs, their increments, their questions, the ADR and story stamps) and that the id decode,
 * the unknown-id answer and the method guard all agree. `no-store` is the ADVISORY-ABSENCE arm: it
 * is the ONLY thing that catches a mirror answering `{ arcs: [] }` where its reference answers
 * `{ arcs: null }`, or 404-ing a single id where its reference 503s — and that distinction is
 * precisely what the compiled arc lens renders differently ("needs the live store" vs "no arcs").
 * Without it, both surfaces would agree on every populated request and the defect would ship.
 *
 * There is no "real corpus" arm, and the reason is NOT that the store cannot be reached — it can,
 * from the gate and from CI alike (ADR-0495 / ADR-0496 D2, which built one for `/api/activity`).
 * It is that this row compares the ENVELOPE and the join itself is shared `@storytree/arc` code
 * both surfaces call, so a live arm would re-measure agreement that no drift class threatens —
 * while the two arms that carry this row's value, `no-store` and the unknown-id miss, are states a
 * live store cannot be put into at all.
 */
function buildArcFixtures() {
  const root = mkdtempSync(join(tmpdir(), "storytree-arcs-"));

  // The SAME requests against both arms — the point of the second arm is that identical asks give
  // different honest answers, so asking different things would defeat it.
  const requests = [
    { label: "list", method: "GET", path: "/api/arcs" },
    { label: "one", method: "GET", path: "/api/arcs/surface-arc" },
    { label: "closed", method: "GET", path: "/api/arcs/closed-arc" },
    { label: "unknown", method: "GET", path: "/api/arcs/no-such-arc" },
    // Percent-encoded: both surfaces must DECODE before the lookup, so the miss names `needs decoding`.
    { label: "encoded", method: "GET", path: "/api/arcs/needs%20decoding" },
    { label: "write", method: "POST", path: "/api/arcs/surface-arc" },
  ];

  const doc = (id: string, kind: string, body: Record<string, unknown>) => ({
    id,
    kind,
    doc: { kind, id, createdAt: "2026-07-29", updatedAt: "2026-07-30", ...body },
    createdAt: "2026-07-29",
    updatedAt: "2026-07-30",
  } satisfies Record<string, unknown>);

  const docs = [
    doc("surface-arc", "arc", {
      title: "Arcs as the primary orientation surface",
      description: "the arc surface",
      intent: "Arcs are what the owner meets on the map.",
      endState: "The owner stops asking for a re-onboarding briefing.",
    }),
    // A CLOSED arc: `loadArcRollups` returns closed arcs too (filtering is the caller's), so both
    // surfaces must carry `lifecycle: "closed"` rather than one of them dropping the row.
    doc("closed-arc", "arc", {
      title: "A finished initiative",
      description: "closed",
      intent: "done",
      endState: "done",
      lifecycle: "closed",
    }),
    // Two increments on one arc, one LANDED and one PARKED — the status-rank ordering
    // (forward-looking first) is part of the payload, so a mirror that re-sorted would go red.
    doc("surface-arc-inc-01", "increment", {
      title: "the rollup landed",
      description: "d",
      objective: "the rollup landed",
      body: "the rollup landed",
      arcRef: "asset:surface-arc",
      status: "closed",
      outcome: { date: "2026-07-30", pr: "#1010" },
    }),
    doc("surface-arc-inc-02", "increment", {
      title: "the lanes are not built yet",
      description: "d",
      objective: "build the lanes",
      body: "build the lanes",
      arcRef: "asset:surface-arc",
      status: "proposal",
      parked: "2026-07-31",
      frictionRefs: ["friction-arc-context-reconstruction"],
    }),
    // An increment on ANOTHER arc — the `arcRef` filter must exclude it from both payloads.
    doc("other-arc-inc-01", "increment", {
      title: "belongs elsewhere",
      description: "d",
      objective: "elsewhere",
      body: "elsewhere",
      arcRef: "asset:some-other-arc",
      status: "closed",
    }),
    doc("oq-blocked-meaning", "open-question", {
      title: "What exactly qualifies as blocked?",
      description: "D7 names blocked but does not define it",
      stakes: "The surface cannot render a blocked state until this is settled.",
      statement: "s",
      context: "c",
      arcRef: "asset:surface-arc",
    }),
  ];

  const populated = join(root, "populated");
  mkdirSync(join(populated, "docs", "decisions"), { recursive: true });
  mkdirSync(join(populated, "stories", "surface-story"), { recursive: true });
  mkdirSync(join(populated, "stories", "unstamped-story"), { recursive: true });
  writeFileSync(
    join(populated, "docs", "decisions", "0267-arcs-take-the-slot.md"),
    "---\nstatus: accepted\narc: surface-arc\n---\n\n# ADR-0267: Arcs take the slot\n",
    "utf8",
  );
  // An ADR with NO `arc:` stamp — both joins must leave it out.
  writeFileSync(
    join(populated, "docs", "decisions", "0268-unstamped.md"),
    "---\nstatus: accepted\n---\n\n# ADR-0268: Unstamped\n",
    "utf8",
  );
  writeFileSync(
    join(populated, "stories", "surface-story", "story.md"),
    '---\nid: "surface-story"\ntier: story\narc: surface-arc\n---\n\n# Surface story\n',
    "utf8",
  );
  writeFileSync(
    join(populated, "stories", "unstamped-story", "story.md"),
    '---\nid: "unstamped-story"\ntier: story\n---\n\n# Unstamped story\n',
    "utf8",
  );
  writeFileSync(join(populated, "arcs.json"), JSON.stringify({ docs, requests }), "utf8");

  // The advisory-absence arm: `docs: null` tells each probe to wire NO document store at all — the
  // offline/json posture. Its trees are never read, and are absent on purpose.
  const noStore = join(root, "no-store");
  mkdirSync(noStore, { recursive: true });
  writeFileSync(join(noStore, "arcs.json"), JSON.stringify({ docs: null, requests }), "utf8");

  return {
    dir: root,
    inputs: [
      { label: "arcs-populated", arg: populated },
      { label: "arcs-no-store", arg: noStore },
    ],
  };
}

/**
 * Build the three synthetic `GET /api/floor-health` fixtures both probes replay. Each is one JSON
 * FILE carrying `{ docs, events, requests }` — the two reads `loadFloorHealthReading` makes, plus the
 * request list. No directories: unlike the arc rollup, the floor-health reading joins no on-disk tree.
 *
 * WHY THE EVENTS ARE WRITTEN OUT WITH EXPLICIT `at` VALUES rather than recorded through a store. A
 * reinforcement is attributed to the route STANDING WHEN IT LANDED, read off the event log
 * (drive's `RECURRENCE_ATTRIBUTION_RULE`), and the `Store` seam's `appendEvent` accepts no `at` — so
 * a store that recorded these would stamp the wall clock, date every route to TODAY, and read every
 * reinforcement as pre-route. `loudest` would then be absent from every arm and the richest half of
 * the payload would never be compared. For a MIRROR comparison there is a second, sharper reason: the
 * two probes run in separate processes at different moments, so a wall-clock stamp is nondeterminism
 * between the very payloads being diffed. Verbatim input is what makes this comparison decidable.
 *
 * WHY THREE ARMS, and why the last two are not optional. `populated` proves the reading reaches the
 * wire with its loudest distinct cause, its window and its collapsing rule, and that the method guard
 * agrees. `quiet` holds a real store whose reinforcements are all PRE-route, so the reading arrives
 * with NO `loudest` — a quiet floor. `no-store` wires no document store at all, so the reading is
 * `null`. Those two are the ADVISORY-ABSENCE pair: they are the only thing that catches a mirror
 * answering `{ reading: <quiet reading> }` where its reference answers `{ reading: null }`, and
 * `apps/studio/src/lib/floorHealth.ts` renders those differently on purpose — a missing instrument
 * presented as "all clear" is the exact failure ADR-0316's band exists to avoid. Without them, both
 * surfaces would agree on every populated request and the defect would ship.
 *
 * There is no "real corpus" arm, and — as for `arc-fixtures` above — the reason is NOT that the
 * store is out of reach (ADR-0496 D2 built one for `/api/activity`). The reading is shared
 * `@storytree/drive` code both surfaces call, so what is compared here is the envelope; and the two
 * arms that carry this row's value, `quiet` and `no-store`, are states the live floor cannot be put
 * into on demand.
 */
function buildFloorHealthFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-floor-health-"));

  // The SAME requests against every arm — the point of the absence arms is that identical asks give
  // different honest answers, so asking different things would defeat them.
  const requests = [
    { label: "read", method: "GET", path: "/api/floor-health" },
    // Report-only is a DECISION (ADR-0316 D4), and it is expressed as a status — so it is replayed.
    { label: "write", method: "POST", path: "/api/floor-health" },
  ];

  const friction = (
    id: string,
    body: Record<string, unknown>,
  ) => ({
    id,
    kind: "friction",
    doc: { title: id, ...body },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  } satisfies Record<string, unknown>);

  /** One route-setting event — the timestamp IS the fixture (see the header). */
  const routeEvent = (seq: number, id: string, route: string, at: string) => ({
    seq,
    id,
    kind: "friction",
    type: "updated",
    doc: { route },
    actor: "cli",
    at,
  } satisfies Record<string, unknown>);

  const reinforcedBy = (...dates: string[]): Array<Record<string, unknown>> =>
    dates.map((date) => ({ branch: "claude/x", date, evidence: "`e`" }));

  // A LOUD floor. Two filings an author joined with one increment's `frictionRefs` (so they collapse
  // into ONE distinct cause with two members — the collapsing rule reaching the wire), a third filing
  // on a NON-tripwire route that stands alone (so `distinctCauses` > 1 and `unjoined` > 0), and a
  // discharged filing that must leave the live population entirely.
  const populatedDocs = [
    friction("a-live-guardrail-that-keeps-firing", {
      route: "guardrail",
      // 07-11 is the day the route was set: SAME-DAY, never post-route, because day-granular dates
      // cannot prove ordering. Only the three later ones count.
      reinforcedBy: reinforcedBy("2026-07-11", "2026-07-12", "2026-07-16", "2026-07-28"),
    }),
    friction("a-second-filing-one-remedy-covers", {
      route: "guardrail",
      reinforcedBy: reinforcedBy("2026-07-20"),
    }),
    friction("an-unjoined-tool-gap", {
      // `tool` is deliberately NOT a tripwire route — a parked capability gap keeps firing until the
      // capability is built — so this contributes a distinct cause with zero tripwire recurrence.
      route: "tool",
      reinforcedBy: reinforcedBy("2026-07-22"),
    }),
    friction("a-discharged-filing", {
      route: "guardrail",
      dischargedBy: "asset:some-landed-remedy",
      reinforcedBy: reinforcedBy("2026-07-25"),
    }),
    {
      id: "one-remedy-for-both",
      kind: "increment",
      doc: {
        title: "one remedy declared to cover both filings",
        arcRef: "asset:some-arc",
        status: "closed",
        frictionRefs: ["a-live-guardrail-that-keeps-firing", "a-second-filing-one-remedy-covers"],
      },
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  ];
  const populatedEvents = [
    routeEvent(1, "a-live-guardrail-that-keeps-firing", "guardrail", "2026-07-11T13:54:04.888Z"),
    routeEvent(2, "a-second-filing-one-remedy-covers", "guardrail", "2026-07-14T09:00:00.000Z"),
    routeEvent(3, "an-unjoined-tool-gap", "tool", "2026-07-15T09:00:00.000Z"),
    routeEvent(4, "a-discharged-filing", "guardrail", "2026-07-16T09:00:00.000Z"),
  ];

  // A QUIET floor: a real store, a routed live filing, but every reinforcement PREDATES the route
  // event — pre-route evidence gathered at capture, never recurrence. So the reading arrives with no
  // `loudest` at all. This is what `{ reading: null }` must not be confused with.
  const quietDocs = [
    friction("a-routed-filing-that-never-recurred", {
      route: "guardrail",
      reinforcedBy: reinforcedBy("2026-07-01", "2026-07-02"),
    }),
  ];
  const quietEvents = [
    routeEvent(1, "a-routed-filing-that-never-recurred", "guardrail", "2026-07-10T09:00:00.000Z"),
  ];

  const arms: { label: string; file: string; body: unknown }[] = [
    {
      label: "floor-health-populated",
      file: "floor-health-populated.json",
      body: { docs: populatedDocs, events: populatedEvents, requests },
    },
    {
      label: "floor-health-quiet",
      file: "floor-health-quiet.json",
      body: { docs: quietDocs, events: quietEvents, requests },
    },
    {
      // `docs: null` tells each probe to wire NO document store at all — the offline/json posture.
      label: "floor-health-no-store",
      file: "floor-health-no-store.json",
      body: { docs: null, events: [], requests },
    },
  ];

  const inputs: { label: string; arg: string }[] = [];
  for (const arm of arms) {
    const path = join(dir, arm.file);
    writeFileSync(path, JSON.stringify(arm.body), "utf8");
    inputs.push({ label: arm.label, arg: path });
  }
  return { dir, inputs };
}

/**
 * Assemble every input set, and the cleanup that removes what was written to disk. Each
 * {@link MirrorInputSet} is built ONCE and shared by every row that names it, so two mirrors over
 * the same input are compared over the identical bytes.
 */
/**
 * Build the two fixture DIRECTORIES both traversal probes run over — the replay panel's three
 * local-file reads (`traversal-panel-arc`, increment `desktop-serves-the-traversal-routes`).
 *
 * WHY A DIRECTORY RATHER THAN A DOCUMENT STORE. These three routes have no backend at all: their
 * source of truth is a directory of JSONL files, reached through the documented ambient overrides
 * `STORYTREE_TRAVERSAL_DIR` and `STORYTREE_TRANSCRIPT_DIR`. Each arm therefore carries its own trace
 * dir and transcript root, and each probe points the env at them — so the resolution path the
 * handlers actually take is inside the comparison rather than bypassed by handing them a path.
 *
 * BOTH PROBES GET THE SAME ABSOLUTE FIXTURE PATH, which is load-bearing rather than incidental:
 * `dir` rides the `/api/traversal/sessions` wire and `scan.root` rides the occupancy wire, so a
 * surface that resolved its root differently shows up as a divergence instead of hiding behind two
 * per-surface temp dirs that were never expected to match.
 *
 * THE TRACES ARE WRITTEN THROUGH THE SINK'S OWN `appendTraversalEvents`, never as hand-spelled
 * bytes: that is how a real trace grows, and a fixture written any other way would be proving the
 * two surfaces agree about a file shape neither will ever meet.
 *
 * THE ARMS, and what each is the only way to catch:
 *   `populated` — two readable traces (one multi-event, so `eventCount`/`lastObservedAt` are
 *     exercised), an ALL-CORRUPT trace, and one host transcript carrying two real readings. The
 *     multi-event trace's lines are stamped with TWO different harness/machine pairs and the other
 *     with none (ADR-0579), so the index's `harnesses`/`hosts` lists are compared populated, ordered
 *     and empty — a mirror that dropped them, kept only the first, or answered `[]` where its reference
 *     answered values diverges here. Without the stamps both surfaces would compare two empty lists,
 *     which is the vacuous pass this harness exists to refuse.
 *   `empty` — the ADVISORY-ABSENCE arm: no traces and no transcripts. It is the only arm that
 *     catches a mirror answering an ERROR where its reference answers an honest empty list, or
 *     inventing a series where its reference reports `absence`. The SAME requests are replayed
 *     against both arms, because the whole point is that identical asks give different honest
 *     answers.
 *
 * THE REQUEST LIST LIVES HERE, NOT IN EITHER PROBE — two hand-kept lists of what to ask is the same
 * drift class one level up (`mirror-pair-registration-is-mandatory-not-optional`). Most of these
 * requests exist for their STATUS: the envelope is what is hand-copied on this pair, and half of it
 * is expressed as a status code rather than as a field.
 */
function buildTraversalFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-traversal-"));

  const requests = [
    // The index, and the honest-empty answer that is a different fact from "no traces here".
    { label: "sessions", method: "GET", path: "/api/traversal/sessions" },
    // A readable replay, and the two answers an unreadable one must keep apart: ABSENT is a 404,
    // ALL-CORRUPT is a 200 carrying `skipped > 0`, because that is something observed (ADR-0241 D5).
    { label: "replay", method: "GET", path: "/api/traversal?session=session-alpha" },
    { label: "replay-absent", method: "GET", path: "/api/traversal?session=never-captured" },
    { label: "replay-corrupt", method: "GET", path: "/api/traversal?session=session-garbage" },
    // The two guards standing between a query parameter and a `path.join`, refused BY NAME.
    { label: "replay-no-id", method: "GET", path: "/api/traversal" },
    { label: "replay-escaping-id", method: "GET", path: "/api/traversal?session=..%2Fescape" },
    // The occupancy read, its deliberate NON-404 absence, and the same two guards.
    { label: "occupancy", method: "GET", path: "/api/context-windows?session=window-alpha" },
    { label: "occupancy-absent", method: "GET", path: "/api/context-windows?session=never-opened" },
    { label: "occupancy-no-id", method: "GET", path: "/api/context-windows" },
    { label: "occupancy-escaping-id", method: "GET", path: "/api/context-windows?session=a%2Fb" },
    // Read-only is a DECISION on both routes, and it is expressed as a status — so it is replayed.
    { label: "sessions-write", method: "POST", path: "/api/traversal/sessions" },
    { label: "replay-write", method: "POST", path: "/api/traversal?session=session-alpha" },
    { label: "occupancy-write", method: "POST", path: "/api/context-windows?session=window-alpha" },
  ];

  /** One assistant line in the shape the host harness actually writes. */
  const assistantLine = (windowId: string, at: string, id: string, tokens: number): string =>
    JSON.stringify({
      type: "assistant",
      sessionId: windowId,
      timestamp: at,
      isSidechain: false,
      cwd: "/home/mickh/code/storytree",
      message: { id, model: "claude-opus-5", usage: { input_tokens: tokens, output_tokens: 12 } },
    });

  const arm = (label: string, populate: (traceDir: string, transcriptRoot: string) => void) => {
    const armDir = join(dir, label);
    const traceDir = join(armDir, "traces");
    const transcriptRoot = join(armDir, "transcripts");
    mkdirSync(traceDir, { recursive: true });
    mkdirSync(transcriptRoot, { recursive: true });
    populate(traceDir, transcriptRoot);
    const file = join(armDir, "fixture.json");
    writeFileSync(file, JSON.stringify({ traceDir, transcriptRoot, requests }, null, 2));
    return { label, arg: file };
  };

  let visit = 0;
  const appendVisit = (
    traceDir: string,
    sessionId: string,
    at: string,
    identity: Pick<TraversalLineIdentity, "harness" | "host"> = {},
  ): void => {
    visit += 1;
    const ok = appendTraversalEvents(
      [
        {
          kind: "front_matter_read",
          eventId: `event:visit-${visit}`,
          sessionId,
          visitId: `visit-${visit}`,
          nodeId: "node-a",
          surfaceId: "tree",
          at,
        },
      ],
      { dir: traceDir, sessionId, ...identity },
    );
    if (!ok) throw new Error("traversal fixture: the sink refused a fixture event");
  };

  const inputs = [
    arm("populated", (traceDir, transcriptRoot) => {
      // Two DIFFERENT pairs on one trace: first-seen order and plurality both reach the wire.
      appendVisit(traceDir, "session-alpha", "2026-08-28T10:00:00.000Z", {
        harness: "claude-code",
        host: "fixture-laptop",
      });
      appendVisit(traceDir, "session-alpha", "2026-08-28T10:00:05.000Z", {
        harness: "codex",
        host: "fixture-desktop",
      });
      // No stamp: the pre-detection trace, whose lists must travel EMPTY on both surfaces (D5).
      appendVisit(traceDir, "session-beta", "2026-08-28T11:00:00.000Z");
      // Every line garbage: the tolerant reader skips all of them, so the session is omitted from
      // the index and its replay is a 200 with `skipped > 0` rather than a 404.
      writeFileSync(join(traceDir, "session-garbage.jsonl"), "not json at all\nnor is this\n");
      const project = join(transcriptRoot, "C--code-storytree");
      mkdirSync(project, { recursive: true });
      writeFileSync(
        join(project, "window-alpha.jsonl"),
        `${[
          assistantLine("window-alpha", "2026-08-28T10:00:00.000Z", "msg-1", 110_300),
          assistantLine("window-alpha", "2026-08-28T10:05:00.000Z", "msg-2", 220_600),
        ].join("\n")}\n`,
      );
    }),
    // Nothing captured at all — every root exists and is empty, which is a normal state on a fresh
    // machine and must answer as one on both surfaces.
    arm("empty", () => {}),
  ];

  return { dir, inputs };
}

/**
 * The `comments-fixtures` input set: ONE fixture file carrying the request list both probes replay.
 *
 * WHY THESE REQUESTS. Each one isolates a decision the two surfaces make SEPARATELY when they parse
 * the query string, which is the only part of this route either of them composes:
 *   · no parameters at all — the unfiltered baseline;
 *   · `?topicId=` PRESENT BUT EMPTY — the divergence this pair was opened on. `searchParams.get`
 *     answers `""` rather than null here, so a guard written `?? undefined` admits the empty string
 *     as a filter value and the route answers with NO comments, where a truthy guard treats the
 *     parameter as absent and answers with ALL of them. Two surfaces, opposite answers, no observer
 *     (measured 2026-08-31, `unscored-guards-arc`);
 *   · a real `topicId`, so the fixture proves the parse still passes a genuine value through and the
 *     row above is not green merely because both sides stopped filtering;
 *   · each `topicKind` arm — the accepted pair, empty, and an unrecognised value, which must be
 *     DROPPED rather than passed to the store as a filter no comment can match;
 *   · the two combined, with the id empty and then present, because the empty-id defect survived
 *     alongside a valid second parameter and a single-parameter fixture would have missed it.
 *
 * No comment data rides the fixture, deliberately — see `projectCommentsPayload`.
 */
function buildCommentsFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-comments-"));
  const file = join(dir, "requests.json");
  writeFileSync(
    file,
    JSON.stringify({
      requests: [
        "/api/comments",
        "/api/comments?topicId=",
        "/api/comments?topicId=adr-0001",
        "/api/comments?topicKind=doc",
        "/api/comments?topicKind=asset",
        "/api/comments?topicKind=",
        "/api/comments?topicKind=bogus",
        "/api/comments?topicId=&topicKind=asset",
        "/api/comments?topicId=x&topicKind=asset",
      ],
    }),
  );
  return { dir, inputs: [{ label: "requests", arg: file }] };
}

/**
 * The canonical text of one authored UAT criterion item — the EXACT string the fixture writes,
 * minus its list number and identity annotations.
 *
 * ⚠ IT MUST BE THE WHOLE ITEM, and this is the trap that produced a vacuous arm before it was.
 * `canonicalUatCriterionContent` strips only the identity tags (`criterion-id`, `revision-id`,
 * `previous-revision-id`, `lineage`). A `(detail: …)` tag is CONTENT, so a revision computed from
 * the prose alone does not bind an item that carries one — `parseUatTestCriteria` then refuses the
 * whole story, `loadNodeSpec` throws, and BOTH surfaces answer with no legs at all. The comparison
 * passes, having compared two identical failures: a fixture arm that looks rich and proves nothing.
 * Measured 2026-08-31, on the first run of the `/api/attestations` row.
 */
function criterionItemText(ordinal: number, prose: string, detail?: string): string {
  return `${ordinal}. ${prose}${detail === undefined ? "" : ` _(detail: ${detail})_`}`;
}

/** That item's computed content binding — what a signed verdict or a recorded vouch must carry. */
function criterionRevision(ordinal: number, prose: string, detail?: string): string {
  return criterionRevisionId(canonicalUatCriterionContent(criterionItemText(ordinal, prose, detail)));
}

/** One authored criterion LINE: the item text plus its identity and binding annotations. */
function authoredCriterion(
  ordinal: number,
  criterionId: string,
  prose: string,
  detail?: string,
): string {
  return (
    `${criterionItemText(ordinal, prose, detail)} (criterion-id: ${criterionId})` +
    `(revision-id: ${criterionRevision(ordinal, prose, detail)})`
  );
}

/**
 * Refuse a fixture story whose UAT section does not parse into the criteria it was authored to carry.
 *
 * THE GUARD EXISTS BECAUSE THE FAILURE IS SILENT AND SYMMETRIC. A story body the criterion parser
 * refuses makes `loadNodeSpec` throw, both surfaces fall to the same empty answer, and the mirror
 * comparison PASSES — so the arm reports a tidy ✓ while comparing nothing. `main()`'s
 * empty-payload guard cannot see it either: the payload is a well-formed envelope, it just has no
 * legs in it. Asserted at fixture-BUILD time, where the author can still read the reason.
 */
function assertCriteriaParse(storyId: string, body: string, expected: number): void {
  let parsed: readonly unknown[];
  try {
    parsed = parseUatTestCriteria(storyId, body);
  } catch (err) {
    throw new Error(
      `mirror fixture story "${storyId}" does not parse — every arm using it would compare two ` +
        `identical failures and PASS: ${(err as Error).message}`,
    );
  }
  if (parsed.length !== expected) {
    throw new Error(
      `mirror fixture story "${storyId}" parsed ${parsed.length} UAT criteria, expected ${expected} ` +
        "— an arm that measures fewer legs than it authored is measuring less than it reports",
    );
  }
}

/**
 * The `tree-fixtures` input set: three synthetic fixture DIRECTORIES, each a `stories/` tree plus a
 * `tree.json` carrying the four reads the `/api/tree` fold makes and the request list both probes
 * replay.
 *
 * WHY THREE ARMS, and why none of them is optional. This route's QUESTION has two sources (ADR-0445
 * D1) and each surface re-composes BOTH independently, so one arm would leave half the pair
 * uncompared:
 *   · `tree-disk` — the seam is PRESENT and answers `null` (the projection loader has not run), so
 *     both surfaces fall back to their own disk walk: `readTree` (apiRouter.ts) against
 *     `readTreeWithCaps` (tree-verdicts.ts), two independent walks of one `stories/` tree. This is
 *     the arm that found both real divergences this row was registered with.
 *   · `tree-live` — the seam answers with a projection, so each runs its own adapter over the ONE
 *     shared `foldWorkHierarchy`: `foldedToTreeWalk` against `toDesktopTree`.
 *   · `tree-absent` — the seam is MISSING ENTIRELY and every advisory proof layer is `null`. Two
 *     absences at once, and the surfaces treat them separately: "this backend serves no projection"
 *     is a different fallback reason from "the store holds none", and a null proof layer must leave
 *     the authored hue rather than invent one. It is the arm that catches a mirror emitting
 *     `builds: []` where its reference omits the key, or dropping `uatCriteria` when there is
 *     nothing to say.
 *
 * THE STORIES TREE IS SHAPED BY BRANCH, one story per thing the two walks decide separately:
 *   - `alpha` — the full shape: three capabilities (one whose spec file is MISSING, so both walks
 *     must render an `error` node rather than throwing), two signable UAT criteria, and two
 *     reliability gates of which one is RETIRED IN PLACE (ADR-0436 — it must leave both the
 *     obligation union and the `(covers:)` coverage set) while the live one covers a capability with
 *     no verdict of its own, so `applyCapCoverage` has something to synthesize;
 *   - `bravo` — `render: building` and `uat_witness: machine`, the two frontmatter hints that reach
 *     the wire as their own fields;
 *   - `charlie` — the ORDINARY story: no capabilities, no criteria, no gates, no render hint. Its
 *     whole job is the fields a walk emits when the author declared nothing, which is where a
 *     present-vs-absent divergence hides;
 *   - `delta` — a MALFORMED `story.md`, so both walks take the catch branch and emit an `error`
 *     node. The least-read path on either surface and the likeliest to have drifted;
 *   - `echo` — a `## UAT Test Criteria (would-be)` section (ADR-0097), whose criteria are recorded
 *     and rendered but are not obligations;
 *   - `no-story/` (a directory with no `story.md`) and `loose.md` (a file at the root), each of
 *     which both walks must SKIP.
 *
 * THE PROOF LAYERS RIDE THE FIXTURE ALREADY SHAPED — a verdict map, a raw signing-event stream, a
 * build list — for the reason `activity-fixtures` carries raw claim rows: they are the INPUT, and
 * what is under test is each surface's fold of them. The events are REAL signed `Verdict` documents,
 * parsed here so a malformed fixture fails at BUILD time: the shared rollup compute grants nothing
 * for a doc it cannot parse, so a fixture of plausible-looking stubs would leave every crown grey on
 * both surfaces and compare two blanks — the vacuous pass this whole harness exists to refuse.
 *
 * There is no "real corpus" arm, and the reason once given — "the live projection lives in Cloud SQL
 * and CI is DB-free" — carries the same false premise the `activity-fixtures` note above corrects:
 * this check is DB-free by PLACEMENT, not by necessity (ADR-0495). What survives that correction is
 * the weaker, still-true half — the real `stories/` tree is already walked by each surface's own
 * suite, so a live arm here would buy less than it does on `/api/activity`, whose fold nothing else
 * exercises against real rows.
 */
function buildTreeFixtures() {
  const root = mkdtempSync(join(tmpdir(), "storytree-tree-"));

  // The SAME requests against every arm — the point of the absence arm is that an identical ask
  // gives a different honest answer, so asking something different would defeat it.
  const requests = [
    { label: "read", method: "GET", path: "/api/tree" },
    // Read-only is a DECISION on both surfaces and it is expressed as a status, so it is replayed.
    { label: "write", method: "POST", path: "/api/tree" },
  ];

  const AT = "2026-08-31T09:00:00.000Z";
  const C_ONE = `uatc_${"0".repeat(23)}1`;
  const C_TWO = `uatc_${"0".repeat(23)}2`;
  const C_WOULD_BE = `uatc_${"0".repeat(23)}3`;

  const CRITERION_ONE = "**The map paints from proof** — the crown greens from signed verdicts.";
  const CRITERION_TWO = "**The overlay under-claims** — a null source leaves the authored hue.";
  const CRITERION_WOULD_BE = "**The would-be leg** — recorded, rendered, never green-blocking.";

  /** One authored criterion line, its identity and content binding attached. */
  const criterion = (ordinal: number, criterionId: string, prose: string): string =>
    authoredCriterion(ordinal, criterionId, prose);
  /** The same line's computed `(revision-id:)` — what a signed criterion verdict must carry. */
  const revisionOf = (ordinal: number, prose: string): string =>
    criterionRevision(ordinal, prose);

  /** A signed verdict event, parsed so a malformed fixture fails HERE rather than folding to grey. */
  const signed = (
    seq: number,
    unitId: string,
    proofMode: "capability" | "story" | "contract",
    outcome: "pass" | "fail",
    binding?: { criterionId: string; revisionId: string },
  ) => ({
    kind: "signing",
    seq,
    doc: Verdict.parse({
      unitId,
      proofMode,
      outcome,
      commitSha: "ca".repeat(20),
      signer: "ci@example.com",
      runId: `run-${seq}`,
      at: AT,
      ...(binding ?? {}),
    }),
  });

  const verdictEvents = [
    // A capability's OWN signed verdict — the plant that greens on its own proof.
    signed(1, "cap-a", "capability", "pass"),
    // The live reliability gate: one own-proof obligation discharged, and — through its `(covers:)`
    // — the only thing that can green `cap-b`, which has no verdict of its own.
    signed(2, "alpha#gate-1", "story", "pass"),
    // Criterion one: proven. Criterion two: proven and THEN regressed, so both `uatCriteria` states
    // that are not `pending` are exercised — a fixture of passes alone would leave the `failing`
    // branch of each surface's `applyUatCriteria` uncompared.
    signed(3, C_ONE, "story", "pass", { criterionId: C_ONE, revisionId: revisionOf(1, CRITERION_ONE) }),
    signed(4, C_TWO, "story", "pass", { criterionId: C_TWO, revisionId: revisionOf(2, CRITERION_TWO) }),
    signed(5, C_TWO, "story", "fail", { criterionId: C_TWO, revisionId: revisionOf(2, CRITERION_TWO) }),
    signed(6, "cap-c", "capability", "pass"),
    // A legacy story's OWN unit verdict — never a roll-up, and it must survive the crown pass.
    signed(7, "charlie", "story", "pass"),
  ];

  const latestVerdicts = {
    "cap-a": { outcome: "pass", at: AT },
    "cap-c": { outcome: "pass", at: AT },
    charlie: { outcome: "pass", at: AT },
  };

  // Passed through verbatim by both surfaces, so its SHAPE is the assertion rather than its meaning.
  const builds = [{ unitId: "cap-b", runId: "run-live", startedAt: AT, phase: "GREEN" }];

  /** Write the shared `stories/` tree into one arm's fixture directory. */
  const writeStories = (dir: string): void => {
    // `uatLegs` is the number of criteria this body is authored to carry; the write refuses a body
    // that does not parse into exactly that many. See `assertCriteriaParse` for why a silent
    // refusal here would make the whole arm a vacuous pass.
    const story = (id: string, body: string, uatLegs = 0): void => {
      assertCriteriaParse(id, body, uatLegs);
      mkdirSync(join(dir, "stories", id), { recursive: true });
      writeFileSync(join(dir, "stories", id, "story.md"), body, "utf8");
    };
    const capability = (storyId: string, capId: string, body: string): void => {
      writeFileSync(join(dir, "stories", storyId, `${capId}.md`), body, "utf8");
    };

    story(
      "alpha",
      [
        "---",
        'id: "alpha"',
        "tier: story",
        'title: "Alpha - the full shape"',
        'outcome: "the alpha outcome"',
        "status: proposed",
        "proof_mode: UAT",
        "capabilities: [cap-a, cap-b, cap-gone]",
        "depends_on: [charlie]",
        "consumed_by: [bravo]",
        "decisions: [445, 443]",
        "---",
        "",
        "# Alpha",
        "",
        "## Story UAT",
        "",
        criterion(1, C_ONE, CRITERION_ONE),
        criterion(2, C_TWO, CRITERION_TWO),
        "",
        "## Reliability Gates",
        "",
        "1. **The suite is green** _(gate: observe)_ _(covers: cap-b)_ `pnpm test`.",
        "2. **The withdrawn gate** _(gate: observe)_ _(retired)_ `pnpm gone`. Its ordinal is burned",
        "   on purpose (ADR-0436) — it must leave BOTH the obligation union and the coverage set.",
      ].join("\n"),
      2,
    );
    capability(
      "alpha",
      "cap-a",
      [
        "---",
        'id: "cap-a"',
        "tier: capability",
        'title: "Capability A"',
        'outcome: "the cap-a outcome"',
        "status: proposed",
        "proof_mode: contract-test",
        "depends_on: [cap-b]",
        "---",
        "",
        "# Capability A",
        "",
        "## Contracts",
        "",
        // The bold CODE-SPAN id is what makes a numbered line a contract (`parseContracts` skips a
        // stray list item), and `testCount` is `spec.contracts.length`. Authored without the
        // backticks these parsed as nothing, both walks answered `testCount: 0`, and the control
        // that re-seeds a `testCount` defect PASSED — a fixture arm that proved nothing while
        // looking like it did. Kept as a note because the shape is not obvious from the field name.
        "1. **`cap-a-first`** — it holds.",
        "2. **`cap-a-second`** — it holds too.",
      ].join("\n"),
    );
    capability(
      "alpha",
      "cap-b",
      [
        "---",
        'id: "cap-b"',
        "tier: capability",
        'title: "Capability B"',
        'outcome: "the cap-b outcome"',
        "status: mapped",
        "proof_mode: integration-test",
        "---",
        "",
        "# Capability B",
      ].join("\n"),
    );
    // `cap-gone.md` is DELIBERATELY absent — both walks must render `error: spec file missing`.

    story(
      "bravo",
      [
        "---",
        'id: "bravo"',
        "tier: story",
        'title: "Bravo - the render hints"',
        'outcome: "the bravo outcome"',
        "status: proposed",
        "proof_mode: UAT",
        "uat_witness: machine",
        "render: building",
        "capabilities: [cap-c]",
        "---",
        "",
        "# Bravo",
      ].join("\n"),
    );
    capability(
      "bravo",
      "cap-c",
      [
        "---",
        'id: "cap-c"',
        "tier: capability",
        'title: "Capability C"',
        'outcome: "the cap-c outcome"',
        "status: healthy",
        "proof_mode: contract-test",
        "---",
        "",
        "# Capability C",
      ].join("\n"),
    );

    story(
      "charlie",
      [
        "---",
        'id: "charlie"',
        "tier: story",
        'title: "Charlie - the ordinary story"',
        'outcome: "the charlie outcome"',
        "status: proposed",
        "proof_mode: UAT",
        "---",
        "",
        "# Charlie",
      ].join("\n"),
    );

    // A frontmatter block the spec loader cannot read — both walks take the catch branch.
    story("delta", ["---", "id: [unclosed", "tier: story", "---", "", "# Delta"].join("\n"));

    story(
      "echo",
      [
        "---",
        'id: "echo"',
        "tier: story",
        'title: "Echo - the aspirational legs"',
        'outcome: "the echo outcome"',
        "status: proposed",
        "proof_mode: UAT",
        "---",
        "",
        "# Echo",
        "",
        "## UAT Test Criteria (would-be)",
        "",
        criterion(1, C_WOULD_BE, CRITERION_WOULD_BE),
      ].join("\n"),
      1,
    );

    // A directory with no `story.md`, and a file at the stories root: both walks must SKIP each.
    mkdirSync(join(dir, "stories", "no-story"), { recursive: true });
    writeFileSync(join(dir, "stories", "no-story", "README.md"), "# not a story\n", "utf8");
    writeFileSync(join(dir, "stories", "loose.md"), "# a loose file\n", "utf8");
  };

  /**
   * The live arm's projection. Authored SEPARATELY from the `stories/` tree above rather than
   * derived from it, and deliberately: deriving it would make this arm's input a function of the
   * very walk it exists to be independent of. What the two surfaces must agree on here is how they
   * fold ONE snapshot, never whether a snapshot matches a directory.
   */
  const snapshot = {
    schemaVersion: 1,
    commitSha: "fe".repeat(20),
    storiesTreeSha: "ab".repeat(20),
    generatedAt: AT,
    generator: "check:mirror-conformance fixture",
    stories: [
      {
        id: "alpha",
        title: "Alpha - the full shape",
        outcome: "the alpha outcome",
        status: "proposed",
        proofMode: "UAT",
        uatWitness: "human",
        dependsOn: ["charlie"],
        consumedBy: ["bravo"],
        decisions: [445, 443],
        building: false,
        capabilities: ["cap-a", "cap-b", "cap-gone"],
        uatTestCriteria: [
          {
            id: "alpha#uat-1",
            criterionId: C_ONE,
            revisionId: revisionOf(1, CRITERION_ONE),
            source: `1. ${CRITERION_ONE}`,
            title: "The map paints from proof",
            witness: "either",
            wouldBe: false,
          },
        ],
        reliabilityGates: [
          {
            id: "alpha#gate-1",
            title: "The suite is green",
            kind: "observe",
            covers: ["cap-b"],
            proofCommand: "pnpm test",
            retired: false,
          },
          {
            id: "alpha#gate-2",
            title: "The withdrawn gate",
            kind: "observe",
            covers: [],
            proofCommand: "pnpm gone",
            retired: true,
          },
        ],
      },
      {
        id: "bravo",
        title: "Bravo - the render hints",
        outcome: "the bravo outcome",
        status: "proposed",
        proofMode: "UAT",
        uatWitness: "machine",
        dependsOn: [],
        consumedBy: [],
        decisions: [],
        building: true,
        capabilities: ["cap-c"],
        uatTestCriteria: [],
        reliabilityGates: [],
      },
      {
        // The projection's own `error` node — a spec the loader could not read, CARRIED rather than
        // dropped so the store and the disk read agree about it.
        id: "delta",
        title: "delta",
        outcome: "",
        status: null,
        proofMode: "",
        uatWitness: null,
        dependsOn: [],
        consumedBy: [],
        decisions: [],
        building: false,
        capabilities: [],
        uatTestCriteria: [],
        reliabilityGates: [],
        error: "frontmatter did not parse",
      },
    ],
    capabilities: [
      {
        id: "cap-a",
        storyId: "alpha",
        title: "Capability A",
        outcome: "the cap-a outcome",
        status: "proposed",
        proofMode: "contract-test",
        dependsOn: ["cap-b"],
        contractCount: 2,
      },
      {
        id: "cap-b",
        storyId: "alpha",
        title: "Capability B",
        outcome: "the cap-b outcome",
        status: "mapped",
        proofMode: "integration-test",
        dependsOn: [],
        contractCount: 0,
      },
      {
        id: "cap-gone",
        storyId: "alpha",
        title: "cap-gone",
        outcome: "",
        status: null,
        proofMode: "",
        dependsOn: [],
        contractCount: 0,
        error: "spec file missing",
      },
      {
        id: "cap-c",
        storyId: "bravo",
        title: "Capability C",
        outcome: "the cap-c outcome",
        status: "healthy",
        proofMode: "contract-test",
        dependsOn: [],
        contractCount: 0,
      },
    ],
  };

  const arm = (
    label: string,
    hierarchy: unknown,
    proof: { latestVerdicts: unknown; verdictEvents: unknown; builds: unknown },
  ) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeStories(dir);
    writeFileSync(join(dir, "tree.json"), JSON.stringify({ hierarchy, ...proof, requests }), "utf8");
    return { label: `tree-${label}`, arg: dir };
  };

  const proven = { latestVerdicts, verdictEvents, builds };
  return {
    dir: root,
    inputs: [
      arm("disk", { source: "empty" }, proven),
      arm("live", { source: "live", snapshot }, proven),
      // The advisory-absence arm: no projection seam at all, and every proof layer silent.
      arm("absent", { source: "absent" }, { latestVerdicts: null, verdictEvents: null, builds: null }),
    ],
  };
}

/**
 * The `attestations-fixtures` input set: two synthetic fixture DIRECTORIES, each a `stories/` tree
 * plus an `attestations.json` carrying the two event streams the route joins and the request list
 * both probes replay.
 *
 * WHY THE FIXTURE CARRIES RAW EVENTS RATHER THAN A MARKS MAP. The two surfaces draw their store seam
 * at DIFFERENT levels: the studio's backend method `listAttestations` folds `events.attestation`
 * through `deriveAttestations`, while the desktop folds the raw stream inside the route itself.
 * Supplying one raw stream and letting each probe present it at its own surface's level is what
 * keeps the comparison on the ROUTE composition — the layer mismatch that manufactured a false
 * finding on `/api/health` one increment earlier is exactly this shape.
 *
 * WHY THESE REQUESTS. Each isolates something the two surfaces decide SEPARATELY:
 *   · a story with legs, marks and signed verdicts — the ordinary row assembly, plus `storyUat`;
 *   · a story with legs and NO marks, so a row that invented an empty `human`/`machine` key would
 *     show up against one that omits them;
 *   · an UNKNOWN story — the empty answer, which must be a 200 with no legs rather than a 404;
 *   · a MISSING and a BLANK `storyId` — the 400 that makes the parameter required, and the fact that
 *     `""` and absent are the same answer;
 *   · an id that ESCAPES the stories root. The studio refuses it through `containedPath` and answers
 *     exactly as if the story were missing; a surface that resolved it instead would be a filesystem
 *     existence oracle carrying limited structured disclosure, and the tell is that its answer
 *     DIFFERS from the absent one;
 *   · a CAPABILITY id where a story id belongs — this route's vocabulary is stories, and a surface
 *     that fell back to `<story>/<capId>.md` would answer a question nobody asked;
 *   · a method NEITHER surface serves (`DELETE`), so the 405 guard is compared.
 *
 * ⚠ NO `POST` IS REPLAYED, and that is a decision rather than an omission. The studio's POST RECORDS
 * an attestation (201); the desktop deliberately serves none and answers 405. That is a real,
 * sanctioned difference — the `/api/me` shape — so replaying it would red this row forever on a
 * correct answer. The row proves the READ pair; the write half has no mirror to be unequal to.
 *
 * WHY TWO ARMS. `attestations-proven` carries both streams, so the `proven` column and the story
 * rollup are inside the comparison. `attestations-silent` wires `verdictEvents: null` and an EMPTY
 * attestation log — the advisory-absence arm, and the only thing that catches a mirror emitting
 * `storyUat: null` where its reference omits the key entirely. Absence is what the renderer keys on,
 * so a surface that answered a null where the other answered nothing would drive the SAME compiled
 * component into a different state.
 */
function buildAttestationsFixtures() {
  const root = mkdtempSync(join(tmpdir(), "storytree-attestations-"));

  const requests = [
    { label: "read", method: "GET", path: "/api/attestations?storyId=alpha" },
    { label: "read-no-marks", method: "GET", path: "/api/attestations?storyId=bravo" },
    { label: "read-unknown", method: "GET", path: "/api/attestations?storyId=no-such-story" },
    { label: "read-no-id", method: "GET", path: "/api/attestations" },
    { label: "read-blank-id", method: "GET", path: "/api/attestations?storyId=" },
    // Percent-encoded, so the guard is asked about a path that would ESCAPE the stories root.
    { label: "read-escaping-id", method: "GET", path: "/api/attestations?storyId=..%2Fescaped" },
    // A capability id where a story id belongs.
    { label: "read-capability-id", method: "GET", path: "/api/attestations?storyId=cap-a" },
    // A method neither surface serves — the shared 405 guard.
    { label: "unsupported-method", method: "DELETE", path: "/api/attestations?storyId=alpha" },
  ];

  const AT = "2026-08-31T09:30:00.000Z";
  const A_ONE = `uatc_${"a".repeat(23)}1`;
  const A_TWO = `uatc_${"a".repeat(23)}2`;
  const B_ONE = `uatc_${"b".repeat(23)}1`;
  const CAP_ONE = `uatc_${"c".repeat(23)}1`;
  const ESCAPED_ONE = `uatc_${"e".repeat(23)}1`;

  const LEG_ONE = "**The panel opens** — clicking a story shows its legs.";
  const LEG_TWO = "**The mark lands** — an operator vouch appears against the leg.";
  const LEG_BRAVO = "**Bravo's only leg** — it holds.";
  const LEG_CAP = "**A capability's own leg** — this route must never serve it.";
  const LEG_ESCAPED = "**A leg outside the root** — reaching it at all is the whole defect.";

  /** One authored criterion line; `detail` attaches the optional ADR-0209 D7 Library pointer. */
  const criterion = (
    ordinal: number,
    criterionId: string,
    prose: string,
    detail?: string,
  ): string => authoredCriterion(ordinal, criterionId, prose, detail);
  /** The same line's computed `(revision-id:)` — what a signed verdict and a vouch must carry. */
  const revisionOf = (ordinal: number, prose: string, detail?: string): string =>
    criterionRevision(ordinal, prose, detail);

  /** A recorded vouch, parsed so a malformed fixture fails HERE rather than folding to nothing. */
  const mark = (seq: number, criterionId: string, revisionId: string, witness: "human" | "machine") => ({
    seq,
    doc: Attestation.parse({
      testId: criterionId,
      criterionId,
      revisionId,
      outcome: "pass",
      witness,
      signer: "operator@example.com",
      at: AT,
      note: `witnessed by ${witness}`,
    }),
  });

  /** A signed criterion verdict — the PROVEN column, deliberately distinct from a vouch (ADR-0044). */
  const signed = (seq: number, criterionId: string, revisionId: string, outcome: "pass" | "fail") => ({
    kind: "signing",
    seq,
    doc: Verdict.parse({
      unitId: criterionId,
      criterionId,
      revisionId,
      proofMode: "story",
      outcome,
      commitSha: "da".repeat(20),
      signer: "ci@example.com",
      runId: `run-att-${seq}`,
      at: AT,
    }),
  });

  const writeStories = (dir: string): void => {
    // `uatLegs` is the number of criteria this body is authored to carry; the write refuses a body
    // that does not parse into exactly that many. See `assertCriteriaParse` for why a silent
    // refusal here would make the whole arm a vacuous pass.
    const story = (id: string, body: string, uatLegs = 0): void => {
      assertCriteriaParse(id, body, uatLegs);
      mkdirSync(join(dir, "stories", id), { recursive: true });
      writeFileSync(join(dir, "stories", id, "story.md"), body, "utf8");
    };
    story(
      "alpha",
      [
        "---",
        'id: "alpha"',
        "tier: story",
        'title: "Alpha"',
        'outcome: "the alpha outcome"',
        // PAST `mapped`, so the "no `either` at rest" guard is live and `unresolvedWitnesses` can
        // actually be populated. A still-mapped story would leave that field empty on both sides and
        // the guard uncompared.
        "status: proposed",
        "proof_mode: UAT",
        "capabilities: [cap-a]",
        "---",
        "",
        "# Alpha",
        "",
        "## Story UAT",
        "",
        // Leg one declares a `(detail: …)` pointer, leg two does not — so the comparison sees both a
        // row that carries `detailArtifactId` and one that must not invent the key.
        criterion(1, A_ONE, LEG_ONE, "alpha#detail-1"),
        criterion(2, A_TWO, LEG_TWO),
      ].join("\n"),
      2,
    );
    // A capability spec beside it: `?storyId=cap-a` must resolve to NOTHING on this route.
    writeFileSync(
      join(dir, "stories", "alpha", "cap-a.md"),
      [
        "---",
        'id: "cap-a"',
        "tier: capability",
        'title: "Capability A"',
        'outcome: "the cap-a outcome"',
        "status: proposed",
        "proof_mode: contract-test",
        "---",
        "",
        "# Capability A",
        "",
        // A capability spec carrying its OWN criteria. Unusual to author, and the point: without
        // legs on this file the two surfaces resolve `?storyId=cap-a` to DIFFERENT files and answer
        // identically anyway, so the difference reaches no wire and the arm proves nothing about it.
        "## UAT Test Criteria",
        "",
        authoredCriterion(1, CAP_ONE, LEG_CAP),
      ].join("\n"),
      "utf8",
    );
    story(
      "bravo",
      [
        "---",
        'id: "bravo"',
        "tier: story",
        'title: "Bravo"',
        'outcome: "the bravo outcome"',
        "status: proposed",
        "proof_mode: UAT",
        "---",
        "",
        "# Bravo",
        "",
        "## Story UAT",
        "",
        criterion(1, B_ONE, LEG_BRAVO),
      ].join("\n"),
      1,
    );
    // A REAL story.md one level ABOVE `stories/`, so `?storyId=../escaped` names something that
    // genuinely exists and genuinely parses. An escaping id must still read exactly like a missing
    // story — the whole point of the guard is that the refusal cannot be told apart from an absence,
    // so the target has to be real, or the arm proves only that the path was empty.
    mkdirSync(join(dir, "escaped"), { recursive: true });
    const escaped = [
      "---",
      'id: "escaped"',
      "tier: story",
      'title: "Outside the stories root"',
      'outcome: "must never be served"',
      "status: proposed",
      "proof_mode: UAT",
      "---",
      "",
      "# Escaped",
      "",
      // It carries a LEG on purpose. With none, the escaped story reaches the wire as an empty
      // `tests` list — indistinguishable from the refusal — so the arm would pass whether the
      // containment guard held or not. Content is what makes an escape observable.
      "## UAT Test Criteria",
      "",
      authoredCriterion(1, ESCAPED_ONE, LEG_ESCAPED),
    ].join("\n");
    assertCriteriaParse("escaped", escaped, 1);
    writeFileSync(join(dir, "escaped", "story.md"), escaped, "utf8");
  };

  const arm = (
    label: string,
    attestationEvents: unknown[],
    verdictEvents: unknown[] | null,
  ) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeStories(dir);
    writeFileSync(
      join(dir, "attestations.json"),
      JSON.stringify({ attestationEvents, verdictEvents, requests }),
      "utf8",
    );
    return { label: `attestations-${label}`, arg: dir };
  };

  return {
    dir: root,
    inputs: [
      arm(
        "proven",
        [
          mark(1, A_ONE, revisionOf(1, LEG_ONE), "human"),
          mark(2, A_ONE, revisionOf(1, LEG_ONE), "machine"),
          // A mark for a leg on ANOTHER story — the join must leave it out of alpha's rows.
          mark(3, B_ONE, revisionOf(1, LEG_BRAVO), "human"),
        ],
        [
          signed(1, A_ONE, revisionOf(1, LEG_ONE), "pass"),
          // Proven and then REGRESSED, so the `fail` branch of `proven` is exercised too.
          signed(2, A_TWO, revisionOf(2, LEG_TWO), "pass"),
          signed(3, A_TWO, revisionOf(2, LEG_TWO), "fail"),
        ],
      ),
      // The advisory-absence arm: an empty vouch log and NO verdict stream at all.
      arm("silent", [], null),
    ],
  };
}

/**
 * The `uat-attest-fixtures` input set: ONE fixture DIRECTORY — a `stories/` tree, an escaped story
 * OUTSIDE it, and `attest.json` carrying the injected sign inputs plus the request list both probes
 * replay as POST bodies.
 *
 * THE ONLY WRITE PAIR IN THIS HARNESS (ADR-0495), and the reason it needs no database: each probe
 * wires its surface's own PERSISTENCE SEAM to a CAPTURE — the studio's `signUatVerdict` backend
 * method, the desktop's injected `ForestWriter` — and prints what that surface COMPOSED. The
 * `MIRRORS` row carries the full argument; the two facts that shape THIS fixture are:
 *
 *   · THE SIGN INPUTS RIDE THE FIXTURE, injected identically into both surfaces. Where a signer or a
 *     commit comes from is correctly different on the two surfaces (a verified IAP caller against a
 *     resolved local operator; a served deployment against a local checkout), so a fixture that let
 *     each surface resolve its own would compare two identity providers instead of the composition
 *     under test. The sign CLOCK rides it for a harder reason: the two probes are separate processes
 *     at different moments, so a wall-clock `at` is nondeterminism ACROSS the payloads being
 *     compared — the trap `floor-health-fixtures` records, and the reason both surfaces take an
 *     injected sign time.
 *
 *   · `clean: true` ON EVERY ARM. The desktop refuses to attest a dirty working tree and the studio
 *     has no such wall — correctly, since a studio member cannot dirty the deployment they observe.
 *     A dirty arm would have one surface compose a whole verdict where the other composes nothing,
 *     which is a divergence in the ENTRY SET and would need the arm exempted wholesale. The wall is
 *     proved by `apps/desktop/src/backend/local-uat-attest.test.ts` instead; the row's
 *     `correctDifferences` records that as a `fenced-elsewhere` clause rather than leaving it silent.
 *
 * THE SEVEN ARMS, each here for one thing the two wrappers decide separately:
 *   - `sign-human-pass` — the ordinary signature: an explicit `human` leg, a note carrying padding
 *     (both surfaces trim it, and a non-blank note rides as evidence), outcome `pass`;
 *   - `sign-either-fail` — an `either` leg with NO note and outcome `fail`, so the evidence-without-
 *     note branch and the failing outcome are both composed. It is also the arm on the one axis where
 *     the two surfaces feed the trust guard DIFFERENTLY: the studio hands `checkUatProof` the
 *     DECLARED witness, the desktop the RESOLVED one. They agree today for all three declared values
 *     and would fork the moment `resolveWitness`'s asymmetric rule changed, which is exactly what a
 *     mirror row is for;
 *   - `refuse-machine-witness` — a `machine` leg bound to a real observe gate. The shared guard
 *     refuses on both: a click can never stand in for a machine proof (ADR-0082 d.2);
 *   - `refuse-sandbox-signer` — the same human leg signed by a `sandbox:` identity, refused on both
 *     by the shared no-self-attest wall (ADR-0007). The signer is overridden per-request, which is
 *     the only input this fixture varies between arms;
 *   - `refuse-missing-criterion` — a blank `criterionId`. BOTH surfaces answer with the IDENTICAL
 *     string, so this is the arm whose `refusedBecause` stays COMPARED — it is what keeps the
 *     refusal-wording exemption from being a blanket over every refusal;
 *   - `refuse-unknown-criterion` — an id the story does not declare: a typo must never mint a
 *     verdict against nothing;
 *   - `refuse-escaped-story` — `storyId: "../escaped"`, resolving to a REAL story with a REAL leg
 *     outside the stories root. Content is what makes an escape observable: against a story with no
 *     legs, a containment hole and a missing story both compose nothing and the arm would pass
 *     either way. This is the WRITE-side twin of the path-traversal the `/api/attestations` row
 *     measured on the read next door.
 */
function buildUatAttestFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "storytree-uat-attest-"));

  const AT = "2026-09-01T09:00:00.000Z";
  const COMMIT = "ab".repeat(20);
  const SIGNER = "operator@example.com";
  const C_HUMAN = `uatc_${"0".repeat(23)}1`;
  const C_EITHER = `uatc_${"0".repeat(23)}2`;
  const C_MACHINE = `uatc_${"0".repeat(23)}3`;
  const C_ESCAPED = `uatc_${"0".repeat(23)}4`;
  const C_UNKNOWN = `uatc_${"0".repeat(23)}9`;

  /**
   * One authored criterion LINE carrying CONTENT tags as well as prose.
   *
   * `canonicalUatCriterionContent` strips only the IDENTITY tags, so `(witness:)` and
   * `(proof-gate:)` are content and must be inside the text the revision is computed from — the same
   * trap `criterionItemText` records for `(detail:)`, which produced a vacuous arm before it was
   * fixed. A revision computed from the prose alone does not bind an item that carries a witness
   * tag, `parseUatTestCriteria` then refuses the whole story, and BOTH surfaces answer with no legs.
   */
  const tagged = (ordinal: number, criterionId: string, prose: string, tags: string): string => {
    const item = `${ordinal}. ${prose}${tags}`;
    const revision = criterionRevisionId(canonicalUatCriterionContent(item));
    return `${item} (criterion-id: ${criterionId})(revision-id: ${revision})`;
  };

  const HUMAN_LEG = "**The crown greens from a look** — an operator sees the map paint and signs.";
  const EITHER_LEG = "**The undecided leg** — declared `either`, resolved toward the human.";
  const MACHINE_LEG = "**The machine leg** — a suite proves it, and no click ever can.";
  const ESCAPED_LEG = "**The leg outside the root** — reachable only through a containment hole.";

  const alpha = [
    "---",
    'id: "alpha"',
    "tier: story",
    'title: "Alpha - the signing surface"',
    'outcome: "the alpha outcome"',
    "status: proposed",
    "proof_mode: UAT",
    "---",
    "",
    "# Alpha",
    "",
    "## Story UAT",
    "",
    tagged(1, C_HUMAN, HUMAN_LEG, " _(witness: human)_ _(witness-basis: only a person can say the map reads right)_"),
    tagged(2, C_EITHER, EITHER_LEG, ""),
    tagged(3, C_MACHINE, MACHINE_LEG, " _(witness: machine)_ _(proof-gate: alpha#gate-1)_"),
    "",
    "## Reliability Gates",
    "",
    "1. **The suite is green** _(gate: observe)_ `pnpm test`.",
  ].join("\n");
  assertCriteriaParse("alpha", alpha, 3);
  mkdirSync(join(dir, "stories", "alpha"), { recursive: true });
  writeFileSync(join(dir, "stories", "alpha", "story.md"), alpha, "utf8");

  // OUTSIDE `stories/`, and carrying a real leg — see the `refuse-escaped-story` arm above.
  const escaped = [
    "---",
    'id: "escaped"',
    "tier: story",
    'title: "Escaped - outside the stories root"',
    'outcome: "the escaped outcome"',
    "status: proposed",
    "proof_mode: UAT",
    "---",
    "",
    "# Escaped",
    "",
    "## Story UAT",
    "",
    tagged(1, C_ESCAPED, ESCAPED_LEG, " _(witness: human)_ _(witness-basis: a person must reach it)_"),
  ].join("\n");
  assertCriteriaParse("escaped", escaped, 1);
  mkdirSync(join(dir, "escaped"), { recursive: true });
  writeFileSync(join(dir, "escaped", "story.md"), escaped, "utf8");

  const requests = [
    {
      label: "sign-human-pass",
      body: {
        storyId: "alpha",
        criterionId: C_HUMAN,
        outcome: "pass",
        note: "   saw the crown green on the live map   ",
      },
    },
    { label: "sign-either-fail", body: { storyId: "alpha", criterionId: C_EITHER, outcome: "fail" } },
    {
      // THE FORGERY ARM. Its body carries a `signer` and a `commitSha` no surface may read: the
      // studio signs as the VERIFIED IAP caller and the desktop as its RESOLVED local operator, and
      // both pin the commit their own surface resolved. Neither field exists in either wire contract,
      // which is exactly why this arm is here — a wall nothing exercises is a wall nothing proves,
      // and a surface that started trusting either field would still compose a well-formed verdict
      // that every other arm agrees with. Measured: without this arm, seeding the desktop mount to
      // take its signer from the request body left the whole comparison GREEN.
      label: "sign-ignores-forged-fields",
      body: {
        storyId: "alpha",
        criterionId: C_HUMAN,
        outcome: "pass",
        signer: "forged@attacker.example",
        commitSha: "cd".repeat(20),
      },
    },
    { label: "refuse-machine-witness", body: { storyId: "alpha", criterionId: C_MACHINE, outcome: "pass" } },
    {
      label: "refuse-sandbox-signer",
      signer: "sandbox:agent-7",
      body: { storyId: "alpha", criterionId: C_HUMAN, outcome: "pass" },
    },
    { label: "refuse-missing-criterion", body: { storyId: "alpha", criterionId: "", outcome: "pass" } },
    { label: "refuse-unknown-criterion", body: { storyId: "alpha", criterionId: C_UNKNOWN, outcome: "pass" } },
    { label: "refuse-escaped-story", body: { storyId: "../escaped", criterionId: C_ESCAPED, outcome: "pass" } },
    // THE ARM THAT CAUGHT THIS ROW'S FIRST REAL DIVERGENCE, and the plainest request in the set: a
    // story id that is perfectly well-formed and simply does not exist. The desktop's mount paired
    // its containment guard with a BARE `loadNodeSpec`, which THROWS on a missing file, so an
    // ordinary typo'd story crashed the signing route there while the studio answered 400. Present
    // in `main` for as long as the route had existed, and invisible: the escaped-id arm above does
    // not reach it (a `../` id is refused before any file is opened), and nothing else could call
    // the mount at all. Fixed in the same landing by routing through the shared `loadStorySpec`.
    { label: "refuse-missing-story", body: { storyId: "nowhere", criterionId: C_HUMAN, outcome: "pass" } },
  ];

  writeFileSync(
    join(dir, "attest.json"),
    JSON.stringify({ signer: SIGNER, agentIdentity: "desktop-storytree", commitSha: COMMIT, clean: true, at: AT, requests }),
    "utf8",
  );

  return { dir, inputs: [{ label: "uat-attest", arg: dir }] };
}

function buildInputSets() {
  const docsFixture = buildDocsFixture();
  const activity = buildActivityFixtures();
  const claims = buildClaimsFixtures();
  const arcs = buildArcFixtures();
  const floorHealth = buildFloorHealthFixtures();
  const traversal = buildTraversalFixtures();
  const comments = buildCommentsFixtures();
  const tree = buildTreeFixtures();
  const attestations = buildAttestationsFixtures();
  const uatAttest = buildUatAttestFixtures();
  return {
    sets: {
      "docs-trees": [
        { label: "fixture", arg: docsFixture },
        { label: "docs/", arg: join(repoRoot, "docs") },
      ],
      "activity-fixtures": activity.inputs,
      "claims-fixtures": claims.inputs,
      "arc-fixtures": arcs.inputs,
      "floor-health-fixtures": floorHealth.inputs,
      "traversal-fixtures": traversal.inputs,
      "comments-fixtures": comments.inputs,
      "tree-fixtures": tree.inputs,
      "attestations-fixtures": attestations.inputs,
      "uat-attest-fixtures": uatAttest.inputs,
    },
    cleanup: () => {
      rmSync(docsFixture, { recursive: true, force: true });
      rmSync(activity.dir, { recursive: true, force: true });
      rmSync(claims.dir, { recursive: true, force: true });
      rmSync(arcs.dir, { recursive: true, force: true });
      rmSync(floorHealth.dir, { recursive: true, force: true });
      rmSync(traversal.dir, { recursive: true, force: true });
      rmSync(comments.dir, { recursive: true, force: true });
      rmSync(tree.dir, { recursive: true, force: true });
      rmSync(attestations.dir, { recursive: true, force: true });
      rmSync(uatAttest.dir, { recursive: true, force: true });
    },
  };
}

// ---------- probing ----------

/** A probe failure — reported as a conformance FAILURE, never as a skip. */
class ProbeError extends Error {}

/**
 * Decode one probe's payload for one input into comparable entries — the shape half of the
 * {@link MirrorInputSet} protocol.
 *
 * `activity-fixtures` probes print the route's response body VERBATIM and the projection happens
 * HERE, on the third party, so the two probes cannot drift in how they reshape what they measured.
 * A payload this cannot decode is a ProbeError — fail-closed, exactly like a probe that died.
 */
function decodePayload(probe: Probe, inputs: MirrorInputSet, payload: unknown, arg: string): Entry[] {
  switch (inputs) {
    case "docs-trees":
      if (!Array.isArray(payload)) throw new ProbeError(`${probe.file} returned no array for ${arg}`);
      return payload as Entry[];
    case "activity-fixtures":
      try {
        return projectActivityPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "arc-fixtures":
      try {
        return projectArcsPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "floor-health-fixtures":
      try {
        return projectFloorHealthPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "traversal-fixtures":
      try {
        return projectTraversalPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "comments-fixtures":
      try {
        return projectCommentsPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "tree-fixtures":
      try {
        return projectTreePayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "claims-fixtures":
      try {
        return projectClaimsPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "attestations-fixtures":
      try {
        return projectAttestationsPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
    case "uat-attest-fixtures":
      try {
        return projectUatAttestPayload(payload);
      } catch (err) {
        throw new ProbeError(`${probe.file} returned an unusable payload for ${arg}: ${(err as Error).message}`);
      }
  }
}

/**
 * Run one surface's probe over every input, in that surface's own app dir so its bare
 * specifiers resolve through its own `node_modules`. Returns the decoded `{ input: Entry[] }` map.
 */
function runProbe(probe: Probe, inputs: MirrorInputSet, args: string[]) {
  const file = join(repoRoot, probe.file);
  if (!existsSync(file)) throw new ProbeError(`probe module not found: ${probe.file}`);

  // `--import tsx` is NODE's loader flag and this probe is a tsx-transpiled TS module, so the
  // binary is named rather than inferred: under a bun-run CLI `process.execPath` would be bun,
  // which reads `--import` as something else entirely (`bun-runtime-migration-arc` inc-11).
  const result = spawnSync(nodeExecutable(), ["--import", "tsx", file, ...args], {
    cwd: join(repoRoot, probe.appDir),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error !== undefined) throw new ProbeError(`${probe.file} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ProbeError(
      `${probe.file} exited ${result.status ?? "(signal " + String(result.signal) + ")"}\n${result.stderr?.trim() ?? ""}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new ProbeError(`${probe.file} printed unparseable output:\n${result.stdout.slice(0, 500)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProbeError(`${probe.file} must print an object keyed by input`);
  }

  const out: Record<string, Entry[]> = {};
  for (const arg of args) {
    if (!(arg in (parsed as Record<string, unknown>))) {
      throw new ProbeError(`${probe.file} returned nothing for ${arg}`);
    }
    out[arg] = decodePayload(probe, inputs, (parsed as Record<string, unknown>)[arg], arg);
  }
  return out satisfies Record<string, Entry[]>;
}

// ---------- the live-corpus arm ----------

/**
 * The columns the live snapshot reads from `events.node_claim` — the SAME seven the desktop's
 * `CLAIM_ROW_COLUMNS` builds its query from, declared again here rather than imported.
 *
 * THE COPY IS SOUND, AND FOR A REASON THAT DOES NOT GENERALISE. `packages/cli` may not import
 * `apps/desktop` (ADR-0176 / `check:boundaries`), so a shared constant is not available; and a copy
 * that DRIFTED could not manufacture a false red, because both probes are handed the SAME rows. A
 * column missing here reaches both folds as an absent field and both normalise it identically —
 * the arm would narrow silently, never lie. It is the one place in this file where a hand-copy is
 * safe, and the narrowing is what the printed row count makes visible.
 *
 * NO STALENESS FILTER, deliberately: the fold is what is under test, and dropping an aged-out row
 * is one of its branches. Filtering in SQL would decide that branch upstream of the assertion —
 * the same mistake as injecting already-folded claims.
 */
const LIVE_CLAIM_ROW_COLUMNS = [
  "unit_id",
  "session_id",
  "grade",
  "branch",
  "intent",
  "claimed_at",
  "heartbeat_at",
] as const;

/** One live-arm snapshot: the fixture both probes fold, and how many real rows it carries. */
interface LiveSnapshot {
  readonly dir: string;
  readonly path: string;
  readonly rows: number;
}

/**
 * Read the real `events.node_claim` ledger ONCE and write it as an ordinary `activity-fixtures`
 * fixture — raw rows plus a FIXED `now`, the shape both probes already consume unchanged.
 *
 * `builds` and `departures` ride as `null`. That is the ADVISORY-ABSENCE value, not a gap: the
 * desktop's builds fold is inline inside a `pg` closure in `apps/desktop/electron/backend-entry.ts`
 * and cannot be reached without that surface opening a connection, and `departures` is shared
 * `@storytree/notice-board` code with no drift class. The claim fold is the one this arm is for.
 *
 * THROWS on an unreachable store, and the caller turns that into a LOUD failure. There is no
 * fallback to the synthetic fixtures by design: a check that quietly compared something else would
 * report health for the comparison it did not make (ADR-0302's lesson).
 */
async function snapshotLiveActivity(): Promise<LiveSnapshot> {
  // Loaded lazily so `--arm fixtures` never pulls `pg` or the Cloud SQL connector into the process
  // at all — that arm holds no credential and must stay able to run where none exists.
  const { createPool, closePool } = await import("@storytree/library/store");
  const handle = await createPool();
  let claimRows: unknown[];
  try {
    const result = await handle.pool.query(
      `SELECT ${LIVE_CLAIM_ROW_COLUMNS.join(", ")} FROM events.node_claim`,
    );
    claimRows = result.rows as unknown[];
  } finally {
    await closePool(handle.pool, handle.connector);
  }

  const dir = mkdtempSync(join(tmpdir(), "storytree-activity-live-"));
  const path = join(dir, "activity-live-corpus.json");
  writeFileSync(
    path,
    JSON.stringify({ now: new Date().toISOString(), claimRows, builds: null, departures: null }),
    "utf8",
  );
  return { dir, path, rows: claimRows.length };
}

/**
 * `--arm live`: the `/api/activity` pair over the real ledger. One row, one input, and the same
 * comparison rules the fixture arm uses — the only thing that changes is where the rows came from.
 */
async function runLiveArm(): Promise<void> {
  const target = MIRRORS.find((m) => m.inputs === "activity-fixtures");
  if (target === undefined) {
    // Fail CLOSED: the registry moved under this arm and it has nothing to run. Reporting a pass
    // would make it a step that cannot fail.
    console.error("✗ live mirror conformance: no registered pair uses `activity-fixtures`");
    process.exit(1);
  }
  const { spec } = target;

  let snapshot: LiveSnapshot;
  try {
    snapshot = await snapshotLiveActivity();
  } catch (err) {
    console.error(
      `✗ live mirror conformance: the live store did not answer — ${(err as Error).message}\n\n` +
        "This arm folds the REAL `events.node_claim` ledger through both surfaces, so an\n" +
        "unreachable store means the comparison did not happen. It fails rather than falling back\n" +
        "to the synthetic fixtures, which would report health for a check that verified nothing\n" +
        "(ADR-0302). Bring the store up (`pnpm db:up`) and re-run; in CI this step sits below the\n" +
        "keyless-WIF auth step and carries STORYTREE_DB_USER.",
    );
    process.exit(1);
  }

  try {
    let reference: Record<string, Entry[]>;
    let mirror: Record<string, Entry[]>;
    try {
      reference = runProbe(target.reference, target.inputs, [snapshot.path]);
      mirror = runProbe(target.mirror, target.inputs, [snapshot.path]);
    } catch (err) {
      console.error(`✗ ${spec.surface}: probe failure — ${(err as Error).message}`);
      process.exit(1);
    }

    const ref = reference[snapshot.path] ?? [];
    const mir = mirror[snapshot.path] ?? [];
    if (ref.length === 0) {
      console.error(
        `✗ ${spec.surface}: ${spec.reference} returned an EMPTY payload for live-corpus — ` +
          "a vacuous comparison is not a pass",
      );
      process.exit(1);
    }

    const divergences: Divergence[] = compareMirrors(ref, mir, spec, "live-corpus");
    if (divergences.length > 0) {
      console.error(`\n✗ live mirror conformance: the two surfaces fold the real ledger differently\n`);
      console.error(`${formatDivergences(spec, divergences)}\n`);
      process.exit(1);
    }

    console.log(
      `✓ ${spec.surface}: ${spec.mirror} matches ${spec.reference} over live-corpus ` +
        `(${snapshot.rows} claim row(s), ${ref.length} entries)`,
    );
    if (snapshot.rows === 0) {
      // NARROWED, not skipped — and not red either. The envelope WAS compared (the three `layer:`
      // markers), so this arm did real work; what it could not reach is the fold, because the
      // ledger holds nothing to fold. An empty ledger is an honest state of the world — nobody is
      // working — so failing here would be a false red, and staying silent would let a comparison
      // that touched no row read as one that did. Same posture as `check:ground-space`'s narrowing.
      console.log(
        "  NARROWED — the live ledger held ZERO claim rows, so only the envelope was compared;\n" +
          "  no grade, back-compat or staleness branch of either fold was exercised by this arm.\n" +
          "  The synthetic arms in `pnpm check:mirror-conformance` cover those and always run.",
      );
    }
  } finally {
    rmSync(snapshot.dir, { recursive: true, force: true });
  }
}

// ---------- the check ----------

/**
 * Which arm to run. Unknown input REFUSES rather than defaulting: a typo'd `--arm liv` silently
 * running the fixture arm would report a green the live comparison never earned.
 */
function parseArm(argv: readonly string[]): "fixtures" | "live" {
  const i = argv.indexOf("--arm");
  if (i === -1) return "fixtures";
  const value = argv[i + 1];
  if (value === "fixtures" || value === "live") return value;
  console.error(`check:mirror-conformance: --arm expects \`fixtures\` or \`live\`, got ${String(value)}`);
  process.exit(2);
}

function runFixtureArm(): void {
  const { sets, cleanup } = buildInputSets();

  const failures: string[] = [];
  try {
    for (const target of MIRRORS) {
      const { spec } = target;
      const inputs = sets[target.inputs];
      const args = inputs.map((i) => i.arg);
      let reference: Record<string, Entry[]>;
      let mirror: Record<string, Entry[]>;
      try {
        reference = runProbe(target.reference, target.inputs, args);
        mirror = runProbe(target.mirror, target.inputs, args);
      } catch (err) {
        // Fail CLOSED: a probe that cannot run proves nothing, and reporting it as a pass would
        // make this gate exactly the kind of check that can never go red.
        failures.push(`✗ ${spec.surface}: probe failure — ${(err as Error).message}`);
        continue;
      }

      for (const { label, arg } of inputs) {
        const ref = reference[arg] ?? [];
        const mir = mirror[arg] ?? [];
        // Never vacuous: two empty payloads agree perfectly. Every input here is known non-empty,
        // so an empty reference means the probe read the wrong thing, not that the input is empty.
        // The advisory-absence activity fixture still projects its three `layer:` markers, so even
        // the all-null arm cannot pass by measuring nothing.
        if (ref.length === 0) {
          failures.push(
            `✗ ${spec.surface}: ${spec.reference} returned an EMPTY payload for ${label} (${arg}) — ` +
              "a vacuous comparison is not a pass",
          );
          continue;
        }
        const divergences: Divergence[] = compareMirrors(ref, mir, spec, label);
        if (divergences.length > 0) failures.push(formatDivergences(spec, divergences));
        else {
          console.log(
            `✓ ${spec.surface}: ${spec.mirror} matches ${spec.reference} over ${label} (${ref.length} entries)`,
          );
        }
      }
    }
  } finally {
    cleanup();
  }

  if (failures.length > 0) {
    console.error(`\n✗ cross-surface mirror conformance: ${failures.length} failing comparison(s)\n`);
    for (const f of failures) console.error(`${f}\n`);
    console.error(
      "A surface that re-composes another's route must serve the SAME payload. Re-compose the\n" +
        "missing logic verbatim into the mirror (never import the reference — ADR-0176), or, if the\n" +
        "difference is deliberate, declare it in packages/cli/src/mirror-conformance.ts: a field the\n" +
        "reference carries and the mirror does not goes in that row's `referenceOnlyFields`, and a\n" +
        "difference in VALUES goes in its `correctDifferences` — with the argument for why it is\n" +
        "correct, and under that rule's binding stopping condition (ADR-0495 D5).",
    );
    process.exit(1);
  }
  console.log("✓ cross-surface mirror conformance: every mirrored payload matches its reference");
}

/**
 * Run one arm. `argv` defaults to this process's own arguments; the gate's
 * `check-mirror-conformance-live.ts` passes `["--arm", "live"]`, which is why the run below is guarded.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (parseArm(argv) === "live") return runLiveArm();
  runFixtureArm();
}

// Run only when invoked directly, not when `check-mirror-conformance-live.ts` imports this module.
// Fail CLOSED on anything the arms did not catch themselves: an unhandled rejection that exited 0
// would be a conformance check reporting a pass it never computed.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(`✗ mirror conformance: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
