# Pathways scale with the land — never thicker as you zoom out

The owner, 2026-09-25, looking at the new default map (the flat look retired in #2082): *"I also
noticed that pathways get thicker as you zoom out which is not something we want."* laneZ,
2026-09-25. Appearance is the owner's verdict; nothing here signs it (ADR-0601).

## The pictures

- **[`sheet.png`](sheet.png)**: the whole studio frame, before | after, at three zooms (zoomed in,
  the opening view, zoomed out to the limit). The same place in every row: each zoom is the host's
  own mouse wheel around the centre of the map.
- **[`detail.png`](detail.png)**: the same six frames cropped around that centre, at native pixels.
- The frames themselves: [`studio/`](studio/) (`before-*` / `after-*`; the `sel-*` frames have one
  island selected, which is where the lane numbers below come from).

One real-corpus API snapshot (47 stories, 32 with a signed verdict) replayed byte for byte to both
arms, reduced motion, 1800x1100, Chromium on this box's GPU. **before** = `main` with lane Y's pan
fix merged in (`608e8212`); **after** = this branch (`59229c90`), which differs only by the road
width rule. Receipts: [`studio/manifest-before.json`](studio/manifest-before.json),
[`studio/manifest-after.json`](studio/manifest-after.json). Script: [`capture.mjs`](capture.mjs).
The raw 3D canvas at the opening view is byte-identical to the one the flat-look retirement
staged (`595a51b0…`), so "before" is the map the owner has been looking at.

## Which layer thickened — measured

The map draws roads twice: the 3D land's road ribbons, and the SVG layer's selection lanes.

| | zoomed in | opening view | zoomed out |
| --- | --- | --- | --- |
| zoom (CSS px per ground unit, both layers agree) | 4.23 | 1.97 | 0.28 |
| island width on screen (median) | 255 px | 119 px | 16 px |
| **3D road, before**: width on screen / share of an island | 6.4 px / **2.5%** | 6.3 px / **5.3%** | 6.0 px / **37%** |
| **3D road, after** | 12.7 px / **5.0%** | 6.2 px / **5.2%** | 1.65 px / **10%** |
| SVG selection lane (both arms) | 12.7 px / 5.0% | 5.9 px / 5.0% | 0.84 px / 5.3% |

The 3D road width is *measured*, not declared: the pixels that change when the road ribbons are
hidden, divided by the ribbons' projected on-screen length.

**The cause.** The 3D road is a drei `<Line>`, whose `lineWidth` is in *screen pixels*. So it stayed
~6 px at every zoom while the islands under it shrank, which reads as the road getting thicker as you
zoom out: a fifteenfold growth in its share of an island. The SVG lanes are drawn in ground units and
already scaled with the land. They held ~5% throughout, which is why the two layers also drifted out
of register as the zoom moved: the lane was twice the road's width zoomed in, and a sliver inside a
fat band zoomed out. The worn-path wear is painted into the ground and already scaled.

**The fix.** `packages/forest-world-r3f/src/trail-ribbon-width.ts`: on screen, a road is
`trailFillWidth(usage)` × 0.5 × the camera's zoom, never narrower than 1 px. The width is set on the
renderer's own per-object hook, so it is right for every draw, including the host's synchronous
camera draw that lane Y's pan fix introduced (a direct render that runs no per-frame callback).
- **The opening view is unchanged.** 0.5 is chosen so the roads draw at 0.99× their approved width
  at the opening zoom. The owner approved how the roads look (ADR-0608, *"roads look good now"*);
  only their behaviour across zoom moves.
- **Zoomed in**, roads widen with the islands and keep meeting the shores. The lane now matches its
  road there (12.7 px on 12.7 px) instead of being twice its width.
- **Zoomed out**, the road's share of an island falls from 37% to 10%. It is not 5% because of the
  1 px floor: past the whole-forest view, one-edge spurs stop at a single pixel rather than dissolving
  into sub-pixel noise. On screen a road is never *thicker* for zooming out. Relative to an island, the
  floor lets a spur grow only once it is one pixel wide.

No standing decision prescribed a screen-pixel road width. The owner's earlier verdict on the mounted
roads (`oq-laneh-mounted-pathways-visual-verdict`) had called zoom *"something we can adjust
later"*. This is that adjustment.

## What to look at

- **Zoomed out**: before, the network is a set of thick brown bands wider than the islands they
  join. After, it is a set of thin roads in proportion to the islands. This row carries the change.
- **Opening view**: before and after should be indistinguishable.
- **Zoomed in**: after, the roads are about twice as wide as before, in proportion to the islands.
  Before, a road was a thin line next to a big island.
