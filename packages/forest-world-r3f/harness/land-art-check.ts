/* gate-check
runs: both
subject: own-work
cost: seconds
skip:
  when: >-
    Playwright's Chromium was never downloaded in this checkout, so no page can be driven — the ONLY
    skippable condition, deliberately: vite failing, a page 404ing or capture crashing are all reds.
    A skip here audits NOTHING, so it is printed as such rather than as a narrowing
  inCi: failure
why: >-
  reds when the land art is wrong. ADR-0418 D3 lifted the closed-palette fence on
  `forest-world-r3f/harness/` and D4 required a replacement that can still FAIL; PR #1673 built it
  into `capture.mjs` and mutation-tested it, and then nothing ever ran it — it appeared in no gate
  step, in no CI step, and is not reachable from the package's `test` script, which collects
  `*.test.ts` while capture is a `.mjs` driver. An instrument that CAN fail, that no build asks,
  cannot fail a build, which is what this arc's fence 3 requires. The rung starts its own vite
  server on an ephemeral port (so a sibling worktree's harness on the pinned 5184 cannot answer it),
  drives the three pages that between them carry all three parts of D4, and refuses both when
  `capture.mjs` refuses AND when a page audited less than it is declared to prove — the second being
  the half capture cannot assert about the run it is inside. ~29 s, browser-backed but
  SwiftShader-only, so it needs no GPU
*/
// land-art-check.ts — THE RUNG THAT ASKS. `pnpm check:land-art`.
//
// ADR-0418 D4 required a check that can still fail once the closed palette is lifted, and PR #1673
// built it: `capture.mjs` carries all three parts and six hand-run mutations proved each refuses.
// Arc fence 3 is nonetheless still true, for a reason the arc had not noticed, and it is the reason
// this file exists:
//
//   an instrument that CAN fail, that no build ever runs, cannot fail A BUILD.
//
// Established by direct search on this branch, not assumed. `capture.mjs` appears in NO step of the
// gate plan (`packages/cli/src/gate-order.ts`), in NO step of `.github/workflows/ci.yml`, and is not
// reachable from the package's own `test` script — `bun test src/ harness/` collects `*.test.ts`,
// and capture is a `.mjs` driver. It is `pnpm --filter … capture`: a verb a human types, against a
// vite server that human also started. Break the land art tomorrow and `pnpm gate` goes green.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It adds THREE things and re-implements nothing:
//
//  1. IT STARTS ITS OWN SERVER, on a port it did not pick. Every existing driver in this harness
//     requires a human to run `vite harness --port <free>` first, which is the structural reason
//     none of them could ever be a rung. It also addresses a recorded friction: `vite.config.ts`
//     pins `strictPort: 5184` for EVERY worktree, so a sibling worktree's harness left running on
//     the default port means you measure ITS tree and report the number as yours
//     (`capture-default-url-is-a-port-a-sibling-worktree-may-own`, measured 2026-08-22). Since
//     2026-09-16 `capture.mjs` also refuses, on its own, any page whose server stamps a directory
//     other than its own (`served-tree.ts`), so a squatter now costs a refusal rather than a false
//     green — and starting a server here keeps it from costing even that.
//
//     ⚠ AND `port: 0` DOES NOT MEAN WHAT IT MEANS EVERYWHERE ELSE — measured, because the first
//     draft of this file asserted otherwise in its own comment. Vite does not hand `0` to the OS
//     for an ephemeral port; it SCANS UPWARD from its default and takes the first free one. Two
//     back-to-back servers came up on 5174 and 5175, not on anything ephemeral. That is fine for
//     concurrency (two land-art runs get different ports, which is what a sibling gate needs) and
//     it is NOT fine as a guarantee: with 5173-5183 occupied the scan reaches 5184 and photographs
//     the sibling's tree. So the guarantee is asserted rather than assumed — see `PINNED_PORT`.
//
//  2. IT DRIVES THE WHOLE SET, because no single page proves all three parts of D4 — see the
//     measured table in `land-art-coverage.ts`. Three of the four candidate pages print, in terms,
//     that a whole half of D4 checked nothing on them.
//
//  3. IT REFUSES A PAGE THAT AUDITED LESS THAN IT IS DECLARED TO, and refuses a declaration SET that
//     has stopped covering one of D4's three parts. That is the anti-vacuity half, and it is the
//     half `capture.mjs` cannot supply for itself: its own coverage is exactly what a script cannot
//     assert about the run it is inside.
//
// It re-implements NO readback and NO refusal. `capture.mjs` is spawned as a subprocess and its exit
// code is propagated verbatim. This arc has already paid for the alternative — it carries three
// ~700-line compositor copies and a fork detector that had to be built because nothing noticed they
// had diverged. A second copy of the palette tally here would be that mistake a fourth time.
//
// ⚠ IT WRITES TO SCRATCH, NEVER TO THE COMMITTED EVIDENCE. Pointed at its default output,
// `capture.mjs` rewrites 22 committed files under `docs/research/chapter2-live-render-2026-08-19/`.
// A gate rung that dirties the working tree on every run is one that gets `git checkout .`-ed away
// along with whatever else was in the diff. `ST_OUT_DIR` goes to `.capture-scratch/`, which
// `.gitignore` already carries for precisely this purpose.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LAND_ART_PAGES,
  checkDeclarationCoverage,
  checkPageCoverage,
  readCoverage,
  type CoverageFault,
} from './land-art-coverage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(HERE, '../../..');
const SCRATCH_REL = '.capture-scratch/land-art';

/** Reserved by the gate runner: "this step ran and had nothing to check" (declared in this file's own `skip:` header). */
const EXIT_SKIP = 3;

function refuse(lines: readonly string[]): never {
  console.error('');
  console.error('REFUSED: the land art rung.');
  for (const l of lines) console.error(`  ${l}`);
  process.exit(1);
}

// ── PREFLIGHT ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE SKIP IS NARROW ON PURPOSE, AND IT IS THE MOST DANGEROUS LINE IN THIS FILE. A rung that
// skips when it cannot run is one keystroke from a rung that skips forever — the browser stops
// resolving on some machine, the step reports SKIP in a colour nobody reads, and the art has been
// unguarded for a month. So the ONLY skippable condition is a Playwright browser that was never
// downloaded, which is a fresh-checkout fact with an exact remedy printed beside it. Everything
// else — vite failing, a page 404ing, capture crashing — is a RED. In particular this does NOT skip
// when the branch "looks like it did not touch the art": the whole run is ~27 s measured, and a
// diff-conditional skip would be a second vacuity path bought for no meaningful saving.
async function preflight(): Promise<string | null> {
  let chromium: { executablePath(): string };
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    return '@playwright/test is not installed in this workspace';
  }
  let exe: string;
  try {
    exe = chromium.executablePath();
  } catch (err) {
    return `Playwright cannot resolve a Chromium build (${String(err)})`;
  }
  if (!existsSync(exe)) return `Playwright's Chromium is not downloaded (${exe} does not exist)`;
  return null;
}

const missing = await preflight();
if (missing !== null) {
  console.log(`[land-art] SKIP — ${missing}.`);
  console.log('[land-art] Install it with:  pnpm exec playwright install chromium');
  console.log(
    '[land-art] ⚠ SKIP IS NOT A PASS. Nothing audited the art on this run; ADR-0418 D4 asserts ' +
      'nothing here until the browser is present.',
  );
  process.exit(EXIT_SKIP);
}

// ── THE SERVER ──────────────────────────────────────────────────────────────────────────────

const { createServer } = await import('vite');
// This overrides the config file's pinned `strictPort: 5184`. ⚠ `port: 0` here does NOT mean an
// OS-assigned ephemeral port — vite scans upward from its own default and takes the first free one
// (measured: 5174, then 5175). `strictPort: false` is what lets it move at all. The guarantee that
// it never lands on the pinned port is the assertion below, not this option.
const server = await createServer({
  configFile: join(HERE, 'vite.config.ts'),
  root: HERE,
  logLevel: 'warn',
  server: { port: 0, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls?.local?.[0];
if (base === undefined) {
  await server.close();
  refuse(['the harness dev server started but reported no local URL, so no page could be driven.']);
}

// THE ONE PORT THIS RUNG MAY NEVER LAND ON, asserted rather than hoped for. Read off the config
// rather than restated, so a change to the pin cannot leave this guard checking a stale number —
// which is the whole `moving-a-write-target-makes-old-readers-vacuously-green` shape.
const PINNED_PORT: unknown = (await import('./vite.config.js')).default?.server?.port;
const resolvedPort = Number(new URL(base).port);
if (typeof PINNED_PORT === 'number' && resolvedPort === PINNED_PORT) {
  await server.close();
  refuse([
    `the harness came up on ${resolvedPort}, which is the port \`vite.config.ts\` pins for EVERY`,
    'worktree. A sibling worktree may already be serving its own tree there, and photographing it',
    'would report ITS art as this branch\'s. Free the port (or the ports below it) and re-run.',
  ]);
}
console.log(
  `[land-art] harness on ${base}  (scanned free port, not the pinned ${String(PINNED_PORT)} — a ` +
    "sibling worktree's harness cannot answer this run)",
);

// ── DRIVE EACH PAGE ─────────────────────────────────────────────────────────────────────────

interface PageResult {
  readonly page: string;
  readonly captureExit: number;
  readonly captureTail: string;
  readonly coverage: readonly CoverageFault[];
  readonly reportError: string | null;
}

function runCapture(page: string, outRel: string, expectPropCanvases: number): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        // ⚠ A `file://` URL, NOT A PATH, AND ON WINDOWS THAT IS THE DIFFERENCE BETWEEN A RUNG
        // THAT RUNS AND ONE THAT CANNOT. `--import` takes an ESM specifier, and an absolute
        // Windows path begins `C:\`, which Node's loader reads as an unknown URL SCHEME — every
        // capture died instantly with `ERR_UNSUPPORTED_ESM_URL_SCHEME` and a stack trace that
        // names only Node's own loader, so the rung reported three art failures that were
        // nothing to do with the art. `--import 'tsx'` is a bare specifier and was always fine;
        // it is the joined path that has to be converted.
        '--import',
        pathToFileURL(join(REPO, 'scripts/tsx-cache-off.mjs')).href,
        '--import',
        'tsx',
        join(HERE, 'capture.mjs'),
      ],
      {
        cwd: PKG,
        env: {
          ...process.env,
          ST_HARNESS_URL: `${base}${page}`,
          ST_OUT_DIR: outRel,
          // Reuse capture's OWN coverage knob rather than adding a second one beside it. Its header
          // explains why it exists: "if the page's tags stopped resolving … the run would go green
          // having verified nothing about any prop."
          ST_EXPECT_PROP_CANVASES: String(expectPropCanvases),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (b: Buffer) => (out += b.toString()));
    child.stderr.on('data', (b: Buffer) => (out += b.toString()));
    child.on('close', (code) => {
      const lines = out.trimEnd().split('\n');
      resolve({ code: code ?? 1, tail: lines.slice(-14).join('\n') });
    });
  });
}

const results: PageResult[] = [];

try {
  rmSync(join(REPO, SCRATCH_REL), { recursive: true, force: true });

  for (const declared of LAND_ART_PAGES) {
    const outRel = `${SCRATCH_REL}/${declared.page.replace(/\.html$/, '')}`;
    const started = Date.now();
    const { code, tail } = await runCapture(declared.page, outRel, declared.minPropIslands);
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    // The report is written BEFORE capture's refusals fire — deliberately, so a breach still leaves
    // the evidence to diagnose it from. So coverage is readable whatever the exit code was, and a
    // page that failed on the art is still asked whether it audited what it claims to.
    let coverage: readonly CoverageFault[] = [];
    let reportError: string | null = null;
    const reportPath = join(REPO, outRel, 'capture-report.json');
    try {
      const parsed: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
      coverage = checkPageCoverage(declared, readCoverage(parsed));
    } catch (err) {
      reportError = String(err instanceof Error ? err.message : err);
    }

    const verdict = code === 0 && coverage.length === 0 && reportError === null ? 'ok' : 'XX';
    console.log(`[land-art] ${verdict} ${declared.page.padEnd(17)} capture exit ${code}  ${secs}s`);
    results.push({ page: declared.page, captureExit: code, captureTail: tail, coverage, reportError });
  }
} finally {
  await server.close();
}

// ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────

const faults: string[] = [];

// (a) THE DECLARATION SET ITSELF. Checked first and unconditionally, because every other fault below
//     is a page failing to deliver what it declared — and none of them fires if the DECLARATION is
//     what shrank. Drop `grain.html` from the set and the other two pass perfectly.
for (const d of checkDeclarationCoverage()) {
  faults.push(`DECLARATION — ${d.half}: ${d.detail}`);
}

// (b) THE ART. `capture.mjs`'s own refusal, propagated verbatim with the tail of its output, because
//     that tail names WHICH rung fired and on which canvas.
for (const r of results) {
  if (r.captureExit !== 0) {
    faults.push(`ART — ${r.page} — capture.mjs exited ${r.captureExit}:\n${indent(r.captureTail)}`);
  }
}

// (c) COVERAGE. What the page audited, against what it is declared to prove. This fires on a green
//     capture run, which is the entire point: it is the half that catches an instrument quietly
//     ceasing to be asked.
for (const r of results) {
  if (r.reportError !== null) {
    faults.push(`COVERAGE — ${r.page} — could not read what was audited: ${r.reportError}`);
  }
  for (const f of r.coverage) {
    faults.push(
      `COVERAGE — ${r.page} [${f.dimension}] delivered ${f.delivered}, declared at least ` +
        `${f.declared}. ${f.detail}`,
    );
  }
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => `    | ${l}`)
    .join('\n');
}

if (faults.length) refuse(faults);

const totals = results.length;
console.log('');
console.log(
  `[land-art] PASS — ${totals} pages audited; every page delivered the coverage it declares, and ` +
    "the declared set still covers all three parts of ADR-0418 D4.",
);
