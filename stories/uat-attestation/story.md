---
id: "uat-attestation"
tier: story
title: "UAT attestation — each UAT test earns green by its witness; a vouch never forges a green"
outcome: "A story's UAT is a set of individually-addressable tests, each declaring a witness (human, machine, or either). A test earns a real signed verdict by its witness — a machine proof, or a human's 'I saw it work' operator attestation — and the story's own UAT greens as the AND-roll-up of those per-test verdicts. A separate, lower-rigor vouch ('I also eyeballed it') stays in the detail view, distinct from a gate-proven pass, and never greens the story. No path ever forges a green."
status: proposed
proof_mode: UAT
# Arc membership (ADR-0183 / ADR-0209): a RESHAPED child of the `model-uat-promotion` arc. This story
# is the historical home of the per-test witness model ADR-0209 amends; its classified binary witness
# enum is superseded by the three-kind tiered model authored in the arc's first increment
# `stories/model-uat-witness`, while `either` remains legacy-only parse compatibility until the staged
# corpus migration completes. See the ADR-0209 reconciliation note below. This story's own
# (still-unbuilt) vouch-vs-proof + AND-roll-up journey is otherwise untouched.
arc: model-uat-promotion
capabilities: [uat-test-units, attestation-signals, attestation-surface]
depends_on: [studio, library]
# ADR-0166 artifact edges: the deliberate NON-IMPORT seams among the depends_on above (build-artifact /
# write-target / hosted-seam consumption, narrated per-edge in the comments/body of this spec) — the
# declared-edge honesty gate accepts these without a code import; remove an entry if the seam ever
# becomes a real package import.
artifact_edges: [studio, library]
decisions: [44, 82, 209]
---

# UAT attestation — each UAT test earns green by its witness; a vouch never forges a green

**Outcome —** A story's UAT is a set of individually-addressable tests, each declaring a witness
(human, machine, or either). A test earns a real signed verdict by its witness — a machine proof, or
a human's "I saw it work" operator attestation — and the story's own UAT greens as the AND-roll-up of
those per-test verdicts. A separate, lower-rigor vouch ("I also eyeballed it") stays in the detail
view, distinct from a gate-proven pass, and never greens the story. No path ever forges a green.

The deciding ADRs are ADR-0044 — which
refines ADR-0040's story-level human-witness signpost down to the individual UAT test (a story has one
tree but many UAT test criteria, and "always allow both" human and machine) — and
ADR-0082,
which **supersedes-in-part ADR-0044 §2/§3**: a human stamp on a declared-human test is now a *real
signed verdict* that greens it (ADR-0007's `operator-attested` mode), not only a never-green signal,
and a story's own UAT greens as the AND-roll-up of its per-test verdicts. The honesty rule is
untouched: green is still a signed verdict, and no one can forge one.

> **Reconciliation — ADR-0209 (the `model-uat-promotion` arc) supersedes-in-part this story's witness
> model.** ADR-0209 (accepted 2026-07-17) amends ADR-0082 to add a THIRD witness kind: a criterion now
> resolves to deterministic `machine`, capability-tiered `model` (a rubric-bound read-only model judge,
> tiered `advanced` / `frontier`), or irreducible `human`. The binary `witness: human | machine |
> either` this story's design floor and `uat-test-units` capability describe is therefore **overtaken
> for classified criteria**: `model` is a distinct new kind (not a spelling of `machine`), while
> `either` remains only as a legacy parse/unresolved compatibility state for existing untagged
> criteria until the explicitly staged corpus migration completes. Legacy `either` can never carry a
> model tier or enter model judgment by default; new and migrated criteria classify explicitly as
> `machine | model | human`. That three-kind tiered witness model + its eligibility registry is authored in the
> arc's first increment, [`stories/model-uat-witness`](../model-uat-witness/story.md), authored at
> the time as the packages-forward `@storytree/model-uat` port in its own `packages/model-uat`
> building (ADR-0192). ⚠ THAT BUILDING IS GONE as of 2026-08-31: ADR-0247 D1 retired the rubric
> judge and the three-kind witness outright, D5 retired the packages, and
> `model-uat-family-consolidation-arc` deleted all three. The criterion PARSER — the only module
> anything live still reached — was lifted into `packages/uat-criterion`. The story row above stays
> browsable as history (ADR-0247 D2); it no longer names a live port.
> The existing Library parser stays library-owned until explicit consumer adapter/re-export glue moves
> it behind that port; the new story claims no proof-bound `packages/library` source. The
> independent spine-signed model JUDGE run, the per-criterion seed-canonical Library detail artifact, the
> Studio row concision, and the three-story pilot migration are later arc increments. This story's own
> vouch-vs-proof + AND-roll-up journey (below) is unbuilt (`proposed`) and untouched by ADR-0209 except
> for the witness enum; read the sections below as pre-ADR-0209 history for the binary enum, and defer to
> `model-uat-witness` for the resting witness model.

## Design floor (ADR-0044, reconciled by ADR-0082)

- **Granularity = the UAT test.** Both a proof and a vouch attach to one test, not the whole story.
- **Both witnesses, first-class.** A test declares `witness: human | machine | either`.
- **Two tiers, never conflated:**
  - A **proof** is a real signed verdict in `events.verdict`, earned by the test's witness — a
    `machine` proof, or a `human`'s `operator-attested` sign-off signed by a real person. It greens
    the test, and the story's own UAT crown greens as the AND-roll-up of its per-test verdicts
    (`rollupStoryUat`, ADR-0082 d.3). A sign-time guard (`checkUatProof`) keeps it honest: a
    machine-witness test can't be greened by a click, and an agent can never self-attest a human
    test — so a green is never forged.
  - A **vouch** is the lower-rigor `events.attestation` "I also eyeballed it" mark (signer, witness,
    note, `relayedBy` when an agent scribed for a human). It lives in a separate log, NEVER in
    `events.verdict`, never paints the gate-green hue, and never rolls up (ADR-0044 d.2/d.3 stand,
    scoped to the vouch).
- **Distinct, in detail.** The proof tier and the vouch tier are never conflated on any surface.
  `storytree tree <story>` carries BOTH in separate columns — `proven=✓/✗/–` read from
  `events.verdict`, and the ◉/▣ vouch mark read from `events.attestation`. The studio row carries the
  SIGNED verdict only: one right-edge glyph whose shape is the witness (robot/person) and whose colour
  is the verdict. *(Corrected 2026-07-26: the ⚑/⚐ vouch this bullet used to promise in the panel was
  REMOVED from the row by an owner UX call — two look-alike actions confused the sign affordance,
  `apps/studio/src/components/TreeView.tsx`. `/api/attestations` still carries the vouch marks; the
  panel just never renders them.)*

## Capabilities (3)

| # | capability | outcome | status | depends on |
|---|---|---|---|---|
| 1 | [`uat-test-units`](uat-test-units.md) | A story's UAT steps become stable, addressable test units, each declaring whether a human, a machine, or either can attest it. | proposed | — |
| 2 | [`attestation-signals`](attestation-signals.md) | A per-test attestation persists as an append-only signed signal (human or machine), with relayed-by provenance, separate from gate verdicts and never rolled up. | proposed | `uat-test-units` |
| 3 | [`attestation-surface`](attestation-surface.md) | The story detail (panel + CLI) shows each UAT test's PROVEN verdict (the signed gate state that can green the story) distinct from its lower-rigor vouch (never green). | proposed | `attestation-signals` |

## UAT Test Criteria (would-be)

The bold lead is each test's title; the `(witness: …)` tag declares who may attest it (parsed by
`uat-test-units` into `<story>#uat-<n>` ids — absent ⇒ `either`).

> **Per-leg witness (ADR-0209 §1 / ADR-0106 / ADR-0070). RE-ADJUDICATED 2026-07-26** under the
> ADR-0209 §8 corpus-wide migration. That pass resolved this story to six `machine` legs and one
> `human` leg; no leg is model-judged — nothing here turns on semantic judgment of prose or artifacts,
> so the model rung genuinely does not apply. **NARROWED 2026-08-11 (ADR-0348 D6): the one `human` leg
> is DELETED, so the story carried six `machine` legs and ZERO `human` legs from that date.** *(This
> read "so the story NOW carries six `machine` legs"; the ADR-0294 D2/D4 pass below then deleted legs
> 1, 2 and 5, leaving THREE. Corrected in place 2026-08-20 per ADR-0139 — the 2026-08-11 narrowing
> itself is unchanged.)* It asked whether the
> two rigor tiers are any GOOD to read, not whether the journey achieved its goal — a user EXPERIENCE
> property, not a user ACCEPTANCE criterion. Because that claim is this story's own reason to exist,
> its intent is carried at length under "The rigor tiers must READ apart" below rather than in a line.
> (It is also structurally unreachable from a story's prose today:
> `UAT_TEST_CRITERION_WITNESSES` in `packages/library/src/uat-test-criteria.ts` is
> `human | machine | either` and THROWS on `model`, and `proof-protocol`'s `UatWitness` is
> `human | machine`. The gap between ADR-0209's three-kind model and that enum is an OPEN owner fork
> carried by the arc — recorded here, not settled here.)
>
> **This story is ABOUT attestation, so read its legs carefully.** A leg that DESCRIBES human
> witnessing does not thereby NEED a human witness. Legs 2 and 5 — *Human verdict* and *Vouch never
> greens*, both since deleted by the ADR-0294 D2/D4 pass below, which found their proof one rung down
> in exactly the suites this paragraph names — were tagged `human` because their
> subject matter is an operator's signature and an operator's vouch — but their success conditions are
> a verdict's shape, its signer, and the ABSENCE of a write, every one of which has a compiler and is
> already exercised offline today (`packages/orchestrator/src/proof/uat-proof.test.ts`,
> `apps/studio/server/uatVerdict.test.ts`, `apps/studio/server/uatAttestApi.integration.test.ts`,
> `apps/desktop/src/backend/local-uat-attest.test.ts`, `packages/cli/src/uat.test.ts`,
> `packages/cli/src/attest.test.ts`). Under `human-witness-is-a-judgment-gap-not-cost` the human rung is
> for a success condition with NO compiler — never for a leg whose *topic* is humans, and never for a
> refusal (an agent that cannot self-attest, a click that cannot green a machine leg, a vouch that
> cannot reach `events.verdict`) — a refusal is among the most machine-checkable things there is.
>
> Exactly **one** leg stayed `human` after that pass, on the NO-COMPILER basis — not spend, not an
> outward-facing action: whether the two rigor tiers actually READ as different to a person (leg 7).
> Everything STRUCTURAL about that distinctness — which glyph, which colour, which column, which state
> can even reach the row — is machine-observable and is leg 6; only the legibility verdict was
> irreducible, and `apps/studio/src/index.css` already records the row's icon styling as owner-attested
> art (ADR-0070). **ADR-0348 D6 deleted that leg**: having no compiler was never enough to make it an
> acceptance claim, which is the question that now comes first. Nothing about the rule above is
> weakened — a leg whose TOPIC is humans still does not thereby need a human witness, and a refusal is
> still among the most machine-checkable things there is.
>
> **Stale prose corrected before it became executable (2026-07-26).** The old leg 6 asserted that the
> studio panel shows a `✓/✗/–` PROVEN glyph "distinct from the lower-rigor vouch (⚑/⚐)". That is FALSE
> against the panel today: an owner UX call REMOVED the ⚑/⚐ vouch from the row (two look-alike actions
> confused the sign affordance — `apps/studio/src/components/TreeView.tsx`), and the row now carries ONE
> right-edge glyph whose SHAPE is the witness (robot/person) and whose COLOUR is the signed verdict; the
> `/api/attestations` payload still carries the vouch marks, the panel just never renders them. The
> two-mark display survives only on the CLI (`storytree tree <story>`). Tagged `machine` against the old
> wording, leg 6 would have been a false red against correct code. It is restated below to what the
> surfaces actually do; the Design floor and [`attestation-surface`](attestation-surface.md) carried the
> same drift and are corrected there.
>
> **Nothing here is green.** Per ADR-0209 §6 a substantive criterion change invalidates the old green,
> so every leg below is UNSTAMPED and earns green only under its newly-declared witness. This story is
> `proposed` and its section is `(would-be)`: tagging a leg `machine` with no spec yet is the honest
> classification, not a claim that a proof exists. No owner attestation has ever been recorded against
> any leg of this story, so the standing open call — *does an owner attestation carry forward onto a
> SPLIT leg, or must it be re-signed?* ([`wisp-as-story-claim`](../wisp-as-story-claim/story.md), open
> modeling call 1, for the owner to settle once and generally) — does not bite on the leg-6 split here.
>
> **Ordering note (leg ids are POSITIONAL, `uat-attestation#uat-N`).** Legs 1–5 kept their positions
> through every pass. The old leg 6 was narrowed IN PLACE and its irreducible human half APPENDED as
> leg 7 rather than interleaved. **ADR-0348 D6 then deleted leg 7 on 2026-08-11 and BURNED the
> ordinal**, and the ADR-0294 D2/D4 pass of 2026-08-20 deleted legs **1**, **2** and **5** and burned
> those too — nothing has ever been renumbered, so every surviving position still denotes exactly what
> it always did. *(This read "`packages/cli/src/attest.test.ts` uses `uat-attestation#uat-2` and
> `uat-attestation#uat-3` as fixture ids, so *Human verdict* and *Machine* must stay at 2 and 3." That
> is no longer true and was checked before acting: since ADR-0253 that fixture keys off a `uatc_*`
> criterion id and a bare story id, and `grep -rn "uat-attestation#" packages apps` returns nothing at
> all — no code anywhere carries a positional id for this story. The don't-renumber rule stands on its
> own (`asset:edit-story-uat-criteria`); only its stated evidence had gone stale. Corrected in place
> per ADR-0139.)*
>
> **ADR-0294 D2/D4 pass, 2026-08-20 — THREE of six legs deleted (1, 2, 5); the three survivors (3, 4,
> 6) are declared UNBOUND.** The third and final slice of the D4 pass over live stories (predecessors:
> PR #1444, the desktop terminal cluster; PR #1448, the studio/claim cluster).
>
> **Read the method here before reusing it, because the cheap shortcut gives the WRONG answer on this
> story.** The rule of thumb carried into this pass was: where a story's capabilities register no
> `proof.real.testFile` at all, there is no lower tier to name and D2 cannot be discharged for ANY leg
> (which is why `studio-build`'s legs were kept twice). All THREE of this story's capabilities —
> [`uat-test-units`](uat-test-units.md), [`attestation-signals`](attestation-signals.md),
> [`attestation-surface`](attestation-surface.md) — register no `proof:` block, so the shortcut would
> have kept all six. It is unsound here: `attestation-signals`' three declared contracts are all BUILT
> and carry their contract ids VERBATIM as test titles in real suites that run on every `pnpm -r test`.
> A missing `proof.real.testFile` means `storytree coverage` cannot SEE the proof; it does not mean the
> proof is absent. Grep the built tree for the contract id before concluding a capability is unbuilt.
>
> - **Leg 1 (Decompose) — DELETED.** Proven by the capability
>   [`uat-machine-proof-binding`](../library/uat-machine-proof-binding.md) (story `library`), whose
>   declared `proof.real.testFile` is
>   `packages/library/src/uat-test-criteria.test.ts`: "parser reads authored criteria, titles,
>   witnesses, and would-be state", "invalid witness is refused and an absent witness stays either" and
>   "schema defaults remain conservative but exact identity/revision are mandatory" — the leg's whole
>   success condition ("each test has a stable id and a `witness`"), one-to-one.
> - **Leg 2 (Human verdict) — DELETED.** Proven by the capability
>   [`brokered-local-uat-signing`](../desktop/brokered-local-uat-signing.md) (story `desktop`) at
>   `apps/desktop/src/backend/local-uat-attest.test.ts`, whose contracts
>   `luat-persists-a-real-human-verdict-through-the-broker` and
>   `luat-refuses-untrustworthy-proof-before-writing` are present in that file by name and cover every
>   clause: the verdict persisting, and each of the three `checkUatProof` refusals the leg names — "a
>   blank signer fails closed", "the running agent cannot self-attest its own human leg", "a
>   machine-witness leg cannot be greened by a human click" — plus the `commitSha` clause ("a dirty git
>   tree refuses — never attest uncommitted bytes", "a blank commit SHA refuses", "a malformed
>   (non-hex) commit SHA refuses"). The "VERIFIED operator identity, never client-supplied" clause is
>   additionally asserted by `apps/studio/server/uatAttestApi.integration.test.ts` ("an admin signs a
>   human-witness test; the signer is the IAP identity, NOT the forged body field").
> - **Leg 5 (Vouch never greens) — DELETED, and this one is proven by THIS story's OWN capability.**
>   [`attestation-signals`](attestation-signals.md)'s three contracts all exist as named test titles:
>   `separate-from-verdicts: recording NEVER issues SQL against events.verdict` and
>   `signed-with-provenance: a blank signer / unknown witness is refused before any SQL` in
>   `packages/orchestrator/src/store/attestation-store.test.ts`;
>   `no-story-rollup: every test of a story attested → keys are ONLY per-test ids, no story key` in
>   `packages/orchestrator/src/proof/attestations.test.ts`; and the signer/`relayedBy` provenance in
>   `packages/cli/src/attest.test.ts` ("record human relay: signer = operator, relayedBy = the scribing
>   session"). The load-bearing half of the leg is the ABSENCE of a write, and that is the literal
>   subject of `separate-from-verdicts`.
>
> All three were checked against those tests' ACTUAL assertions, not their file existence (ADR-0294
> D2's honesty wall). **Legs 3, 4 and 6 are KEPT** — 3 and 4 because the real assertions that would
> discharge them live in files NO capability declares (`storytree ownership packages/orchestrator`
> reports `packages/orchestrator/src/proof` as its single unowned subtree), so D2's "name the node"
> cannot be satisfied; 6 because it is a partial duplicate whose studio half nothing asserts. Each
> survivor's own clause says which. **No gate is minted for any of the three** (ADR-0097 §2 / ADR-0294
> end state point 4).
>
> Ordinals **1**, **2** and **5** are BURNED, not renumbered; no surviving ordinal collides with a
> `superseded` key for this story in `stories/uat-legacy-dispositions.json` (the burned set is now 1,
> 2, 5, 7 and the survivors are 3, 4, 6). Verified on the live store before deleting: all six read
> `proven=–`, so no signed verdict was destroyed. Legs 2 and 5 carried `(detail:)` pointers, so the
> `uat-criterion` artifacts `uat-attestation#uat-2` and `uat-attestation#uat-5` were RETIRED in the
> same change rather than left orphaned (the ADR-0307 D5 precedent); `uat-attestation#uat-6` stays
> live with its leg.

### The rigor tiers must READ apart — design intent, deliberately NOT a UAT leg (ADR-0348 D6)

The judgment that stood as leg 7 until 2026-08-11 is recorded here, and it deserves more care than a
look verdict usually does, because **this claim is the reason the story exists.** The story's outcome
sentence ends *"No path ever forges a green"* — and a forged green is not only a forged ROW. A vouch
that a reader mistakes for a gate verdict has forged a green in the only place that ultimately matters,
which is somebody's belief about what has been proven.

**The intent: a vouch must never READ as a gate-proven pass.** Looking at a story whose UAT carries all
three states — one test PROVEN, one carrying only a vouch, one blank — in the studio panel and in
`storytree tree <story>`, a reader should be able to tell **WITHOUT being told** which mark is a gate
verdict that can green the crown and which is only *"I also eyeballed it"*. The tiers should be
unmistakable, not merely documented.

**Machine leg 6 does NOT cover this, and the difference is the whole point.** Leg 6 proves the marks
are STRUCTURALLY different — which glyph, which colour, which column, which state can even reach a row;
that `storytree tree` renders proof and vouch in SEPARATE columns; that no vouch ever produces
`proven=✓`; that the studio row surfaces the signed verdict ONLY, so no vouch state can reach it even
though `/api/attestations` still carries one. Every clause of that is a structural comparison with a
compiler. **None of it is the claim that a person reads the two as different RIGOR.** Two marks can be
perfectly disjoint in the data and still read as interchangeable to the eye — and that is exactly the
failure mode this story was built to prevent, so the gap between leg 6 and this intent is not a
technicality.

Under ADR-0348 D6 that reading is not an acceptance criterion: it is continuous owner feedback gathered
by using the surfaces. The accepted cost is unusually pointed here — the anti-false-confidence wall now
has a machine half that is checkable and a perceptual half that nothing records, so nothing will tell a
later reader whether anyone has ever confirmed the tiers read apart. **Do not read that silence as
approval** (ADR-0348 Consequences). `apps/studio/src/index.css` already records the row's icon styling
as owner-attested art (ADR-0070), which is the nearest thing to a standing home for this judgment; if it
becomes worth carrying a verdict again, the capability tier is where it belongs.

3. **Machine** _(witness: machine)_: an automated UAT run proves a `machine` test. **Success —** a _(criterion-id: uatc_b551ee8c331f7ba4abb747b6)_ _(revision-id: uatr1:1a0f5e782f6eea95)_ _(previous-revision-id: uatr1:dd78e322d1f1ce41)_
   signed machine verdict for that test id; it reads PROVEN ✓.
   **UNBOUND — fails closed (ADR-0294 D4, 2026-08-20), and kept for an OWNERSHIP reason rather than a
   proof one.** Both halves are asserted today by real, gate-run tests —
   `packages/orchestrator/src/proof/uat-proof.test.ts` ("guard: a machine test is proven by a machine
   verdict", "guard: a human click cannot green a machine test"),
   `apps/studio/server/uatVerdict.test.ts` ("REFUSES a machine-witness test — a click cannot stand in
   for a machine proof (ADR-0082 d.2)") and `packages/cli/src/uat.test.ts` ("attest: a machine-witness
   test refuses operator attestation (run the machine proof)"). But **no capability anywhere declares
   any of those three files**: `storytree ownership packages/orchestrator` reports
   `packages/orchestrator/src/proof` as its single unowned subtree, and neither `uatVerdict.test.ts`
   nor `uat.test.ts` appears as any capability's `proof.real.testFile`. ADR-0294 D2 requires NAMING the
   lower-tier node, and there is none to name — so the leg is not deleted. It carries no
   `(proof-gate:)`, `resolveWitness` refuses it (`coverage: "refused"`), and no gate is minted
   (ADR-0097 §2). What would let a later pass delete it is one declaration, not a new test: give
   `packages/orchestrator/src/proof/uat-proof.ts` an owning capability.
4. **Story roll-up** _(witness: machine)_: every per-test verdict for the story passes. _(criterion-id: uatc_656099008b06476c25330283)_ _(revision-id: uatr1:29cfcded27ba4bc3)_ _(previous-revision-id: uatr1:d5e2042b7691e6c9)_
   **Success —** the story's own UAT crown greens as the AND-roll-up (`rollupStoryUat`); a single
   signed `fail` withers it.
   **UNBOUND — fails closed (ADR-0294 D4, 2026-08-20), kept for the SAME ownership reason as leg 3.**
   `packages/orchestrator/src/proof/uat-proof.test.ts` asserts this leg verbatim — "rollup: all tests
   signed pass => healthy", "rollup: a test that regressed (pass then fail) withers the story to
   unhealthy", "rollup: a regression wins even when every other test passes", "rollup: any test still
   unproven => null (under-claim, never over-claim)" — and that file is declared by no capability, so
   D2's honesty wall cannot be discharged. `resolveWitness` refuses it (`coverage: "refused"`); no gate
   is minted (ADR-0097 §2).
6. **The proof tier and the vouch tier are never conflated on any surface.** _(criterion-id: uatc_3df6631198729794e56861e6)_ _(revision-id: uatr1:316719247bff3b1d)_ _(previous-revision-id: uatr1:292bf7b5d4951044)_
   _(witness: machine)(detail: uat-attestation#uat-6)_ With one test carrying a signed verdict, one
   carrying only a vouch, and one carrying neither, read both surfaces. **Success —**
   `storytree tree <story>` renders the two in SEPARATE columns — `proven=✓/✗/–` derived from
   `events.verdict`, and the ◉/▣ vouch mark derived from `events.attestation` — and no vouch ever
   produces a `proven=✓`; the studio row surfaces the SIGNED verdict ONLY (one witness-shaped glyph
   coloured by `events.verdict`), so no vouch state can reach the row at all even though
   `/api/attestations` still carries it; and `storytree witness list` carries the `proven=` column
   with no vouch column. *(Restated 2026-07-26 to what the surfaces actually do — see the stale-prose
   note above — and re-adjudicated `human` → `machine`: which mark, which column, and which state can
   reach a row are all structural.)*
   **UNBOUND — fails closed (ADR-0294 D4, 2026-08-20), and it is a PARTIAL duplicate that is therefore
   KEPT.** Its CLI half is largely proven one rung down by the capability
   [`tree-view`](../notice-board/tree-view.md) (story `notice-board`) at `packages/cli/src/tree.test.ts`
   — "focused view renders the UAT test criteria block from the spec; marks absent offline", "focused
   view shows attestation marks when the reader answers (human seal vs – never voucht)" and "focused
   view: a story with one unproven test under-claims (crown –, the test proven=–)". What no test
   reaches is the rest of the leg: that the STUDIO row surfaces the signed verdict only, so no vouch
   state can reach it while `/api/attestations` still carries the marks — the claim the 2026-07-26
   restatement was written for — and that `storytree witness list` carries a `proven=` column and no
   vouch column (`packages/cli/src/witness.test.ts` asserts only that the verb ROUTES to the read path,
   never what the read renders). A partial duplicate is not a duplicate (ADR-0294 D2), so the leg
   stands; `resolveWitness` refuses it (`coverage: "refused"`), and no gate is minted (ADR-0097 §2) —
   binding it to the CLI suite would sign the half that is covered and silently claim the studio half
   that is not, which is the exact conflation this leg exists to forbid.

## Resolved modeling calls

- **In-UI human signing** (an admin signs an attestation directly, no agent relay) — RESOLVED by
  ADR-0082: the studio "I saw it work" button (PR #271) and `storytree uat attest` (PR #268) sign an
  `operator-attested` verdict from a verified identity (the in-UI signature ADR-0044 §4 deferred).
- **Per-test green by witness** (whether a per-test signal can become a real gate verdict) — RESOLVED
  by ADR-0082: a declared-human test earns a real `operator-attested` verdict and a machine test a
  machine proof; the story's UAT greens as the AND-roll-up. A vouch remains a vouch (never green).
