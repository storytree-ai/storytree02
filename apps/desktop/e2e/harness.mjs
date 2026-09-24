// Shared Electron E2E harness for the storytree desktop forest-map specs.
//
// WHY THIS EXISTS (the offline contract): the desktop's real backend sidecar (electron/backend-entry.ts)
// always opens a LIVE Cloud SQL connection — it has no json/offline mode — so a test that just launches
// the app renders nothing in CI (no DB, no creds) and renders LIVE, non-deterministic data on a dev box.
// The `STORYTREE_STUDIO_STORE=json` env the launch passes is read only by the studio's OWN dev/serve
// servers, NOT by the desktop sidecar, so it is inert here. To make these specs genuinely offline AND
// deterministic we STUB the renderer's `/api/*` calls with Playwright request routing: the forest paints
// from a fixed fixture, every advisory endpoint answers benignly, and no DB is ever touched. The thing
// under test — the REAL forest-map render + pointer handlers in the REAL Electron Chromium — is
// untouched; only the data source is faked (these specs guard frontend interaction, not the backend).
// Two more legs keep the app itself bootable offline: STORYTREE_DESKTOP_E2E=1 puts the Electron main in
// e2e mode — it serves the LAUNCH CHECKOUT's studio dist directly and never spawns the backend sidecar
// (whose fail-closed boot — DB preflight, git probe, IAM pool — can never pass in a bare CI container
// and is irrelevant to these stubbed specs; it also means a dev box's runtime pin cannot redirect the
// suite to another checkout) — and launchOffline WAITS OUT the main's launch-page → studio-origin
// navigation before driving the renderer (driving the launch page loses the `#/tree` hash in the swap —
// the 2026-07-10..14 CI wedge).
//
// WHY THE MAP IS STATIC (the third determinism leg, 2026-08-03): since ADR-0286 the FIRST map mount of
// a browser session plays an arrival regrow that materialises the world island by island over many
// seconds, and ADR-0292 grows each island's vegetation frame by frame on that same cursor. None of it
// moves the camera, so back when `waitForForestSettled` polled the transform for byte-stability it could
// not see a regrow in flight and returned onto a half-built map (measured: 3 of 5 launches came back with
// 1 of 4 islands in the DOM). `waitForForestSettled` now waits on the app's own settled bridge (see its
// doc comment below) and WOULD wait out a regrow correctly — but launchOffline still arrives ahead of the
// mount on purpose: paying the ~9 s regrow on every launch of a suite that isn't testing the regrow itself
// would make every spec here slower for no coverage gained. It sets the app's own session flag so every
// spec reads the static steady state a real second visit gets. Clicking (or capturing) mid-regrow is a
// real scenario, but it is a spec of its own, not a source of flake in the pointer-capture wall.
//
// WHY REAL-INPUT CLICKS + RELOAD-RESET: the node-click bug this suite guards reproduces ONLY in Electron
// (pointer capture retargets a captured click), so we drive `win.mouse` real input, never `.click()` on a
// locator (see memory: forest-map-click-verify-needs-movement). Selecting a node ZOOMS the camera and
// leaves it zoomed after the selection clears, so re-finding a target in that zoomed view is unreliable —
// every case therefore RESETS by reloading to the clean fit:'contain' mount (all islands visible) and
// waits for the camera to settle before reading any coordinate. That reload-reset is what makes the
// suite pass reliably on a slow/loaded machine, where the old fixed-timeout reset flaked.

import { _electron as electron } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** apps/desktop — the Electron app root Playwright launches (`args: ['.']`). */
export const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the deterministic offline forest (a TreePayload, apps/studio/src/types.ts) ───────────────────────
//
// Hand-authored so the world renders identically every run (buildWorld hashes all jitter from ids).
// Shape mirrors GET /api/tree. A small dependency DAG: one foundation engine, two dependents, plus one
// `building: true` shared library. Under the pathways-only default (ADR-0228) building-class stories lay
// out on the map like any other island, so all four render; the flag only matters behind `?buildings=on`.

const cap = (id, dependsOn = []) => ({
  id,
  title: id,
  outcome: `${id} works`,
  status: 'healthy',
  proofMode: 'machine-checked',
  dependsOn,
});

/** @type {{stories: unknown[], sessions: unknown[], builds: unknown[]}} */
export const TREE_FIXTURE = {
  stories: [
    {
      id: 'alpha-engine',
      title: 'Alpha Engine',
      outcome: 'the load-bearing core',
      status: 'healthy',
      proofMode: 'machine-checked',
      uatWitness: 'machine',
      dependsOn: ['shared-lib'],
      consumedBy: [],
      capabilities: [cap('alpha-parse'), cap('alpha-eval', ['alpha-parse'])],
    },
    {
      id: 'beta-surface',
      title: 'Beta Surface',
      outcome: 'the visible surface',
      status: 'mapped',
      proofMode: 'human-witnessed',
      uatWitness: 'human',
      dependsOn: ['alpha-engine', 'shared-lib'],
      consumedBy: [],
      capabilities: [cap('beta-view')],
    },
    {
      id: 'gamma-flow',
      title: 'Gamma Flow',
      outcome: 'a dependent flow',
      status: 'proposed',
      proofMode: 'machine-checked',
      uatWitness: 'machine',
      dependsOn: ['alpha-engine'],
      consumedBy: [],
      capabilities: [cap('gamma-step')],
    },
    {
      // A `render: building` story. Since ADR-0228 the default map is pathways-only, so it lays out as
      // an ordinary island (the old ADR-0088/0102 drawer + stamps model lives behind `?buildings=on`).
      id: 'shared-lib',
      title: 'Shared Lib',
      outcome: 'the shared building',
      status: 'healthy',
      proofMode: 'machine-checked',
      uatWitness: 'machine',
      dependsOn: [],
      consumedBy: ['alpha-engine', 'beta-surface'],
      building: true,
      capabilities: [cap('lib-core')],
    },
  ],
  sessions: [],
  builds: [],
};

/** A signed-in member so the SPA renders the app (not the request-access wall); store reads healthy so
 *  there is no StoreBanner shifting the layout (deriveLoadState → 'app'). */
const ME_FIXTURE = { email: 'e2e@local', role: 'member', status: 'active', member: true };
const HEALTH_FIXTURE = { store: 'pg', db: 'ok' };

/** Fulfil one route with a JSON body. */
const json = (route, body) => route.fulfill({ json: body });

/**
 * Register the offline `/api/*` stubs on a window. Every endpoint the studio boot touches answers from a
 * fixture so the app reaches `loadState: 'app'` and the forest paints deterministically with no DB.
 * The activity advisory layer answers the documented "store didn't answer" null shape. (The
 * /api/presence stub left with the presence retirement, ADR-0200 D7 — the route no longer exists.)
 */
export async function stubApi(win) {
  await win.route('**/api/tree', (r) => json(r, TREE_FIXTURE));
  await win.route('**/api/me', (r) => json(r, ME_FIXTURE));
  await win.route('**/api/health', (r) => json(r, HEALTH_FIXTURE));
  await win.route('**/api/docs', (r) => json(r, [])); // listDocs (and /api/docs/content is unused here)
  await win.route('**/api/assets', (r) => json(r, []));
  await win.route('**/api/comments**', (r) => json(r, []));
  await win.route('**/api/activity', (r) => json(r, { builds: null }));
}

/**
 * Launch the desktop app fully offline. Stubs are registered on the first window and the page is then
 * RELOADED so they are in force from a clean mount (firstWindow resolves after loadURL has already
 * started, so the very first fetches could otherwise race the stubs). Returns the app + window with the
 * forest painted and the camera settled at the fit. Always `app.close()` in a finally.
 */
export async function launchOffline() {
  // In CI the app runs as root in a container under xvfb, where Chromium needs these to start: no SUID
  // sandbox as root, a real /tmp instead of a tiny container /dev/shm, and software GL (no GPU). They
  // are CI-only (gated on $CI) so local runs stay realistic, and none touch the pointer/selection paths
  // these specs guard. The ELECTRON_DISABLE_SANDBOX env the workflow sets is belt-and-braces alongside.
  const ciArgs = process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [];
  const app = await electron.launch({
    args: ['.', ...ciArgs],
    cwd: appDir,
    env: {
      ...process.env,
      // Inert for the desktop sidecar (see file header) but kept so intent reads as offline; the real
      // offline guarantee is the stubs, not this env.
      STORYTREE_STUDIO_STORE: 'json',
      // E2E mode (electron/main.ts): serve THIS checkout's studio dist, never spawn the backend
      // sidecar, ignore any runtime pin. The specs stub every /api/* call, so the sidecar's absence is
      // invisible to them — and its fail-closed boot (DB preflight, git probe, IAM pool) stops being
      // an environment lottery the suite can lose (the 2026-07-10..14 CI wedge).
      STORYTREE_DESKTOP_E2E: '1',
    },
  });
  // Echo the Electron process's own output into THIS process's stderr, line-prefixed. The main
  // relays the backend sidecar's stderr, so a sidecar that dies (or crawls) at boot states its
  // reason HERE, live in the CI log — without this, a boot failure's cause exists only inside the
  // window (and node:test defers failure bodies to the end-of-run summary, which a step timeout
  // eats — exactly how the 2026-07-10..13 hang stayed causeless for three days).
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`));
  // From here to the return, the launch can FAIL — and a thrown launchOffline means the caller never
  // receives `app`, so its `finally { app.close() }` can never run. An undisposed Electron (live CDP
  // socket + child processes) keeps the node:test child's event loop alive FOREVER: the runner never
  // finishes the file and the CI step wedges to its timeout with zero output (the 2026-07-10..13 e2e
  // hang). So: on ANY failure, fold the visible page into the error (the main's launch/error page
  // carries the actual reason the app couldn't start), print it INLINE (see above on eaten
  // summaries), CLOSE the app, and rethrow — a broken launch must fail RED fast, never hang.
  try {
    const win = await app.firstWindow();
    await stubApi(win);
    // The main boots the window on a data: "Starting storytree" launch page and then NAVIGATES to the
    // served studio origin (http://127.0.0.1:<port>). Driving the launch page would set `#/tree` on a
    // page the swap then replaces (hash lost → the SPA mounts on Home, which has no forest — the
    // 2026-07-10..14 wedge), so wait for the studio origin FIRST — and FAIL FAST with the page text
    // the moment the main lands on its error page instead of burning the full timeout. The /api stubs
    // registered above persist across the navigation.
    await waitForStudioOrigin(win);
    await win.evaluate(() => {
      // ARRIVE BEFORE THE MAP MOUNTS (ADR-0286's Act 2 arrival regrow). The regrow plays on the FIRST
      // TreeView mount of a browser session — which, for this harness, is the reload below: the app
      // boots on Home, so the map has never mounted when we set the hash. Left to run, it materialises
      // the world island by island over many seconds, and the specs then read a map that is still
      // being built: measured across 5 launches, 3 returned from waitForForestSettled with 1 of 4
      // islands in the DOM and the tree candidates 1-3px wide. Setting the session flag the app itself
      // uses (ACT2_INTRO_SESSION_KEY, apps/studio/src/components/act2Intro.ts) mounts the STATIC map —
      // the steady state every later visit in a real session gets, and the state this suite's subject
      // (pointer capture) actually lives in. It survives the reload and every resetToForest, so all
      // four cases read the same map. Clicking DURING the regrow is a real scenario, but it is a
      // different spec than this pointer-capture wall — not something to smuggle in as flake.
      sessionStorage.setItem('storytree.act2.arrived', '1');
      location.hash = '#/tree';
    });
    await win.reload();
    await waitForForestSettled(win);
    return { app, win };
  } catch (err) {
    err.message = `${err.message}${await describeWindowState(app)}`;
    console.error(`[launchOffline] FAILED: ${err.message}`);
    await closeHard(app);
    throw err;
  }
}

/**
 * Wait for the main's launch-page → studio-origin navigation by POLLING url/title (both survive
 * navigations, unlike waitForURL/waitForFunction which can die "execution context destroyed" mid-swap).
 * Fails FAST with the visible page text when the main lands on its error page ("storytree could not
 * start") — that text carries the boot failure's reason, so the spec's failure states the cause in
 * seconds instead of timing out. In e2e mode the swap is just serve-static + navigate (~2s); 60s is
 * a deep ceiling for a slow CI container.
 */
export async function waitForStudioOrigin(win, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const url = win.url();
    if (/^http:\/\/127\.0\.0\.1:/.test(url)) {
      // The URL flips at navigation COMMIT, but the main's own `loadURL(url)` is still awaiting the
      // page's 'load' — a reload issued in that window ABORTS the pending load, and the main treats
      // ERR_ABORTED as a failed launch (it swaps to its error page and the spec's page dies under
      // it). Hand the page back only once the document has finished loading.
      const ready = await win
        .evaluate(() => document.readyState === 'complete')
        .catch(() => false); // evaluate mid-navigation throws → not ready yet, keep polling
      if (ready) return;
    } else {
      const title = await win.title().catch(() => '');
      if (title === 'storytree could not start') {
        const text = await win
          .evaluate(() => (document.body ? document.body.innerText : ''))
          .catch(() => '(page text unreadable)');
        throw new Error(`the app failed to launch:\n${text.slice(0, 900)}`);
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out (${Math.round(timeout / 1000)}s) waiting for the studio origin — window still at: ${url.slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The failing window's URL + visible text, foldable into an error message — the launch/error page's
 *  body is usually the exact reason the app never reached the studio (e.g. a sidecar crash). */
async function describeWindowState(app) {
  try {
    const win = app.windows()[0];
    if (!win) return '\n[launchOffline] no window was open at failure';
    const text = await win
      .evaluate(() => (document.body ? document.body.innerText : ''))
      .catch(() => '(page text unreadable)');
    return `\n[launchOffline] window url at failure: ${win.url()}\n[launchOffline] page text: ${text.slice(0, 600)}`;
  } catch (probeErr) {
    return `\n[launchOffline] window state unreadable: ${probeErr.message}`;
  }
}

/** Close the app, but never let a wedged quit re-introduce the hang this file exists to prevent:
 *  if graceful close doesn't finish in time, kill the Electron process outright. */
async function closeHard(app, { graceMs = 15_000 } = {}) {
  const killTimer = setTimeout(() => {
    try {
      app.process().kill();
    } catch {
      /* already gone */
    }
  }, graceMs);
  try {
    await app.close();
  } catch {
    /* the kill path above is the backstop */
  } finally {
    clearTimeout(killTimer);
  }
}

/** True iff the right-side story detail panel is open. */
export const panelOpen = (win) => win.evaluate(() => !!document.querySelector('.tree-detail'));

/**
 * Poll until the detail panel is present/absent, by FRESH `evaluate` reads — never a Playwright
 * DOM-wait task. A wait task (page.waitForSelector OR locator().waitFor()) armed in the immediate
 * wake of a node-click's same-document hash navigation (#/tree → #/tree/<id>) can wedge permanently
 * in this Electron (playwright-core 1.61.1, observed on Windows): it times out on an element that
 * IS attached, while a per-read evaluate sees the DOM truthfully throughout. Throws with the
 * observed state on timeout so the spec's failure names what the DOM actually held.
 *
 * Pass the clicked target as `at` and a timeout also reports WHAT WAS UNDER THAT POINT when the wait
 * expired — the element chain, the story the app would resolve there, and whether the map was still
 * regrowing. Without it a miss says only `panelOpen=false`, which names the symptom and nothing else:
 * the 2026-08-03 CI red (PR #1106) cost a forensic session to get back to facts this line now prints.
 */
export async function waitForPanel(win, { present, timeout = 4000, at = null } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const open = await panelOpen(win);
    if (open === present) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out (${timeout}ms) waiting for .tree-detail to be ${present ? 'attached' : 'detached'} ` +
          `(panelOpen=${open})${await describePoint(win, at)}`,
      );
    }
    await win.waitForTimeout(100);
  }
}

/** What the DOM holds at a clicked point, for a panel-wait failure message: the element chain from the
 *  hit element up, the story the app's own hit-test would resolve there (null ⇒ the click could only
 *  have CLEARED the selection), and the map's regrow/story state. Never throws — a diagnostic that
 *  fails must not replace the real failure. */
async function describePoint(win, at) {
  if (!at) return '';
  try {
    const d = await win.evaluate(
      ([x, y]) => {
        const desc = (el) =>
          `${el.tagName}${el.getAttribute('class') ? `.${el.getAttribute('class').trim().split(/\s+/).join('.')}` : ''}`;
        const el = document.elementFromPoint(x, y);
        const chain = [];
        for (let e = el; e && chain.length < 5; e = e.parentElement) chain.push(desc(e));
        const idEl = el && el.closest('[data-story-id]');
        return {
          chain: chain.join(' < ') || '(nothing at the point)',
          resolves: idEl ? idEl.getAttribute('data-story-id') : null,
          regrowing: !!document.querySelector('svg.act2-regrowing, .arrive-island'),
          stories: [...new Set([...document.querySelectorAll('[data-story-id]')].map((e) => e.getAttribute('data-story-id')))].sort().join(','),
        };
      },
      [at.cx, at.cy],
    );
    return (
      `\n  clicked (${at.cx},${at.cy}) expecting story '${at.id}'` +
      `\n  the app's hit-test resolves that point to: ${d.resolves ?? 'NO STORY (this click could only clear)'}` +
      `\n  under the point: ${d.chain}` +
      `\n  map: regrowing=${d.regrowing} stories=[${d.stories}]`
    );
  } catch (probeErr) {
    return `\n  (could not probe the click point: ${probeErr.message})`;
  }
}

/** The sorted unique `data-story-id`s present in the rendered world — the proof that the forest paints
 *  from the offline fixture (not a live DB leaking in): the caller asserts this is the fixture's set. */
export const renderedStoryIds = (win) =>
  win.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-story-id]')].map((e) => e.getAttribute('data-story-id')))]
      .filter(Boolean)
      .sort(),
  );

/** The story ids the fixture LAYS OUT on the map — ALL of them, sorted to match renderedStoryIds():
 *  the pathways-only default (ADR-0228) no longer excludes building-class stories, so `shared-lib`
 *  renders as an ordinary island (the ADR-0088 drawer exclusion survives only behind `?buildings=on`). */
export const FIXTURE_MAP_STORY_IDS = TREE_FIXTURE.stories.map((s) => s.id).sort();

/**
 * Wait for the forest to be rendered AND declared settled by the APP ITSELF — never a guess.
 *
 * Before `frontend-settled-signal-from-the-app` (frontend-visual-judgment-arc) this polled the
 * `<g class="world-camera">` transform for byte-stability across two reads, plus a marker-class
 * check for `svg.act2-regrowing`. Both were HEURISTICS: a camera that legitimately never moves
 * during a regrow (ADR-0286's islands materialise in place) reads as "stable" from frame one, which
 * is exactly the guess a blind `frontend-builder` run on 2026-08-15 made and got wrong — it had no
 * way to check either signal against ground truth. That heuristic is gone. This now waits on
 * `window.__storytreeMotionSettled` (apps/studio/src/lib/motionSettled.ts), the app's own discrete,
 * positively-asserted fact: the world has ARRIVED (the initial `/api/tree` load resolved — real
 * content, a genuinely empty corpus, or an outright error; NOT merely the "no motion in flight" half
 * below, which is vacuously true while the "Growing the world…" placeholder is still up — see
 * `settle-bridge-reports-settled-before-the-world-arrives`, frontend-appearance-repair-arc) AND no
 * Act 2 regrow / vegetation-growth cursor in flight AND no finite CSS animation (camera transition,
 * lane draw-on, trail reveal, shore pulse, arrival pop-in) still running under the scene root.
 * **`lane-motion-draw` is NOT that signal** — see motionSettled.ts's header for why a permanent
 * motion-MODE class was misread as an in-progress state.
 *
 * `waitForFunction` polls a REAL predicate the app computes fresh on every call — this is not a
 * sleep-and-hope: a wedged bridge fails LOUD (the Playwright timeout below), not silent.
 */
export async function waitForForestSettled(win, { timeout = 25_000 } = {}) {
  // Wait on the per-island TERRITORY group (`g.hex-flora`), not the central tree: under the ADR-0226
  // vegetation vocabulary (now the studio default) the tree is a baked-art `<use>` (the autumn-tree
  // hero), NOT a `g.story-tree`, so waiting on the tree class would hang. `g.hex-flora` is present
  // regardless of the tree kind or the async hero-kit load, and TreeView publishes the settled
  // bridge on the same mount, so by the time this locator resolves the bridge is reachable too.
  await win.locator('g.hex-flora').first().waitFor({ state: 'attached', timeout });
  // waitForFunction's real signature is (pageFunction, arg, options) — the SECOND positional
  // parameter is always `arg`, passed into the page function, never options. A two-argument call
  // here (`waitForFunction(fn, { timeout })`) silently binds `{ timeout }` as an unused `arg` and
  // leaves `options` (hence the real timeout) undefined, so Playwright falls back to its own
  // internal default (30_000ms) regardless of what this function's caller asked for — invisible on
  // the tiny four-island offline fixture (settles well under 30s either way) and only surfaced by a
  // slower corpus-scale render (frontend-capture-settled-and-explicit-baseline). `undefined` as the
  // explicit second argument is required to reach the third, real `options` parameter.
  await win.waitForFunction(
    () => {
      const bridge = window.__storytreeMotionSettled;
      // A missing bridge (not yet published, or already unmounted) is NOT settled — never assume
      // "no signal" means "nothing moving". Fail closed toward waiting, exactly like the module's
      // own doc comment requires of every reader.
      return typeof bridge === 'function' && bridge().settled === true;
    },
    undefined,
    { timeout },
  );
}

/**
 * The full settled attestation as the app itself computed it, at this exact moment. Throws if the
 * bridge is unreachable (not on `#/tree`, or TreeView unmounted) rather than returning a fabricated
 * "settled" — a caller stamping a capture must never paper over "I couldn't ask".
 */
export async function readMotionSettled(win) {
  const snapshot = await win.evaluate(() => {
    const bridge = window.__storytreeMotionSettled;
    return typeof bridge === 'function' ? bridge() : null;
  });
  if (!snapshot) {
    throw new Error(
      'readMotionSettled: window.__storytreeMotionSettled is unreachable — not on #/tree, or TreeView is unmounted',
    );
  }
  return snapshot;
}

/**
 * Take a screenshot ONLY once the app itself attests it is settled, and write the attestation as a
 * `<png>.settled.json` sidecar beside it — so a capture this project takes for a verdict carries, as
 * metadata beside the PNG, that it was taken in a settled state. A capture that cannot prove settled
 * REFUSES rather than writing a plausible-looking image with no backing (the whole point of this
 * increment: a stale or mid-motion capture must be refusable evidence, not a guess a reader has to
 * trust).
 */
export async function captureSettledScreenshot(win, pngPath, { timeout = 25_000, ...screenshotOpts } = {}) {
  await waitForForestSettled(win, { timeout });
  const attestation = await readMotionSettled(win);
  if (attestation.settled !== true) {
    throw new Error(
      `captureSettledScreenshot: refusing to capture — motion not settled (reasons: ${attestation.reasons.join(', ') || 'none reported'})`,
    );
  }
  await win.screenshot({ path: pngPath, ...screenshotOpts });
  const stamp = {
    settled: true,
    phase: attestation.phase,
    reasons: attestation.reasons,
    worldArrived: attestation.worldArrived,
    activeStructuralAnimations: attestation.activeStructuralAnimations,
    act2Regrowing: attestation.act2Regrowing,
    capturedAt: new Date().toISOString(),
    pngPath,
  };
  await writeFile(`${pngPath}.settled.json`, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/**
 * Reset to the clean forest view between interactions: reload (so any selection AND the zoomed camera are
 * discarded) and wait for the fresh fit to settle. This is what keeps re-clicks reliable — clearing a
 * selection alone leaves the camera zoomed, where re-finding a target is unreliable.
 */
export async function resetToForest(win) {
  await win.evaluate(() => {
    location.hash = '#/tree';
  });
  await win.reload();
  await waitForForestSettled(win);
}

/**
 * Find a clickable story node in the CURRENT view and return its on-screen centre + the story id the
 * point resolves to. Re-find before EACH click: a selection zooms the camera, so coordinates from a
 * prior step go stale. Returns null when NO candidate's centre resolves to a selectable story.
 *
 * THE PREDICATE IS THE APP'S OWN, DELIBERATELY: a point counts only when it resolves to a
 * `[data-story-id]` — exactly what TreeView's coordinate hit-test requires to select
 * (`elementFromPoint(...).closest('[data-story-id]')`, the pointer-capture-retarget fix). It used to
 * accept the looser `closest('g.hex-flora,…,.coast-fill-group,…')` family, which is STRICTLY WEAKER
 * than the app's: `coast` is absent from SceneView's id stamp (only territory/ground/tile/hit/flora
 * are stamped), so a centre landing on an island's coast RIM matched `.coast-fill-group`, returned a
 * target with `id: null`, sailed through the caller's `assert.ok(target)` — and then died 4s later on
 * the panel wait with nothing but `panelOpen=false` to show for it. Measured on the offline fixture:
 * 99 points on the rendered map matched the old predicate while being unselectable by the app. A
 * candidate the app cannot select must be SKIPPED (try the next island), never returned.
 *
 * Candidate points come from each island's NAMEPLATE (`.world-plate-bg` inside its `g.hex-flora`).
 * They used to come from the island's central tree, a `g.story-tree` or a `.baked-art` node, but
 * ADR-0608 retired the flat hero tree: the 3D land draws the forest, and the nameplate is the SVG
 * mark a member reads and clicks to select a story.
 */
export const findStoryTarget = (win) =>
  win.evaluate(() => {
    // ADR-0608: the flat hero trees are gone — the 3D land draws the forest — so a story node is found
    // by its NAMEPLATE, the SVG mark a member reads and clicks to select the story.
    const trees = [...document.querySelectorAll('g.hex-flora[data-story-id] .world-plate-bg')]
      .map((t) => t.getBoundingClientRect())
      .filter((r) => r.width > 6 && r.left > 40 && r.top > 110 && r.bottom < window.innerHeight - 60);
    for (const r of trees) {
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const el = document.elementFromPoint(cx, cy);
      const idEl = el && el.closest('[data-story-id]');
      const id = idEl && idEl.getAttribute('data-story-id');
      if (id) return { cx, cy, id };
    }
    return null;
  });

/** Find clear sea: a point that resolves to empty map (not on any story / panel) — for the clear-on-empty
 *  and pan gestures. Returns null if the view is fully covered (then the caller skips that assertion). */
export const findEmptyPoint = (win) =>
  win.evaluate(() => {
    const ON = 'g.hex-flora,.relaxed-tile,.coast-fill-group,.world-story-hit,.native-prop-targets,[data-story-id],.shared-islands-panel,.tree-detail,.panel-drawer,.land-view-notice';
    for (let y = 130; y < window.innerHeight - 120; y += 17) {
      for (let x = 320; x < window.innerWidth - 20; x += 17) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (!el.closest(ON) && (el.tagName === 'svg' || (el.getAttribute('class') || '').includes('hex-empty')))
          return { x, y };
      }
    }
    return null;
  });

// ── camera (pan/zoom) helpers ────────────────────────────────────────────────────────────────────────
//
// The pan/zoom camera is the SVG `<g class="world-camera" transform="translate(tx ty) scale(scale)">`
// (apps/studio/src/components/TreeView.tsx, the worldCamera lib). A PAN changes only the translation
// (panBy keeps scale); a ZOOM changes the scale (zoomAt, which also re-centres on the cursor, so it
// moves the translation too). Reading the transform is therefore how a spec tells a pan from a zoom:
// translate-changed-but-scale-equal is a pan; scale-changed is a zoom.

/**
 * Read the world camera's transform: the parsed `{ tx, ty, scale }` plus the `raw` attribute string.
 * Returns null before the first frame is framed (the `<g>` has no transform until then). Parses the
 * three numbers out of `translate(tx ty) scale(scale)` positionally (translate's two, then scale's one).
 */
export const readCameraTransform = (win) =>
  win.evaluate(() => {
    const g = document.querySelector('g.world-camera');
    const raw = g ? g.getAttribute('transform') : null;
    if (!raw) return null;
    const nums = (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (nums.length < 3) return null;
    return { tx: nums[0], ty: nums[1], scale: nums[2], raw };
  });

/**
 * Poll the camera transform until its `raw` string differs from `prevRaw`, then return the new parsed
 * transform. The pan/zoom handlers set `animate:false`, so the change lands within a frame or two — but
 * a React re-render is async, so a spec reads the post-gesture transform through this rather than racing
 * it. On timeout it returns the latest transform anyway, so the caller's assertion fails with the real
 * (unchanged) values rather than on a thrown timeout.
 */
export async function waitForCameraChange(win, prevRaw, { timeout = 4000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const cur = await readCameraTransform(win);
    if (cur && cur.raw !== prevRaw) return cur;
    if (Date.now() > deadline) return cur;
    await win.waitForTimeout(60);
  }
}

// (The drawer-toggle helpers that once lived here left with map-interactions.e2e.mjs — the 2026-07-15
// scope cut keeps this suite to the two Electron-only regression walls: the pointer-capture map spec
// and the pty session-survival spec. Plain-HTML drawer behavior belongs to the studio's unit tests.)
