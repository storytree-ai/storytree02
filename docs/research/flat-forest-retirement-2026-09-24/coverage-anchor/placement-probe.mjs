#!/usr/bin/env node
// Disposable diagnosis. Syntax-checked only when prepared; no product or capture mutations.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `node /tmp/laneK-retire-coverage-placement-probe.mjs --run --heavy-lock-held \\
  --tree /absolute/immutable/worktree --head FULL_SHA --capture /tmp/fresh-capture-directory
Reads manifest.json, after-rest-receipt.json and after-rest-scene.json. JSON report goes to stdout.
Run under the existing detached heavy-lock protocol; this script starts no server or browser.`;
if (process.argv.includes('--help')) { process.stdout.write(`${usage}\n`); process.exit(0); }
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const name = process.argv[i];
  if (!['--run', '--heavy-lock-held', '--tree', '--head', '--capture'].includes(name) || args.has(name)) throw Error(`Unknown/repeated argument: ${name}`);
  if (name === '--run' || name === '--heavy-lock-held') args.set(name, true);
  else {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value: ${name}`);
    args.set(name, value);
  }
}
if (!args.get('--run') || !args.get('--heavy-lock-held')) throw Error(usage);
const required = name => { const value = args.get(name); if (typeof value !== 'string') throw Error(`Missing ${name}`); return value; };
const absolute = value => { if (!path.isAbsolute(value)) throw Error(`Path must be absolute: ${value}`); return realpathSync(value); };
const tree = absolute(required('--tree'));
const capture = absolute(required('--capture'));
const head = required('--head');
if (!/^[a-f0-9]{40}$/.test(head)) throw Error('HEAD must be an explicit full SHA');
const git = (...argv) => execFileSync('git', ['-C', tree, ...argv], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = name => JSON.parse(readFileSync(path.join(capture, name), 'utf8'));
const manifest = readJson('manifest.json');
const receipt = readJson('after-rest-receipt.json');
const sceneBytes = readFileSync(path.join(capture, 'after-rest-scene.json'));
const exported = JSON.parse(sceneBytes);
const capturedSide = manifest.inputs?.sides?.find(side => side.name === 'after');
if (manifest.status !== 'CAPTURED' || manifest.errors?.length !== 0) throw Error('Capture instrument did not finish cleanly');
if (!capturedSide || absolute(capturedSide.dir) !== tree || capturedSide.head !== head) throw Error('Capture AFTER tree/HEAD differs from requested immutable tree');
if (receipt.side !== 'after' || receipt.framing !== 'rest' || receipt.sceneFile !== 'after-rest-scene.json' || receipt.sceneSha256 !== hash(sceneBytes)) throw Error('Scene file does not match its AFTER/rest receipt');
if (JSON.stringify(manifest.captures?.['after-rest']) !== JSON.stringify(receipt)) throw Error('Manifest and rest receipt disagree');
if (receipt.settled?.settled !== true || receipt.progress !== 1 || receipt.hidden || receipt.visibility !== 'visible') throw Error('Receipt is not a visible settled static capture');
if (['land-mount', 'land-view'].some(kind => !receipt.canvases?.[kind] || receipt.canvases[kind].regrow !== null)) throw Error('Both captured consumers must be settled without active regrow');
if (exported.scene?.el !== 'g') throw Error('No captured semantic scene group');

const beforeSource = manifest.identities?.after?.before?.source;
const afterSource = manifest.identities?.after?.after?.source;
if (!beforeSource || !afterSource || beforeSource.head !== head || afterSource.head !== head || beforeSource.sourceSha256 !== afterSource.sourceSha256 || JSON.stringify(beforeSource.files) !== JSON.stringify(afterSource.files)) throw Error('Captured source identity changed or is absent');
const sourceFiles = afterSource.files;
if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) throw Error('No captured source file hashes');
const requiredFiles = [
  'apps/studio/src/components/LandViewMount.tsx',
  'apps/studio/src/lib/landView.ts',
  'packages/forest-world-r3f/src/ForestWorldCanvas.tsx',
  'packages/forest-world-r3f/src/true-ground.ts',
  'packages/forest-world-r3f/src/ground-dependency.ts',
  'packages/forest-world-r3f/src/map-dressing.ts',
  'packages/forest-world-r3f/src/kit-vocabulary.ts',
  'packages/forest-world-r3f/src/land-relief.ts',
];
for (const file of requiredFiles) if (!sourceFiles.some(entry => entry.path === file)) throw Error(`Missing captured source: ${file}`);
function checkIdentity() {
  if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=normal') !== '') throw Error('Probe requires the requested committed-clean immutable worktree');
  for (const entry of sourceFiles) {
    const absoluteFile = path.resolve(tree, entry.path);
    if (!absoluteFile.startsWith(`${tree}${path.sep}`) || hash(readFileSync(absoluteFile)) !== entry.sha256) throw Error(`Source differs from capture: ${entry.path}`);
  }
}
checkIdentity();
const canvasSource = readFileSync(path.join(tree, 'packages/forest-world-r3f/src/ForestWorldCanvas.tsx'), 'utf8');
// Read the exact private canvas binding; import its values rather than duplicating numbers.
const binding = /const SHIPPED_GROUND_INPUT: GroundInputOptions = \{([\s\S]*?)\};/.exec(canvasSource)?.[1].replace(/\s/g, '');
if (binding !== 'relief:LAND_RELIEF_AMPLITUDE,footprint:KIT_FOOTPRINTS_2026_08_29,height:KIT_HEIGHTS_2026_08_29,') throw Error('Canvas ground constants changed; inspect the actual consumer before adapting this disposable probe');
for (const expression of ['createGroundInputCache(SHIPPED_GROUND_INPUT)', 'const ground = cacheRef.current(descriptors)', 'placements={ground.placements}']) {
  if (!canvasSource.includes(expression)) throw Error(`Shared canvas placement seam changed: ${expression}`);
}

// The installed loader only resolves this immutable tree's TS source. Disable its disk cache.
process.env.TSX_DISABLE_CACHE = '1';
const require = createRequire(path.join(tree, 'packages/forest-world-r3f/package.json'));
const { register } = require('tsx/esm/api');
const unregister = register({ tsconfig: false });
let report;
try {
  const sourceImport = relative => import(pathToFileURL(path.join(tree, relative)).href);
  const [{ landViewStream }, { createGroundInputCache }, kit, relief] = await Promise.all([
    sourceImport('apps/studio/src/lib/landView.ts'),
    sourceImport('packages/forest-world-r3f/src/ground-dependency.ts'),
    sourceImport('packages/forest-world-r3f/src/kit-vocabulary.ts'),
    sourceImport('packages/forest-world-r3f/src/land-relief.ts'),
  ]);
  // This is the exact LandViewMount call. Its reader owns landStreamFromDrawing and its ordering.
  const stream = landViewStream(exported.scene);
  if (!stream.ok) throw Error(`Actual landViewStream refused the captured scene: ${stream.reason}`);
  const opts = { relief: relief.LAND_RELIEF_AMPLITUDE, footprint: kit.KIT_FOOTPRINTS_2026_08_29, height: kit.KIT_HEIGHTS_2026_08_29 };
  // Same production cache/derivation used by the canvas; no independent dressing implementation.
  const ground = createGroundInputCache(opts)(stream.descriptors);
  const coverage = stream.descriptors.filter(descriptor => descriptor.kind === 'coverage-flora');
  const placements = ground.placements.filter(placement => placement.role === 'coverageFlora');
  if (coverage.length === 0 || coverage.length !== placements.length) throw Error(`Coverage count mismatch/absence: descriptors=${coverage.length}, placements=${placements.length}`);

  const bounds = points => {
    if (points.length === 0) return null;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw Error('Non-finite ground/coverage coordinate');
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  };
  const contains = (extent, p) => extent === null ? null : p.x >= extent.minX && p.x <= extent.maxX && p.z >= extent.minZ && p.z <= extent.maxZ;
  const groundPoints = ground.cells.flatMap(cell => cell.points ?? []);
  const groundExtent = bounds(groundPoints);
  const groundByIsland = new Map();
  for (const cell of ground.cells) {
    if (cell.island === undefined) continue;
    const points = groundByIsland.get(cell.island) ?? [];
    points.push(...(cell.points ?? []));
    groundByIsland.set(cell.island, points);
  }
  const islandExtents = new Map([...groundByIsland].map(([id, points]) => [id, bounds(points)]));
  // Production appends coverage in descriptor order. Retain both full values and check identity.
  const rows = coverage.map((descriptor, i) => {
    const placement = placements[i];
    const placementIsland = ground.islandByPlacement.get(placement) ?? null;
    const expectedHeight = relief.landHeight(placement.at.x, placement.at.z, opts.relief);
    const xDelta = placement.at.x - descriptor.transform.x;
    const zDelta = placement.at.z - descriptor.transform.z;
    const heightDelta = placement.y - expectedHeight;
    if (![placement.y, expectedHeight, xDelta, zDelta, heightDelta].every(Number.isFinite)) throw Error('Non-finite placement/height value');
    return {
      index: i, descriptor, placement, placementIsland,
      identityMatches: descriptor.capability === placement.capId && descriptor.island === placementIsland,
      descriptorToPlacementDelta: { x: xDelta, z: zDelta },
      landHeight: expectedHeight, placementHeightDelta: heightDelta,
      insideWholeGroundBounds: contains(groundExtent, placement.at),
      insideOwnIslandGroundBounds: contains(islandExtents.get(descriptor.island) ?? null, placement.at),
    };
  });
  const islandIds = [...new Set([...groundByIsland.keys(), ...coverage.map(descriptor => descriptor.island)])];
  report = {
    status: 'DIAGNOSTIC_RECONSTRUCTION',
    identity: { tree, head, capture, sceneSha256: hash(sceneBytes), sourceSha256: afterSource.sourceSha256, verifiedSourceFiles: sourceFiles.length },
    path: ['LandViewMount(scene)', 'landViewStream(scene)', 'landStreamFromDrawing(scene)', 'createGroundInputCache(SHIPPED_GROUND_INPUT)(descriptors)', 'ground.placements shared by KitProps and casters'],
    scope: 'Settled placement/alignment reconstruction through actual consumer modules; not a read of the live browser cache or GPU buffers.',
    constants: { relief: opts.relief, footprintBinding: 'KIT_FOOTPRINTS_2026_08_29', heightBinding: 'KIT_HEIGHTS_2026_08_29' },
    counts: { descriptors: stream.descriptors.length, cells: ground.cells.length, allPlacements: ground.placements.length, coverageDescriptors: coverage.length, coveragePlacements: placements.length, casters: ground.casters.length },
    extents: { groundRings: groundExtent, coverageDescriptors: bounds(coverage.map(d => d.transform)), coveragePlacements: bounds(placements.map(p => p.at)) },
    summary: {
      identityMismatches: rows.filter(r => !r.identityMatches).length,
      coordinateMismatches: rows.filter(r => r.descriptorToPlacementDelta.x !== 0 || r.descriptorToPlacementDelta.z !== 0).length,
      landHeightMismatches: rows.filter(r => r.placementHeightDelta !== 0).length,
      outsideWholeGroundBounds: rows.filter(r => r.insideWholeGroundBounds === false).length,
      outsideOwnIslandGroundBounds: rows.filter(r => r.insideOwnIslandGroundBounds === false).length,
      missingOwnIslandGroundBounds: rows.filter(r => r.insideOwnIslandGroundBounds === null).length,
    },
    islands: islandIds.map(id => {
      const own = rows.filter(row => row.descriptor.island === id);
      return { id, groundRings: islandExtents.get(id) ?? null, coverageCount: own.length, coveragePlacements: bounds(own.map(row => row.placement.at)), outsideOwnIslandGroundBounds: own.filter(row => row.insideOwnIslandGroundBounds === false).length };
    }),
    limits: [
      'Bounds use actual cell-ground rings before the canvas coast/shore geometry treatment; a bounding-box overlap is not polygon containment, shoreline clearance or tree collision proof.',
      'The height comparison checks the shipped placement binding to landHeight. It does not claim equality to every locally shore-deformed ground vertex or mesh footprint.',
      'No glTF loading or GPU mesh construction is performed. Loaded asset geometry, merged mesh visibility and appearance still require the actual browser capture.',
      'No app clock, renderer frame loop, camera, scene input or payload is changed. No historical growth helper is used.',
      'Diagnostic fields are observations, not a gate verdict, performance result, browser limitation or owner appearance attestation.',
    ],
    rows,
  };
} finally {
  await unregister();
}
checkIdentity();
if (hash(readFileSync(path.join(capture, 'after-rest-scene.json'))) !== hash(sceneBytes)) throw Error('Captured scene changed during probe');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
