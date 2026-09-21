// capture-output.test.ts — the read-only fence, and the source guard that keeps `capture.mjs`
// inside it.
//
// THE PROPERTY EVERYTHING HERE EXISTS FOR: a read-only run writes NOTHING. That cannot be proved
// end-to-end without a browser, a dev server and a minute of wall clock, so it is proved in two
// halves that together imply it — every write in the driver goes through one of two helpers (or the
// one guarded `mkdirSync`), and both helpers return before writing when the fence is up. A test that
// only exercised `parseReadOnly` would prove the flag parses and leave the thing the flag is FOR
// unproven, which is the exact shape of vacuous green this harness has already produced once.
//
// THE SECOND PROPERTY, easier to miss and equally load-bearing: UNSET STILL WRITES. Every existing
// caller depends on it, and a flag that shifted the default would break all of them to fix one.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { READ_ONLY_ENV, describeWrites, parseReadOnly } from './capture-output.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The driver this module fences, read as text for the source guards below. */
function driverSource(): string {
  return readFileSync(join(HERE, 'capture.mjs'), 'utf8');
}

/** Assert a parse succeeded and return the mode it resolved to. */
function modeOf(raw: string | undefined): boolean {
  const decision = parseReadOnly(raw);
  assert.equal(decision.ok, true, decision.ok ? '' : decision.refusal);
  assert.ok(decision.ok);
  return decision.readOnly;
}

// --- the default -----------------------------------------------------------------------------

test('unset and empty leave the run writing, because every existing caller depends on that', () => {
  assert.equal(modeOf(undefined), false);
  assert.equal(modeOf(''), false);
  assert.equal(modeOf('   '), false);
});

// --- the accepted vocabulary -----------------------------------------------------------------

test('every affirmative spelling turns the fence on', () => {
  for (const raw of ['1', 'true', 'yes', 'on']) assert.equal(modeOf(raw), true, raw);
});

test('every negative spelling leaves it off', () => {
  for (const raw of ['0', 'false', 'no', 'off']) assert.equal(modeOf(raw), false, raw);
});

test('case and surrounding whitespace do not change the answer', () => {
  for (const raw of ['TRUE', ' True ', '\tYES\n', 'On']) assert.equal(modeOf(raw), true, raw);
  for (const raw of ['FALSE', ' Off ', 'NO']) assert.equal(modeOf(raw), false, raw);
});

// --- the refusal -------------------------------------------------------------------------------

test('an unreadable value is refused rather than resolved to either mode', () => {
  // A typo is the case this matters for. Falling back to the default would rewrite the committed
  // evidence the caller just asked to protect, and say nothing about having done so — which is the
  // original failure, arriving through the very flag added to prevent it. `y` and `t` are in here
  // deliberately: they are the plausible near-misses, and a lenient prefix match would accept them.
  for (const raw of ['ture', 'y', 't', 'nope', 'readonly', '2', '-1', 'null']) {
    const decision = parseReadOnly(raw);
    assert.equal(decision.ok, false, `expected ${JSON.stringify(raw)} to be refused`);
  }
});

test('the refusal names the offending value and both accepted vocabularies', () => {
  const decision = parseReadOnly('ture');
  assert.ok(!decision.ok);
  // Pinned whole rather than probed, so a rewrite that drops the guidance has to say so here.
  assert.equal(
    decision.refusal,
    'ST_READ_ONLY="ture" is not a value I can read. Use one of 1, true, yes, on to run the audit ' +
      'WITHOUT writing, or one of 0, false, no, off (or leave it unset) to write the evidence as ' +
      'usual. Refusing rather than picking one, because guessing wrong here either destroys the ' +
      'evidence you asked for or rewrites the committed evidence you asked to protect.',
  );
});

// --- what the run says it did ------------------------------------------------------------------

test('a writing run reports its file count and the directory the caller would spell', () => {
  assert.equal(
    describeWrites({ readOnly: false, dir: 'docs/research/chapter2-live-render-2026-08-19', files: ['a.png', 'b.png'] }),
    'wrote      : 2 files -> docs/research/chapter2-live-render-2026-08-19',
  );
});

test('one file is not reported as "1 files"', () => {
  assert.equal(
    describeWrites({ readOnly: false, dir: 'out', files: ['only.png'] }),
    'wrote      : 1 file -> out',
  );
});

test('a writing run that wrote nothing still says so', () => {
  assert.equal(describeWrites({ readOnly: false, dir: 'out', files: [] }), 'wrote      : 0 files -> out');
});

test('a read-only run names what it suppressed AND that a refusal has nothing to diagnose from', () => {
  // Pinned whole. The second line is not decoration: the driver collects its palette, prop and
  // colour-spread refusals LAST specifically so a breach leaves the evidence on disk, and this mode
  // voids that. A reader who hits a refusal here would otherwise go looking for pictures that were
  // never written.
  assert.equal(
    describeWrites({ readOnly: true, dir: 'docs/research/chapter2-live-render-2026-08-19', files: ['a.png', 'b.png'] }),
    'wrote      : NOTHING — ST_READ_ONLY is set; 2 files suppressed, would have gone to ' +
      'docs/research/chapter2-live-render-2026-08-19\n' +
      '             a refusal below therefore has no pictures or report to diagnose from — ' +
      're-run without ST_READ_ONLY to keep them',
  );
});

test('both modes line up with the labels the driver already prints', () => {
  // The driver's tail is a column of `label      : value`. A summary that did not line up would be
  // the one line in the output that looks like a different program wrote it.
  const label = (s: string) => s.split('\n')[0]!.split(':')[0]!;
  assert.equal(label(describeWrites({ readOnly: false, dir: 'out', files: [] })), 'wrote      ');
  assert.equal(label(describeWrites({ readOnly: true, dir: 'out', files: [] })), 'wrote      ');
  assert.equal(label(describeWrites({ readOnly: false, dir: 'out', files: [] })).length, 'frame p50  '.length);
});

// --- the source guards: the driver stays inside the fence ---------------------------------------

test('every write in capture.mjs goes through a helper or the one guarded mkdir', () => {
  // DELIBERATELY BRITTLE, and this is the point: the read-only fence is worth exactly as much as the
  // least careful future edit to the driver, and the way it fails is a sixth write site added by
  // someone who never read this file. Pinning the write lines whole means such an edit cannot land
  // without re-blessing them HERE, where the reason is written down. To re-bless: run the suite, read
  // the diff, and satisfy yourself the new line is either inside a helper or behind `!READ_ONLY`.
  const writeLines = driverSource()
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => !line.startsWith('//'))
    .filter((line) => /\bwriteFileSync\(|\bmkdirSync\(|\.screenshot\(|\bjoin\(OUT\b/.test(line));

  assert.deepEqual(writeLines, [
    'await target.screenshot({ ...options, path: join(OUT, file) });',
    'writeFileSync(join(OUT, file), contents);',
    'if (!READ_ONLY) mkdirSync(OUT, { recursive: true });',
  ]);
});

test('both helpers return before writing when the fence is up', () => {
  // The other half of the implication. Without this, the guard above is satisfied by two helpers
  // that route every write and then write anyway.
  const source = driverSource();
  for (const helper of ['async function shoot(', 'function emit(']) {
    const start = source.indexOf(helper);
    assert.notEqual(start, -1, `${helper} has been renamed or removed — the fence moved with it`);
    const body = source.slice(start, source.indexOf('\n}', start));
    assert.ok(
      body.includes('if (READ_ONLY) return;'),
      `${helper} no longer bails out under the read-only fence`,
    );
  }
});

test('the driver still reports what it wrote, on both paths', () => {
  // The friction had two clauses. Read-only answers "stop writing"; this answers "say what you
  // wrote", which is the clause a steerable output directory never touched — and the one that is
  // silently droppable, because nothing else fails when the line disappears.
  const source = driverSource();
  assert.ok(source.includes("from './capture-output.js'"), 'the driver no longer imports the seam');
  assert.ok(
    source.includes('console.log(describeWrites({ readOnly: READ_ONLY, dir: OUT_SPEC, files: written }));'),
    'the driver no longer prints its write summary',
  );
  // Through the SHARED constant, not a second copy of the literal: the header documents
  // `ST_READ_ONLY` by name, and a driver spelling it itself is how the documented name and the read
  // name quietly become two different strings.
  assert.ok(
    source.includes('parseReadOnly(process.env[READ_ONLY_ENV])'),
    'the driver no longer reads the flag through the shared constant',
  );
  assert.equal(READ_ONLY_ENV, 'ST_READ_ONLY', 'the documented name and the exported one must agree');
});
