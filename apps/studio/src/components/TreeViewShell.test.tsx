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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The studio package root, anchored on THIS FILE rather than on `process.cwd()`. Under `pnpm test`
// the two agree (the cwd is `apps/studio`); under `check:mutation-diff` they do not — Stryker runs
// vitest from a SANDBOX copy of the repo root, so a cwd-relative `src/components/…` read hits
// ENOENT and fails the dry run before a single mutant is tried. Measured 2026-09-06: the first
// branch whose mutated studio files were witnessed by this suite could reach no verdict at all.
const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { AppDataContext, type AppData } from '../lib/appData';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';
import { TreeView } from './TreeView';

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

async function renderTree(): Promise<HTMLElement> {
  const { container } = render(
    <AppDataContext.Provider value={appData}>
      <TreeView focus={null} />
    </AppDataContext.Provider>,
  );
  // Flush the one-shot /api/tree load so the world has landed before asserting.
  await act(async () => {});
  expect(http.countTo('/api/tree')).toBeGreaterThan(0);
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

// ADR-0608 retired the flat-look LAB ROUTES with the flat forest picture they staged:
// `?semanticGrowth=demo` (semantic-growth-studio-demo), `?organicGrowth=organic-pose-to-pose` /
// `organic-island-accretion` (organic-growth-app-witness) and the Chapter 2 round-3 comparison lab
// `?organicGrowth=r3-lab`, together with `SemanticGrowthDemo.tsx` and every reader that gated them.
// Their stage-specific suites went with them. What survives is the clean-route half of their
// contract: no query value mounts a witness stage — each falls through to the ordinary map.
describe('retired lab routes fall through to the ordinary map (ADR-0608) — asa: sgsd-clean-studio-never-mounts-the-demo', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('sgsd-clean-studio-never-mounts-the-demo: the clean route and every retired lab value render the ordinary map and no witness stage', async () => {
    for (const search of [
      '',
      '?semanticGrowth=demo',
      '?organicGrowth=organic-pose-to-pose',
      '?organicGrowth=organic-island-accretion',
      '?organicGrowth=r3-lab',
    ]) {
      window.history.pushState({}, '', `/${search}#/tree`);
      const container = await renderTree();
      // The ordinary map shell mounted…
      expect(container.querySelector('.tree-wrap'), `map at ${search || '(clean)'}`).toBeTruthy();
      expect(container.querySelector('svg.world-scene'), `scene at ${search || '(clean)'}`).toBeTruthy();
      // …and no witness stage or its controls did.
      expect(container.querySelector('[data-semantic-growth-frame]')).toBeNull();
      expect(container.querySelector('nav[aria-label="Semantic growth controls"]')).toBeNull();
      expect(container.querySelector('[data-r3-lab-candidate]')).toBeNull();
      cleanup();
    }
  });
});
