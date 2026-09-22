// @vitest-environment jsdom
//
// Red-green of the desktop-layout owner feedback (2026-07-13, item B — routed out of the library
// arc to the forest/app-shell surface): the forest map at #/tree is FULL-BLEED — no `pad` padding
// ring around the world — and carries NO session counter above the map (the
// "N active sessions (+M aged)" toolbar was owner-cited clutter). Self-reported session presence
// has since retired outright (ADR-0200 D7 — the claim ledger is the one coordination signal), so
// the counter now has no data source either; this stays as the regression lock that no toolbar
// counter grows back over the map. The claims-only SessionDock stays, reachable through a story
// panel's claim rows. The visual result (the map actually filling the window edge-to-edge) is the
// owner-attested look leg (ADR-0070 stage 2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The studio package root, anchored on THIS FILE rather than on `process.cwd()`. Under `pnpm test`
// the two agree (the cwd is `apps/studio`); under `check:mutation-diff` they do not — Stryker runs
// vitest from a SANDBOX copy of the repo root, so a cwd-relative `src/components/…` read hits
// ENOENT and fails the dry run before a single mutant is tried. Measured 2026-09-06: the first
// branch whose mutated studio files were witnessed by this suite could reach no verdict at all.
const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
import {
  CHAPTER2_ROUND3_TREE_CANDIDATES,
  chapter2Round3TreeCandidate,
  spriteUprightReconciliation,
  type OrganicPoseTrack,
} from '@storytree/app-surface';
import { AppDataContext, type AppData } from '../lib/appData';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';
import {
  TreeView,
  readChapter2Round3Lab,
  readOrganicIslandAccretion,
  readOrganicPoseToPose,
  readSemanticGrowthDemo,
} from './TreeView';
import { SemanticGrowthDemo } from './SemanticGrowthDemo.js';
import type { SpriteStyleSheet } from '../lib/sprite-sheet.js';

// The TRANSPORT is doubled rather than the `../api` module (anti-slop-adoption-arc inc-06,
// `no-module-mocking`) — the real client builds the URLs and parses the payloads, and the double
// fails closed, so a shell that started reaching for another route goes red instead of quietly
// receiving `undefined`.
const TREE_PAYLOAD = {
  stories: [
    {
      id: 'studio',
      title: 'Studio',
      outcome: 'the studio serves',
      status: 'healthy',
      proofMode: 'UAT',
      uatWitness: 'machine',
      dependsOn: [],
      consumedBy: [],
      capabilities: [],
    },
  ],
};

let http: HttpDouble;

beforeEach(() => {
  http = installHttpDouble();
  http.get('/api/tree', () => TREE_PAYLOAD);
  http.get('/api/activity', () => ({ builds: null, claims: null }));
});

afterEach(() => {
  cleanup();
  http.uninstall();
});

const appData: AppData = {
  docs: [],
  docIds: new Set(),
  docTitles: new Map(),
  docsStatus: 'ready',
  docsError: '',
  assets: [],
  assetsStatus: 'ready',
  assetsError: '',
  me: { email: 'owner@example.com', role: 'admin', status: 'active', member: true },
  refreshAssets: async () => {},
};

interface RenderTreeOptions {
  /**
   * Whether to assert the shell reached `GET /api/tree` through the installed transport double.
   * The RUNTIME AUDIT below installs its OWN blocking `fetch` to record every outbound request, so
   * there the tree read lands in that spy instead — the audit's own `requested` list is what proves
   * the attempt happened, and asserting on the double there would be asserting on a seam the test
   * has deliberately taken over.
   */
  readonly assertTreeRead?: boolean;
}

async function renderTree(options: RenderTreeOptions = {}): Promise<HTMLElement> {
  const { container } = render(
    <AppDataContext.Provider value={appData}>
      <TreeView focus={null} />
    </AppDataContext.Provider>,
  );
  // Flush the one-shot /api/tree load so the world has landed before asserting.
  await act(async () => {});
  if (options.assertTreeRead !== false) {
    expect(http.countTo('/api/tree')).toBeGreaterThan(0);
  }
  return container;
}

describe('TreeView shell — full-bleed map, no session counter (owner feedback 2026-07-13)', () => {
  it('asa-treeview-mounts-one-shared-world-view', () => {
    const source = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'TreeView.tsx'),
      'utf8',
    );

    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bWorldSceneView\b[\s\S]*?\}\s*from '@storytree\/app-surface'/,
    );
    // Mounted through the studio-surfaces seam (`<surfaces.WorldSceneView …>`), whose default IS
    // the imported `WorldSceneView` — the claim is still "ONE shared world view", and the seam is
    // how anti-slop-adoption-arc inc-06 lets a test substitute the renderer without rewriting the
    // module. Both spellings satisfy this; a DIFFERENT component would satisfy neither.
    expect(source).toMatch(/<(?:surfaces\.)?WorldSceneView\b/);
    // …and the seam's default really is the shared one, not something else wearing the name.
    expect(source).toMatch(/const REAL_SURFACES: StudioSurfaces = \{\s*WorldSceneView,/);
    expect(source).not.toMatch(
      /import\s*\{[\s\S]*?\bSceneView\b[\s\S]*?\}\s*from '\.\/SceneView\.js'/,
    );
  });

  it('full-bleed-map: the tree wrap carries no `pad` padding ring around the world', async () => {
    const container = await renderTree();
    const wrap = container.querySelector('.tree-wrap');
    expect(wrap).toBeTruthy();
    expect(wrap!.classList.contains('pad')).toBe(false);
  });

  it('no-session-counter: active sessions render NO toolbar counter above the map', async () => {
    const container = await renderTree();
    expect(container.querySelector('.tree-toolbar')).toBeNull();
    expect(container.textContent).not.toMatch(/active session/i);
    expect(container.textContent).not.toMatch(/aged session/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Shared CSS-choreography parsing (D/E below) — reads the shared, read-only app-surface stylesheet
// (packages/app-surface/src/semantic-growth.css) as dependency evidence, never edited from here and
// never widening this Studio gate's write scope. Ported verbatim from the equivalent audit already
// proven in packages/app-surface/src/SemanticGrowthWorldView.test.tsx (its own package-level proof),
// so Studio's INTEGRATION with that vocabulary is pinned independently at this seam too.
// ---------------------------------------------------------------------------------------------

const APP_SURFACE_SRC = resolve(STUDIO_ROOT, '..', '..', 'packages', 'app-surface', 'src');

function stripKeyframeBlocks(source: string): string {
  return source.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}\n*/g, '');
}

function splitDecls(body: string): string[] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

function endsWithSelectorSuffix(selector: string, suffix: string): boolean {
  if (selector === suffix) return true;
  if (!selector.endsWith(suffix)) return false;
  const before = selector[selector.length - suffix.length - 1];
  return before === undefined || before === ' ' || before === '>' || before === '~' || before === '+';
}

function findRules(nonKeyframeCss: string, suffix: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of nonKeyframeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorList = (m[1] ?? '').split(',').map((s) => s.trim());
    const body = m[2] ?? '';
    for (const selector of selectorList) {
      if (endsWithSelectorSuffix(selector, suffix)) out.push({ selector, body });
    }
  }
  return out;
}

const TIMING_KEYWORDS = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end']);
const FILL_KEYWORDS = new Set(['none', 'forwards', 'backwards', 'both']);
const DIRECTION_KEYWORDS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
const PLAYSTATE_KEYWORDS = new Set(['running', 'paused']);

function tokenizeShorthand(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) {
      if (cur) tokens.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

interface AnimationParts {
  name?: string;
  duration?: string;
  easing?: string;
  delay?: string;
  iteration?: string;
  fill?: string;
}

function parseAnimationShorthand(value: string): AnimationParts {
  const tokens = tokenizeShorthand(value.trim());
  const out: AnimationParts = {};
  let sawDuration = false;
  for (const tok of tokens) {
    if (/^-?\d*\.?\d+m?s$/i.test(tok)) {
      if (!sawDuration) {
        out.duration = tok;
        sawDuration = true;
      } else {
        out.delay = tok;
      }
      continue;
    }
    if (tok === 'infinite') {
      out.iteration = 'infinite';
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(tok)) {
      out.iteration = tok;
      continue;
    }
    if (TIMING_KEYWORDS.has(tok) || tok.startsWith('cubic-bezier(') || tok.startsWith('steps(')) {
      out.easing = tok;
      continue;
    }
    if (FILL_KEYWORDS.has(tok)) {
      out.fill = tok;
      continue;
    }
    if (DIRECTION_KEYWORDS.has(tok) || PLAYSTATE_KEYWORDS.has(tok)) continue;
    out.name = tok;
  }
  return out;
}

function toMs(value: string | undefined): number {
  if (value === undefined) return 0;
  const m = /^(-?\d*\.?\d+)(m?s)$/i.exec(value.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}

interface ResolvedAnimation {
  name: string;
  durationMs: number;
  easing: string | undefined;
  delayMs: number;
  iteration: number | 'infinite';
  fill: string;
}

function resolvedAnimation(nonKeyframeCss: string, suffix: string): ResolvedAnimation | null {
  const rules = findRules(nonKeyframeCss, suffix);
  if (rules.length === 0) return null;
  let shorthand: AnimationParts = {};
  const longhand: AnimationParts = {};
  for (const rule of rules) {
    for (const decl of splitDecls(rule.body)) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (prop === 'animation') shorthand = { ...shorthand, ...parseAnimationShorthand(value) };
      else if (prop === 'animation-name') longhand.name = value;
      else if (prop === 'animation-duration') longhand.duration = value;
      else if (prop === 'animation-timing-function') longhand.easing = value;
      else if (prop === 'animation-delay') longhand.delay = value;
      else if (prop === 'animation-iteration-count') longhand.iteration = value;
      else if (prop === 'animation-fill-mode') longhand.fill = value;
    }
  }
  const merged: AnimationParts = { ...shorthand, ...longhand };
  if (!merged.name) return null;
  return {
    name: merged.name,
    durationMs: toMs(merged.duration),
    easing: merged.easing,
    delayMs: toMs(merged.delay),
    iteration:
      merged.iteration === undefined ? 1 : merged.iteration === 'infinite' ? 'infinite' : Number(merged.iteration),
    fill: merged.fill ?? 'none',
  };
}

function keyframeCanonical(fullCss: string, name: string): Map<number, string> | null {
  const re = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = fullCss.match(re);
  if (!m) return null;
  const body = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const canonical = new Map<number, string>();
  for (const stop of body.matchAll(/([\w%.,\s]+?)\s*\{([^}]*)\}/g)) {
    const offsets = (stop[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .map((s) => (s === 'from' ? 0 : s === 'to' ? 100 : Number.parseFloat(s)));
    const decls = splitDecls(stop[2] ?? '')
      .map((d) => {
        const i = d.indexOf(':');
        return `${d.slice(0, i).trim()}:${d.slice(i + 1).trim()}`;
      })
      .sort();
    const declString = decls.join(';');
    for (const off of offsets) canonical.set(off, declString);
  }
  return canonical;
}

function canonicalKeyframeString(map: Map<number, string> | null): string {
  if (!map) return '';
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([off, decl]) => `${off}%{${decl}}`)
    .join('|');
}

function keyframePropertySet(map: Map<number, string> | null): Set<string> {
  const props = new Set<string>();
  if (!map) return props;
  for (const decl of map.values()) {
    for (const pair of decl.split(';')) {
      if (!pair) continue;
      const i = pair.indexOf(':');
      if (i > 0) props.add(pair.slice(0, i));
    }
  }
  return props;
}

interface FullProfile extends ResolvedAnimation {
  keyframe: Map<number, string> | null;
}

function resolvedProfile(fullCss: string, nonKeyframeCss: string, suffix: string): FullProfile | null {
  const anim = resolvedAnimation(nonKeyframeCss, suffix);
  if (!anim) return null;
  return { ...anim, keyframe: keyframeCanonical(fullCss, anim.name) };
}

// semantic-growth-studio-demo (stories/app-surface/semantic-growth-studio-demo.md): an explicit
// `?semanticGrowth=demo` query flag mounts the public `SemanticGrowthWorldView` over one static,
// representative five-frame fixture (ADR-0536 dropped the sixth, `signed-proof`, with the verdict
// bloom it was the only consumer of); absent/empty/unknown values leave the clean Studio route byte-
// for-byte unchanged. `SemanticGrowthWorldView` stamps its current frame as
// `data-semantic-growth-frame` on its host <section> and exposes a `nav[aria-label="Semantic growth
// controls"]` with Back/Next/Replay buttons (packages/app-surface/src/SemanticGrowthWorldView.tsx) —
// this regression locks TreeView's wiring to that public contract without importing it, so a red here
// can only be TreeView ignoring the flag (today's actual behaviour), never a missing symbol.
describe('semantic-growth studio demo (`?semanticGrowth=demo`) — asa: sgsd-clean-studio-never-mounts-the-demo, sgsd-flag-mounts-one-public-five-frame-player', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('the clean route (and any unknown value) never mounts the demo; only the exact flag mounts one public five-frame player, steppable via its own Next control', async () => {
    // 1) Clean Studio (no `semanticGrowth` key at all): no semantic-growth fixture, no demo controls.
    const clean = await renderTree();
    expect(clean.querySelector('[data-semantic-growth-frame]')).toBeNull();
    expect(clean.querySelector('nav[aria-label="Semantic growth controls"]')).toBeNull();
    cleanup();

    // 2) An unknown value follows the same clean path byte-for-byte — no demo mount.
    window.history.pushState({}, '', '/?semanticGrowth=off#/tree');
    const unknown = await renderTree();
    expect(unknown.querySelector('[data-semantic-growth-frame]')).toBeNull();
    expect(unknown.querySelector('nav[aria-label="Semantic growth controls"]')).toBeNull();
    cleanup();

    // 3) `?semanticGrowth=demo#/tree`: mounts exactly one public SemanticGrowthWorldView player,
    // starting on the first of its five ordered frames (`empty`).
    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const frames = flagged.querySelectorAll('[data-semantic-growth-frame]');
    expect(frames.length).toBe(1);
    expect(frames[0]?.getAttribute('data-semantic-growth-frame')).toBe('empty');

    // 4) Its Next control (the public component's own button, never a Studio-authored copy) steps
    // the visible frame forward through the fixture's real ordering (empty -> land).
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    expect(nextButton).toBeTruthy();
    await act(async () => {
      nextButton!.click();
    });
    expect(
      flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame'),
    ).toBe('land');
  });

  it('only the exact organic-pose-to-pose gate grows local registered poses over the retained real SVG island, with stable Back/Replay sockets', async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    try {
      // The historical rejected gate is no longer active.
      window.history.pushState({}, '', '/?semanticGrowth=island-growth#/tree');
      const historical = await renderTree();
      expect(historical.querySelector('[data-organic-technique]')).toBeNull();
      cleanup();

      // A near miss on the new key follows the same ordinary product route.
      window.history.pushState({}, '', '/?organicGrowth=organic-pose-to-pose-near-miss#/tree');
      const nearMiss = await renderTree();
      expect(nearMiss.querySelector('[data-organic-technique]')).toBeNull();
      cleanup();

      window.history.pushState({}, '', '/?organicGrowth=organic-pose-to-pose#/tree');
      const flagged = await renderTree();
      const section = flagged.querySelector(
        '[data-semantic-growth-frame="empty"][data-organic-technique="pose-to-pose"]',
      );
      expect(section).toBeTruthy();
      expect(
        flagged.querySelector(
          '.hex-territory[data-story-id="semantic-growth-demo"]',
        ),
      ).toBeNull();
      expect(
        flagged.querySelector('[data-story-id="semantic-growth-demo-companion"]'),
      ).toBeTruthy();
      expect(flagged.querySelector('image[data-organic-track]')).toBeNull();
      expect(flagged.querySelector('[data-depth-slot="island-growth-composite"]')).toBeNull();

      const controls = Array.from(
        flagged.querySelectorAll('nav[aria-label="Semantic growth controls"] button'),
      );
      const next = controls.find((button) => button.textContent === 'Next') as HTMLButtonElement;
      const back = controls.find((button) => button.textContent === 'Back') as HTMLButtonElement;
      const replay = controls.find((button) => button.textContent === 'Replay') as HTMLButtonElement;

      await act(async () => next.click()); // land
      expect(section?.getAttribute('data-semantic-growth-frame')).toBe('land');
      expect(flagged.querySelector('.relaxed-tile')).toBeTruthy();
      expect(
        flagged.querySelector(
          '[data-native-island-story="semantic-growth-demo"][data-native-island-progress="1.0000"]',
        ),
      ).toBeTruthy();
      expect(flagged.querySelector('image[data-organic-track]')).toBeNull();

      await act(async () => next.click()); // proposed
      const tree = flagged.querySelector(
        'image[data-organic-track="chapter2-hero-tree-pose-track-v1"]',
      );
      expect(tree).toBeTruthy();
      expect(tree?.getAttribute('href')).toMatch(/tree\/frame-01\.png/);
      expect(tree?.getAttribute('href')).not.toMatch(/contact-sheet|pixellab\.ai/i);
      expect(flagged.querySelector('.relaxed-tile')).toBeTruthy();
      const rootAnchor = [
        tree?.getAttribute('data-world-anchor-x'),
        tree?.getAttribute('data-world-anchor-y'),
      ];

      await act(async () => next.click()); // claimed
      const plant = flagged.querySelector(
        'image[data-organic-track="chapter2-plant-sample-pose-track-v1"]',
      );
      expect(plant).toBeTruthy();
      expect(plant?.getAttribute('href')).toMatch(/plant\/frame-00\.png/);

      await act(async () => next.click()); // healthy
      expect(
        flagged.querySelector(
          'image[data-organic-track="chapter2-hero-tree-pose-track-v1"][data-organic-frame="8"]',
        ),
      ).toBeTruthy();
      expect(
        flagged.querySelector(
          'image[data-organic-track="chapter2-plant-sample-pose-track-v1"][data-organic-frame="4"]',
        ),
      ).toBeTruthy();
      expect(flagged.querySelector('.relaxed-tile')).toBeTruthy();

      await act(async () => back.click());
      const backedTree = flagged.querySelector(
        'image[data-organic-track="chapter2-hero-tree-pose-track-v1"]',
      );
      expect([
        backedTree?.getAttribute('data-world-anchor-x'),
        backedTree?.getAttribute('data-world-anchor-y'),
      ]).toEqual(rootAnchor);

      await act(async () => replay.click());
      expect(section?.getAttribute('data-semantic-growth-frame')).toBe('empty');
      expect(flagged.querySelector('image[data-organic-track]')).toBeNull();
      expect(
        flagged.querySelector('[data-story-id="semantic-growth-demo-companion"]'),
      ).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('only the exact organic-island-accretion gate reuses the canonical 52-cell pose fixture as a connected adjacency wave and teaches its four visual terms without changing any existing gate', async () => {
    expect(readOrganicIslandAccretion('')).toBe(false);
    expect(readOrganicIslandAccretion('?organicGrowth=unknown')).toBe(false);
    expect(readOrganicIslandAccretion('?organicGrowth=organic-island-accretion-near-miss')).toBe(false);
    expect(readOrganicIslandAccretion('?organicGrowth=organic-island-accretion')).toBe(true);
    expect(readSemanticGrowthDemo('?semanticGrowth=demo')).toBe(true);
    expect(readOrganicIslandAccretion('?semanticGrowth=demo')).toBe(false);
    expect(readOrganicPoseToPose('?organicGrowth=organic-pose-to-pose')).toBe(true);
    expect(readOrganicIslandAccretion('?organicGrowth=organic-pose-to-pose')).toBe(false);

    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    try {
      window.history.pushState({}, '', '/?organicGrowth=organic-island-accretion#/tree');
      const flagged = await renderTree();
      const section = flagged.querySelector(
        '[data-organic-technique="pose-to-pose"][data-island-technique="connected-accretion"]',
      );
      expect(section).toBeTruthy();
      // 50 -> 52 on 2026-09-06 (ADR-0521): the fixture's two islands are seeded by the ratio-derived
      // spacing now, so the second island's seed moved and its territory grew a different tile set.
      // 52 -> 26 later the same day (ADR-0528): the tile follows the land ratio — ONE hex per
      // capability, the `+ 2` quota retired — so the fixture's island is drawn on fewer hexes and
      // the relaxed mesh decomposes into half the cells. What is NOT allowed to move is asserted
      // alongside — one connected adjacency wave per ring.
      // 26 -> 24 on 2026-09-22 (ADR-0593 D1, LAND_CAMERA_ELEVATION_DEG 20 -> 50): the packer's hex
      // ownership (`packages/forest-layout/src/pack.ts`) resolves ties in SCREEN space via
      // `pixelToHex`/`hexCenter`, both parameterised on the land's camera — moving the elevation
      // reflows which hexes this fixture's parcel is actually assigned, independent of anything a
      // camera/lab-scoping change could fix from this file's side. Re-measured against the current
      // build rather than re-derived; the packer, not this assertion, owns the number.
      expect(section?.getAttribute('data-svg-island-accretion-cells')).toBe('24');
      expect(section?.getAttribute('data-svg-island-accretion-duration-ms')).toBe('1600');
      // 50 cells over 8 connected waves. The counts have moved twice before — from 52 /
      // `1,4,8,13,13,9,4` when `islands-sit-too-far-apart-and-the-resting-zoom-is-too-far-out`
      // halved RANK_GAP/ISLAND_GAP/RANK_SWING and this fixture's two-story world seeded at a
      // different row/column offset, and then to `1,4,7,9,10,8,5,4,2`.
      //
      // THIS move has a different cause and it closes the one the note above was describing. The
      // relaxed mesh no longer interns vertices at 0.1 px in SCREEN space
      // (`substrate-interning-moves-to-ground-space`): it is built on the ground and projected once,
      // so its jitter is seeded off ground coordinates and the interior vertices sit where the
      // pre-camera mesh put them. Adjacency follows the vertices, so the wave partition follows too.
      // What is NOT allowed to move is asserted separately above and still holds — 50 cells, one
      // connected adjacency wave per ring. The wave shape is still a rise and a taper, now peaking
      // later (1,4,6,6,8,11 then 10,4). The shift is caught here loudly rather than silently, which
      // is what this assertion is for.
      //
      // And once more on 2026-09-06 (ADR-0521): the ratio-derived spacing re-seeded the fixture's
      // second island, its territory grew a different tile set (50 -> 52 cells, asserted above), and
      // the adjacency partition followed the tiles — `1,4,7,11,13,10,6` at the shipped rung 0 (it read
      // `1,4,5,6,8,9,8,8,3` at rung 0.1 while the pick was being laddered: the partition is a function
      // of where the seed lands), still one connected wave per ring, still a rise and a taper. Caught
      // here loudly, as this assertion is for.
      //
      // And once more on 2026-09-06 (ADR-0528): the tile follows the land ratio — one hex per
      // capability, radius ≈ 11.06 — so the fixture's island is drawn on half the cells (52 -> 26,
      // asserted above) and the adjacency partition is a shorter rise and taper over the same
      // connected waves: `1,4,5,4,3,4,3,2` at gap ratio 0 while the pick was being re-laddered, and
      // `1,4,6,3,3,4,3,2` at the shipped 0.1 (ADR-0528 D5) — the partition is a function of where the
      // seed lands, and the pick moved the fixture's second island's seed. Caught here loudly, as
      // this assertion is for.
      //
      // And once more on 2026-09-22 (ADR-0593 D1): the cell count moved again (26 -> 24, asserted
      // above) because the packer's screen-space hex ownership is itself a function of the land
      // camera, so the wave partition over those 24 cells followed — `1,4,6,4,3,4,2`.
      //
      // ⚠ And once more on 2026-09-23, with a cause that RETIRES the sentence above rather than
      // extending it: `the-packer-decides-in-ground-space-not-through-the-camera` established that
      // hex ownership being "a function of the land camera" was a DEFECT, not a property. The
      // packer places each seed in GROUND units and was snapping it to the lattice through
      // `pixelToHex`, a screen-space function, so the camera decided which tiles a story grew onto
      // — which ADR-0527 D1 and ADR-0546 D1 both forbid. The snap is now taken at plan view, the
      // fixture's island sits on the tiles the spacing math asked for, and the adjacency partition
      // follows the tiles as it always has: `1,4,5,3,2,3,4,2`. The CELL COUNT is unchanged at 24
      // (asserted above) and the waves still sum to it, still one connected wave per ring, still a
      // rise and a taper. Re-measured against the current build, not re-derived; caught here
      // loudly, as this assertion is for.
      expect(section?.getAttribute('data-svg-island-accretion-waves')).toBe('1,4,5,3,2,3,4,2');
      const legend = flagged.querySelector('[data-island-accretion-legend="true"]');
      expect(legend).toBeTruthy();
      for (const term of [
        'connected accretion',
        'adjacency wave',
        'local geometric reveal',
        'coastline settlement',
      ]) {
        expect(legend?.textContent).toContain(term);
      }
      expect(legend?.compareDocumentPosition(section!)).toBe(
        Node.DOCUMENT_POSITION_PRECEDING,
      );

      const next = Array.from(
        flagged.querySelectorAll('nav[aria-label="Semantic growth controls"] button'),
      ).find((button) => button.textContent === 'Next') as HTMLButtonElement;
      const back = Array.from(
        flagged.querySelectorAll('nav[aria-label="Semantic growth controls"] button'),
      ).find((button) => button.textContent === 'Back') as HTMLButtonElement;
      const replay = Array.from(
        flagged.querySelectorAll('nav[aria-label="Semantic growth controls"] button'),
      ).find((button) => button.textContent === 'Replay') as HTMLButtonElement;
      await act(async () => next.click());
      expect(section?.getAttribute('data-semantic-growth-frame')).toBe('land');
      expect(section?.getAttribute('data-svg-island-accretion-progress')).toBe('1.0000');
      expect(flagged.querySelector('.relaxed-tile')).toBeTruthy();
      expect(flagged.querySelector('.coast-fill-group')).toBeTruthy();
      expect(flagged.querySelector('[data-island-accretion-cell]')).toBeNull();
      expect(flagged.querySelector('[data-island-accretion-coast]')).toBeNull();
      expect(flagged.querySelector('clipPath[id^="svg-island-accretion-"]')).toBeNull();
      expect(
        flagged.querySelector(
          'image[data-organic-track="chapter2-hero-tree-pose-track-v1"]',
        ),
      ).toBeNull();

      await act(async () => back.click());
      const backed = [
        section?.getAttribute('data-semantic-growth-frame'),
        section?.getAttribute('data-svg-island-accretion-progress'),
        flagged.querySelector('.relaxed-tile')?.outerHTML ?? null,
      ];
      await act(async () => next.click());
      await act(async () => replay.click());
      expect([
        section?.getAttribute('data-semantic-growth-frame'),
        section?.getAttribute('data-svg-island-accretion-progress'),
        flagged.querySelector('.relaxed-tile')?.outerHTML ?? null,
      ]).toEqual(backed);
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  // sgsd-fixture-is-static-and-semantically-honest (stories/app-surface/semantic-growth-studio-demo.md
  // machine contract 3): "no pre-final frame may appear healthy; healthy appears only last."
  //
  // REWRITTEN, NOT DELETED (ADR-0536 D5). This case used to name the `signed-proof` frame
  // specifically — the fifth of six, whose whole point was that it carried a signed verdict's bloom
  // while its story was STILL marked proposed. ADR-0529 retired the bloom, ADR-0536 dropped the
  // frame, and the surviving requirement is the general one that frame was the sharpest instance
  // of: NO frame before the last may render `st-healthy`. Asserting it over EVERY pre-final frame
  // rather than the one is strictly stronger, and it is what a careless deletion would have lost —
  // walking only to `claimed` and checking that one frame would leave `land` and `proposed`
  // unchecked.
  it('no pre-final frame appears healthy; healthy appears only last', async () => {
    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    expect(nextButton).toBeTruthy();

    const frameKey = (): string | null =>
      flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame') ?? null;

    // The PRIMARY story's own territory, selected by id: the fixture also carries a fixed
    // COMPANION witness territory that is `healthy` on every frame by design, so an unscoped
    // `.hex-territory` would read the companion's hue on `empty`/`land` (where the primary has no
    // territory at all) and call the walk dishonest.
    const primaryTerritory = (): Element | null =>
      flagged.querySelector('.hex-territory[data-story-id="semantic-growth-demo"]');

    // empty -> land -> proposed -> claimed: every frame before the last, checked as we pass it.
    for (const key of ['empty', 'land', 'proposed', 'claimed'] as const) {
      if (key !== 'empty') {
        await act(async () => {
          nextButton!.click();
        });
      }
      expect(frameKey()).toBe(key);
      const territory = primaryTerritory();
      // `empty`/`land` have no primary identity yet; `proposed`/`claimed` must have one, and it
      // must not be healthy.
      if (key === 'empty' || key === 'land') {
        expect(territory, `${key} must carry no primary territory yet`).toBeNull();
      } else {
        expect(territory, `${key} must carry the primary territory`).toBeTruthy();
        expect(territory!.classList.contains('st-healthy'), `${key} must not appear healthy`).toBe(false);
      }
    }

    // The fifth and FINAL Next reaches `healthy` — the only frame allowed to appear healthy.
    await act(async () => {
      nextButton!.click();
    });
    expect(
      flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame'),
    ).toBe('healthy');
    const healthyTerritory = primaryTerritory();
    expect(healthyTerritory).toBeTruthy();
    expect(healthyTerritory!.classList.contains('st-healthy')).toBe(true);
  });

  // sgsd-fixture-is-static-and-semantically-honest (stories/app-surface/semantic-growth-studio-demo.md
  // machine contract 3): "land has no story marker" — the second frame is claimed ground with no
  // story yet (the guidance's exact sequence is "empty, then land with no story marker, then a pale
  // proposed/non-healthy story…"). A story identity only enters the walk at the THIRD frame
  // (`proposed`); `land` itself must render no nameplate/tree identity for the fixture's story id.
  it('sgsd-land-has-no-story-marker: the second (`land`) frame is claimed ground with no nameplate/tree story identity', async () => {
    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    expect(nextButton).toBeTruthy();

    await act(async () => {
      nextButton!.click();
    });
    expect(
      flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame'),
    ).toBe('land');

    // No nameplate (`.world-plate`, the story id/status card) may render on the `land` frame — a
    // story marker only belongs from `proposed` onward.
    expect(flagged.querySelector('.world-plate')).toBeNull();
  });

  // sgsd-bounded-in-map-host (stories/app-surface/semantic-growth-studio-demo.md): "it may size
  // within the available forest frame but may not expand the page, clip/cover its navigation or
  // place Back/Next/Replay behind the SVG." The live map's `.world-frame` is only given its
  // fill-the-frame sizing (`.tree-layout > .world-frame { flex: 1 1 auto; min-height: 0; … }`,
  // index.css) when it sits INSIDE `.tree-layout` — a bare `.tree-wrap > .world-frame` (no
  // `.tree-layout` between them) never matches that selector and the frame collapses to its
  // unconstrained intrinsic (zero) height instead of bounding to the forest frame. The demo's host
  // must reuse the SAME wrapping chain, not a shortened one.
  it('sgsd-bounded-in-map-host: the demo host wraps `.world-frame` inside `.tree-layout`, the same chain the live map relies on to bound the frame instead of collapsing it', async () => {
    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    expect(flagged.querySelector('.tree-layout > .world-frame')).toBeTruthy();
  });

  // sgsd-composed-through-real-studio-world-pipeline (stories/app-surface/semantic-growth-studio-demo.md):
  // the fixture must be COMPOSED through the SAME real Studio pipeline the live map uses —
  // deterministic representative story/capability data enters `buildWorld`, its real draw tiles
  // enter `buildRelaxedCells`, and `worldToScene` (carrying the same permanent vegetation input)
  // feeds `buildScene` — never a demo-only hand-authored `SceneInput`, coast path, or hand-filled
  // empty `relaxedCells`/`drawTiles`/`decor`/`plants`. This is the ONE fail-closed composition red
  // the node spec asks for: source imports/calls, source literals, AND rendered output are checked
  // TOGETHER — a parcel-only rendered check alone is not sufficient proof of real composition.
  it('sgsd-composed-through-real-studio-world-pipeline: the fixture is folded through buildWorld -> buildRelaxedCells -> worldToScene -> buildScene, never a demo-only hand-authored SceneInput/COAST/empty geometry', async () => {
    const source = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'SemanticGrowthDemo.tsx'),
      'utf8',
    );

    // 1) The real composition boundary is actually IMPORTED from the studio's own pipeline (never a
    // demo-only re-derivation of it).
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bbuildWorld\b[\s\S]*?\}\s*from '\.\/TreeView\.js'/,
    );
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bbuildRelaxedCells\b[\s\S]*?\}\s*from '\.\/TreeView\.js'/,
    );
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bworldToScene\b[\s\S]*?\}\s*from '\.\/TreeView\.js'/,
    );
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bbuildScene\b[\s\S]*?\}\s*from '@storytree\/forest-world'/,
    );

    // 2) ...and actually CALLED — an unused import would still leave a demo-only geometry builder
    // in place.
    expect(source).toMatch(/\bbuildWorld\s*\(/);
    expect(source).toMatch(/\bbuildRelaxedCells\s*\(/);
    expect(source).toMatch(/\bworldToScene\s*\(/);
    expect(source).toMatch(/\bbuildScene\s*\(/);

    // 3) No demo-only hand-authored `SceneInput`, coast path, or hand-filled EMPTY geometry arrays
    // — exactly the demo-only geometry builder this node forbids maintaining.
    expect(source).not.toMatch(/\)\s*:\s*SceneInput\b/);
    expect(source).not.toMatch(/\bCOAST\s*=\s*\[/);
    expect(source).not.toMatch(/relaxedCells\s*:\s*\[\]/);
    expect(source).not.toMatch(/drawTiles\s*:\s*\[\]/);
    expect(source).not.toMatch(/decor\s*:\s*\[\]/);
    expect(source).not.toMatch(/plants\s*:\s*\[\]/);

    // 4) The RENDERED `proposed` frame reuses the real composed geometry — non-empty relaxed
    // substrate, MULTIPLE capability parcels, and parcel flora (the real permanent vegetation this
    // world composes) — never an empty demo shell.
    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Next',
    );
    expect(nextButton).toBeTruthy();
    // empty -> land -> proposed (two Next clicks).
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        nextButton!.click();
      });
    }
    const proposedFrame = flagged.querySelector('[data-semantic-growth-frame="proposed"]');
    expect(proposedFrame).toBeTruthy();

    const substrate = proposedFrame!.querySelectorAll('.relaxed-tile, .relaxed-cell');
    expect(substrate.length).toBeGreaterThan(0);

    const parcels = proposedFrame!.querySelectorAll('.parcel');
    expect(parcels.length).toBeGreaterThan(1);

    const parcelFlora = proposedFrame!.querySelectorAll('.parcel-flora');
    expect(parcelFlora.length).toBeGreaterThan(0);

    // 5) The public player receives a stable COMPOSED framing derived from this world's real
    // bounds — never the fallback/magic 100x100 viewBox a nothing-to-frame world falls back to.
    const svg = flagged.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).not.toBe('0 0 100 100');
  });

  // sgsd-primary-selection-reuses-drawn-route-lanes (semantic-growth-studio-demo): "its primary
  // selection reuses the existing drawn route lanes while the clean Studio route remains
  // unchanged." Once the primary story's own identity narrates (`proposed` onward), the fixture
  // must derive that frame's one-hop selection with the SAME real helpers the live map uses —
  // `neighbourHighlightPlan` + `laneLayout` (both from `@storytree/app-surface`) over the world's
  // real trail network — and hand the result through as `WorldPresentationModel.neighbours` /
  // `.lanes` / `.laneMotion`, never a demo-local path, segment renderer, or CSS animation. That
  // real route must therefore reach the shared `SceneView` as `litRouteLanes` and render its
  // existing `.trail-lane.is-drawing` treatment. A frame with no primary identity yet (`empty`,
  // `land`) must carry no invented lane at all.
  it('sgsd-primary-selection-reuses-drawn-route-lanes: the primary\'s real trail route reaches the shared renderer as a lit, drawing lane once its identity narrates, and no frame invents one', async () => {
    const source = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'SemanticGrowthDemo.tsx'),
      'utf8',
    );

    // 1) The real one-hop neighbour plan + lane-layout helpers are actually imported from the
    // shared app-surface seam (never re-derived locally) and actually called — an unused import
    // would still leave the live route unreused.
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\bneighbourHighlightPlan\b[\s\S]*?\}\s*from '@storytree\/app-surface'/,
    );
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\blaneLayout\b[\s\S]*?\}\s*from '@storytree\/app-surface'/,
    );
    expect(source).toMatch(/\bneighbourHighlightPlan\s*\(/);
    expect(source).toMatch(/\blaneLayout\s*\(/);
    // No demo-local lane rendering — that class name belongs to the shared renderer alone.
    expect(source).not.toMatch(/trail-lane/);

    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Next',
    );
    expect(nextButton).toBeTruthy();

    // `empty`: no primary identity at all -> no invented lane.
    expect(flagged.querySelector('.trail-lane')).toBeNull();

    // `land`: real claimed ground, still no primary identity -> still no invented lane.
    await act(async () => {
      nextButton!.click();
    });
    expect(
      flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame'),
    ).toBe('land');
    expect(flagged.querySelector('.trail-lane')).toBeNull();

    // `proposed` onward: the primary's identity narrates, and its real drawn route reaches the
    // shared renderer as a lit, one-shot-drawing lane — sourced from the real trail network, never
    // invented, never a static ink lane.
    for (const key of ['proposed', 'claimed', 'healthy']) {
      await act(async () => {
        nextButton!.click();
      });
      expect(
        flagged.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame'),
      ).toBe(key);
      const litLane = flagged.querySelector('.trail-lane.is-drawing');
      expect(litLane, `lit drawing lane missing @ ${key}`).toBeTruthy();
    }
  });

  // The ADR-0169 ARRIVAL DRAW-ON, wired into the witness for the first time. Distinct from the
  // lit SELECTION lane above: that lane is the one-hop highlight, this is the BASE trail growing
  // outward from the arriving island along its real `depends_on` edge.
  //
  // The load-bearing half is that the mask ELEMENTS exist in this DOM. `SceneView` only ever
  // REFERENCES `mask="url(#trail-m-<id>)"`, and SVG renders an unresolved mask reference
  // UNMASKED — so a fixture that set `reveal` without the player emitting a matching `<defs>`
  // would leave the trail fully drawn from the first paint, with dead wiring behind it and
  // nothing to show for it. Hence: every reference must RESOLVE, not merely be present.
  it('the primary\'s arrival draws its real trail on, exactly once, from the arriving island', async () => {
    const source = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'SemanticGrowthDemo.tsx'),
      'utf8',
    );

    // The shared, unit-tested selector — imported from the app-surface seam and actually called
    // over the composed world's REAL trail network, never a demo-local plan or invented segment.
    expect(source).toMatch(
      /import\s*\{[\s\S]*?\barrivalGrowPlan\b[\s\S]*?\}\s*from '@storytree\/app-surface'/,
    );
    expect(source).toMatch(/\barrivalGrowPlan\s*\(\s*baseWorld\.trails\s*,/);
    // No demo-local mask, stagger constant or growth animation — all of that belongs to the
    // shared player and the shared stylesheet.
    expect(source).not.toMatch(/trail-m-|trail-reveal-mask|REVEAL_STAGGER_MS/);

    window.history.pushState({}, '', '/?semanticGrowth=demo#/tree');
    const flagged = await renderTree();
    const nav = flagged.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(nav).toBeTruthy();
    const nextButton = Array.from(nav!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Next',
    );
    expect(nextButton).toBeTruthy();

    const frameKey = (): string | null | undefined =>
      flagged
        .querySelector('[data-semantic-growth-frame]')
        ?.getAttribute('data-semantic-growth-frame');
    const growthMasks = (): Element[] =>
      Array.from(flagged.querySelectorAll('mask[id^="trail-m-"]'));
    const unresolvedMaskRefs = (): string[] =>
      Array.from(flagged.querySelectorAll('[mask]'))
        .map((el) => el.getAttribute('mask') ?? '')
        .filter((ref) => {
          const id = /^url\(#(.+)\)$/.exec(ref)?.[1] ?? '';
          return id === '' || flagged.querySelector(`[id="${id}"]`) === null;
        });

    // `empty` / `land`: no primary identity yet, so nothing is arriving and nothing draws on.
    expect(frameKey()).toBe('empty');
    expect(growthMasks()).toHaveLength(0);
    await act(async () => {
      nextButton!.click();
    });
    expect(frameKey()).toBe('land');
    expect(growthMasks()).toHaveLength(0);

    // `proposed` — THE ARRIVAL. The real road grows on: one mask per segment of the primary's
    // own routed edge, and every mask reference the scene attached resolves in this same DOM.
    await act(async () => {
      nextButton!.click();
    });
    expect(frameKey()).toBe('proposed');
    const arrivalMasks = growthMasks();
    expect(arrivalMasks.length).toBeGreaterThan(0);
    expect(unresolvedMaskRefs()).toEqual([]);
    expect(flagged.querySelectorAll('.trail-fill.is-growing').length).toBe(arrivalMasks.length);
    // the mask lies over the segment's own geometry (resolved off the scene, not invented).
    for (const mask of arrivalMasks) {
      const segId = (mask.getAttribute('id') ?? '').replace(/^trail-m-/, '');
      const drawn = flagged.querySelector(`path.trail-fill[data-id="${segId}"]`);
      expect(drawn, `arrival mask ${segId} has no drawn segment`).toBeTruthy();
      expect(mask.querySelector('path')?.getAttribute('d')).toBe(drawn!.getAttribute('d'));
    }

    // EXACTLY ONCE: every later frame carries no plan, so it simply paints the trail — no mask,
    // no growth class, and no dangling reference left behind.
    for (const key of ['claimed', 'healthy']) {
      await act(async () => {
        nextButton!.click();
      });
      expect(frameKey()).toBe(key);
      expect(growthMasks(), `masks lingering @ ${key}`).toHaveLength(0);
      expect(flagged.querySelectorAll('.trail-fill.is-growing')).toHaveLength(0);
      expect(flagged.querySelectorAll('[mask]')).toHaveLength(0);
    }
  });

  // H — sgsd-companion-witness-territory (semantic-growth-studio-demo): the fixture must ALSO compose
  // a second, FIXED "companion" territory through the SAME real Studio pipeline as the primary — its
  // real draw tiles enter `buildRelaxedCells` alongside the primary's, and ONLY the companion's OWNED
  // cells are ever filtered out of that real `relaxedCells` output afterward (never a hand-authored
  // geometry replacement) — exercising the renderer's existing NO-PARCEL `buildTerritoryFlora` path so
  // the companion's own real capability renders as procedural `story-tree` + capability `garden-flora`
  // (`SceneVegetationInput`'s only field is optional `heroTrees`; `VEGETATION = {}` supplies none, so
  // the tree stays procedural, never a garden hero). The companion is BYTE-STABLE witness context
  // across all five frames — it never narrates the health walk and never carries a claim or any
  // proof mark — while the PRIMARY story (and only the primary) carries the five-state narrative:
  // no ground/identity at `empty`, real ground with no identity at `land`, the pale non-healthy
  // identity from `proposed`, presence-without-proof at `claimed`, and healthy only last. (A sixth
  // state stood between the last two — a still-`proposed` story wearing the verdict bloom; ADR-0529
  // retired the bloom and ADR-0536 dropped the frame.) Exactly the render/source case
  // `real-ms22cssp` omitted (adding it alone, with no D/E CSS audit, is equally invalid).
  it('sgsd-companion-witness-territory: a fixed companion territory survives every frame (real story-tree + garden-flora, never claim/proof) while only the primary narrates the five-state walk, over both Vector and a Storybook sprite sheet', async () => {
    const source = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'SemanticGrowthDemo.tsx'),
      'utf8',
    );

    // Source guardrails: `stripKind` must still exist but now be SOURCE-LOCAL / id-scoped (an extra
    // parameter beyond `(node, kind)`) — a bare 2-arg `stripKind(x, 'territory')` call would strip
    // EVERY territory it finds, including the companion's own identity group, which the DOM proof
    // below forbids. The fixture must never hand the companion a hero-tree colourway (VEGETATION
    // stays the permanent-vocabulary presence flag `{}` — supplying `heroTrees` replaces the
    // procedural tree, it does not add garden flora), and the companion's owned relaxed cells must be
    // FILTERED from the real `buildRelaxedCells` output (an owner-keyed removal), never hand-filled.
    const stripKindSig = /function\s+stripKind\s*\(([^)]*)\)/.exec(source);
    expect(stripKindSig, 'the stripKind helper must still exist').toBeTruthy();
    const stripKindParamCount = (stripKindSig?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
    expect(stripKindParamCount, 'stripKind must be scoped by more than (node, kind)').toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/stripKind\(\s*[^,()]+,\s*'territory'\s*\)/);
    expect(source).not.toMatch(/heroTrees\s*:/);
    expect(source).toMatch(/\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*[^;]*?\.owner\b/);

    type TerritorySnap = { id: string; status: string | null };
    const territoriesIn = (container: HTMLElement): TerritorySnap[] =>
      Array.from(container.querySelectorAll('.hex-territory[data-story-id]')).map((el) => ({
        id: el.getAttribute('data-story-id') ?? '',
        status: [...el.classList].find((c) => c.startsWith('st-')) ?? null,
      }));
    const frameKeyOf = (container: HTMLElement): string | null =>
      container.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-semantic-growth-frame') ?? null;
    const navOf = (container: HTMLElement) => {
      const nav = container.querySelector('nav[aria-label="Semantic growth controls"]');
      expect(nav).toBeTruthy();
      const byText = (t: string): HTMLElement => {
        const btn = Array.from(nav!.querySelectorAll('button')).find((b) => b.textContent === t);
        expect(btn, `"${t}" control missing`).toBeTruthy();
        return btn as HTMLElement;
      };
      return { next: byText('Next'), back: byText('Back'), replay: byText('Replay') };
    };

    async function walk(container: HTMLElement, identity: { tree: string; flora: string }): Promise<void> {
      const { next, back, replay } = navOf(container);
      let companionId: string | null = null;
      let companionStatus: string | null = null;

      const assertCompanion = (label: string): void => {
        const list = territoriesIn(container);
        const companion = companionId ? list.find((t) => t.id === companionId) : list[0];
        expect(companion, `companion territory missing @ ${label}`).toBeTruthy();
        if (!companionId) {
          companionId = companion!.id;
          companionStatus = companion!.status;
        }
        expect(companion!.status, `companion status drifted @ ${label}`).toBe(companionStatus);
        const scope = container.querySelector(`.hex-territory[data-story-id="${companionId}"]`)!;
        expect(scope, `companion territory element missing @ ${label}`).toBeTruthy();
        expect(scope.querySelector(identity.tree), `companion story-tree missing @ ${label}`).toBeTruthy();
        expect(scope.querySelector(identity.flora), `companion garden-flora missing @ ${label}`).toBeTruthy();
        expect(scope.querySelector('.world-claim-wisp'), `companion must never claim @ ${label}`).toBeNull();
        // never a PROOF either: the verdict bloom used to be the mark checked here (ADR-0529/0536
        // retired it), so the surviving proof signal is the island's own `st-healthy` hue — and the
        // companion's status is separately pinned byte-stable above, which is what makes this real.
        expect(
          scope.classList.contains('st-healthy') && companionStatus !== 'st-healthy',
          `companion must never carry proof @ ${label}`,
        ).toBe(false);
      };

      expect(frameKeyOf(container)).toBe('empty');
      expect(territoriesIn(container).length).toBe(1); // no primary land/story at all yet.
      assertCompanion('empty');

      await act(async () => {
        next.click();
      });
      expect(frameKeyOf(container)).toBe('land');
      expect(territoriesIn(container).length).toBe(1); // real ground claimed — still no primary marker.
      expect(container.querySelector('.world-plate')).toBeNull();
      assertCompanion('land');

      await act(async () => {
        next.click();
      });
      expect(frameKeyOf(container)).toBe('proposed');
      let list = territoriesIn(container);
      expect(list.length).toBe(2);
      const primaryId = list.find((t) => t.id !== companionId)?.id;
      expect(primaryId, 'a second, primary territory must appear at proposed').toBeTruthy();
      expect(list.find((t) => t.id === primaryId)!.status).toBe('st-proposed');
      assertCompanion('proposed');

      await act(async () => {
        next.click();
      });
      expect(frameKeyOf(container)).toBe('claimed');
      list = territoriesIn(container);
      expect(list.find((t) => t.id === primaryId)!.status).toBe('st-proposed'); // a claim never proves.
      const primaryScopeAtClaimed = container.querySelector(`.hex-territory[data-story-id="${primaryId}"]`)!;
      expect(primaryScopeAtClaimed.querySelector('.world-claim-wisp')).toBeTruthy();
      assertCompanion('claimed');

      await act(async () => {
        next.click();
      });
      expect(frameKeyOf(container)).toBe('healthy');
      list = territoriesIn(container);
      expect(list.find((t) => t.id === primaryId)!.status).toBe('st-healthy'); // healthy only last.
      assertCompanion('healthy');

      await act(async () => {
        back.click();
      });
      expect(frameKeyOf(container)).toBe('claimed');
      assertCompanion('claimed (via Back)');

      await act(async () => {
        replay.click();
      });
      expect(frameKeyOf(container)).toBe('empty');
      expect(territoriesIn(container).length).toBe(1); // the primary vanishes again — only the companion.
      assertCompanion('empty (via Replay)');
    }

    // Explicit Vector (`spriteSheet={null}`) — the vector `.pop-motion-inner` seam.
    const vector = render(<SemanticGrowthDemo spriteSheet={null} artScale={1} />);
    await walk(vector.container, {
      tree: '.story-tree .pop-motion-inner',
      flora: '.garden-flora .pop-motion-inner',
    });
    vector.unmount();

    // A deterministic Storybook sheet covering BOTH roles — the same companion identity, this time as
    // direct sprite `<image>` hooks (never a second renderer, never Studio-authored motion).
    const storybookSheet: SpriteStyleSheet = {
      name: 'storybook-test',
      label: 'Storybook (test fixture)',
      sprites: {
        tree: { href: '/art-sheets/storybook/tree.svg', w: 40, h: 60, anchorX: 0.5, anchorY: 1 },
        flora: { href: '/art-sheets/storybook/flora.svg', w: 20, h: 20, anchorX: 0.5, anchorY: 1 },
      },
    };
    const storybook = render(<SemanticGrowthDemo spriteSheet={storybookSheet} artScale={1} />);
    await walk(storybook.container, { tree: 'image.story-tree', flora: 'image.garden-flora' });
    storybook.unmount();
  });

  // D — the complete shared-CSS resolved-profile/keyframe/property/timing/renderer/bloom audit. Reads
  // packages/app-surface/src/semantic-growth.css and packages/app-surface/src/SceneView.tsx as
  // READ-ONLY dependency evidence (never edited, never widening this gate's write scope), resolving
  // each role's CSS profile from selector hooks discovered on REAL rendered Studio output (never an
  // assumed animation name), over both the Vector seam and a Storybook sheet covering both roles.
  it('sgsd-css-resolved-choreography-audit: resolves the full cascaded animation profile (shorthand + longhand precedence, real @keyframes bodies) for every discovered Studio role hook and proves the authored bundle: a finite single bloom pulse, a non-equivalent parcel-boundary/parcel-flora pair, a translate-only plate settle, and the planted-first / boundary+100ms / parcel-flora+60ms-past-boundary / plate+180ms-past-planted stagger', async () => {
    const css = readFileSync(resolve(APP_SURFACE_SRC, 'semantic-growth.css'), 'utf8');
    const sceneView = readFileSync(resolve(APP_SURFACE_SRC, 'SceneView.tsx'), 'utf8');
    const nonKeyframeCss = stripKeyframeBlocks(css);

    const vector = render(<SemanticGrowthDemo spriteSheet={null} artScale={1} />);
    const vNav = vector.container.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(vNav).toBeTruthy();
    const vNext = Array.from(vNav!.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    expect(vNext).toBeTruthy();
    await act(async () => {
      vNext!.click();
    });
    await act(async () => {
      vNext!.click();
    }); // empty -> land -> proposed
    expect(vector.container.querySelector('.story-tree .pop-motion-inner')).toBeTruthy();
    expect(vector.container.querySelector('.garden-flora .pop-motion-inner')).toBeTruthy();
    expect(vector.container.querySelector('.world-plate .pop-motion-inner')).toBeTruthy();
    expect(vector.container.querySelector('.parcel')).toBeTruthy();
    expect(vector.container.querySelector('.parcel-flora')).toBeTruthy();
    await act(async () => {
      vNext!.click();
    }); // -> claimed (the LAST frame any role enters on, since ADR-0536 dropped `signed-proof`)
    expect(vector.container.querySelector('.world-claim-wisp')).toBeTruthy();
    vector.unmount();

    const treeProfile = resolvedProfile(css, nonKeyframeCss, '.story-tree .pop-motion-inner');
    const floraProfile = resolvedProfile(css, nonKeyframeCss, '.garden-flora .pop-motion-inner');
    const plateProfile = resolvedProfile(css, nonKeyframeCss, '.world-plate .pop-motion-inner');
    const boundaryProfile = resolvedProfile(css, nonKeyframeCss, '.parcel');
    const parcelFloraProfile = resolvedProfile(css, nonKeyframeCss, '.parcel-flora');
    const wispProfile = resolvedProfile(css, nonKeyframeCss, '.world-claim-wisp');

    const storybookSheet: SpriteStyleSheet = {
      name: 'storybook-test',
      label: 'Storybook (test fixture)',
      sprites: {
        tree: { href: '/art-sheets/storybook/tree.svg', w: 40, h: 60, anchorX: 0.5, anchorY: 1 },
        flora: { href: '/art-sheets/storybook/flora.svg', w: 20, h: 20, anchorX: 0.5, anchorY: 1 },
      },
    };
    const storybook = render(<SemanticGrowthDemo spriteSheet={storybookSheet} artScale={1} />);
    const sNav = storybook.container.querySelector('nav[aria-label="Semantic growth controls"]');
    expect(sNav).toBeTruthy();
    const sNext = Array.from(sNav!.querySelectorAll('button')).find((b) => b.textContent === 'Next');
    expect(sNext).toBeTruthy();
    await act(async () => {
      sNext!.click();
    });
    await act(async () => {
      sNext!.click();
    }); // empty -> land -> proposed
    expect(storybook.container.querySelector('image.story-tree')).toBeTruthy();
    expect(storybook.container.querySelector('image.garden-flora')).toBeTruthy();
    storybook.unmount();

    const spriteTreeProfile = resolvedProfile(css, nonKeyframeCss, 'image.story-tree');
    const spriteFloraProfile = resolvedProfile(css, nonKeyframeCss, 'image.garden-flora');

    const namedProfiles = [
      ['tree', treeProfile],
      ['flora', floraProfile],
      ['plate', plateProfile],
      ['parcel-boundary', boundaryProfile],
      ['parcel-flora', parcelFloraProfile],
      ['claim-wisp', wispProfile],
      ['sprite-tree', spriteTreeProfile],
      ['sprite-flora', spriteFloraProfile],
    ] as const;
    for (const [role, profile] of namedProfiles) {
      expect(profile, role).toBeTruthy();
    }

    // EVERY ARRIVAL PLAYS EXACTLY ONCE (finite), never forever, and settles at rest. Written as
    // "the bloom pulses exactly once" over the retired signed-proof frame's own animation; ADR-0536
    // D5 requires the criterion be rewritten rather than dropped, so it now binds every role the
    // walk still has — strictly more than it bound before, and the same defect class: a semantic
    // arrival that loops is a map that never comes to rest.
    for (const [role, profile] of namedProfiles) {
      expect(profile!.iteration, `${role} must play a finite number of times`).toBe(1);
    }

    // no orphan profile survives the retired role.
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssCode).not.toMatch(/@keyframes\s+bloom-pulse\b/);
    expect(cssCode).not.toMatch(/\.world-bloom\b/);

    // parcel boundary is a ground reveal (opacity only, never scale); parcel flora is a rooted growth
    // (scale + opacity) — a real property-SET difference, never just differing numeric endpoints.
    const boundaryProps = keyframePropertySet(boundaryProfile!.keyframe);
    expect(boundaryProps.has('scale')).toBe(false);
    const floraProps = keyframePropertySet(parcelFloraProfile!.keyframe);
    expect(floraProps.has('scale')).toBe(true);
    expect(canonicalKeyframeString(boundaryProfile!.keyframe)).not.toBe(
      canonicalKeyframeString(parcelFloraProfile!.keyframe),
    );
    expect([...boundaryProps].sort()).not.toEqual([...floraProps].sort());

    // never grouped under one shared selector list.
    const flatSelectorGroups = [...nonKeyframeCss.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    );
    const groupsBoundaryWithFlora = flatSelectorGroups.some(
      (selectors) =>
        selectors.some((s) => endsWithSelectorSuffix(s, '.parcel')) &&
        selectors.some((s) => endsWithSelectorSuffix(s, '.parcel-flora')),
    );
    expect(groupsBoundaryWithFlora).toBe(false);

    // plate settles with an individual vertical-only `translate:`, never a scale sweep.
    const plateProps = keyframePropertySet(plateProfile!.keyframe);
    expect(plateProps.has('scale')).toBe(false);
    const plateTranslateDecl = [...(plateProfile!.keyframe?.values() ?? [])].find((d) =>
      /(?:^|;)translate:/.test(d),
    );
    expect(plateTranslateDecl).toBeTruthy();
    expect(plateTranslateDecl).toMatch(/translate:\s*0(?:px)?\s+-?[\d.]+(?:px)?/);

    // resolved-delay stagger: planted first; parcel boundary >=100ms later; earliest parcel flora
    // >=60ms past boundary with per-item variation; plate >=180ms past planted.
    expect(boundaryProfile!.delayMs).toBeGreaterThanOrEqual(treeProfile!.delayMs + 100);
    expect(plateProfile!.delayMs).toBeGreaterThanOrEqual(treeProfile!.delayMs + 180);

    const perItemFloraDelays = [
      ...nonKeyframeCss.matchAll(
        /\.parcel-flora(?::nth-[\w-]+\([^)]*\)|\[[^\]]*(?:offset|stagger|delay)[^\]]*\])\s*\{([^}]*)\}/gi,
      ),
    ].map((m) => toMs(/animation-delay\s*:\s*([^;]+);/.exec(m[1] ?? '')?.[1]?.trim()));
    expect(perItemFloraDelays.length).toBeGreaterThan(0);
    expect(new Set(perItemFloraDelays).size).toBeGreaterThanOrEqual(2);
    expect(Math.min(...perItemFloraDelays)).toBeGreaterThanOrEqual(boundaryProfile!.delayMs + 60);

    // the claim's entrance stays local/non-spatial, riding alongside its real SVG orbit.
    const wispProps = keyframePropertySet(wispProfile!.keyframe);
    expect(wispProps.has('scale')).toBe(false);
    expect(sceneView).toMatch(/animateTransform/);

    // immediate, honest reduced semantics: no role hook ever carries a real (non-'none') animation
    // under `[data-motion='reduced']`.
    for (const suffix of [
      '.story-tree .pop-motion-inner',
      '.garden-flora .pop-motion-inner',
      '.world-plate .pop-motion-inner',
      '.parcel',
      '.parcel-flora',
      '.world-claim-wisp',
    ]) {
      const reducedRules = findRules(nonKeyframeCss, suffix).filter(
        (r) => /data-motion=['"]reduced['"]/.test(r.selector) && /animation(?:-name)?:\s*(?!none\b)/.test(r.body),
      );
      expect(reducedRules.length).toBe(0);
    }
  });

  // E — a separate exact-frame arrival-selector audit over the same shared, read-only CSS.
  it('sgsd-arrival-selector-audit: every full-motion arrival selector is qualified by the exact frame its role first enters — never the generic [data-semantic-growth-frame][data-motion="full"] targeting — and no arrival ever matches a later frame it must not narrate', () => {
    const css = readFileSync(resolve(APP_SURFACE_SRC, 'semantic-growth.css'), 'utf8');

    // the bare frame-key-less prefix every current arrival rule shares is red outright.
    expect(css).not.toMatch(/\[data-semantic-growth-frame\]\[data-motion=['"]full['"]\]/);

    const selectorsAnimatedBy = (animationName: string): string[] => {
      const re = new RegExp(`([^{}]+)\\{[^{}]*animation(?:-name)?:\\s*${animationName}\\b[^{}]*\\}`, 'g');
      return [...css.matchAll(re)]
        .flatMap((m) => (m[1] ?? '').split(','))
        .map((s) => s.trim());
    };
    const matchesFrame = (selector: string, key: string): boolean =>
      new RegExp(`\\[data-semantic-growth-frame=['"]${key}['"]\\]`).test(selector);

    const groundSelectors = selectorsAnimatedBy('arrive-ground');
    expect(groundSelectors.length).toBeGreaterThan(0);
    for (const selector of groundSelectors) {
      expect(matchesFrame(selector, 'land')).toBe(true);
      for (const forbidden of ['claimed', 'healthy']) {
        expect(matchesFrame(selector, forbidden)).toBe(false);
      }
    }

    const popSelectors = selectorsAnimatedBy('arrive-pop');
    expect(popSelectors.length).toBeGreaterThan(0);
    for (const selector of popSelectors) {
      expect(matchesFrame(selector, 'proposed')).toBe(true);
      for (const forbidden of ['claimed', 'healthy']) {
        expect(matchesFrame(selector, forbidden)).toBe(false);
      }
    }

    const wispSelectors = selectorsAnimatedBy('wisp-in');
    expect(wispSelectors.length).toBeGreaterThan(0);
    for (const selector of wispSelectors) {
      expect(matchesFrame(selector, 'claimed')).toBe(true);
      expect(matchesFrame(selector, 'healthy')).toBe(false);
    }

    // `claimed` is the LAST frame a role enters on. This audit used to end by pinning the bloom's
    // rule to the fifth frame `signed-proof`; ADR-0529/0536 retired both, and the complement is the
    // five-step walk's own strongest statement — no rule anywhere may be qualified by a frame past
    // `claimed`, nor by the retired key at all (ADR-0536 D5: rewrite the criterion, never drop it).
    expect(css).not.toMatch(/\[data-semantic-growth-frame=['"]signed-proof['"]\]/);
    const enteringFrameKeys = new Set(
      [...css.matchAll(/\[data-semantic-growth-frame=['"]([^'"]+)['"]\]/g)].map((m) => m[1] ?? ''),
    );
    expect([...enteringFrameKeys].sort()).toEqual(['claimed', 'land', 'proposed']);
  });
});

// ---------------------------------------------------------------------------------------------
// Chapter 2 round-3 COMPARISON LAB — `?organicGrowth=r3-lab#/tree`
//
// One query-gated mode of the REAL Studio consumer, following the variant seam the
// `organic-pose-to-pose` and `organic-island-accretion` gates already use. It presents ONE fixed
// composition — the Experiment 6 connected SVG accretion island, the ADR-0277-retained plant
// track and the newly wired arrival path-growth beat — with the HERO TREE switchable between the
// four registered candidates, so the owner gives one comparison LOOK verdict instead of opening
// four hosted tags. The appearance verdict itself is the owner's (ADR-0070 stage 2); everything
// below is the machine half.
// ---------------------------------------------------------------------------------------------

/** Every track any candidate can mount, by id — the hero trees plus the ONE shared plant. */
const R3_LAB_TRACKS: ReadonlyMap<string, OrganicPoseTrack> = new Map(
  CHAPTER2_ROUND3_TREE_CANDIDATES.flatMap((candidate) =>
    candidate.registry.tracks.map((track) => [track.id, track] as const),
  ),
);

/**
 * The bound on "the root contact did not move", in world units.
 *
 * `SceneView` formats every emitted coordinate to ONE decimal (`fmt = n.toFixed(1)`), so the
 * measurement below reads three separately-rounded quantities — the box `y`, the box `height`
 * (scaled by an anchor fraction < 1) and the socket's own `data-world-anchor-y`. Each contributes
 * at most 0.05, so 0.15 is the renderer's own quantisation, not slack: the underlying transform
 * pins the contact EXACTLY (`y + assetAnchor.y * scale * projection === worldAnchor.y`), and this
 * is simply the finest statement the rendered DOM can support.
 */
const CONTACT_TOLERANCE_PX = 0.15;

/** Where the asset's registered ground contact actually landed, measured off the rendered box. */
function measuredGroundContact(image: Element) {
  const trackId = image.getAttribute('data-organic-track') ?? '';
  const track = R3_LAB_TRACKS.get(trackId);
  if (!track) throw new Error(`Rendered an unregistered organic track "${trackId}".`);
  const box = {
    x: Number(image.getAttribute('x')),
    y: Number(image.getAttribute('y')),
    width: Number(image.getAttribute('width')),
    height: Number(image.getAttribute('height')),
  };
  return {
    x: box.x + (track.groundAnchor.x / track.canvas.width) * box.width,
    y: box.y + (track.groundAnchor.y / track.canvas.height) * box.height,
    socketX: Number(image.getAttribute('data-world-anchor-x')),
    socketY: Number(image.getAttribute('data-world-anchor-y')),
  };
}

function heroTrackOf(candidateId: string): OrganicPoseTrack {
  const candidate = CHAPTER2_ROUND3_TREE_CANDIDATES.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`Unknown round-3 candidate "${candidateId}".`);
  const track = candidate.registry.tracks.find((t) => t.id === candidate.heroTreeTrackId);
  if (!track) throw new Error(`Candidate "${candidateId}" registers no hero-tree track.`);
  return track;
}

describe('Chapter 2 round-3 comparison lab (`?organicGrowth=r3-lab`)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  /** The reduced-motion branch the existing organic gates use: playback settles on the cue, so
   *  every frame's organic selection is observable without driving a real animation clock. */
  function forceReducedMotion(): () => void {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    return () => {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    };
  }

  function controls(root: HTMLElement) {
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Semantic growth controls"] button',
      ),
    );
    const pick = (label: string): HTMLButtonElement => {
      const button = buttons.find((b) => b.textContent === label);
      if (!button) throw new Error(`The public player is missing its ${label} control.`);
      return button;
    };
    return { next: pick('Next'), back: pick('Back'), replay: pick('Replay') };
  }

  const organicImages = (root: HTMLElement): Element[] =>
    Array.from(root.querySelectorAll('image[data-organic-track]'));

  const heroImages = (root: HTMLElement): Element[] =>
    organicImages(root).filter(
      (image) => image.getAttribute('data-depth-slot') === 'hero-tree-organic',
    );

  it('only the exact `r3-lab` value mounts the lab; clean, unknown and near-miss routes fall through byte-identically and no sibling gate moves', async () => {
    // 1) The reader is an EXACT match, never a truthy/prefix gate.
    expect(readChapter2Round3Lab('')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=r3')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=r3-lab-near-miss')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=R3-LAB')).toBe(false);
    expect(readChapter2Round3Lab('?semanticGrowth=r3-lab')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=r3-lab')).toBe(true);

    // 2) The lab's value moves NO existing gate, and no existing value moves the lab.
    expect(readSemanticGrowthDemo('?organicGrowth=r3-lab')).toBe(false);
    expect(readOrganicPoseToPose('?organicGrowth=r3-lab')).toBe(false);
    expect(readOrganicIslandAccretion('?organicGrowth=r3-lab')).toBe(false);
    expect(readChapter2Round3Lab('?semanticGrowth=demo')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=organic-pose-to-pose')).toBe(false);
    expect(readChapter2Round3Lab('?organicGrowth=organic-island-accretion')).toBe(false);

    // 3) The clean route renders the ordinary product with no lab surface at all …
    window.history.pushState({}, '', '/#/tree');
    const clean = await renderTree();
    expect(clean.querySelector('[data-r3-lab]')).toBeNull();
    expect(clean.querySelector('[data-semantic-growth-frame]')).toBeNull();
    expect(clean.querySelector('nav[aria-label="Semantic growth controls"]')).toBeNull();
    const cleanHtml = clean.innerHTML;
    cleanup();

    // … and a NEAR MISS on the lab's own key produces the byte-identical clean render.
    window.history.pushState({}, '', '/?organicGrowth=r3-lab-near-miss#/tree');
    const nearMiss = await renderTree();
    expect(nearMiss.querySelector('[data-r3-lab]')).toBeNull();
    expect(nearMiss.querySelector('[data-semantic-growth-frame]')).toBeNull();
    expect(nearMiss.innerHTML).toBe(cleanHtml);
    cleanup();

    // 4) The three existing gates still mount their own witness, unchanged by the lab's arrival.
    for (const [query, expected] of [
      ['?semanticGrowth=demo', null],
      ['?organicGrowth=organic-pose-to-pose', 'pose-to-pose'],
      ['?organicGrowth=organic-island-accretion', 'pose-to-pose'],
    ] as const) {
      window.history.pushState({}, '', `/${query}#/tree`);
      const gated = await renderTree();
      expect(gated.querySelectorAll('[data-semantic-growth-frame]')).toHaveLength(1);
      expect(
        gated.querySelector('[data-semantic-growth-frame]')?.getAttribute('data-organic-technique'),
      ).toBe(expected);
      // None of them grows a lab picker …
      expect(gated.querySelector('[data-r3-lab]')).toBeNull();
      // … and none of them gains the projection field the lab introduced: the layer prop is
      // optional, so a variant that does not set it emits nothing and renders as it always did.
      expect(gated.querySelectorAll('[data-organic-projection]')).toHaveLength(0);
      cleanup();
    }
  });

  it('mounts ONE fixed composition — accretion island, shared plant track, arrival beat — with exactly one hero tree track and the labelled controls', async () => {
    const restoreMotion = forceReducedMotion();
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      const lab = await renderTree();

      // Exactly one public player, on the first of its five ordered frames.
      const sections = lab.querySelectorAll('[data-semantic-growth-frame]');
      expect(sections).toHaveLength(1);
      const section = sections[0]!;
      expect(section.getAttribute('data-semantic-growth-frame')).toBe('empty');

      // The FIXED half: the Experiment 6 connected accretion island over the pose-to-pose clock.
      expect(section.getAttribute('data-organic-technique')).toBe('pose-to-pose');
      expect(section.getAttribute('data-island-technique')).toBe('connected-accretion');
      // Same fixture/golden as the organic-island-accretion gate above — see its comment for why
      // 52 -> 50 (islands-sit-too-far-apart-and-the-resting-zoom-is-too-far-out's spacing cut),
      // then 50 -> 52 (ADR-0521, the ratio-derived spacing re-seeded the fixture's second island),
      // then 52 -> 26 (ADR-0528, one hex per capability: the island is drawn on fewer hexes), then
      // 26 -> 24 (ADR-0593 D1: the packer's screen-space hex ownership is a function of the land
      // camera too, so moving it 20 -> 50 reflowed which hexes this fixture's parcel is assigned).
      expect(section.getAttribute('data-svg-island-accretion-cells')).toBe('24');
      expect(section.getAttribute('data-svg-island-accretion-duration-ms')).toBe('1600');

      // The picker names every candidate, with the incumbent pressed by default.
      const candidateButtons = Array.from(lab.querySelectorAll('[data-r3-lab-candidate]'));
      expect(candidateButtons.map((b) => b.getAttribute('data-r3-lab-candidate'))).toEqual(
        CHAPTER2_ROUND3_TREE_CANDIDATES.map((c) => c.id),
      );
      for (const [index, button] of candidateButtons.entries()) {
        // Labelled by name, not by index — the owner has to be able to say which one won.
        expect(button.textContent).toBe(CHAPTER2_ROUND3_TREE_CANDIDATES[index]!.label);
        expect(button.getAttribute('aria-pressed')).toBe(index === 0 ? 'true' : 'false');
      }
      expect(
        lab.querySelector('[data-r3-lab-candidate-picker]')?.getAttribute('aria-label'),
      ).toBe('Hero tree candidate');

      // The projection dial: the same four stepped options, but the DEFAULT is now derived from the
      // land's declared camera rather than hand-picked (ADR-0367 D1). The mounted candidate is a
      // hand-authored 2D track, which declares no camera, so its reconciliation is 1.00 — and a
      // track authored AT the land camera reconciles to 1.00 too. Pinned against the shared
      // derivation, not against a literal, so re-declaring the camera moves the expectation with it.
      const expectedDefault = spriteUprightReconciliation(
        chapter2Round3TreeCandidate('incumbent').renderedCameraElevationDeg,
      ).toFixed(2);
      expect(expectedDefault).toBe('1.00');
      const projectionButtons = Array.from(lab.querySelectorAll('[data-r3-lab-projection]'));
      expect(projectionButtons.map((b) => b.getAttribute('data-r3-lab-projection'))).toEqual([
        '1.00',
        '0.90',
        '0.82',
        '0.72',
      ]);
      expect(
        projectionButtons
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.getAttribute('data-r3-lab-projection')),
      ).toEqual([expectedDefault]);
      expect(section.getAttribute('data-organic-projection')).toBe(expectedDefault);

      // Labelled HONESTLY — a comparison control, explicitly not a solved camera.
      const legend = lab.querySelector('[data-r3-lab-legend]');
      expect(legend?.textContent).toMatch(/comparison control, not a solved camera/i);
      expect(legend?.textContent).toMatch(/hero tree/i);
      // The budget the mounted candidate actually costs is stated, never silently blown.
      expect(lab.querySelector('[data-r3-lab-budget="incumbent"]')?.textContent).toMatch(
        /9 frames/,
      );

      // Walk to the settled frame: exactly ONE hero-tree track is mounted, over the shared plant.
      const { next } = controls(lab);
      for (let i = 0; i < 5; i += 1) await act(async () => next.click());
      expect(section.getAttribute('data-semantic-growth-frame')).toBe('healthy');
      expect(heroImages(lab)).toHaveLength(1);
      expect(organicImages(lab)).toHaveLength(2);
      expect(heroImages(lab)[0]?.getAttribute('data-organic-track')).toBe(
        heroTrackOf('incumbent').id,
      );
      expect(
        lab.querySelector('image[data-organic-track="chapter2-plant-sample-pose-track-v1"]'),
      ).toBeTruthy();
      // The real SVG island substrate is still the land — no generated island, coast or composite.
      expect(lab.querySelector('.relaxed-tile')).toBeTruthy();
      expect(lab.querySelector('[data-depth-slot="island-growth-composite"]')).toBeNull();
    } finally {
      restoreMotion();
    }
  });

  it('switching candidate swaps ONLY the hero tree — no remount, no cursor reset, no change to the plant, island or projection', async () => {
    const restoreMotion = forceReducedMotion();
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      const lab = await renderTree();
      const { next } = controls(lab);
      // Park the walk mid-way, so a reset would be unmissable.
      for (let i = 0; i < 3; i += 1) await act(async () => next.click());

      const playerNode = lab.querySelector('[data-semantic-growth-frame]')!;
      const before = {
        frame: playerNode.getAttribute('data-semantic-growth-frame'),
        poseProgress: playerNode.getAttribute('data-organic-pose-progress'),
        islandProgress: playerNode.getAttribute('data-native-island-progress'),
        accretionProgress: playerNode.getAttribute('data-svg-island-accretion-progress'),
        projection: playerNode.getAttribute('data-organic-projection'),
        plant: lab
          .querySelector('image[data-organic-track="chapter2-plant-sample-pose-track-v1"]')
          ?.outerHTML,
        substrate: lab.querySelector('.relaxed-tile')?.outerHTML,
      };
      expect(before.frame).toBe('claimed');
      expect(before.plant).toBeTruthy();

      const legendProse = new Set<string>();
      for (const candidate of CHAPTER2_ROUND3_TREE_CANDIDATES) {
        const button = lab.querySelector<HTMLButtonElement>(
          `[data-r3-lab-candidate="${candidate.id}"]`,
        )!;
        await act(async () => button.click());

        // The player node is the SAME DOM element — not re-keyed, not remounted.
        expect(lab.querySelector('[data-semantic-growth-frame]')).toBe(playerNode);
        // …and the cursor + every clock it owns are exactly where the owner left them.
        expect({
          frame: playerNode.getAttribute('data-semantic-growth-frame'),
          poseProgress: playerNode.getAttribute('data-organic-pose-progress'),
          islandProgress: playerNode.getAttribute('data-native-island-progress'),
          accretionProgress: playerNode.getAttribute('data-svg-island-accretion-progress'),
          projection: playerNode.getAttribute('data-organic-projection'),
          plant: lab
            .querySelector('image[data-organic-track="chapter2-plant-sample-pose-track-v1"]')
            ?.outerHTML,
          substrate: lab.querySelector('.relaxed-tile')?.outerHTML,
        }).toEqual(before);

        // Exactly one hero tree is mounted, and it is the selected one.
        const heroes = heroImages(lab);
        expect(heroes).toHaveLength(1);
        expect(heroes[0]?.getAttribute('data-organic-track')).toBe(candidate.heroTreeTrackId);
        expect(heroes[0]?.getAttribute('href')).toMatch(/\/tree\/frame-\d+\.png$/);
        // Only the pressed button is pressed.
        expect(
          Array.from(lab.querySelectorAll('[data-r3-lab-candidate]'))
            .filter((b) => b.getAttribute('aria-pressed') === 'true')
            .map((b) => b.getAttribute('data-r3-lab-candidate')),
        ).toEqual([candidate.id]);

        // The explanatory legend carries NO candidate-dependent text. jsdom does no layout, so
        // this is the testable half of a measured browser fact: while the per-candidate readout
        // shared that paragraph, exp-18's shorter clause dropped a wrapped line and grew the map
        // SVG 665px -> 685px. A comparison lab may not resize its own subject when you switch
        // candidates, so the varying text now lives in a separate fixed one-line row.
        legendProse.add(lab.querySelector('[data-r3-lab-legend]')?.textContent ?? '');
        expect(
          lab.querySelector('[data-r3-lab-budget]')?.getAttribute('data-r3-lab-budget'),
        ).toBe(candidate.id);
      }
      expect(legendProse.size).toBe(1);

      // Next still drives the public player from where the walk actually stands.
      await act(async () => next.click());
      expect(playerNode.getAttribute('data-semantic-growth-frame')).toBe('healthy');
    } finally {
      restoreMotion();
    }
  });

  it('the projection dial squashes only the height and NEVER moves the root contact, for every candidate and every step, and it survives Replay', async () => {
    const restoreMotion = forceReducedMotion();
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      const lab = await renderTree();
      const section = lab.querySelector('[data-semantic-growth-frame]')!;
      const { next, replay } = controls(lab);
      const walkToSettled = async (): Promise<void> => {
        for (let i = 0; i < 5; i += 1) await act(async () => next.click());
      };
      await walkToSettled();

      const steps = ['1.00', '0.90', '0.82', '0.72'] as const;
      for (const candidate of CHAPTER2_ROUND3_TREE_CANDIDATES) {
        await act(async () =>
          lab
            .querySelector<HTMLButtonElement>(`[data-r3-lab-candidate="${candidate.id}"]`)!
            .click(),
        );
        const unsquashed = new Map<string, { x: string; width: string; height: number }>();
        for (const step of steps) {
          await act(async () =>
            lab.querySelector<HTMLButtonElement>(`[data-r3-lab-projection="${step}"]`)!.click(),
          );
          expect(section.getAttribute('data-organic-projection')).toBe(step);

          const images = organicImages(lab);
          expect(images).toHaveLength(2);
          for (const image of images) {
            const trackId = image.getAttribute('data-organic-track')!;
            expect(image.getAttribute('data-organic-projection')).toBe(step);

            // THE CLAIM: the registered ground contact still sits on its world socket.
            const contact = measuredGroundContact(image);
            expect(
              Math.abs(contact.y - contact.socketY),
              `${candidate.id}/${trackId} @ ${step}: root contact moved ${(
                contact.y - contact.socketY
              ).toFixed(3)}px`,
            ).toBeLessThanOrEqual(CONTACT_TOLERANCE_PX);
            expect(Math.abs(contact.x - contact.socketX)).toBeLessThanOrEqual(
              CONTACT_TOLERANCE_PX,
            );

            const height = Number(image.getAttribute('height'));
            if (step === '1.00') {
              unsquashed.set(trackId, {
                x: image.getAttribute('x')!,
                width: image.getAttribute('width')!,
                height,
              });
              continue;
            }
            const base = unsquashed.get(trackId)!;
            // Horizontal geometry is untouched — this is a VERTICAL squash, not a rescale.
            expect(image.getAttribute('x')).toBe(base.x);
            expect(image.getAttribute('width')).toBe(base.width);
            // …and the height really did compress by the selected factor.
            expect(Math.abs(height - base.height * Number(step))).toBeLessThanOrEqual(0.1);
            expect(height).toBeLessThan(base.height);
          }
        }
      }

      // Deterministic for a given setting, and Replay does not yank the owner's comparison
      // setting back to the default mid-comparison: it resets the WALK, not the dial.
      await act(async () =>
        lab.querySelector<HTMLButtonElement>('[data-r3-lab-projection="0.72"]')!.click(),
      );
      const settled = organicImages(lab).map((image) => image.outerHTML);
      await act(async () => replay.click());
      expect(section.getAttribute('data-semantic-growth-frame')).toBe('empty');
      expect(
        lab
          .querySelector('[data-r3-lab-projection="0.72"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true');
      expect(section.getAttribute('data-organic-projection')).toBe('0.72');
      await walkToSettled();
      expect(organicImages(lab).map((image) => image.outerHTML)).toEqual(settled);
    } finally {
      restoreMotion();
    }
  });

  it('every candidate is drawn at the accepted track’s mature height, so canvas size never biases the comparison', async () => {
    const restoreMotion = forceReducedMotion();
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      const lab = await renderTree();
      const { next } = controls(lab);
      for (let i = 0; i < 5; i += 1) await act(async () => next.click());

      // exp-16 and code-blender are authored on a 128px canvas while the others are 192px, and
      // each mature footprint differs, so one shared instance scale would render the 128px
      // tracks at ~65% the apparent height. Measure what the browser would actually see: the
      // mature footprint's world height.
      const measured: number[] = [];
      for (const candidate of CHAPTER2_ROUND3_TREE_CANDIDATES) {
        await act(async () =>
          lab
            .querySelector<HTMLButtonElement>(`[data-r3-lab-candidate="${candidate.id}"]`)!
            .click(),
        );
        const hero = heroImages(lab)[0]!;
        const track = heroTrackOf(candidate.id);
        expect(hero.getAttribute('data-organic-track')).toBe(track.id);
        const renderedHeight = Number(hero.getAttribute('height'));
        // Undo the display projection so every candidate is compared on the same axis.
        const projection = Number(hero.getAttribute('data-organic-projection'));
        measured.push(
          (renderedHeight / projection) * (track.matureFootprint.height / track.canvas.height),
        );
      }
      expect(measured).toHaveLength(CHAPTER2_ROUND3_TREE_CANDIDATES.length);
      const reference = measured[0]!;
      expect(reference).toBeGreaterThan(0);
      for (const [index, height] of measured.entries()) {
        expect(
          Math.abs(height - reference),
          `${CHAPTER2_ROUND3_TREE_CANDIDATES[index]!.id} renders ${height.toFixed(
            2,
          )} world units of mature tree against the incumbent's ${reference.toFixed(2)}`,
        ).toBeLessThanOrEqual(0.2);
      }
    } finally {
      restoreMotion();
    }
  });

  it('Next/Back/Replay drive the public player and a repeated trace selects equal cue, progress, native-land state, organic frame and socket output', async () => {
    const restoreMotion = forceReducedMotion();
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      const lab = await renderTree();
      const section = lab.querySelector('[data-semantic-growth-frame]')!;
      const { next, back, replay } = controls(lab);
      // Compare a NON-default candidate too, so the trace covers a swapped registry.
      await act(async () =>
        lab.querySelector<HTMLButtonElement>('[data-r3-lab-candidate="exp-18"]')!.click(),
      );

      // ⚠ THE SCENE IS COMPARED AS CANONICAL MARKUP, NOT `outerHTML` — because `outerHTML` reports
      // React's ATTRIBUTE WRITE ORDER, which is not a property of the render. A freshly MOUNTED
      // element serialises in JSX order; the same element reached by PATCHING an existing one
      // serialises in patch order, so `<g class=… transform=…>` and `<g transform=… class=…>` are
      // the identical picture while an `outerHTML` compare calls them different. That is exactly
      // what a trace-vs-replayed-trace comparison does: the first pass mounts, the second patches.
      // It bit when the walk shortened to five frames (ADR-0536) — the patch boundaries moved and
      // the companion's `garden-flora` began serialising the other way round on `empty`/`land`: a
      // false red about attribute order, in a case that is about cue/progress/frame determinism.
      const canonicalMarkup = (root: Element | null | undefined): string | null => {
        if (!root) return null;
        const emit = (el: Element): string => {
          const attrs = [...el.attributes]
            .map((a) => `${a.name}="${a.value}"`)
            .sort()
            .join(' ');
          const children = [...el.childNodes]
            .map((n) => (n.nodeType === 1 ? emit(n as Element) : (n.textContent ?? '')))
            .join('');
          return `<${el.tagName}${attrs ? ` ${attrs}` : ''}>${children}</${el.tagName}>`;
        };
        return emit(root);
      };

      const sample = () => ({
        cue: section.getAttribute('data-semantic-growth-frame'),
        motion: section.getAttribute('data-motion'),
        progress: section.getAttribute('data-organic-pose-progress'),
        nativeLand: section.getAttribute('data-native-island-progress'),
        accretion: section.getAttribute('data-svg-island-accretion-progress'),
        organicFrames: section.getAttribute('data-organic-pose-frames'),
        sockets: organicImages(lab).map((image) => {
          const contact = measuredGroundContact(image);
          return {
            track: image.getAttribute('data-organic-track'),
            frame: image.getAttribute('data-organic-frame'),
            href: image.getAttribute('href'),
            socket: [contact.socketX, contact.socketY],
            box: [
              image.getAttribute('x'),
              image.getAttribute('y'),
              image.getAttribute('width'),
              image.getAttribute('height'),
            ],
          };
        }),
        scene: canonicalMarkup(section.querySelector('svg')),
      });

      // The trace: forward through the whole walk (four Nexts over five frames), back twice,
      // forward again.
      const trace = async (): Promise<unknown[]> => {
        const out: unknown[] = [sample()];
        for (let i = 0; i < 4; i += 1) {
          await act(async () => next.click());
          out.push(sample());
        }
        for (let i = 0; i < 2; i += 1) {
          await act(async () => back.click());
          out.push(sample());
        }
        await act(async () => next.click());
        out.push(sample());
        return out;
      };

      const first = await trace();
      // The comparison below is only worth anything if the trace SAW something: the samples must
      // cover every distinct state the walk has, with the repeated visits to the frame the trace
      // lands on (forward, then Back, then Next again) collapsing to ONE — which is the
      // determinism claim stated as a count. The walk lost a frame with ADR-0536, so both numbers
      // moved down by one; they are still the walk's own length and the trace's own sample count,
      // never free constants.
      expect(first).toHaveLength(8);
      expect(new Set(first.map((sampled) => JSON.stringify(sampled))).size).toBe(5);
      expect(
        first.filter((sampled) => (sampled as { sockets: unknown[] }).sockets.length === 2),
      ).not.toHaveLength(0);
      for (const sampled of first) {
        expect((sampled as { scene: string | null }).scene).toBeTruthy();
      }

      await act(async () => replay.click());
      expect(section.getAttribute('data-semantic-growth-frame')).toBe('empty');
      const second = await trace();
      expect(second).toEqual(first);

      // Reduced motion SETTLES on the retained final scene: last registered pose of each track,
      // the island fully accreted, and no half-played arrival reveal left behind.
      await act(async () => replay.click());
      for (let i = 0; i < 5; i += 1) await act(async () => next.click());
      expect(section.getAttribute('data-motion')).toBe('reduced');
      expect(section.getAttribute('data-organic-pose-progress')).toBe('1.0000');
      expect(section.getAttribute('data-native-island-progress')).toBe('1.0000');
      expect(section.getAttribute('data-svg-island-accretion-progress')).toBe('1.0000');
      expect(lab.querySelectorAll('mask[id^="trail-m-"]')).toHaveLength(0);
      expect(lab.querySelectorAll('.trail-fill.is-growing')).toHaveLength(0);
      for (const image of organicImages(lab)) {
        const track = R3_LAB_TRACKS.get(image.getAttribute('data-organic-track')!)!;
        expect(image.getAttribute('data-organic-frame')).toBe(String(track.frameCount - 1));
      }
      // …the same final scene the trace already reached.
      expect(sample()).toEqual(first[first.length - 4]);
    } finally {
      restoreMotion();
    }
  });

  it('carries the arrival path-growth beat: the trail draws on at the arrival frame, every mask reference resolves, and it plays exactly once', async () => {
    // Full motion (no reduced-motion override) — the beat is dropped by design under reduce.
    window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
    const lab = await renderTree();
    const section = lab.querySelector('[data-semantic-growth-frame]')!;
    const { next } = controls(lab);

    const masks = (): Element[] => Array.from(lab.querySelectorAll('mask[id^="trail-m-"]'));
    const unresolvedMaskRefs = (): string[] =>
      Array.from(lab.querySelectorAll('[mask]'))
        .map((el) => el.getAttribute('mask') ?? '')
        .filter((ref) => {
          const id = /^url\(#(.+)\)$/.exec(ref)?.[1] ?? '';
          return id === '' || lab.querySelector(`[id="${id}"]`) === null;
        });

    expect(section.getAttribute('data-semantic-growth-frame')).toBe('empty');
    expect(masks()).toHaveLength(0);
    await act(async () => next.click());
    expect(section.getAttribute('data-semantic-growth-frame')).toBe('land');
    expect(masks()).toHaveLength(0);

    // The ARRIVAL.
    await act(async () => next.click());
    expect(section.getAttribute('data-semantic-growth-frame')).toBe('proposed');
    const arrival = masks();
    expect(arrival.length).toBeGreaterThan(0);
    // A mask that does not RESOLVE renders unmasked — the trail would paint fully drawn behind
    // dead wiring, which is exactly the silent no-op this beat had to escape.
    expect(unresolvedMaskRefs()).toEqual([]);
    expect(lab.querySelectorAll('.trail-fill.is-growing')).toHaveLength(arrival.length);
    for (const mask of arrival) {
      const segId = (mask.getAttribute('id') ?? '').replace(/^trail-m-/, '');
      const drawn = lab.querySelector(`path.trail-fill[data-id="${segId}"]`);
      expect(drawn, `arrival mask ${segId} has no drawn segment`).toBeTruthy();
      expect(mask.querySelector('path')?.getAttribute('d')).toBe(drawn!.getAttribute('d'));
    }

    // The beat belongs to the fixed composition, not to a candidate: swapping the hero tree
    // neither kills it nor re-fires it.
    await act(async () =>
      lab.querySelector<HTMLButtonElement>('[data-r3-lab-candidate="exp-15"]')!.click(),
    );
    expect(masks()).toHaveLength(arrival.length);
    expect(unresolvedMaskRefs()).toEqual([]);

    // EXACTLY ONCE: later frames carry no plan, so nothing is left half-wired.
    for (const key of ['claimed', 'healthy']) {
      await act(async () => next.click());
      expect(section.getAttribute('data-semantic-growth-frame')).toBe(key);
      expect(masks(), `masks lingering @ ${key}`).toHaveLength(0);
      expect(lab.querySelectorAll('.trail-fill.is-growing')).toHaveLength(0);
      expect(lab.querySelectorAll('[mask]')).toHaveLength(0);
    }
  });

  it('no PixelLab client, hostname, credential or runtime model call reaches the consumer, and the lab has no permanent navigation entry', async () => {
    // ---- A. SOURCE audit over the files that actually compose the lab consumer. --------------
    const labSources: [string, string][] = [
      ['SemanticGrowthDemo.tsx', readFileSync(resolve(STUDIO_ROOT, 'src', 'components', 'SemanticGrowthDemo.tsx'), 'utf8')],
      ...(
        [
          'chapter2-round3-tree-candidates.ts',
          'organic-pose-to-pose-assets.ts',
          'organic-pose-to-pose-track.ts',
          'SemanticGrowthWorldView.tsx',
          'SceneView.tsx',
          'svg-island-accretion.ts',
        ] as const
      ).map((name): [string, string] => [
        name,
        readFileSync(resolve(APP_SURFACE_SRC, name), 'utf8'),
      ]),
    ];
    for (const [name, source] of labSources) {
      // No vendor endpoint of any kind — the provenance PROSE may name PixelLab (it must: that is
      // the licence record), but no reachable host may appear anywhere.
      expect(source, `${name}: vendor URL`).not.toMatch(/https?:\/\/[^\s'"`)]*pixellab/i);
      expect(source, `${name}: vendor host`).not.toMatch(/pixellab\.ai/i);
      // No network primitive at all in the lab's own consumer path.
      expect(source, `${name}: network primitive`).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\s*\(/,
      );
      expect(source, `${name}: http client`).not.toMatch(/\b(?:axios|got|undici|node-fetch)\b/);
      // No credential surface, and no environment read to smuggle one in.
      expect(source, `${name}: credential`).not.toMatch(
        /\b(?:api[_-]?key|apiKey|access[_-]?token|Bearer\s|Authorization|client[_-]?secret)\b/i,
      );
      expect(source, `${name}: env read`).not.toMatch(/process\.env|import\.meta\.env/);
    }

    // The Studio gate adds only a URL reader — no fetch, no import of a vendor module.
    const treeViewSource = readFileSync(
      resolve(STUDIO_ROOT, 'src', 'components', 'TreeView.tsx'),
      'utf8',
    );
    expect(treeViewSource).toMatch(
      /export function readChapter2Round3Lab\([\s\S]*?get\('organicGrowth'\) === 'r3-lab'/,
    );
    expect(treeViewSource).not.toMatch(/pixellab/i);

    // The player is mounted WITHOUT a remount key — the host may not smuggle a cursor reset in.
    const demoSource = labSources[0]![1];
    const mountSite = /<SemanticGrowthWorldView\b[\s\S]*?\/>/.exec(demoSource)?.[0] ?? '';
    expect(mountSite).not.toBe('');
    expect(mountSite).not.toMatch(/\bkey=/);
    // …and the host owns no frame cursor, timer or animation clock of its own. Checked over the
    // CODE only: the file's own prose says "a fixed instant, never `Date.now()`", and a rule that
    // a comment can trip is a rule about prose. Dropping whole comment lines can only remove
    // comments (a line carrying code never begins with `//`, `/*` or `*`), and the guard below
    // proves the stripper did not eat the component itself.
    const demoCode = demoSource
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join('\n');
    expect(demoCode).toContain('export function SemanticGrowthDemo');
    expect(demoCode).toContain('<SemanticGrowthWorldView');
    expect(demoCode).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|Date\.now\(\)/);

    // ---- B. DEPENDENCY audit — nothing vendor-shaped is even installable at this seam. -------
    const vendorish = /pixellab|openai|anthropic|replicate|stability|midjourney/i;
    for (const manifest of ['package.json', resolve(STUDIO_ROOT, '..', '..', 'packages', 'app-surface', 'package.json')]) {
      const pkg = JSON.parse(readFileSync(resolve(STUDIO_ROOT, manifest), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]) {
        expect(name, `${manifest} depends on ${name}`).not.toMatch(vendorish);
      }
    }

    // ---- C. NO PERMANENT NAVIGATION ENTRY — the query is the only way in. -------------------
    const studioSrc = resolve(STUDIO_ROOT, 'src');
    const mentions = (readdirSync(studioSrc, { recursive: true, encoding: 'utf8' }) as string[])
      .map((entry) => entry.replace(/\\/g, '/'))
      .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
      .filter((entry) => readFileSync(resolve(studioSrc, entry), 'utf8').includes('r3-lab'));
    expect(mentions.sort()).toEqual([
      'components/SemanticGrowthDemo.tsx',
      'components/TreeView.tsx',
      'components/TreeViewShell.test.tsx',
    ]);
    for (const [, source] of [['TreeView.tsx', treeViewSource] as const, ...labSources.slice(0, 1)]) {
      expect(source).not.toMatch(/href=[^\n]*r3-lab/);
    }

    // ---- D. RUNTIME audit — walking the whole lab issues no request off this origin. ---------
    const restoreMotion = forceReducedMotion();
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      requested.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url,
      );
      // The Studio's own art-sheet load already tolerates a rejected manifest fetch.
      throw new Error('network blocked in test');
    }) as typeof fetch;
    try {
      window.history.pushState({}, '', '/?organicGrowth=r3-lab#/tree');
      // The blocking spy above owns the transport for this test — the tree read lands in
      // `requested`, not in the double, and is audited there like every other outbound request.
      const lab = await renderTree({ assertTreeRead: false });
      const { next } = controls(lab);
      for (const candidate of CHAPTER2_ROUND3_TREE_CANDIDATES) {
        await act(async () =>
          lab
            .querySelector<HTMLButtonElement>(`[data-r3-lab-candidate="${candidate.id}"]`)!
            .click(),
        );
      }
      for (let i = 0; i < 5; i += 1) await act(async () => next.click());

      // Nothing left this origin, and nothing vendor-shaped was asked for at all.
      for (const url of requested) {
        expect(url, `requested ${url}`).not.toMatch(vendorish);
        expect(url.startsWith('/') || url.startsWith(window.location.origin)).toBe(true);
      }
      // Every mounted frame is a local checked-in module asset, never a vendor URL.
      const hrefs = organicImages(lab).map((image) => image.getAttribute('href') ?? '');
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href).not.toMatch(vendorish);
        expect(href).toMatch(/\/(?:tree|plant)\/frame-\d+\.png$/);
      }
    } finally {
      globalThis.fetch = originalFetch;
      restoreMotion();
    }
  });
});
