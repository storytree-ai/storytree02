-- storytree runtime store DDL (ADR-0017): JSONB docs, history = append-only events,
-- current = projection. Relationships are id pointers held INSIDE the docs (no cross-table keys).
-- Idempotent: safe to run repeatedly (applied by migrate.ts / loadCorpus).

CREATE SCHEMA IF NOT EXISTS events;

-- Library history: one append-only event per write (created/updated/deleted).
CREATE TABLE IF NOT EXISTS events.library_event (
  seq   BIGSERIAL PRIMARY KEY,
  id    TEXT NOT NULL,
  kind  TEXT NOT NULL,
  type  TEXT NOT NULL CHECK (type IN ('created', 'updated', 'deleted')),
  doc   JSONB,
  actor TEXT NOT NULL,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Library current-state projection: one row per live artifact id.
CREATE TABLE IF NOT EXISTS events.library_artifact (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comment history: append-only.
CREATE TABLE IF NOT EXISTS events.comment_event (
  seq   BIGSERIAL PRIMARY KEY,
  id    TEXT NOT NULL,
  type  TEXT NOT NULL,
  doc   JSONB,
  actor TEXT NOT NULL,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comment current-state projection.
CREATE TABLE IF NOT EXISTS events.comment (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suggestion history: append-only (ADR-0140 suggestions-as-proposals — a proposed edit is a record
-- distinct from a comment, carrying a proposed replacement + original + an open/accepted/rejected
-- status). Mirrors comment_event; `type` is created|transitioned. The DATA half (PgSuggestionStore,
-- packages/library/src/store/pg-suggestion-store.ts) is proven offline; this DDL is its live home,
-- consumed by the accept/reject route (accept-reject-suggestion-api) and the studio backend.
CREATE TABLE IF NOT EXISTS events.suggestion_event (
  seq   BIGSERIAL PRIMARY KEY,
  id    TEXT NOT NULL,
  type  TEXT NOT NULL,            -- created|transitioned
  doc   JSONB,
  actor TEXT NOT NULL,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suggestion current-state projection: one row per suggestion id.
CREATE TABLE IF NOT EXISTS events.suggestion (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members (ADR-0043): app-owned identity. IAP authenticates; the app authorizes from
-- here. History append-only; current = a one-row-per-email projection keyed by the lowercased,
-- verified email. The doc is zod-validated in @storytree/core at the write boundary; the last-admin
-- guard (no lockout) is enforced in PgUserStore's transaction. ("user" is a reserved word — quoted.)
CREATE TABLE IF NOT EXISTS events.user_event (
  seq   BIGSERIAL PRIMARY KEY,
  id    TEXT NOT NULL,
  type  TEXT NOT NULL,            -- created|updated|removed
  doc   JSONB,
  actor TEXT NOT NULL,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events."user" (
  id         TEXT PRIMARY KEY,    -- the lowercased, verified email
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema-migration ledger (design §3 "DB ledger row", Phase 3): the human-facing "which migration
-- ran + when + by whom" audit, complementing the per-row `schemaVersion` stamp inside the docs.
-- Append-only / additive: never alters the tables above.
CREATE TABLE IF NOT EXISTS events.schema_migration (
  version    INT PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL
);

-- Work-hierarchy lifecycle history (drive-machinery Phase A): one append-only event per node
-- lifecycle change. Additive + reversible; the clean home for the lifecycle rows that would
-- otherwise co-mingle with library_event. Nothing writes here yet (the dry-run path uses an
-- InMemoryStore); the rollup projection in @storytree/core reads this stream once wired.
CREATE TABLE IF NOT EXISTS events.work_event (
  seq     BIGSERIAL PRIMARY KEY,
  unit_id TEXT NOT NULL,
  tier    TEXT NOT NULL,
  type    TEXT NOT NULL,            -- proposed|building|verdict|retired|...
  doc     JSONB,
  actor   TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signed proof rows (the prove-it-gate's output, ADR-0020 §4): stops verdicts co-mingling with
-- library_event. `doc` is the full signed Verdict; the scalar columns are the queryable spine.
CREATE TABLE IF NOT EXISTS events.verdict (
  seq        BIGSERIAL PRIMARY KEY,
  unit_id    TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  proof_mode TEXT NOT NULL,
  outcome    TEXT NOT NULL,         -- pass|fail
  commit_sha TEXT NOT NULL,
  signer     TEXT NOT NULL,
  doc        JSONB NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-slice token-usage rows: the runtime-cost SIBLING stream to events.verdict. A signed verdict
-- deliberately carries NO runtime cost (proof and spend are different axes), so what one authoring
-- slice (one SDK query / one owned-loop step) consumed lands HERE, keyed by (unit_id, run_id,
-- phase). Append-only ACCOUNTING, never proof: rollupStatus ignores the kind entirely, so a usage
-- row can never move a unit's derived status. The token columns are the queryable spine a roll-up
-- SUMs over (the four axes bill at different rates — cache reads ~10× cheaper than fresh input —
-- so they are never collapsed); `cost_usd` is the SDK's metered figure (a phantom under
-- subscription billing — advisory context, never a meter); the full doc (incl. the per-model
-- split) rides in `doc`.
CREATE TABLE IF NOT EXISTS events.usage_event (
  seq                   BIGSERIAL PRIMARY KEY,
  unit_id               TEXT NOT NULL,
  run_id                TEXT NOT NULL,
  phase                 TEXT NOT NULL,      -- AUTHOR_TEST|IMPLEMENT (the billing slices)
  source                TEXT NOT NULL,      -- sdk-leaf|owned-loop
  model                 TEXT,
  input_tokens          BIGINT NOT NULL,
  cache_creation_tokens BIGINT NOT NULL,
  cache_read_tokens     BIGINT NOT NULL,
  output_tokens         BIGINT NOT NULL,
  cost_usd              DOUBLE PRECISION,
  doc                   JSONB NOT NULL,     -- the full UsageEventDoc (byModel split lives inside)
  actor                 TEXT NOT NULL,
  at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-slice WRITE-SCOPE records (ADR-0446): what the spine's phase fence did during one authoring
-- slice. The observability sibling of events.usage_event, and the sink both fence mechanisms
-- lacked: the owned loop kept its refusals on the executor instance and ClaudeAgentAuthor returned
-- its refusal to the model, so "does the wall ever actually fire?" could be argued but not measured.
--
-- ONE ROW PER ARMED SLICE, NOT ONE PER REFUSAL. That is the load-bearing shape: a slice that armed
-- the wall and never fired lands a row with refusal_count = 0, so a ZERO is distinguishable from an
-- ABSENCE and the row count is the reading's DENOMINATOR (N refusals across M armed slices on
-- runtime R over period P). Keyed one-per-(run, unit, phase), like usage.
--
-- no_path_calls IS ITS OWN COLUMN, DELIBERATELY. A write-shaped call whose target path cannot be
-- read is a PASS-THROUGH in the owned loop and a fail-closed REFUSAL in the SDK hook; one of the two
-- is wrong, and counting is how anyone finds out which. Summing it into refusal_count would erase
-- exactly that. no_path_disposition records which side this row's mechanism took (refused |
-- passed-through | not-applicable) -- stated by the emitter, never inferred by a reader from source.
--
-- tool_surface_refusals IS ITS OWN COLUMN FOR THE SAME REASON (pi-harness-admission-arc inc 2). The
-- pi leaf refuses a call for the TOOL IT IS -- its shell wall -- before any path is resolved, so
-- such a refusal compared nothing against the phase predicate and is not a write-fence firing at
-- all. Summing it into refusal_count would inflate the one number this table exists to report, and
-- would make "armed and never fired" false for a slice whose surface wall plainly fired. It carries
-- no path, so the detail in doc.toolSurfaceRefusals[] is {tool, reason} -- never {path}.
-- DEFAULT 0 because the three older mechanisms have no such wall: an empty list from them is a
-- measured zero of a wall they do not have, not a missing value.
--
-- OBSERVABILITY ONLY: rollupStatus ignores this kind entirely, so a row here can never move a
-- unit's derived status, and no fence behaviour is conditioned on it.
--
-- Deliberately ABSENT from the ADR-0350 causal-edge enumeration below: nothing stamps a cause on a
-- scope row, and that list exists so a new stream cannot silently acquire columns it has no emitter
-- for. Add it there in the change that starts stamping one, not before.
CREATE TABLE IF NOT EXISTS events.scope_event (
  seq                   BIGSERIAL PRIMARY KEY,
  unit_id               TEXT NOT NULL,
  run_id                TEXT NOT NULL,
  phase                 TEXT NOT NULL,      -- AUTHOR_TEST|IMPLEMENT (the two authoring slices)
  source                TEXT NOT NULL,      -- sdk-leaf|codex-leaf|owned-loop (the armed mechanism)
  model                 TEXT,
  refusal_count         BIGINT NOT NULL,    -- scoped-path refusals; 0 = ARMED AND SILENT, a measurement
  no_path_calls         BIGINT NOT NULL,    -- never folded into refusal_count (see above)
  no_path_disposition   TEXT NOT NULL,      -- refused|passed-through|not-applicable
  tool_surface_refusals BIGINT NOT NULL DEFAULT 0,  -- never folded into refusal_count either (see above)
  doc                   JSONB NOT NULL,     -- the full ScopeEventDoc (each refusal's tool/path/kind inside)
  actor                 TEXT NOT NULL,
  at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADR-0563's replayable attempt/grant/owner-grant/adjudication/pass ledger. Identity makes delivery retry-safe;
-- PgWorkStore rejects a different document attempting to reuse the same identity.
CREATE TABLE IF NOT EXISTS events.inner_loop_event (
  seq          BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL UNIQUE,
  unit_id      TEXT NOT NULL,
  increment_id TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  event        TEXT NOT NULL CHECK (event IN ('attempt', 'grant', 'owner-grant', 'signed-pass', 'adjudication')),
  doc          JSONB NOT NULL,
  actor        TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, increment_id, event, run_id)
);

-- ADR-0578 added the separately authorised owner-grant event after this table was already live.
-- CREATE TABLE IF NOT EXISTS cannot widen an existing CHECK, so converge the old shape in place.
DO $$
DECLARE
  event_check TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO event_check
    FROM pg_constraint
   WHERE conrelid = 'events.inner_loop_event'::regclass
     AND conname = 'inner_loop_event_event_check'
     AND contype = 'c';

  IF event_check IS NULL OR position('owner-grant' IN event_check) = 0 THEN
    ALTER TABLE events.inner_loop_event
      DROP CONSTRAINT IF EXISTS inner_loop_event_event_check;
    ALTER TABLE events.inner_loop_event
      ADD CONSTRAINT inner_loop_event_event_check
      CHECK (event IN ('attempt', 'grant', 'owner-grant', 'signed-pass', 'adjudication'));
  END IF;
END $$;

-- Per-UAT-criterion attestations: append-only signed signals. Current rows bind an exact
-- (criterionId, revisionId); legacy positional test ids remain readable and are migration-classified.
-- A vouch is NOT a proof — this is a DELIBERATELY SEPARATE log from events.verdict (the conflation
-- ADR-0044 d.2 forbids): nothing here ever paints the gate-green hue, and there is NO story roll-up
-- (d.3). The latest-per-(test_id,witness) projection is derived in JS (deriveAttestations), like the
-- verdict glyphs, so there is no projection table to keep atomic. `relayed_by` records the agent that
-- scribed a relayed human attestation ("owner vouched, agent scribed"; d.4). ("attestation" is NOT a
-- reserved word — no quoting needed, unlike events."user".)
CREATE TABLE IF NOT EXISTS events.attestation (
  seq        BIGSERIAL PRIMARY KEY,
  test_id    TEXT NOT NULL,
  outcome    TEXT NOT NULL,           -- pass|fail
  witness    TEXT NOT NULL,           -- human|machine
  signer     TEXT NOT NULL,
  relayed_by TEXT,                    -- the agent/session that scribed a relayed human attestation
  doc        JSONB NOT NULL,          -- the full signed Attestation
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Model-driven UAT DRIVE records (ADR-0295 D1 / ADR-0348 D5): one append-only row per deliberate,
-- out-of-band run in which a model DROVE a story's UAT journey end to end (uat-drive.run.ts). This is
-- the persisted ARTIFACT the cheap standing witness (uat-drive-witness.check.ts) observes — it is
-- emphatically NOT a verdict and must never be read as one: no model signs its own proof (ADR-0295
-- D2). The verdict is still minted by observeAndSign over an exit code the SPINE watched, exactly as
-- for every other observe gate, which is why this stream lives here and not in events.verdict.
-- Deliberately its own table for the same reason events.verdict is (a drive report co-mingled with
-- signed proof is the conflation the whole design exists to avoid). `revision_id` is load-bearing:
-- it binds the record to the EXACT criterion content that was driven (ADR-0253), so re-authoring the
-- journey prose invalidates every prior drive rather than silently carrying its green forward. A
-- `fail` row is recorded too — a journey that did not complete is evidence, not an absence.
CREATE TABLE IF NOT EXISTS events.uat_drive (
  seq          BIGSERIAL PRIMARY KEY,
  story_id     TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  revision_id  TEXT NOT NULL,
  outcome      TEXT NOT NULL,         -- pass|fail
  commit_sha   TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  driver       TEXT NOT NULL,         -- the runtime that drove the journey (e.g. claude-code)
  doc          JSONB NOT NULL,        -- the full UatDriveRecord (per-step log + summary inside)
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UAT HARNESS ENDS: one append-only row per drive that was REFUSED before it could produce a
-- readable journey report (uat-drive-harness-end.ts). An auth, model, configuration, isolation,
-- timing or surface-ownership precondition stopped the machinery, so NOTHING about the product was
-- observed. Before this stream existed such a run persisted nothing at all, and the witness check
-- afterwards said `no drive records … — run the driver`: byte-identical to what it said before the
-- drive was ever attempted, so a broken box and an untouched criterion were indistinguishable.
--
-- ⚠ THIS IS ITS OWN TABLE ON PURPOSE, and moving these rows into events.uat_drive would destroy the
-- property that makes them safe to keep. uat-drive-witness.check.ts selects its product witness from
-- events.uat_drive ALONE, so a harness end is invisible to the witness selector BY CONSTRUCTION
-- rather than by a filter someone has to remember. It declares NO `outcome` column for the same
-- reason: a harness end has nowhere to put `pass`, so it can never be mistaken for a verdict nobody
-- reached. `driver` is nullable because the commonest refusal happens BEFORE a runtime is verified.
CREATE TABLE IF NOT EXISTS events.uat_harness_end (
  seq          BIGSERIAL PRIMARY KEY,
  story_id     TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  revision_id  TEXT NOT NULL,        -- the criterion content that was being attempted (ADR-0253)
  run_id       TEXT NOT NULL,
  phase        TEXT NOT NULL,        -- where the machinery stopped (UatHarnessEndPhase)
  host         TEXT NOT NULL,        -- a launch precondition is usually a property of the box
  driver       TEXT,                 -- NULL when the refusal preceded runtime verification
  commit_sha   TEXT NOT NULL,
  doc          JSONB NOT NULL,       -- the full UatHarnessEndRecord (evidenceClass + cause inside)
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  caused_by_stream TEXT,
  caused_by_seq    BIGINT
);

-- Binding-staleness change log (ADR-0016 §2, the `change` event the ADR adds to the vocabulary):
-- one append-only row per described/undescribed change to a proof unit's bound code, the Postgres
-- home for the `ChangeStore` seam (@storytree/core). The full signed-shape ADR-0016 `ChangeEvent`
-- lives in `doc` (so a read round-trips it byte-for-byte, including an absent description/commitSha);
-- the scalar columns are the queryable spine. `seq` is the TRANSACTION-time order the change log is
-- read back in; `at` defaults to the insertion wall-clock — the doc's own `at` is the VALID-time
-- (ADR-0016 §5 bitemporal) and is NOT necessarily a timestamp (the `storytree drift` CLI uses opaque
-- ordering strings), so it stays inside the JSONB doc, never a TIMESTAMPTZ column. Append-only /
-- additive: never alters the tables above; the latest-per-unit projection is a deferred optimization
-- (the contract `readChangeEvents` returns the full log, which `classifyDrift` consumes).
CREATE TABLE IF NOT EXISTS events.change_event (
  seq         BIGSERIAL PRIMARY KEY,
  unit_id     TEXT NOT NULL,
  hash_before TEXT NOT NULL,
  hash_after  TEXT NOT NULL,
  description TEXT,                  -- present + non-blank ⇒ DESCRIBED (drift); absent ⇒ demoted
  author      TEXT NOT NULL,
  commit_sha  TEXT,                  -- PROVENANCE only — a pointer to the diff, never the drift driver
  doc         JSONB NOT NULL,        -- the full ADR-0016 ChangeEvent (valid-time `at` lives inside)
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADR-number allocator (ADR-0050): hand out the next ADR number ATOMICALLY so two parallel sessions
-- can't pick the same one (the recurring collision the `storytree adr new` command + the CI dup gate
-- close). Append-only allocation log — one row per number ever handed out (slug/branch/actor for the
-- "who took 0050" audit). A row is never updated or reused, so an abandoned branch's number stays
-- BURNED, never recycled (holes are fine). `number` is the PRIMARY KEY, so a racing double-allocation
-- hits a unique violation and the allocator simply recomputes + retries. The next number is
-- GREATEST(the caller's on-disk max ADR, the max already handed out) + 1 — so it RECONCILES against
-- ADRs that landed on main without going through the allocator (an offline-fallback author), never
-- re-handing a number already used. Append-only / additive: never alters the tables above.
CREATE TABLE IF NOT EXISTS events.adr_number (
  number INT PRIMARY KEY,
  slug   TEXT,
  branch TEXT,
  actor  TEXT NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The claim LEDGER (ADR-0200: the noticeboard IS the claim ledger — ADR-0009's claim as plain
-- Postgres, now GRADED). One row per (unit, session) at one of THREE grades:
--   exploring — SHARED: any number of sessions per unit; carries the intent prose (the hovering wisp).
--   waiting   — SHARED: the queue behind a work claim, ordered by claimed_at.
--   work      — the EXCLUSIVE build/edit mutex (ADR-0121/0138 semantics unchanged): at most one
--               session per unit; a second concurrent work claim cannot insert = a HARD REFUSAL
--               that names the holder.
-- The PK is composite (unit_id, session_id) so shared-grade rows coexist; work-grade exclusivity
-- moved from the PK to the `node_claim_work_excl` partial unique index below. Granularity stays
-- the unit id, so different units never contend (the existing per-id property). Staleness reclaims
-- a crashed holder at every grade (ADR-0033's "staleness replaces release discipline"); grade
-- transitions (explore→work upgrade, downgrade, release, promote) are audited in events.claim_event.
-- `intent` and `role` are the TWO halves of what a claim says it is doing (ADR-0346 D3): `role` is
-- the typed enum the map switch-cases for the wisp colour (authoring / proving / supplementing),
-- `intent` is free prose a blocked human reads. `role` is NULLABLE with NO default — deliberately
-- unlike `grade` below, whose backfill to 'work' was correct because every pre-grade row genuinely
-- WAS a work claim. There is no such single right answer for role: a pre-split row's role lives
-- inside its own `intent` string, so NULL means "derive it" (claimRole() in packages/notice-board)
-- and the migration stays additive and pull-based — no backfill, no big-bang.
-- `harness` and `host` say WHO ran the claiming process and WHERE: its agent harness (claude-code /
-- codex) and its MACHINE's hostname. Both NULLABLE with no default — see their migration below.
CREATE TABLE IF NOT EXISTS events.node_claim (
  unit_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  grade        TEXT NOT NULL DEFAULT 'work',
  branch       TEXT NOT NULL,
  intent       TEXT NOT NULL DEFAULT '',
  role         TEXT,
  harness      TEXT,
  host         TEXT,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, session_id)
);

-- MIGRATION (ADR-0200): upgrade an EXISTING pre-graded node_claim in place — the FIRST ALTER in
-- this file (everything above is CREATE IF NOT EXISTS, which never reshapes an existing table).
-- applySchema runs on every boot, so both this block and the fresh CREATE above must converge on
-- the same shape, and every statement here is a guarded no-op on re-run. Existing rows are
-- yesterday's exclusive build/work claims, so 'work' is the correct grade backfill.
ALTER TABLE events.node_claim
  ADD COLUMN IF NOT EXISTS grade TEXT NOT NULL DEFAULT 'work';

-- MIGRATION (ADR-0346 D3): the typed role, added beside the prose `intent` it was extracted from.
-- NULLABLE and UNBACKFILLED on purpose — see the CREATE above. Every existing row keeps reading as
-- it does today because `claimRole()` derives the role from the row's own `intent`; rows acquire a
-- typed role as they are rewritten, one take at a time.
ALTER TABLE events.node_claim
  ADD COLUMN IF NOT EXISTS role TEXT;

-- MIGRATION (claim harness + host): WHO ran the process that took a claim, and WHERE — its agent
-- harness (`claude-code` / `codex`) and the hostname of its MACHINE (`host` is the computer, never
-- the harness). The store stamps both on every take, DETECTED from the claiming process's own
-- environment and `os.hostname()` — never declared by a caller. NULLABLE and UNBACKFILLED on
-- purpose, and permanently: NULL means UNRECORDED — every row taken before this landed, and every
-- row whose writer detected no harness — and it is never inferred backwards. A session id is a
-- worktree name its author chose, so guessing a machine from it is exactly the misattribution these
-- columns exist to end.
ALTER TABLE events.node_claim
  ADD COLUMN IF NOT EXISTS harness TEXT,
  ADD COLUMN IF NOT EXISTS host TEXT;

-- Swap the old single-column PK (unit_id) for the composite (unit_id, session_id), guarded on the
-- catalog: the block acts only when the CURRENT pk column set is exactly (unit_id), so a re-run —
-- or a fresh install, whose CREATE above already made the composite PK — no-ops. Duplicate
-- (unit_id, session_id) pairs are impossible coming from the old shape (unit_id WAS the PK); if an
-- out-of-band write ever produced one, ADD CONSTRAINT would abort the transaction FAIL-CLOSED —
-- no row is ever silently dropped.
DO $$
DECLARE
  pk_name TEXT;
  pk_cols TEXT[];
BEGIN
  SELECT c.conname,
         ARRAY(SELECT a.attname::text
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                ORDER BY k.ord)
    INTO pk_name, pk_cols
    FROM pg_constraint c
   WHERE c.conrelid = 'events.node_claim'::regclass AND c.contype = 'p';

  IF pk_cols = ARRAY['unit_id'] THEN
    EXECUTE format('ALTER TABLE events.node_claim DROP CONSTRAINT %I', pk_name);
    ALTER TABLE events.node_claim
      ADD CONSTRAINT node_claim_pkey PRIMARY KEY (unit_id, session_id);
  END IF;
END $$;

-- Work-grade exclusivity (ADR-0200 D2): at most ONE work claim per unit; shared grades
-- (exploring / waiting) are unconstrained. Sits AFTER the migration block so the grade column
-- already exists on an upgraded table when this runs.
CREATE UNIQUE INDEX IF NOT EXISTS node_claim_work_excl
  ON events.node_claim (unit_id) WHERE grade = 'work';

-- Claim audit history: one append-only row per claim/reclaim/release/conflict-refused, so a refusal
-- is a TYPED event (ADR-0009 "a conflict is a hard refusal, never a warning") and the evidence for
-- "overlap conflicts are routine" accrues here (ADR-0033 §4). Same append-only shape as the other
-- events.*_event history streams.
CREATE TABLE IF NOT EXISTS events.claim_event (
  seq        BIGSERIAL PRIMARY KEY,
  unit_id    TEXT NOT NULL,
  type       TEXT NOT NULL,          -- claimed|reclaimed|released|conflict-refused
  session_id TEXT NOT NULL,          -- the session that acted (the would-be/actual holder)
  doc        JSONB NOT NULL,         -- the full claim doc (or, for a refusal, the blocking holder)
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-session cursor over the sequenced claim_event log (ADR-0200 D4): deltas that intersect a
-- session's OWN claim set are delivered ONCE, riding outputs the agent already reads — the cursor
-- records the last seq the session has heard, advanced atomically with delivery. Self-baselined to
-- the current max seq on first read, so a fresh session never floods on backlog.
CREATE TABLE IF NOT EXISTS events.claim_cursor (
  session_id TEXT PRIMARY KEY,
  last_seq   BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes (ADR-0017).
CREATE INDEX IF NOT EXISTS claim_event_unit_idx ON events.claim_event (unit_id);
CREATE INDEX IF NOT EXISTS library_artifact_kind_idx ON events.library_artifact (kind);
CREATE INDEX IF NOT EXISTS library_event_id_idx ON events.library_event (id);
CREATE INDEX IF NOT EXISTS work_event_unit_idx ON events.work_event (unit_id);
CREATE INDEX IF NOT EXISTS verdict_unit_idx ON events.verdict (unit_id);
CREATE INDEX IF NOT EXISTS usage_event_unit_idx ON events.usage_event (unit_id);
CREATE INDEX IF NOT EXISTS scope_event_unit_idx ON events.scope_event (unit_id);
CREATE INDEX IF NOT EXISTS scope_event_at_idx ON events.scope_event (at);
CREATE INDEX IF NOT EXISTS inner_loop_event_unit_increment_idx
  ON events.inner_loop_event (unit_id, increment_id, seq);
-- The owner question is a globally single-spend authority, even if two units race to use it.
CREATE UNIQUE INDEX IF NOT EXISTS inner_loop_owner_grant_authority_unique
  ON events.inner_loop_event ((doc ->> 'authorityQuestionRef'))
  WHERE event = 'owner-grant';
CREATE INDEX IF NOT EXISTS user_event_id_idx ON events.user_event (id);
CREATE INDEX IF NOT EXISTS attestation_test_idx ON events.attestation (test_id);
CREATE INDEX IF NOT EXISTS uat_drive_criterion_idx ON events.uat_drive (criterion_id);
CREATE INDEX IF NOT EXISTS uat_harness_end_criterion_idx ON events.uat_harness_end (criterion_id);
CREATE INDEX IF NOT EXISTS change_event_unit_idx ON events.change_event (unit_id);

-- MIGRATION (ADR-0350 D1): the CAUSAL EDGE — two nullable columns on every append-only stream, so an
-- event caused by another event can say so AT EMISSION. `caused_by_stream` names the cause's table
-- and `caused_by_seq` its BIGSERIAL primary key; together they are a qualified reference to the only
-- addressable event identity that exists today. Deliberately NOT a cross-table constraint, per
-- ADR-0017's rule that relationships are plain id references — and deliberately no global event id
-- (ADR-0350 candidate B, refused on sequencing: it would need every stream migrated before a single
-- edge could be drawn).
--
-- NULLABLE AND UNBACKFILLED, PERMANENTLY. ADR-0350 D2: the emitter stamps it or it is absent, and
-- nothing downstream may fill the silence — no backfill pass, no correlation job, no "nearest
-- preceding event in the same run", no join on unit_id plus adjacency. Under-reporting is the
-- ACCEPTED failure mode here; inference is the banned repair. So NULL means UNRECORDED, and it is
-- every reader's job (D3) to render that as `caused by: not recorded` rather than as a blank that
-- would read as "nothing caused this".
--
-- ALTER-ONLY, WITH NO MATCHING EDIT TO THE CREATEs ABOVE, AND THAT STILL CONVERGES: applySchema runs
-- this whole file on every boot, so a fresh install CREATEs each table and then arrives here, ending
-- at the identical shape an existing database reaches. Every statement is a guarded no-op on re-run.
--
-- THE LIST IS THE ELEVEN append-only streams that carry a BIGSERIAL primary key. ADR-0350 D1 says
-- "ten"; the count was accurate when it was written and the tree has since grown one, so the ADR's
-- number is stale while its rule is not. Kept as an explicit enumeration rather than a catalog loop
-- so that a NEW stream does not silently acquire causal columns it has no emitter for — adding one
-- here should be a decision someone writes down.
ALTER TABLE events.library_event    ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.comment_event    ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.suggestion_event ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.user_event       ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.work_event       ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.verdict          ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.usage_event      ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.attestation      ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.uat_drive        ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.change_event     ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;
ALTER TABLE events.claim_event      ADD COLUMN IF NOT EXISTS caused_by_stream TEXT,
                                    ADD COLUMN IF NOT EXISTS caused_by_seq    BIGINT;

-- RETIREMENT (ADR-0200 D7): the self-reported session-presence tables (ADR-0033's
-- events.session_event history + events.session projection) are DROPPED — the claim ledger
-- (events.node_claim + events.claim_event above) is the one session-coordination machinery now.
-- Every reader/writer was deleted first (the presence core + all consumers, #760–#765), so
-- nothing can touch these tables by the time this runs. `IF EXISTS` is the guard — the second
-- droppable-migration precedent in this file (after the ADR-0200 D2 node_claim ALTER block):
-- applySchema runs on every boot, so the first run drops, every later run (and a fresh install,
-- which never created them) no-ops. History is dropped WITH the projection: presence rows were
-- always advisory, carried no signer chain, and audit-grade coordination history lives in
-- events.claim_event. Ordered history-then-projection for symmetry with creation order.
DROP TABLE IF EXISTS events.session_event;
DROP TABLE IF EXISTS events.session;

-- MIGRATION (pi-harness-admission-arc inc 2): give an EXISTING events.scope_event the pi leaf's
-- tool-surface count. Guarded no-op on re-run and on a fresh install, which reaches the identical
-- shape from the CREATE above -- the same converging pattern as the ADR-0350 causal columns.
--
-- The backfill to 0 is CORRECT rather than merely convenient, and it was checked rather than
-- assumed: the table held ZERO rows when this landed (verified 2026-08-25 via `storytree node
-- walls --pg`, which reported NOTHING RECORDED). Even on a populated table it would be right --
-- every pre-existing emitter is one of the three mechanisms that has no tool-surface wall to fire.
ALTER TABLE events.scope_event
  ADD COLUMN IF NOT EXISTS tool_surface_refusals BIGINT NOT NULL DEFAULT 0;

-- ===========================================================================
-- THE WORK-HIERARCHY PROJECTION (ADR-0445 D1, `map-freshness-arc` inc-02)
-- ===========================================================================
--
-- The forest map JOINS signed verdicts (live, from events.verdict) against the story shape read by
-- `readTree(storiesDir)` from `stories/**` on the APP'S OWN DISK, frozen at the commit the app was
-- built from. Verdicts bind to criteria by (criterionId, revisionId) (ADR-0253), so a stale app
-- reads the database perfectly, matches no verdict for a criterion re-worded since, and correctly
-- paints yellow. Criteria declared on `main` went 261 (2026-08-05) -> 113 (2026-08-24): the staler
-- the client, the yellower the map. These five tables put the QUESTION half of that join in the same
-- place the PROOF half already lives, so the two can eventually come from one clock.
--
-- A PROJECTION, ONE-DIRECTIONAL. Disk stays canonical for AUTHORING (`story-author` writes markdown
-- under stories/**, ADR-0309 D3) and for PROVING (the corpus guard, check:boundaries, the build
-- drivers and CI read the commit under test — a story pulled live while CI tests a branch would
-- validate the wrong thing). Nothing writes back to disk and nothing authors into these rows.
--
-- NO `*_event` HISTORY SIBLING, DELIBERATELY. Every other stream here pairs a projection with an
-- append-only log because those rows are AUTHORED here and the store is the only place their history
-- could live. These rows are authored in git: `git log -p -- stories/` is the history, complete and
-- signed, and a second copy of it in Postgres could only ever drift from the first.
--
-- ABSENT FROM THE ADR-0350 CAUSAL-EDGE ENUMERATION ABOVE, CORRECTLY: that list is the append-only
-- streams carrying a BIGSERIAL primary key, and it is an explicit enumeration precisely so a new
-- table cannot silently acquire columns it has no emitter for. These are keyed projections with no
-- event identity and nothing stamps a cause on them. Do not add them there.
--
-- WRITTEN AS A WHOLE-SNAPSHOT REPLACE INSIDE ONE TRANSACTION (PgWorkHierarchyStore.writeSnapshot):
-- the projection is TOTAL over the tree, so a story deleted from `stories/**` must vanish from here,
-- which an upsert-only loader could never achieve. Postgres MVCC means a concurrent reader sees the
-- previous complete snapshot until COMMIT — never a half-loaded tree.

-- The STAMP: one singleton row saying which tree these rows are a projection OF.
-- `stories_tree_sha` is the git TREE object id of `stories/` (`git rev-parse <ref>:stories`) and is
-- the field freshness is judged on. A tree id is a CONTENT hash, so two commits whose stories/ are
-- byte-identical share it — which is what lets a projection generated from a PR merge ref be
-- recognised as current for the `main` commit that merge produces. `commit_sha` is PROVENANCE only:
-- a squash merge discards the commit it names, so nothing may be judged on it.
CREATE TABLE IF NOT EXISTS events.work_hierarchy_snapshot (
  id               TEXT PRIMARY KEY,   -- the singleton key, 'current'
  schema_version   INT NOT NULL,
  commit_sha       TEXT NOT NULL,      -- provenance only, never judged
  stories_tree_sha TEXT NOT NULL,      -- the freshness key
  generated_at     TIMESTAMPTZ NOT NULL,
  generator        TEXT NOT NULL,      -- hierarchy:load | a CI job | a test
  actor            TEXT NOT NULL,
  story_count      INT NOT NULL,       -- the denominators, so agreement and emptiness differ
  capability_count INT NOT NULL,
  criterion_count  INT NOT NULL,
  gate_count       INT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per story. `doc` is the ProjectedStory WITHOUT its criteria/gates arrays — those are the
-- two tables below, so there is exactly one copy of each obligation and no way for the nested and
-- the normalised copies to disagree. The scalar columns are the queryable spine (ADR-0017).
CREATE TABLE IF NOT EXISTS events.work_story (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT,                    -- NULL only for an unreadable spec (doc.error is set)
  proof_mode  TEXT NOT NULL,
  uat_witness TEXT,                    -- the DECLARED value; NULL = undeclared, never defaulted here
  doc         JSONB NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per capability, keyed by an id unique across the whole tree (the corpus guard enforces it).
CREATE TABLE IF NOT EXISTS events.work_capability (
  id             TEXT PRIMARY KEY,
  story_id       TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT,
  proof_mode     TEXT NOT NULL,
  contract_count INT NOT NULL,
  doc            JSONB NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per authored UAT criterion, INCLUDING would-be ones — the would-be filter is a RULE and
-- rules stay with the reader (ADR-0445's rule half is open by design). `revision_id` is its own
-- column because it is THE join key against events.verdict / events.attestation / events.uat_drive:
-- "which criteria have no verdict at their CURRENT revision" is the question this whole arc exists
-- to make answerable, and burying the revision in JSONB would make it a JSON path expression.
-- `ordinal` preserves the authored order the story prose walks in.
CREATE TABLE IF NOT EXISTS events.work_criterion (
  criterion_id TEXT PRIMARY KEY,
  story_id     TEXT NOT NULL,
  revision_id  TEXT NOT NULL,
  ordinal      INT NOT NULL,
  witness      TEXT NOT NULL,
  would_be     BOOLEAN NOT NULL,
  doc          JSONB NOT NULL
);

-- One row per authored reliability gate (ADR-0085), INCLUDING retired ones — `activeReliabilityGates`
-- is likewise the reader's rule. `covers` is its own column because ADR-0097's per-capability
-- coverage fold reads it.
CREATE TABLE IF NOT EXISTS events.work_gate (
  id       TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  ordinal  INT NOT NULL,
  kind     TEXT NOT NULL,
  covers   TEXT[] NOT NULL DEFAULT '{}',
  retired  BOOLEAN NOT NULL,
  doc      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS work_capability_story_idx ON events.work_capability (story_id);
CREATE INDEX IF NOT EXISTS work_criterion_story_idx ON events.work_criterion (story_id);
CREATE INDEX IF NOT EXISTS work_criterion_revision_idx ON events.work_criterion (criterion_id, revision_id);
CREATE INDEX IF NOT EXISTS work_gate_story_idx ON events.work_gate (story_id);

-- ---------------------------------------------------------------------------
-- The shared CONTEXT-TRAVERSAL EVENT LOG (ADR-0484 D1): storytree's own telemetry, moved out of
-- per-machine JSONL and into the one store. Our own commands are recorded by our own process into
-- our own store; nothing about capturing a `storytree` command depends on the harness.
--
-- WRITTEN OUT OF BAND, NEVER ON THE COMMAND'S PATH (ADR-0484 D4). The capture path still writes the
-- local JSONL line synchronously and returns; a separate, detached shipper drains that file into
-- this table and retries. So a row here is a SHIPPED copy of a durable local line — `shipped_at` is
-- when it arrived, `observed_at` (the event's own `at`) is when it happened, and the two differ by
-- however long the ship took. A command never waits on this table and never fails because of it.
--
-- `event_id` is UNIQUE rather than the primary key so `seq` can carry APPEND ORDER, which is the
-- only "earlier" the producer is allowed to know (ADR-0235) and the order the JSONL reader returns.
-- The uniqueness is what makes a re-ship idempotent: a retry after a partial failure re-sends lines
-- that may already have landed, and `ON CONFLICT (event_id) DO NOTHING` absorbs them.
--
-- `grade` / `slot` are the line-identity attributes the JSONL sink stamps beside each event
-- (`linked-session-context-arc-inc-30`), carried across unchanged: NULL is a legacy slot-era line
-- and is labelled, never retrofitted.
--
-- ⚠ HISTORY IS NOT MIGRATED (ADR-0484 D6, owner-directed). Every existing local trace stays valid
-- and stays where it is; a reader spanning the change reads two stores. The shipper baselines a
-- session's cursor at the file's CURRENT END the first time it appends after this landing, so what
-- lands here is what was traced FORWARD from it.
CREATE TABLE IF NOT EXISTS events.traversal_event (
  seq         BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  session_id  TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,   -- the event's own `at`, never the ship time
  grade       TEXT,                   -- window|declared; NULL = the legacy slot era
  slot        TEXT,                   -- the worktree slot, a GROUPING attribute beside the identity
  origin      TEXT,                   -- human|cut; NULL = UNDECLARED, and never read as `human`
  cut_by      TEXT,                   -- the session that cut this one, when it named itself
  cut_for     TEXT,                   -- the arc/increment it was cut to drive (a canonical id)
  harness     TEXT,                   -- claude-code|codex, DETECTED from the writer; NULL = UNRECORDED
  host        TEXT,                   -- the writing MACHINE's hostname, not the harness; NULL = UNRECORDED
  event       JSONB NOT NULL,         -- the whole ContextTraversalEvent, validated before it ships
  shipped_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WHO STARTED THE SESSION (ADR-0484 D7), additive for a store that already holds the table.
--
-- ⚠ NULL IS "UNDECLARED", NOT "HUMAN". Every row written before this landing carries NULL and stays
-- that way: an origin is never inferred after the fact from timing, branch names or worktree reuse,
-- because a guessed provenance cannot be told apart from a recorded one. Any figure that attributes
-- a read to what the owner asked for must first exclude the NULL rows rather than absorb them.
ALTER TABLE events.traversal_event ADD COLUMN IF NOT EXISTS origin  TEXT;
ALTER TABLE events.traversal_event ADD COLUMN IF NOT EXISTS cut_by  TEXT;
ALTER TABLE events.traversal_event ADD COLUMN IF NOT EXISTS cut_for TEXT;

-- WHICH AGENT HARNESS AND WHICH MACHINE WROTE THE LINE, additive on the same terms as the origin
-- columns above. `harness` is the agent harness the writing process ran under (`claude-code` or
-- `codex`); `host` is that process's MACHINE — its hostname — and NOT the "host" harness the older
-- traversal vocabulary means by that word (`surface:host_transcript`, "the host transcript").
--
-- ⚠ BOTH ARE DETECTED FROM THE WRITING PROCESS, NEVER DECLARED, AND NULL IS "UNRECORDED". Every row
-- written before this landing carries NULL and stays that way: neither is ever inferred after the
-- fact — not from a slot, a branch name, a clock, or which box the store happens to be read from —
-- because an inferred provenance cannot be told apart from a recorded one. That inference is the
-- mistake these columns exist to end: roughly forty hours of Codex work on a Windows laptop were
-- once read as work done on a second Linux box, because no row said either fact.
ALTER TABLE events.traversal_event ADD COLUMN IF NOT EXISTS harness TEXT;
ALTER TABLE events.traversal_event ADD COLUMN IF NOT EXISTS host    TEXT;

CREATE INDEX IF NOT EXISTS traversal_event_session_idx ON events.traversal_event (session_id, seq);
