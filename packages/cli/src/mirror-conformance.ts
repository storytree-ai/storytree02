/**
 * The PURE judge behind `pnpm check:mirror-conformance` — the cross-surface conformance harness
 * (verification-integrity-arc increment 2).
 *
 * THE CLASS IT FENCES. storytree has surfaces that are REQUIRED to agree but are deliberately
 * forbidden to share code: the desktop backend re-composes a SUBSET of the studio's `/api/*` route
 * table verbatim over its own `node:fs`, and may never import `apps/studio/server` (ADR-0176's
 * one-wired-backend rule, enforced by `check:boundaries`). Duplication is the DECISION, not an
 * accident — so the drift it invites has to be caught by a test that compares the two payloads,
 * not by a convention that whoever edits one will remember the other.
 *
 * It went uncaught once, measurably: commit `71f68d2b` folded `parseAdrWireSignals` into the
 * studio's `listDocs` and left the desktop's copy alone. Over the real `docs/` tree that silently
 * dropped `loadBearing` from 88 ADRs and `references` from 168, and nothing anywhere went red —
 * the two implementations agreed with nothing, so their disagreement had no observer.
 *
 * WHY A JUDGE AND NOT AN IMPORT. The comparison never imports one surface from the other: the
 * gather ({@link file://./check-mirror-conformance.ts}) runs each surface's own probe in its own
 * process over ONE fixture and hands the two decoded payloads here. This module sees plain data
 * and owns every rule, so the rules are unit-testable without spawning anything.
 *
 * THE RULES (see {@link compareMirrors}):
 *   1. Same entries, same order — the payload is an ordered array and both sides sort it.
 *   2. Every field JSON-equal, except the ones on the spec's `referenceOnlyFields` allowlist.
 *   3. The allowlist is SELF-PRUNING: an entry the mirror actually emits, or one the reference
 *      never emits, is itself a divergence. An allowlist nobody prunes decays into a blanket
 *      exemption — the "an advisory list stays readable or stops being advisory" rule. The
 *      allowlist is where a DELIBERATE difference is declared, and declaring one costs a line
 *      someone has to keep true.
 */

/**
 * ONE DECLARED CORRECT DIFFERENCE between a mirrored pair — the written rule ADR-0495 D4 requires,
 * as DATA a later reader can argue with rather than as conditionals scattered through a judge.
 *
 * ⚠ IT CARRIES A BINDING TRIPWIRE (ADR-0495 D5). If a pair's list grows past roughly a HANDFUL of
 * clauses, STOP and raise it as its own question — do not push through to a green. A long list is
 * evidence that two paths which are required to agree have drifted further than anyone intends, and
 * encoding that drift here BLESSES it: the check then reports conformance over a pair it has mostly
 * exempted. The bar is semantic, not row-count — one difference expressed at four entry keys is ONE
 * clause, and {@link ExemptDifference.keys} is plural for that reason.
 *
 * Every clause states WHY the difference is correct, never merely that it is tolerated. The three
 * dispositions are the three honest things a harness can do about a difference, and only the first
 * changes what {@link compareMirrors} asserts:
 *  - `exempt` — the entries diverge and that is correct; the judge skips exactly the named keys, and
 *    the declaration SELF-PRUNES (a key that matches no entry, or whose two sides agree, is stale
 *    and reds — the same discipline {@link MirrorSpec.referenceOnlyFields} is held to);
 *  - `held-constant` — the difference is in an INPUT, and the fixture injects the same value on both
 *    sides so the comparison lands on what each surface DOES with it rather than on where it came
 *    from. Nothing is exempted, because nothing diverges;
 *  - `fenced-elsewhere` — the difference is a wall one surface has and the other correctly does not,
 *    so no arm of a fixture can compare it. {@link FencedDifference.provenBy} names the suite that
 *    DOES prove it, and a unit test asserts that file still exists — a clause pointing at a deleted
 *    module is a rule that has quietly stopped being true.
 */
export type CorrectDifference = ExemptDifference | HeldConstantDifference | FencedDifference;

/** The shared half of every clause: what differs, and why that is correct. */
interface DifferenceClaim {
  /** What differs, in one phrase. */
  difference: string;
  /** WHY it is correct — the argument, not the observation. */
  why: string;
}

/** A difference the judge SKIPS at named entry keys, and self-prunes when it stops being real. */
export interface ExemptDifference extends DifferenceClaim {
  disposition: "exempt";
  /**
   * The projected entry keys this clause covers, spelled exactly (`<label>#<jsonPath>`). Plural
   * because one difference can surface at several arms; each key self-prunes independently, so a
   * clause cannot keep an entry exempt after that entry stops diverging.
   */
  keys: readonly string[];
}

/** A difference in an INPUT, which the fixture holds constant so it never reaches the comparison. */
export interface HeldConstantDifference extends DifferenceClaim {
  disposition: "held-constant";
  /** How the fixture holds it constant — what both probes are handed. */
  how: string;
}

/** A wall one surface has and the other correctly does not — proved by that surface's own suite. */
export interface FencedDifference extends DifferenceClaim {
  disposition: "fenced-elsewhere";
  /** Repo-relative path of the suite that proves it. Asserted to exist by this module's tests. */
  provenBy: string;
}

/** One mirrored payload's conformance rules. */
export interface MirrorSpec {
  /** Human name of the mirrored payload, e.g. `GET /api/docs`. Used in the failure report. */
  surface: string;
  /**
   * The `/api/*` route path this payload is served at, spelled EXACTLY as both surfaces dispatch it.
   *
   * Machine-readable on purpose. `check:verification-decay`'s `mirror-pair-drift` instrument reads
   * this to know which pairs are already proven exactly here, so "what the registry covers" is
   * DERIVED from the registry rather than held as a second list somebody keeps in step. Two lists of
   * the same fact drifting apart is precisely the class this file exists to fence, and a discovery
   * heuristic that scraped the route out of {@link MirrorSpec.surface}'s prose would be that class
   * arriving inside the instrument built to detect it.
   */
  route: string;
  /**
   * FURTHER pathnames this same handler and this same probe pair dispatch — one payload family
   * reached through several dispatch strings.
   *
   * Added for `/api/traversal`, whose replay, index and occupancy reads are three paths served by
   * ONE mount over ONE fixture. Modelling them as three registry rows would have run the identical
   * probe pair three times to make the identical comparison, and left three near-duplicate rows to
   * keep in step — the duplication class this file exists to fence, arriving inside the registry.
   * The rows' PURPOSE is unchanged: `registeredMirrorRoutes` unions these with {@link route}, so
   * `mirror-pair-drift` still derives "what has an observer" from the registry and never from prose.
   *
   * ⚠ It is NOT an exception list. Every path named here is COMPARED by this row's probes; a path
   * the desktop deliberately does not serve has no place in it (and no pair, so no drift finding).
   */
  additionalRoutes?: readonly string[];
  /** The surface whose payload is the reference (the one being mirrored), e.g. `studio`. */
  reference: string;
  /** The surface holding the hand-written copy, e.g. `desktop`. */
  mirror: string;
  /** The field that identifies an entry on both sides, e.g. `id`. */
  key: string;
  /**
   * Fields the REFERENCE may carry that the mirror deliberately does not — the explicit,
   * self-pruning record of every sanctioned difference. Empty means the payloads must be
   * byte-identical.
   */
  referenceOnlyFields: readonly string[];
  /**
   * The written CORRECT-DIFFERENCE RULE for this pair (ADR-0495 D4) — every difference between the
   * two surfaces that is correct, each with the argument for why. Absent on a pair that has none,
   * which is most of them: the rows below whose `referenceOnlyFields` is empty by design have no
   * sanctioned difference at all, and an empty rule is the honest statement of that.
   *
   * ⚠ Read {@link CorrectDifference}'s tripwire before adding a clause.
   */
  correctDifferences?: readonly CorrectDifference[];
}

/** One surface's probe: the app dir it runs from, and the probe module it executes. */
export interface Probe {
  /** Repo-relative app dir — the spawn cwd, so bare specifiers resolve through THAT app. */
  appDir: string;
  /** Repo-relative probe module. */
  file: string;
}

/**
 * Which shared input set a mirror's two probes run over — and, with it, the SHAPE they print.
 * The two travel together because they are one protocol: {@link file://./check-mirror-conformance.ts}
 * builds the inputs, passes them as argv, and decodes what comes back.
 *
 * - `docs-trees` — argv is docs DIRECTORIES; each probe prints `DocMeta[]` per directory, already
 *   the comparable entry array.
 * - `activity-fixtures` — argv is fixture JSON PATHS (raw `events.node_claim` rows + a fixed `now`);
 *   each probe prints the route's response body VERBATIM, which
 *   {@link projectActivityPayload} turns into entries. The projection lives here, on the third
 *   party, so the two probes cannot drift in how they reshape what they measured.
 * - `claims-fixtures` — argv is fixture JSON PATHS (`{ claims, seamAbsent, requests }` — what the
 *   `sessionClaims` seam yields, plus the request list both probes replay). Each probe prints
 *   `{ [label]: { status, body } }`, which {@link projectClaimsPayload} turns into entries. The
 *   fixture injects at `sessionClaims` because that is exactly where the two surfaces stop sharing
 *   code: the query (`PgClaimStore.listAllClaims`) and the fold (`groupClaimsBySession`) are both
 *   shared package code, so what each surface writes for itself is the ENVELOPE — the 405, the
 *   advisory `{ sessions: null }`, and the `null`-versus-`[]` distinction.
 *
 *   ⚠ THE INJECTION SEAM IS ALSO THIS ROW'S BLIND SPOT, AND IT COST A REAL DEFECT. Because the
 *   fixture supplies the rows, WHICH store read each surface takes is invisible here: the studio
 *   dropped stale rows in SQL (`listLiveClaims`) for months while the CLI board kept them, and this
 *   harness stayed green throughout because both probes were handed the same fixture. ADR-0535 D1
 *   put both surfaces back on `listAllClaims`. Nothing below can hold them there — that is the
 *   surfaces' own doc comments' job, and it is why they say so loudly.
 *
 *   The rows' timestamps are minted by the harness at fixture-write time rather than written down,
 *   because neither route takes an injectable `now` — both call `groupClaimsBySession(claims,
 *   new Date())`. Fixed dates would age into staleness and silently stop exercising the live branch;
 *   minted ones sit far from the 2 h boundary in both directions, and both probes read the SAME
 *   bytes, so two processes running seconds apart cannot disagree about which rows are live.
 * - `arc-fixtures` — argv is fixture DIRECTORIES (a doc set, a `docs/decisions` tree and a
 *   `stories/` tree — the three inputs the arc rollup joins over — plus the REQUEST LIST both
 *   probes replay). Each probe prints `{ [label]: { status, body } }` for those requests, which
 *   {@link projectArcsPayload} turns into entries. The request list rides the FIXTURE rather than
 *   living in each probe: two hand-kept lists of what to ask is the same drift class one level up.
 * - `comments-fixtures` — argv is fixture JSON PATHS (`{ requests }` — the request list both probes
 *   replay). Each probe prints `{ [request]: { status, body } }` for those requests, which
 *   {@link projectCommentsPayload} turns into entries. The comment STORE is stubbed to ECHO the
 *   filter it is handed, on the same principle `activity-fixtures` feeds raw rows: what this route
 *   composes for itself is the query-string PARSE, so the parse is what the payload has to make
 *   visible. A fixture that returned a fixed comment list instead would compare two stores and stay
 *   green through a parse that disagreed.
 * - `tree-fixtures` — argv is fixture DIRECTORIES (a `stories/` tree plus `tree.json`, carrying the
 *   four reads the tree fold makes — the work-hierarchy seam and the three advisory proof layers —
 *   plus the request list both probes replay). Each probe prints `{ [label]: { status, body } }`,
 *   which {@link projectTreePayload} turns into entries. TWO inputs rather than one because this
 *   route's question has two sources: the live projection (ADR-0445 D1) and the disk walk behind it,
 *   and each surface re-composes BOTH independently — so a fixture that supplied only one would
 *   leave half the pair uncompared.
 *
 *   The proof layers ride the fixture ALREADY SHAPED (a verdict map, a raw signing-event stream, a
 *   build list) for the reason `activity-fixtures` carries raw claim rows: they are the INPUT, and
 *   what is under test is each surface's fold OF them. The verdict events are real signed `Verdict`
 *   documents, because the shared rollup compute parses them and a shape it rejects grants nothing —
 *   a fixture of plausible-looking stubs would leave every crown grey on both surfaces and compare
 *   two blanks.
 * - `attestations-fixtures` — argv is fixture DIRECTORIES (a `stories/` tree plus the RAW
 *   `events.attestation` and `events.verdict` streams the route joins, and the request list both
 *   probes replay). Each probe prints `{ [label]: { status, body } }`, which
 *   {@link projectAttestationsPayload} turns into entries. The streams are RAW because the two
 *   surfaces draw their store seam at different LEVELS — the studio's backend method folds
 *   `events.attestation` through `deriveAttestations`, the desktop folds it inside the route — so
 *   supplying one raw stream and letting each probe present it at its own surface's level is what
 *   keeps the comparison on the route composition rather than on where the seam was drawn. That
 *   layer mismatch is precisely what manufactured a false finding on `/api/health`.
 * - `uat-attest-fixtures` — argv is fixture DIRECTORIES (a `stories/` tree plus `attest.json`,
 *   carrying the injected sign inputs — signer, agent identity, commit, clean flag, sign clock — and
 *   the request list both probes replay as POST bodies). Each probe prints
 *   `{ [label]: { composed, refusedBecause } }`, which {@link projectUatAttestPayload} turns into
 *   entries. THE ONLY WRITE PAIR IN THIS REGISTRY, and the one input set whose probes capture at a
 *   PERSISTENCE SEAM rather than replaying a read: the studio's capturing `signUatVerdict` backend
 *   and the desktop's capturing `ForestWriter` (ADR-0495 D3). The sign inputs ride the fixture
 *   because they are each surface's own INPUT — where an identity or a commit comes from is
 *   correctly different on the two surfaces, and what each surface DOES with it is what must agree.
 *
 * - `floor-health-fixtures` — argv is fixture JSON PATHS (`{ docs, events, requests }` — the two
 *   reads the floor-health composition makes, plus the request list both probes replay). Each probe
 *   prints `{ [label]: { status, body } }`, which {@link projectFloorHealthPayload} turns into
 *   entries. The docs and events are served VERBATIM by each probe's own fixture store, because the
 *   `Store` seam's `appendEvent` accepts no `at`: a store that recorded them would stamp the wall
 *   clock, which both defeats the fixture (every reinforcement reads as pre-route) and makes the two
 *   probes — separate processes, different moments — nondeterministic against each other.
 */
export type MirrorInputSet =
  | "docs-trees"
  | "activity-fixtures"
  | "claims-fixtures"
  | "arc-fixtures"
  | "floor-health-fixtures"
  | "traversal-fixtures"
  | "comments-fixtures"
  | "tree-fixtures"
  | "attestations-fixtures"
  | "uat-attest-fixtures";

/** One registered mirrored payload: the rules, the input protocol, plus the two probes. */
export interface MirrorTarget {
  spec: MirrorSpec;
  /** The shared input set both probes run over, and the payload shape they print. */
  inputs: MirrorInputSet;
  reference: Probe;
  mirror: Probe;
}

/**
 * The registry of mirrored payloads. ADD A ROW when a studio route is re-composed into another
 * surface — that is the moment the drift class opens, and a row is the whole cost of closing it.
 *
 * `referenceOnlyFields` is where a DELIBERATE difference is declared. It is self-pruning (the
 * judge fails a stale entry), so the list can only ever describe differences that are still real.
 *
 * IT LIVES HERE, IN THE PURE MODULE, RATHER THAN IN THE CHECK SCRIPT, so a second reader can ask
 * what is registered without running the conformance harness — {@link file://./check-mirror-conformance.ts}
 * executes on import, so importing it to read this list would run the whole gate. Its one such
 * reader today is `mirror-pair-drift` in `check:verification-decay`, which locates pairs MISSING
 * from this list. That instrument is the deliberate COMPLEMENT of this gate, never a re-derivation
 * of it: this registry proves the pairs it knows about EXACTLY and BLOCKS, because an equality
 * assertion between two implementations over one input has no false-positive surface; finding
 * pairs nobody registered is a heuristic that does, and so stays advisory (ADR-0251's
 * reconciliation with ADR-0252).
 */
export const MIRRORS: readonly MirrorTarget[] = [
  {
    spec: {
      surface: "GET /api/docs (DocMeta[])",
      route: "/api/docs",
      reference: "studio",
      mirror: "desktop",
      key: "id",
      // EMPTY BY DESIGN: the desktop serves the same compiled studio SPA, so every DocMeta field
      // the studio emits has a reader on the desktop too. There is no sanctioned difference here.
      referenceOnlyFields: [],
    },
    inputs: "docs-trees",
    reference: { appDir: "apps/studio", file: "apps/studio/server/docsMirrorProbe.ts" },
    mirror: { appDir: "apps/desktop", file: "apps/desktop/src/backend/docs-mirror-probe.ts" },
  },
  {
    // THE SECOND ROW, and the one the registry's own advisory sibling had been naming for weeks:
    // `mirror-pair-drift` in `check:verification-decay` listed `/api/activity` as an unregistered
    // pair while the pair drifted TWICE in the real corpus — the desktop's re-composed SELECT
    // shipped without ADR-0200's `grade` column (fixed in #993, and the reason
    // apps/desktop/src/backend/claim-activity.ts exists), then its route shipped without the
    // `departures` key the studio serves (fixed in 6dbc1b80). Both were found by a human reading
    // the map, which is precisely the observer this row replaces.
    //
    // WHAT IT PROVES, and what it does not — stated precisely, because a fence whose reach is
    // assumed is worse than one whose reach is written down.
    //
    // The `claims` layer is folded on each side from RAW `events.node_claim` rows by that surface's
    // OWN re-composed fold (`claimsToActivity` / `claimRowsToActivity`), over one shared fixture and
    // a fixed `now`. So what is asserted is that THE TWO FOLDS AGREE — a fold that stops carrying a
    // field, normalises a grade differently, or drops a stale row on a different threshold goes red.
    // That is the cross-surface half of the grade defect, and it is the half no observer had.
    //
    // It is NOT the whole of that defect, and the difference matters: `grade` originally went missing
    // in the desktop's SELECT, upstream of the fold. A fixture supplies rows directly, so this row
    // cannot see a column leaving a query. That half is fenced INSIDE each surface instead — the
    // desktop derives `IN_FLIGHT_CLAIMS_SQL` from `CLAIM_ROW_COLUMNS`, so its SELECT and its reader
    // cannot drift apart again (claim-activity.ts's own header records why). The two fences are
    // complementary, and neither covers the other.
    //
    // `builds` and `departures` ride the fixture ALREADY FOLDED, so for those two this proves the
    // route emits the KEY and passes the value through unchanged — the departures-shaped defect —
    // but NOT that the two folds agree. `departures` needs no such proof (both surfaces call the SAME
    // `foldDepartures` from @storytree/notice-board — shared code, no drift class). `builds` DOES,
    // and cannot get it here: the desktop's fold is inline inside a `pg` query closure in
    // apps/desktop/electron/backend-entry.ts and cannot be reached without a database, while this
    // gate runs in CI. Extracting it to a pure module — the shape `claim-activity.ts` already
    // took — is what would close that half.
    spec: {
      surface: "GET /api/activity ({builds, claims, departures})",
      route: "/api/activity",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`layer:<name>` / `<layer>#<index>`), not a payload field —
      // see `projectActivityPayload`.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve this wire to the SAME compiled world renderer, which
      // reads every layer from either. A difference here is a defect, never a deliberate narrowing.
      referenceOnlyFields: [],
    },
    inputs: "activity-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/activityMirrorProbe.ts" },
    mirror: { appDir: "apps/desktop", file: "apps/desktop/src/backend/activity-mirror-probe.ts" },
  },
  {
    // `/api/claims` — the claim-ledger DOCK view (ADR-0200 D7), and the row whose REFUTATION was
    // withdrawn (ADR-0496 D3). It sat unregistered on the finding that "the divergent part is the
    // SELECT behind `sessionClaims()`, which a DB-free probe cannot reach". BOTH HALVES OF THAT WERE
    // WRONG, and the second one is what makes this row cheap:
    //
    //   · There IS no second SELECT. The studio calls `new PgClaimStore(pool).listAllClaims()`
    //     (libraryBackend.ts) and the desktop calls `claimLedger.listAllClaims()` on an instance of
    //     the SAME class from @storytree/notice-board (electron/backend-entry.ts). One query, one
    //     implementation, its own tests. Nothing there can drift apart.
    //
    //     ⚠ READ "cannot drift" PRECISELY: the IMPLEMENTATION cannot, the CHOICE of read can, and
    //     this harness cannot see the choice because the fixture injects past it (see
    //     `claims-fixtures` above). Both surfaces read the UNFILTERED twin as of ADR-0535 D1; when
    //     they did not, this row was green over a genuine divergence.
    //   · The store was never out of reach anyway — ADR-0495 refuted "CI is DB-free".
    //
    // WHAT IS ACTUALLY HAND-COPIED IS THE ENVELOPE, and it is the `/api/arcs` shape exactly: the fold
    // (`groupClaimsBySession`) is shared @storytree/notice-board code both surfaces call, so what
    // each surface writes for itself is the 405 that makes the route read-only, the advisory
    // `{ sessions: null }` a down store or a seam-less backend must answer INSTEAD of a 503, and the
    // `null`-versus-`[]` distinction the dock renders as "no ledger here" against "nobody working".
    // `/api/arcs` was registered on precisely that argument and it holds identically here.
    //
    // THREE ARMS, and the two absence arms are the ones that carry the row. `populated` proves the
    // grouping reaches the wire; `advisory-null` is a seam that ANSWERS null; `seam-absent` is a
    // backend that does not offer `sessionClaims` at all — a different code path (`?.()`), and the
    // json/narrow-stub posture both surfaces promise. Without them both surfaces would agree on
    // every populated request and a `[]`-for-`null` swap would ship.
    spec: {
      surface: "GET /api/claims ({sessions})",
      route: "/api/claims",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<json-path>`), not a payload
      // field — see `projectClaimsPayload`.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve this wire to the SAME compiled session dock, which
      // reads every field from either. A difference here is a defect, never a deliberate narrowing.
      referenceOnlyFields: [],
    },
    inputs: "claims-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/claimsMirrorProbe.ts" },
    mirror: { appDir: "apps/desktop", file: "apps/desktop/src/backend/claims-mirror-probe.ts" },
  },
  {
    // THE THIRD ROW, registered in the SAME branch that created the pair — the moment the desktop
    // began serving `/api/arcs` (ADR-0267 / ADR-0314's arc surface), not weeks later after a drift.
    //
    // WHAT IS AND IS NOT AT RISK HERE, stated precisely because this pair's drift class is a
    // different SHAPE from the other two. The arc → children JOIN is genuinely shared code:
    // `loadArcRollup`/`loadArcRollups` live in @storytree/arc and BOTH surfaces call them, so the
    // rollup's CONTENT carries no re-composition risk (that is `deriveArcRollup`'s own suites' job).
    //
    // THE TWO WIDTHS ARE SHARED CODE TOO, and deliberately so. The list serves the narrowed
    // `ArcRollupSummary` (what a lane draws) and the per-id read serves the whole rollup, but the
    // NARROWING is `loadArcRollupSummaries` in @storytree/arc — one projection both surfaces call,
    // never a field list each re-picks. Had the desktop re-picked them, the drift would have been
    // invisible in exactly the way this registry exists to prevent: both payloads would still be
    // well-formed `{ arcs: [...] }`, and the lane strip would simply lose a bar tone or a claim
    // join on one surface. The `list` request below compares them field by field regardless.
    // What is hand-copied is the ENVELOPE — the method guard, the two "no document store" answers,
    // the unknown-id answer, the id decode, and the `{ arcs }` key itself — and every one of those
    // is a DECISION the desktop copy could silently lose. It matters more here than the shape of the
    // payload: `apps/studio/src/lib/arcRollups.ts` keeps FOUR states apart (loading / unreachable /
    // no-store / rollups) and renders each differently, so a desktop copy that answered `{ arcs: [] }`
    // for a missing store, or 404'd where the studio 503s, would drive the SAME compiled bundle into
    // a confidently wrong state rather than an honest one.
    //
    // Both probes therefore print the REAL served `{ status, body }` — they drive each surface's own
    // dispatcher and its own central error mapping, not the arcs handler in isolation, so the status
    // codes and error bodies are inside the assertion rather than re-implemented beside it.
    spec: {
      surface: "GET /api/arcs ({arcs} summary list · one full ArcRollup)",
      route: "/api/arcs",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<arcId>`), not a payload field
      // — see `projectArcsPayload`; the payload's own `id` is compared like any other field. Spelled
      // literally, like the row above: `ARCS_KEY` is declared below this table.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve this wire to the SAME compiled arc lens, which reads
      // every field from either. A difference here is a defect, never a deliberate narrowing.
      referenceOnlyFields: [],
    },
    inputs: "arc-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/arcsMirrorProbe.ts" },
    mirror: { appDir: "apps/desktop", file: "apps/desktop/src/backend/arcs-mirror-probe.ts" },
  },
  {
    // THE FOURTH ROW, registered in the SAME branch that created the pair — the discipline the row
    // above established, and the one this registry's advisory sibling exists to enforce when it
    // lapses. `mirror-pair-drift` in `check:verification-decay` pins its ceiling at the CURRENT count,
    // so a desktop route serving a path the studio already serves WITHOUT a row here reds gate step 9.
    // Raising that ceiling would have been the wrong remedy: ADR-0269 permits an upward move only for
    // a genuine enlargement of what the instrument SCANS, and a new pair is not one.
    //
    // THE GAP THIS CLOSES IS THE SECOND INSTANCE OF ONE CLASS, which is why the shape was copied from
    // `/api/arcs` rather than invented. The desktop loads the COMPILED STUDIO BUNDLE against its own
    // backend, so it ships every lens the studio gains; #1228 wired ADR-0314 D7's floor-health band to
    // ADR-0316's instrument, and with no route on this backend the fetch 404'd and the band rendered
    // `declined` — "the floor-health read didn't answer here". Honest rather than broken, by design,
    // but it is not the reading, and the desktop is a surface the owner actually uses. `/api/arcs` had
    // exactly this shape: found in #1192, closed in #1195.
    //
    // WHAT IS AND IS NOT AT RISK. The READING is shared code — `loadFloorHealthReading` in
    // @storytree/drive, called by both surfaces and by `storytree factory health` — so the figure
    // carries no re-composition risk; drive's own suites own that. What is hand-copied is the
    // ENVELOPE: the method guard AND ITS STATED REASON, the "no document store" answer, and the
    // `{ reading }` key. Each is a DECISION the desktop copy could silently lose, and the loss would
    // be invisible: `apps/studio/src/lib/floorHealth.ts` keeps `declined` apart from a QUIET floor,
    // so a mirror answering `{ reading: <a reading with no loudest> }` where its reference answers
    // `{ reading: null }` would drive the SAME compiled band into reporting "all clear" for a floor it
    // never measured — the precise failure ADR-0316's band exists to avoid.
    //
    // ONE THING IT DELIBERATELY DOES NOT ASSERT: the loud/quiet THRESHOLD. That is
    // `LOUD_AT_RECURRENCES` in apps/studio/src/components/FloorHealthLamp.tsx — frontend, one
    // compiled bundle, served by both surfaces, so it has no drift class and no place in a
    // server-payload comparison. ADR-0316 D4 keeps the wire to measuring; a server that decided
    // loudness would be the defect, not a field to compare.
    spec: {
      surface: "GET /api/floor-health ({reading} — the factory-floor reading)",
      route: "/api/floor-health",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>:reading` / `<label>#reading`),
      // not a payload field — see `projectFloorHealthPayload`. Spelled literally like the rows above;
      // `FLOOR_HEALTH_KEY` is declared below this table.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve this wire to the SAME compiled band, which reads every
      // field from either. A difference here is a defect, never a deliberate narrowing.
      referenceOnlyFields: [],
    },
    inputs: "floor-health-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/floorHealthMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/floor-health-mirror-probe.ts",
    },
  },
  {
    // THE FIFTH ROW, registered in the SAME branch that created the pair (`traversal-panel-arc`,
    // increment `desktop-serves-the-traversal-routes`) — the discipline the two rows above
    // established. `mirror-pair-drift` pins its ceiling at the CURRENT count, so three desktop routes
    // serving paths the studio already serves, with no row here, reds gate step 9. Raising the
    // ceiling would be the wrong remedy: ADR-0269 permits an upward move only for a genuine
    // enlargement of what the instrument SCANS, and new pairs are not one.
    //
    // ONE ROW, THREE PATHS, and see `additionalRoutes` for why. `/api/traversal`,
    // `/api/traversal/sessions` and `/api/context-windows` are one mount over one fixture on each
    // surface; three rows would run the identical probe pair three times.
    //
    // THE FOURTH INSTANCE OF ONE CLASS, and the reason it is worth a row rather than a note. The
    // desktop serves the COMPILED STUDIO BUNDLE against its own backend, so it ships every lens the
    // studio gains. The Traversal tab shipped with `traversal-panel-bottom-tab-host`; its three
    // fetches were never mirrored, and the tab answered `unknown endpoint` on the one surface the
    // owner actually drives. `/api/arcs` had this shape (#1191 → #1195), then `/api/floor-health`
    // (#1228 → the row above). Its ABSENCE half — a studio route the desktop never mirrored, which
    // no payload comparison can see because there is no desktop payload to be unequal — is the
    // sibling increment `desktop-route-coverage-is-unasked`, not this row.
    //
    // WHAT IS AND IS NOT AT RISK. The SUBSTANCE is shared code and carries no re-composition risk:
    // both surfaces call `replayTraversalSessionAllAdapters`, `computeDecisionPoints`,
    // `listTraversalSessionsIncremental` and `readWindowOccupancySeries` from the same three
    // packages. (`listTraversalSessionsIncremental` MOVED into @storytree/context-traversal-capture
    // in that increment precisely so it stayed one copy.) What is hand-copied is the ENVELOPE, and
    // most of it is expressed as a STATUS — which is why both probes drive their surface's real
    // dispatcher and print the status beside the body:
    //   · the method guard, and its stated reason (405, not a 404 that reads as "no such route");
    //   · the two flat-token id guards, which stand between a query parameter and a `path.join`;
    //   · the honest EMPTY index answer, and `dir` riding the wire so "no sessions" and "no traces
    //     where I looked" stay different facts;
    //   · the 404-vs-200 fork for an unreadable trace — ABSENT is a 404, while ALL-CORRUPT is a 200
    //     carrying `skipped > 0`, because that is something OBSERVED (ADR-0241 D5);
    //   · `/api/context-windows`'s deliberate NON-404 for a window with no transcript, for the same
    //     reason `/api/arcs` distinguishes its four states: a 404 there reads as "the route is
    //     missing" and sends an operator somewhere else entirely.
    // Every one of those is a DECISION the desktop copy could silently lose while still answering
    // 200 on the happy path, which is exactly what a fixture with only a populated arm would miss.
    spec: {
      surface:
        "GET /api/traversal · /api/traversal/sessions · /api/context-windows (the replay panel's local-file reads)",
      route: "/api/traversal",
      additionalRoutes: ["/api/traversal/sessions", "/api/context-windows"],
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<jsonPath>`), not a payload
      // field — see `projectTraversalPayload`. Spelled literally like the rows above.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve these three wires to the SAME compiled replay panel,
      // which reads every field from either. A difference here is a defect, never a deliberate
      // narrowing.
      referenceOnlyFields: [],
    },
    inputs: "traversal-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/traversalMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/traversal-mirror-probe.ts",
    },
  },
  {
    // ESTABLISHED BY RESPONSE DIFF, NOT BY READING THE TWO HANDLERS (2026-08-31,
    // `unscored-guards-arc` / `establish-remaining-mirror-pairs`). The handler-diff route is what
    // manufactured a false finding on `/api/health` one increment earlier: the studio composes its
    // payload IN the handler while the desktop composes parts of its own in the INJECTED dependency
    // (`apps/desktop/electron/backend-entry.ts`), because ADR-0100 forbids importing
    // `apps/studio/server` — so a handler-level comparison reports a divergence whenever the two
    // surfaces merely drew their seam in different places. Both probes here replay REQUESTS and
    // print what their own surface answered.
    //
    // THE DIVERGENCE THIS ROW WAS OPENED ON WAS REAL AND PRESENT, which is not the usual outcome —
    // `mirror-pair-drift` locates a missing OBSERVER, and "these two agree today" refutes nothing.
    // Two of eight replayed requests disagreed: `?topicId=` returned EVERY comment on the studio and
    // NONE on the desktop, because `searchParams.get` answers `""` rather than null for a
    // present-but-empty parameter and only one surface's guard was truthy-based. Fixed in
    // `boot-read-routes.ts` in the same landing; this row is what stops it recurring silently.
    //
    // WHAT IS AT RISK IS THE PARSE, AND THE FIXTURE IS SHAPED FOR IT. Neither surface composes a
    // comment — both hand a filter to an injected store — so the store is stubbed to ECHO its
    // filter and the comparison lands on the only thing each surface writes for itself. See
    // `projectCommentsPayload`, which explains why a fixed comment list would have been the wrong
    // fixture.
    spec: {
      surface: "GET /api/comments (the composed topicId/topicKind filter)",
      route: "/api/comments",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<request>` / `<request>#filter`), not a payload
      // field — see `projectCommentsPayload`. Spelled literally like the rows above.
      key: "_key",
      // EMPTY BY DESIGN: the desktop serves the compiled studio bundle, whose comment views read
      // this wire on both surfaces. A difference here is a defect, never a deliberate narrowing.
      // (`/api/me` IS a deliberate narrowing and for that reason has no row — see the increment.)
      referenceOnlyFields: [],
    },
    inputs: "comments-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/commentsMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/comments-mirror-probe.ts",
    },
  },
  {
    // THE WIDEST PAIR IN THE REGISTRY, and the one whose absence has already cost something
    // measurable. Commit `71f68d2b` folded `parseAdrWireSignals` into the studio's `listDocs` and
    // left the desktop's copy alone — silently dropping `loadBearing` from 88 ADRs and `references`
    // from 168 with nothing anywhere going red. That was `/api/docs`, a shallower pair than this one,
    // and it is the incident the whole harness's header cites.
    //
    // WHAT IS AT RISK, and here almost everything is. On the other five rows the SUBSTANCE is shared
    // code and only the ENVELOPE is hand-copied. On this route the substance is hand-copied too:
    //   · `readTree` (apps/studio/server/apiRouter.ts) and `readTreeWithCaps`
    //     (apps/desktop/src/backend/tree-verdicts.ts) are two independent walks of one `stories/`
    //     tree, each parsing specs, each collecting the same three obligation maps;
    //   · `foldedToTreeWalk` (apiRouter.ts) and `toDesktopTree` (hierarchy-live.ts) are two
    //     independent adapters over the ONE shared projection fold (`foldWorkHierarchy`, ADR-0445 D1);
    //   · the enrichment exists once on each surface — the own-verdict attach, `applyUatCriteria`,
    //     `applyCapCoverage` and `applyUatCrowns` — the desktop's copies living in `tree-verdicts.ts`
    //     behind `foldVerdicts`.
    // What is genuinely shared, and therefore NOT what this row proves, is the layer under all of
    // that: `foldWorkHierarchy` in @storytree/library and the rollup compute in
    // @storytree/orchestrator, both called by both surfaces and owned by their own suites.
    //
    // ESTABLISHED BY RESPONSE DIFF, NOT BY READING THE TWO FOLDS — the method
    // `establish-remaining-mirror-pairs` settled after a handler-body diff manufactured a false
    // finding on `/api/health`. Each surface's own composition was stood up in its own process over
    // one fixture and the composed RESULTS diffed.
    //
    // AND IT FOUND TWO REAL, PRESENT DIVERGENCES on the disk arm, both fixed in the landing that
    // registered this row (the mirror follows the reference, as `/api/comments` did):
    //   · `building` — the studio always emitted it (`false` for an ordinary story), the desktop only
    //     when true, so every non-building story carried the key on one surface and not the other;
    //   · `decisions` — the studio's node literal carries `[]`, the desktop's did not, so a story
    //     whose `story.md` FAILED TO PARSE arrived with `decisions: []` on one surface and no
    //     `decisions` key at all on the other. The error path is exactly where a reader is least
    //     likely to look and most likely to `.map` over it.
    // Neither changed a rendered pixel today, which is the point: a wire that disagrees on absence is
    // one field's default away from a reader that throws, and nothing was watching.
    spec: {
      surface: "GET /api/tree (the forest map's hierarchy + its verdict overlay)",
      route: "/api/tree",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<jsonPath>`), not a payload
      // field — see `projectTreePayload`. Spelled literally like the rows above; `TREE_KEY` is
      // declared below this table.
      key: "_key",
      // EMPTY BY DESIGN: the desktop serves the COMPILED STUDIO BUNDLE against this backend, so the
      // same world renderer reads this wire on both surfaces and every field it draws must be
      // present on both. A difference here is a defect, never a deliberate narrowing.
      referenceOnlyFields: [],
    },
    inputs: "tree-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/treeMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/tree-mirror-probe.ts",
    },
  },
  {
    // THE PAIR THAT DECLARED ITS OWN DUPLICATION IN A COMMENT AND WAS WATCHED BY NOTHING. The
    // desktop's mount carried "same logic as uatContextForStory in apiRouter.ts" — a stated copy,
    // unobserved for as long as it existed.
    //
    // IT WAS UNREACHABLE UNTIL THE LANDING THAT REGISTERED IT. The desktop half was an inline closure
    // inside `apps/desktop/electron/backend-entry.ts`'s `main()`, so calling it meant booting the
    // whole Electron backend — a live pg pool, a real attestation store, the launch sequence — and no
    // probe could get near it. `mirror-pair-drift` had been naming the pair since ADR-0269's
    // re-baseline widened the sweep to `apps/desktop/electron` (10 → 11, where it entered the count
    // as newly VISIBLE rather than newly broken). The mount was extracted verbatim to
    // `apps/desktop/src/backend/attestations-route.ts`, which is what made this row possible; the
    // `tree-verdicts.ts` precedent, same shape, same reason.
    //
    // WHAT IS AT RISK. The compute is genuinely shared and carries no re-composition risk —
    // `loadNodeSpec`, `deriveAttestations`, `resolvedWitnessOf` / `unresolvedUatLegs`,
    // `rollupCriterionStatus` / `rollupStoryUat`, all from @storytree/orchestrator, all called by
    // both. What is hand-copied is the READ and the ENVELOPE: which file a `storyId` resolves to,
    // the 400 that makes it required, the row assembly, and which of `storyUat` /
    // `unresolvedWitnesses` / `proven` / `detailArtifactId` reach the wire at all.
    //
    // AND THE FIRST COMPARISON FOUND THREE REAL, PRESENT DIVERGENCES, all on the desktop side, all
    // fixed in the same landing (the mirror follows the reference, as `/api/comments` did):
    //   · a PATH-TRAVERSAL exposure. The desktop resolved the id with `findNodeSpecFile`, which
    //     applies no containment guard, so `?storyId=../…` reached a `path.join`. The studio refuses
    //     such an id through `containedPath` and answers exactly as if the story were missing. The
    //     defect is not only that a path escapes — it is that the escape ANSWERS DIFFERENTLY from an
    //     absence, which is what turns a member-readable route into a filesystem existence oracle;
    //   · `findNodeSpecFile`'s second behaviour: it falls back to `<story>/<unitId>.md`, so
    //     `?storyId=<a capability id>` served that CAPABILITY's criteria here and none on the studio.
    //     This route's whole vocabulary is stories;
    //   · `detailArtifactId` (ADR-0209 D7) was attached by the studio and by nothing here, so the
    //     SHARED `UatTestCriteriaSection` — the desktop loads the studio's compiled bundle — rendered
    //     every leg on this surface with no link to the artifact explaining it.
    //
    // ⚠ THE WRITE HALF IS DELIBERATELY OUT OF SCOPE, and the fixture replays no POST. The studio's
    // POST records an attestation (201); the desktop serves none and answers 405. That is a sanctioned
    // difference — the `/api/me` shape — so comparing it would red this row forever on a correct
    // answer. A method NEITHER surface serves (`DELETE`) IS replayed, so the guard itself is compared.
    spec: {
      surface: "GET /api/attestations (a story's UAT legs, their vouch marks and proven state)",
      route: "/api/attestations",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<jsonPath>`), not a payload
      // field — see `projectAttestationsPayload`. Spelled literally like the rows above.
      key: "_key",
      // EMPTY BY DESIGN: both surfaces serve this wire to the SAME compiled `UatTestCriteriaSection`,
      // which reads every field from either. A difference here is a defect, never a deliberate
      // narrowing — the one genuinely deliberate difference on this path is the WRITE, and it has no
      // row rather than an exemption.
      referenceOnlyFields: [],
    },
    inputs: "attestations-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/attestationsMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/attestations-mirror-probe.ts",
    },
  },
  {
    // THE FIRST WRITE IN THIS REGISTRY, and the highest-stakes one in the system: the
    // `operator-attested` verdict — the "I saw it work" signature that greens a story crown through
    // `rollupStoryUat` (ADR-0082). Seven read routes were watched here and this had never been.
    //
    // ADR-0495 SETTLED WHETHER TO WATCH IT AT ALL. The row above says the write half is "deliberately
    // out of scope … whether write pairs should be compared at all is `oq-mirror-harness-write-pairs`";
    // the owner answered that question — extend the harness — and delegated the isolation mechanism.
    //
    // ⚠ THE ISOLATION IS EACH SURFACE'S OWN PERSISTENCE SEAM, NOT A DATABASE (ADR-0495 D3), and this
    // looks like the harder path to anyone who has just learned that CI holds live-store credentials
    // (`ci.yml`'s keyless WIF auth step). It is the right one, on grounds a credential does not touch:
    //   · `events.verdict` is APPEND-ONLY in the SHARED live store and is what green is MADE of. A CI
    //     step exercising the real write on every PR would append operator-attested verdicts nobody
    //     signed — the exact failure already fenced by `--store pg` being refused for dry-runs,
    //     because a scripted PASS persisted is a forged healthy;
    //   · the step holds NO credential this way, so no crash, timeout or misconfiguration can reach
    //     production, and there is nothing to create, drop or clean up after an interrupted run;
    //   · the desktop CANNOT be compared through a database at all — it is architecturally forbidden
    //     from opening one (ADR-0117 d.1/d.5) and persists through an injected `ForestWriter`. A
    //     DB-backed comparison would have to break that wall or compare only one side.
    // So the studio's `signUatVerdict` backend and the desktop's `ForestWriter` are both wired to
    // CAPTURE, and what each surface COMPOSED is diffed. Both seams already existed: this row
    // invents no machinery, it uses the one both surfaces were built around.
    //
    // WHAT IS AND IS NOT AT RISK. `checkUatProof` — the sign-time trust guard — is shared
    // @storytree/orchestrator code both surfaces call, with its own suite, so the HONESTY RULE
    // carries no re-composition risk. WHAT IS DUPLICATED IS THE WRAPPER, and that is the drift
    // surface: which story spec an id resolves to and whether the resolution is CONTAINED, which
    // witness the guard is fed (the studio hands it the DECLARED witness, the desktop the RESOLVED
    // one — the same answer today for all three declared values, and a genuine fork the moment
    // `resolveWitness`'s asymmetric rule changes), what the built verdict carries, and whether a
    // verdict is composed for persistence at all.
    //
    // AND THE COMPARISON IS ON THE BUILT VERDICT, NOT A RECEIPT AND NOT A ROW (ADR-0495 D2) — see
    // `projectUatAttestPayload` for what that excludes and why the status is not in it.
    //
    // ITS FIRST RUN FOUND A REAL, PRESENT DIVERGENCE, on the desktop side, fixed in the landing that
    // registered it — the fifth this harness has caught and the first on a write. The desktop mount
    // paired its containment guard with a BARE `loadNodeSpec`, which THROWS on a missing file: a
    // perfectly ordinary typo'd `storyId` crashed the signing route here while the studio answered
    // 400. It had been in `electron/backend-entry.ts` for as long as the route existed, unreachable
    // by any test, and the escaped-id arm cannot see it — a `../` id is refused before a file is
    // opened. `refuse-missing-story` is the arm that names it.
    //
    // ⚠ A RESIDUAL GAP, NAMED RATHER THAN CLOSED: this compares what each surface COMPOSED, not that
    // the broker DELIVERED it. Delivery failure already refuses rather than forging a green (the
    // desktop reports success only on `persisted: true`; the studio 503s when the backend cannot
    // sign), but a broker that MANGLES a verdict in transit is out of scope here and is not claimed
    // to be covered.
    spec: {
      surface: "POST /api/uat/attest (the operator-attested verdict composed for persistence)",
      route: "/api/uat/attest",
      reference: "studio",
      mirror: "desktop",
      // The projection's synthetic key (`response:<label>` / `<label>#<jsonPath>`), not a payload
      // field — see `projectUatAttestPayload`. Spelled literally like the rows above.
      key: "_key",
      // EMPTY BY DESIGN, and it stays empty even though this pair has a written correct-difference
      // rule: `referenceOnlyFields` answers "which field does the reference emit that the mirror
      // does not", and the answer here is none — both surfaces compose the same verdict SHAPE. The
      // differences this pair does have are about VALUES and about walls, so they are declared in
      // `correctDifferences` below, where each one carries its argument.
      referenceOnlyFields: [],
      // THE WRITTEN CORRECT-DIFFERENCE RULE (ADR-0495 D4). FIVE clauses, against D5's stopping
      // condition of "roughly a handful" — so read the shape, not just the count: only TWO of them
      // exempt anything the comparison would otherwise see, and both of those are provenance or
      // wording rather than substance. The other three are experimental design — an input the
      // fixture holds constant, and a wall that no fixture arm can compare. If a sixth clause of the
      // FIRST kind appears, that is the tripwire: stop and raise it.
      // Stryker disable StringLiteral: the `difference` and
      // `why` PROSE below is human-facing documentation — it is read in a failure report and by the
      // next editor, and nothing computes over its bytes. Pinning them exactly would be an
      // expectation copied from its own subject, which cannot fail for the right reason. What CAN
      // rot is asserted instead (`mirror-conformance.test.ts`): every clause carries a non-empty
      // `why`, every exempt `keys` entry is a well-formed projected key, and every
      // `fenced-elsewhere` `provenBy` names a file that still exists. The `keys` and `provenBy`
      // VALUES are not prose and are not disabled — a mutant on either is caught by this row's own
      // arms or by that suite. Same call `route-surfaces.ts` makes for its surface labels.
      correctDifferences: [
        {
          disposition: "exempt",
          keys: [
            "sign-either-fail#.composed.runId",
            "sign-human-pass#.composed.runId",
            "sign-ignores-forged-fields#.composed.runId",
          ],
          difference:
            "the verdict's `runId` is stamped with the SURFACE that signed — `studio-uat-attest:<at>` against `local-uat-attest:<at>`",
          why:
            "a runId identifies the run that produced a verdict, and these are two different runs on " +
            "two different surfaces. Making them equal would erase the one field that says where a " +
            "signature came from, on the one write where provenance is the whole point. The `<at>` " +
            "half is compared — it rides `.composed.at`, which is NOT exempt — so a surface that " +
            "stopped deriving the runId from the sign time still diverges there.",
        },
        {
          disposition: "exempt",
          keys: [
            "refuse-escaped-story#.refusedBecause",
            "refuse-machine-witness#.refusedBecause",
            "refuse-missing-story#.refusedBecause",
            "refuse-sandbox-signer#.refusedBecause",
            "refuse-unknown-criterion#.refusedBecause",
          ],
          difference:
            "a refusal's WORDING, where each surface frames the same refusal for its own reader and its own transport",
          why:
            "the studio's refusals are HTTP error messages read by a hosted member (`refused — <reason>`); " +
            "the desktop's are returned in-process and read by a local operator, and its story-lookup " +
            "refusals name the story rather than the criterion. Forcing one wording on both would " +
            "make one surface's message wrong for its reader. What is NOT exempted is the fact of " +
            "refusal: `signed` is compared strictly on every arm, so a wall firing on one surface " +
            "and not the other still reds. Nor is every wording exempt — `refuse-missing-criterion` " +
            "is left compared precisely because both surfaces answer it with the identical string, " +
            "which keeps this from being a blanket. THE COST, stated: two surfaces that both refuse " +
            "for DIFFERENT reasons are not distinguished at these four keys.",
        },
        {
          disposition: "held-constant",
          difference:
            "the SIGNER SOURCE — the studio signs as the verified IAP caller, the desktop as a resolved local operator identity",
          how:
            "both probes are handed the SAME signer from the fixture (and the desktop additionally the " +
            "same agent identity, which the studio's guard call does not take — an agent holds no IAP " +
            "identity, so on the studio there is nothing to compare it against).",
          why:
            "where an identity comes from is a transport concern each surface correctly owns, and " +
            "neither takes it from the request body — that is the shared honesty rule. What must " +
            "agree is what each surface DOES with the identity it resolved: trims it, stamps it into " +
            "`signer` and into the evidence `ref`, and feeds it to the trust guard. Injecting it is " +
            "what puts the comparison on that, instead of on two identity providers.",
        },
        {
          disposition: "held-constant",
          difference:
            "the COMMIT PINNED — the studio pins the commit it is SERVING (git HEAD or STORYTREE_STUDIO_COMMIT), the desktop the session repo's HEAD",
          how: "both probes are handed the same commit SHA from the fixture.",
          why:
            "the two surfaces observe different things — a deployed build against a local checkout — " +
            "so they must resolve different commits. What must agree is that the resolved commit is " +
            "PINNED into the verdict unchanged, which `.composed.commitSha` compares directly.",
        },
        {
          disposition: "fenced-elsewhere",
          difference:
            "the CLEAN-TREE wall: the desktop refuses to attest while the working tree is dirty, and the studio has no such wall",
          provenBy: "apps/desktop/src/backend/local-uat-attest.test.ts",
          why:
            "it is correct that only one surface has it — a local operator can dirty the very tree " +
            "they are attesting, so pinning a commit they are not looking at is a real hazard there, " +
            "while a studio member observes a deployed build they cannot modify. No fixture arm can " +
            "compare a wall only one side has: an arm with a dirty tree would have the desktop " +
            "compose nothing where the studio composes a whole verdict, which is a divergence in the " +
            "ENTRY SET and would need a whole arm exempted — the blunt kind of exemption that starts " +
            "blessing drift. The fixture therefore holds `clean: true`, and the wall is proved by the " +
            "desktop's own suite. The persistence contract is fenced the same way and in the same " +
            "file (only `persisted: true` is reported as success), with the studio's " +
            "503-when-the-backend-cannot-sign in `apps/studio/server/uatAttestApi.integration.test.ts`.",
        },
      ],
      // Stryker restore StringLiteral
    },
    inputs: "uat-attest-fixtures",
    reference: { appDir: "apps/studio", file: "apps/studio/server/uatAttestMirrorProbe.ts" },
    mirror: {
      appDir: "apps/desktop",
      file: "apps/desktop/src/backend/uat-attest-mirror-probe.ts",
    },
  },
];

/**
 * The value as a plain JSON object, or `null` for anything else — an array, `null`, or a primitive.
 *
 * ONE COMPARISON, DELIBERATELY. The hand-written form
 * (`v !== null && typeof v === "object" && !Array.isArray(v)`) carries a null clause whose mutants
 * are EQUIVALENT by construction: a guard that returns null FOR null and a guard that falls through
 * TO null agree on every input, so no test can tell them apart. `Object.prototype.toString` asks the
 * same question with no null clause to be blind about, and every mutant of it changes an answer.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return Object.prototype.toString.call(value) === "[object Object]"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * PURE: project a `GET /api/comments` probe payload — `{ [request]: { status, body } }`, one entry
 * per request both probes replayed — into comparable {@link Entry} rows.
 *
 * WHAT THIS PAIR ACTUALLY OBSERVES, and why the probes record rather than filter. Neither surface
 * composes a comment: both hand a FILTER to an injected store and send what comes back. The whole
 * of each surface's own contribution is therefore the query-string PARSE — so each probe's store
 * RECORDS the filter it is handed and prints it beside the response, and this projection compares
 * that. Feeding a fixed comment list instead would have compared two stubs applying the same filter
 * and stayed green through the very divergence that put this row here.
 *
 * THE DIVERGENCE THAT PUT IT HERE, measured 2026-08-31 (`unscored-guards-arc` /
 * `establish-remaining-mirror-pairs`): `searchParams.get` answers `""` — not null — for a
 * present-but-empty `?topicId=`, so the desktop's `?? undefined` guard passed `""` through and it
 * filtered to comments with an empty topicId (none), while the studio's `if (topicId)` treated the
 * parameter as absent (all). Same request, opposite answer, no observer. Two of eight replayed
 * requests diverged.
 *
 * TWO ENTRY KINDS PER REQUEST:
 *
 *   `response:<request>` — the status, the body's SHAPE and its length. Status rides along for the
 *     reason {@link projectFloorHealthPayload} takes it: an envelope's half is its code, and a
 *     projection over bodies alone would never notice one surface answering under a different one.
 *   `<request>#filter` — the composed filter's fields BY NAME, plus the sorted key set. The key set
 *     is what catches an ABSENT key, which is the exact shape the empty-`topicId` defect took: one
 *     side carried `topicId` and the other carried nothing, and every field they shared agreed.
 *
 * A list answer that carries no recorded filter THROWS rather than decoding to something
 * comparable — see the fail-closed note in the body.
 */
export function projectCommentsPayload(body: unknown): Entry[] {
  if (asRecord(body) === null) {
    throw new Error(
      `comments payload must be a JSON object keyed by request, got ${render(body)}`,
    );
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the request SET, never the probe's iteration order.
  for (const label of Object.keys(body as Record<string, unknown>).sort()) {
    const answer = asRecord((body as Record<string, unknown>)[label]);
    if (answer === null) {
      throw new Error(
        `comments answer "${label}" must be a { status, body } object, got ${render((body as Record<string, unknown>)[label])}`,
      );
    }
    const payload = answer["body"];
    const isList = Array.isArray(payload);
    out.push({
      [COMMENTS_KEY]: `response:${label}`,
      status: answer["status"] ?? null,
      shape: payload === null ? "null" : isList ? "array" : typeof payload,
      length: isList ? payload.length : null,
    });
    if (!isList) continue;

    // FAIL CLOSED rather than cope. Within this pair's contract a list answer ALWAYS reached the
    // store, so it always carries the filter the surface composed — anything else is a probe that
    // has proved nothing, and an entry decoded from it would compare equal to the other side's
    // equally-degraded entry and read as a PASS. Coping with a malformed answer instead of refusing
    // it is the shape that makes a check unable to fail.
    const filter = asRecord(answer["filter"]);
    if (filter === null) {
      throw new Error(
        `comments answer "${label}" served a list without recording the filter it composed, got ${render(answer["filter"])}`,
      );
    }
    // The synthetic key is written LAST so a filter that happened to carry `_key` cannot displace
    // it and collapse two entries onto one.
    out.push({
      ...filter,
      filterKeys: Object.keys(filter).sort().join(","),
      [COMMENTS_KEY]: `${label}#filter`,
    });
  }
  return out;
}

/**
 * The route paths {@link MIRRORS} proves exactly — the set `mirror-pair-drift` treats as already
 * covered. Derived from the registry so the two can never disagree.
 */
export function registeredMirrorRoutes(
  targets: readonly MirrorTarget[] = MIRRORS,
): ReadonlySet<string> {
  return new Set(targets.flatMap((t) => [t.spec.route, ...(t.spec.additionalRoutes ?? [])]));
}

/** One conformance failure. `where` names the fixture/corpus the comparison ran over. */
export type Divergence =
  /** An entry the reference emits that the mirror does not. */
  | { kind: "missing-entry"; where: string; key: string }
  /** An entry the mirror emits that the reference does not. */
  | { kind: "extra-entry"; where: string; key: string }
  /** Both sides emit the same entries, but not in the same order. */
  | { kind: "order"; where: string; position: number; reference: string; mirror: string }
  /** A shared entry whose field values disagree (JSON-compared). */
  | { kind: "field"; where: string; key: string; field: string; reference: string; mirror: string }
  /** An allowlisted field that is not, in fact, reference-only — the allowlist has rotted. */
  | { kind: "stale-allowlist"; where: string; field: string; reason: string }
  /**
   * A declared CORRECT DIFFERENCE that is no longer a difference — the written rule has rotted.
   * Same discipline as `stale-allowlist`, and for the same reason: a sanctioned-difference list
   * nobody prunes decays into a blanket exemption, and this one exempts whole entries.
   */
  | { kind: "stale-correct-difference"; where: string; key: string; difference: string; reason: string }
  /**
   * One side carries the same entry key more than once. The per-key maps keep only the LAST row
   * for a key, so without this a duplicate carrying a wrong value was invisible to every other rule.
   */
  | { kind: "duplicate-key"; where: string; side: "reference" | "mirror"; keys: string[] }
  /** The two payloads carry a different NUMBER of entries (reported only alongside a duplicate). */
  | { kind: "length"; where: string; reference: number; mirror: number };

/** A decoded payload entry — an arbitrary JSON record keyed by the spec's `key` field. */
export type Entry = Record<string, unknown>;

/** The projection's key field — synthetic, so it can never collide with a payload's own `key`. */
export const ACTIVITY_KEY = "_key";

/** The `/api/comments` projection's key field — the same synthetic name, aliased for the reason
 * {@link ARCS_KEY} is. */
export const COMMENTS_KEY = ACTIVITY_KEY;

/**
 * The `/api/arcs` projection's key field — the SAME synthetic name, deliberately: this is one
 * projection protocol used by two payloads, not two protocols that happen to agree. Aliased rather
 * than re-spelled so a future change to the name cannot move one and leave the other.
 */
export const ARCS_KEY = ACTIVITY_KEY;

/**
 * The `/api/floor-health` projection's key field — the SAME synthetic name again, and aliased for
 * the same reason {@link ARCS_KEY} is: this is ONE projection protocol used by three payloads, not
 * three protocols that happen to agree, so a future change to the name cannot move one and leave the
 * others behind.
 */
export const FLOOR_HEALTH_KEY = ACTIVITY_KEY;

/**
 * PURE: project a `GET /api/activity` response body — `{builds, claims, departures}`, each an array
 * or `null` — into comparable {@link Entry} rows.
 *
 * WHY THE THIRD PARTY PROJECTS, and not the probes. Each probe prints the body VERBATIM; this turns
 * it into entries. Putting the reshaping in the two probes would have handed each surface its own
 * copy of it, and a projection that drifted could mask the very divergence the harness is asserting
 * — the class the whole file exists to fence, arriving inside its own instrument.
 *
 * ONE ENTRY PER ROW, NOT ONE PER LAYER, so {@link compareMirrors} compares each activity's fields by
 * NAME. A layer compared as one blob would be JSON-string-compared, which makes object KEY ORDER —
 * not a semantic difference in JSON — a red gate, and would report a whole-layer mismatch where the
 * real defect is one field on one row. Per-row entries report `grade: studio="exploring"
 * desktop="(absent)"`, which names the ADR-0200 defect exactly.
 *
 * PLUS ONE `layer:<name>` MARKER PER KEY, which is what catches the `departures` class. Rows alone
 * cannot: a layer the mirror omits ENTIRELY and a layer it serves EMPTY both contribute zero rows,
 * so the two would agree. The marker carries the key's presence, its `shape` (`array` / `null` — the
 * advisory-absence distinction both surfaces promise) and its row count, so an omitted key is a
 * missing entry and a `null`-for-`[]` swap is a field divergence.
 */
export function projectActivityPayload(body: unknown): Entry[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`activity payload must be a JSON object, got ${render(body)}`);
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the payload's key SET, never its key ORDER — the latter is not a
  // semantic difference, and `compareMirrors` compares order.
  for (const layer of Object.keys(body as Record<string, unknown>).sort()) {
    const value = (body as Record<string, unknown>)[layer];
    out.push({
      [ACTIVITY_KEY]: `layer:${layer}`,
      shape: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      rows: Array.isArray(value) ? value.length : null,
    });
    if (!Array.isArray(value)) continue;
    value.forEach((row, i) => {
      const fields =
        row !== null && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : { value: row };
      // The synthetic key is written LAST so a payload that happened to carry `_key` cannot
      // displace it and collapse two rows onto one entry.
      out.push({ ...fields, [ACTIVITY_KEY]: `${layer}#${i}` });
    });
  }
  return out;
}

/**
 * PURE: project a `GET /api/arcs` probe payload — `{ [label]: { status, body } }`, one entry per
 * request both probes replayed — into comparable {@link Entry} rows.
 *
 * WHY STATUS AND BODY TOGETHER, and not the body alone as the activity projection takes it. This
 * route's hand-copied part is its ENVELOPE, and most of that envelope is expressed as a STATUS: the
 * 405 that makes read-only a decision rather than an omission (ADR-0267 D6 / ADR-0314 D9), the 503
 * that refuses to answer "one arc" without a store, the 404 that refuses to answer an unknown id
 * with an empty shell. A projection over bodies alone would compare three error objects and never
 * notice that one surface returned them under different codes.
 *
 * THREE ENTRY KINDS PER LABEL, for the same reason the activity projection emits layer markers:
 *
 *   `response:<label>` — the status, the body's SHAPE, and its top-level key SET. The key set is
 *     what catches an envelope that gained or lost a key while every shared key still agreed; the
 *     shape is what keeps `{ arcs: null }` and `{ arcs: [] }` apart, which is the whole distinction
 *     this route exists to preserve.
 *   `<label>:arcs` — the list payload's own shape + row count, so a `null`-for-`[]` swap is a field
 *     divergence rather than two payloads that both contribute zero rows and agree.
 *   `<label>#<id>` / `<label>#body` — one entry per row of a list answer, or the single object of a
 *     one-arc / error answer, compared FIELD BY NAME. Per-field is deliberate: a whole-body
 *     JSON-string compare would make object KEY ORDER — not a semantic difference in JSON — a red
 *     gate, and would report a whole-payload mismatch where the real defect is one field.
 */
export function projectArcsPayload(body: unknown): Entry[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`arcs payload must be a JSON object keyed by request label, got ${render(body)}`);
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the request SET, never the probe's iteration order.
  for (const label of Object.keys(body as Record<string, unknown>).sort()) {
    const answer = (body as Record<string, unknown>)[label];
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
      throw new Error(`arcs answer "${label}" must be a { status, body } object, got ${render(answer)}`);
    }
    const { status, body: payload } = answer as { status?: unknown; body?: unknown };
    const isRecord = payload !== null && typeof payload === "object" && !Array.isArray(payload);
    const fields = isRecord ? (payload as Record<string, unknown>) : {};
    out.push({
      [ARCS_KEY]: `response:${label}`,
      status: status ?? null,
      shape: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
      keys: Object.keys(fields).sort().join(","),
    });
    if (!isRecord) continue;

    if (Object.hasOwn(fields, "arcs")) {
      const arcs = fields["arcs"];
      out.push({
        [ARCS_KEY]: `${label}:arcs`,
        shape: arcs === null ? "null" : Array.isArray(arcs) ? "array" : typeof arcs,
        rows: Array.isArray(arcs) ? arcs.length : null,
      });
      if (!Array.isArray(arcs)) continue;
      arcs.forEach((arc, i) => {
        const row: Record<string, unknown> =
          arc !== null && typeof arc === "object" && !Array.isArray(arc)
            ? (arc as Record<string, unknown>)
            : { value: arc };
        // Keyed by the arc's own id where it has one (a mirror that DROPPED an arc then reports a
        // missing entry naming it, not an order shift); the index is the fallback.
        const id = typeof row["id"] === "string" ? row["id"] : String(i);
        // The synthetic key is written LAST so a payload carrying `_key` cannot displace it.
        out.push({ ...row, [ARCS_KEY]: `${label}#${id}` });
      });
      continue;
    }
    // A one-arc answer, or an error body — one entry, compared field by field.
    out.push({ ...fields, [ARCS_KEY]: `${label}#body` });
  }
  return out;
}

/**
 * PURE: project a `GET /api/floor-health` probe payload — `{ [label]: { status, body } }`, one entry
 * per request both probes replayed — into comparable {@link Entry} rows.
 *
 * STATUS AND BODY TOGETHER, for the reason {@link projectArcsPayload} takes them together: this
 * route's hand-copied part is its ENVELOPE, and half of that envelope is a STATUS — the 405 that
 * makes report-only a decision rather than an omission (ADR-0316 D4). A projection over bodies alone
 * would compare two error objects and never notice one surface returning them under different codes.
 *
 * THREE ENTRY KINDS PER LABEL:
 *
 *   `response:<label>` — the status, the body's SHAPE and its top-level key SET. The key set catches
 *     an envelope that gained or lost a key while every shared key still agreed.
 *   `<label>:reading` — the reading's own shape (`null` / `object`) plus its key set. THIS IS THE
 *     LOAD-BEARING ONE, and it is why a marker exists at all rather than only the fields below: it
 *     keeps `{ reading: null }` — "this backend has no document store" — apart from a reading that
 *     merely has no `loudest`, i.e. a QUIET floor. `apps/studio/src/lib/floorHealth.ts` renders those
 *     two differently on purpose, and a missing instrument presented as "all clear" is the exact
 *     failure ADR-0316's band exists to avoid.
 *   `<label>#reading` / `<label>#body` — the reading's own fields compared BY NAME, or the fields of
 *     an error body. Per-field is deliberate: a whole-body JSON-string compare would make object KEY
 *     ORDER — not a semantic difference in JSON — a red gate, and would report a whole-payload
 *     mismatch where the real defect is one field. `window` and `loudest` are nested objects and so
 *     are JSON-compared as subtrees, exactly as an `ArcRollup`'s nested arrays are: both surfaces
 *     build them with ONE shared function (`loadFloorHealthReading`), so their key order cannot
 *     differ, and a difference in either is a real divergence rather than a formatting artifact.
 */
export function projectFloorHealthPayload(body: unknown): Entry[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      `floor-health payload must be a JSON object keyed by request label, got ${render(body)}`,
    );
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the request SET, never the probe's iteration order.
  for (const label of Object.keys(body as Record<string, unknown>).sort()) {
    const answer = (body as Record<string, unknown>)[label];
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
      throw new Error(
        `floor-health answer "${label}" must be a { status, body } object, got ${render(answer)}`,
      );
    }
    const { status, body: payload } = answer as { status?: unknown; body?: unknown };
    const isRecord = payload !== null && typeof payload === "object" && !Array.isArray(payload);
    const fields = isRecord ? (payload as Record<string, unknown>) : {};
    out.push({
      [FLOOR_HEALTH_KEY]: `response:${label}`,
      status: status ?? null,
      shape: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
      keys: Object.keys(fields).sort().join(","),
    });
    if (!isRecord) continue;

    if (Object.hasOwn(fields, "reading")) {
      const reading = fields["reading"];
      const readingIsRecord =
        reading !== null && typeof reading === "object" && !Array.isArray(reading);
      out.push({
        [FLOOR_HEALTH_KEY]: `${label}:reading`,
        shape: reading === null ? "null" : Array.isArray(reading) ? "array" : typeof reading,
        keys: readingIsRecord
          ? Object.keys(reading as Record<string, unknown>)
              .sort()
              .join(",")
          : "",
      });
      if (!readingIsRecord) continue;
      // The synthetic key is written LAST so a reading that happened to carry `_key` cannot
      // displace it and collapse two entries onto one.
      out.push({ ...(reading as Record<string, unknown>), [FLOOR_HEALTH_KEY]: `${label}#reading` });
      continue;
    }
    // An error body (or any envelope with no `reading` key) — one entry, compared field by field.
    out.push({ ...fields, [FLOOR_HEALTH_KEY]: `${label}#body` });
  }
  return out;
}

/** {@link ACTIVITY_KEY}'s synthetic key, reused by the traversal projection — see {@link ARCS_KEY}. */
export const TRAVERSAL_KEY = ACTIVITY_KEY;

/**
 * Flatten one JSON value into `path → primitive` pairs, in a stable sorted order.
 *
 * WHY A FLATTENING RATHER THAN THE PER-FIELD SHAPE THE OTHER THREE PROJECTIONS USE. Those payloads
 * are shallow envelopes around one figure; a traversal REPLAY is a deep document (an event list,
 * each event's own fields, an adapter-coverage block, a decision-point report). Comparing it as one
 * opaque entry would report every divergence as a single unreadable diff of the whole body, and
 * comparing only its top-level keys would let an event's `nodeId` drift unobserved. Flattening keeps
 * `compareMirrors`'s field-by-field diagnostics: a divergence names the exact JSON path.
 *
 * Arrays are indexed rather than set-compared on purpose — the replay's event ORDER is the picture's
 * time axis, so two surfaces emitting the same events in a different order is a defect, not a tie.
 */
// Stryker disable ConditionalExpression,LogicalOperator: KILLED, NAMEABLE ONLY AS A TIMEOUT — this
// function RECURSES, and the object branch is what terminates it. Forcing that condition true sends
// every primitive back into the walk and the run hangs rather than failing, so the runner records a
// Timeout naming no test. The mutants are caught; the report cannot attribute them.
function flattenJson(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    into.set(`${prefix}[]`, `length:${value.length}`);
    value.forEach((item, i) => flattenJson(item, `${prefix}[${i}]`, into));
    return;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    into.set(`${prefix}{}`, keys.join(","));
    for (const k of keys) flattenJson((value as Record<string, unknown>)[k], `${prefix}.${k}`, into);
    return;
  }
  // Stryker disable next-line ConditionalExpression: EQUIVALENT on this path — the value came out
  // of `JSON.parse`, which never produces `undefined`. The branch exists because the parameter is
  // typed `unknown` and a caller could hand one in.
  into.set(prefix, value === undefined ? null : value);
}
// Stryker restore ConditionalExpression,LogicalOperator

/**
 * The `/api/tree` projection's key field — the SAME synthetic name again, aliased for the same
 * reason {@link ARCS_KEY} is: one naming convention across every projection here.
 */
export const TREE_KEY = ACTIVITY_KEY;

/**
 * `{ [label]: { status, body } }` → comparable entries: one for the RESPONSE (its status and
 * top-level shape) and one per JSON leaf of its body.
 *
 * The status is a first-class entry rather than a field on the body, because on these routes half
 * the envelope IS the status: 400 refuses a bad id BY NAME, 404 says "no trace here", 200-with-
 * `skipped` says "the trace was unreadable but present", and 405 says read-only. A projection that
 * compared bodies alone would pass a mirror that answered every one of them 500.
 *
 * SHARED BY TWO ROWS RATHER THAN COPIED INTO EACH, and the reason is this file's own subject: a
 * second hand-written copy of one projection is exactly the duplication class the registry exists to
 * fence, and it would sit inside the instrument. `/api/traversal` and `/api/tree` print the same
 * `{ label: { status, body } }` protocol and want the same treatment of it; `noun` is only what the
 * two guards call the payload when they refuse a broken probe.
 */
function projectStatusAndLeaves(body: unknown, noun: string): Entry[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      `${noun} payload must be a JSON object keyed by request label, got ${render(body)}`,
    );
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the request SET, never the probe's iteration order.
  for (const label of Object.keys(body as Record<string, unknown>).sort()) {
    const answer = (body as Record<string, unknown>)[label];
    // Stryker disable next-line ConditionalExpression: the whole-condition `false` mutant is
    // EQUIVALENT here and only here — a probe answer that is not an object still destructures to
    // `{status: undefined, body: undefined}`, which projects to the SAME entries this guard's throw
    // would otherwise prevent being compared, so no assertion can separate them. The guard exists to
    // name a broken probe rather than to change what is compared; its individual disjuncts are NOT
    // disabled, and the "not keyed by request label" case asserts the throw directly.
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
      throw new Error(
        `${noun} answer "${label}" must be a { status, body } object, got ${render(answer)}`,
      );
    }
    const { status, body: payload } = answer as { status?: unknown; body?: unknown };
    out.push({
      [TRAVERSAL_KEY]: `response:${label}`,
      status: status ?? null,
      shape: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
    });
    const leaves = new Map<string, unknown>();
    flattenJson(payload, "", leaves);
    // Stryker disable next-line MethodExpression: EQUIVALENT — `leaves` is a Map, so `keys()` and
  // `values()` differ, but the mutant Stryker generates here swaps the SPREAD for the map itself,
  // which sorts the same key set. The ORDER this sort establishes is asserted directly (two probes
  // building one body in different key orders must project equal).
  for (const path of [...leaves.keys()].sort()) {
      // The synthetic key is written as the ONLY field beside `value`, so a payload path can never
      // displace it and collapse two entries onto one.
      out.push({ [TRAVERSAL_KEY]: `${label}#${path}`, value: leaves.get(path) ?? null });
    }
  }
  return out;
}

/**
 * PURE: project a `GET /api/traversal` · `/api/traversal/sessions` · `/api/context-windows` probe
 * payload. See {@link projectStatusAndLeaves} for the shape and why it is shared.
 */
export function projectTraversalPayload(body: unknown): Entry[] {
  return projectStatusAndLeaves(body, "traversal");
}

/**
 * PURE: project a `GET /api/tree` probe payload — `{ [label]: { status, body } }`, one entry per
 * request plus one per JSON leaf of the forest-map payload it answered.
 *
 * WHY THE FLATTENING SHAPE RATHER THAN THE PER-FIELD ONE the activity/arcs/floor-health projections
 * use. Those payloads are shallow envelopes around one figure. A tree payload is the deepest
 * document either surface serves: `{ stories: [ { …, capabilities: [ { …, verdict } ], uatCriteria:
 * [ … ] } ], builds? }`. Compared as whole entries, a capability's `testCount` drifting would be
 * reported as one unreadable diff of an entire story; compared by top-level key alone it would not
 * be reported at all. Flattened, a divergence names the exact JSON path — `stories[3].capabilities
 * [1].testCount` — which is the difference between a finding someone can act on and a wall of JSON.
 *
 * IT ALSO CATCHES PRESENT-VS-ABSENT, which on this route is where the drift actually was. Each
 * object contributes a `{}` entry listing its sorted key set, so a field one surface emits and the
 * other omits diverges on that entry as well as on the leaf itself — and `[]` entries carry array
 * LENGTH, so a story silently dropped from one payload is a divergence rather than a quiet shift of
 * every subsequent index.
 */
export function projectTreePayload(body: unknown): Entry[] {
  return projectStatusAndLeaves(body, "tree");
}

/**
 * The `/api/attestations` projection's key field — the SAME synthetic name again, see {@link ARCS_KEY}.
 */
export const ATTESTATIONS_KEY = ACTIVITY_KEY;

/**
 * PURE: project a `GET /api/attestations` probe payload — `{ [label]: { status, body } }`, one entry
 * per replayed request plus one per JSON leaf of the UAT-leg envelope it answered.
 *
 * THE FLATTENING SHAPE for the reason {@link projectTreePayload} takes it: the body is a list of
 * rows, each a UAT leg spread together with its vouch marks and its optional `proven` /
 * `detailArtifactId` keys, so a divergence has to name a path (`read#.tests[1].detailArtifactId`)
 * rather than diff a row.
 *
 * AND THE STATUS BESIDE IT, because on this route much of what is hand-copied IS a status: the 400
 * that makes `storyId` required, the 200-with-no-legs that answers an unknown story (a 404 there
 * would read as "no such route"), and the refusal of an id that escapes the stories root — which
 * must be INDISTINGUISHABLE from a missing story, since a refusal that reads differently is what
 * makes a filesystem existence oracle.
 */
export function projectAttestationsPayload(body: unknown): Entry[] {
  return projectStatusAndLeaves(body, "attestations");
}

/** The `/api/claims` projection's key field — the SAME synthetic name again, see {@link ARCS_KEY}. */
export const CLAIMS_KEY = ACTIVITY_KEY;

/**
 * PURE: project a `GET /api/claims` probe payload. See {@link projectStatusAndLeaves} for the shape
 * and why it is shared rather than copied per row.
 *
 * THE STATUS IS HALF THE ASSERTION HERE, which is why this row takes the status-bearing shape rather
 * than the activity projection's body-only one. Every difference this pair can express is a status
 * or a shape: 405 makes the route read-only rather than merely unimplemented, and 200 with
 * `{ sessions: null }` is the advisory-absence answer both surfaces promise where a 503 would tell
 * the dock the whole surface was broken. A projection over bodies alone would pass a mirror that
 * answered the method guard 500, or that swapped `null` for `[]` — and `[]` renders as "nobody is
 * working" where `null` renders as "there is no ledger here".
 */
export function projectClaimsPayload(body: unknown): Entry[] {
  return projectStatusAndLeaves(body, "claims");
}

/** The `POST /api/uat/attest` projection's key field — the SAME synthetic name again, see {@link ARCS_KEY}. */
export const UAT_ATTEST_KEY = ACTIVITY_KEY;

/**
 * PURE: project a `POST /api/uat/attest` probe payload — `{ [label]: { composed, refusedBecause } }`
 * — into one `signed:` entry per replayed request plus one per JSON leaf of what that surface
 * COMPOSED FOR PERSISTENCE.
 *
 * ⚠ THE STATUS IS DELIBERATELY ABSENT HERE, and this is the only projection in the file of which
 * that is true. Every other status-bearing row includes it because on a READ route half the envelope
 * IS the status. On this pair, ADR-0495 D2 narrows the comparison to the BUILT VERDICT — "the
 * verdict is the artifact; a row is a serialisation of it and a receipt is neither" — and a status
 * code is the receipt. The two surfaces do not even share a transport for it: the studio's refusals
 * are `HttpError` statuses raised out of an HTTP handler, the desktop's are a refusal OBJECT its
 * mount then renders. Including the status would have compared two transports and reported their
 * (correct) difference as drift on every refusal arm.
 *
 * WHAT SURVIVES THAT NARROWING, and it is the half that matters: `signed` — did this surface compose
 * a verdict for persistence at all? — is compared STRICTLY on every arm. That is the wall-presence
 * assertion: a wall that fires on one surface and not the other diverges here, which is the failure
 * an operator-attested write must never have. `refusedBecause` rides alongside it so a refusal's
 * reason is compared wherever the two surfaces genuinely share it.
 *
 * The leaves are flattened for the reason {@link projectTreePayload} flattens: a divergence names
 * the exact field (`sign-human-pass#.composed.commitSha`) rather than diffing a whole verdict, and
 * the `{}` key-set entries catch a field one surface emits and the other omits — which on a signed
 * verdict is the difference between a document the store accepts and one it rejects.
 */
export function projectUatAttestPayload(body: unknown): Entry[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      `uat-attest payload must be a JSON object keyed by request label, got ${render(body)}`,
    );
  }
  const out: Entry[] = [];
  // Sorted so the entry order is the request SET, never the probe's iteration order.
  for (const label of Object.keys(body as Record<string, unknown>).sort()) {
    const answer = (body as Record<string, unknown>)[label];
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
      throw new Error(
        `uat-attest answer "${label}" must be a { composed, refusedBecause } object, got ${render(answer)}`,
      );
    }
    const { composed } = answer as { composed?: unknown };
    // `signed` is derived HERE, on the third party, rather than reported by each probe: two probes
    // each deciding what counts as "it signed" is the drift class this file exists to fence,
    // arriving inside the instrument.
    out.push({ [UAT_ATTEST_KEY]: `response:${label}`, signed: composed !== null && composed !== undefined });
    const leaves = new Map<string, unknown>();
    flattenJson(answer, "", leaves);
    for (const path of [...leaves.keys()].sort()) {
      out.push({ [UAT_ATTEST_KEY]: `${label}#${path}`, value: leaves.get(path) ?? null });
    }
  }
  return out;
}

/** JSON-compare one field value; `undefined` for an absent key (distinct from an explicit null). */
function render(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

function keyOf(entry: Entry, spec: MirrorSpec): string {
  const raw = entry[spec.key];
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** Every key that occurs more than once in `entries`, in first-duplicate order. */
function duplicateKeys(entries: Entry[], spec: MirrorSpec): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const e of entries) {
    const key = keyOf(e, spec);
    if (seen.has(key)) dupes.add(key);
    else seen.add(key);
  }
  return [...dupes];
}

/**
 * Compare a mirrored payload against its reference and return every divergence, most-structural
 * first (missing/extra entries, then order, then per-field, then allowlist rot). An EMPTY array
 * is conformance.
 *
 * `where` labels the input the two payloads were produced from (a fixture name, or the repo's
 * real `docs/` tree) so a report over several inputs stays attributable — the same
 * attributability rule ADR-0249 established for oracle reports: evidence that cannot be traced to
 * the observation that produced it is not evidence.
 */
export function compareMirrors(
  reference: Entry[],
  mirror: Entry[],
  spec: MirrorSpec,
  where: string,
): Divergence[] {
  const out: Divergence[] = [];
  const allowlist = new Set(spec.referenceOnlyFields);
  // The declared correct-difference rule, indexed by the entry key each clause exempts. Only the
  // `exempt` disposition reaches the judge at all — `held-constant` and `fenced-elsewhere` are
  // statements about the FIXTURE and about another suite, and exempt nothing here by construction.
  const exemptByKey = new Map<string, ExemptDifference>();
  // An `if` rather than `for (… of spec.correctDifferences ?? [])`: with the `??` fallback, a mutant
  // replacing the empty array is EQUIVALENT — whatever it iterates is skipped by the disposition
  // guard below — so the fallback form is a line no assertion can reach. Most rows carry no rule.
  if (spec.correctDifferences !== undefined) {
    for (const clause of spec.correctDifferences) {
      if (clause.disposition !== "exempt") continue;
      for (const key of clause.keys) exemptByKey.set(key, clause);
    }
  }

  // Duplicates and length FIRST: the maps below are last-row-wins and the order walk spans only
  // `reference.length`, so a mirror of [a,b,c',c] against [a,b,c] passed every later rule — the
  // wrong-valued c' was simply never looked at. Recording them in `out` also suppresses the order
  // walk, whose positional comparison means nothing once the sides disagree on multiplicity.
  const refDupes = duplicateKeys(reference, spec);
  const mirrorDupes = duplicateKeys(mirror, spec);
  if (refDupes.length > 0) out.push({ kind: "duplicate-key", where, side: "reference", keys: refDupes });
  if (mirrorDupes.length > 0) out.push({ kind: "duplicate-key", where, side: "mirror", keys: mirrorDupes });
  // A length mismatch WITHOUT duplicates is already a missing/extra entry below; naming it twice
  // would say the same fact in two vocabularies, so it is reported only where a duplicate hides it.
  if (refDupes.length + mirrorDupes.length > 0 && reference.length !== mirror.length) {
    out.push({ kind: "length", where, reference: reference.length, mirror: mirror.length });
  }

  const refByKey = new Map(reference.map((e) => [keyOf(e, spec), e]));
  const mirrorByKey = new Map(mirror.map((e) => [keyOf(e, spec), e]));

  for (const key of refByKey.keys()) {
    if (!mirrorByKey.has(key)) out.push({ kind: "missing-entry", where, key });
  }
  for (const key of mirrorByKey.keys()) {
    if (!refByKey.has(key)) out.push({ kind: "extra-entry", where, key });
  }

  // Order is part of the payload: both sides sort, and a client that renders the array in order
  // would show a different list. Only compared where both sides agree on the entry SET — otherwise
  // every position after the first missing entry would report a spurious shift.
  if (out.length === 0) {
    for (let i = 0; i < reference.length; i++) {
      const refKey = keyOf(reference[i] as Entry, spec);
      const mirrorKey = keyOf(mirror[i] as Entry, spec);
      if (refKey !== mirrorKey) {
        out.push({ kind: "order", where, position: i, reference: refKey, mirror: mirrorKey });
        break; // one report is enough; the whole tail has shifted
      }
    }
  }

  // Per-field equality over the shared entries.
  for (const [key, refEntry] of refByKey) {
    const mirrorEntry = mirrorByKey.get(key);
    if (mirrorEntry === undefined) continue;
    // A declared correct difference exempts the WHOLE entry: the projections that carry one put a
    // single `value` on each leaf entry, so exempting the key and exempting its field are the same
    // act, and naming the key is what a reader of the rule can check against a failure report.
    if (exemptByKey.has(key)) continue;
    const fields = new Set([...Object.keys(refEntry), ...Object.keys(mirrorEntry)]);
    for (const field of fields) {
      if (allowlist.has(field)) continue;
      const a = render(refEntry[field]);
      const b = render(mirrorEntry[field]);
      if (a !== b) out.push({ kind: "field", where, key, field, reference: a, mirror: b });
    }
  }

  // The allowlist is self-pruning — it may only ever hold a field the reference DOES emit and the
  // mirror does NOT. Either half going false means the entry is stale and must be removed (or the
  // difference is no longer sanctioned), so a rotted allowlist is a loud failure rather than a
  // silently widening exemption.
  for (const field of allowlist) {
    const mirrorEmits = mirror.some((e) => e[field] !== undefined);
    const referenceEmits = reference.some((e) => e[field] !== undefined);
    if (mirrorEmits) {
      out.push({
        kind: "stale-allowlist",
        where,
        field,
        reason: `${spec.mirror} emits it — the difference is no longer ${spec.reference}-only`,
      });
    } else if (!referenceEmits) {
      out.push({
        kind: "stale-allowlist",
        where,
        field,
        reason: `${spec.reference} never emits it — nothing left to exempt`,
      });
    }
  }

  // The correct-difference rule is self-pruning too, and per KEY rather than per clause: a clause
  // may cover several arms, and one of them ceasing to diverge is exactly the rot worth catching.
  // A key that names no entry is a rule about something that no longer exists; a key whose two
  // sides AGREE is a difference that has been repaired, and leaving it declared would keep a real
  // future divergence at that entry permanently invisible.
  for (const [key, clause] of exemptByKey) {
    const refEntry = refByKey.get(key);
    const mirrorEntry = mirrorByKey.get(key);
    if (refEntry === undefined || mirrorEntry === undefined) {
      // Only reportable where the entry is absent from BOTH — a key present on one side alone is
      // already a missing/extra-entry divergence above, and reporting it twice would name the same
      // fact in two vocabularies.
      if (refEntry === undefined && mirrorEntry === undefined) {
        out.push({
          kind: "stale-correct-difference",
          where,
          key,
          difference: clause.difference,
          reason: "neither surface emits this entry — the rule describes something that is gone",
        });
      }
      continue;
    }
    const fields = new Set([...Object.keys(refEntry), ...Object.keys(mirrorEntry)]);
    const differs = [...fields].some(
      (field) => !allowlist.has(field) && render(refEntry[field]) !== render(mirrorEntry[field]),
    );
    if (!differs) {
      out.push({
        kind: "stale-correct-difference",
        where,
        key,
        difference: clause.difference,
        reason: `${spec.reference} and ${spec.mirror} agree here — the difference is gone, so the exemption now hides any future one`,
      });
    }
  }

  return out;
}

/** Render one divergence as a single operator-readable line. */
export function formatDivergence(spec: MirrorSpec, d: Divergence): string {
  switch (d.kind) {
    case "missing-entry":
      return `[${d.where}] ${spec.mirror} is MISSING the entry ${d.key}`;
    case "extra-entry":
      return `[${d.where}] ${spec.mirror} emits an EXTRA entry ${d.key} the ${spec.reference} does not`;
    case "order":
      return `[${d.where}] order diverges at position ${d.position}: ${spec.reference} has ${d.reference}, ${spec.mirror} has ${d.mirror}`;
    case "field":
      return `[${d.where}] ${d.key} field \`${d.field}\`: ${spec.reference}=${d.reference}  ${spec.mirror}=${d.mirror}`;
    case "stale-allowlist":
      return `[${d.where}] stale referenceOnlyFields entry \`${d.field}\`: ${d.reason}`;
    case "stale-correct-difference":
      return `[${d.where}] stale correctDifferences key \`${d.key}\` (${d.difference}): ${d.reason}`;
    case "duplicate-key":
      return `[${d.where}] ${d.side === "reference" ? spec.reference : spec.mirror} carries DUPLICATE entry key(s) ${d.keys.join(", ")}`;
    case "length":
      return `[${d.where}] entry count diverges: ${spec.reference} has ${d.reference}, ${spec.mirror} has ${d.mirror}`;
  }
}

/**
 * The full failure report for one spec: a headline count, the first {@link REPORT_LIMIT} lines,
 * an elision note when there are more, and a per-field census so a 168-instance drift reads as
 * ONE fact rather than 168 lines. Returns `""` when there is nothing to report.
 */
export const REPORT_LIMIT = 20;

export function formatDivergences(spec: MirrorSpec, divergences: Divergence[]): string {
  if (divergences.length === 0) return "";
  const lines: string[] = [
    `✗ ${spec.surface}: ${spec.mirror} has drifted from ${spec.reference} — ${divergences.length} divergence(s)`,
  ];

  // The census first: a field that diverged on many entries is one defect, not many.
  const census = new Map<string, number>();
  for (const d of divergences) {
    if (d.kind === "field") census.set(d.field, (census.get(d.field) ?? 0) + 1);
  }
  if (census.size > 0) {
    const summary = [...census.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([field, n]) => `${field} (${n})`)
      .join(", ");
    lines.push(`  fields that diverged: ${summary}`);
  }

  for (const d of divergences.slice(0, REPORT_LIMIT)) lines.push(`  - ${formatDivergence(spec, d)}`);
  if (divergences.length > REPORT_LIMIT) {
    lines.push(`  … and ${divergences.length - REPORT_LIMIT} more`);
  }
  return lines.join("\n");
}
