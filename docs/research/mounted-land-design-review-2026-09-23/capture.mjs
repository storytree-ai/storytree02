// Run from repository root under /tmp/storytree-heavy.lock. Real browser, one live API snapshot.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANEI_URL || 'http://127.0.0.1:5199';
const phase = process.argv[2] || 'before';
const out = path.dirname(new URL(import.meta.url).pathname);
const privateSnapshot = '/tmp/laneI-api-snapshot.json';
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== process.cwd() || health.code?.stale || health.store !== 'pg' || health.db !== 'ok') throw Error('Wrong/stale server or unavailable live store');
const payloads = new Map(existsSync(privateSnapshot) ? JSON.parse(readFileSync(privateSnapshot,'utf8')).map(([k,v])=>[k,{...v,body:Buffer.from(v.body,'base64')}]) : []);
if (phase !== 'before' && !payloads.size) throw Error('After capture needs original live snapshot');
const save = () => writeFileSync(privateSnapshot, JSON.stringify([...payloads].map(([k,v])=>[k,{...v,body:v.body.toString('base64')}])));
const browser = await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
const result = {at:new Date().toISOString(),health,phase,viewport:{width:1800,height:1100},views:{},errors:[]};
mkdirSync(path.join(out,phase),{recursive:true});
try {
 const context=await browser.newContext({viewport:result.viewport,deviceScaleFactor:1});
 const pending=new Map();
 await context.route('**/api/**',async route=>{
  if(route.request().method()!=='GET') return route.continue();
  const key=route.request().url();
  if(!payloads.has(key)) {
   if(!pending.has(key)) pending.set(key,(async()=>{const r=await route.fetch();payloads.set(key,{status:r.status(),headers:r.headers(),body:await r.body()});save();})());
   await pending.get(key);
  }
  await route.fulfill(payloads.get(key));
 });
 async function settled(page) {
  await page.waitForFunction(()=>window.__storytreeMotionSettled?.().settled && window.__storytreeSceneExport && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'),null,{timeout:120000});
  await page.waitForTimeout(700);
 }
 async function capture(page,name) {
  await settled(page);
  await page.evaluate(()=>document.getAnimations().forEach(a=>a.pause()));
  result.views[name]=await page.evaluate(()=>({camera:document.querySelector('.world-camera').getAttribute('transform'),labels:[...document.querySelectorAll('.world-plate')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),scene:window.__storytreeSceneExport,mount:document.querySelector('[data-testid="land-mount"]')?.dataset.state,counts:{stories:document.querySelectorAll('.world-plate').length,parcels:document.querySelectorAll('[data-cap-id]').length,edges:document.querySelectorAll('[data-edges]').length},ground:document.querySelector('.relaxed-land')?.outerHTML.slice(0,400),html:document.querySelector('.world-pan-layer').style.transform}));
  await page.screenshot({path:path.join(out,phase,`${name}.png`)});
  console.log('captured',name,result.views[name].camera);
 }
 async function center(page,id) {
  const plate=page.locator('.world-plate-id').filter({hasText:new RegExp(`^${id}$`)}).first();
  for(let i=0;i<12;i++) {
   const b=await plate.boundingBox(); if(!b) throw Error(`Missing ${id}`);
   const dx=900-b.x-b.width/2,dy=610-b.y-b.height/2;
   if(Math.abs(dx)<2&&Math.abs(dy)<2)break;
   await page.mouse.move(900,550);await page.mouse.down();await page.mouse.move(900+Math.max(-600,Math.min(600,dx)),550+Math.max(-400,Math.min(400,dy)),{steps:8});await page.mouse.up();await page.waitForTimeout(150);
  }
 }
 const arms = phase === 'inspect' ? [['props','&landMount=1&landMountProps=1']] : [['flat',''],['mount','&landMount=1'],['props','&landMount=1&landMountProps=1']];
 for(const [arm,query] of arms) {
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(`${arm}: ${e.message}`));
  await page.goto(`${base}/?sceneExport=1${query}#/tree`,{waitUntil:'load',timeout:180000});
  if(arm!=='flat')await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"] canvas',{timeout:180000});
  await capture(page,`${arm}-opening`);
  await page.goto(`${base}/?sceneExport=1&restingView=fit${query}#/tree`,{waitUntil:'load',timeout:180000});
  if(arm!=='flat')await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"] canvas',{timeout:180000});
  await capture(page,`${arm}-fit`);
  await center(page,'library');await page.mouse.move(900,510);
  for(let i=0;i<(phase==='inspect'?23:13);i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(100);}
  for(const id of ['library','drive-machinery','website-experience','storage-protocol','proof-protocol','website']) {
   await center(page,id);await capture(page,`${arm}-${id}`);
  }
  // Explicit native keyboard pan verifies the retained member camera control.
  await page.locator('.world-viewport').focus();await page.keyboard.press('ArrowRight');
  await capture(page,`${arm}-panned`);
  if(arm==='mount') {await page.getByText('LEGEND',{exact:false}).first().click().catch(()=>{});await capture(page,`${arm}-legend`);}
  if(phase==='inspect') {
   await center(page,'library');await capture(page,'diagnostic-baseline');
   await page.addStyleTag({content:'.has-land-mount .hex-coast { opacity:0; }'});
   await capture(page,'diagnostic-no-hex');
   await page.addStyleTag({content:'.has-land-mount .baked-art:has(.veg-track-tree), .has-land-mount use[href^="#veg-hero-autumn-tree-"], .has-land-mount .story-tree { opacity:0; }'});
   await capture(page,'diagnostic-no-hex-or-hero');
   result.heroProbe=await page.locator('.world-scene').evaluate(svg=>[...svg.querySelectorAll('.baked-art')].slice(0,3).map(e=>e.outerHTML.slice(0,700)));
  }
  await page.close();
 }
 save();result.snapshotSha256=createHash('sha256').update(readFileSync(privateSnapshot)).digest('hex');
 for(const value of Object.values(result.views)) {
  const scene=value.scene;delete value.scene;value.world=scene.world;value.statuses=[];
  const walk=n=>{if(['territory','parcel'].includes(n.kind))value.statuses.push({kind:n.kind,id:n.id,status:n.status});for(const ch of n.children??[])walk(ch);};walk(scene.scene);
 }
 writeFileSync(path.join(out,`${phase}.json`),JSON.stringify(result,null,2)+'\n');
 if(result.errors.length)throw Error(result.errors.join('\n'));
} finally {await browser.close();}
