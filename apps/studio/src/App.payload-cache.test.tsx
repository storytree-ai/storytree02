// @vitest-environment jsdom
//
// map-payload-cache (ADR-0240 decision 2, stage 2): a reloaded studio paints the forest from its
// last visit's persisted /api/tree + /api/docs payloads instead of a cold "Growing the world…"
// wait, then ALWAYS revalidates against the network. This is an INTEGRATION test over the REAL
// App + the REAL TreeView + the REAL StoreBanner (a mocked map would hollow every paint contract
// below) — only the non-participating global chrome (Sidebar/Hud/DocView/AssetView/AssetEditor/
// MembersPanel) is stubbed, and every Studio API call is fully controlled.
//
// Neither the storage mechanism nor the exact stamp derivation is prescribed by the node spec —
// this test AUTHORS that contract (there is no `payloadCache.ts` yet for it to import): the entry
// lives under ONE localStorage key (discovered per-test, never hand-guessed) as JSON carrying at
// least a `clientStamp` (guard 1, the bundle-moving stamp) and a `codeHead` (guard 2, `/api/health`'s
// `code.head`, lifted from StoreBanner) alongside the tree/docs payloads — see the guard tests below
// for exactly how each is driven. This test therefore never imports a not-yet-existing module: it
// drives the real App/TreeView/StoreBanner and observes localStorage + the rendered DOM only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

// Non-participating global chrome only — never TreeView, never StoreBanner (it owns the single
// /api/health poll the server-code-stamp guard rides), never lib/poll (TreeView's own now-ticker).

import { App, type AppSurfaces } from './App';
import { ACT2_INTRO_SESSION_KEY } from './components/act2Intro';
import { api } from './api';

import { HttpDouble, errorReply, installHttpDouble } from './test/httpDouble';

// THE TRANSPORT IS DOUBLED AND THE SURFACES ARE HANDED IN (anti-slop-adoption-arc inc-06,
// `no-module-mocking`). The real `api` client runs — it builds every URL below and parses every
// payload — and the child components arrive through `App`'s own `surfaces` slot, whose defaults
// are the real ones. Two module mocks were dropped outright rather than replaced, because the REAL
// modules already answer what the mocks asserted: `useDevStoreOverride()` returns null with no
// `?devLoadState` in the URL, and `getDesktopAuth()` returns undefined with no `window.desktopAuth`.
const ME = '/api/me';
const DOCS = '/api/docs';
const ASSETS = '/api/assets';
const COMMENTS = '/api/comments';
const TREE = '/api/tree';
const HEALTH = '/api/health';
const ACTIVITY = '/api/activity';
const DB_STATUS = '/api/db/status';
const DB_START = '/api/db/start';
const DB_WAKE = '/api/db/wake';

let http: HttpDouble;

// Non-participating global chrome only — never TreeView, never StoreBanner (it owns the single
// /api/health poll the server-code-stamp guard rides), never lib/poll (TreeView's own now-ticker).
const SURFACES: AppSurfaces = {
  Sidebar: () => null,
  Hud: () => null,
  DocView: () => null,
  AssetView: () => null,
  AssetEditor: () => null,
  MembersPanel: () => null,
};

import type {
  ActivityPayload,
  ClaimActivity,
  Comment,
  CommentAnchor,
  DocMeta,
  GuidanceAsset,
  MeInfo,
  StoreHealth,
  TreePayload,
  TreeStory,
} from './types';

const MEMBER: MeInfo = {
  email: 'operator@example.com',
  role: 'admin',
  status: 'active',
  member: true,
};

const SENTINEL_ASSET_ID = 'sentinel-asset-never-cached';
const SENTINEL_COMMENT_ID = 'sentinel-comment-never-cached';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStory(id: string, status: TreeStory['status'] = 'healthy'): TreeStory {
  return {
    id,
    title: id,
    outcome: `${id} outcome`,
    status,
    proofMode: 'integration-test',
    uatWitness: 'machine',
    dependsOn: [],
    consumedBy: [],
    capabilities: [],
  };
}

function makeDocs(ids: string[]): DocMeta[] {
  return ids.map((id) => ({ id, title: id, group: 'Reference', excerpt: `${id} excerpt` }));
}

function makeTreePayload(
  storyIds: string[],
  extra?: { builds?: TreePayload['builds']; claims?: TreePayload['claims'] },
): TreePayload {
  return {
    stories: storyIds.map((id) => makeStory(id)),
    builds: extra?.builds ?? [],
    claims: extra?.claims ?? [],
  };
}

function makeClaim(unitId: string, sessionId: string): ClaimActivity {
  return {
    unitId,
    kind: 'claim',
    sessionId,
    branch: 'claude/real/sentinel',
    intent: 'real',
    grade: 'work',
    at: new Date().toISOString(),
  };
}

function sentinelAssets(): GuidanceAsset[] {
  return [
    {
      id: SENTINEL_ASSET_ID,
      category: 'pattern',
      title: 'sentinel asset',
      description: 'must never be persisted',
      body: 'must never be persisted',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function sentinelComments(): Comment[] {
  const anchor: CommentAnchor = {
    kind: 'topic',
    headingSlug: null,
    headingText: null,
    quote: null,
    prefix: null,
    suffix: null,
    startOffset: null,
    color: null,
  };
  return [
    {
      id: SENTINEL_COMMENT_ID,
      topicKind: 'doc',
      topicId: 'decisions/0240-x.md',
      anchor,
      body: 'must never be persisted',
      author: 'sentinel-author',
      createdAt: '2026-01-01T00:00:00.000Z',
      resolved: false,
      resolvedAt: null,
    },
  ];
}

function baseHealth(head: string): StoreHealth {
  return {
    store: 'pg',
    db: 'ok',
    code: { startedAt: '2026-01-01T00:00:00.000Z', head, stale: false },
  };
}

/** Fast, non-deferred defaults for everything EXCEPT `tree`/`listDocs`, which each scenario below
 *  configures itself (deferred or immediate, per the contract under test). */
function armFastDefaults(head = 'HEAD-A'): void {
  http.get(ME, () => MEMBER);
  http.get(ASSETS, () => []);
  http.get(COMMENTS, () => []);
  http.get(ACTIVITY, () => ({ builds: [], claims: [], departures: [] } satisfies ActivityPayload));
  http.get(HEALTH, () => baseHealth(head));
  http.get(DB_STATUS, () => ({ state: 'RUNNABLE', activationPolicy: 'ALWAYS' }));
  http.post(DB_START, () => ({ ok: true }));
  http.post(DB_WAKE, () => ({ ok: true }));
}

function localStorageKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}

function uniqueTerritoryIds(): string[] {
  const ids = new Set(
    Array.from(document.querySelectorAll('.hex-territory[data-story-id]')).map(
      (el) => el.getAttribute('data-story-id') ?? '',
    ),
  );
  return Array.from(ids).sort();
}

function expectTerritories(ids: string[]): void {
  expect(uniqueTerritoryIds()).toEqual([...ids].sort());
}

function isShowingGrowingWorld(): boolean {
  return screen.queryByText(/Growing the world/i) !== null;
}

function treeWrapEl(): HTMLElement | null {
  return document.querySelector('.tree-wrap');
}

/** Boots ONE real App to completion (cold — no prior cache), waits for the world to paint and the
 *  cache entry to land, then captures that entry's storage KEY + raw JSON before unmounting. Every
 *  test that needs a pre-existing, genuinely-written entry primes it this way rather than guessing
 *  a key or a stamp — it reads back whatever the REAL App actually wrote. */
async function runColdBootAndCaptureEntry(scenario: {
  storyIds: string[];
  docIds: string[];
  head?: string;
  builds?: TreePayload['builds'];
  claims?: TreePayload['claims'];
}): Promise<{ key: string; raw: string }> {
  window.localStorage.clear();
  armFastDefaults(scenario.head ?? 'HEAD-A');
  http.get(TREE, () => 
    makeTreePayload(scenario.storyIds, { builds: scenario.builds, claims: scenario.claims }),
  );
  http.get(DOCS, () => makeDocs(scenario.docIds));

  render(<App surfaces={SURFACES} />);
  await waitFor(() => {
    expectTerritories(scenario.storyIds);
  });
  await waitFor(() => {
    expect(localStorageKeys().length).toBeGreaterThan(0);
  });
  const keys = localStorageKeys();
  expect(keys.length).toBe(1);
  const key = keys[0]!;
  const raw = window.localStorage.getItem(key)!;
  expect(raw).toBeTruthy();

  cleanup();
  return { key, raw };
}

async function primeValidEntry(opts: {
  storyIds: string[];
  docIds: string[];
  head?: string;
}): Promise<{ key: string; raw: string }> {
  return runColdBootAndCaptureEntry(opts);
}

/** Makes reads and/or writes throw for exactly ONE storage key (the cache's own — discovered via
 *  {@link primeValidEntry}), leaving every other key (e.g. the existing panel-width / arc-display
 *  preferences) working normally through the REAL Storage implementation. Returns a restore fn. */
function scopedThrowingStorage(
  key: string,
  opts: { get?: boolean; set?: boolean; setError?: unknown },
): () => void {
  const realGet = Storage.prototype.getItem;
  const realSet = Storage.prototype.setItem;
  const getSpy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, k: string): string | null {
      if (k === key && opts.get) throw new Error('storage read unavailable');
      return realGet.call(this, k);
    });
  const setSpy = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, k: string, v: string): void {
      if (k === key && opts.set) throw opts.setError ?? new Error('storage write unavailable');
      realSet.call(this, k, v);
    });
  return () => {
    getSpy.mockRestore();
    setSpy.mockRestore();
  };
}

beforeEach(() => {
  window.localStorage.clear();
  // This suite is about the map's DATA, not the first-arrival choreography. Mark this jsdom session
  // as returning so the real TreeView paints the settled forest directly: a first arrival's regrow
  // now waits for the mounted 3D land to settle its status (ADR-0608 D1a), and jsdom's land never
  // gets a frame to settle on, so the first test in the file would otherwise see no island at all.
  window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, '1');
  http = installHttpDouble();
});

afterEach(() => {
  cleanup();
  http.uninstall();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('map-payload-cache', () => {
  it('map-payload-cache-persists-only-read-only-payloads: a completed cold boot writes one entry holding the tree+docs payloads only, never the mutable asset/comment reads', async () => {
    armFastDefaults();
    http.get(TREE, () => makeTreePayload(['alpha']));
    http.get(DOCS, () => makeDocs(['doc-a']));
    http.get(ASSETS, () => sentinelAssets());
    http.get(COMMENTS, () => sentinelComments());

    render(<App surfaces={SURFACES} />);

    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    await waitFor(() => {
      expect(localStorageKeys().length).toBeGreaterThan(0);
    });

    const keys = localStorageKeys();
    expect(keys.length).toBe(1);
    const raw = window.localStorage.getItem(keys[0]!);
    expect(raw).toBeTruthy();
    expect(raw).toContain('alpha');
    expect(raw).toContain('doc-a');
    expect(raw).not.toContain(SENTINEL_ASSET_ID);
    expect(raw).not.toContain(SENTINEL_COMMENT_ID);
  });

  it('map-payload-cache-paints-then-always-revalidates: a valid cached entry paints the world before /api/tree resolves, both /api/tree and /api/docs are still requested, and the resolved payload reconciles added/removed stories', async () => {
    await primeValidEntry({ storyIds: ['alpha', 'beta'], docIds: ['doc-a'] });

    armFastDefaults();
    const treeDeferred = deferred<TreePayload>();
    const docsDeferred = deferred<DocMeta[]>();
    http.clearRequests(TREE);
    http.clearRequests(DOCS);
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    render(<App surfaces={SURFACES} />);

    await waitFor(() => {
      expectTerritories(['alpha', 'beta']);
    });
    expect(isShowingGrowingWorld()).toBe(false);
    expect(http.countTo(TREE)).toBeGreaterThan(0);
    expect(http.countTo(DOCS)).toBeGreaterThan(0);

    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha', 'gamma']));
      docsDeferred.resolve(makeDocs(['doc-a', 'doc-b']));
      await Promise.resolve();
    });

    await waitFor(() => {
      expectTerritories(['alpha', 'gamma']);
    });
  });

  it('map-payload-cache-withholds-live-coordination-signals: a cached paint seeds no build/claim/departure wisp, and the entry itself carries no in-flight coordination rows — a wisp appears only from the revalidated payload / the existing activity poll', async () => {
    const claim = makeClaim('alpha', 'session-sentinel');
    const primed = await runColdBootAndCaptureEntry({
      storyIds: ['alpha'],
      docIds: ['doc-a'],
      claims: [claim],
    });
    expect(primed.raw).not.toContain('session-sentinel');

    armFastDefaults();
    const treeDeferred = deferred<TreePayload>();
    const docsDeferred = deferred<DocMeta[]>();
    const activityDeferred = deferred<ActivityPayload>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);
    http.get(ACTIVITY, () => activityDeferred.promise);

    render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    expect(document.querySelector('.world-claim-wisp')).toBeNull();

    await act(async () => {
      activityDeferred.resolve({ builds: [], claims: [claim], departures: [] });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.querySelector('.world-claim-wisp')).toBeTruthy();
    });

    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha']));
      docsDeferred.resolve(makeDocs(['doc-a']));
      await Promise.resolve();
    });
  });

  it('map-payload-cache-marks-cached-proof-state-provisional: the map exposes an observable provisional state while a cached paint revalidates; it clears on a resolved revalidation and REMAINS on a failed one', async () => {
    await primeValidEntry({ storyIds: ['alpha'], docIds: ['doc-a'] });

    // Sub-case A: revalidation SUCCEEDS -> provisional clears.
    armFastDefaults();
    let treeDeferred = deferred<TreePayload>();
    let docsDeferred = deferred<DocMeta[]>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    const successRun = render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    await waitFor(() => {
      expect(treeWrapEl()?.getAttribute('data-cache-provisional')).toBe('true');
    });

    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha']));
      docsDeferred.resolve(makeDocs(['doc-a']));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(treeWrapEl()?.getAttribute('data-cache-provisional')).not.toBe('true');
    });
    successRun.unmount();
    cleanup();

    // Sub-case B: revalidation FAILS -> provisional REMAINS, and the cached world stays painted —
    // never silently promoted to confirmed, never replaced by an error screen.
    armFastDefaults();
    treeDeferred = deferred<TreePayload>();
    docsDeferred = deferred<DocMeta[]>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    await waitFor(() => {
      expect(treeWrapEl()?.getAttribute('data-cache-provisional')).toBe('true');
    });

    const observedFailure = deferred<void>();
    treeDeferred.promise.catch(() => observedFailure.resolve());
    await act(async () => {
      treeDeferred.reject(new Error('tree revalidation failed'));
      await observedFailure.promise;
    });
    docsDeferred.resolve(makeDocs(['doc-a']));

    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    expect(treeWrapEl()?.getAttribute('data-cache-provisional')).toBe('true');
  });

  it('map-payload-cache-refuses-a-foreign-stamp-or-a-malformed-entry: an entry carrying a foreign client stamp, or one that fails the structural shape check, is evicted and never painted — decided before any network response', async () => {
    const primed = await primeValidEntry({ storyIds: ['alpha'], docIds: ['doc-a'] });

    // Sub-case A: a foreign clientStamp — a shape-valid entry no running bundle ever wrote.
    const foreign = JSON.parse(primed.raw) as Record<string, unknown>;
    foreign.clientStamp = 'a-stamp-no-running-bundle-ever-wrote';
    window.localStorage.setItem(primed.key, JSON.stringify(foreign));

    armFastDefaults();
    let treeDeferred = deferred<TreePayload>();
    let docsDeferred = deferred<DocMeta[]>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    const foreignRun = render(<App surfaces={SURFACES} />);
    await screen.findByTestId('tree-route');
    expect(isShowingGrowingWorld()).toBe(true);
    expectTerritories([]);
    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha']));
      docsDeferred.resolve(makeDocs(['doc-a']));
      await Promise.resolve();
    });
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    foreignRun.unmount();
    cleanup();

    // Sub-case B: a structurally malformed / hand-truncated entry.
    window.localStorage.setItem(primed.key, '{not valid json at all');

    armFastDefaults();
    treeDeferred = deferred<TreePayload>();
    docsDeferred = deferred<DocMeta[]>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    render(<App surfaces={SURFACES} />);
    await screen.findByTestId('tree-route');
    expect(isShowingGrowingWorld()).toBe(true);
    expectTerritories([]);
    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha']));
      docsDeferred.resolve(makeDocs(['doc-a']));
      await Promise.resolve();
    });
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
  });

  it('map-payload-cache-evicts-on-a-server-code-stamp-change: the entry records the server code.head at write time, and a health response carrying a different head evicts it so a later boot never paints from it', async () => {
    await primeValidEntry({ storyIds: ['alpha'], docIds: ['doc-a'], head: 'HEAD-A' });

    // Boot #2: health now reports a DIFFERENT code.head — must evict the stale entry.
    armFastDefaults('HEAD-B');
    http.get(TREE, () => makeTreePayload(['alpha']));
    http.get(DOCS, () => makeDocs(['doc-a']));
    const evictRun = render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expect(http.countTo(HEALTH)).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    evictRun.unmount();
    cleanup();

    // Boot #3 over the SAME store, holding /api/tree pending — must paint COLD (the entry is
    // gone), never from the evicted, stale-headed entry.
    armFastDefaults('HEAD-B');
    const treeDeferred = deferred<TreePayload>();
    const docsDeferred = deferred<DocMeta[]>();
    http.get(TREE, () => treeDeferred.promise);
    http.get(DOCS, () => docsDeferred.promise);

    render(<App surfaces={SURFACES} />);
    await screen.findByTestId('tree-route');
    expect(isShowingGrowingWorld()).toBe(true);
    expectTerritories([]);

    await act(async () => {
      treeDeferred.resolve(makeTreePayload(['alpha']));
      docsDeferred.resolve(makeDocs(['doc-a']));
      await Promise.resolve();
    });
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
  });

  it('map-payload-cache-degrades-to-a-cold-paint: an unavailable, quota-refusing, or corrupt store leaves the studio on exactly today\'s cold path — both fetches, the existing placeholder, a completed boot, no unhandled error, no blocked boot', async () => {
    const primed = await primeValidEntry({ storyIds: ['alpha'], docIds: ['doc-a'] });

    // (a) the store's reads AND writes throw, scoped to the cache's own key — every other key
    // (e.g. the existing panel-width / arc-display preferences) keeps working normally.
    let restore = scopedThrowingStorage(primed.key, { get: true, set: true });
    armFastDefaults();
    http.get(TREE, () => makeTreePayload(['alpha']));
    http.get(DOCS, () => makeDocs(['doc-a']));
    http.clearRequests(TREE);
    http.clearRequests(DOCS);
    const runA = render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    expect(http.countTo(TREE)).toBeGreaterThan(0);
    expect(http.countTo(DOCS)).toBeGreaterThan(0);
    runA.unmount();
    cleanup();
    restore();

    // (b) a quota refusal specifically on WRITE (reads still succeed).
    restore = scopedThrowingStorage(primed.key, {
      set: true,
      setError: new DOMException('quota exceeded', 'QuotaExceededError'),
    });
    armFastDefaults();
    http.get(TREE, () => makeTreePayload(['alpha']));
    http.get(DOCS, () => makeDocs(['doc-a']));
    const runB = render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    runB.unmount();
    cleanup();
    restore();

    // (c) an unparseable entry already on disk, at the cache's own key.
    window.localStorage.setItem(primed.key, 'not json{{{');
    armFastDefaults();
    http.get(TREE, () => makeTreePayload(['alpha']));
    http.get(DOCS, () => makeDocs(['doc-a']));
    const runC = render(<App surfaces={SURFACES} />);
    await waitFor(() => {
      expectTerritories(['alpha']);
    });
    runC.unmount();
  });
});
