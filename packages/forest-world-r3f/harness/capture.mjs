// capture.mjs — drives the live-render experiment's evidence page in headless Chromium,
// photographs it, and reads DELIVERED PIXELS back out of the canvases to prove the
// locked-palette claim on a real rasteriser rather than on the TypeScript that fed it.
//
// WHY PLAYWRIGHT AND NOT THE BROWSER PANE. `@playwright/test` is already an installed dev
// dependency of `apps/studio` with its Chromium cached on this box, and two existing repo
// scripts already drive it exactly this way (`apps/studio/scripts/comparative-capture.mjs`,
// `.../measure-camera-rasterisation.mjs`). The Browser pane serves the PRIMARY checkout,
// so from a worktree it photographs the wrong tree.
//
// THE HONEST LIMIT, STATED HERE BECAUSE IT BOUNDS ONE OF THE THREE QUESTIONS. Headless
// Chromium on this machine renders WebGL through ANGLE-on-SwiftShader — measured, not
// assumed: the renderer string comes back `SwiftShader driver` on every launch. That is
// SOFTWARE rasterisation. It delivers the same PIXELS a GPU would, so the palette proof
// and the detail comparison are sound; it says NOTHING about frame cost on the Adreno
// X1-85, so the ADR-0380 D2 hardware-floor question CANNOT be answered from here and is
// not answered below. Frame timings are recorded as a RELATIVE instrument only and are
// labelled as such in the report. Reporting a SwiftShader frame time as a D2 verdict would
// be exactly the class of error this arc has had to correct five times.
//
// HOW IT IS CALLED. Every knob is an environment variable, because one script serves both
// evidence pages and a second copy of the readback is how two instruments quietly diverge:
//
//   ST_HARNESS_URL           the page to photograph (default: the plant row on :5184)
//   ST_OUT_DIR               where the pictures and the report go, REPO-ROOT-relative
//   ST_READ_ONLY             run the WHOLE audit and write NOTHING (1/true/yes/on; unset = write).
//                            For the commonest reason to run this script — "did my change break the
//                            island audit?" — where the verdict is wanted and the artefacts are not.
//                            Every run now also PRINTS what it wrote, or would have written, because
//                            a run that rewrites committed evidence and says nothing about it is how
//                            22 files of an unrelated pass once nearly entered a commit. See
//                            `capture-output.ts`, which also records what that friction got wrong.
//   ST_FULL_PAGE_NAME        filename for the whole-page screenshot
//   ST_PANEL_NAMES           comma-separated panel ids, each bound to the <section> carrying it as
//                            `data-st-panel` (unset: every authored panel — see capture-panels.ts)
//   ST_EXPECT_PROP_CANVASES  how many islands must have had their props verified (default 0)
//   ST_NAVIGATION_ALLOWANCE_MS  how long the page may take to reach `load` (default 180000 — a COLD
//                            vite needs far more than 30 s on a busy box; see capture-navigation.ts)
//
// HOW IT EXITS. 0 when every claim held. 75 when the allowance ran out while the dev server was still
// holding the page's module requests — a cold start, so run it again against the SAME server. 1 for
// every other refusal, a broken page and a server serving some other tree included.
//
// ⚠ IT PHOTOGRAPHS ONLY ITS OWN TREE. Every worktree's harness pins the same port, so a harness left
// running by another worktree answers this script's default URL — and until 2026-09-16 this script
// photographed ITS tree perfectly happily, a green that said nothing about your change (friction
// `capture-default-url-is-a-port-a-sibling-worktree-may-own`). The harness server now stamps the
// directory it serves on every response, and this script refuses, before it forms any verdict about
// the page, unless that directory is its own — as every harness driver now does, through
// `gotoServedTree`; `served-tree.ts` says why the directory alone decides.
// When it refuses, start the dev server from THIS worktree — `vite harness --port <free port>
// --strictPort` — and point `ST_HARNESS_URL` at it.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The authored palette comes from the SAME module the shader's GLSL ladder is generated
// from. A capture script holding its own copy of the palette would only ever prove that
// the two copies agree.
import { landPalette } from './palette-band.js';
// Which section becomes which evidence file. Pure, and proved in `capture-panels.test.ts` —
// a driver holding its own copy of that rule is how the positional zip survived unnoticed.
import { PANEL_ID_ATTRIBUTE, parseRequestedPanels, planPanelCaptures } from './capture-panels.js';
// Whether this run writes at all, and the line it prints about that. Pure, and proved in
// `capture-output.test.ts` — including a source guard over THIS file holding every write to the
// two helpers below, so a write added later cannot quietly escape the read-only fence.
import { READ_ONLY_ENV, describeWrites, parseReadOnly } from './capture-output.js';
// ...and the SHADOW half from the module that derives the shadow rung, for the same reason.
// The authored palette a shadowed land may emit is the closure over the shadow LADDER, so
// checking delivered pixels against `landPalette()` alone would condemn every shadowed pixel
// as off-palette — a refusal for the wrong reason, which is the failure mode this arc has
// paid for more than once. Both family tests below are the shadow-aware siblings for the
// same reason.
import {
  RENDERED_STATUSES,
  SHADOW_LADDER,
  SHADOW_RUNG,
  familyOnShadowLadder,
  familylessPaletteWithShadow,
  groundPaletteWithShadow,
  ladderAdmissibility,
  landPaletteWithShadow,
  liveCeilings,
  luma,
  luminanceOverlap,
  robustlyInadmissible,
  shadowRungEntries,
} from './shadow-ladder.js';
// THE PRESENCE FLOOR, imported for the same reason both of the above are: what an island is
// DECLARED to be built from is resolved here, from the canvas tag, inside this script's own
// module graph. An earlier sketch had the page stamp its own expectation onto the element in the
// style of `data-st-tag`; that would let the layer being audited decide whether it is audited,
// and a page that stopped drawing its props would very plausibly also stop declaring them.
import { checkPropPresence, describePresenceFailure } from './prop-presence.js';
// THE COLOUR-SPREAD BAND — ADR-0418 D4's replacement for the fence D3 lifted. Imported here for
// the same reason as everything above it: the declaration of what each canvas claims to be lives
// inside this script's own module graph, not on the page being audited.
import { checkColourSpread, describeSpreadFailure } from './colour-spread.js';
// THE NAVIGATION BOUNDARY — the bounded allowance the page load runs under, and the refusal that
// tells a COLD dev server from a BROKEN page when either wait ends early. In its own module for the
// reason every import above is: the rule is provable under `node:test`, and a driver carrying its
// own copy of a rule is how the rule and its proof drift apart.
import {
  NAVIGATION_ALLOWANCE_ENV,
  SETTLE_TIMEOUT_MS,
  explainLoadedPage,
  explainNavigationFailure,
  parseNavigationAllowance,
  watchNavigation,
} from './capture-navigation.js';
// THE SERVED TREE — which checkout the server answering the URL is serving, read off the stamp the
// harness config's server sets on every response, and the refusal when it is not this one. Its own
// module for the same reason, and because the SERVER half of the rule lives there too: the header the
// server writes and the header this script reads are one constant, not two copies. Every harness driver
// navigates through the same `gotoServedTree`, so the rule this script meets is the one they all meet.
import { describeServer, gotoServedTree } from './served-tree.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// The output directory is overridable so one capture script serves both evidence pages
// (the plant row and the island) without a second copy of the readback + refusal logic —
// this arc already carries three ~700-line compositor copies and a fork detector it had to
// build because nothing noticed they had diverged.
// Resolved against the REPO ROOT (three levels up from this harness), never `process.cwd()`
// — pnpm runs a package script from the PACKAGE directory, so a cwd-relative path quietly
// wrote the evidence to `packages/forest-world-r3f/docs/research/...` instead of the repo's.
// Kept as the caller's own spelling as well as the resolved path: the run REPORTS its output
// directory when it finishes, and what a reader can act on is the value they would set, not an
// absolute path with three `..` segments in the middle of it.
const OUT_SPEC = process.env['ST_OUT_DIR'] ?? 'docs/research/chapter2-live-render-2026-08-19';
const OUT = join(HERE, '../../..', OUT_SPEC);
const URL = process.env['ST_HARNESS_URL'] ?? 'http://localhost:5184/compare.html';

function fail(msg, code = 1) {
  console.error(`REFUSED: ${msg}`);
  process.exit(code);
}

// Parsed BEFORE the browser starts, so a mistyped allowance costs nothing to find out about.
const allowance = parseNavigationAllowance(process.env[NAVIGATION_ALLOWANCE_ENV]);
if (!allowance.ok) fail(allowance.refusal);

// --- the output seam: whether this run writes at all ----------------------------------------
//
// Parsed here for the reason stated one line up, and it matters more for this knob than for the
// allowance: a caller who sets ST_READ_ONLY has asked for their working tree to be left alone, so
// discovering a typo AFTER the run would mean discovering it from the 22 files it just wrote.
const readOnly = parseReadOnly(process.env[READ_ONLY_ENV]);
if (!readOnly.ok) fail(readOnly.refusal);
const READ_ONLY = readOnly.readOnly;

// EVERY WRITE IN THIS FILE GOES THROUGH ONE OF THESE TWO, and `capture-output.test.ts` holds that
// structurally rather than trusting it: the read-only fence is only worth as much as its least
// careful future edit, and the way this fails is a sixth write site added later that nobody routes.
//
// They record on BOTH paths. The file list is what the run reports at the end, so read-only can say
// what it suppressed and a writing run can say what it left in the tree — the half of the original
// complaint that a steerable output directory does not touch.
const written = [];

/** Photograph `target` into `file` under the output directory — or, read-only, just record it. */
async function shoot(target, file, options = {}) {
  written.push(file);
  if (READ_ONLY) return;
  await target.screenshot({ ...options, path: join(OUT, file) });
}

/** Write `contents` to `file` under the output directory — or, read-only, just record it. */
function emit(file, contents) {
  written.push(file);
  if (READ_ONLY) return;
  writeFileSync(join(OUT, file), contents);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
// Subscribed BEFORE the navigation, or the requests a cold server holds first — the document and
// the first modules — are exactly the ones never seen.
const network = watchNavigation(page);

// THE NAVIGATION RUNS UNDER A STATED, BOUNDED ALLOWANCE, never Playwright's unstated 30 s default.
// A vite serving this page for the first time answers nothing until it has scanned, pre-bundled and
// transformed the R3F/three graph, and with other sessions' gates on the box that is far past 30 s
// (88 s measured — the ladder is in `capture-navigation.ts`). What a failure MEANS is read off the
// network, never off the fact of a timeout: a cold server refuses with exit 75 (the same server, run
// again) and a broken page with exit 1. Every refusal here exits before `OUT` is created, so a failed
// navigation can never leave a partial evidence directory behind.
//
// AND ONLY THIS CHECKOUT'S TREE GETS PAST IT. Every worktree's harness answers on the same port, so a
// page that loaded proves only that SOME harness served it. `gotoServedTree` reads which off the stamp
// the server set, and refuses anything but this harness's own directory the moment `load` arrives —
// before the page is judged broken, settled or drawn, because every verdict below applies this tree's
// declarations to the pixels of whichever tree served the page. It judges the tree when the navigation
// FAILS too, whenever the document answered, so a cold, broken or stalled verdict is never written about
// a sibling worktree's page: what reaches the `catch` below failed on THIS tree, or on no server at all.
// `served-tree.ts` holds the rule, and why the directory alone decides.
let navigation;
try {
  navigation = await gotoServedTree(page, URL, { waitUntil: 'load', timeout: allowance.ms }, fail);
} catch (error) {
  const refusal = explainNavigationFailure({
    url: URL,
    phase: 'navigation',
    error,
    limitMs: allowance.ms,
    snapshot: network.snapshot(),
    consoleErrors,
  });
  fail(refusal.message, refusal.exitCode);
}

// A page `load` has already shown to be broken is refused NOW. The settled wait below could only end
// in a refusal for it, thirty seconds later and with less to say about why.
const brokenAtLoad = explainLoadedPage(URL, network.snapshot(), consoleErrors);
if (brokenAtLoad) fail(brokenAtLoad.message, brokenAtLoad.exitCode);

// Gate on the page's OWN settled signal, never a sleep — the same signal and the same 30 s as ever;
// only a settle that runs out is now explained instead of thrown.
try {
  await page.waitForFunction(() => window.__stExperimentSettled === true, null, { timeout: SETTLE_TIMEOUT_MS });
} catch (error) {
  const refusal = explainNavigationFailure({
    url: URL,
    phase: 'settle',
    error,
    limitMs: SETTLE_TIMEOUT_MS,
    snapshot: network.snapshot(),
    consoleErrors,
  });
  fail(refusal.message, refusal.exitCode);
}

if (consoleErrors.length) fail(`the page logged errors:\n  ${consoleErrors.join('\n  ')}`);

const renderer = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  if (!gl) return { ok: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    ok: true,
    version: gl.getParameter(gl.VERSION),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unavailable',
  };
});
if (!renderer.ok) fail('no WebGL context in the capture browser — nothing was rendered');

// --- the delivered-pixel readback -------------------------------------------------------
//
// Every canvas on the page, sampled through a 2D context so what is measured is the
// COMPOSITED result the eye sees, not the WebGL buffer before presentation.

const delivered = await page.evaluate(() => {
  const out = [];
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    const w = canvas.width;
    const h = canvas.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const counts = new Map();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Only fully-opaque pixels are the plant. An edge pixel blended against a
      // transparent clear colour is a COMPOSITING artefact, not a colour the shader
      // chose, and counting it would condemn the palette for the compositor's arithmetic.
      if (data[i + 3] !== 255) continue;
      opaque++;
      const hex =
        '#' +
        data[i].toString(16).padStart(2, '0') +
        data[i + 1].toString(16).padStart(2, '0') +
        data[i + 2].toString(16).padStart(2, '0');
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    // INTERIOR HOLES — a watertightness instrument for the land, REPORTED and deliberately
    // not thresholded.
    //
    // Once the ground stopped being one flat plane it became possible for two surfaces to
    // fail to meet, and a seam that fails to meet shows the page through it as a hairline.
    // That presents as a rendering artefact rather than as a geometry bug, so it gets
    // chased as one — this arc has lost time to exactly that class of thing twice.
    //
    // The measurement: flood-fill the TRUE exterior from the canvas border, then count the
    // transparent pixels the fill cannot reach. Those are inside the island. It is NOT a
    // pass/fail rung, because a legitimate silhouette pinches to a single pixel here and
    // there at low raster resolutions, and any tolerance chosen today would be a number
    // picked to make today's picture pass. THE REFERENCE IS THE FLAT CONTROL ON THE SAME
    // PAGE: it reads 0, so a defined panel reading a handful is rasterisation and one
    // reading hundreds is a torn seam.
    const clear = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) clear[p] = data[p * 4 + 3] === 255 ? 0 : 1;
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const p = stack.pop();
      if (seen[p] || !clear[p]) continue;
      seen[p] = 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    let holes = 0;
    for (let p = 0; p < w * h; p++) if (clear[p] && !seen[p]) holes++;
    out.push({
      w,
      h,
      opaque,
      holes,
      tag: canvas.dataset.stTag ?? null,
      colours: [...counts.entries()],
    });
  }
  return out;
});

if (delivered.length === 0) fail('the page drew no canvases at all');

// --- THE COLOUR-SPREAD BAND, RESOLVED FIRST because the palette tally depends on it ----------
//
// ADR-0418 D3 lifted ADR-0380 D6 fence 3 on this surface: a live render here need no longer stay
// banded to an authored palette. D4 committed to replacing the check that lift removes. This is
// where the replacement refuses; the reasoning, the design decision and the measured margin are
// in `colour-spread.ts`'s header and are not restated here.
//
// ⚠ WHAT THIS CHANGES FOR THE PALETTE REFUSAL, STATED PRECISELY BECAUSE IT IS THE ONE THING THAT
// MUST NOT DRIFT. Canvases declared `banded` are held to the off-palette refusal exactly as
// before, unchanged, and that is every canvas on every page this script drove until today.
// Canvases declared `continuous` are EXEMPT from it and held to the band instead — because on
// those the fence is already lifted by ADR-0418 D2/D3, and running an off-palette refusal over
// them is not a stricter check, it is a check that refuses the page for being what it is
// authorised to be. That is precisely why `grain.html` could not be audited by this script at
// all until now, which the crossing increment recorded as the consequence of the lift.
//
// The exemption is DECLARED, never inferred: `colour-spread.ts`'s manifest is hand-authored, and
// a tagged canvas it does not name is refused rather than skipped. So a page cannot acquire an
// exemption by drawing off-palette pixels — only by someone writing the declaration down.
const spread = checkColourSpread(delivered);
const exemptFromPalette = new Set(
  spread.canvases.filter((c) => c.regime === 'continuous').map((c) => c.tag),
);

const palette = new Set(landPaletteWithShadow());
// The pre-shadow closure, kept so the report can state the COST as a difference the reader
// can check rather than a number they have to take on trust.
const paletteBefore = new Set(landPalette());
let totalOpaque = 0;
let offPalette = 0;
let exemptOpaque = 0;
const offenders = new Map();
const distinct = new Set();

for (const c of delivered) {
  totalOpaque += c.opaque;
  // A continuous canvas still contributes its pixels to the page's opaque total and its colours
  // to the delivered set — both are facts about what was drawn. What it does not contribute to
  // is the off-palette TALLY, which is the only thing the exemption touches.
  const exempt = c.tag !== null && exemptFromPalette.has(c.tag);
  if (exempt) exemptOpaque += c.opaque;
  for (const [hex, n] of c.colours) {
    distinct.add(hex);
    if (exempt) continue;
    if (!palette.has(hex)) {
      offPalette += n;
      offenders.set(hex, (offenders.get(hex) ?? 0) + n);
    }
  }
}

// NON-VACUITY, PER CANVAS — and the global form of this check was NOT enough.
//
// The first version asserted only that the PAGE delivered enough pixels. It passed at
// 45,836 opaque pixels and printed PALETTE CLOSED while six panels were blank: the browser
// caps simultaneous WebGL contexts near sixteen and had silently LOST the oldest ones. A
// lost canvas contributes zero pixels and zero colours, so it can never break a palette
// check — it can only make one pass for the wrong reason. The page is now drawn through a
// single shared context, and this per-canvas floor is what keeps that fixed: every panel
// must show its own plants, or the run refuses.
const blank = [];
for (let i = 0; i < delivered.length; i++) {
  // The floor is deliberately LOW, because the failure it exists to catch is exact: a lost
  // WebGL context delivers precisely ZERO. The smallest legitimate panel here is an 18x3
  // sprite rung carrying 17 opaque pixels for three whole plants — that is not a defect,
  // it is the finding. An earlier draft set this floor at 20 and condemned those four
  // panels; the floor was wrong, not the panels, and raising a floor until real evidence
  // passes is how an instrument stops measuring anything.
  if (delivered[i].opaque < 5) blank.push(`#${i} (${delivered[i].w}x${delivered[i].h})`);
}
if (blank.length) {
  fail(
    `${blank.length} of ${delivered.length} canvases delivered essentially nothing: ` +
      `${blank.join(', ')}. A blank canvas cannot fail a palette check, so this run would ` +
      'have reported a clean closure it never tested.',
  );
}

if (totalOpaque < 5000) {
  fail(
    `only ${totalOpaque} opaque pixels were delivered across ${delivered.length} canvases; ` +
      'the palette result would be vacuously clean',
  );
}

// --- NON-VACUITY, PER PROP ---------------------------------------------------------------
//
// THE TWO FLOORS ABOVE ARE BLIND TO A PROP THAT STOPPED DRAWING, and that was measured rather
// than suspected. Two runs of this script either side of a real geometry change — every wilted
// flower head visibly re-posed on three panels — both reported `opaque px : 11250412`, identical
// to the digit, because every prop on this island is drawn over ground that is ALREADY OPAQUE.
// A prop can shrink, break, or vanish entirely without moving a number either floor reads.
//
// So this asks the histogram a different question: did each thing the island is DECLARED to be
// built from deliver any of its own colours. The palette is closed and every material is an
// authored token, so that question has an exact answer. See `prop-presence.ts` for why the
// declaration is hand-authored rather than read off the generator — a manifest derived from
// `buildDressing` would stop expecting a wall at the same moment the wall stopped being built.
//
// It is computed HERE so the verdict reaches `capture-report.json` and the console, and REFUSED
// at the very bottom of this file alongside the palette breach, for the reason recorded there:
// the pictures and the report are on disk by then, so a refusal still leaves the evidence needed
// to diagnose it.
const presence = checkPropPresence(delivered);

// AND THE INSTRUMENT'S OWN COVERAGE, which is the trap one level up. If the page's tags stopped
// resolving — renamed, or a dressed island added without a declaration — every check above would
// still run and find nothing to object to, and the run would go green having verified nothing
// about any prop. That is the exact failure this whole block exists to repair, arriving one level
// up. The caller declares how many islands must have been checked, the same way it already
// declares its panel names; `presence.checked` is printed on every run either way.
const expectPropCanvases = Number(process.env['ST_EXPECT_PROP_CANVASES'] ?? 0);

// --- frame timing: RELATIVE ONLY (see the header) ---------------------------------------

const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (++n < 40) requestAnimationFrame(tick);
        else resolve(deltas.slice(1));
      };
      requestAnimationFrame(tick);
    }),
);
const sorted = [...frames].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length / 2)];

// --- the pictures -------------------------------------------------------------------------

// Read-only creates no directory either: `mkdirSync` on a path that does not exist IS a write, and
// leaving an empty `docs/research/...` behind would be a smaller version of the same complaint.
if (!READ_ONLY) mkdirSync(OUT, { recursive: true });
await shoot(page, process.env['ST_FULL_PAGE_NAME'] ?? 'live-vs-sprite.png', { fullPage: true });

// PANEL FILENAMES BIND TO THE SECTION'S AUTHORED `data-st-panel`, never to its position.
//
// This used to zip `ST_PANEL_NAMES` against `page.$$('section')` by index, so inserting a
// section silently re-pointed every later filename at a different picture and the run still
// exited 0 (friction `capture-panel-names-bind-to-section-order`, measured on the island page
// 2026-08-20). The resolver lives in `capture-panels.ts` because it is pure and therefore
// provable under `node:test` without a browser; all this block does is read the attribute off
// the DOM and print the refusal. `ST_PANEL_NAMES` unset now means EVERY authored panel, which
// is the shape that cannot go stale.
const sections = await page.$$('section');
const sectionIds = [];
for (const [index, section] of sections.entries()) {
  sectionIds.push({ index, id: await section.getAttribute(PANEL_ID_ATTRIBUTE) });
}
const panelPlan = planPanelCaptures(sectionIds, parseRequestedPanels(process.env['ST_PANEL_NAMES']));
if (!panelPlan.ok) fail(`panel capture: ${panelPlan.refusal}`);
// THE LOOP STILL RUNS IN READ-ONLY, and so does the plan check above it. Both carry audit claims —
// a requested panel that is not on the page, two sections claiming one id — and a read-only run that
// skipped them would print the same green having checked strictly less. Only the write is skipped.
for (const capture of panelPlan.captures) {
  await shoot(sections[capture.index], capture.file);
}

// ONE FILE PER NAMED CANVAS, found by `data-st-tag` rather than by position.
//
// The tag is what makes the name survive the page moving: it travels with the canvas that
// carries it, so a page whose islands are tagged gets a set of files that stay correct however
// the page is reordered. The section screenshots above now bind the same way, through
// `data-st-panel` — this block was the pattern they were repaired to match.
//
// It is also what makes a WHOLE ISLAND its own artefact. A section shot is an island plus the
// prose around it, cropped to whatever the section happens to be; ADR-0392 D1 asks the owner
// to look at the island, and this is the file that is only that.
const tagged = await page.$$('canvas[data-st-tag]');
const seenTags = new Set();
for (const el of tagged) {
  const tag = await el.getAttribute('data-st-tag');
  if (!tag) continue;
  // A duplicated tag would have one file silently overwrite the other — the same class of
  // error as the positional names, arriving by a different route. Refuse instead.
  if (seenTags.has(tag)) fail(`two canvases share the tag ${JSON.stringify(tag)}`);
  seenTags.add(tag);
  // Same rule as the panel loop: the duplicate-tag refusal above is an audit claim, so the walk
  // happens on both paths and only the screenshot is conditional.
  await shoot(el, `island-${tag}.png`);
}

// --- the report ---------------------------------------------------------------------------

const report = {
  capturedFrom: URL,
  webgl: {
    version: renderer.version,
    renderer: renderer.renderer,
    // The single most important caveat in this file.
    isSoftware: /swiftshader|llvmpipe|software/i.test(String(renderer.renderer)),
    note:
      'Headless Chromium on this box rasterises WebGL through SwiftShader (software). ' +
      'Delivered COLOURS are therefore trustworthy and frame COSTS are not — the ADR-0380 ' +
      'D2 hardware-floor question is NOT answered by this run and needs the owner on real hardware.',
  },
  // The MEASURED delivered pixel count per panel, which is evidence in its own right and
  // does NOT agree with the `w * h * fill` arithmetic. A 4.92x3 shrub under the 50-degree
  // camera delivers about FIVE pixels at 1 px/unit, not the ~13 the box arithmetic
  // predicts, because the tilt foreshortens the height and a mound does not fill its box.
  // Both numbers are reported; neither is quietly replaced by the other.
  perPanel: delivered.map((c, i) => ({ i, w: c.w, h: c.h, opaque: c.opaque, holes: c.holes })),
  // WHICH SECTION EACH PANEL FILE ACTUALLY CAME FROM. A README cites these files by name, and
  // the whole point of the authored id is that the name keeps pointing at the same picture
  // when the page grows — so the binding is recorded here rather than left to be inferred from
  // the order the sections happened to be in on the day.
  panelFiles: panelPlan.captures.map((c) => ({ file: c.file, id: c.id, sectionIndex: c.index })),
  // PER NAMED ISLAND — the evidence that two directions differ in more than their captions.
  //
  // A page that offers a CHOICE has to be able to show that the things being chosen between
  // are actually different, and "they look different" is the claim under test rather than the
  // evidence for it. Distinct delivered colours and the delivered luminance spread are two
  // numbers a reader can check against the pictures: a direction that moves neither has moved
  // nothing, whatever its section says it does.
  //
  // Keyed by `data-st-tag`, never by position — see the tag-named screenshots above.
  perIsland: delivered
    .filter((c) => c.tag)
    .map((c) => {
      const onRung = new Set(shadowRungEntries());
      const px = [];
      let occluded = 0;
      for (const [hex, n] of c.colours) {
        if (onRung.has(hex)) occluded += n;
        const y = luma({
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16),
        });
        for (let k = 0; k < n; k++) px.push(y);
      }
      px.sort((a, b) => a - b);
      const q = (f) => (px.length ? Math.round(px[Math.floor(f * (px.length - 1))] * 10) / 10 : null);
      return {
        tag: c.tag,
        w: c.w,
        h: c.h,
        opaque: c.opaque,
        distinctColours: c.colours.length,
        // WHAT SHARE OF THE ISLAND IS ON THE OCCLUSION RUNG. A shadow reads because it sits
        // NEXT TO something lit; an island where most pixels are occluded has not gained a
        // shadow, it has been dimmed. So this is the number that tells the two apart, and it
        // is the one an eye is worst at estimating.
        occludedPixels: occluded,
        occludedShare: c.opaque ? Math.round((1000 * occluded) / c.opaque) / 10 : 0,
        luma: { p2: q(0.02), p50: q(0.5), p98: q(0.98) },
        // The spread is the number that says whether a direction gave the picture more to
        // work with. It is reported, not thresholded: a direction may legitimately narrow it.
        lumaSpread: px.length ? Math.round((q(0.98) - q(0.02)) * 10) / 10 : null,
      };
    }),
  // PER-PROP PRESENCE — the delivered pixel count for every token each island DECLARES it is
  // built from, which is the number the opaque floors cannot see (see the block above).
  //
  // The counts are recorded and not only the verdict, and that is deliberate: the floor catches
  // a prop that delivered ZERO, and a prop that has quietly shrunk from four hundred pixels to
  // four is a question no floor should try to anticipate. Recorded, it is a diff between two
  // reports; unrecorded, it is a number nobody has.
  propPresence: {
    floor: presence.floor,
    islandsChecked: presence.checked,
    islandsWithProps: presence.withProps,
    islandsExpected: expectPropCanvases,
    // Tagged canvases this module has no declaration for — every tag on the other evidence page,
    // and the first thing to look at if `islandsChecked` is lower than it should be.
    unresolvedTags: presence.unresolvedTags,
    ok: presence.ok,
    islands: presence.canvases.map((c) => ({
      tag: c.tag,
      opaque: c.opaque,
      missing: c.missing.map((t) => t.name ?? t.token),
      unprovable: c.unprovable,
      tokens: c.tokens.map((t) => ({
        name: t.name,
        token: t.token,
        provableBy: t.provableBy,
        deliveredPx: t.deliveredPx,
        present: t.present,
      })),
    })),
  },
  // THE COLOUR-SPREAD BAND — ADR-0418 D4's replacement, per canvas.
  //
  // The BAR is recorded next to the figure it judged, and that is deliberate: the bar is read off
  // a control in the same run rather than committed, so a report carrying only the verdict would
  // be unreadable a week later. `bar` is the control's total delivered colour count; `bins90` is
  // what the canvas needed to cover nine tenths of itself.
  colourSpread: {
    ok: spread.ok,
    checked: spread.checked,
    continuousChecked: spread.continuousChecked,
    unresolvedTags: spread.unresolvedTags,
    // Pixels this run did NOT hold to the palette closure, so the cost of the exemption is a
    // number in the report rather than something a reader has to reconstruct from the manifest.
    exemptFromPaletteOpaquePixels: exemptOpaque,
    canvases: spread.canvases.map((c) => ({
      tag: c.tag,
      regime: c.regime,
      opaque: c.opaque,
      distinct: c.distinct,
      bins90: c.bins90,
      control: c.control,
      bar: c.bar,
      fault: c.fault,
    })),
  },
  // Watertightness, REPORTED not judged — see the flood fill above for why there is no
  // threshold. Read it against the flat control panels on the same page, which read 0.
  watertight: {
    totalInteriorHoles: delivered.reduce((s, c) => s + c.holes, 0),
    worstPanels: delivered
      .map((c, i) => ({ i, holes: c.holes, opaque: c.opaque }))
      .sort((a, b) => b.holes - a.holes)
      .slice(0, 6),
  },
  palette: {
    authoredEntries: palette.size,
    canvases: delivered.length,
    opaquePixels: totalOpaque,
    distinctDeliveredColours: distinct.size,
    offPalettePixels: offPalette,
    offPaletteColours: [...offenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    // MEMBERSHIP, the closure question — every delivered colour belongs to some authored
    // status family, or is family-less by design.
    //
    // THE FAMILY-LESS TOKENS ARE SUBTRACTED FIRST, AND THIS IS A CORRECTION, NOT A WIDENING.
    // Some authored tokens genuinely belong to every status and therefore to none: the wheat
    // override, the story tree's shared bole, and every UAT-flower material (a flower's verdict
    // is its FORM, not its colour — ADR-0226 D4). The family test reports `null` for those BY
    // DESIGN, so counting them here would report a defect on any island that grows a flower.
    // Both halves are the SHADOW-AWARE siblings, or every shadow entry would report as an
    // orphan the moment a shadow was drawn.
    foreignStatusReads: (() => {
      const familyless = new Set(familylessPaletteWithShadow());
      return [...distinct]
        .filter((h) => palette.has(h) && !familyless.has(h))
        .map((h) => ({
          hex: h,
          family: familyOnShadowLadder({
            r: parseInt(h.slice(1, 3), 16),
            g: parseInt(h.slice(3, 5), 16),
            b: parseInt(h.slice(5, 7), 16),
          }),
        }))
        .filter((x) => x.family === null).length;
    })(),
    familylessDeliveredColours: [...distinct].filter((h) =>
      new Set(familylessPaletteWithShadow()).has(h),
    ).length,
    shadowRung: SHADOW_RUNG,
    // THE NUMBER THAT DECIDES WHETHER THE SHADOW EXISTS AT ALL, and the direct analogue of
    // PR #1385's finding that the same light field delivered ZERO pixels once quantised onto
    // the shipped 132-entry palette. An authored entry nothing lands on is a colour in the
    // palette and nothing on the island.
    shadowRungPixels: (() => {
      const onRung = new Set(shadowRungEntries());
      let n = 0;
      for (const c of delivered) for (const [hex, k] of c.colours) if (onRung.has(hex)) n += k;
      return n;
    })(),
    shadowRungColoursDelivered: [...distinct].filter((h) => shadowRungEntries().includes(h)).length,
    shadowRungColoursAuthored: shadowRungEntries().length,
    shadowLadder: [...SHADOW_LADDER],
    entriesWithoutShadow: paletteBefore.size,
    shadowPaletteCost: palette.size - paletteBefore.size,
    everyPreShadowEntrySurvives: [...paletteBefore].every((h) => palette.has(h)),
  },
  // CONFUSABILITY, which is a DIFFERENT question and the one this increment exists for.
  // Membership above can never fail for a shadow — the shader only emits its own token's
  // entries, by construction — so it is blind to a `unknown` cell darkened until it reads
  // `healthy`. This block reports the borrowed reader model's verdict on every rung,
  // including the two rungs of the SHIPPED ladder that already fail it.
  confusability: {
    reader:
      "port of shadow.py's reader_status_table/nearest_status/safe_depth, re-based to the " +
      'level flat ground is actually delivered at (0.90) rather than to full light',
    ceilings: liveCeilings(),
    inadmissible: ladderAdmissibility()
      .filter((v) => !v.admissible)
      .map((v) => ({ status: v.status, level: v.level, hex: v.hex, readsAs: v.readsAs })),
    statuses: [...RENDERED_STATUSES],
    // The verdicts that survive a reader holding all three authored ground variants as well
    // as the one the renderer emits. The rest are the reference set showing, not the island.
    robust: robustlyInadmissible().map((v) => ({
      status: v.status,
      level: v.level,
      hex: v.hex,
      readsAs: v.readsAs,
    })),
    // The statement no reader model can argue with.
    luminanceOverlap: luminanceOverlap(),
    // AND HOW MANY OF THOSE THIS PAGE ACTUALLY DELIVERS. The list above is what the ladder
    // COULD emit; this is what it DID. Every one of them belongs to the shipped ladder, so
    // it is a measurement of the land as it stands rather than a cost of the shadow — and
    // reporting only the potential would have let a real, delivered foreign read hide behind
    // a table of hypotheticals.
    deliveredForeignPixels: (() => {
      // ROBUST verdicts only. Counting the reader-sensitive ones here would have reported
      // two million pixels of healthy ground as a foreign read on the strength of a reader
      // that holds one reference colour per status.
      const bad = new Map(robustlyInadmissible().map((v) => [v.hex, v]));
      const hits = [];
      let total = 0;
      for (const c of delivered) {
        for (const [hex, n] of c.colours) {
          const v = bad.get(hex);
          if (!v) continue;
          total += n;
          const found = hits.find((x) => x.hex === hex);
          if (found) found.px += n;
          else hits.push({ hex, px: n, status: v.status, level: v.level, readsAs: v.readsAs });
        }
      }
      return { total, byColour: hits.sort((a, b) => b.px - a.px) };
    })(),
  },
  // WHAT THE SHADOW BUYS — the same question PR #1385 asked of the compositor, asked of this
  // renderer, and answered off the DELIVERED raster rather than off the TypeScript that fed
  // it. The two canvases are found by their `data-st-tag`, never by position: the panel
  // filenames on this page are already zipped positionally against sections, and a
  // measurement that silently compared the wrong two canvases would produce a NUMBER rather
  // than a mislabelled file.
  whatTheShadowBuys: (() => {
    const luma = (hex) =>
      0.3 * parseInt(hex.slice(1, 3), 16) +
      0.59 * parseInt(hex.slice(3, 5), 16) +
      0.11 * parseInt(hex.slice(5, 7), 16);
    const stats = (tag) => {
      const c = delivered.find((d) => d.tag === tag);
      if (!c) return { tag, missing: true };
      const rows = c.colours
        .map(([hex, n]) => ({ hex, n, l: luma(hex) }))
        .sort((a, b) => a.l - b.l);
      const total = rows.reduce((s2, r) => s2 + r.n, 0);
      const at = (f) => {
        let seen2 = 0;
        for (const r of rows) {
          seen2 += r.n;
          if (seen2 >= total * f) return Number(r.l.toFixed(1));
        }
        return Number(rows[rows.length - 1].l.toFixed(1));
      };
      const onRung = new Set(shadowRungEntries());
      return {
        tag,
        bodyPx: total,
        distinctColours: rows.length,
        distinctLumaLevels: new Set(rows.map((r) => Number(r.l.toFixed(2)))).size,
        lumaP2: at(0.02),
        lumaP98: at(0.98),
        lumaRangeP2toP98: Number((at(0.98) - at(0.02)).toFixed(1)),
        shadowRungPx: rows.filter((r) => onRung.has(r.hex)).reduce((s2, r) => s2 + r.n, 0),
      };
    };
    const lit = stats('delivered-lit');
    const shadowed = stats('delivered-shadow');
    return {
      atDeliveredSize: { lit, shadowed },
      atEightPxPerUnit: {
        lit: stats('zoom-lit'),
        terrainOnly: stats('zoom-terrain'),
        canopy: stats('zoom-shadow'),
      },
      // THE PLANTS REMOVED, same shadow — the tree and the flowers stay, so the long cast is
      // unobstructed and the ground under the canopy can be seen. Deliberately NOT called
      // "bare": `plants={false}` leaves the two other props standing, and a panel labelled
      // bare that is not bare is how a measurement ends up comparing the wrong two things.
      plantsRemoved: { lit: stats('bare-lit'), shadowed: stats('bare-shadow') },
      pctOfIslandReached:
        shadowed.bodyPx > 0
          ? Number(((shadowed.shadowRungPx / shadowed.bodyPx) * 100).toFixed(2))
          : null,
      // ...and the same thing over GROUND pixels only, which is the fraction the shadow
      // FIELD's own coverage is directly comparable to. The gap between the two is how much
      // of the island the props cover, which is a fact about plant density rather than about
      // the shadow.
      pctOfGroundReached: (() => {
        const ground = new Set(groundPaletteWithShadow());
        const onRung = new Set(shadowRungEntries());
        const c = delivered.find((d) => d.tag === 'zoom-shadow');
        if (!c) return null;
        let groundPx = 0;
        let shadowPx = 0;
        for (const [hex, n] of c.colours) {
          if (!ground.has(hex)) continue;
          groundPx += n;
          if (onRung.has(hex)) shadowPx += n;
        }
        return groundPx > 0
          ? { groundPx, shadowPx, pct: Number(((shadowPx / groundPx) * 100).toFixed(2)) }
          : null;
      })(),
      // THE CONTROL THAT MAKES THE TERRAIN FINDING A MEASUREMENT RATHER THAN A CLAIM: the
      // terrain-only panel must be pixel-for-pixel the unshadowed one.
      terrainCastIsIdenticallyZero: (() => {
        const a = delivered.find((d) => d.tag === 'zoom-lit');
        const b = delivered.find((d) => d.tag === 'zoom-terrain');
        if (!a || !b) return null;
        const key = (c) => JSON.stringify([...c.colours].sort());
        return key(a) === key(b);
      })(),
    };
  })(),
  frameTiming: {
    samples: frames.length,
    p50Ms: Number(p50.toFixed(2)),
    meanMs: Number((frames.reduce((s, d) => s + d, 0) / frames.length).toFixed(2)),
    interpretation:
      'RELATIVE ONLY. Software rasteriser, static scene — this is the headless compositor ' +
      'present cadence, not a GPU-bound frame cost. Do not quote it as a D2 verdict.',
  },
};

emit('capture-report.json', JSON.stringify(report, null, 2) + '\n');

await browser.close();

console.log(`served     : this checkout's harness — ${describeServer(navigation.tree)}`);
console.log(`WebGL      : ${renderer.version} via ${renderer.renderer}`);
console.log(`software   : ${report.webgl.isSoftware}`);
console.log(`canvases   : ${delivered.length}`);
console.log(`opaque px  : ${totalOpaque}`);
console.log(`distinct   : ${distinct.size} delivered colours, ${palette.size} authored entries`);
console.log(
  `shadow     : rung ${SHADOW_RUNG}, palette ${paletteBefore.size} -> ${palette.size} ` +
    `(+${palette.size - paletteBefore.size})`,
);
console.log(
  `on the rung: ${report.palette.shadowRungPixels} delivered px across ` +
    `${report.palette.shadowRungColoursDelivered} of ${report.palette.shadowRungColoursAuthored} ` +
    'authored shadow entries',
);
console.log(
  `delivered  : shadow reaches ${report.whatTheShadowBuys.pctOfIslandReached}% of the island; ` +
    `p2-p98 luma ${report.whatTheShadowBuys.atDeliveredSize.lit.lumaRangeP2toP98} -> ` +
    `${report.whatTheShadowBuys.atDeliveredSize.shadowed.lumaRangeP2toP98}`,
);
console.log(
  `terrain    : identically zero = ${report.whatTheShadowBuys.terrainCastIsIdenticallyZero}`,
);
console.log(
  `on ground  : ${report.whatTheShadowBuys.pctOfGroundReached?.pct}% of delivered GROUND px ` +
    `(${report.whatTheShadowBuys.pctOfGroundReached?.shadowPx} of ` +
    `${report.whatTheShadowBuys.pctOfGroundReached?.groundPx})`,
);
console.log(
  `no plants  : shadow on ${(
    (report.whatTheShadowBuys.plantsRemoved.shadowed.shadowRungPx /
      report.whatTheShadowBuys.plantsRemoved.shadowed.bodyPx) *
    100
  ).toFixed(2)}% of delivered px (with plants: ${(
    (report.whatTheShadowBuys.atEightPxPerUnit.canopy.shadowRungPx /
      report.whatTheShadowBuys.atEightPxPerUnit.canopy.bodyPx) *
    100
  ).toFixed(2)}%)`,
);
console.log(
  `confusable : ${report.confusability.inadmissible.length} (status, rung) pairs read foreign ` +
    `under the borrowed reader; this page DELIVERED ` +
    `${report.confusability.deliveredForeignPixels.total} such px, all on the SHIPPED ladder`,
);
console.log(`OFF-PALETTE: ${offPalette} px`);
if (offPalette > 0) {
  for (const [hex, n] of [...offenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${hex}  ${n} px`);
  }
}
console.log(
  `props      : ${presence.withProps} islands verified (${presence.checked} declarations resolved)` +
    (expectPropCanvases ? ` (caller expects ${expectPropCanvases})` : '') +
    `, floor ${presence.floor} px/token, ${presence.failures.length} short` +
    (presence.unresolvedTags.length
      ? `; ${presence.unresolvedTags.length} tagged canvases carry no declaration`
      : ''),
);
for (const c of presence.canvases) {
  const worst = [...c.tokens].sort((a, b) => a.deliveredPx - b.deliveredPx).slice(0, 4);
  console.log(
    `   ${c.tag.padEnd(12)} ${worst.map((t) => `${t.name ?? t.token} ${t.deliveredPx}`).join('  ')}` +
      (c.tokens.length > worst.length ? `  (+${c.tokens.length - worst.length} more)` : ''),
  );
}
console.log(
  `spread     : ${spread.continuousChecked} continuous of ${spread.checked} declared canvases` +
    (exemptOpaque ? `, ${exemptOpaque} px exempt from the palette closure` : '') +
    (spread.unresolvedTags.length
      ? `; ${spread.unresolvedTags.length} tagged canvases carry no declaration`
      : ''),
);
for (const c of spread.canvases.filter((v) => v.regime === 'continuous')) {
  console.log(
    `   ${(c.fault ? 'XX ' : 'ok ') + c.tag.padEnd(20)} bins90 ${String(c.bins90).padStart(5)} ` +
      `vs bar ${String(c.bar ?? '-').padStart(5)} (${c.control ?? 'no control'})`,
  );
}
console.log(
  `holes      : ${report.watertight.totalInteriorHoles} interior px across ${delivered.length} ` +
    'canvases (REPORTED, not a rung — the flat control reads 0)',
);
console.log(`frame p50  : ${report.frameTiming.p50Ms} ms (RELATIVE — software rasteriser)`);
// WHAT THIS RUN DID TO THE WORKING TREE, on both paths and before the refusals below. A green run
// that rewrote 22 files of an unrelated evidence pass and mentioned none of them is the friction
// this reports out of; printing it only in read-only mode would have left the writing run — the one
// that actually pollutes — exactly as quiet as it was. It sits ABOVE the refusals so that the
// read-only warning about having no evidence to diagnose from precedes the refusal it concerns.
console.log(describeWrites({ readOnly: READ_ONLY, dir: OUT_SPEC, files: written }));
// THE REFUSALS, COLLECTED RATHER THAN RACED. Each of these is a claim the page exists to prove,
// and `fail()` exits, so a run with two faults used to name only whichever was checked first.
// They are gathered and reported together.
const refusals = [];

if (!presence.ok) {
  // A DECLARED PROP DELIVERED NOTHING. Not a palette question and not a blank-canvas question —
  // both of those pass on this exact picture, which is why this check had to be added at all.
  refusals.push(`PROP MISSING — ${describePresenceFailure(presence)}`);
}
if (presence.withProps < expectPropCanvases) {
  // THE INSTRUMENT CHECKED FEWER ISLANDS THAN THE CALLER DECLARED. A run that quietly stops
  // checking is indistinguishable from a run that checked and found nothing wrong, and that is
  // the shape of every vacuous green this page has already produced once.
  refusals.push(
    `PROP FLOOR UNCOVERED — ${presence.withProps} islands carried a non-empty prop declaration ` +
      `but the ` +
      `caller declared ${expectPropCanvases}. Tagged canvases with no declaration: ` +
      `${presence.unresolvedTags.join(', ') || '(none)'}.`,
  );
}

if (offPalette > 0) {
  // AN OFF-PALETTE PIXEL NOW EXITS NON-ZERO, AND UNTIL 2026-08-22 IT DID NOT.
  //
  // This script's exit code already covered console errors, a blank canvas, a duplicated
  // `data-st-tag` and the settle timeout — every failure of the HARNESS — while the one thing
  // it exists to prove printed `PALETTE BREACHED` and returned 0. So the palette fence, the
  // property ADR-0380 D6 fence 3 rests on and the reason `capture.mjs` can REFUSE rather than
  // merely report, was the single claim on this page that no caller could check without reading
  // the prose. Filed as friction `capture-palette-check-reports-a-breach-and-exits-zero`; the
  // last three research READMEs each carried a paragraph warning readers not to trust the exit
  // code, which is a documented workaround standing in for a one-line fix.
  //
  // It comes LAST on purpose: the pictures and the report are already written by this point, so
  // a breach still leaves the full evidence on disk to diagnose from. Refusing earlier would
  // destroy exactly the artefact needed to find out what went off-palette. The prop-presence
  // refusals above are held to the same rule and for the same reason.
  refusals.push(`PALETTE BREACHED — ${offPalette} delivered px outside the authored closure`);
}

if (!spread.ok) {
  // THE COLOUR-SPREAD BAND REFUSED. This is the rung that can still fail once the palette fence
  // is lifted, and it fails in five different ways — a continuous surface that COLLAPSED back
  // onto the authored ladder, arms that are not the same island, too few pixels for the figure
  // to mean anything, a control that is missing or is not itself banded, and a tagged canvas
  // with no declaration at all. `colour-spread.ts` names which.
  //
  // Held to the same last-position rule as the two above, for the same reason: the pictures and
  // the report are on disk by now, so a refusal still leaves the evidence to diagnose it from.
  refusals.push(`COLOUR SPREAD — ${describeSpreadFailure(spread)}`);
}

if (refusals.length) fail(refusals.join('\n  AND '));

console.log(
  exemptOpaque
    ? `PALETTE CLOSED ON THE GPU (over the banded canvases; ${exemptOpaque} px exempt by declaration)`
    : 'PALETTE CLOSED ON THE GPU',
);
console.log(
  spread.continuousChecked
    ? `EVERY CONTINUOUS CANVAS CLEARS ITS CONTROL (${spread.continuousChecked} of ${spread.checked} declared)`
    : `NO CONTINUOUS CANVASES ON THIS PAGE — the band checked nothing (${spread.checked} declared banded)`,
);
console.log(
  presence.checked
    ? `EVERY DECLARED PROP DELIVERED (${presence.withProps} islands verified)`
    : 'NO PROP DECLARATIONS ON THIS PAGE — the prop floor checked nothing',
);
