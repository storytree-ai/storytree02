# How much room the map gives its own labels

**Captured 2026-09-23 on the REAL forest** — the live store's 36 stories, through the studio's own
map, all four arms from ONE running server minutes apart. Same corpus, same paint, same camera. The
only thing that differs between them is how much space the layout leaves.

This sheet exists to be looked at. Nothing in it decides anything — the numbers are what the
instrument measured, the pictures are yours.

## What you said

> *"new map looks squished with the labels overlapping some islands, the user can scroll around so
> while its nice that we not wasting so much empty space its not that important to fit the whole
> thing on screen."*

Two separate faults, and it turned out they have different causes and need different fixes.

## Fault one — the labels

Each island's name card is a fixed size. The space between islands was not: it was set as a
*fraction of island size*, so a small island got a small gap — and a small island's name card is
several times wider than the island itself. On the live forest the smallest island is about 23 units
across and its card needs about 25 below it and 41–115 across, so the rule was handing it roughly a
twentieth of what its own label needs.

**That is why widening the gaps alone never fixed it.** Turning the spacing dial up on its own does
not clear the last overlap until it is *thirty times* its current value, at which point the forest
is 1525 × 2309 and cards are still sitting on each other. A rule that scales with the island can
never reserve room for something that does not.

So the layout is now told, in so many words, how much room the map's name cards need, and it treats
that as a minimum it will not go below — separately across and down, because a card is much wider
than it is deep. Big islands are unaffected: they are already wider than their own card, so they ask
for nothing extra and do not move.

## Fault two — the squish

The gap setting was chosen a fortnight ago from a rendered ladder, and it was a sensible choice at
the time. What nobody knew then is that the map was being stretched: the layout worked out where
every island went in ground distances and then rounded those positions through a piece of code that
expected screen distances, which stretched the whole forest 1.31× down its long axis. The rows were
being held apart by something that was not supposed to be there. Correcting that (PR #2020) took the
stretch away and left the gaps as they had actually been written — which is the map you looked at.

The number here is about seven: with the stretch, the water between two rows was roughly seven times
what the setting asked for. So the setting is what needed re-deriving, and it goes from 0.1 to 1.

## The four arms

Read them in order — each adds one thing, so you can see which change bought which part.

| arm | what it is | world | labels on another island | cards on each other |
|---|---|---|---|---|
| `before` | the map as it is on `main` today | 835 × 1038 | **12** | 3 |
| `room-only` | room for the cards, old gap | 854 × 1355 | 1 | 2 |
| `shipped` | **the landing** — room + the re-derived gap | 950 × 1444 | **0** | **0** |
| `wider` | one rung wider, if it still reads tight | 1123 × 1661 | 0 | 0 |

All 36 islands, all 95 paths between them drawn, none dropped, on every arm.

Two files per arm: `2d-<arm>-fit.png` is the whole forest at once, `2d-<arm>-resting.png` is the
view the map actually opens on.

## What to look at

The top-left of the forest, around `desktop` — three small islands stacked above a big one. In
`before` the `embedded-terminal` card sits squarely on `desktop`'s land and across its tree. In
`shipped` it sits clear below its own island. That one spot is the whole of fault one in a picture.

Then look at the two `-resting` pictures side by side, because that is the view a member opens on and
it is the one that matters most.

## What this does NOT do, and I would rather say so

**It does not make the forest wide.** It gets wider — 835 to 950 units, and the shape goes from
1.24:1 to 1.52:1 — but the map is still a tall ribbon with a lot of empty space either side, and no
spacing setting can change that. The ribbon is the shape of the dependency graph: 17 layers, 9 of
them holding a single island. Spreading it sideways would mean changing how the layout arranges
those layers, which is a different decision from this one and a bigger piece of work. Say the word
and it becomes its own piece of work; I have not assumed it.

**The pick is the threshold, not a taste call.** 1 is the lowest setting at which no label covers
another island, and the lowest above which that stays true. Below it the result is a lottery — 1
overlap at 0.1, 4 at 0.5, 2 at 0.8 — because the layout wobbles each island slightly and which pair
happens to collide moves with the setting rather than with the spacing. So it is not that 1 *looks*
right; it is that below it the map is not reliably clean.

## If you want it different

Both dials are live in the URL, no rebuild:

- `?spacing=1.5` — more room everywhere (that is the `wider` arm). `?spacing=0.5`, `?spacing=0.1` — less.
- `?plateRoom=0` — turn the label clearance off entirely; that is exactly the `before` arm.
- `?spacing=0.1&plateRoom=0` together — the map as it stood this morning.

## How it was made

`apps/studio/scripts/export-map-room.mjs` against a studio on the live store. The overlap counts
come from `apps/studio/scripts/measure-map-chrome.ts`, which packs the same forest in about a second
so a setting can be swept cheaply; it counts a label as covering an island when it lands on that
island's land **or its tree**, since the tree is most of what you see. Counting land alone reports
this map's 12 overlaps as 2.
