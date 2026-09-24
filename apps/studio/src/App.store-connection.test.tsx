// @vitest-environment jsdom
//
// The map's database-connection light, WIRED (`store-connection-signal`). The reading and the render
// are proved in isolation next door; this file exists because neither of those can fail if the chip
// is never mounted, or if the health phase never reaches it. That is the fault class the studio has
// been bitten by before — a green package suite over a dishonest live render — so the chain
// `/api/health` → StoreBanner's single poller → App → TreeView → the chip is driven end to end here,
// through the REAL components, with only the non-participating global chrome handed in as stubs.
//
// It also pins the placement the owner asked for: ABOVE the legend, and outside the panel's
// scrolling half so a long island list cannot scroll the light away.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

import { App, type AppSurfaces } from './App';
import { HttpDouble, installHttpDouble } from './test/httpDouble';
import type { ActivityPayload, MeInfo, StoreHealth, TreePayload, TreeStory } from './types';

const ME = '/api/me';
const DOCS = '/api/docs';
const ASSETS = '/api/assets';
const COMMENTS = '/api/comments';
const TREE = '/api/tree';
const HEALTH = '/api/health';
const ACTIVITY = '/api/activity';
const DB_STATUS = '/api/db/status';

let http: HttpDouble;

const MEMBER: MeInfo = {
  email: 'operator@example.com',
  role: 'admin',
  status: 'active',
  member: true,
};

// Only the chrome that takes no part in this chain. Never TreeView (it mounts the chip), never
// StoreBanner (it owns the single /api/health poller the phase comes from).
const SURFACES: AppSurfaces = {
  Sidebar: () => null,
  Hud: () => null,
  DocView: () => null,
  AssetView: () => null,
  AssetEditor: () => null,
  MembersPanel: () => null,
};

function makeStory(id: string): TreeStory {
  return {
    id,
    title: id,
    outcome: `${id} outcome`,
    status: 'healthy',
    proofMode: 'integration-test',
    uatWitness: 'machine',
    dependsOn: [],
    consumedBy: [],
    capabilities: [],
  };
}

const TREE_PAYLOAD: TreePayload = { stories: [makeStory('alpha')], builds: [], claims: [] };

function health(db: StoreHealth['db']): StoreHealth {
  return {
    store: 'pg',
    db,
    code: { startedAt: '2026-01-01T00:00:00.000Z', head: 'HEAD-A', stale: false },
  };
}

function armDefaults(db: StoreHealth['db'], dbState = 'RUNNABLE'): void {
  http.get(ME, () => MEMBER);
  http.get(ASSETS, () => []);
  http.get(COMMENTS, () => []);
  http.get(DOCS, () => []);
  http.get(ACTIVITY, () => ({ builds: [], claims: [], departures: [] } satisfies ActivityPayload));
  http.get(DB_STATUS, () => ({ state: dbState, activationPolicy: 'ALWAYS' }));
  http.get(HEALTH, () => health(db));
  http.get(TREE, () => TREE_PAYLOAD);
}

/** The rendered connection state, or null when no chip is on screen at all. */
function connectionState(): string | null {
  return document.querySelector('[data-connection-state]')?.getAttribute('data-connection-state') ?? null;
}

beforeEach(() => {
  window.localStorage.clear();
  http = installHttpDouble();
});

afterEach(() => {
  cleanup();
  http.uninstall();
  window.localStorage.clear();
});

describe('the map database-connection light, wired through the real app', () => {
  it('store-connection-signal-greens-only-when-the-store-answers: a store that answers paints the live map green', async () => {
    armDefaults('ok');

    render(<App surfaces={SURFACES} />);

    await waitFor(() => {
      expect(connectionState()).toBe('green');
    });
    expect(http.countTo(HEALTH)).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="store-connection"]')?.textContent).toBe(
      'databaseconnected',
    );
  });

  it('store-connection-signal-reds-when-it-does-not: a stopped store paints the live map red', async () => {
    armDefaults('unreachable', 'STOPPED');

    render(<App surfaces={SURFACES} />);

    await waitFor(() => {
      expect(connectionState()).toBe('red');
    });
    expect(document.querySelector('[data-testid="store-connection"]')?.textContent).toBe(
      'databasenot connected',
    );
  });

  it('store-connection-signal-carries-no-affordance: the light sits above the legend and outside the scrolling half', async () => {
    armDefaults('ok');

    render(<App surfaces={SURFACES} />);

    await waitFor(() => {
      expect(connectionState()).toBe('green');
    });
    const panel = document.querySelector('.shared-islands-panel');
    const chip = document.querySelector('[data-testid="store-connection"]');
    const body = document.querySelector('.shared-islands-panel-body');
    expect(panel).not.toBeNull();
    expect(chip).not.toBeNull();
    // The owner's placement: at the top of the left-hand column, ahead of the Legend drawer…
    expect(chip?.parentElement).toBe(panel);
    expect(body).not.toBeNull();
    expect(panel?.firstElementChild).toBe(chip);
    // …and NOT inside the scrolling half, or a long island list would scroll it out of view.
    expect(body?.contains(chip ?? null)).toBe(false);
  });
});
