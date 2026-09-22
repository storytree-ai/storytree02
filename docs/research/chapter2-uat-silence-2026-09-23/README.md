# What the 3D map does not say about UAT — measured on the real forest, 2026-09-23

Evidence for `three-d-world-vocabulary-arc-inc-01`. Re-run the numbers with:

    node docs/research/chapter2-uat-silence-2026-09-23/measure-uat-silence.mjs

## The finding

**One UAT criterion in three is not drawn at all on the 3D map, and twelve of the twenty-four
islands that carry criteria misreport because of it.**

| | |
|---|---|
| UAT criteria on the real map | **104** |
| signed by the owner | 69 |
| unsigned (`pending`) | **35** |
| drawn by the 3D map | 69 — **34% of the signal is not drawn** |
| failing (`tall-flower-failing`) | 0 — the form exists and nothing currently uses it |

| island class | count | what a viewer reads |
|---|---|---|
| **SILENT** — has criteria, none signed | **9** | the island carries no UAT work at all |
| **MISREPORTING** — mixed | **3** | the island is FULLY proven |
| HONEST — all signed | 12 | correct |

The silent nine: `website-experience` (0 of 8 signed), `wisp-as-story-claim` (0 of 5),
`studio-cloud` (0 of 5), `terminal-repo-picker` (0 of 4), and five islands with one criterion each.
The misreporting three: `context-traversal-transcript` (1 of 6 signed, reads 1 of 1), `desktop`
(5 of 6), `feedback-graduation` (2 of 4).

**The misreporting three are the ones that matter**, and not because there are few of them. A silent
island understates — it looks like a story nobody has written acceptance criteria for, which is
wrong but reads as *absence*. A mixed island **overstates**: every bloom on it is a true claim, the
count is complete-looking, and nothing on the island says otherwise. `context-traversal-transcript`
draws one bloom and holds six criteria.

## Why it is this way, and why it is not a bug

`packages/forest-world-r3f/src/world-to-3d.ts:527` maps only `tall-flower-proven`. Its own comment
states the fence in terms: a bloom is the claim *"the owner SIGNED this"*, so a family emitting one
for an unsigned criterion would be the map asserting a signature nobody gave (ADR-0392 D5 /
ADR-0398 D7) — *"What an unsigned criterion should look like in 3D is a look decision this family
does not own, and drawing nothing is the honest state until it is made."*

That reasoning is correct and this measurement does not dispute it. **Drawing nothing is honest
about the criterion and dishonest about the island**, and the difference only becomes visible when
you count across a real corpus rather than reason about one marker.

In 2D the question does not arise: ADR-0226 D4 gives all three states a form — bloomed daisy
proven, closed bud pending, wilted head failing — and ADR-0463 D7 is the owner deciding the stale
case himself (*"if your uat goes stale then you go back to buds"*). The 3D map has only the bloom.

## What this is NOT

⚠ **It is not the question ADR-0530 D3 forbids escalating.** D3 says how an island reports its
**capability's** state once textured props stand where coloured shapes stood is *"engineering to be
answered the way it was answered for the GROUND on 2026-09-02 … it is not an owner question and
must not be escalated as one."* That is a different signal — capability state, carried by land
colour and prop species — and this is a **story's** UAT criteria. The `how` here is not in doubt
either; what is missing is the `what`, which ADR-0392 D5 / ADR-0398 D7 reserve to the owner.

⚠ **It is not evidence that "the 2D vocabulary does not translate".** That blanket claim is false:
status colour was measured GREEN at 3D scale on 2026-09-02 (`chapter2-six-status-truth-2026-09-02`,
35 of 35 fixture islands read as the status they hold, 0 FAIL, both zooms, real GPU). What is
measured to fail is **density-as-a-signal** (ADR-0475 / ADR-0518, already retired and replaced) and,
now, **the two undrawn UAT forms**.

## Method, and its bounds

`measure-uat-silence.mjs` walks the committed export
`docs/research/chapter2-real-forest-2026-09-08/scenes/shipped.json` — the layout the studio built
for the live corpus on 2026-09-07 with no rung override, i.e. the map rather than a ladder arm. It
counts the three criterion wrapper kinds and attributes each to the nearest enclosing group whose
own `kind` says it is an island (`ground` / `territory` / `tile`), which is the same identity rule
`world-to-3d.ts` holds — every other `<g id=…>` on an island carries an id for its own reasons.

**Bounds, stated rather than implied.** The export is a snapshot of 2026-09-07, so the exact counts
move with the corpus; the SHAPE (three classes, a mixed class that overstates) does not, because it
follows from the mapping rather than from the data. Nothing here measures LEGIBILITY — whether a
bloom can be seen at forest distance is still unmeasured, and a decision to draw an unsigned form
would need that answered for the form it chooses.
