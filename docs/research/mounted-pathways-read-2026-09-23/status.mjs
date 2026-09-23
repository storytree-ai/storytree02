// Capture-only supplement; run AFTER capture.mjs, under /tmp/storytree-heavy.lock.
// Classifies the actual mounted ground canvas, not DOM labels/props or an owner's visual verdict.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd(), out = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(path.resolve('apps/studio/package.json'))('@playwright/test');
const expected = JSON.parse(readFileSync(path.join(out, 'measurements.json'), 'utf8'));
const snapshotBytes = readFileSync(path.join(root, '.laneH/api-snapshot.json'));
const snapshotSha256 = createHash('sha256').update(snapshotBytes).digest('hex');
const payloads = new Map(JSON.parse(snapshotBytes).map(([url, response]) => [url, { ...response, body: Buffer.from(response.body, 'base64') }]));
if (!payloads.size) throw Error('Capture API snapshot is empty');
const base = process.env.LANEH_URL ?? 'http://127.0.0.1:5198';
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== root || health.code?.stale || health.db !== 'ok') throw Error('Wrong/stale server or unavailable live store');
const source = readFileSync('packages/forest-world-r3f/src/ForestWorldCanvas.tsx', 'utf8');
const palette = [...source.match(/const GROUND_COLOUR[^=]*= new Map\(\[([\s\S]*?)\]\)/)[1].matchAll(/\['([^']+)', '([^']+)'\]/g)].map(m => [m[1], m[2]]);
if (palette.length !== 6) throw Error('Ground palette changed; review the mask encoding');
const result = { takenAt: new Date().toISOString(), comparedTo: expected.takenAt, health, palette, views: {}, limitations: 'Ground-canvas pixels only; DOM labels and props are not included. Ground parcels carry capability state, so one island can contain several status colours; immutable capability status identities are checked separately. Proposed/building share one authored colour family. Exact mask codes exclude background, skirt rows >=6 and antialias mixtures. No camera reframe; no visual attestation.' };
result.apiSnapshot = { sha256: snapshotSha256, capturedAt: expected.takenAt, responses: payloads.size };
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
let missingGet;
try {
  const context = await browser.newContext({ viewport: expected.viewport, deviceScaleFactor: 1 });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const key = route.request().url();
    if (!payloads.has(key)) { missingGet = key; await route.abort('blockedbyclient'); await context.close(); return; }
    await route.fulfill(payloads.get(key));
  });
  for (const view of ['fit', 'working']) {
    const page = await context.newPage();
    await page.goto(`${base}/?landMount=1&sceneExport=1${view === 'fit' ? '&restingView=fit' : ''}#/tree`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"] canvas', { timeout: 180000 });
    await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled && window.__storytreeSceneExport && !document.querySelector(".tree-wrap[data-cache-provisional='true']"), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    result.views[view] = await page.evaluate(async ({ root, palette, wanted }) => {
      const source = await (await fetch(`/@fs${root}/packages/forest-world-r3f/src/ForestWorldCanvas.tsx`)).text();
      const fiberUrl = source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
      if (!fiberUrl) throw Error('Cannot resolve mounted R3F instance');
      const fiber = await import(fiberUrl), canvas = document.querySelector('[data-testid="land-mount"] canvas');
      const s = fiber._roots.get(canvas)?.store.getState();
      if (!s) throw Error('Mounted canvas has no R3F root');
      const three = await import(`/@fs${root}/packages/forest-world-r3f/node_modules/three/build/three.module.js`);
      const { nearestReadStatus, fullReaderTable, familyKeyOf } = await import(`/@fs${root}/packages/forest-world-r3f/harness/status-truth.ts`);
      const { SHIPPED_GROUND_COLOUR } = await import(`/@fs${root}/packages/forest-world-r3f/harness/shipped-baseline.ts`);
      if (JSON.stringify([...SHIPPED_GROUND_COLOUR]) !== JSON.stringify(palette)) throw Error('Reader palette disagrees with mounted source');
      const identity = () => {
        const b = window.__storytreeSceneExport, parcels = [], territories = [];
        const walk = n => { if (n.kind === 'parcel') parcels.push({ id: n.id, status: n.status }); if (n.kind === 'territory') territories.push({ id: n.id, status: n.status }); for (const c of n.children ?? []) walk(c); }; walk(b.scene);
        return { parcels: parcels.sort((a, b) => a.id.localeCompare(b.id)), territories, camera: document.querySelector('.world-camera').getAttribute('transform'), world: b.world, trails: b.trails };
      };
      const reference = Object.fromEntries(Object.keys(identity()).map(k => [k, wanted.identity[k]]));
      const assertSame = () => { const current = identity(); const drift = Object.keys(reference).filter(k => JSON.stringify(reference[k]) !== JSON.stringify(current[k])); if (drift.length) throw Error(`Refusing comparison: live ${drift.join(', ')} differs from measurements.json; recapture all evidence together`); };
      assertSame(); document.getAnimations().forEach(a => a.pause());
      const paths = [], grounds = [], other = [];
      s.scene.traverse(o => { if (o.isLine2) paths.push({ object: o, visible: o.visible }); else if (o.material?.uniforms?.uWearMix) grounds.push(o); else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) other.push(o.type); });
      if (!paths.length || grounds.length !== 1 || other.length) throw Error(`Unexpected mounted content: ${paths.length} roads, ${grounds.length} grounds, ${other.join(',')}`);
      const ground = grounds[0], mix = ground.material.uniforms.uWearMix.value, gl = s.gl.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const debug = gl.getExtension('WEBGL_debug_renderer_info'), renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      if (/swiftshader|llvmpipe|software/i.test(renderer) || width !== wanted.buffer.width || height !== wanted.buffer.height) throw Error('Renderer/buffer disagrees with capture');
      const bounds = new three.Box3().setFromObject(ground), size = bounds.getSize(new three.Vector3());
      const read = scene => { s.gl.render(scene, s.camera); const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
      const frames = {}, settleReads = {};
      for (const on of [false, true]) {
        for (const p of paths) p.object.visible = on && p.visible; ground.material.uniforms.uWearMix.value = on ? mix : 0;
        let previous = read(s.scene), stable = false, attempts = 0;
        while (!stable && attempts++ < 20) { await new Promise(r => setTimeout(r, 250)); const next = read(s.scene); stable = next.every((v, i) => v === previous[i]); previous = next; }
        if (!stable) throw Error('Mounted ground did not settle to identical readbacks');
        assertSame(); frames[on ? 'on' : 'off'] = previous; settleReads[on ? 'on' : 'off'] = attempts + 1;
      }
      // Native rAF, with decorative DOM animations running; no Playwright clock is installed.
      document.getAnimations().forEach(a => a.play()); const idle = [];
      for (let run = 1; run <= 2; run++) for (const on of [false, true]) {
        for (const p of paths) p.object.visible = on && p.visible; ground.material.uniforms.uWearMix.value = on ? mix : 0; s.gl.render(s.scene, s.camera);
        const deltas = await new Promise(resolve => { const values = []; let last; const step = t => { if (last !== undefined) values.push(t - last); last = t; if (values.length < 180) requestAnimationFrame(step); else resolve(values); }; requestAnimationFrame(step); });
        if (document.hidden) throw Error('Native cadence sampled a hidden page');
        idle.push({ run, arm: on ? 'on' : 'off', deltas, drawCalls: s.gl.info.render.calls, triangles: s.gl.info.render.triangles }); assertSame();
      }
      document.getAnimations().forEach(a => a.pause());
      // Binary RGB cube vertices: a mixture cannot impersonate another accepted status code.
      const codes = palette.map((_, i) => [((i + 1) & 1) * 255, (((i + 1) >> 1) & 1) * 255, (((i + 1) >> 2) & 1) * 255]);
      const material = new three.ShaderMaterial({ side: ground.material.side, toneMapped: false, vertexShader: 'attribute float statusIndex; varying float row; void main(){row=statusIndex;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: `varying float row; void main(){vec3 c=vec3(0.0); ${codes.map((c, i) => `if(abs(row-${i}.0)<0.01)c=vec3(${c.map(v => v ? '1.0' : '0.0').join(',')});`).join(' ')} gl_FragColor=vec4(c,1.0);}` });
      const maskScene = new three.Scene(), mesh = new three.Mesh(ground.geometry, material); mesh.matrixAutoUpdate = false; mesh.matrix.copy(ground.matrixWorld); maskScene.add(mesh);
      const clear = s.gl.getClearColor(new three.Color()), alpha = s.gl.getClearAlpha(); s.gl.setClearColor(0, 0); const mask = read(maskScene); s.gl.setClearColor(clear, alpha); material.dispose();
      for (const p of paths) p.object.visible = p.visible; ground.material.uniforms.uWearMix.value = mix; read(s.scene); assertSame();
      const table = fullReaderTable(), cache = new Map(), families = [...new Set(palette.map(([st]) => familyKeyOf(st)))];
      const classify = (pixels, i) => { const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]; if (!cache.has(key)) cache.set(key, familyKeyOf(nearestReadStatus({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }, table))); return cache.get(key); };
      const counts = Object.fromEntries(families.map(f => [f, { pixels: 0, off: { own: 0, misread: 0, votes: {} }, on: { own: 0, misread: 0, votes: {} }, changedRead: 0, changedRgb: 0, changes: {} }]));
      let included = 0;
      for (let i = 0; i < mask.length; i += 4) {
        if (mask[i + 3] !== 255 || frames.off[i + 3] !== 255 || frames.on[i + 3] !== 255) continue;
        const row = codes.findIndex(c => c[0] === mask[i] && c[1] === mask[i + 1] && c[2] === mask[i + 2]); if (row < 0) continue;
        const own = familyKeyOf(palette[row][0]), tally = counts[own], off = classify(frames.off, i), on = classify(frames.on, i); tally.pixels++; included++;
        for (const [arm, readFamily] of [['off', off], ['on', on]]) { tally[arm][readFamily === own ? 'own' : 'misread']++; tally[arm].votes[readFamily] = (tally[arm].votes[readFamily] ?? 0) + 1; }
        if (off !== on) { tally.changedRead++; const transition = `${off}->${on}`; tally.changes[transition] = (tally.changes[transition] ?? 0) + 1; }
        if ([0, 1, 2].some(c => frames.off[i + c] !== frames.on[i + c])) tally.changedRgb++;
      }
      if (included === 0) throw Error('No unambiguous ground pixels were attributed; refusing an empty status measurement');
      for (const t of Object.values(counts)) for (const arm of ['off', 'on']) t[arm].ownShare = t.pixels ? t[arm].own / t.pixels : null;
      const rects = new Map();
      for (const el of document.querySelectorAll('svg.world-scene [data-story-id]')) {
        const r = el.getBoundingClientRect(), id = el.getAttribute('data-story-id'); if (!r.width || !r.height) continue;
        const b = rects.get(id) ?? { id, left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, nodes: 0 };
        b.left = Math.min(b.left, r.left); b.top = Math.min(b.top, r.top); b.right = Math.max(b.right, r.right); b.bottom = Math.max(b.bottom, r.bottom); b.nodes++; rects.set(id, b);
      }
      return { renderer, parcelCount: identity().parcels.length, identityMatches: true, camera: identity().camera, buffer: { width, height }, groundBounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray(), axes: 'world X,Y,Z; Y is elevation, X/Z are ground plane' }, settleReads, idle, includedPixels: included, excludedPixels: width * height - included, families: counts, visibleStoryRects: [...rects.values()].filter(r => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) };
    }, { root, palette, wanted: expected.views[view].setup });
    console.log(`${view}: ${result.views[view].includedPixels} attributed ground pixels`); await page.close();
  }
  writeFileSync(path.join(out, 'status-measurements.json'), JSON.stringify(result, null, 2) + '\n');
} catch (error) { throw missingGet ? Error(`Capture API snapshot has no GET response for ${missingGet}; refusing live fallback`) : error; }
finally { await browser.close(); }
