// ForestWorldCanvas.tsx — the thin R3F shell over the pure descriptor mapping
// (the r3f-world-spike capability's visible half). Browser-only by design: this
// file imports React / three / @react-three/fiber / @react-three/drei and is
// exported via the `./canvas` subpath, NEVER from the pure root barrel — the
// provability firewall (world-to-3d.ts stays importable under bare node:test).
//
// Spike scale, no art direction (ADR-0070: the look is witnessed, not
// machine-judged; the painterly pass arrives with the experience caps): each
// descriptor family gets a placeholder mesh — instanced hex prisms for the
// ground, a ground ribbon-line for a trail segment, a dark rim disc for a cave
// portal, an emissive sprite-ball for a wisp — coloured by the folded status
// variant. (A cone-on-trunk stood for the story tree until ADR-0508 retired it;
// each island stands the bought kit's one tree per capability instead — ADR-0518.)
//
// THE PROJECTION IS ORTHOGRAPHIC AND THE VIEW DOES NOT ROTATE (ADR-0380 D6 fence 4). This
// canvas shipped for months as a PerspectiveCamera under a rotate-capable orbit control, which
// the fence does not license — the spike authored the camera, the ADR later fenced the
// projection, and nobody reconciled the two (`the-shipped-canvas-meets-the-isometric-fence`).
// ⚠ ZOOM AND PAN ARE UNTOUCHED and must stay that way: the fence names the PROJECTION and the
// free ROTATION, never the ability to get closer, and the owner affirmed zoom explicitly
// (2026-08-22, ADR-0415 D1). Zoom on an orthographic camera is `camera.zoom`, which is exactly
// what `MapControls` already drives — see {@link FitOrthographicFraming} for the one wrinkle
// that creates.
//
// Trails are HIDDEN BY DEFAULT (ADR-0169 §3/§4): this canvas has no island
// focus/selection concept yet, so the minimal reveal is the `showTrails` prop —
// nothing focused, nothing shown; opting in draws the whole network. Ghost
// (under-island) strips are never drawn here — the cave props carry that story.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, MapControls } from '@react-three/drei';
import { Color, OrthographicCamera, type Mesh, type Texture } from 'three';
import type { InstanceDescriptor, Descriptor3D } from './world-to-3d.js';
import type { ForestRegrowPresentation } from './ForestWorldCanvas.regrow.js';
import {
  frameWorld,
  orthographicZoomFor,
  restingWorldFraming,
  type FramingViewport,
} from './camera-framing.js';
import {
  cellGroundGeometry,
  type CellGroundGeometryInput,
  type LinearRgb,
} from './cell-ground-geometry.js';
import { SHIPPED_COAST, clipToCoast } from './coast-clip.js';
import { LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { SHIPPED_SHORE, shoreRelief } from './shore-fall.js';
import { shoreArmRingPlan } from './shore-ring.js';
import {
  SKIRT_ROCK_LIT,
  SKIRT_ROCK_SHADED,
  SKIRT_ROWS,
  isRimEdge,
  rimEdgeKeys,
  shadeBelowHalfDepth,
  type GroundSkirt,
} from './stepped-skirt.js';
import {
  atlasOriginResolver,
  buildAtlasOcclusion,
  type AtlasField,
} from './shadow-atlas.js';
import { groundBounds } from './ground-casters.js';
import {
  createGroundInputCache,
  type GroundInput,
  type GroundInputOptions,
} from './ground-dependency.js';
import { SHADOW_PENUMBRA, type ShadowCaster } from './land-shadow.js';
import { CONTACT_SPREAD, SHADOW_CONTACT_BAND, type ContactBand } from './contact-shade.js';
import { SHADOW_DEPTH, SHADOW_EDGE, type ShadowDepthOptions } from './shadow-rung.js';
import { kitMeshes, loadEmbeddedKit, roleFootprints, roleHeights, type LoadedKit } from './kit-mesh.js';
import {
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  footprintDriftOf,
  heightDriftOf,
  type KitPlacement,
} from './kit-vocabulary.js';
import { LIGHT_DIRECTION } from './shade-ladder.js';
import { GRASS_STATUS_GATE } from './land-grass.js';
import { WHEAT_STATUS_GATE, wheatAnchor, wheatLift } from './land-wheat.js';
import { BLIGHT_STATUS_GATE, blightRung } from './land-blight.js';
import { ROCK_SLOPE_RAMP } from './land-rock.js';
import { SAND_FIELD_WIDTH, buildAtlasShore } from './shore-atlas.js';
import { islandPaths } from './island-path.js';
import { WEAR_FIELD_WIDTH, buildAtlasWear } from './wear-atlas.js';
import { DETAIL_TILE_UNITS, detailNormalTexture } from './detail-normal-texture.js';
import { EXACT_COLOUR_CANVAS_PROPS } from './exact-colour.js';
import { calibrateLights, intensitiesFor } from './light-calibration.js';
import {
  GROUND_ATLAS_ATTRIBUTE,
  GROUND_STATUS_ATTRIBUTE,
  createBandedGroundMaterial,
  groundAtlasTexture,
  type BandedGroundMaterialOptions,
  type GroundGrassLayer,
  type GroundRockLayer,
  type GroundWheatLayer,
  type GroundBlightLayer,
} from './banded-ground-material.js';

/** THE DECIDED GROUND VOCABULARY — five colours over six states.
 *
 *  ⚠ THIS FILE USED TO CARRY A SEVENTH, PRIVATE PALETTE, and it disagreed with the decisions on
 *  ALL SIX STATES rather than by a shade: `mapped` was a BLUE `#5d8fa8` where ADR-0470 settled a
 *  tilled clay, `unhealthy` a BROWN `#8a5a44` where the decision says a charred near-black, and
 *  `building` still owned a periwinkle after ADR-0462 merged it into `proposed`'s yellow. Its own
 *  comment called it a "spike palette, not art direction", which was true when nothing mounted
 *  this canvas and stopped being true on 2026-08-28, when the public site's chapter 2 began
 *  opening on the real forest through this very component. THE LAND'S COLOUR IS A CAPABILITY'S
 *  PROOF STATE (ADR-0392 D5 / ADR-0398 D7, as amended by ADR-0461), so a palette no decision
 *  authorises is the map REPORTING STATES IT WAS NEVER TOLD TO REPORT — not a cosmetic lag.
 *
 *  The values are the authoring surface's own: `apps/studio/src/index.css`'s
 *  `.hex-territory.st-<status>` blocks, of which `harness/palette-band.ts`'s `STATUS_TOKENS` is
 *  the declared transcription. THIS IS THE THIRD COPY AND IT IS NOW HELD MECHANICALLY —
 *  `pnpm check:palette-transcription` (and `harness/palette-transcription.test.ts`) reads all
 *  three off disk and refuses any disagreement. The harness cannot simply be imported here: the
 *  web sync mirrors `src/` into the public site and copies nothing from `harness/`, so an import
 *  across that line would dangle in the published tree (`harness/scope-fence.test.ts`).
 *
 *  FIVE COLOURS, SIX STATES (ADR-0462): `proposed` and `building` deliberately share the yellow —
 *  the live-work signal is the orbiting WISP (ADR-0200 / ADR-0142), never the ground, so the land
 *  was spending a sixth colour saying something it was not the one saying. Each family's three
 *  authored `--hex-top-*` variants collapse to the FIRST here, because this canvas draws one
 *  colour per parcel and has no per-cell variant hash to pick between them.
 *
 *  A `ReadonlyMap` rather than a `Record<string, string>`: `InstanceDescriptor.material` is an open
 *  `string`, so this is a LOOKUP with a computed key and the key type carries no knowledge to
 *  discard — which is what `anti-slop/no-known-value-widening` fires on. The Map states the same
 *  thing without the widening annotation AND adds an immutability fence the object literal never
 *  had; the rule's classifier does not treat `ReadonlyMap` as a widening target. */
const GROUND_COLOUR: ReadonlyMap<string, string> = new Map([
  ['healthy', '#8cb85e'],
  ['mapped', '#b7684e'],
  ['building', '#d8c069'],
  ['proposed', '#d8c069'],
  ['unhealthy', '#57544a'],
  ['unknown', '#9ca3af'],
]);

/** THE DECIDED CROWN VOCABULARY — the story tree's canopy, per status.
 *
 *  ⚠ IT IS A SEPARATE TABLE ON PURPOSE, AND THAT IS WHY THIS UNIT IS A SPLIT RATHER THAN A
 *  FIND-AND-REPLACE. One lookup used to paint the ground AND the crowns, so swapping it wholesale
 *  would have fixed the land and quietly repainted every canopy with a ground colour. Ground and
 *  crown legitimately differ, and most visibly for `building`: the app authors no
 *  `--crown-building-*` pair, so a building story's crown falls through to `unknown`'s slate while
 *  its GROUND wears `proposed`'s yellow. A single table cannot hold both facts.
 *
 *  Transcribed from `apps/studio/src/index.css`'s `--crown-<status>-lo` custom properties — what
 *  `.story-tree .crown-lo circle` actually fills with — mirrored in `harness/palette-band.ts` as
 *  `TREE_TOKENS`, and held to both by the same check as {@link GROUND_COLOUR}. The lighter
 *  `--crown-<status>-hi` is deliberately not transcribed: it is the flat SVG standing in for a
 *  light it does not have, and this canvas has a real `directionalLight`.
 *
 *  `building` is in any case unreachable on the shipped map — `worldStatus` folds it to `proposed`
 *  before anything is stamped (ADR-0038) — so both its entries describe what a surface that does
 *  NOT fold would draw. Transcribing what the app DELIVERS rather than harmonising the two is the
 *  same rule the harness follows: inventing the missing amber here would put a colour on the map
 *  that the authoring surface has never drawn. */
const CROWN_COLOUR: ReadonlyMap<string, string> = new Map([
  ['healthy', '#2f6b3f'],
  ['mapped', '#7d5f3b'],
  ['building', '#6b7280'],
  ['proposed', '#b06a24'],
  ['unhealthy', '#9f2d22'],
  ['unknown', '#6b7280'],
]);

/** The fallback both lookups share: an unrecognised material is UNKNOWN, which is the one state
 *  that means "no data". Falling back to any other status would have the map assert something
 *  about work it could not classify. */
const UNKNOWN_STATUS = 'unknown';

/** GROUND colour for a status variant — the relaxed-mesh parcel ground, the one substrate this
 *  canvas draws. (The classic extruded-hex prism this resolver once ALSO fed was retired at the
 *  mapper — `retire-the-old-land-path` — and this function's own callers shrank with it; it stays
 *  because the banded ground's resolver rides it, below.) */
const groundColourOf = (material: string | undefined): string =>
  GROUND_COLOUR.get(material ?? UNKNOWN_STATUS) ?? GROUND_COLOUR.get(UNKNOWN_STATUS)!;

// ⚠⚠ `crownColourOf` WAS DELETED WITH `StoryTree` (ADR-0508) AND {@link CROWN_COLOUR} DELIBERATELY
// SURVIVES IT — do not read the table as dead and delete it too. Its resolver had exactly one
// caller, the retired canopy cone, and this file now REFERENCES the table nowhere. It is still
// load-bearing, and its readers reach it by PARSING THIS SOURCE rather than by importing it:
// `src/leaf-tint.test.ts` pins `LEAF_TINT_TOKEN`'s `mapped` entry to `CROWN_COLOUR.get('mapped')`
// (a crown's colour is a claim about a proof state, ADR-0392 D5 / ADR-0398 D7, so the kit's leaf
// tint may not author a hue of its own), `harness/palette-transcription.ts` holds it to the app's
// `--crown-<status>-lo` custom properties, and `harness/shipped-baseline.ts` transcribes it. The
// kit's leaves are still tinted by status, so the vocabulary is as live as it ever was — it is the
// hand-built cone that is gone, not the crown token.

const byKind = (descriptors: readonly Descriptor3D[], kind: InstanceDescriptor['kind']) =>
  descriptors.filter((d): d is InstanceDescriptor => d.kind === kind);

/** THE SHIPPED GROUND DERIVATION'S CONSTANTS — the relief the props are lifted onto and the frozen
 *  kit tables the placement and its casters are measured against. Stated here, where this surface's
 *  other shipped picks are, rather than inside `ground-dependency.ts`: that module owns WHEN the
 *  ground is re-derived, and this file owns WHAT it is derived against. */
const SHIPPED_GROUND_INPUT: GroundInputOptions = {
  relief: LAND_RELIEF_AMPLITUDE,
  footprint: KIT_FOOTPRINTS_2026_08_29,
  height: KIT_HEIGHTS_2026_08_29,
};

/** Status variant → LINEAR colour, using three's OWN sRGB transfer function rather than a
 *  transcription of it. `<Instance color="#4f9d5d" />` puts the hex through `THREE.Color` on its
 *  way into the instanced attribute, so a vertex-colour buffer built any other way would draw the
 *  same status token at a visibly different lightness from the classic prisms — the two substrates
 *  would stop agreeing about what a colour MEANS, which on this surface is what the map reports
 *  (ADR-0392 D5 / ADR-0398 D7). Going through the same class is what makes that unrepresentable.
 *
 *  ⚠ THE BANDED GROUND NO LONGER READS THIS, and it is kept because the comparison instrument
 *  does: `harness/shipped-land-scene.ts` builds the pre-adoption arms — the map as it drew on
 *  2026-08-29 and again on 2026-08-30 — from the same function with the same resolver, which is
 *  what makes those arms the shipped map rather than a reconstruction of it. */
/** An authored `#rrggbb` in the buffer's LINEAR space, through three's own transfer function.
 *  Split out of {@link linearColourOf} rather than duplicated, because the skirt's rock is a token
 *  that belongs to NO status and so has no material name to look up — and a second `new Color(...)`
 *  beside this one would be a second chance for the two to convert differently. */
const linearColourOfHex = (hex: string): LinearRgb => {
  const c = new Color(hex);
  return { r: c.r, g: c.g, b: c.b };
};

const linearColourOf = (material: string | undefined): LinearRgb =>
  linearColourOfHex(groundColourOf(material));

/** THE RAMP ROWS, IN ONE ORDER, DERIVED FROM ONE MAP. `GROUND_TOKENS[i]` is the authored token a
 *  vertex carrying `statusIndex === i` wears, and {@link groundRowOf} is the inverse. Both come
 *  off {@link GROUND_COLOUR}'s own insertion order rather than from two hand-kept lists that
 *  agree today: a geometry indexing one order and a material uploading another would paint every
 *  parcel a DIFFERENT status's colour — the one failure this surface may never have. */
/** ⚠⚠ THE ROCK IS ONE MORE ROW ON THE SAME RAMP, APPENDED LAST — the sixth component of the
 *  approved land treatment, and the first ground colour on this map that reports nothing.
 *
 *  The owner settled it on 2026-09-01 and moved the fence with it: "the test should be overall
 *  themse color, so we should have flexibility for session to add additional colors as needed, the
 *  session should just look at the final and ask itself can I tell what state this island is in."
 *  So ADR-0414 D1's "every ground colour is a report" is no longer absolute — the constraint is the
 *  OUTCOME (the island's state must still be readable), and applying it is this build's own job.
 *  `src/stepped-skirt.ts` carries the settlement; `docs/research/chapter2-shipped-skirt-2026-09-01/`
 *  carries the picture it was applied to.
 *
 *  ⚠ APPENDED, NEVER INSERTED. Row `i` is what a vertex carrying `statusIndex === i` wears, and
 *  {@link groundRowOf} is the inverse over `GROUND_COLOUR`'s own order — so putting the rock
 *  anywhere but the end would renumber a status and paint every parcel a DIFFERENT status's
 *  colour, which is the one failure this surface may never have. Appending leaves every status
 *  row exactly where it was.
 *
 *  ⚠ AND `GROUND_COLOUR` IS UNTOUCHED, which is why `pnpm check:palette-transcription` still
 *  passes. That check reads the status map off three surfaces — this file, the app's CSS and the
 *  harness's transcription — and refuses any disagreement. The rock is not a status, does not
 *  belong in that map, and joining it there would have made a decoration look like a seventh
 *  state to every reader of all three. */
/** ⚠⚠ TWO ROCK ROWS SINCE 2026-09-01, NOT ONE — a LIT rock and a SHADED one, because a single
 *  token provably cannot span the cliff's tonal range. The approved skirt spans a 5.7x range and
 *  this ladder spans 1.25x, so the arithmetic forbids one token reaching it; and measured over the
 *  rim's azimuths, more than half the cliff is piled on the ladder's DARKEST rung, where a rung
 *  cannot move it and only a token can. `src/stepped-skirt.ts` carries the measurement and the
 *  selection rule; `docs/research/chapter2-skirt-tonal-range-2026-09-01/` carries the pictures. */
export const GROUND_TOKENS: readonly string[] = [
  ...GROUND_COLOUR.values(),
  SKIRT_ROCK_LIT,
  SKIRT_ROCK_SHADED,
];
/** The rocks' own rows — DERIVED from where they were appended rather than written down, so the
 *  geometry's row and the material's token cannot drift to different indices.
 *
 *  ⚠ RELATIVE TO THE END, so appending a THIRD family-less token later moves neither of these by
 *  accident: the lit rock is the second-from-last row and the shaded rock the last, which is the
 *  order `GROUND_TOKENS` is written in above and the only order these two expressions can agree
 *  with. */
const SKIRT_ROCK_SHADED_ROW = GROUND_TOKENS.length - 1;
const SKIRT_ROCK_LIT_ROW = GROUND_TOKENS.length - 2;
const GROUND_ROWS: ReadonlyMap<string, number> = new Map(
  [...GROUND_COLOUR.keys()].map((status, i) => [status, i]),
);

/** The ramp ROW for a status variant. An unrecognised material is `unknown`'s row, exactly as
 *  {@link groundColourOf} falls back to `unknown`'s colour — the one state that means "no data".
 *  Falling back to any other row would have the map assert something about work it could not
 *  classify, and it would do it in the form hardest to notice: a plausible colour. */
const groundRowOf = (material: string | undefined): number =>
  GROUND_ROWS.get(material ?? UNKNOWN_STATUS) ?? GROUND_ROWS.get(UNKNOWN_STATUS)!;

/** THE RAMP ROWS LAYER 1 DRESSES — {@link GRASS_STATUS_GATE} resolved through the SAME
 *  {@link groundRowOf} the geometry indexes with, so the rows the shader gates on and the rows
 *  the mesh writes can never be two orderings that agree today. A hand-written `[0]` here would
 *  be exactly that second ordering, and it would fail the way this file warns about twice
 *  already: by dressing a different status's parcels and looking entirely correct. */
export const GRASS_GATE_ROWS: readonly number[] = GRASS_STATUS_GATE.map(groundRowOf);

/** THE RAMP ROWS THE WHEAT DRESSES — {@link WHEAT_STATUS_GATE} resolved through the SAME
 *  {@link groundRowOf}, for the reason `GRASS_GATE_ROWS` gives. `building` and `proposed` share
 *  one authored token (ADR-0462) and therefore two rows of one colour; both are named, so the
 *  wheat cannot draw two colours for one authored state. */
export const WHEAT_GATE_ROWS: readonly number[] = WHEAT_STATUS_GATE.map(groundRowOf);

/** THE RAMP ROW THE BLIGHT DRESSES — {@link BLIGHT_STATUS_GATE} resolved through the SAME
 *  {@link groundRowOf}, for the reason `GRASS_GATE_ROWS` gives. One status, one row: nothing else
 *  in {@link GROUND_COLOUR} carries the charred token. */
export const BLIGHT_GATE_ROWS: readonly number[] = BLIGHT_STATUS_GATE.map(groundRowOf);

/** EVERY STATUS THAT WEARS A PAINTED STACK — the grass's tokens and the wheat's, the gate the
 *  shadow's depth follows (`paint-every-land-type-arc`: every land type is painted, and the deep
 *  shadow is part of the stack a painted island wears). Derived from the two layer gates rather
 *  than listed, so a token cannot be painted without its shadow or shadowed without its paint. */
export const PAINTED_STATUS_GATE: readonly string[] = [
  ...GRASS_STATUS_GATE,
  ...WHEAT_STATUS_GATE,
  ...BLIGHT_STATUS_GATE,
];

/**
 * HOW DEEP AND HOW SOFT THE SHIPPED SHADOW IS DRAWN — `shadow-rung.ts`'s picks, gated to the
 * SAME tokens the painted layers dress ({@link PAINTED_STATUS_GATE}, resolved through the same
 * colour table the rows are built from). The green AND the wheat islands wear `SHADOW_DEPTH`;
 * every other token keeps the derived rung it wore before. Until 2026-09-06 the depth followed
 * the grass gate alone, and the 14 yellow islands kept the derived rung because they were flat
 * (ADR-0492 D3's deploy gate); painted, they wear the stack's shadow as the green does — a wheat
 * island in a pale shadow beside a green one in a deep shadow would read as two treatments,
 * not one. The reader model's margin for the yellow at the deep rung is printed on the wheat
 * sheet (`docs/research/chapter2-wheat-field-2026-09-06/`), negative, as a report (ADR-0503 D1).
 * The edge applies to every token: a soft rung is SHALLOWER than the derived one, so it is
 * admissible wherever the derived rung is.
 */
export const SHIPPED_SHADOW_DEPTH: ShadowDepthOptions = {
  deep: SHADOW_DEPTH,
  deepTokens: PAINTED_STATUS_GATE.map((status) => GROUND_COLOUR.get(status) ?? GROUND_COLOUR.get(UNKNOWN_STATUS)!),
  edge: SHADOW_EDGE,
};

/**
 * HOW MUCH GRASS THE SHIPPED GROUND WEARS — the delivered strength of layer 1, chosen from a
 * rendered ladder by the LOOK, like every layer above it (ADR-0506, extending ADR-0503 D1 to the
 * base layer; owner-directed 2026-09-03).
 *
 * ⚠⚠ THIS NUMBER WAS 0.32 UNTIL 2026-09-03, AND 0.32 WAS THE REASON THE GROUND DID NOT MATCH THE
 * RENDER THE OWNER STAMPED. 0.32 was the largest strength the per-pixel reader model in
 * `harness/grass-status-reading.ts` admitted with headroom (its ceiling on `healthy` is 0.4065,
 * ADR-0492 D2) — the same instrument that fenced layer 2 to an invisible 0.16 until the owner
 * said the sessions were being too conservative (ADR-0503). At 0.32 a fragment is 68% the flat
 * status token and 32% the recipe's grass, so the island read as the old flat green with a
 * tint, while the approved render's grass IS the recipe at full strength. The owner, shown the
 * finished five-layer stack on 2026-09-03: *"the ground looks nice but doesnt seem like we have
 * achieved the equivalent of what i stamped as the goal ... I'm hoping to get as close to this
 * look as possible."* That is the look-fence of ADR-0489 D3 applied to layer 1, and it is the
 * standing bold-and-scale-back protocol of ADR-0503 D3 applied to the one layer it had skipped.
 *
 * ⚠⚠ WHAT MADE A BOLD FACTOR SAFE TO LOOK AT: THE LAYERS ARE LIT NOW. Until ADR-0506 the grass
 * entered the mix as the recipe's UNLIT albedo while the ramp entry it mixed into was LIT, so
 * every point of strength flattened the ground's own relief banding and the contact shadow
 * under a tree in proportion. `banded-ground-material.ts` now multiplies every colour layer by
 * the fragment's own lighting rung before its mix (`levelSelectGlsl`), which is Cycles' order —
 * shade the composited albedo — on this ladder. Bold strength no longer costs the shading.
 *
 * ⚠ THE LADDER, rendered one island @ 8 px/unit on the Adreno X1-85 with every other layer at
 * what ships: 0.32 (the old map) / 0.55 / 0.70 / 0.85 / 0.95 — `docs/research/
 * chapter2-ground-parity-2026-09-03/ladder-grass-8px.png`. 0.85 ships: the island reads as the
 * approved render's grass — darker, more saturated, the cool/warm drift visible — with enough
 * of the status token left in to keep the green the island's own family. Never 1.0: ADR-0490
 * D5's seam (modulate, never replace) is kept literally, as it is on the sand.
 *
 * ⚠ THE READER MODEL STILL PRINTS, AND ITS MARGIN IS NEGATIVE HERE — that is reported, not
 * hidden. Its per-pixel arithmetic says a dark grass pixel on the darkest rung sits nearer a
 * foreign token's swatch than `healthy`'s; the island, looked at, is plainly a green island
 * (ADR-0503 D4's argument, one layer down). If an owner look ever says a green island reads as
 * another state, this constant moves DOWN the ladder above and nothing else changes.
 */
export const SHIPPED_GRASS_MIX = 0.85;

/** LAYER 1 AS THE SHIPPED GROUND WEARS IT — the factor and the gate in one value, so the canvas
 *  and every comparison arm read one object rather than reassembling two halves. */
export const SHIPPED_GRASS: GroundGrassLayer = {
  mix: SHIPPED_GRASS_MIX,
  rows: GRASS_GATE_ROWS,
};

/**
 * HOW YELLOW THE SHIPPED WHEAT IS — which rung of `WHEAT_ANCHORS` the 14 in-progress islands
 * wear, chosen from a rendered ladder by the look under the owner's standing bold-and-scale-back
 * direction (ADR-0503 D3), and shown to him with the sheet it was chosen from
 * (`docs/research/chapter2-wheat-field-2026-09-06/`).
 *
 * ⚠ THE LADDER, one yellow island @ 8 px/unit and the real forest fitted, on the RTX 2060:
 * `straw` (#d9d18a) / `wheat` (#d6b271, the authored token) / `light-straw` (#c6c06a) /
 * `mustard` (#b0b040) — ordered by the 2026-08-27 instrument's separation from the nearest proof
 * state, ascending. The mustard ships: it is the boldest yellow, the one the 2026-08-27 run
 * measured at 1.8x the straw's separation, and on the sheet (`crop-8px.png`) the two pale rungs'
 * warm half drifts to PEACH and reads as a sandy clay, the light straw to a muddy khaki, where the
 * mustard's stays gold and olive — the only rung that is still a YELLOW island beside a green one.
 * Every rung is darker than the flat token, because the recipe's ramps sit below the token it
 * mixes into (the green wore the same darkening as its approved look); a paler field would be a
 * stop-luma lever, not a different anchor. Scaling back is one edit here along rungs already
 * rendered.
 *
 * ⚠ THE READER MODEL PRINTS AND DOES NOT FENCE (ADR-0503 D1 / ADR-0506, applied to the wheat by
 * this row). Its margin on every rung is negative at the shipped strength — as the green's own
 * is — and is on the sheet with the grid step it was walked at. The look decides (ADR-0489 D3).
 */
export const SHIPPED_WHEAT_ANCHOR = wheatAnchor('mustard').hex;

/** HOW MUCH WHEAT THE IN-PROGRESS GROUND WEARS — the wheat's own factor, set equal to the grass's
 *  so the two painted tokens carry the treatment at one strength, but its OWN constant so a
 *  scale-back on either never moves the other. Never 1.0 (ADR-0490 D5). */
export const SHIPPED_WHEAT_MIX = SHIPPED_GRASS_MIX;

/**
 * HOW PALE THE SHIPPED WHEAT IS — which rung of `WHEAT_LIFTS` the in-progress islands wear: the
 * stop-luma lift on the six rebased stops, in linear space, ratio-preserving, with the mustard
 * anchor above held fixed (`wheat-paleness-ladder`, 2026-09-06). Chosen from a rendered ladder by
 * the look under the owner's standing bold-and-scale-back direction (ADR-0503 D3), and shown to
 * him with the sheet it was chosen from (`docs/research/chapter2-wheat-paleness-2026-09-06/`).
 *
 * ⚠ WHY A SECOND LADDER: the yellowness sheet found every anchor's field darker and duller than
 * the flat token, because the recipe's ramps sit below the token they mix into. The anchor cannot
 * fix that (a paler anchor goes peach); a lift on the stops can, without moving the hue the
 * owner picked — ratio-preserving, so the cool→warm drift and the dark-to-light ladder keep
 * their proportions and only the brightness moves.
 *
 * ⚠ THE LADDER, one in-progress island @ 8 px/unit and the real forest fitted, on the RTX 2060:
 * 1.00 (as derived) / 1.25 / 1.50 / 2.00. THE PICK IS 2.00 — the boldest rung, and the one at
 * which the field's mean delivered brightness reaches the flat token's (the sheet prints both):
 * the island stops reading as a darker island beside the green and reads as a pale gold field.
 * At 2.00 the warm light stop's red clamps at linear white, which bends its delivered hue toward
 * YELLOW (40° → 45°), away from the peach the pale anchors showed (22° and below); every lower
 * rung keeps 40°.
 * Scaling back is one edit here along rungs already rendered.
 *
 * ⚠ THE READER MODEL PRINTS AND DOES NOT FENCE (ADR-0503 D1 / ADR-0506). Its margin is on the
 * sheet per rung, with the grid step it was walked at, negative where it is negative. The look
 * decides (ADR-0489 D3).
 */
export const SHIPPED_WHEAT_LIFT = wheatLift('2.00').lift;

/** THE WHEAT AS THE SHIPPED GROUND WEARS IT — the anchor, the lift, the factor and the gate in
 *  one value. */
export const SHIPPED_WHEAT: GroundWheatLayer = {
  mix: SHIPPED_WHEAT_MIX,
  rows: WHEAT_GATE_ROWS,
  anchor: SHIPPED_WHEAT_ANCHOR,
  lift: SHIPPED_WHEAT_LIFT,
};

/**
 * HOW FAR THE SHIPPED UNHEALTHY GROUND HAS DIED — which rung of `BLIGHT_RUNGS` the unhealthy
 * islands wear, chosen from a rendered ladder by the look under the owner's standing
 * bold-and-scale-back direction (ADR-0503 D3), and shown to him with the sheet it was chosen from
 * (`docs/research/chapter2-unhealthy-ground-2026-09-08/`).
 *
 * ⚠⚠ TUNED FOR THE READ RATHER THAN FOR RICHNESS, WHICH IS A STANDING CONSTRAINT AND NOT AN
 * UNFINISHED JOB. `unhealthy` is the rollup of a FAILED proof: it appears suddenly, it is rare,
 * and it is the one state a viewer most needs to catch at a glance. A later session that finds
 * this island stark and "improves" it toward the subtlety the green and the wheat were tuned for
 * would be undoing the decision, not polishing it. The decision is recorded rather than left in a
 * constant's comment.
 *
 * ⚠ WHY THE LADDER HAD TO BE BOLD AT ALL, measured on the real map rather than argued. The
 * `unhealthy` token is rgb(87, 84, 74); a HEALTHY island on the real 35-island map delivers
 * rgb(87, 97, 74), because the slope-gated rock greys a small island across its whole surface
 * (2026-09-08, `docs/research/chapter2-real-forest-2026-09-08/`). Drawn flat, an unhealthy island
 * would be within thirteen units of one channel of the islands around it.
 *
 * ⚠ THE LADDER, one island forced unhealthy @ 8 px/unit and the real forest fitted, on the RTX
 * 2060 — `sick` / `dying` / `dead` / `scorched`, each a burn on the base and a crack strength
 * together. Scaling back is one edit here along rungs already rendered.
 */
export const SHIPPED_BLIGHT_RUNG = blightRung('dead');

/** HOW MUCH BLIGHT THE UNHEALTHY GROUND WEARS — its own factor, set equal to the grass's so the
 *  painted tokens carry their treatments at one strength, but its OWN constant so a scale-back on
 *  either never moves the other. Never 1.0 (ADR-0490 D5). */
export const SHIPPED_BLIGHT_MIX = SHIPPED_GRASS_MIX;

/** THE BLIGHT AS THE SHIPPED GROUND WEARS IT — the rung's palette, the factor and the gate in one
 *  value. */
export const SHIPPED_BLIGHT: GroundBlightLayer = {
  mix: SHIPPED_BLIGHT_MIX,
  rows: BLIGHT_GATE_ROWS,
  palette: SHIPPED_BLIGHT_RUNG.palette,
};

/**
 * HOW MUCH SAND THE SHIPPED BEACH WEARS — layer 2's own strength, an OWNER-DIRECTED bold value
 * (2026-09-02), not a reader-model ceiling.
 *
 * ⚠⚠ THIS NUMBER USED TO BE 0.16 AND THAT WAS THE WRONG KIND OF CAREFUL. 0.16 is the strength at
 * which `harness/grass-status-reading.ts`'s per-pixel reader model still reports every reachable
 * sand colour nearer its own green than the `building`/`proposed` yellow. It is also a beach nobody
 * can see: the largest channel shift it can produce is 15/255, zero pixels clear ADR-0490 D6's
 * 20/255 bar, and the owner — having looked — said the sessions were being too conservative and
 * that their changes were not noticeable. He directed the layers be applied ADVENTUROUSLY, judged
 * by a picture per step, with "scale it back" as his lever. This is the first of those steps.
 *
 * ⚠⚠ WHAT MOVED IS THE FENCE, NOT THE INSTRUMENT. ADR-0489 D3/D4 already made the OUTCOME the
 * fence — look at the render and ask whether the island's state still reads — and named the
 * per-pixel proxy as one that fails in both directions. The reader model kept fencing layer
 * strengths anyway, and on a wide contiguous band it forbids a colour that costs no legibility at
 * all: at 0.90 the island is unmistakably a green island with a sand shore. The decision recording
 * this and narrowing ADR-0492's admissible-band rule for LAYER STRENGTHS on green islands is the
 * ADR cited on the arc; the reader model stays as an instrument that REPORTS its margin, and stops
 * being the thing that picks the number.
 *
 * ⚠ THE LADDER, measured one island @ 8 px/unit on the Adreno X1-85, colour families against the
 * approved render's 36: 0.16 → 26 (0 px moved >20/255) · 0.40 → 34 (96,016) · 0.65 → 33 (122,088)
 * · 0.90 → 35 (133,750). Evidence: `docs/research/chapter2-bold-sand-2026-09-02/`. The owner saw
 * that ladder and chose twice, the second time scaling back — *"sand .9 looks the best fyi"*, then
 * *"actually lets go with sand 0.65"* (2026-09-02, ADR-0503 D2). 0.65 is his number: the beach is
 * unmistakably sand with more of the island's green left in it than 0.90 keeps.
 *
 * ⚠ THE LADDER IS THE LEVER (ADR-0503 D3). This constant moves along `GRASS_ARM_SAND_MIX`'s rungs in
 * `harness/shipped-grass-scene.ts`, whose frames are already rendered; scaling back is one edit here
 * and no re-measurement. It never reaches 1.0: `mix(c, sand, uSandMix * (1 - band))` at 1.0 delivers
 * the recipe's PURE sand at the waterline, and the status colour left in the beach is what keeps it
 * the island's own colour family rather than a decal — the seam ADR-0490 D5 fences (modulate, never
 * replace) is kept literally, not only in spirit.
 */
export const SHIPPED_SAND_MIX = 0.65;

/** The ONE banded ground material, built once for the module rather than per canvas: it holds
 *  only the authored ramp, the authored light and the authored grain, all of which are constants,
 *  so a second instance would be a second copy of the same 24 colours with a second chance to
 *  disagree.
 *
 *  ⚠ IT WEARS THE GRAIN'S NORMAL HALF, UNCONDITIONALLY AND WITH NO FLAG (2026-08-30) — the third
 *  component of the approved treatment to cross, and the rest of the owner's "improve the ground
 *  texture". The ladder gave the land authored zones; the grain is what gives those zones an EDGE
 *  at the zoomed read, which is the component the research measured as worth +54% of the bare
 *  land's micro-contrast and the only lever that makes the ground survive being zoomed into.
 *
 *  ⚠⚠ AND IT IS THE NORMAL HALF ONLY, WHICH IS A MEASUREMENT RATHER THAN A CAUTION. The Cycles
 *  grain is two mechanisms. The normal half perturbs the lambert BEFORE the quantiser, so the
 *  fragment still writes an authored ramp entry and this material's whole guarantee — every
 *  delivered land pixel is one of 20 authored `(token x level)` colours — is untouched. The
 *  COLOUR half mixes a noise ramp into the delivered colour, and
 *  `harness/grain-status-reading.ts` drove all six ground tokens through that mix and found its
 *  authored fac of 0.13 INADMISSIBLE: the `proposed`/`building` yellow at the ladder's two
 *  darkest rungs walks into `healthy`'s green under the house reader model, which is an
 *  ADR-0392 D5 / ADR-0398 D7 failure rather than a matter of taste. The largest fac every reading
 *  survives is 0.031. That fork is the owner's and is open;
 *  `oq-the-grain-s-colour-half-is-inadmissible-on-the-shipped-pa` carries it. */
/**
 * The ONE banded ground material for a scene.
 *
 * ⚠ IT USED TO BE A MODULE-SCOPE SINGLETON and stopped being one when the shadow arrived
 * (2026-08-30). The ramp, the light and the grain are all constants, so one instance for the
 * module was right; the OCCLUSION FIELD is not a constant — it is built over this island's own
 * ground bounds from this island's own casters — so a shared material would hand every canvas
 * the first one's shadow. It is memoised per parcel set instead, which keeps the "one material,
 * one copy of the 24 colours" property that mattered.
 *
 * ⚠ IT WEARS THE OCCLUSION FIELD UNCONDITIONALLY AND WITH NO FLAG, like the relief, the ladder
 * and the grain before it — the arc's end-state item 6 is explicit that a flag nobody flips is
 * not adoption. The owner asked for shadows by name on 2026-08-29.
 *
 * ⚠⚠ AND THE RUNG IT DARKENS TO IS DERIVED, NOT CHOSEN. `shadowLadderFor` sweeps the ladder
 * downward asking whether every authored ground token still reads as ITSELF, and hands back the
 * deepest level at which they all do — 0.77 on this palette, against a flat-ground rung of 0.90,
 * so a shadowed parcel is about 14% darker than a lit one. One rung below that, the
 * `proposed`/`building` yellow reads as `healthy` green: a merely-proposed capability reporting
 * as signed-off, which is an ADR-0392 D5 / ADR-0398 D7 failure rather than a matter of taste. The
 * headroom is 3.0 weighted channel units and it is the PALETTE's tightness, not the shadow's
 * greed — the same wall the grain's colour half met.
 */
/**
 * LAYERS 3, 4 AND 6 AS THE SHIPPED GROUND WEARS THEM — every one an OWNER-DIRECTED bold value
 * chosen from a rendered ladder (ADR-0503 D1/D3), recorded here with the ladder it was chosen from
 * so a scale-back is one edit along rungs already rendered. Evidence:
 * `docs/research/chapter2-ground-stack-2026-09-02/`.
 */

/** LAYER 3 — the worn path's strength ON the path (`uWearMix`), over the recipe's 3.0-unit falloff
 *  (`WEAR_FIELD_WIDTH`). Ladder: 0.50 / 0.80 / 1.00 — see `harness/shipped-grass-scene.ts`. */
export const SHIPPED_WEAR_MIX = 0.85;

/** LAYER 4 — rock on the steep ground, on the RECIPE'S OWN ENDS (`ROCK_SLOPE_RAMP`, 0.72 / 0.90).
 *  On this mesh those ends bite only on the beach's ring chain (the interior's up-component never
 *  drops below 0.91, `interiorMinimumUp()`), which is what the approved render shows: rock at the
 *  steep coast and NONE across the grass.
 *
 *  ⚠⚠ THAT SENTENCE ONLY BECAME TRUE ON 2026-09-08, AND NOT BY MOVING A NUMBER HERE. The mask was
 *  fed the BUMPED normal — the detail map and the grain having already tilted it — so it opened
 *  across the interior on ground the geometry says is flat, and the map wore grey over its grass
 *  while this comment said it could not. `banded-ground-material.ts` now captures the geometric
 *  normal before either bump (ADR-0553, the owner's taste: "minus the rocks and the logs"). The
 *  ends are untouched, because the ends were never the fault.
 *
 *  From 2026-09-02 to 2026-09-03 the map wore a stated
 *  departure, [0.88, 0.95], that put grey veins along the interior's swells — chosen boldly under
 *  ADR-0503 and never scaled back, but not in the picture the owner stamped, and he asked for that
 *  picture "minus the rocks" (ADR-0506). Ladder, so the departure can be re-picked from a rendered
 *  frame: the recipe's [0.72, 0.90] (SHIPS) / [0.88, 0.95] (`rock-veins`) / [0.92, 0.98]. */
export const SHIPPED_ROCK: GroundRockLayer = { mix: 0.85, slope: ROCK_SLOPE_RAMP };

/** LAYER 6 — how far the cliff normal map bends the surface normal. The recipe's 0.30 is the
 *  provenance rung (`DETAIL_STRENGTH_RECIPE`); it names whorls at 0.55 on a 2048 map, which the
 *  shipped 128-texel tile cannot show at the delivered zoom. Ladder: 0.30 / 0.60 / 1.00. */
export const SHIPPED_DETAIL_STRENGTH = 0.6;

/** The three layers above the sand, as a COMPARISON ARM asks for them — every one optional so an
 *  arm can wear exactly the layers its caption names, and absent means ABSENT (no uniform, no
 *  source, byte-identical shader). The canvas passes {@link SHIPPED_LAYERS}. */
export interface GroundLayerExtras {
  /** LAYER 3: the packed distance-to-path field (from `shippedGroundBuild().wear()`) and the strength. */
  wear?: { field: AtlasField; mix: number };
  /** LAYER 4: the rock's strength and slope ends. */
  rock?: GroundRockLayer;
  /** LAYER 6: the detail normal's strength; the texture and the 2.4-unit tile are the module's. */
  detail?: { strength: number };
}

/** What SHIPS above the sand, minus the wear FIELD (which is per parcel set and comes from the
 *  builder) — the canvas assembles the field in at mount. */
export const SHIPPED_LAYERS: Readonly<Required<Omit<GroundLayerExtras, 'wear'>> & { wearMix: number }> = {
  wearMix: SHIPPED_WEAR_MIX,
  rock: SHIPPED_ROCK,
  detail: { strength: SHIPPED_DETAIL_STRENGTH },
};

/** THE ONE DETAIL TEXTURE FOR THE MODULE, created on first use. It is 26 KB of embedded PNG and a
 *  constant, so a second instance would be a second decode of the same bytes; it is NEVER
 *  disposed with a material, because the next mount reads it again. Lazy because
 *  `TextureLoader` needs a `document`, which a node-side test of an un-detailed arm has no
 *  business requiring. */
let detailTextureMemo: Texture | undefined;
function shippedDetailTexture(): Texture {
  if (detailTextureMemo === undefined) detailTextureMemo = detailNormalTexture();
  return detailTextureMemo;
}

export function buildGroundMaterial(
  field: AtlasField | null,
  grass?: GroundGrassLayer,
  shore?: AtlasField | null,
  /** LAYER 2's strength — {@link SHIPPED_SAND_MIX} unless a COMPARISON arm asks otherwise. The
   *  canvas never passes it; the one caller that does is `harness/shipped-grass-scene.ts`, whose
   *  arms differ in exactly this number so a pixel between two of them is attributable to it. */
  sandMix: number = SHIPPED_SAND_MIX,
  /** LAYERS 3, 4 AND 6 — see {@link GroundLayerExtras}; the canvas passes the shipped set. */
  extras: GroundLayerExtras = {},
  /** THE SHADOW'S DEPTH AND EDGE — {@link SHIPPED_SHADOW_DEPTH} unless a COMPARISON arm asks
   *  otherwise; `null` is the one-rung, hard-edged material the map wore until 2026-09-06, which
   *  is what a ladder's control arm needs. The canvas never passes it. */
  shadowDepth: ShadowDepthOptions | null = SHIPPED_SHADOW_DEPTH,
  /** THE WHEAT — {@link SHIPPED_WHEAT} unless a COMPARISON arm asks otherwise; `null` is the
   *  material as it drew until 2026-09-06, the yellow islands flat, which is what the wheat
   *  ladder's control arm needs. The canvas never passes it. */
  wheat: GroundWheatLayer | null = SHIPPED_WHEAT,
  /** THE BLIGHT — {@link SHIPPED_BLIGHT} unless a COMPARISON arm asks otherwise; `null` is the
   *  material as it drew until 2026-09-08, the unhealthy islands flat, which is what the blight
   *  ladder's control arm needs. The canvas never passes it. */
  blight: GroundBlightLayer | null = SHIPPED_BLIGHT,
) {
  const opts: BandedGroundMaterialOptions = { tokens: GROUND_TOKENS, grain: 'normal' };
  const shadow = field === null ? null : groundAtlasTexture(field);
  if (shadow !== null) opts.shadowAtlas = shadow;
  // By statement, and only where there is a field to read: a depth without an occlusion field is
  // a setting the material would ignore, and an explicit `undefined` is a different input under
  // `exactOptionalPropertyTypes`.
  if (shadow !== null && shadowDepth !== null) opts.shadowDepth = shadowDepth;
  // ⚠ BY STATEMENT, and absent means ABSENT: under `exactOptionalPropertyTypes` a `grass:
  // undefined` is a different input from no key at all, and only the second leaves the emitted
  // shader byte-identical to the one every measured figure about this ground was taken against.
  if (grass !== undefined) opts.grass = grass;
  // ⚠ THE WHEAT RIDES THE GRASS (its structure is the grass's), so it is offered only when there
  // is a grass to ride — the material refuses the combination anyway, and refusing here as well
  // would turn an ordinary "this arm wears no grass" into a throw. By statement, absent means
  // absent, for the grass's own reason.
  if (wheat !== null && grass !== undefined) opts.wheat = wheat;
  // ⚠ THE BLIGHT RIDES THE GRASS TOO (its base is the grass's structure), offered only where
  // there is a grass to ride, for the wheat's reason.
  if (blight !== null && grass !== undefined) opts.blight = blight;
  // ⚠ LAYER 2 RIDES LAYER 1, so it is offered only when there is a layer 1 to ride and an atlas to
  // sample through — the material refuses either combination anyway, and refusing here as well
  // would turn an ordinary "this arm wears no grass" into a throw.
  const shoreTex = shore === null || shore === undefined ? null : groundAtlasTexture(shore);
  if (shoreTex !== null && grass !== undefined) {
    opts.sand = { shore: shoreTex.texture, mix: sandMix, width: SAND_FIELD_WIDTH };
  }
  // ⚠ LAYERS 3, 4 AND 6, each by statement and each only where its carrier exists — the material's
  // own refusals stand behind these (wear needs grass + the atlas, rock needs grass, detail needs
  // the grain), so a wrong combination throws there with its reason rather than drawing quietly.
  const wearTex = extras.wear === undefined || grass === undefined ? null : groundAtlasTexture(extras.wear.field);
  if (wearTex !== null && extras.wear !== undefined) {
    opts.wear = { field: wearTex.texture, mix: extras.wear.mix, width: WEAR_FIELD_WIDTH };
  }
  if (extras.rock !== undefined && grass !== undefined) opts.rock = extras.rock;
  if (extras.detail !== undefined) {
    opts.detail = { map: shippedDetailTexture(), strength: extras.detail.strength, tile: DETAIL_TILE_UNITS };
  }
  return { material: createBandedGroundMaterial(opts), shadow, shoreTex, wearTex };
}

/**
 * THE OCCLUSION FIELD, PACKED OVER THE ISLANDS — adopted 2026-08-31, unconditionally and with no
 * flag, like the relief, the ladder, the grain and the shadow itself before it.
 *
 * ⚠⚠ IT REPLACED A FIELD ALLOCATED OVER THE GROUND'S RECT, and the reason is a measurement
 * rather than a preference. `occlusionGres` is `min(SHADOW_GRES, SHADOW_TEXTURE_MAX / widestSpan)`,
 * so ONE island (234 ground units) got the authored 3.000 samples per ground unit and a real
 * thirty-five-island forest (~3,500) got 0.585 — 5.1x coarser, against parcels whose mean
 * diameter is 16.57. The contact pool under a story tree lost 5.5% of its area and 15.3% of its
 * pixels moved: a soft round shadow became a lumpy one, precisely when the map became the real
 * map. Packed over the islands themselves it is the authored resolution at every map size, and a
 * SINGLE island is byte-identical to what it was (measured: 0.000% of the frame moved).
 *
 * ⚠ A PARCEL SET THAT BOUNDS NOTHING GETS NO FIELD, rather than a one-texel one every fragment
 * then samples. `groundBounds` returns null rather than a degenerate rect precisely so this branch
 * has to be written down.
 *
 * The costing of all three remedies — raising the texture cap (26x the memory, a 10,498-texel
 * edge), a field and a material PER ISLAND (35 draw calls with the whole forest on screen), and
 * this one — is `docs/research/chapter2-shipped-shadow-2026-08-31/`.
 */
/**
 * HOW MANY LEDGES KEEP THE PARCEL'S OWN STATUS TINT before the rock starts — the shipped answer to
 * the fork the owner declined to pick between.
 *
 * His settled question offered "all six ledges are rock" (A) and "the top ledge keeps the health
 * tint, the five below are rock" (B), and he answered neither: he stamped the rock and handed the
 * session the outcome test instead. ZERO is A, and it is what ships, decided against the pictures
 * in `docs/research/chapter2-shipped-skirt-2026-09-01/` rather than against the recommendation:
 *
 *  - THE STATE IS STILL READABLE WITHOUT THE BAND. The parcel's TOP FACE is the status surface and
 *    it is ~93% of the island's own pixels; the cliff is the remaining ~7%, seen edge-on. Asking
 *    the owner's question of arm A's picture — can I tell what state this island is in — the answer
 *    is yes, and it is not a close call.
 *  - B'S BAND BUYS LESS THAN IT COSTS. The top ledge is cut ~0.40 units INBOARD of the rim, so from
 *    a 2.5D isometric camera it is the ledge most hidden by the parcel above it — the one place a
 *    status band is least readable, which is the opposite of the reason B was recommended.
 *  - AND B SPENDS THE THING THE COMPONENT IS FOR. The research measured the kit's cliff as worth
 *    9.8% of the picture's structural contrast because it supplies the island's DARK ANCHOR; a
 *    lit status band across the top course is exactly what lifts that anchor again.
 *
 * ⚠ IT IS A NUMBER RATHER THAN A BOOLEAN so B stays one edit away, and `stepped-skirt.test.ts`
 * holds both arms. Nothing about the fence turns on which is chosen — the owner's test is the
 * fence now, and both arms pass it.
 */
const SHIPPED_SOIL_LEDGES = 0;

/** The skirt the shipped map wears, over the parcels it will actually draw.
 *
 *  ⚠ THE RIM CENSUS IS TAKEN ONCE PER BUILD, NOT ONCE PER PARCEL. It is a whole-island question —
 *  an edge is rim because NO OTHER parcel uses it — so a per-parcel answer is not merely slower,
 *  it is unanswerable: a parcel cannot see its neighbours. */
function shippedSkirt(cells: readonly InstanceDescriptor[]): GroundSkirt {
  const rim = rimEdgeKeys(cells);
  return {
    rows: SKIRT_ROWS,
    lit: { row: SKIRT_ROCK_LIT_ROW, colour: linearColourOfHex(SKIRT_ROCK_LIT) },
    shaded: { row: SKIRT_ROCK_SHADED_ROW, colour: linearColourOfHex(SKIRT_ROCK_SHADED) },
    // ⚠ THE CLIFF'S LOWER HALF WEARS THE SHADED ROCK, decided against the pictures in
    // `docs/research/chapter2-skirt-tonal-range-2026-09-01/` rather than by argument. The obvious
    // rule — shade what the LADDER cannot express — is built and measured there too, and it loses:
    // the faces it selects are seen nearly edge-on and cover 1% of the island, so the island's dark
    // anchor cannot see them. `shadeBelowLadderFloor` carries that measurement.
    isShaded: shadeBelowHalfDepth,
    soilLedges: SHIPPED_SOIL_LEDGES,
    isRim: (a, b) => isRimEdge(rim, a, b),
  };
}

function buildGroundOcclusionField(
  cells: readonly InstanceDescriptor[],
  casters: readonly ShadowCaster[],
  penumbra: number,
  contactBand: ContactBand,
  contactSpread: number,
): AtlasField | null {
  if (groundBounds(cells) === null) return null;
  return buildAtlasOcclusion({ cells, relief: LAND_RELIEF_AMPLITUDE, casters, penumbra, contactBand, contactSpread });
}

/**
 * THE SHIPPED GROUND'S GEOMETRY INPUT, BUILT IN EXACTLY ONE PLACE.
 *
 * ⚠⚠ IT IS EXPORTED, AND THAT IS THE WHOLE POINT — it is the structural answer to the hazard
 * `comparison-baseline-moves-under-the-page` records, which cost `adopt-the-land-into-the-
 * shipped-map-arc` a confidently wrong result on PR #1782. A comparison page that constructs its
 * OWN scene has a CONTROL ARM that silently becomes the map as it stood the day the page was
 * written: when a sibling lands, the arm keeps returning byte-identical numbers, which reads as
 * reassurance, and the page then reports the PREVIOUS component's effect as the new one's.
 *
 * `land-ground-stack-arc` parks FIVE layers landing one after another onto this exact function,
 * so every one of them inherits that hazard. Asserting "the arm passes every key `CellGround`
 * passes" would be a check someone has to keep true; calling the same builder makes it true by
 * construction, and there is nothing left for a later layer to forget.
 *
 * ⚠ THE OCCLUSION FIELD COMES BACK WITH THE INPUT rather than being rebuilt by the caller. The
 * mesh's atlas origins and the material's atlas are two halves of one packing; a caller that
 * packed its own would draw every island through some other island's corner of the atlas, which
 * looks like an ordinary set of shadows belonging to the wrong land.
 */
export interface ShippedGroundBuild {
  /** The packed occlusion field the geometry's atlas origins were resolved from — `null` when the
   *  parcel set bounds nothing, which is the one case that must not become a one-texel field every
   *  fragment then samples. */
  field: AtlasField | null;
  /** LAYER 2's carrier: the distance-to-coast field, packed over {@link field}'s OWN tiles.
   *
   *  ⚠ IT COMES BACK FROM HERE rather than being built by the caller, for the same reason the
   *  occlusion field does: the two atlases must agree about where each island's tile sits, and
   *  `buildAtlasShore` makes that structural by reading the occlusion field's tiles. A caller that
   *  packed its own would draw every island's beach against another island's coastline.
   *
   *  ⚠ AND IT IS THE HAZARD-PROOFING THIS INTERFACE EXISTS FOR. Every comparison arm calls
   *  `shippedGroundBuild`, so a new layer's field reaches every arm the moment it is added here —
   *  which is what stops a control arm quietly becoming the map as it stood before this layer.
   *
   *  ⚠⚠ IT IS A THUNK, NOT A VALUE, AND THAT IS A MEASUREMENT RATHER THAN A STYLE. Building it
   *  costs **117 ms for one island and 2.66 s for the 35-island forest** (measured 2026-09-02,
   *  after `shore-grid.ts` replaced the per-texel walk over every coast edge with a uniform grid
   *  whose far-field short-circuit answers most of the 5.4 M texels without touching an edge; it
   *  was 859 ms / 54 s before that). Layer 2 IS adopted, at {@link SHIPPED_SAND_MIX} = 0.65, so
   *  the shipped canvas pays this once on mount; a comparison page with several arms pays it once
   *  per `shippedGroundBuild` call and reads the memo after, which is why it stays a thunk. */
  shore: () => AtlasField | null;
  /** LAYER 3's carrier: the distance-to-path field, packed over {@link field}'s OWN tiles — the
   *  same structural agreement the shore has, and for the same reason: the mesh carries one atlas
   *  origin, so every per-fragment field on this ground rides the one packing.
   *
   *  ⚠ THE PATHS ARE THE CANVAS-SIDE CONNECTOR'S (`island-path.ts`, ADR-0463 D1): every visible
   *  `trail-strip` end within reach of an island's rim is that island's dock, and the worn path is
   *  what joins the island's docks across its interior. A build handed no strips (the default)
   *  yields a field of no wear everywhere — every texel at 255 — which is what the ground drew
   *  before the layer existed. Built from the CLIPPED parcels, like everything else here: after
   *  `clipToCoast` the mesh's rim IS the coast, so a dock snapped onto it is a dock at the water.
   *
   *  ⚠ A THUNK AND MEMOISED, like {@link shore}: the same per-texel walk over the same tiles, so
   *  the same cost class, and `null` for the same reason — no occlusion field means no tiles to
   *  pack it over. */
  wear: () => AtlasField | null;
  input: CellGroundGeometryInput;
}

export function shippedGroundBuild(
  cells: InstanceDescriptor[],
  casters: readonly ShadowCaster[],
  /** The visible `trail-strip` descriptors, whose ends dock on the islands (layer 3's connector).
   *  DEFAULTED so every caller that predates the layer is unchanged and wears no path. */
  strips: readonly InstanceDescriptor[] = [],
  /** The cast shadow's soft-edge width — `SHADOW_PENUMBRA` unless a COMPARISON arm asks
   *  otherwise; the canvas never passes it. */
  penumbra: number = SHADOW_PENUMBRA,
  /** Which rung the contact pools land on — `SHADOW_CONTACT_BAND` unless a COMPARISON arm's
   *  control asks for the field as it was; the canvas never passes it. */
  contactBand: ContactBand = SHADOW_CONTACT_BAND,
  /** How far the contact pools spread — `CONTACT_SPREAD` unless a COMPARISON arm asks for a rung
   *  of its ladder; the canvas never passes it. */
  contactSpread: number = CONTACT_SPREAD,
): ShippedGroundBuild {
  // ⚠⚠ THE COAST IS CLIPPED FIRST, AND EVERYTHING DOWNSTREAM READS THE CLIPPED PARCELS.
  // The occlusion atlas is packed over the ground's own bounds, so packing it over the PRE-clip
  // island would leave the new shore outside every tile: the beach would read the atlas's edge
  // texel and wear whatever shadow happened to sit there. Ordering it here makes that
  // impossible rather than merely unlikely.
  //
  // ⚠ AND IT IS THE GROUND ALONE. `dressMapFromKit` (below) still reads the mapper's own
  // descriptors, so a tree stands where its parcel put it and the beach grows underneath it.
  // Moving the props with the shore would have been a second change wearing this one's name.
  const clipped = clipToCoast(cells, SHIPPED_COAST);
  // ⚠ THE FIELD IS BUILT FIRST AND THE GEOMETRY READS ITS PACKING, which is what makes "the
  // mesh and the material agree about where each island's tile is" true by construction rather
  // than by two calls happening to pack the same way. They disagree silently: every island would
  // read some other island's corner of the atlas, and the map would wear a perfectly ordinary
  // set of shadows belonging to the wrong land.
  const field = buildGroundOcclusionField(clipped, casters, penumbra, contactBand, contactSpread);
  const input: CellGroundGeometryInput = {
    cells: clipped,
    resolve: linearColourOf,
    index: groundRowOf,
    // ⚠⚠ THE SHORE FALL READS THE CLIPPED PARCELS, AND THAT ORDERING IS THE COMPONENT.
    // After `clipToCoast` the boundary of this mesh IS the coast, so the distance to the
    // mesh's own rim is the distance to the shore — one coastline, not two to keep in step.
    // Handed the pre-clip descriptors it would measure to the hex silhouette and put the
    // waterline a beach's width inland of the water.
    //
    // ⚠ IT IS A STRICT EXTENSION OF `landRelief`, WHICH IS WHY THIS LINE REPLACES IT RATHER
    // THAN JOINING IT. Inland of the band the field returns `landHeight` to the last bit, so
    // the whole interior of every island draws exactly what it drew before; only the beach
    // the coast clip added is new ground, and only there does the land move.
    relief: shoreRelief(clipped, SHIPPED_SHORE),
    // ⚠⚠ THE STEPPED SKIRT, AND IT READS THE CLIPPED PARCELS FOR THE SAME REASON THE SHORE FALL
    // DOES. After `clipToCoast` the boundary of this mesh IS the coast, so the edges used once
    // are the shore's own edges. Handed the pre-clip descriptors the cliff would be cut into the
    // hex silhouette and then the beach would grow OUTSIDE it — a rock wall standing in the
    // middle of the sand.
    skirt: shippedSkirt(clipped),
    // ⚠⚠ THE SAME ARM SUPPLIES THE MESH, AND IT HAS TO. The shore fall is an analytic field; the
    // ring is the vertices that let a triangulation carry its shape. Reading the band from one
    // arm and the ring from another would draw a falloff bending through chains placed for a
    // different band, and nothing downstream could tell.
    //
    // ⚠ ON AN ARM WITH NO RINGS THIS RESOLVES TO EVERY PARCEL'S OWN RING, so the line is the
    // pre-ring buffer verbatim — which is what keeps `SHIPPED_SHORE` a single switch over the
    // whole comparison rather than two that could disagree.
    decompose: shoreArmRingPlan(clipped, SHIPPED_SHORE).decompose,
  };
  // By statement rather than a conditional spread: under `exactOptionalPropertyTypes` an absent
  // `atlasOrigin` and an `atlasOrigin: undefined` are different inputs, and only the first
  // leaves the emitted buffer the one every pre-adoption figure was taken on.
  if (field !== null) input.atlasOrigin = atlasOriginResolver(field);
  // ⚠ BUILT FROM THE OCCLUSION FIELD'S OWN TILES, and from the CLIPPED parcels for the same
  // reason everything else here reads them: after `clipToCoast` the boundary of this mesh IS the
  // coast, so the distance to the mesh's rim is the distance to the water. Handed the pre-clip
  // descriptors the sand would trace the hex silhouette and sit a beach's width inland of the sea.
  // ⚠ MEMOISED BEHIND THE THUNK so two arms asking twice pay once — the build is 54 s at forest
  // scale, so "called more than once" is not a theoretical concern on a page with three arms.
  let shoreMemo: AtlasField | null | undefined;
  const shore = (): AtlasField | null => {
    if (shoreMemo === undefined) shoreMemo = field === null ? null : buildAtlasShore(clipped, field);
    return shoreMemo;
  };
  // ⚠ LAYER 3'S CARRIER, over the SAME tiles and from the SAME clipped parcels, memoised behind a
  // thunk for the same reason. The docks are read off the strips against the CLIPPED rim, so a
  // trail that ends at the water docks at the water rather than a beach's width inland of it.
  let wearMemo: AtlasField | null | undefined;
  const wear = (): AtlasField | null => {
    if (wearMemo === undefined) {
      wearMemo = field === null ? null : buildAtlasWear(islandPaths(clipped, strips), field);
    }
    return wearMemo;
  };
  return { field, shore, wear, input };
}

/** The RELAXED-MESH ground: every parcel on the island in ONE merged, flat-shaded buffer.
 *
 *  ⚠ THIS IS THE SUBSTRATE THE STUDIO ACTUALLY SHIPS, and until 2026-08-28 this canvas drew
 *  nothing for it — the mapper had a case for the classic `tile` hex only, so 164 parcels fell
 *  through to a skip and a real island rendered as one story tree over empty space (measured and
 *  pictured by `adopt-the-land-into-the-shipped-map-arc-inc-01`, PR #1679).
 *
 *  ⚠ ONE MESH, NOT ONE PER PARCEL. Parcels are arbitrary polygons, so they cannot share a
 *  geometry and `<Instances>` is unavailable; 164 separate meshes would cost 164 draw calls to
 *  draw ground the classic substrate drew in one. The merge keeps it at one, and per-parcel status
 *  colour survives as a vertex attribute.
 *
 *  ⚠ IT STANDS ON THE RELIEF FIELD, UNCONDITIONALLY AND WITH NO FLAG (2026-08-30). The owner
 *  authorised adoption on 2026-08-29 and the arc's end-state item 6 is explicit that a flag
 *  nobody flips is not adoption. `landRelief` costs no triangles, no draw call and no attribute
 *  channel — the vertices this mesh already emits simply stand where the land is and face the way
 *  it turns. The before/after is taken by calling `cellGroundGeometry` with and without it, which
 *  is why the field is an INPUT rather than something this file reaches for internally.
 *
 *  ⚠ AND IT WEARS THE BANDED LADDER, ALSO UNCONDITIONALLY AND FOR THE SAME REASON (2026-08-30).
 *  Relief alone arrives through `meshStandardMaterial` as a SMOOTH lambert gradient, which is not
 *  what the approved research renders show — they show four authored zones. Relief was the
 *  precondition (a ladder over a flat plane has one rung to quantise onto); this is the ladder.
 *  What changes for the map's honesty is a TIGHTENING rather than a risk: the smooth material
 *  could deliver any lightness the scene lights produced, where every pixel this one can emit is
 *  one of the 24 authored `(token x level)` products, floored at 0.78 of the token.
 *
 *  ⚠ AND IT WEARS THE GRAIN'S NORMAL HALF, ALSO UNCONDITIONALLY AND FOR THE SAME REASON
 *  (2026-08-30). See {@link BANDED_GROUND} for why only that half of the grain ships.
 *
 *  ⚠ AND IT IS CLIPPED TO ITS COAST, ALSO UNCONDITIONALLY AND FOR THE SAME REASON (2026-09-01).
 *  The relaxed substrate pins its outer vertices to the hexes it was built from, so an island used
 *  to end in 120° corners and read as a cluster of tiles. It now ends on the story-seeded,
 *  Chaikin-rounded coast the studio's 2D map has drawn all along — the same `smoothCoast` machinery,
 *  imported rather than transcribed, so the two renderers agree about where an island ends.
 *  {@link SHIPPED_COAST} names which of the three shapes ships and why; `src/coast-clip.ts` carries
 *  the fork, and `docs/research/chapter2-shipped-coast-2026-09-01/` carries the pictures.
 *
 *  ⚠⚠ WHAT IT COSTS THE MAP'S HONESTY IS NOTHING, AND THAT IS A MEASURED CLAIM RATHER THAN AN
 *  ASSUMPTION. Every parcel keeps its own capability, its own island and its own status colour; the
 *  only thing that moves is where the outermost ones end. And the clip is CAPPED so that no parcel
 *  crosses itself — which it would otherwise do, because the coast the 2D panel draws
 *  self-intersects twice on this very island and an SVG fill hides what a triangulated ground
 *  cannot.
 *
 *  ⚠ SO THE COLOUR ATTRIBUTE IS GONE FROM THE UPLOAD, and `statusIndex` is what replaces it. The
 *  buffer still CARRIES `colors` — the comparison instrument builds the pre-adoption arms out of
 *  it — but uploading an attribute no material reads would be payload the map draws nothing
 *  with. */
function CellGround({ ground }: { ground: GroundInput }) {
  // ⚠ ONE DEPENDENCY, NOT THREE. The parcels, the casters and the strips are derived together by
  // `createGroundInputCache` and handed over as one object, so this memo cannot be re-entered for a
  // ground that did not change — and, just as important, cannot be SKIPPED for one that did. Three
  // separate deps were three chances for the identities to disagree; `ground.revision` is the count
  // this memo runs, and it is what `ground-dependency.test.ts` asserts in both directions.
  const built = useMemo(() => {
    const { cells, casters, strips } = ground;
    const { field, shore, wear, input } = shippedGroundBuild(cells, casters, strips);
    const geo = cellGroundGeometry(input);
    // ⚠ LAYER 1 IS WORN UNCONDITIONALLY AND WITH NO FLAG, like the relief, the ladder, the grain
    // and the shadow before it — this arc's end-state item 6 is explicit that a flag nobody
    // flips is not adoption, and the layer sat built-but-switched-off for a day on exactly that
    // shape. It is gated per TOKEN rather than by a flag: {@link SHIPPED_GRASS} dresses the green
    // and multiplies every other row's mix by zero, so those rows deliver the pixel they
    // delivered before it existed (ADR-0492 D1).
    // ⚠ LAYER 2 IS NOW WORN TOO — unconditionally, no prop, no flag (end-state item 6). It was
    // held back on 2026-09-02 because under ONE shared factor it could not be both seen and
    // honest; given its own factor it is fenced on its own measurement (0.16 with layer 1 at
    // 0.32) and layer 1's delivered pixel is unchanged. The owner asked for a wider beach, which
    // is the axis that costs the reading guarantee nothing.
    // ⚠ LAYERS 3, 4 AND 6 ARE WORN TOO (2026-09-02, ADR-0503) — the worn path along the trail
    // docks, rock on the steep ground, and the cliff normal as detail relief, at the strengths the
    // owner chose from their ladders. The wear FIELD is per parcel set, so it is built here and
    // handed in; the rock and the detail are constants.
    const wearField = wear();
    const extras: GroundLayerExtras = { rock: SHIPPED_LAYERS.rock, detail: SHIPPED_LAYERS.detail };
    if (wearField !== null) extras.wear = { field: wearField, mix: SHIPPED_LAYERS.wearMix };
    return { geo, ...buildGroundMaterial(field, SHIPPED_GRASS, shore(), SHIPPED_SAND_MIX, extras) };
  }, [ground]);
  // ⚠ THE MATERIAL AND ITS TEXTURE ARE DISPOSED, WHICH THE MODULE-SCOPE SINGLETON NEVER NEEDED
  // TO BE. The occlusion field is about 107 KB of GPU memory for one island, and a canvas that
  // re-mounts on every navigation would strand one copy per visit — a leak that grows with use
  // and is invisible until a long session runs out of texture memory.
  useEffect(
    () => () => {
      built.material.dispose();
      built.shadow?.texture.dispose();
      // ⚠ THE SHORE FIELD IS A SECOND TEXTURE OF THE SAME SIZE, so it doubles the leak this
      // effect exists to prevent if it is not disposed with the first — about 107 KB per island
      // per re-mount, invisible until a long session runs out of texture memory.
      built.shoreTex?.texture.dispose();
      // And the wear field is a THIRD of the same size. (The detail normal is a module constant
      // and is deliberately not disposed here — the next mount reads the same 26 KB again.)
      built.wearTex?.texture.dispose();
    },
    [built],
  );
  if (built.geo.triangles === 0) return null;
  return (
    <mesh material={built.material}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[built.geo.positions, 3]} />
        <bufferAttribute attach="attributes-normal" args={[built.geo.normals, 3]} />
        <bufferAttribute
          attach={`attributes-${GROUND_STATUS_ATTRIBUTE}`}
          args={[built.geo.statuses, 1]}
        />
        {/* The island's tile corner in the packed occlusion atlas. Absent when the parcel set
            bounds nothing and therefore wears no field — the shader declares no attribute in that
            case either, so an empty buffer here would be one nothing reads. */}
        {built.geo.atlasOrigins.length > 0 && (
          <bufferAttribute
            attach={`attributes-${GROUND_ATLAS_ATTRIBUTE}`}
            args={[built.geo.atlasOrigins, 2]}
          />
        )}
      </bufferGeometry>
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// THE BOUGHT KIT — one object per capability (ADR-0475)
// ---------------------------------------------------------------------------

/**
 * THE KIT, PARSED ONCE FOR THE WHOLE PAGE.
 *
 * ⚠ A MODULE-SCOPE PROMISE RATHER THAN PER-MOUNT STATE, and it is the right singleton here for
 * the reason the ground material is NOT one: the kit is a constant — the same asset, the same
 * geometry, the same three materials, whatever island is on screen — where the occlusion field is
 * built from THIS island's own casters. Parsing it per mount would decode the same textures again
 * on every navigation and hold a second copy of them on the GPU.
 */
let kitPromise: Promise<LoadedKit> | null = null;
const kit = (): Promise<LoadedKit> => (kitPromise ??= loadEmbeddedKit());

/**
 * ONE BOUGHT OBJECT PER CAPABILITY, ITS SPECIES AND LEAF TINT CARRYING THAT CAPABILITY'S STATE.
 *
 * The owner settled this vocabulary on 2026-08-29 (ADR-0475) and authorised the crossing the same
 * day. Until then the shipped map drew ONE of the 1,089 things the semantic scene puts on its
 * ground: the story tree, and nothing else. That one has since been retired too (ADR-0508), so
 * every object standing on this map is now a kit placement and this component draws all of them.
 *
 * ⚠⚠ THE BLOOMS ARE DRAWN PER ISLAND, AND THE WHOLE-MAP CALL THAT PRECEDED IT WAS THE HAZARD. The
 * vocabulary's sixth entry is one flower per UAT criterion the owner has signed (ADR-0226 D4), and
 * it is a claim about a STORY rather than about a capability. This component used to hand every
 * `cell-ground` descriptor on the map to `dressIslandFromKit` in ONE call — correct while the map
 * held one island, and a misreport the moment it held two, because a bloom is scattered over every
 * cell it is given. So the count was pinned at zero until `worldTo3D` learned the island id.
 * `dressMapFromKit` now spends each story's signatures on that story's own ground; a cell the
 * substrate cannot attribute still grows its capabilities' trees and never a bloom.
 *
 * ⚠⚠ IT DRAWS A PLACEMENT LIST IT IS HANDED, AND COMPUTES NONE OF ITS OWN (2026-09-03). The
 * placement used to be made here, from footprints read off the LOADED kit, which meant it existed
 * only after the asset had parsed — and the ground, built synchronously at mount, could not know
 * where anything would stand. So every kit object cast NO shadow: the contact pools and cast
 * shadows the field already carried were drawn under the placeholder story tree alone. The
 * placement is now PURE and SYNCHRONOUS from the frozen `KIT_FOOTPRINTS_2026_08_29`, made ONCE in
 * `ForestWorldCanvas` before the ground is built, and the SAME list reaches both consumers: the
 * ground's casters (`placementCasters`) and this component. One placement, two readers — a tree
 * and its shadow cannot be two lists that agree today.
 *
 * ⚠ THE LOADED KIT IS STILL HELD TO THE FROZEN TABLES, loudly, where it is loaded — the tolerance
 * check `harness/kit-island-scene.ts` refuses a run over is run here on the same asset. It REPORTS
 * rather than refuses: a re-exported tree at the wrong clearance is a visible defect, while a map
 * that drew no props over it would be every capability unreported, which ADR-0392 D5 / ADR-0398
 * D7 rank strictly worse. The console line names the role and both numbers.
 */
function KitProps({ placements }: { placements: readonly KitPlacement[] }) {
  const [loaded, setLoaded] = useState<LoadedKit | null>(null);
  useEffect(() => {
    let live = true;
    // A kit that fails to parse must not take the MAP down with it: the ground is the thing that
    // reports proof state, and it reports it correctly with no props on it. The refusal is loud
    // in the console and the island simply stands bare.
    kit().then(
      (k) => {
        if (live) setLoaded(k);
      },
      (err: unknown) => {
        console.error('ForestWorldCanvas: the bought kit did not load, so no props are drawn', err);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const meshes = useMemo(() => {
    if (!loaded) return [];
    const drift = [...footprintDriftOf(roleFootprints(loaded)), ...heightDriftOf(roleHeights(loaded))];
    if (drift.length > 0) {
      console.error(
        'ForestWorldCanvas: the loaded kit disagrees with the frozen tables every placement and ' +
          'every shadow on this map were computed from — re-measure and update the literals',
        drift,
      );
    }
    return kitMeshes(loaded, placements);
  }, [loaded, placements]);

  // ⚠ THE MERGED GEOMETRY IS DISPOSED, THE KIT'S OWN IS NOT. `kitMeshes` clones every part and
  // bakes its transform in, so each mesh here owns geometry nothing else refers to; the kit's
  // source geometry and its materials are the module singleton's and outlive every mount.
  useEffect(
    () => () => {
      for (const m of meshes) m.geometry.dispose();
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m: Mesh, i: number) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// ⚠⚠ `StoryTree` STOOD HERE UNTIL 2026-09-04 AND IS RETIRED, NOT MOVED (ADR-0508). It drew a
// cylinder trunk under a cone crown at every island's centre, from `ground-casters.ts`'s
// `STORY_TREE_TRUNK` / `STORY_TREE_CROWN` — the hand-built placeholder that predated the bought
// kit, and the one object on this map that was not from the pack. The owner: "under this new look
// the center tree will no longer be a thing, each island will be a small grove or forest". Since
// ADR-0475 D2 the LAND carries the story's own state uniformly across the island, so the crown was
// a second copy of a signal the ground already reports; `KitProps` below stands the kit's trees
// in its place (one per capability and nothing else tree-shaped since ADR-0518 — the grove that
// briefly joined them was retired), and the trunk/crown constants and the caster derived from them went in the same
// landing. There is nothing to mount here and nothing behind a flag: `world-to-3d.ts` no longer
// emits the `story-tree` family, so the descriptor this component read does not arrive.
//
// ⚠ THE 2D MAPS ARE UNTOUCHED and still draw their own hero tree from the same scene node
// (`.story-tree .crown-lo circle`, ADR-0226's crown token) — which is why {@link CROWN_COLOUR}
// above stays. It is the transcription of that authored vocabulary, and it is what
// `leaf-tint.ts`'s `mapped` token is measured against.

function TrailStrip({ strip }: { strip: InstanceDescriptor }) {
  const pts = strip.points ?? [];
  if (pts.length < 2) return null;
  return (
    <Line
      points={pts.map((p) => [p.x, p.y + 0.2, p.z] as [number, number, number])}
      color="#b0a48e"
      // width from the ONE shared rule (trailFillWidth, baked into the descriptor)
      lineWidth={strip.width ?? 3}
    />
  );
}

function CaveArch({ cave }: { cave: InstanceDescriptor }) {
  const { x, y, z } = cave.transform;
  const hw = ((cave.width ?? 4) * 1.6) / 2; // arch mouth half-width (matches the 2D prop)
  return (
    // -bearing about +Y points local +x along the outward rim normal (SVG y → 3D z
    // flips handedness); the unlit dark disc faces outward — ADR-0169 §4.
    <group position={[x, y, z]} rotation={[0, -(cave.bearing ?? 0), 0]}>
      <mesh position={[0, hw * 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[hw, 24]} />
        <meshBasicMaterial color="#171310" />
      </mesh>
    </group>
  );
}

function WispSprite({ wisp }: { wisp: InstanceDescriptor }) {
  const { x, y, z } = wisp.transform;
  return (
    <mesh position={[x, y + 20, z]}>
      <sphereGeometry args={[2.2, 12, 12]} />
      <meshStandardMaterial color="#ffe9a8" emissive="#ffd75e" emissiveIntensity={1.4} />
    </mesh>
  );
}

export interface ForestWorldCanvasProps {
  /** The pure mapping's output (`worldTo3D(buildScene(input))`). Skips are ignored
   *  here — they are audit records, not drawables. */
  descriptors: readonly Descriptor3D[];
  /**
   * The app clock's current presentation. This is deliberately only the consumption seam: the
   * renderer owns no clock or schedule, and the geometry application follows in the next unit.
   */
  regrow?: ForestRegrowPresentation | null;
  /** Opt the trail network visible. Trails are HIDDEN BY DEFAULT (ADR-0169 §3): with
   *  no focus concept on this canvas yet, the honest minimal reveal is all-or-nothing —
   *  a future focus feature filters strips by their `edges` metadata instead. */
  showTrails?: boolean;
  /**
   * THE FRAME THIS CANVAS IS DELIVERED INTO, CSS px — present ⇒ open on the DESIGNED RESTING VIEW
   * (ADR-0471), absent ⇒ open on the fit.
   *
   * ⚠ IT IS A PROP RATHER THAN A MEASUREMENT TAKEN INSIDE, and the reason is where the two numbers
   * are needed. `restingFrame` decides a scale AND an anchor, so it has to run before the
   * `<Canvas>` is written — `position` and the `MapControls` target are both set there — while
   * `useThree(s => s.size)` is only readable from inside it. A mounting surface already knows its
   * own container's size (it laid it out), so asking for it is honest; measuring it a second time
   * one layer down would be the same number arriving a frame later.
   *
   * ⚠ ABSENT IS THE HARNESS'S ANSWER AND STAYS THE DEFAULT. A capture page renders one island or a
   * synthetic crowd into a fixed buffer and wants the whole of it; cropping evidence to a product
   * composition would change what every comparison page in `harness/` measures.
   */
  viewport?: FramingViewport;
  /**
   * REGISTERED-UNDERLAY MODE — present ⇒ this canvas is the LAND BENEATH A HOST'S OWN
   * INTERACTIVE LAYER, and the host owns the camera.
   *
   * ⚠⚠ IT IS NOT A SECOND FRAMING RULE, IT IS THE ABSENCE OF ONE. `viewport` and the fit both
   * DECIDE where the world sits; this prop says the decision was already made upstream, by the
   * surface whose labels have to land on top of this ground to the pixel. So in this mode the
   * canvas stops steering itself entirely: no `MapControls` (the host's own pan/zoom is the only
   * gesture there is — ADR-0380 D6 fence 3, "a renderer draws; it decides nothing"), no fit, and
   * no re-framing on resize.
   *
   * ⚠ THE NUMBERS COME FROM `registrationCamera`, NEVER FROM HERE. The host solves its own
   * projection against this one and hands over the answer; this canvas applies it. Anything that
   * recomputed a zoom or a target down here would be a second opinion about where an island is,
   * and two opinions is exactly the drift the labels cannot survive.
   *
   * ⚠ AND THE BACKDROP GOES TRANSPARENT IN THIS MODE, which preserves the host's own backdrop
   * rather than replacing it. Standalone, this canvas paints `#101418` behind the world; under a
   * host, that would overpaint the map's own sea and turn a delivery change into a look change.
   */
  registered?: RegisteredUnderlay;
}

/** What a host hands over when it owns the camera — {@link registrationCamera}'s answer, plus the
 *  one composition choice a host still has. */
export interface RegisteredUnderlay {
  /** Delivered CSS px per world unit — the host's own scale, one number for the whole frame. */
  readonly zoom: number;
  /** The ground point at the centre of the frame, in this canvas's own ground coordinates. */
  readonly target: { readonly x: number; readonly z: number };
  /**
   * Draw the kit props as well as the ground. **Default false, and the default is the decision.**
   *
   * ⚠ A HOST THAT ALREADY DRAWS ITS OWN CANOPY MUST NOT GET A SECOND ONE. The studio's SVG layer
   * draws a crown per story and a flora bed per capability, and those are the marks its legend
   * describes and its status vocabulary is read from. Drawing the 3D kit underneath them yields
   * two canopies for one forest; drawing the 3D kit INSTEAD would move a status signal onto a
   * channel whose per-prop status-carrying question is explicitly still open (ADR-0530 D3). So the
   * ground mounts first and the props wait for that answer — which is ADR-0530 D6 staging, stated
   * rather than smuggled.
   */
  readonly props?: boolean;
}

/** WHAT REGISTERED MODE CHANGES — every one of the canvas's delivery decisions, as one object. */
export interface UnderlayComposition {
  /** Extra `<Canvas>` props. `frameloop: 'demand'` + a transparent drawing buffer under a host. */
  readonly canvasProps: { readonly frameloop?: 'demand'; readonly gl?: { readonly alpha: boolean } };
  /** Paint this canvas's own dark board behind the world. */
  readonly backdrop: boolean;
  /** Draw the kit props. */
  readonly props: boolean;
  /** Draw the trail strips. */
  readonly trails: boolean;
  /** Draw the cave arches. */
  readonly caves: boolean;
  /** Draw the wisp sprites. */
  readonly wisps: boolean;
  /** Mount `MapControls` — i.e. let THIS canvas own pan and zoom. */
  readonly controls: boolean;
}

/**
 * THE CANVAS'S DELIVERY DECISIONS, MADE ONCE — standalone, or as a host's underlay.
 *
 * ⚠ IT IS A FUNCTION RATHER THAN FIVE TERNARIES IN THE JSX because these are not five independent
 * switches, they are one decision with six consequences, and the JSX is the one place in this file
 * a headless test cannot reach (a `<Canvas>` needs a WebGL context). Naming it makes the whole
 * composition provable without a GPU, which is what `ForestWorldCanvas.underlay.test.ts` does.
 *
 * ⚠ `frameloop: 'demand'` IS ALSO THE REDUCED-MOTION ANSWER, and it is a real answer rather than a
 * convenient one. Nothing on this canvas animates — no `useFrame`, no clock, no asset-owned
 * timeline (ADR-0380 D6 fence 5) — so under a host it redraws only when its camera or its content
 * moved. A surface with no motion has none to reduce, and the honest implementation of that is a
 * render loop that does not run rather than a media query that turns one off. Standalone the canvas
 * keeps R3F's default loop, because `MapControls` drives its own frames there.
 *
 * ⚠ AND EVERY `false` BELOW IS A MARK THE HOST ALREADY DRAWS. Caves and wisps exist in the host's
 * own layer above (`forest-world`'s `buildScene` emits them), so drawing them here would be a
 * SECOND drawing of one mark — two wisps, two cave mouths. The props are the one entry a host may
 * ask for, and only to stage a picture.
 *
 * ⚠⚠ `trails` IS THE EXCEPTION, AND IT IS A PRODUCT-STATE RULE RATHER THAN A DEBUG PROP — which is
 * the change `pathways-keep-selection-focus-and-accessible-edge-identity` asks for. It was `false`
 * under a host for the same reason as the rest, and that was the honest answer only while the host
 * still drew its own visible paths. Under a mount the 3D layer is the one that can draw a pathway
 * ON the ground it actually runs over — routed, docked, following the relief — so the rule is:
 * **mounted ⇒ the 3D layer owns the paths**, derived from the mount itself and never passed in as a
 * boolean a caller could get wrong.
 *
 * ⚠ IT IS HALF A DECISION ON ITS OWN, AND THE OTHER HALF IS THE HOST'S. Turning this on WITHOUT the
 * host suppressing its own path strokes is the double-drawing the row exists to remove. The two are
 * landed together and tied by a test; `showTrails` stays what it always was — the STANDALONE
 * harness's opt-in — and is ignored under a host, because a host's answer is not a debug choice.
 */
export function underlayComposition(
  registered: RegisteredUnderlay | undefined,
  showTrails = false,
): UnderlayComposition {
  if (!registered) {
    return {
      canvasProps: {},
      backdrop: true,
      props: true,
      // ⚠ THE STANDALONE BRANCH IS THE ONLY PLACE `showTrails` IS READ, and it keeps its old
      // meaning exactly: trails are HIDDEN BY DEFAULT on a harness page (ADR-0169 §3) and a page
      // opts in. Threading it through here rather than gating at the call site is what makes
      // `compose.trails` the ONE gate, so a reader never has to find a second condition.
      trails: showTrails,
      caves: true,
      wisps: true,
      controls: true,
    };
  }
  return {
    canvasProps: { frameloop: 'demand', gl: { alpha: true } },
    backdrop: false,
    props: registered.props === true,
    // ⚠ NOT `registered.showTrails` AND NOT A FIELD — see the doc comment. Mounted means the 3D
    // layer owns the paths, so there is nothing for a caller to pass and nothing to get wrong.
    trails: true,
    caves: false,
    wisps: false,
    controls: false,
  };
}

/** Apply the framing to the orthographic camera — and PRESERVE THE VIEWER'S OWN ZOOM across a
 *  resize, which is the one wrinkle the projection change creates.
 *
 *  ⚠ `camera.zoom` is doing two jobs at once: it is how the island is framed on load, AND it is
 *  the property `MapControls` mutates when the viewer zooms in. Recomputing the fit on every
 *  resize would therefore silently throw the viewer's zoom away every time the window changed —
 *  taking away, by a side door, exactly the zoom the fence was careful not to touch. So the fit is
 *  applied as a RATIO against the previous fit: the first pass sets it outright, and every later
 *  one rescales whatever the viewer has since chosen by how much the fit itself moved. */
function FitOrthographicFraming({ halfHeight }: { halfHeight: number }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const appliedFit = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    const fit = orthographicZoomFor(halfHeight, Math.min(width, height));
    const previous = appliedFit.current;
    camera.zoom = previous === null || previous <= 0 ? fit : camera.zoom * (fit / previous);
    appliedFit.current = fit;
    camera.updateProjectionMatrix();
  }, [camera, halfHeight, width, height]);
  return null;
}

/**
 * APPLY THE HOST'S CAMERA — {@link FitOrthographicFraming}'s opposite number, and the whole of
 * registered-underlay mode's steering.
 *
 * ⚠ IT SETS THE CAMERA AND DERIVES NOTHING. `zoom` and `target` arrive solved from
 * `registrationCamera`; the only thing computed here is the EYE OFFSET, and that is taken from the
 * framing the standalone canvas would have used rather than written down again — so the view
 * DIRECTION (and with it the 50° elevation the registration condition is about) is provably the
 * same one this canvas has always looked from, and the clip range that framing derived still
 * brackets the world. Distance does not affect an orthographic camera's delivered scale, so
 * translating the eye with the target is free.
 *
 * ⚠ `invalidate()` RATHER THAN A RENDER LOOP. Under a host this canvas runs `frameloop="demand"`:
 * nothing on it animates, and a map that spends a GPU frame every 16 ms redrawing an identical
 * still is the shape of the lag that already cost this map a feature (the dependency
 * hover-highlight, removed July 2026). Demand-driven also IS the reduced-motion answer here — a
 * surface that only ever redraws when its camera or its content moved has no motion to reduce.
 */
function RegisteredCamera({
  zoom,
  target,
  eye,
}: {
  zoom: number;
  target: { readonly x: number; readonly z: number };
  eye: readonly [number, number, number];
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    camera.zoom = zoom;
    camera.position.set(target.x + eye[0], eye[1], target.z + eye[2]);
    camera.lookAt(target.x, 0, target.z);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, zoom, target.x, target.z, eye]);
  return null;
}

/**
 * THE MAP'S TWO LIGHTS, at the strengths a probe of this renderer says they should be.
 *
 * ⚠⚠ THE INTENSITIES ARE READ OFF THE LADDER, and they were `0.7` / `1.1` until 2026-08-30. That
 * pair was chosen when every lit object here was a flat placeholder cone or cylinder whose own
 * colour WAS the picture; for those, 1.8 of total intensity is merely bright. The bought kit is
 * the first thing on this map with a TEXTURE, and 1.8 saturates it — the first dressed frame
 * delivered pale grey needles on PINK trunks, which reads as a broken asset and is an overexposed
 * one. So a fully lit white face lands on the ladder's TOP rung and an unlit one on its FLOOR: the
 * same range the ground beside it is quantised into, by derivation rather than by eye.
 *
 * ⚠⚠ AND SINCE 2026-08-31 THE PAIR IS MEASURED RATHER THAN MERELY DERIVED. `calibrateLights`
 * renders a white, fully rough, fully lit standard face in THIS context, reads it back, and scales
 * both intensities by `target / probe` — the specular term a real `MeshStandardMaterial` carries is
 * not something the arithmetic on this side can predict. Until then the canvas ran no probe and
 * hung the authored intent, which is the smaller half of why its crowns did not match
 * `docs/research/chapter2-vocabulary-2026-08-29/island-kit-8px.png`. The larger half is the
 * transfer function itself and lives in `exact-colour.ts`.
 *
 * ⚠ IT DELIBERATELY DOES NOT RE-CONFIGURE THE RENDERER, IT ASSERTS. `calibrateLights` REFUSES a
 * renderer that is not in exact-colour mode, because `target / probe` is a one-shot solve that is
 * exact only where the delivered value is linear in intensity. @react-three/fiber's `configure`
 * pass runs before children render — `render(children)` awaits it — so by here the `<Canvas>`
 * spread has already taken. Re-applying it would paper over an ordering change instead of failing
 * on one.
 *
 * ⚠⚠ THE KEY LIGHT IS AIMED ALONG THE LAND'S OWN AUTHORED SUN, and it was not until 2026-08-30.
 * It sat at `[120, 300, 80]`, which normalises to (+0.36, +0.90, +0.24) — the OPPOSITE SIDE IN X
 * from `LIGHT_DIRECTION`'s (-0.45, +0.83, +0.35). So every lit object on this map was lit from the
 * east while the ground beside it was banded, and — once the shadow crossing landed — CAST ITS
 * SHADOWS from the west. A prop lit from one side and throwing its shadow toward the same side is
 * the incoherence that reads as "wrong" before anyone can say why, and the bought kit is what made
 * it matter: the story tree could carry it alone, a stand of trees cannot. It is DERIVED rather
 * than chosen — the same constant `banded-ground-material.ts` shades with and `land-shadow.ts`
 * casts along, so the three cannot drift apart. The distance is arbitrary (a directional light has
 * a direction, not a position) and is large enough to sit outside any world.
 */
function CalibratedLights() {
  const gl = useThree((s) => s.gl);
  // The probe renders one 8x8 frame and restores the canvas size. Memoised on the renderer, so it
  // runs once per mount rather than once per frame.
  const lit = useMemo(() => intensitiesFor(calibrateLights(gl)), [gl]);
  return (
    <>
      <ambientLight intensity={lit.ambient} />
      <directionalLight
        position={[LIGHT_DIRECTION.x * 400, LIGHT_DIRECTION.y * 400, LIGHT_DIRECTION.z * 400]}
        intensity={lit.directional}
      />
    </>
  );
}

/**
 * The minimal R3F canvas of the spike: descriptors → placeholder meshes under drei
 * `MapControls` (pan / zoom a top-down-ish world map — NOT rotate; the projection is fixed
 * 2.5D isometric per ADR-0380 D6 fence 4). Client-only
 * (`ssr:false` posture — the site lazy-loads this island after the inflection).
 */
export function ForestWorldCanvas({
  descriptors,
  showTrails = false,
  viewport,
  registered,
  regrow,
}: ForestWorldCanvasProps) {
  // The relaxed-mesh parcels — the ONE ground substrate this canvas draws. A second, classic
  // extruded-hex ground component used to be mounted unconditionally beside this one, filtered
  // off the descriptor stream by its own retired mesh family; both the component and the family
  // it drew were retired at the mapper (`retire-the-old-land-path`) — `world-to-3d.ts` now
  // REFUSES a classic-substrate scene outright rather than emitting anything of that family for
  // this canvas to draw, so there is nothing left here to mount a second ground component for.
  // One substrate, drawn unconditionally; the other is a refusal upstream, not a flag down here.
  // ⚠⚠ THE GROUND IS DERIVED FROM WHAT IT DEPENDS ON, NOT FROM THE ARRAY IT ARRIVED IN — the whole
  // of `ground-dependency.ts`, and the cure for the defect
  // `docs/research/land-view-performance-2026-09-15/` measured. These four lists (the parcels, the
  // strips whose ends dock on them, the kit's placement and everything that casts on them) used to
  // be four `useMemo`s keyed on `descriptors`'s IDENTITY, and `CellGround`'s own build — a 107 KB
  // occlusion field, a shore field, a wear field, three texture uploads and about 2 s of main
  // thread — keyed on theirs. That is correct on a surface handed a stable array and WRONG on the
  // studio, which rebuilds its scene on every clock tick and every live-activity poll: a poll that
  // changed nothing a viewer could see still handed this canvas a brand-new array and froze the
  // frame for ~1.9 s, about every thirty seconds at rest and eight times over during a load.
  //
  // ⚠ THE CACHE IS PER CANVAS INSTANCE, held in a ref rather than module scope. Two canvases on one
  // page draw two different worlds, and a shared slot would make each one's poll evict the other's
  // ground — turning a cache into a second source of the very rebuild it removes.
  //
  // The lists themselves are unchanged in CONTENT and in meaning; only when they are re-derived has
  // moved. In particular the kit's placement is still made ONCE, before the ground, pure and
  // synchronous off the frozen footprints — the SAME list reaching the casters (the ground darkens
  // under every placement, cover included since 2026-09-06) and `KitProps` (which draws exactly
  // these). A tree and its shadow are still one list, not two that agree today.
  const cacheRef = useRef<((d: readonly Descriptor3D[]) => GroundInput) | null>(null);
  cacheRef.current ??= createGroundInputCache(SHIPPED_GROUND_INPUT);
  const ground = cacheRef.current(descriptors);
  // trail-ghost-strip descriptors are deliberately not drawn (the surface's call —
  // the under-island run is told by the cave props, which render unconditionally
  // like the 2D scene's flora-layer props).
  // ⚠ `showTrails` IS THE STANDALONE HARNESS'S OPT-IN AND IS IGNORED UNDER A HOST. The gate that
  // decides whether these are DRAWN is `compose.trails` below, which is a product-state rule rather
  // than this debug prop (see {@link underlayComposition}). Collecting them unconditionally costs
  // one array filter and keeps the two concerns apart: what the stream CONTAINS, and who draws it.
  const trails = byKind(descriptors, 'trail-strip');
  const caves = byKind(descriptors, 'cave-arch');
  const wisps = byKind(descriptors, 'wisp-sprite');
  // ⚠ THE TWO FRAMINGS ARE ONE DECISION MADE ONCE, not a flag read at three call sites: `position`,
  // the `MapControls` target and the orthographic zoom all come from this one object, so a surface
  // cannot end up framed by one rule and anchored by another.
  const instances = descriptors.filter((d): d is InstanceDescriptor => d.kind !== 'skipped');
  const frame = viewport ? restingWorldFraming(instances, viewport) : frameWorld(instances);
  // ⚠ ONE DECISION, SIX CONSEQUENCES — see {@link underlayComposition}. Reading them from one
  // object is what stops a surface ending up half-registered: a canvas with the host's camera but
  // its own `MapControls`, or a transparent backdrop but a second canopy.
  const compose = underlayComposition(registered, showTrails);
  // This read is intentional: `regrow` reaches the real canvas now, while the next increment
  // applies its already-derived presentation to the ground, paths and vegetation.
  const hasRegrowPresentation = regrow !== null && regrow !== undefined;
  return (
    /* ⚠ `orthographic` is the fence (ADR-0380 D6 fence 4), and `fov` is GONE rather than merely
       unused: R3F reads the presence of `fov` as a request for a PerspectiveCamera, so leaving it
       beside `orthographic` is the one way to write this that silently keeps the old projection.

       ⚠⚠ `near`/`far` COME FROM THE FRAMING NOW, and the literal pair they replace was WRONG on any
       world larger than the harness's. This read `near: 1, far: 4000` with a comment claiming "the
       same 1/4000 range still contains the whole world" — true of one island, false of a forest.
       The eye backs off with the world's spread, so past a spread of about 850 units the ground
       itself sits behind the far plane: measured on storytree's real 35-island forest, 6227 to 8492
       units along the view direction against a far plane at 4000, and the studio's land view came
       up 99.8% background with nothing erroring and every test in this package green. See
       `clipRange` in `camera-framing.ts` for why it is twice the radius and why `near` may be
       negative. */
    <Canvas
      orthographic
      {...EXACT_COLOUR_CANVAS_PROPS}
      {...compose.canvasProps}
      data-regrow-active={hasRegrowPresentation ? 'true' : undefined}
      camera={{ position: frame.position, near: frame.near, far: frame.far }}
    >
      {/* ⚠ THE BACKDROP IS THE HOST'S IN REGISTERED MODE. Standalone this paints the dark board
          behind the world; under a host the host has already painted its own (the studio's sea
          gradient), and overpainting it would make a mount a look change. */}
      {compose.backdrop && <color attach="background" args={['#101418']} />}
      <CalibratedLights />
      <CellGround ground={ground} />
      {/* ⚠ REGISTERED MODE DRAWS THE LAND AND NOTHING THAT MEANS ANYTHING. The host's own layer
          already carries every mark that makes a claim about the work — the crowns, the flora, the
          signposts, all five wisp families, the nameplates, the trails and the hit targets — and
          ADR-0380 D6 fence 3 keeps those there. So the props are opt-in (see
          {@link RegisteredUnderlay.props}) and the trails, caves and wisp sprites are off: each
          would be a SECOND drawing of a mark the host is already responsible for. */}
      {compose.props && <KitProps placements={ground.placements} />}
      {compose.trails &&
        trails.map((t, i) => (
          <TrailStrip key={i} strip={t} />
        ))}
      {compose.caves &&
        caves.map((c, i) => (
          <CaveArch key={i} cave={c} />
        ))}
      {compose.wisps &&
        wisps.map((w, i) => (
          <WispSprite key={i} wisp={w} />
        ))}
      {registered && (
        <RegisteredCamera
          zoom={registered.zoom}
          target={registered.target}
          eye={[
            frame.position[0] - frame.target[0],
            frame.position[1] - frame.target[1],
            frame.position[2] - frame.target[2],
          ]}
        />
      )}
      {compose.controls && (
        <>
          <FitOrthographicFraming halfHeight={frame.halfHeight} />
          {/* ⚠ `enableRotate={false}` is the second half of fence 4 — an orthographic camera the
              viewer can still swing around is still a free camera, and the banded land treatment
              this arc is carrying in is authored against a FIXED light direction that would slide
              across static geometry under one. Pan (left drag) and zoom (wheel / pinch) are
              untouched.
              ⚠ AND IT IS ABSENT ENTIRELY UNDER A HOST — not merely further restricted. A host that
              owns pan and zoom must be the only thing that owns them; `MapControls` binds its own
              pointer and wheel listeners to the canvas, so leaving it mounted would give the map
              two cameras fighting over one gesture. */}
          <MapControls makeDefault target={frame.target} enableRotate={false} />
        </>
      )}
    </Canvas>
  );
}
