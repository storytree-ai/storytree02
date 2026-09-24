# The public forests tell the truth again — staged 24 September 2026

Follow-up to the public land mount (`docs/research/public-land-mount-2026-09-24/`, website #167,
ADR-0608 D4). Three defects were live on the public site; this stages the fix (storytree-web #170,
branch `claude/laneR-public-truth`) against two controls, per ADR-0601.

**Three arms, one snapshot.** The published snapshot `src/data/forest-snapshot.json` is byte-identical
in all three (sha256 `7e5519b7…`, dated 1 September 2026 — 35 islands, 25 proven). Same viewport
(1600×1000), same browser (Chromium, headless, this box's RTX 2060 through ANGLE/GL), same capture
path (`capture.mjs`). The only difference is the website source:

| Arm | Website commit | What it is |
|---|---|---|
| `flat` | `9016b43` | web main just before #167 — the flat map |
| `deployed` | `a03fc3e` | web main as live when this lane started — the 3D land, with the defects |
| `fixed` | `3985b5b` | this change |

`receipt.json` carries every picture's sha256, each arm's console errors (none on any arm), a
beat-by-beat measurement of which nameplates sit under page text, and the click check.

| Surface | flat | deployed | fixed |
|---|---|---|---|
| `/` entry forest, settled (~14 s after the storm's skip; TELL is on its second beat) | `entry-settled-flat.png` | `entry-settled-deployed.png` | `entry-settled-fixed.png` |
| `/` entry forest, ~1 s into growth | `entry-growing-flat.png` | `entry-growing-deployed.png` | `entry-growing-fixed.png` |
| `/` TELL's "proven" beat | `entry-tell-proven-flat.png` | `entry-tell-proven-deployed.png` | `entry-tell-proven-fixed.png` |
| `/forest/` poster, whole | `forest-poster-flat.png` | `forest-poster-deployed.png` | `forest-poster-fixed.png` |
| `/forest/` poster, crop around notice-board | `forest-poster-crop-flat.png` | `forest-poster-crop-deployed.png` | `forest-poster-crop-fixed.png` |
| `/` an island clicked after TELL | — | — | `entry-click-fixed.png` |

## What each defect was, and what changed

1. **The black spiky marks** were not the 3D land at all. They were the FLAT map's own
   acceptance-criterion flowers (`tall-flower-*`, one per criterion since ADR-0600): the website's
   SVG serialiser had no class for them, so they painted in SVG's default black fill, and the rule
   that hides the flat picture once the land draws did not name them. Now they carry classes, are
   painted in the studio's flower palette when the flat map is what shows (loading, no WebGL 2), and
   are hidden once the land is drawn.
2. **Islands under page text.** Two causes. At the top, the 50° land made the map shorter, so the
   opening view reached a row whose island sat under TELL's first sentence. At the bottom, the
   stamp's height was measured once, before it had finished wrapping (~90 px measured vs 156 px
   final), so the world was anchored too low and four bottom-row names sat under the stamp. Now the
   stamp is re-measured when it re-wraps, and the map (the SVG and the land together) is faded out
   under every piece of text drawn over it — TELL's prose (as one top-left corner), its diagram,
   the key, the stamp and the ending. Measured over every TELL beat: **deployed had names under text
   in 9 of 9 beats, flat in 3 of 9 (the close-up beats), fixed in 0.**
3. **Which microservices are proven.** The land colours ground per COMPONENT, so the island's own
   status had no mark left. Now each nameplate's second line leads with the status word
   (`proven · 7 components`, `not yet proven · 7 components`) and the plate is tinted green or
   amber. The key decodes both marks separately: `status` (the word and tint under each name) and
   `ground` (per component, in the land's delivered colours). The caption, the map's screen-reader
   description, TELL's two lines that said "green", ROAM's sentence and the poster's intro no longer
   claim that green means proven. TELL's "proven" beat now dims the not-yet-proven nameplates (it
   used to dim flat islands that the land hides).

**The click after the skip button.** Not a bug: TELL locks the map while its prose plays (owner,
2026-09-01), and the previous capture clicked during it. After TELL hands the map back, a real
mouse click on an island opens the panel on all three arms (`receipt.json → clickAfterTell`).

## What I make of each picture — the verdict on the look is the owner's

- **Settled entry, fixed vs deployed.** No black marks. Nothing under the headline or the stamp. The
  plates now read green/amber at a glance: `app-surface`, `arc` and `website` are amber (not yet
  proven) though `app-surface` stands on all-green ground, and `cli` is green though half its ground
  is yellow — which is exactly the case the key's two rows now explain. The world sits ~65 px higher
  than deployed because the stamp is measured correctly.
- **One soft spot:** `context-traversal-telemetry`'s crown sits just below the cleared corner and
  its top is slightly faded by the fade band. Its name is clear. A narrower fade makes the edge
  harder; I kept it short (14 px).
- **Mid-growth.** No black marks. Otherwise unchanged from deployed.
- **TELL "proven" beat.** The not-yet-proven plates dim and the proven ones stay — the lens now works
  on the land.
- **Poster.** No black marks; the plate tints make proven/not-yet-proven readable across the whole
  map, where the words alone are a few pixels tall. The poster has no key (it never had one); its
  intro paragraph now explains the word and the ground.
- **The status word is small** (the plate's existing 9.5 px second line). The tint carries the
  glance; the word carries the reading. Making the plate larger changes the layout's label
  clearance and was not done here.
- **The 3D criterion flowers are barely visible** at these scales. The black marks were the flat
  ones; the land's own flowers are small kit props. That is the land's look, not this change.

## Not shown, honestly

- The no-WebGL-2 and loading states (where the flat flowers now show in colour) were not forced in a
  browser; `public-forest-truth.test.ts` holds that every flower part is classed and painted.
- Safari/Firefox were not run. The clearing is a CSS alpha mask from an SVG data URL
  (`-webkit-mask-image` included); a browser that ignores it shows the map unmasked, as deployed did.
