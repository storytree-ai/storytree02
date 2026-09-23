// measure-map-chrome.ts — DOES A NAMEPLATE COVER ANOTHER STORY'S ISLAND? (ADR-0598 D2)
//
// The instrument the spacing re-derivation was measured on. Run the studio on a port of your own
// (never 5173 — a sibling worktree may own it), then from `apps/studio`:
//
//   ST_STUDIO_URL=http://127.0.0.1:<port> node --import tsx scripts/measure-map-chrome.ts
//   ST_STUDIO_URL=… ARM_RATIO=0.5 ARM_CHROME=0 node --import tsx scripts/measure-map-chrome.ts
//
// ⚠ IT IS NOT A CAPTURE DRIVER, and that is why it is worth having beside the ones that are. The
// ladders in this directory drive a real browser, render, and hand the owner pictures; they cost
// minutes per arm and they answer "how does this look", which is his question and not a test's.
// This one packs the REAL forest in Node and counts a thing a picture cannot be scored on: how many
// places a nameplate lands on land or on a tree that belongs to another story. It runs in about a
// second, so a rung sweep is cheap, and it is what turns "the map looks squished" into a number a
// later session can reproduce.
//
// ⚠ IT TAKES THE TREE FROM A RUNNING STUDIO AND PACKS IT HERE, which is a second layout and could
// in principle drift from the one the map draws. It does not, and the check is stated rather than
// assumed: run it against the live corpus with no arm set and the world box it prints is the box
// `export-real-forest.mjs` measures off the page. If those ever disagree, THIS file is wrong.
//
// ⚠ WHAT COUNTS AS "THE ISLAND" IS ITS LAND *AND* ITS TREE. The crown rises well above the tiles and
// a plate landing on it reads exactly as a label on that island — which is most of what the owner
// was looking at. Counting tiles alone reports a twelve-overlap map as having two.

import { packWorld, type ChromeClearance, type LayoutStory } from '@storytree/forest-layout';
import {
  HEX_R,
  LAND_CAMERA_ELEVATION_DEG,
  PLATE_SCALE,
  TILE_DEPTH,
  TREE_SCALE,
  crownRadius,
  hexCenter,
  hexCorners,
} from '@storytree/forest-world';

import { mapChromeClearance, nameplateLayout } from '../src/lib/nameplate.ts';

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const URL_ = process.env['ST_STUDIO_URL'] ?? '';
if (!URL_) throw new Error('set ST_STUDIO_URL to a running studio (never 5173 — a sibling may own it)');

interface TreeApiStory {
  id: string;
  status?: string;
  dependsOn?: string[];
  capabilities?: { id: string; dependsOn?: string[]; status?: string }[];
}

const res = await fetch(`${URL_}/api/tree`);
if (!res.ok) throw new Error(`/api/tree answered ${res.status}`);
const payload = (await res.json()) as { stories: TreeApiStory[] };

// The studio's own two filters, and nothing else: `presentStories` drops retired stories and retired
// capabilities, and `buildWorld` drops `render: building` stories only under `?buildings=on`, which
// is NOT the default — so every present story is on the map.
const stories: LayoutStory[] = payload.stories
  .filter((s) => s.status !== 'retired')
  .map((s) => ({
    id: s.id,
    dependsOn: s.dependsOn ?? [],
    capabilities: (s.capabilities ?? [])
      .filter((c) => c.status !== 'retired')
      .map((c) => ({ id: c.id, dependsOn: c.dependsOn ?? [] })),
  }));
if (stories.length < 20) throw new Error(`only ${stories.length} stories — is this studio on the live store?`);

const ratio = process.env['ARM_RATIO'] === undefined ? undefined : Number(process.env['ARM_RATIO']);
const chromeScale = process.env['ARM_CHROME'] === undefined ? undefined : Number(process.env['ARM_CHROME']);
const chrome: ChromeClearance = mapChromeClearance(stories.map((s) => s.id), chromeScale);
const world = packWorld(stories, ratio === undefined ? { chrome } : { chrome, spacing: { ratio } });

const elev = LAND_CAMERA_ELEVATION_DEG;
const footprints: { owner: string; box: Box }[] = [];
for (const t of world.territories) {
  for (const h of t.tiles) {
    const c = hexCenter(h, { elevationDeg: elev });
    const corners = hexCorners(c.x, c.y, HEX_R, elev);
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    // `+ TILE_DEPTH` on the bottom: a drawn cell is an extrusion, not a flat hex.
    footprints.push({ owner: t.story.id, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) + TILE_DEPTH } });
  }
  const cr = crownRadius(t.caps.length);
  footprints.push({
    owner: t.story.id,
    box: {
      x0: t.treeSpot.x - cr * TREE_SCALE,
      y0: t.treeSpot.y - (2.7 * cr + 16) * TREE_SCALE,
      x1: t.treeSpot.x + cr * TREE_SCALE,
      y1: t.treeSpot.y,
    },
  });
}

const plates = world.territories.map((t) => {
  const p = nameplateLayout(t.story.id.length, false);
  const w = p.w * PLATE_SCALE;
  return { id: t.story.id, box: { x0: t.centroid.x - w / 2, y0: t.labelY, x1: t.centroid.x + w / 2, y1: t.labelY + p.h * PLATE_SCALE } as Box };
});

const onIsland: string[] = [];
for (const pl of plates) {
  const hit = new Set<string>();
  for (const f of footprints) if (f.owner !== pl.id && overlaps(pl.box, f.box)) hit.add(f.owner);
  for (const island of [...hit].sort()) onIsland.push(`${pl.id} → ${island}`);
}
const onPlate: string[] = [];
for (let i = 0; i < plates.length; i += 1) {
  for (let j = i + 1; j < plates.length; j += 1) {
    const a = plates[i];
    const b = plates[j];
    if (a && b && overlaps(a.box, b.box)) onPlate.push(`${a.id} ↔ ${b.id}`);
  }
}

const report = {
  ratio: ratio ?? 'shipped',
  chromeScale: chromeScale ?? 1,
  islands: world.territories.length,
  worldBox: `${Math.round(world.width)} x ${Math.round(world.height)}`,
  aspect: Number((world.height / world.width).toFixed(2)),
  trails: `${world.trails.edges.length} routed / ${world.trails.dropped.length} dropped`,
  plateOnIsland: onIsland.length,
  plateOnPlate: onPlate.length,
  rowBandGround: Number(chrome.rowBand.toFixed(2)),
};
// Two whole shapes rather than a conditional key: the verbose arm lists every offending pair, which
// is what you want when a rung is non-zero and pure noise when it is not.
console.log(JSON.stringify(process.env['ARM_VERBOSE'] ? { ...report, onIsland, onPlate } : report, null, 2));
