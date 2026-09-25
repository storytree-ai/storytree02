// One browser-side implementation for `storytree forest capture`. The CLI only forwards argv here:
// Playwright, Vite lifecycle and filesystem publication remain owned by Studio.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ensureLiveDb, loadLocalSecrets } from '@storytree/drive';
import { captureForestSemantics } from '../../../packages/cli/src/forest-semantic-capture.ts';
import { readMotionSettled, waitForForestSettled } from '../../desktop/e2e/harness.mjs';

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(studioDir, '..', '..');
const READY_TIMEOUT_MS = 90_000;
const PAGE_TIMEOUT_MS = 120_000;

const log = (message) => process.stderr.write(`[forest-capture] ${message}\n`);

function flagValue(argv, flag) {
  const index = argv.lastIndexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function targetCount(argv) {
  return argv.filter((arg) => ['--square', '--story', '--island', '--resting', '--fit'].includes(arg)).length;
}

function normalizeUrl(value) {
  return value.replace(/\/+$/, '');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error('could not allocate a capture port')));
    });
  });
}

async function waitForReady(url, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Studio exited with code ${child.exitCode} before ${url} became ready`);
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Still warming.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Studio did not answer ${url}/api/health within ${READY_TIMEOUT_MS}ms`);
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function startStudio() {
  loadLocalSecrets();
  const ready = await ensureLiveDb((message) => log(`[db] ${message}`));
  if (!ready.ok) throw new Error(`the live store could not be brought up: ${ready.reason}`);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      '--import', path.join(repoRoot, 'scripts', 'tsx-cache-off.mjs'),
      '--import', 'tsx', path.join(studioDir, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(port), '--strictPort', '--host', '127.0.0.1',
    ],
    { cwd: studioDir, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => process.stderr.write(`[forest-capture:studio] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[forest-capture:studio] ${chunk}`));
  try {
    await waitForReady(url, child);
  } catch (error) {
    stopServer(child);
    throw error;
  }
  return { url, child, async close() { stopServer(child); } };
}

function parseCameraTransform(transform) {
  const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
  const match = new RegExp(`^translate\\((${number})[ ,]+(${number})\\)\\s*scale\\((${number})\\)$`, 'i').exec(transform ?? '');
  if (!match) throw new Error(`the delivered g.world-camera transform is not readable: ${String(transform)}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

function sameCamera(left, right) {
  return left.tx === right.tx && left.ty === right.ty && left.scale === right.scale;
}

async function openPage(studioUrl, browserEndpoint, onCaptureRefusal) {
  const suppliedBrowser = browserEndpoint !== undefined;
  let browser;
  let context;
  let page;
  try {
    browser = suppliedBrowser
      ? await chromium.connectOverCDP(browserEndpoint)
      : await chromium.launch({ headless: true });
    context = await browser.newContext({ deviceScaleFactor: 1 });
    await context.addInitScript(() => sessionStorage.setItem('storytree.act2.arrived', '1'));
    page = await context.newPage();
    await page.goto(`${normalizeUrl(studioUrl)}/#/tree`, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await page.waitForFunction(
      () => typeof window.__storytreeForestCaptureCamera?.capture === 'function',
      undefined,
      { timeout: PAGE_TIMEOUT_MS },
    );
  } catch (error) {
    await context?.close().catch(() => {});
    if (!suppliedBrowser) await browser?.close().catch(() => {});
    throw error;
  }

  let serial = 0;
  return {
    async capture(target, viewport, padding) {
      await page.setViewportSize(viewport);
      // The app owns camera state. The second argument is deliberately passed through for the
      // padding-aware seam; older pages ignore extra JS arguments rather than being mutated here.
      const receipt = await page.evaluate(
        ({ requested, frame, inset }) => window.__storytreeForestCaptureCamera.capture(requested, { viewport: frame, padding: inset }),
        { requested: target, frame: viewport, inset: padding },
      );
      if (!receipt?.ok) {
        onCaptureRefusal(receipt?.code ?? 'capture-failed');
        const error = new Error(`the forest camera refused ${target.kind}: ${receipt?.code ?? 'unknown refusal'}`);
        error.captureCode = receipt?.code ?? 'capture-failed';
        throw error;
      }
      return receipt;
    },
    async settledAfter(expected) {
      // Cross at least one rendered frame after the command, then ask the app's real signal. A
      // fixed sleep would attest the clock, not the forest.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await waitForForestSettled(page, { timeout: PAGE_TIMEOUT_MS });
      const delivered = await page.locator('g.world-camera').getAttribute('transform');
      const camera = parseCameraTransform(delivered);
      const snapshot = await readMotionSettled(page);
      serial += 1;
      return {
        ...snapshot,
        settled: snapshot.settled && sameCamera(expected, camera),
        camera,
        serial,
      };
    },
    async screenshot() {
      return page.screenshot({ type: 'png', fullPage: false });
    },
    async close() {
      await context.close().catch(() => {});
      // A supplied CDP browser remains the caller's resource. Ending this Node process drops only
      // our transport; closing it here would terminate somebody else's browser.
      if (!suppliedBrowser) await browser.close().catch(() => {});
    },
  };
}

/** Candidate writer used by the signed command: both atomic renames complete or neither stays. */
export class AtomicCaptureFiles {
  constructor(token = `${process.pid}-${Date.now()}`) {
    this.token = token;
    this.candidates = new Map();
    this.publishQueue = [];
    this.publishedDuringPair = new Set();
  }

  async writeCandidate(finalPath, content) {
    const absolute = path.resolve(finalPath);
    if (existsSync(absolute)) throw new Error(`refusing to overwrite existing capture ${absolute}`);
    await mkdir(path.dirname(absolute), { recursive: true });
    const candidate = `${absolute}.candidate-${this.token}`;
    await writeFile(candidate, content, { flag: 'wx' });
    this.candidates.set(absolute, candidate);
  }

  async publish(finalPath) {
    const absolute = path.resolve(finalPath);
    this.publishQueue.push(absolute);
    if (this.publishQueue.length < 2) return;
    const pair = this.publishQueue.splice(0, 2);
    const stems = pair.map((entry) => entry.replace(/\.(?:png|json)$/, ''));
    if (stems[0] !== stems[1] || !pair[0].endsWith('.png') || !pair[1].endsWith('.json')) {
      throw new Error('capture publication expected one PNG/JSON pair');
    }
    try {
      for (const final of pair) {
        const candidate = this.candidates.get(final);
        if (!candidate) throw new Error(`no candidate exists for ${final}`);
        await rename(candidate, final);
        this.publishedDuringPair.add(final);
        this.candidates.delete(final);
      }
      this.publishedDuringPair.clear();
    } catch (error) {
      for (const final of this.publishedDuringPair) await rm(final, { force: true }).catch(() => {});
      this.publishedDuringPair.clear();
      throw error;
    }
  }

  async removeCandidate(finalPath) {
    const absolute = path.resolve(finalPath);
    const candidate = this.candidates.get(absolute);
    if (candidate) await rm(candidate, { force: true }).catch(() => {});
    this.candidates.delete(absolute);
    if (this.publishedDuringPair.has(absolute)) await rm(absolute, { force: true }).catch(() => {});
    this.publishedDuringPair.delete(absolute);
    this.publishQueue = this.publishQueue.filter((entry) => entry !== absolute);
  }
}

export async function runSemanticCapture(inputArgv) {
  let argv = [...inputArgv];
  const browserEndpoint = flagValue(argv, '--browser');
  let studioUrl = flagValue(argv, '--studio-url');
  let prestarted = null;
  const openedPages = new Set();
  let lastCaptureCode = null;
  const files = new AtomicCaptureFiles();

  // The signed core's supplied-browser route intentionally owns no server. Supply that missing
  // lifecycle here, then make the URL explicit before the core parses the invocation.
  if (browserEndpoint !== undefined && studioUrl === undefined) {
    prestarted = await startStudio();
    studioUrl = prestarted.url;
    argv = [...argv, '--studio-url', studioUrl];
  }

  const connect = async (url) => {
    studioUrl = normalizeUrl(url);
    try {
      const page = await openPage(studioUrl, browserEndpoint, (code) => { lastCaptureCode = code; });
      openedPages.add(page);
      return page;
    } catch (error) {
      if (error?.captureCode) lastCaptureCode = error.captureCode;
      throw error;
    }
  };

  const deps = {
    connect,
    async start() {
      const server = await startStudio();
      studioUrl = server.url;
      try {
        const page = await connect(server.url);
        return { browser: page, studioUrl: server.url, close: server.close };
      } catch (error) {
        await server.close();
        throw error;
      }
    },
    async revision() {
      if (!studioUrl) return null;
      try {
        const response = await fetch(`${studioUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
        const health = await response.json();
        // `startedAt` names the code the server process loaded. Once the checkout has moved beneath
        // that process, neither that stamp nor `head` can honestly name the rendered page.
        if (health?.code?.stale === true) return null;
        const revision = health?.code?.startedAt;
        return typeof revision === 'string' && /^[0-9a-f]{40,64}$/.test(revision) ? revision : null;
      } catch {
        return null;
      }
    },
    writeCandidate: (file, content) => files.writeCandidate(file, content),
    publish: (file) => files.publish(file),
    removeCandidate: (file) => files.removeCandidate(file),
  };

  try {
    const result = await captureForestSemantics(argv, deps);
    return result.ok ? result : { ok: false, code: lastCaptureCode ?? result.code };
  } finally {
    for (const page of openedPages) await page.close().catch(() => {});
    if (prestarted) await prestarted.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const output = flagValue(argv, '--output');
  try {
    const result = await runSemanticCapture(argv);
    const payload = result.ok
      ? { ok: true, output: output ? path.resolve(output) : undefined, captures: targetCount(argv) }
      : { ok: false, code: result.code, message: `no capture was published for the refused target (${result.code})` };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error?.captureCode ?? 'driver-failed', message: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
