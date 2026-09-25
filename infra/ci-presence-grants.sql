-- DB privileges for the CI service account (keyless WIF, infra/ci-presence.tf). Two jobs use it now:
--
--   1. WRITE — the merge-time claim release (ADR-0138 §4 / ADR-0200). `automerge` runs
--      packages/notice-board/src/store/ingest-merge.ts → PgClaimStore.releaseClaimsByBranch, which
--      needs to DELETE the merged branch's `events.node_claim` rows (RETURNING needs SELECT; the
--      in-transaction oldest-waiter promotion needs UPDATE) and append one `events.claim_event`
--      history row per cleared claim.
--   2. READ — the generated-guidance gate rungs. `verify` runs `check:guidance` and `check:agents`,
--      which read the live-canonical Library before comparing committed harness projections.
--   3. WRITE — the work-hierarchy mirror (ADR-0451, `map-freshness-arc`). `automerge` runs
--      `pnpm hierarchy:load`, which re-projects `stories/**` into events.work_* now that the PR is
--      part of `main`, so the mirror cannot lag the branch it mirrors.
--
-- THE CORPUS READ HALF IS READ-ONLY, AND THAT IS A DECISION, NOT AN OVERSIGHT. CI has no business
-- writing the corpus: every corpus write is authored by a session or the studio through a validated
-- write path, and a CI runner is neither. So the grants below add SELECT and nothing else on the
-- library tables. Anything that later wants CI to WRITE the corpus is a new decision, not a wider
-- grant here.
--
-- ⚠ THAT RULE STANDS AND IS NOT WIDENED BY JOB 3 (ADR-0451 D2) — the in-place annotation this
-- paragraph's own sentence above asked for. The discriminator is AUTHORSHIP, not the database: the
-- work-hierarchy tables are a one-directional PROJECTION of `stories/**`, which stays disk-canonical
-- for authoring (ADR-0309 D3) and for proving. CI does not acquire an authoring voice by writing a
-- view derived from a source it does not control, and every row is reproducible from any checkout by
-- one command. The precedent is job 1, three paragraphs down: CI already writes machine-derived facts
-- about the merge. What job 3 still cannot touch: events.verdict, events.attestation and
-- events.library_artifact — no proof can be forged and no corpus row authored.
--
-- SCOPE OF THE IDENTITY, stated because the grants alone understate it: the WIF binding in
-- ci-presence.tf is keyed on the repository (its immutable id, ADR-0622), NOT on a ref, so ANY
-- branch's workflow in this repo can impersonate this SA — and after this widening that buys corpus READS
-- where before it bought only claim-row deletes. The owner considered this on 2026-08-04 and
-- ACCEPTED it: ref-scoping cannot work when `verify` runs on PR branches by definition, the repo is
-- private so only people who can already push could reach it, and a fork PR gets no token at all.
-- Recorded in ADR-0302's corrected cost note. Do NOT add a ref condition without re-deciding that.
--
-- (The events.session/session_event grants that used to lead this file were REMOVED with the
-- presence retirement, ADR-0200 D7 — the tables are dropped by schema.sql. The SA's stale
-- `ci-presence` NAME is a flagged follow-up, not this sweep.)
--
-- Idempotent. Run as the schema owner (hua.mick@gmail.com, keyless) AFTER `terraform apply`.
-- The path is relative to the REPO ROOT — run it from there, not from infra/:
--   STORYTREE_DB_USER=hua.mick@gmail.com pnpm -C packages/cli exec tsx ../../infra/apply-ci-presence-grants.ts

GRANT USAGE ON SCHEMA events TO "storytree-ci-presence@storytree-498613.iam";

-- The story-claim clear (ADR-0138 cap D / ADR-0142): the merge job's ingest-merge calls
-- releaseClaimsByBranch — DELETE ... RETURNING on the claim projection (RETURNING needs SELECT)
-- plus one append-only `released` history row per cleared claim. Added 2026-07-02: the clear had
-- been failing soft ("permission denied for table node_claim") on every merge since cap D landed.
-- UPDATE added 2026-07-16: the ADR-0200 graded ledger promotes the freed unit's oldest live
-- waiter inside the release transaction (`SELECT ... FOR UPDATE` + `UPDATE grade='work'` in
-- PgClaimStore.#promoteOldestWaiter) — FOR UPDATE alone requires UPDATE privilege, so without it
-- the whole release ROLLED BACK fail-soft on every merge since inc 1 (#741) landed.
GRANT SELECT, UPDATE, DELETE ON events.node_claim
  TO "storytree-ci-presence@storytree-498613.iam";
-- SELECT added 2026-09-08, and it is NOT a read grant on the audit log — it is what `RETURNING`
-- costs, exactly as the node_claim paragraph above already says for its own DELETE. ADR-0350 D1 gave
-- the append its own event identity (`INSERT ... RETURNING seq`, claim-store.ts, so a caller can name
-- the take as the CAUSE of a work event) and did not widen the grant beside it. Postgres requires
-- SELECT on every column a statement RETURNS, so the INSERT was refused with
-- `permission denied for table claim_event`, and because releaseClaimsByBranch deletes the claim rows
-- and appends their history in ONE transaction, the WHOLE release rolled back.
--
-- MEASURED, not inferred, on PR #1881's own merge (2026-09-07, job 101882820920) — the first run of
-- this writer after a separate defect (`tsx` unresolvable, 2026-08-23 → 2026-09-08) had stopped it
-- executing at all. `information_schema.role_table_grants` confirmed the account already HELD INSERT,
-- which is what ruled out the obvious reading that the grant was simply missing.
--
-- ⚠ DO NOT NARROW THIS BACK to INSERT on the grounds that CI has no business reading an append-only
-- history. The rule that matters is the one two paragraphs up: a statement that RETURNS needs SELECT.
-- Removing it does not restrict a read — it silently breaks the merge clear again, fail-soft, exactly
-- as it was broken from ADR-0350 D1 until now.
GRANT INSERT, SELECT ON events.claim_event
  TO "storytree-ci-presence@storytree-498613.iam";

-- USAGE on sequences so the claim_event BIGSERIAL `seq` can advance on INSERT. Sequence-only
-- (no table INSERT elsewhere), so this cannot widen write access beyond the tables above.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA events
  TO "storytree-ci-presence@storytree-498613.iam";

-- The corpus READ half. `check:guidance` and `check:agents` read the live-canonical Library;
-- without this they fail with "permission denied for table library_artifact" and cannot verify the
-- committed harness projections.
--
-- SELECT only, on the corpus projection and its append-only history. `library_artifact` is what the
-- retained checks read today; `library_event` is the same corpus's history and is granted with
-- it so that a later READ-ONLY check does not cost a second owner-run round-trip. Neither confers
-- any write: no INSERT, no UPDATE, no DELETE, and no grant on any other table in the schema.
GRANT SELECT ON events.library_artifact, events.library_event
  TO "storytree-ci-presence@storytree-498613.iam";

-- ADR-0451 D1 — the work-hierarchy MIRROR (ADR-0445 D1's first half). The automerge job's
-- `pnpm hierarchy:load` replaces the whole projection in one transaction, so it needs SELECT (the
-- read-back and the store's own reassembly), INSERT and DELETE on the four row tables, and
-- INSERT/UPDATE on the singleton stamp it upserts.
--
-- NO `UPDATE` ON THE FOUR ROW TABLES, DELIBERATELY. The write is a whole-snapshot REPLACE — the
-- projection is total over the tree, so a story deleted from `stories/**` has to vanish, which an
-- upsert could never express. UPDATE would buy the writer nothing and widen the grant past what it
-- does, which is the difference between a grant that describes a caller and one that describes a
-- table.
--
-- WHAT BOUNDS THE DAMAGE, and therefore what makes this acceptable (ADR-0451 D3): every row is
-- re-derivable by `pnpm hierarchy:load` from any checkout; these tables carry NO history to destroy
-- (git is the history — there is no `*_event` sibling); and `check:hierarchy-drift` reads the mirror
-- back against the tree and fails LOUDLY when the two disagree. A forged or wiped mirror is detected
-- by the next gate run and repaired by one command. If any of those three stops holding, re-decide.
GRANT SELECT ON events.work_hierarchy_snapshot, events.work_story, events.work_capability,
                events.work_criterion, events.work_gate
  TO "storytree-ci-presence@storytree-498613.iam";
GRANT INSERT, DELETE ON events.work_story, events.work_capability,
                        events.work_criterion, events.work_gate
  TO "storytree-ci-presence@storytree-498613.iam";
GRANT INSERT, UPDATE ON events.work_hierarchy_snapshot
  TO "storytree-ci-presence@storytree-498613.iam";
