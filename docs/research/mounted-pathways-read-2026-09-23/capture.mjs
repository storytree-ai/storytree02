// Capture-only instrument. Run from repository root under /tmp/storytree-heavy.lock.
// No product source or URL contract is changed. The off arm suppresses Line2 ribbons and
// uWearMix in the SAME mounted Three scene. It retains wear-shader computation: the timing
// difference is draw suppression, not the cost of deleting the whole pathway implementation.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const root = process.cwd();
const out = path.dirname(new URL(import.meta.url).pathname);
const base = process.env.LANEH_URL ?? 'http://127.0.0.1:5198';
const viewport = { width: 2560, height: 1600 };
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== root || health.code?.stale || health.db !== 'ok') throw Error('Wrong/stale server or unavailable live store');
const machine = () => ({ at: new Date().toISOString(), load: execFileSync('cat', ['/proc/loadavg'], {encoding:'utf8'}).trim(), cpu: execFileSync('vmstat',['1','3'],{encoding:'utf8'}).trim(), gpu: execFileSync('nvidia-smi',['--query-gpu=name,utilization.gpu,utilization.memory,memory.used,temperature.gpu,clocks.current.graphics','--format=csv,noheader'],{encoding:'utf8'}).trim() });
const result = { takenAt: new Date().toISOString(), health, viewport, before: machine(), controls: 'Same scene: Line2.visible=false and uWearMix=0; all other layers retained', views: {}, timing: [] };
mkdirSync(out, { recursive: true });
mkdirSync(path.join(root,'.laneH'), { recursive: true });
const browser = await chromium.launch({ headless:true, args:['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist'] });
const payloads = new Map();
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor:1 });
  // Reuse each first live GET response throughout the experiment; record the capture time.
  // This is today's live corpus, held constant across views/arms, not a synthetic fixture.
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const key = route.request().url();
    if (!payloads.has(key)) {
      const response = await route.fetch();
      payloads.set(key, { status:response.status(), headers:response.headers(), body:await response.body() });
      writeFileSync(path.join(root,'.laneH/api-snapshot.json'),JSON.stringify([...payloads].map(([url,v])=>[url,{...v,body:v.body.toString('base64')}] )));
    }
    await route.fulfill(payloads.get(key));
  });
  const pages = {};
  for (const view of ['fit','working']) {
    const page = await context.newPage(); pages[view] = page;
    page.on('pageerror', e => { throw Error(`${view}: ${e.message}`); });
    const url = `${base}/?landMount=1&sceneExport=1${view==='fit'?'&restingView=fit':''}#/tree`;
    console.log(`loading ${view}`);
    await page.goto(url,{waitUntil:'load',timeout:180000});
    await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"] canvas',{timeout:180000});
    await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled && window.__storytreeSceneExport && !document.querySelector(".tree-wrap[data-cache-provisional='true']"),null,{timeout:120000});
    await page.waitForTimeout(3000);
    const setup = await page.evaluate(async root => {
      const source = await (await fetch(`/@fs${root}/packages/forest-world-r3f/src/ForestWorldCanvas.tsx`)).text();
      const fiberUrl = source.match(/from ["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
      if (!fiberUrl) throw Error('Cannot resolve the mounted R3F instance');
      const fiber = await import(fiberUrl);
      const canvas = document.querySelector('[data-testid="land-mount"] canvas');
      const store = fiber._roots.get(canvas)?.store;
      if (!store) throw Error('Mounted canvas has no R3F root');
      const s = store.getState();
      const paths = [], grounds = [];
      s.scene.traverse(o => { if (o.isLine2) paths.push({object:o, visible:o.visible}); if(o.material?.uniforms?.uWearMix) grounds.push({object:o, material:o.material, mix:o.material.uniforms.uWearMix.value}); });
      if (!paths.length || grounds.length !== 1) throw Error(`Empty/ambiguous control: ${paths.length} paths, ${grounds.length} ground meshes`);
      const gl = s.gl.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (/swiftshader|llvmpipe|software/i.test(renderer)) throw Error(`Software renderer: ${renderer}`);
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) throw Error('No GPU clock');
      const identity = () => {
        const b = window.__storytreeSceneExport;
        const parcels = [], territories = [];
        const walk = n => { if(n.kind==='parcel') parcels.push({id:n.id,status:n.status}); if(n.kind==='territory') territories.push({id:n.id,status:n.status}); for(const ch of n.children??[]) walk(ch); };
        walk(b.scene);
        const svg = document.querySelector('svg.world-scene');
        const edges = [...svg.querySelectorAll('[data-edges]')].map(e=>e.getAttribute('data-edges')).sort();
        return { world:b.world, trails:b.trails, parcels:parcels.sort((a,b)=>a.id.localeCompare(b.id)), territories, edges, nameplates:svg.querySelectorAll('.world-plate-bg').length, flora:svg.querySelectorAll('.garden-flora').length, camera:document.querySelector('.world-camera').getAttribute('transform'), mount:document.querySelector('[data-testid="land-mount"]').dataset.state, svgTrailOpacity:getComputedStyle(svg.querySelector('.trail-net')).opacity, svgFocusOpacity:svg.querySelector('.trail-edges')?getComputedStyle(svg.querySelector('.trail-edges')).opacity:null };
      };
      window.laneH = { store, s, paths, grounds, gl, ext, identity,
        toggle(on) { for(const p of paths) p.object.visible=on&&p.visible; for(const g of grounds) g.material.uniforms.uWearMix.value=on?g.mix:0; s.gl.render(s.scene,s.camera); },
        async gpu(batch=30) { const query=gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT,query); for(let i=0;i<batch;i++) s.gl.render(s.scene,s.camera); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush(); let tries=0; while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&tries++<300) await new Promise(r=>setTimeout(r,5)); const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT); const available=gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE); const gpuMs=available&&!disjoint?gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6/batch:null; gl.deleteQuery(query); return {gpuMs,disjoint,available,drawCalls:s.gl.info.render.calls,triangles:s.gl.info.render.triangles,hidden:document.hidden}; },
      };
      return {renderer,paths:paths.length,wearMix:grounds[0].mix,buffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight},identity:identity()};
    }, root);
    result.views[view] = {url,setup,arms:{}};
    // Pause decorative loops for the stills only. Identity is asserted before and after.
    await page.clock.install({ time: new Date() });
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.evaluate(()=>document.getAnimations().forEach(a=>a.pause()));
    const frozenSvg = await page.locator('svg.world-scene').evaluate(e=>e.outerHTML);
    for(const on of [false,true]) {
      const arm=on?'on':'off';
      const state=await page.evaluate(on=>{laneH.toggle(on);return laneH.identity();},on);
      if(JSON.stringify(state)!==JSON.stringify(setup.identity)) throw Error(`${view}/${arm}: scene/camera/status changed`);
      await page.screenshot({path:path.join(out,`${view}-${arm}.png`)});
      if(await page.locator('svg.world-scene').evaluate(e=>e.outerHTML)!==frozenSvg) throw Error(`${view}/${arm}: foreground changed during stills`);
      result.views[view].arms[arm]={identity:state};
    }
    result.views[view].frozenForegroundEqual = true;
    await page.clock.resume();
    await page.evaluate(()=>document.getAnimations().forEach(a=>a.play()));
    writeFileSync(path.join(out,`${view}-scene.json`),JSON.stringify(await page.evaluate(()=>window.__storytreeSceneExport)));
    console.log(`${view}: ${setup.paths} ribbons, ${setup.identity.parcels.length} capability parcels`);
  }
  // Prime each exact configuration with completed GPU-clock batches before recording.
  for(let warm=0;warm<6;warm++) for(const view of ['fit','working']) {
    await pages[view].bringToFront();
    for(const on of [false,true]) await pages[view].evaluate(async on=>{laneH.toggle(on);await laneH.gpu();},on);
  }
  // Two independent sweeps, interleaved arms, five GPU batches per row per sweep.
  for(let run=1;run<=2;run++) for(let repeat=1;repeat<=5;repeat++) for(const view of ['fit','working']) {
    const page=pages[view]; await page.bringToFront();
    for(const on of (repeat%2?[false,true]:[true,false])) {
      const arm=on?'on':'off';
      await page.evaluate(async on=>{laneH.toggle(on);for(let i=0;i<5;i++)laneH.s.gl.render(laneH.s.scene,laneH.s.camera);},on);
      const sample=await page.evaluate(()=>laneH.gpu());
      if(sample.hidden||sample.gpuMs===null) throw Error(`Untimed/hidden ${view}/${arm}`);
      result.timing.push({run,repeat,view,arm,...sample});
    }
    console.log(`GPU run ${run} repeat ${repeat} ${view}`);
  }
  // Native browser cadence is measured by status.mjs in pages without an installed clock.
  result.after=machine();
  writeFileSync(path.join(root,'.laneH/api-snapshot.json'),JSON.stringify([...payloads].map(([url,v])=>[url,{...v,body:v.body.toString('base64')}] )));
  result.apiResponses=[...payloads.entries()].map(([url,v])=>({url,status:v.status,bytes:v.body.length}));
  writeFileSync(path.join(out,'measurements.json'),JSON.stringify(result,null,2)+'\n');
  console.log('Capture and repeated measurements complete');
} finally { await browser.close(); }
