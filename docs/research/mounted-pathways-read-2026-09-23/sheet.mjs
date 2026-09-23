// Run from repository root under the shared heavy lock, after capture.mjs.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const out = path.dirname(new URL(import.meta.url).pathname);
const img = name => name;
const photos = Object.fromEntries(['fit','working'].flatMap(v=>['off','on'].map(a=>[`${v}-${a}`,img(`${v}-${a}.png`)])));
const measurements = JSON.parse(readFileSync(path.join(out,'measurements.json'),'utf8'));
const inventory = measurements.views.fit.setup;
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#18221e;color:#f6f2e8;font:24px system-ui}h1{font-size:37px;margin:0 0 8px}p{margin:0 0 22px;color:#ced8d0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}figure{margin:0;background:#26362e;overflow:hidden}figcaption{padding:12px 16px;font-weight:600}img{display:block;width:100%}.note{padding-top:18px;font-size:21px}
</style><h1>The mounted pathways — real forest, 23 September 2026</h1><p>Left: roads and worn trace suppressed. Right: the mounted layer as shipped. Same data, terrain, labels and camera within each pair.</p><div class="grid">
${['fit','working'].flatMap(v=>['off','on'].map(a=>`<figure><figcaption>${v==='fit'?'FIT · whole forest':'WORKING · Studio’s actual opening zoom'} — pathways ${a.toUpperCase()}</figcaption><img src="${photos[`${v}-${a}`]}"></figure>`)).join('')}
</div><p class="note">${inventory.identity.world.islands.length} islands · ${inventory.identity.parcels.length} capability parcels · 95 dependency edges · ${inventory.paths} ribbons. Original captures: 2560 × 1600. Shown at reduced size; the detail sheet enlarges the same working-view pixels.</p>`;
writeFileSync(path.join(out,'sheet.html'),html);
const browser=await chromium.launch({headless:true});
try {const p=await browser.newPage({viewport:{width:2616,height:1900},deviceScaleFactor:1});await p.goto(new URL('./sheet.html',import.meta.url).href);await p.locator('img').evaluateAll(els=>Promise.all(els.map(e=>e.decode())));await p.screenshot({path:path.join(out,'sheet.png'),fullPage:true});}finally{await browser.close();}
const status=JSON.parse(readFileSync(path.join(out,'status-measurements.json'),'utf8'));
const rects=status.views.working.visibleStoryRects;
const scene=JSON.parse(readFileSync(path.join(out,'working-scene.json'),'utf8')).scene;
const edges=new Set();
const walk=n=>{if(n.kind==='trail-fill')for(const e of (n.edges??'').split(','))if(e.includes('->'))edges.add(e);for(const c of n.children??[])walk(c);};walk(scene);
const degree=id=>[...edges].filter(e=>e.split('->').includes(id)).length;
const picks=[{id:'library',label:`PATH-HEAVY · library · ${degree('library')} dependencies`},{id:'art-factory',label:`PATH-LIGHT · art-factory · ${degree('art-factory')} dependency`}];
const panels=picks.flatMap(p=>{
  const r=rects.find(r=>r.id===p.id);if(!r)throw Error(`No visible rectangle for ${p.id}`);
  const width=620,height=420;
  const x=Math.max(0,Math.min(2560-width,(r.left+r.right-width)/2));
  const y=Math.max(0,Math.min(1600-height,(r.top+r.bottom-height)/2));
  return ['off','on'].map(a=>`<figure><figcaption>${p.label} — ${a.toUpperCase()}</figcaption><div class="crop"><img src="working-${a}.png" style="left:${-x*1.6}px;top:${-y*1.6}px"></div></figure>`);
});
const detail=`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#18221e;color:#f6f2e8;font:23px system-ui}h1{font-size:34px;margin:0 0 8px}p{margin:0 0 20px;color:#ced8d0}.grid{display:grid;grid-template-columns:992px 992px;gap:12px}figure{margin:0;background:#26362e}figcaption{padding:12px 16px}.crop{position:relative;width:992px;height:672px;overflow:hidden}.crop img{position:absolute;width:4096px;height:2560px;max-width:none}</style><h1>The island crossings, enlarged from the working-view captures</h1><p>Same pixels and same zoom as the main sheet, enlarged 1.6×. Left: pathway layer off. Right: on.</p><div class="grid">${panels.join('')}</div>`;
writeFileSync(path.join(out,'detail.html'),detail);
const b2=await chromium.launch({headless:true});
try{const p=await b2.newPage({viewport:{width:2044,height:1620},deviceScaleFactor:1});await p.goto(new URL('./detail.html',import.meta.url).href);await p.locator('img').evaluateAll(els=>Promise.all(els.map(e=>e.decode())));await p.screenshot({path:path.join(out,'detail.png'),fullPage:true});}finally{await b2.close();}
console.log('sheet.png and detail.png rendered');
