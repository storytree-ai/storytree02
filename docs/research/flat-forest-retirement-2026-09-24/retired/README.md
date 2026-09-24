# The flat forest look, retired — what went, what stayed, and the pictures

ADR-0608, one step, studio and website together (laneV, 2026-09-24). The mounted 3D land is the
forest: the studio draws it by default with its plants, and the public forests no longer carry
the flat picture at all. Appearance is the owner's verdict; nothing here signs it.

## The pictures (ADR-0601)

One real-corpus API snapshot (47 stories, 36 islands on the map) replayed byte for byte to every
arm, reduced motion, the host's own wheel for zoom, a real click on a nameplate for selection.
Arms: **flat** = `main` at `5c50208c` with no query (what a member saw by default until now);
**mounted** = the same `main` with `?landMount=1&landMountProps=1` (the look the owner approved);
**retired** = this branch with no query. Receipt: [`studio/manifest.json`](studio/manifest.json).

| Framing | before (flat default) | before (approved mount, behind a flag) | after (retired, default) |
| --- | --- | --- | --- |
| Opening | [flat](studio/studio-flat-rest.png) | [mounted](studio/studio-mounted-rest.png) | [retired](studio/studio-retired-rest.png) |
| Zoomed | [flat](studio/studio-flat-zoom.png) | [mounted](studio/studio-mounted-zoom.png) | [retired](studio/studio-retired-zoom.png) |
| Zoomed, one island selected | [flat](studio/studio-flat-zoom-selected.png) | [mounted](studio/studio-mounted-zoom-selected.png) | [retired](studio/studio-retired-zoom-selected.png) |

What the numbers say, per the live DOM of each arm:

- **The 3D land is byte-identical** between the approved mount and the retired default — raw canvas
  SHA-256 `ac4bcfa7…` at the opening and `c53f76d2…` zoomed, in both arms. Everything that changed
  is in the SVG layer above it.
- **Flat-picture marks: 6,643 → 0** (hero trees 143, coverage marks 2,463, UAT flowers 107, road
  passes 330, board hexes 754, painted ground cells 2,810, painted coast 36).
- **Interaction marks unchanged**: 36 nameplates, 36 story hit regions, 218 capability ground
  regions, 2,681 3D-plant click targets.
- **Selection feedback is visible again.** Under the flag the mount's CSS hid the selection lanes
  and shore rings along with the flat roads and coast (the "mounted, selected" picture shows only
  the nameplate highlight). After: 14 lanes and 15 rings over the land, as in the flat look. This is
  the one visible change against the approved mount, and it is deliberate — ADR-0608 D2 keeps
  selection lanes as interaction.

### The public website

Built twice from the same published snapshot — before = the website as pinned on `main`
(`4c364c4`), after = this landing's website branch — served locally, Chromium on this box's GPU.
Receipt: [`public/receipt.json`](public/receipt.json).

| Surface | before | after |
| --- | --- | --- |
| `/forest/` poster, land drawn | [before](public/public-forest-poster-before.png) | [after](public/public-forest-poster-after.png) — **pixel-identical** (the flat layers were already hidden once the land drew) |
| Home entry forest, settled | [before](public/public-entry-settled-before.png) | [after](public/public-entry-settled-after.png) |
| `/forest/` in a browser **without WebGL 2** | [before](public/public-forest-poster-no-webgl2-before.png) — the whole flat map, a fallback ADR-0608 D5 forbids | [after](public/public-forest-poster-no-webgl2-after.png) — the message and the names, nothing else |

Page weight: the home page's HTML went from 1.01 MB to 405 KB and `/forest/`'s from 871 KB to
262 KB, because 4,172 ground cells, 35 crowns, 104 flat flowers, the board and the road shadow
passes are no longer serialised. Growth frame pacing is unchanged (median 16.7 ms both sides).

## The interaction layer survived (ADR-0608 D2)

Real Chromium, the real forest, the retired build ([`interaction/interaction-receipt.json`](interaction/interaction-receipt.json)):

- **Focus**: Tab reaches the map ("story forest map (pan and zoom)").
- **Keyboard**: ArrowLeft / ArrowUp pan the host camera.
- **Nameplate click** selects its story: panel, `is-selected`, 13 lanes, 1 ring.
- **Session wisps**: all 17 claim wisps the corpus carries are drawn, each with its hit target.
- **Legend**: fading `healthy` marks 2,495 of 2,794 plant targets filtered; showing it restores 0
  ([picture](interaction/legend-healthy-faded.png)).
- **Reduced motion**: settles grown, all 36 nameplates, no regrow in flight.
- **Clicking a plant**: lane O's probe (`../native-targets/probe.mjs`) re-run unchanged. **38 of 40**
  crown pixels resolve to the right capability **with no diagnostic at all**. Lane O measured 22 of 40
  while the flat marks still caught clicks, and 38 of 40 only with them made pointer-inert. A real
  crown click opened that capability's card ([picture](interaction/crown-click-selects-capability.png),
  [receipt](interaction/click-accuracy-receipt.json)). The two misses are a nearer plant's box, as
  before (boxes, not silhouettes).

## What was removed (ADR-0608 D3)

**Studio.** `SceneView` no longer paints the empty board, island fills and hex tiles, hero trees
(procedural and the baked colourways, whose loader went), flat coverage/plant/flower marks,
conifers, or the road passes, and it no longer paints their animation (sprite tracks, island
accretion, road draw-on masks). The island ground stays as unpainted hit geometry, so a click on a
capability's land still selects it. The `?landMount` / `?landMountProps` flag and the
`?render=legacy` inline render are deleted, along with the sprite art sheets and their two gear
dials, the `?veg2` switch, and the `?semanticGrowth=demo` / `?organicGrowth=*` lab routes. Deleted
modules: `SemanticGrowthWorldView`, `svg-island-accretion`, `island-vegetation-growth`,
`vegetation-render`, `shared-growth-tracks`, `organic-pose-to-pose-*`,
`chapter2-round3-tree-candidates`, `land-camera`, `sprite-sheet`, `sprite-sizing`, the app-surface
art assets, `SemanticGrowthDemo`, the studio `sprite-sheet`, `public/art-sheets/`, and about 440
lines of flat-only CSS. Five capabilities whose only surface was the flat look are retired.

**Website.** The two public forests serialise only nameplates, hit discs, signposts, the coast
outline (ROAM's selection ring) and the road fill and casing (TELL's trail lens, ROAM's hit
stroke). The growth reads its island list from the nameplates, because it used to read it from the
ground layer that is gone.

**Kept on purpose.** The app-owned regrow cursor. The `buildWorld` / `buildRelaxedCells` /
`worldToScene` layout. The shared scene itself, which the 3D layer reads.

## Left, and why

- **Shared Islands side-panel cards** (the left drawer, only under `?buildings=on`) still paint
  small flat islands. They are a separate surface, not the map, and giving them a 3D picture is its
  own piece of work.
- **The Act 2 guided walk** on the website (the scripted three-story walk) keeps its own flat
  drawing. It is not one of the two public forests, and it has no 3D consumer.
- **`packages/art-authoring`'s sprite-sheet pipeline** now authors sheets for no consumer.
- The studio's opening waits for the land's first settled status. If the renderer chunk never
  arrives, the loading notice stays up and nothing grows. The member is told, but there is no
  timeout.

Instruments: [`capture.mjs`](capture.mjs) (studio), [`capture-public.mjs`](capture-public.mjs)
(website), [`interaction.mjs`](interaction.mjs).
