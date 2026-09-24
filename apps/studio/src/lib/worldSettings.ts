// worldSettings — the SINGLE SOURCE OF TRUTH for the user-facing forest-map dials
// (the gear settings panel at #/tree, owner ask 2026-06-18) and their param↔URL
// binding.
//
// Why a standalone, framework-free module:
//   • One source of truth. The TreeView readers (readLayoutMode / readArtStyle / readArtScale)
//     and the gear panel BOTH consume the defaults + clamps declared here, so a default
//     or a clamp can never drift between "what the world renders" and "what the panel
//     shows / writes".
//   • Canonical clean default URL. Writing a control AT its default REMOVES the param
//     (setControlValue), and resetControls drops every managed param — so an untouched
//     world's URL stays clean.
//   • Pure string/URL math (no React, no DOM) so the contract is unit-testable in the
//     node-env vitest suite (worldSettings.test.ts) — Stage-1 red-green of the gear.
//
// The clamps here MIRROR the TreeView readers (e.g. readArtScale). When the panel writes a value it is
// already UI-bounded; on READ the value is re-clamped to the reader's open-ended clamp, exactly as the
// URL path is.

/** A select option: the stored URL token and its human label. */
export interface SelectOption {
  /** The value the panel binds to and the URL token written for it (except the
   *  DEFAULT option, whose token is the param's absence). */
  value: string;
  label: string;
}

interface ControlBase {
  /** The URL query key (e.g. `deltaCone`). Unique across CONTROLS. */
  key: string;
  /** Human label shown in the panel. */
  label: string;
  /** Grouping section in the panel. */
  group: string;
  /** Optional one-line help (tooltip / sub-label). */
  hint?: string;
}

/** A numeric slider control. UI min/max/step bound the slider; clampMin/clampMax
 *  mirror the TreeView parser's open-ended re-clamp on read (may be looser than the
 *  slider — the parser re-clamps regardless of how the value arrived). */
export interface NumberControl extends ControlBase {
  kind: 'number';
  default: number;
  /** Slider lower bound (UI only). */
  min: number;
  /** Slider upper bound (UI only). */
  max: number;
  /** Slider step. */
  step: number;
  /** Parser clamp lower bound (mirrors readRiverTuning). */
  clampMin: number;
  /** Parser clamp upper bound; `null` = open (no upper clamp). */
  clampMax: number | null;
  /** Round to an integer on read (mirrors `Math.round` in the parser). */
  integer?: boolean;
}

/** A boolean toggle. `default` is the world's default state; turning it to the
 *  NON-default state writes `key=offToken` (default ON) or `key=onToken` (default
 *  OFF); returning to the default REMOVES the param. */
export interface ToggleControl extends ControlBase {
  kind: 'toggle';
  default: boolean;
  /** The token written when the value is OFF and OFF is non-default (default-ON
   *  toggles). */
  offToken: string;
  /** The token written when the value is ON and ON is non-default (default-OFF
   *  toggles). */
  onToken: string;
  /** Tokens that READ as OFF (mirrors the parser's off-spellings). */
  offReads: readonly string[];
}

/** A select / segmented control. The option whose value === `default` writes NO
 *  param (the byte-identical default); every other option writes `key=<value>`. */
export interface SelectControl extends ControlBase {
  kind: 'select';
  default: string;
  options: readonly SelectOption[];
  /** Map a raw URL token → a canonical option value (mirrors the parser's aliases,
   *  e.g. substrate `none`/`default`/`classic` → `hex`). Unknown → default. */
  normalize: (raw: string | null) => string;
}

export type ControlSpec = NumberControl | ToggleControl | SelectControl;

/** The value a control resolves to (kind-dependent). */
export type ControlValue = number | boolean | string;

// ---------------------------------------------------------------------------
// The schema. Defaults + clamps MIRROR TreeView's RIVER_TUNING / the readers.
// ---------------------------------------------------------------------------

// (the 'Layout' group retired with its only control — ADR-0283 D2; the 'Art style' group with the
// sprite art sheets — ADR-0608)
const GROUP_SELECTION = 'Selection';
/** ADR-0286: the Act 2 regrow's owner-facing home. Holds the speed dial below and — supplied by
 *  TreeView, not by this schema — the "Regrow the forest" ACTION, which has no URL state to bind. */
export const GROUP_INTRO = 'Forest intro';

/** selectionMotion aliases, mirroring TreeView's `readSelectionMotion`. Absence ⇒ the
 *  owner-directed `draw` default (each route draws on once and the neighbour shores pulse).
 *  `march` opts into the looping travelling dash; `off` leaves the lanes still. */
const SELECTION_MOTION_NAMES = ['draw', 'march', 'off'] as const;
export function normalizeSelectionMotion(raw: string | null): string {
  if (raw === null) return 'draw';
  if (raw === 'none' || raw === 'still' || raw === 'off') return 'off';
  return (SELECTION_MOTION_NAMES as readonly string[]).includes(raw) ? raw : 'draw';
}

// The forest-map dials (owner ask 2026-06-18). Since the river-trail road system was
// retired (ADR-0076: connections are thin perimeter-docked lines with nothing to tune),
// the road-routing knobs are GONE — and ADR-0283 D2 has since retired the Layout picker too,
// so the "Layout" gear section no longer exists. Each control's `hint` is the visible
// plain-English description shown UNDER the control.
export const CONTROLS: readonly ControlSpec[] = [
  // ---- Layout ---- RETIRED (ADR-0283 D2, owner-directed 2026-08-02)
  // DAG rows are now the ONE map layout, not the default among three. ADR-0229 had already made
  // rows the default (2026-07-23, amending ADR-0171) while keeping `stress` (the dependency-aware
  // trail-shortening placement) and `solar` (ADR-0074 §6's radial hub world) in this picker. Every
  // growth, arrival and pathway choreography then had to be defensible against all three: an
  // edge-driven regrow reads DOWN a row layout as a front, and under stress-majorization placement
  // the same schedule scatters across the plane, because that optimiser places for short trails
  // rather than for depth. The picker entry, the `?layout=` query values and the documented
  // alternatives all go; `?layout=anything` now falls through to rows like any unmanaged param.
  // Of the placement MODULES, `lib/stressLayout.ts` is left in place and tested — `stressSeeds`
  // still has a live caller in `overviewConstellation.ts` — but nothing on the map reaches it any
  // more; `lib/solarLayout.ts` had no caller left at all and is deleted.

  // ---- Ground ----
  // ADR-0233 retired the `substrate` "Ground tiling" gear select (mesh / hex / relaxed-quad /
  // relaxed-hex). The Townscaper irregular MESH is now the one and only tiling — always rendered, no
  // dial (the alternates were spike modes nothing relied on, and the "Ground" gear section retires with
  // the control). TreeView's ground reader is a fixed `'mesh'` now; the non-mesh generators in
  // forest-world's `substrate.ts` are the dead code the follow-on web-engine unit removes.

  // ADR-0088 (Shared Islands panel, amends ADR-0076 §2): the `buildingIsland` gear TOGGLE was
  // REMOVED. The building-class islands now live in a PERMANENT left "Shared Islands" panel —
  // there is no on/off to dial, so the gear no longer carries a Panels section. The distributed
  // consumer stamp is still controlled by the `?buildings=off` URL escape (read by TreeView,
  // not a gear control).

  // ---- World art (grounded-art arc) ----
  // ADR-0228 retired the default-OFF `garden` and `cosy` toggles (the cosy-island garden composition
  // and the cosy palette lift). ADR-0231 then made the unified vegetation vocabulary (ADR-0226) the
  // PERMANENT world art — no longer a gear toggle at all, so the last grounded-art switch is gone and
  // the "World art" gear section retires with it. Vegetation is always composed (TreeView's
  // `useVegetation`), so there is nothing left to dial here.

  // ---- Selection (the two-lane neighbour highlight, owner-directed 2026-07-27) ----
  // Selecting an island lights its one-hop routes as LANES in the relation's hue. This dial
  // is only about what MOVES when that happens; the lanes themselves are not optional.
  // `draw` (the default) is one-shot: each route draws on once from its source island and
  // the neighbour shores pulse, then the map is completely still — the resting state is what
  // you look at, so it stays quiet. `march` trades that for a permanent travelling dash,
  // which states direction continuously at the cost of never settling. Either way
  // `prefers-reduced-motion` lands on the finished static picture.
  {
    kind: 'select',
    key: 'selectionMotion',
    label: 'Selection motion',
    group: GROUP_SELECTION,
    hint: 'What moves when you select an island. Draw + pulse plays once and then settles; Marching dashes keep travelling the way the dependency points; Still leaves the lanes painted with nothing moving.',
    default: 'draw',
    options: [
      { value: 'draw', label: 'Draw + pulse — once (default)' },
      { value: 'march', label: 'Marching dashes — loops' },
      { value: 'off', label: 'Still' },
    ],
    normalize: normalizeSelectionMotion,
  },

  // ---- Forest intro (ADR-0286, owner-directed 2026-08-02) ----
  // The Act 2 regrow plays once per browser session, on the first arrival at the map. This dial is
  // the only thing about it the URL carries; the replay button beside it is an action, not state.
  //
  // Why the default is not 1×. `1` means the plan's OWN duration — the pace that falls out of the
  // routed pathway geometry, measured 6.8 s on the current forest since ADR-0285 removed the
  // ordering clamp that had been padding it. The owner watched that and said "its probably too
  // fast", so ADR-0286 shipped 0.6× (~12 s). They then watched THAT and took it to the floor:
  // "I think we down the speed to 0.25, the lowest setting" (2026-08-03), which is ~27 s.
  //
  // The default now sits ON `min`, deliberately. That is not a mistake to tidy up later: the owner
  // asked for the slowest the dial offers, so the dial only opens upward and the floor is a floor
  // rather than a value nobody picked. If a future look wants slower still, `min` moves — the
  // default follows it, and `clampMin` below is what actually protects the cursor.
  //
  // It scales the CLOCK only — every island still forms exactly where its pathway arrives, at the
  // same fraction of the run (ADR-0285's causal invariant is untouched at every speed).
  {
    kind: 'number',
    key: 'regrowSpeed',
    label: 'Regrow speed',
    group: GROUP_INTRO,
    hint: 'How fast the forest regrows when it plays. 1× is the pace the story graph itself implies (about 7 seconds); the 0.25× default is the slowest the dial goes, stretching it to roughly half a minute so every island’s arrival is easy to follow. Slide right to speed it up.',
    default: 0.25,
    min: 0.25,
    max: 2,
    step: 0.05,
    clampMin: 0.05,
    clampMax: 10,
  },
] as const;

const BY_KEY = new Map<string, ControlSpec>(CONTROLS.map((c) => [c.key, c]));

/** Look a control up by its URL key. */
export function controlByKey(key: string): ControlSpec | undefined {
  return BY_KEY.get(key);
}

/** Every URL key this module manages (for reset / drift checks). */
export const MANAGED_KEYS: readonly string[] = CONTROLS.map((c) => c.key);

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** Parse + clamp a control's value out of a `?…` search string, falling back to
 *  the control's default when the param is absent or unparseable. Mirrors the
 *  TreeView parser exactly so panel and world never disagree. */
export function readControlValue(search: string, c: ControlSpec): ControlValue {
  const q = new URLSearchParams(search);
  const raw = q.get(c.key);
  switch (c.kind) {
    case 'number': {
      if (raw === null) return c.default;
      const v = Number(raw);
      if (!Number.isFinite(v)) return c.default;
      return clampNumber(v, c);
    }
    case 'toggle': {
      if (raw === null) return c.default;
      return !c.offReads.includes(raw);
    }
    case 'select': {
      return c.normalize(raw);
    }
  }
}

/** Apply the parser's clamp (and optional integer rounding) to a numeric value. */
export function clampNumber(v: number, c: NumberControl): number {
  let out = Math.max(c.clampMin, v);
  if (c.clampMax !== null) out = Math.min(c.clampMax, out);
  if (c.integer) out = Math.round(out);
  return out;
}

/** Format a number for the URL: integers bare, otherwise trim trailing zeros so
 *  `7` stays `7` (not `7.0`) and a step like `0.05` reads cleanly. */
function formatNumber(v: number): string {
  // toString already drops trailing zeros and the decimal point for integers.
  return String(v);
}

/** Set a control's value into a `?…` search string and return the new search
 *  string (`''` when no params remain). Setting a control to its DEFAULT REMOVES
 *  the param, so the default world's URL stays clean / byte-identical. Unrelated
 *  params are preserved. */
export function setControlValue(search: string, c: ControlSpec, value: ControlValue): string {
  const q = new URLSearchParams(search);
  let token: string | null = null; // null ⇒ remove (value is the default)
  switch (c.kind) {
    case 'number': {
      const v = clampNumber(value as number, c);
      token = v === c.default ? null : formatNumber(v);
      break;
    }
    case 'toggle': {
      const on = value as boolean;
      if (on === c.default) token = null;
      else token = on ? c.onToken : c.offToken;
      break;
    }
    case 'select': {
      const v = c.normalize(value as string);
      token = v === c.default ? null : v;
      break;
    }
  }
  if (token === null) q.delete(c.key);
  else q.set(c.key, token);
  return stringifySearch(q);
}

/** Drop every managed param, preserving anything unmanaged. Returns `''` when no
 *  params remain. */
export function resetControls(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of MANAGED_KEYS) q.delete(k);
  return stringifySearch(q);
}

/** A `URLSearchParams` → `?a=b&c=d` (or `''` when empty), without re-encoding the
 *  human-readable tokens we use (all our keys/values are URL-safe already). */
function stringifySearch(q: URLSearchParams): string {
  const s = q.toString();
  return s.length > 0 ? `?${s}` : '';
}

/** Build a shareable URL with the params placed BEFORE the `#hash` (the project's
 *  hash-router lives in the fragment; query params must precede it to survive a
 *  reload). `origin` is the page origin+path (e.g. `https://host/`), `search` is a
 *  `?…` (or `''`) string, `hash` is the `#/tree…` fragment (or `''`). */
export function buildShareUrl(origin: string, search: string, hash: string): string {
  return `${origin}${search}${hash}`;
}

/* ADR-0608 retired the `?render=legacy` / `?render=inline` escape hatch (`readRenderScene`) with the
 * flat forest look it fell back to, and the sprite art-sheet dials (`artStyle`, `artScale`) with the
 * flat sprites they re-skinned. The shared scene-graph mapper is the map's only interaction layer. */

/* ADR-0228 retired the default-off `readCosyIsland` (`?cosy`) and `readGardenIsland` (`?garden`)
 * grounded-art flags. ADR-0231 then retired `readVegetationVocab` (`?veg=off`) too: the unified
 * vegetation vocabulary (ADR-0226) is now the PERMANENT studio world art — always composed
 * (TreeView's `VEGETATION`), never a flag. No grounded-art render toggle remains. The public
 * website fold never sent `vegetation`, so its render is unchanged (the core's absence lock holds). */
