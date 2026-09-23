#!/usr/bin/env node
// capture-land-mount.mjs — the staged picture for `the-land-sits-under-the-working-map`.
//
// WHAT IT STAGES. Three arms of the SAME build over the SAME live corpus, differing only by the
// flag this increment added: the working map as it ships (control), the map with the 3D land under
// it (`?landMount=1`), and the map with the land AND the kit props (`?landMountProps=1`, the arm
// that exists to show the owner what the doubled canopy looks like — see ADR-0530 D3). One build
// and one server, so nothing but the flag can differ between the arms.
//
// ⚠ IT REFUSES A SERVER IT CANNOT PROVE IS THIS TREE'S. This box runs several worktrees at once, so
// a stale sibling's server already holding the port would answer happily and the capture would
// measure that sibling's code and file the picture as this branch's evidence. `/api/health`'s
// `code.directory` is the studio's own answer to "whose module graph is this?", so it is checked
// BEFORE any page is opened and a mismatch — or an absent stamp — is a refusal rather than a
// warning. Same discipline `capture.mjs` gained in PR #1942.
//
// ⚠ AND IT REFUSES A SERVER THAT CANNOT REACH THE LIVE STORE (`db: 'ok'` is the healthy value).
// `store: 'pg', db: 'unreachable'` is
// the shape a studio takes when it has no `STORYTREE_DB_USER` — it serves, the map renders from
// nothing, and the picture is of an EMPTY forest that looks like a rendering defect. The real
// forest is the whole point of staging this, so an unreachable store is a refusal too.
//
// ⚠ AND IT WARMS UP ON A DISTINCT URL FIRST. The first page against a cold vite pays the transform
// of the whole route AND can render against a half-streamed corpus, so arm 1 would carry a cost and
// a picture the other two do not. The warm-up is thrown away.
//
// Usage: node apps/studio/scripts/capture-land-mount.mjs --url <base> --out <dir> [--viewport WxH]

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const base = arg('url', 'http://127.0.0.1:5199').replace(/\/$/, '');
const outDir = path.resolve(arg('out', 'docs/research/land-mount'));
const [vw, vh] = String(arg('viewport', '2560x1600')).split('x').map(Number);

/** This worktree's own top level — what the served tree has to be. */
const myTree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** ⚠ THE GUARD. A server that cannot name its tree, or names another, is refused. */
async function assertServerIsThisTree() {
  const res = await fetch(`${base}/api/health`);
  if (!res.ok) throw new Error(`refusing: ${base}/api/health answered ${res.status}`);
  const health = await res.json();
  const served = health?.code?.directory;
  if (typeof served !== 'string' || served.length === 0) {
    throw new Error(
      `refusing: ${base} serves no \`code.directory\` stamp, so it cannot be proved to be this ` +
        `worktree. A stale sibling's server on this port would answer exactly like this.`,
    );
  }
  if (health?.code?.stale === true) {
    throw new Error(`refusing: ${base} is serving code older than its checkout (code.stale) — restart it.`);
  }
  if (health?.db !== 'ok') {
    throw new Error(
      `refusing: ${base} reports store=${health?.store} db=${health?.db}. Without the live store the ` +
        `map draws an empty forest, and an empty forest is not evidence about the land. Start the ` +
        `server with STORYTREE_DB_USER set (it is in ~/.storytree/secrets.json).`,
    );
  }
  if (path.resolve(served) !== path.resolve(myTree)) {
    throw new Error(
      `refusing: ${base} is serving ${served}, not ${myTree}. That is another worktree's code — ` +
        `stop it, or capture against a port this tree owns.`,
    );
  }
  return {
    served,
    branch: health?.code?.branch ?? null,
    head: health?.code?.head ?? null,
    store: health?.store ?? null,
  };
}

/** Open one arm and wait for it to be genuinely finished drawing. */
async function arm(page, { name, query, note }) {
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'load' });
  // The map itself.
  await page.waitForSelector('svg.world-scene', { timeout: 120_000 });
  // The land layer, when this arm asks for one: `data-state` is the component's own report, so this
  // waits on the branch it actually took rather than on a guess about timing.
  if (query.includes('landMount')) {
    await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"]', { timeout: 180_000 });
    await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
  }
  // The app's own settle attestation where it offers one; otherwise fall through.
  await page
    .waitForFunction(() => window.__storytreeMotionSettled === true, { timeout: 60_000 })
    .catch(() => {});
  // ⚠ AN HONEST EXPLICIT WAIT, and it is named rather than hidden. The ground build is ~1–2 s of
  // main-thread work AFTER the canvas element exists (`docs/research/land-view-performance-2026-09-15/`),
  // and no signal in the app fires when a WebGL frame has been PRESENTED. So this is a sleep, it is
  // generous, and a picture is checked by eye anyway — which is the whole point of staging it.
  await page.waitForTimeout(8000);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  // The five counts the SVG layer must NOT have lost. My change hides the ground LAYERS with
  // `opacity`, so every element is still present and still hit-testable; a count that moved would
  // mean the mount had taken something from the map.
  const counts = await page.evaluate(() => {
    const svg = document.querySelector('svg.world-scene');
    const n = (sel) => svg?.querySelectorAll(sel).length ?? 0;
    return {
      parcels: n('.parcel'),
      caves: n('.world-cave'),
      trailFills: n('.trail-fill'),
      crowns: n('.story-tree'),
      flora: n('.garden-flora'),
      nameplates: n('.world-plate-bg'),
      groundLayers: n('.relaxed-land, .hex-coastland'),
      canvases: document.querySelectorAll('[data-testid="land-mount"] canvas').length,
    };
  });
  console.log(`  ${name}: ${JSON.stringify(counts)}  ${note}`);
  return { name, note, query, file: path.basename(file), counts };
}

const ARMS = [
  { name: '1-control-map-as-it-ships', query: '', note: 'the working map, no flag' },
  { name: '2-land-under-the-map', query: '?landMount=1', note: 'the 3D ground under the SVG layer' },
  {
    name: '3-land-and-props-under-the-map',
    query: '?landMount=1&landMountProps=1',
    note: 'the staging arm — land + kit props, so the doubled canopy is visible',
  },
];

const stamp = await assertServerIsThisTree();
console.log(`server proved: ${stamp.served} @ ${stamp.branch} ${String(stamp.head).slice(0, 8)} (store ${stamp.store})`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
// ⚠ Thrown away on purpose — see the header. A DISTINCT url, so no arm inherits its cache state.
await page.goto(`${base}/?warmup=1#/library`, { waitUntil: 'load' }).catch(() => {});
await page.waitForTimeout(3000);

const results = [];
for (const a of ARMS) results.push(await arm(page, a));
await browser.close();

writeFileSync(
  path.join(outDir, 'measurements.json'),
  `${JSON.stringify({ takenAt: new Date().toISOString(), served: stamp, viewport: { width: vw, height: vh }, arms: results }, null, 2)}\n`,
);
console.log(`\nwrote ${outDir}`);
