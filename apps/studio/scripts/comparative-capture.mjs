#!/usr/bin/env node
// The corpus-scale comparative capture (frontend-visual-judgment-arc, increment
// `frontend-corpus-scale-comparative-capture`; settled-attestation + explicit baseline added by
// increment `frontend-capture-settled-and-explicit-baseline`): renders THIS branch beside a baseline
// (by default `merge-base(origin/main, HEAD)`) over the SAME live corpus, same viewport, same settle
// discipline, and prints the five-measure element-count delta the increment names — content extent
// (union bbox of `.parcel`), island parcels, `world-cave` portals, `trail-fill`, `parcel-blade` —
// before it ever writes an image. This is the surface `frontend-builder`'s Stage 2 appearance
// witnessing now points at, replacing `launchOffline()`'s four-island `TREE_FIXTURE` stub for that
// purpose (the stub stays for what it is good at: deterministic, DB-less pointer-capture E2E — see
// harness.mjs's own header).
//
// NUMBERS FIRST, IMAGE SECOND (the increment's own design note): the delta table is the thing a
// human never has to eyeball to catch a shrink or a lost connector; the screenshot pair is for the
// judgment a count cannot make.
//
// THE SETTLE IS THE APP'S OWN ATTESTATION, NOT A SLEEP. Every semantic camera command crosses a
// double requestAnimationFrame boundary, then reuses `waitForForestSettled` / `readMotionSettled`
// from the desktop E2E harness and verifies the delivered `g.world-camera` transform against the
// app-owned seam receipt before screenshotting. There is no pointer gesture or plain settle sleep.
//
// THE BASELINE IS EXPLICIT, MERGE-BASE STAYS THE DEFAULT. `merge-base(origin/main, HEAD)` answers
// "did MY BRANCH change the render?" — right for a PR, and the zero-argument behaviour still. It does
// NOT answer "is the CURRENT render right?", and the two come apart the moment a defect is already on
// `main`: on a branch that hasn't touched the render, merge-base IS the branch, so a defect already on
// `main` shows a confident all-zero delta. `--baseline-ref <commit-ish>` lets a caller ask the second
// question by pointing the baseline capture at an explicit historical commit instead.
//
// THE TWO-CHECKOUTS PROBLEM. Comparing against a baseline commit means having it checked out and
// runnable. This script provisions a SEPARATE worktree at that commit (once — later runs reuse it if
// the resolved baseline ref hasn't moved) and `pnpm install`s it, the same shape
// `dogfood-probe.run.ts` already uses for an isolated probe checkout. That + two live-store dev
// servers + a real Chromium is NOT cheap or fully deterministic (a live corpus can change between
// the two captures), which is why this is an on-demand command for Stage 2 visual witnessing, not a
// `pnpm gate` rung — see the PR description / library artifact update for the affordability call.
//
// TRIGGER (fail-wide, reusing `ci-affected.ts` — never a second hand-rolled path list, mirroring
// ADR-0324's librarian-curation trigger): by default this script first asks whether the branch's own
// diff against `merge-base(origin/main, HEAD)` even touches the render surface
// (`frontend-capture-trigger.ts`'s `RENDER_SURFACE_PROJECTS`). An untouched surface prints the
// reason and exits 0 without spinning anything up; `--force` overrides. This trigger always reasons
// about the BRANCH's own diff against `origin/main` — it is unaffected by `--baseline-ref`, which
// only changes what the baseline capture renders, never whether a capture is worth taking.
//
// Usage: storytree forest compare --output <dir> --viewport WxH --padding t,r,b,l <targets...>
//        (legacy direct script: pnpm --filter studio capture:comparative [-- --out <dir>])
//        [--viewport WxH] [--branch-url <url>] [--baseline-url <url>] [--baseline-ref <commit-ish>]
//        [--force] [--clean-worktree] [--branch-port <n>] [--baseline-port <n>]
// (DB up — `pnpm db:up` — unless both --branch-url and --baseline-url are given.)

import { chromium } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLiveDb, loadLocalSecrets } from '@storytree/drive';

import { discoverWorkspaceProjects } from '../../../packages/cli/src/ci-affected.ts';
import { gitLines, localAffectedScope } from '../../../packages/cli/src/gate-scope.ts';
import { renderSurfaceTrigger } from '../../../packages/cli/src/frontend-capture-trigger.ts';
import { captureComparativeForest } from '../../../packages/cli/src/forest-comparative-capture.ts';
import {
  CAPTURE_SELECTORS,
  computeCaptureDelta,
  formatCaptureComparisonTable,
  toRenderElementCounts,
  verifyServedTree,
} from '../src/lib/comparativeCapture.ts';
// Shared with the one-arm and export scripts: double-rAF, the app's settle bridge and delivered
// SVG-camera verification are one runtime contract rather than parallel timing recipes.
import { waitForForestMotionAndCamera } from './lib/forest-capture-runtime.mjs';

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(studioDir, '..', '..');

const DEFAULT_VIEWPORT = { width: 1600, height: 1000 };
// 90s, not 45s: `settle-bridge-reports-settled-before-the-world-arrives`
// (frontend-appearance-repair-arc) measured GENUINE settle at 42-80s (load-dependent) on the live
// corpus this script captures against — a 45s default expired BEFORE the app could legitimately
// settle. It went unnoticed only because the predicate it fed had its own bug (reporting `settled:
// true` ~8s in, before the world had even arrived) that happened to mask the too-short timeout by
// returning early on a false positive; fixing that bug without raising this default would have
// started biting on the very next slow-corpus run. 90s carries margin above the observed ceiling.
const DEFAULT_SETTLE_TIMEOUT_MS = 90_000;
const DEFAULT_BRANCH_PORT = 5187;
const DEFAULT_BASELINE_PORT = 5188;
const READY_TIMEOUT_MS = 60_000;

function log(msg) {
  process.stderr.write(`[capture-comparative] ${msg}\n`);
}

function parseTargets(argv) {
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--resting' || flag === '--fit') targets.push({ kind: flag.slice(2) });
    else if (flag === '--story' && value !== undefined) { targets.push({ kind: 'story-node', id: value }); index += 1; }
    else if (flag === '--island' && value !== undefined) { targets.push({ kind: 'island', id: value }); index += 1; }
    else if (flag === '--square' && value !== undefined) {
      const [x, y, size] = value.split(',').map(Number);
      targets.push({ kind: 'square', x, y, size });
      index += 1;
    }
  }
  return targets;
}

function readArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg?.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(arg.slice(2));
      continue;
    }
    values.set(arg.slice(2), next);
    i += 1;
  }
  const viewport = (() => {
    const raw = values.get('viewport');
    if (!raw) return DEFAULT_VIEWPORT;
    const m = /^(\d+)x(\d+)$/.exec(raw);
    if (!m) throw new Error(`--viewport must be WIDTHxHEIGHT, got "${raw}"`);
    return { width: Number(m[1]), height: Number(m[2]) };
  })();
  return {
    out: values.get('output') ?? values.get('out') ?? path.join(repoRoot, '.gate-logs', 'frontend-capture', new Date().toISOString().replace(/[:.]/g, '-')),
    settleTimeoutMs: Number(values.get('settle-timeout-ms') ?? DEFAULT_SETTLE_TIMEOUT_MS),
    viewport,
    branchUrl: values.get('branch-url') ?? null,
    baselineUrl: values.get('baseline-url') ?? null,
    baselineRef: values.get('baseline-ref') ?? null,
    branchPort: Number(values.get('branch-port') ?? DEFAULT_BRANCH_PORT),
    baselinePort: Number(values.get('baseline-port') ?? DEFAULT_BASELINE_PORT),
    force: flags.has('force'),
    cleanWorktree: flags.has('clean-worktree'),
    help: flags.has('help'),
  };
}

function printHelp() {
  console.log(`
storytree forest compare — branch vs a baseline (default merge-base(origin/main, HEAD)),
same live corpus, both captures attested settled by the app itself.

  storytree forest compare --output <dir> --viewport <WxH> --padding <t,r,b,l> <targets...>

  --output <dir>         output directory (legacy direct-script alias: --out)
  --square <x,y,size>    frame an exact world-space square (repeatable)
  --story <id>           centre a story node (repeatable)
  --island <id>          fit a story island (repeatable)
  --resting              use the designed resting camera (repeatable)
  --fit                  fit the whole forest (repeatable)
  --settle-timeout-ms <ms>  how long to wait for window.__storytreeMotionSettled to attest settled,
                          per capture (default ${DEFAULT_SETTLE_TIMEOUT_MS}) — this is a timeout on the
                          real app signal, not a sleep; see waitForForestSettled (harness.mjs).
  --viewport WxH          capture viewport (default ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height})
  --branch-url <url>      skip provisioning; capture the branch render from this already-running URL
  --baseline-url <url>    skip provisioning; capture the baseline render from this already-running URL
  --baseline-ref <ref>    render the baseline from this commit-ish instead of
                          merge-base(origin/main, HEAD) — answers "is the CURRENT render right?"
                          rather than "did my branch change it?". Ignored when --baseline-url is given.
                          merge-base stays the default when this is omitted.
  --branch-port <n>       port for the branch's own dev server (default ${DEFAULT_BRANCH_PORT})
  --baseline-port <n>     port for the baseline worktree's dev server (default ${DEFAULT_BASELINE_PORT})
  --force                 capture even when the render-surface trigger says this branch didn't touch it
  --clean-worktree        remove the provisioned baseline worktree when done (default: kept, reused
                          by the next run when the resolved baseline ref hasn't moved)
  --help                  this text
`);
}

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * What this branch changes on top of `main` — the SAME question `pnpm gate --scope` asks
 * (gate-run.ts's own `localDiff`), reproduced here rather than imported because that function isn't
 * exported (only the classification it feeds, `localAffectedScope`, is — see gate-scope.ts's header
 * on the git-reading/judgement split). `merge-base` itself is returned too: it is also the commit
 * this script checks the baseline worktree out to.
 */
function localDiff() {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', 'origin/main', 'HEAD']);
  } catch (err) {
    return { mergeBase: null, diff: { ok: false, reason: `no merge-base with origin/main: ${err.message}` } };
  }
  if (!mergeBase) return { mergeBase: null, diff: { ok: false, reason: 'merge-base resolved to nothing' } };
  try {
    const tracked = git(['diff', '--name-only', '--no-renames', mergeBase]);
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    return { mergeBase, diff: { ok: true, files: [...gitLines(tracked), ...gitLines(untracked)] } };
  } catch (err) {
    return { mergeBase, diff: { ok: false, reason: `git diff/ls-files failed: ${err.message}` } };
  }
}

/** Resolve a commit-ish (branch, tag, sha, `HEAD~1`, …) to a concrete sha, or throw loudly — a
 *  `--baseline-ref` a caller mistyped must fail the run, never silently fall back to merge-base. */
function resolveRef(ref) {
  try {
    return git(['rev-parse', ref]);
  } catch (err) {
    throw new Error(`--baseline-ref "${ref}" did not resolve to a commit: ${err.message}`);
  }
}

function ensureBaselineWorktree(baselineSha, baselineDir) {
  const marker = path.join(baselineDir, '.git');
  if (existsSync(marker)) {
    try {
      const head = git(['rev-parse', 'HEAD'], baselineDir);
      if (head === baselineSha) {
        log(`reusing the existing baseline worktree at ${baselineDir} (already at ${baselineSha.slice(0, 10)})`);
        return { reused: true };
      }
      log(`baseline worktree at ${baselineDir} is at ${head.slice(0, 10)}, resolved baseline is ${baselineSha.slice(0, 10)} — checking it out`);
      git(['checkout', '--detach', baselineSha], baselineDir);
      return { reused: false, checkedOut: true };
    } catch (err) {
      log(`baseline worktree at ${baselineDir} looked stale/broken (${err.message}) — re-provisioning`);
      try {
        git(['worktree', 'remove', '--force', baselineDir]);
      } catch {
        /* fall through to a raw rm */
      }
      rmSync(baselineDir, { recursive: true, force: true });
    }
  }
  mkdirSync(path.dirname(baselineDir), { recursive: true });
  log(`cutting a fresh baseline worktree at ${baselineDir} (detached at ${baselineSha.slice(0, 10)})`);
  git(['worktree', 'add', '--detach', baselineDir, baselineSha]);
  return { reused: false, checkedOut: false };
}

/** `pnpm install` at `cwd`, non-interactive. Windows resolves the `pnpm.cmd` shim only through a
 *  shell (mirrors `dogfood-probe.run.ts` / `provision-worktree.mjs`'s own installer). */
function pnpmInstall(cwd) {
  const win = process.platform === 'win32';
  const res = win
    ? spawnSync('pnpm install --prefer-offline', { cwd, stdio: 'inherit', shell: true, timeout: 10 * 60_000 })
    : spawnSync('pnpm', ['install', '--prefer-offline'], { cwd, stdio: 'inherit', timeout: 10 * 60_000 });
  if (res.status !== 0) {
    throw new Error(`pnpm install failed in ${cwd} (status ${res.status ?? res.error?.message})`);
  }
}

/** Start `vite dev` for the studio app rooted at `cwd`, on `port`. Returns the child + a kill fn. */
function startDevServer(cwd, port, label) {
  log(`starting the ${label} dev server (cwd=${cwd}, port=${port})…`);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(cwd, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

/**
 * Wait for `url` to answer — and, when we started the server ourselves, notice if OUR OWN child died
 * first. `--strictPort` makes vite EXIT when the port is already held, and without this check the
 * loop would keep polling and then happily accept a `200` from whoever DOES hold it. Watching the
 * child turns that silent substitution into an immediate, named failure.
 */
async function waitForReady(url, timeoutMs, child = null) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `${url}: our own dev server exited (code ${child.exitCode}) before answering. ` +
          `With --strictPort that almost always means another session already holds this port — ` +
          `re-run with --branch-port / --baseline-port pointing at free ports.`,
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${url} did not answer within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Assert the server answering `url` really serves `expectedSha` before a single number is read off
 * it. See {@link verifyServedTree} for the measured failure this exists to stop; the short version is
 * that a port collision can hand this script a stranger's worktree and nothing downstream would
 * notice. Throws on any doubt — an unidentified tree is never measured.
 */
async function assertServedTree(url, expectedSha, label) {
  let health;
  try {
    const res = await fetch(`${url}/api/health`);
    health = await res.json();
  } catch (err) {
    throw new Error(
      `[capture-comparative] ${label}: could not read /api/health (${err?.message ?? err}) — ` +
        `refusing to measure a server whose tree cannot be confirmed.`,
    );
  }
  const verdict = verifyServedTree(health, expectedSha, label);
  if (!verdict.ok) throw new Error(`[capture-comparative] ${verdict.reason}`);
  const revision = health?.code?.startedAt;
  if (typeof revision !== 'string' || !/^[0-9a-f]{40,64}$/i.test(revision)) {
    throw new Error(`[capture-comparative] ${label}: /api/health has no usable code.startedAt served revision`);
  }
  log(`${label} server confirmed serving ${revision.slice(0, 12)}`);
  return revision;
}

function killTree(child, label) {
  if (!child) return;
  log(`stopping the ${label} dev server (pid ${child.pid})…`);
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* best-effort */
  }
}

async function readElementCounts(page) {
  const raw = await page.evaluate((sel) => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      parcelRects: Array.from(document.querySelectorAll(sel.parcel)).map(rectOf),
      worldCave: document.querySelectorAll(sel.worldCave).length,
      trailFill: document.querySelectorAll(sel.trailFill).length,
      parcelBlade: document.querySelectorAll(sel.parcelBlade).length,
    };
  }, CAPTURE_SELECTORS);
  return toRenderElementCounts(raw);
}

/** One arm owns one page for its whole target list. The app seam owns camera resolution; this
 * adapter only attests the delivered camera after two rendered frames and the real settle bridge. */
async function openArm(browser, url, viewport, settleTimeoutMs, label, revision) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(() => sessionStorage.setItem('storytree.act2.arrived', '1'));
  const page = await context.newPage();
  log(`[${label}] navigating to ${url}#/tree…`);
  await page.goto(`${url}/#/tree`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => typeof window.__storytreeForestCaptureCamera?.capture === 'function',
    undefined,
    { timeout: 120_000 },
  );
  let serial = 0;
  return {
    async capture(target, frame, padding) {
      await page.setViewportSize(frame);
      const seam = await page.evaluate(
        ({ requested, inset }) => window.__storytreeForestCaptureCamera.capture(requested, { captureFrame: inset }),
        { requested: target, inset: padding },
      );
      if (!seam?.ok) {
        const error = new Error(`[${label}] forest camera refused ${target.kind}: ${seam?.code ?? 'unknown refusal'}`);
        error.captureCode = seam?.code ?? 'capture-failed';
        throw error;
      }
      const attestation = await waitForForestMotionAndCamera(page, {
        timeout: settleTimeoutMs,
        expectedCamera: seam.camera,
      });
      serial += 1;
      const settled = {
        ...attestation,
        serial,
      };
      if (!settled.settled) throw new Error(`[${label}] delivered camera did not match the app receipt`);
      const png = await page.screenshot({ type: 'png', fullPage: false });
      return {
        receipt: {
          requested: target,
          resolved: seam.resolved,
          applied: seam.camera,
          viewport: frame,
          padding,
          revision,
          settled,
        },
        png,
      };
    },
    counts: () => readElementCounts(page),
    close: () => context.close(),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function targetLabel(target) {
  if (target.kind === 'square') return `square ${target.x},${target.y},${target.size}`;
  if (target.kind === 'story-node') return `story ${target.id}`;
  if (target.kind === 'island') return `island ${target.id}`;
  return target.kind;
}

async function renderContactSheet(browser, targets, content, viewport) {
  const thumbWidth = 560;
  const thumbHeight = Math.max(180, Math.min(420, Math.round(thumbWidth * viewport.height / viewport.width)));
  const rows = targets.map((target, index) => {
    const number = index + 1;
    const baseline = content.get(`baseline/forest-${number}.png`);
    const branch = content.get(`branch/forest-${number}.png`);
    if (!(baseline instanceof Uint8Array) || !(branch instanceof Uint8Array)) {
      throw new Error(`contact sheet is missing target ${number}`);
    }
    const image = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    return `<section><h2>${number}. ${escapeHtml(targetLabel(target))}</h2><div class="pair"><figure><figcaption>baseline</figcaption><img src="${image(baseline)}"></figure><figure><figcaption>branch</figcaption><img src="${image(branch)}"></figure></div></section>`;
  }).join('');
  const sheet = await browser.newPage({ viewport: { width: 1240, height: Math.min(16_000, targets.length * (thumbHeight + 100) + 40) } });
  try {
    await sheet.setContent(`<!doctype html><style>html{background:#151711;color:#f4f0df;font:15px system-ui}body{margin:20px}section{margin:0 0 24px}h2{font-size:17px;margin:0 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;background:#24271e;padding:10px}figcaption{font-weight:700;margin-bottom:7px}img{display:block;width:${thumbWidth}px;height:${thumbHeight}px;object-fit:contain;background:#10120d}</style>${rows}`, { waitUntil: 'load' });
    await sheet.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
    return await sheet.screenshot({ type: 'png', fullPage: true });
  } finally {
    await sheet.close();
  }
}

/** The signed core publishes every candidate only after pair validation. This writer adds one final
 * barrier: all paths rename together, and any failed rename removes the already-visible subset. */
class ComparativeCaptureFiles {
  constructor(output, expected, browser, targets, viewport) {
    this.output = path.resolve(output);
    this.expected = expected;
    this.browser = browser;
    this.targets = targets;
    this.viewport = viewport;
    this.candidates = new Map();
    this.content = new Map();
    this.publishWaiters = [];
    this.published = new Set();
    this.token = `${process.pid}-${Date.now()}`;
  }

  relative(finalPath) {
    return path.relative(this.output, path.resolve(finalPath)).replaceAll('\\', '/');
  }

  async writeCandidate(finalPath, original) {
    const absolute = path.resolve(finalPath);
    if (existsSync(absolute)) throw new Error(`refusing to overwrite existing comparative capture ${absolute}`);
    let content = original;
    if (this.relative(absolute) === 'contact-sheet.png') {
      content = await renderContactSheet(this.browser, this.targets, this.content, this.viewport);
      if (!(content instanceof Uint8Array) || content.byteLength === 0) throw new Error('contact sheet renderer returned an empty PNG');
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    const candidate = `${absolute}.candidate-${this.token}`;
    await writeFile(candidate, content, { flag: 'wx' });
    this.candidates.set(absolute, candidate);
    this.content.set(this.relative(absolute), content);
  }

  publish(finalPath) {
    const absolute = path.resolve(finalPath);
    return new Promise((resolve, reject) => {
      this.publishWaiters.push({ absolute, resolve, reject });
      if (this.publishWaiters.length === this.expected) void this.flush();
    });
  }

  async flush() {
    try {
      for (const { absolute } of this.publishWaiters) {
        const candidate = this.candidates.get(absolute);
        if (!candidate) throw new Error(`no comparative candidate exists for ${absolute}`);
        await rename(candidate, absolute);
        this.candidates.delete(absolute);
        this.published.add(absolute);
      }
      for (const waiter of this.publishWaiters) waiter.resolve();
    } catch (error) {
      for (const finalPath of this.published) await rm(finalPath, { force: true }).catch(() => {});
      for (const waiter of this.publishWaiters) waiter.reject(error);
    }
  }

  async removeCandidate(finalPath) {
    const absolute = path.resolve(finalPath);
    const candidate = this.candidates.get(absolute);
    if (candidate) await rm(candidate, { force: true }).catch(() => {});
    if (this.published.has(absolute)) await rm(absolute, { force: true }).catch(() => {});
    this.candidates.delete(absolute);
    this.published.delete(absolute);
  }
}

async function main() {
  const invocation = process.argv.slice(2);
  const fromCli = invocation[0] === 'forest' && invocation[1] === 'compare';
  const driverArgv = fromCli ? invocation.slice(2) : invocation;
  const args = readArgs(driverArgv);
  if (args.help) {
    printHelp();
    return 0;
  }

  let targets = parseTargets(driverArgv);
  // Preserve the package script's historical zero-target "opening frame" capture. The public CLI
  // is deliberately stricter: its semantic target is the whole point of the command.
  if (targets.length === 0 && !fromCli) targets = [{ kind: 'resting' }];
  if (targets.length === 0) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'invalid-target', message: 'forest compare needs at least one --square, --story, --island, --resting, or --fit target' })}\n`);
    return 1;
  }
  if (fromCli && (!driverArgv.includes('--output') || !driverArgv.includes('--viewport') || !driverArgv.includes('--padding'))) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'invalid-frame', message: 'forest compare requires --output, --viewport, and --padding' })}\n`);
    return 1;
  }
  const padding = (() => {
    const index = driverArgv.lastIndexOf('--padding');
    const raw = index === -1 ? '0,0,0,0' : driverArgv[index + 1];
    const values = raw?.split(',').map(Number) ?? [];
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new Error(`--padding must be t,r,b,l, got "${raw}"`);
    return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
  })();
  const targetArgv = targets.flatMap((target) => {
    if (target.kind === 'square') return ['--square', `${target.x},${target.y},${target.size}`];
    if (target.kind === 'story-node') return ['--story', target.id];
    if (target.kind === 'island') return ['--island', target.id];
    return [`--${target.kind}`];
  });
  const comparativeArgv = [
    'forest', 'compare', '--output', args.out,
    '--viewport', `${args.viewport.width}x${args.viewport.height}`,
    '--padding', `${padding.top},${padding.right},${padding.bottom},${padding.left}`,
    ...targetArgv,
  ];

  loadLocalSecrets(); // STORYTREE_DB_USER, for the live pg store both dev servers default to.

  const { mergeBase, diff } = localDiff();
  if (!args.force) {
    const projects = discoverWorkspaceProjects(repoRoot);
    const scope = localAffectedScope(diff, projects);
    const trigger = renderSurfaceTrigger(scope);
    log(`render-surface trigger: ${trigger.affected ? 'FIRES' : 'skips'} — ${trigger.reason}`);
    if (!trigger.affected) {
      log('nothing to capture (pass --force to capture anyway).');
      process.stdout.write(`${JSON.stringify({ ok: true, output: path.resolve(args.out), captures: 0, skipped: true })}\n`);
      return 0;
    }
  }
  if (!mergeBase) {
    console.error(`[capture-comparative] cannot resolve merge-base(origin/main, HEAD): ${diff.ok ? '' : diff.reason}`);
    return 1;
  }
  log(`merge-base(origin/main, HEAD) = ${mergeBase} (used for the render-surface trigger, and the baseline default)`);

  // The baseline capture's commit: an explicit --baseline-ref if given, else merge-base(origin/main,
  // HEAD) — unrelated to the trigger decision above, which always reasons about the branch's own diff.
  let baselineSha = mergeBase;
  let baselineSource = 'merge-base(origin/main, HEAD)';
  if (args.baselineRef) {
    baselineSha = resolveRef(args.baselineRef);
    baselineSource = `--baseline-ref "${args.baselineRef}"`;
    log(`explicit baseline ref: ${baselineSource} resolves to ${baselineSha}`);
  }

  mkdirSync(args.out, { recursive: true });

  let baselineWorktree = null;
  let branchProc = null;
  let baselineProc = null;
  const needsDb = args.branchUrl === null || args.baselineUrl === null;
  try {
    if (needsDb) {
      log('bringing the live store up (both dev servers default to the live pg store)…');
      const ready = await ensureLiveDb((m) => log(`[db] ${m}`));
      if (!ready.ok) {
        console.error(`[capture-comparative] the live store could not be brought up: ${ready.reason}`);
        return 1;
      }
    }

    const branchSha = git(['rev-parse', 'HEAD']);
    let branchUrl = args.branchUrl;
    if (branchUrl === null) {
      branchProc = startDevServer(studioDir, args.branchPort, 'branch');
      branchUrl = `http://127.0.0.1:${args.branchPort}`;
      await waitForReady(branchUrl, READY_TIMEOUT_MS, branchProc);
    }
    const branchRevision = await assertServedTree(branchUrl, branchSha, 'branch');

    let baselineUrl = args.baselineUrl;
    if (baselineUrl === null) {
      const scratchRoot = path.join(tmpdir(), 'storytree-frontend-capture');
      mkdirSync(scratchRoot, { recursive: true });
      // A DIFFERENT baseline sha than any cached dir gets its own path, so a stale worktree is never
      // silently reused across unrelated runs — old ones just accumulate under scratchRoot until
      // cleaned by hand or via --clean-worktree next time the SAME baseline sha recurs.
      baselineWorktree = path.join(scratchRoot, `baseline-${baselineSha.slice(0, 12)}`);
      ensureBaselineWorktree(baselineSha, baselineWorktree);
      log('provisioning the baseline worktree (pnpm install — this is the expensive step)…');
      pnpmInstall(baselineWorktree);
      const baselineStudioDir = path.join(baselineWorktree, 'apps', 'studio');
      baselineProc = startDevServer(baselineStudioDir, args.baselinePort, 'baseline');
      baselineUrl = `http://127.0.0.1:${args.baselinePort}`;
      await waitForReady(baselineUrl, READY_TIMEOUT_MS, baselineProc);
    }
    const baselineRevision = await assertServedTree(baselineUrl, baselineSha, 'baseline');

    const browser = await chromium.launch({ headless: true });
    let baselineArm;
    let branchArm;
    const counts = {};
    let lastCaptureCode = null;
    try {
      baselineArm = await openArm(browser, baselineUrl, args.viewport, args.settleTimeoutMs, 'baseline', baselineRevision);
      branchArm = await openArm(browser, branchUrl, args.viewport, args.settleTimeoutMs, 'branch', branchRevision);
      const arms = { baseline: baselineArm, branch: branchArm };
      const files = new ComparativeCaptureFiles(args.out, targets.length * 4 + 2, browser, targets, args.viewport);
      const result = await captureComparativeForest(comparativeArgv, {
        async capture(arm, target, viewport, inset) {
          try {
            return await arms[arm].capture(target, viewport, inset);
          } catch (error) {
            lastCaptureCode = error?.captureCode ?? 'capture-failed';
            throw error;
          }
        },
        async elementCounts(arm) {
          counts[arm] = await arms[arm].counts();
          return counts[arm];
        },
        writeCandidate: (file, content) => files.writeCandidate(file, content),
        publish: (file) => files.publish(file),
        removeCandidate: (file) => files.removeCandidate(file),
      });
      if (!result.ok) {
        process.stdout.write(`${JSON.stringify({ ok: false, code: lastCaptureCode ?? result.code, message: 'comparative capture refused before publishing a complete review set' })}\n`);
        return 1;
      }
    } finally {
      await baselineArm?.close().catch(() => {});
      await branchArm?.close().catch(() => {});
      await browser.close();
    }

    const branchLabel = `BRANCH (${git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD'})`;
    const baselineLabel = `BASELINE (${baselineSource} ${baselineSha.slice(0, 10)})`;
    const rows = computeCaptureDelta(counts.baseline, counts.branch);
    const table = formatCaptureComparisonTable(baselineLabel, branchLabel, rows);

    const report = [
      '# Forest map — corpus-scale comparative capture',
      '',
      `baseline: ${baselineSource} = \`${baselineSha}\` (trigger merge-base: \`${mergeBase}\`) · ` +
        `viewport ${args.viewport.width}x${args.viewport.height} · ` +
        `settle: app-attested via window.__storytreeMotionSettled (timeout ${args.settleTimeoutMs}ms)`,
      '',
      table,
      '',
      '## Raw counts',
      '',
      '```json',
      JSON.stringify(counts, null, 2),
      '```',
      '',
      `Review set: \`contact-sheet.png\`, \`index.json\`, and ${targets.length} target pair(s) under \`baseline/\` and \`branch/\`.`,
      '',
    ].join('\n');
    try {
      writeFileSync(path.join(args.out, 'comparison.md'), report, 'utf8');
    } catch (error) {
      // The signed transaction has already published its complete index/contact-sheet set. This
      // legacy prose rendering is a convenience view, not a reason to misreport that transaction.
      log(`review set published, but comparison.md could not be written: ${error?.message ?? error}`);
    }

    process.stderr.write(`${table}\n\nWritten to: ${args.out}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, output: path.resolve(args.out), captures: targets.length })}\n`);
    return 0;
  } finally {
    killTree(branchProc, 'branch');
    killTree(baselineProc, 'baseline');
    if (args.cleanWorktree && baselineWorktree) {
      log(`removing the baseline worktree at ${baselineWorktree} (--clean-worktree)…`);
      try {
        git(['worktree', 'remove', '--force', baselineWorktree]);
      } catch {
        rmSync(baselineWorktree, { recursive: true, force: true });
      }
    } else if (baselineWorktree) {
      log(`baseline worktree kept at ${baselineWorktree} for reuse (pass --clean-worktree to remove it).`);
    }
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ ok: false, code: err?.captureCode ?? 'driver-failed', message })}\n`);
    log(`unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  },
);
