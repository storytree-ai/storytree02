/**
 * The rule behind `pnpm check:control-bytes`, held offline.
 *
 * ⚠⚠ EVERY FIXTURE IS BUILT FROM NUMBERS, AND THAT IS LOAD-BEARING RATHER THAN FASTIDIOUS. A test
 * for this rung that spelled a refused byte as a literal would put that byte in a tracked `.ts`
 * file, and the rung would then red on its own test — the trap a source-text check walks into most
 * reliably (`source-text-check-trips-on-its-own-rationale`). Nothing below contains a control
 * character; they are all `Buffer.from([...])`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatControlByteVerdict,
  isRefusedByte,
  refusedByteName,
  scanForControlBytes,
} from "./control-bytes.js";

const BACKSPACE = 0x08;
const NUL = 0x00;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const ESC = 0x1b;
const DEL = 0x7f;

/** A buffer from an ASCII string plus explicit bytes, so no fixture needs a literal control char. */
function buf(...parts: readonly (string | number)[]): Buffer {
  return Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "ascii") : Buffer.from([p]))),
  );
}

test("layout and terminal bytes are ALLOWED — tab, LF, CR and ESC", () => {
  // ⚠ ESC is the measured exemption: three tracked files carry it legitimately (two ANSI-stripping
  // regexes and one captured terminal transcript). If this flips, those files red the gate.
  for (const byte of [TAB, LF, CR, ESC]) {
    assert.equal(isRefusedByte(byte), false, `0x${byte.toString(16)} must be allowed`);
  }
  const clean = buf("const a = 1;", LF, TAB, "const b = 2;", CR, LF, "x", ESC, "[0m");
  assert.deepEqual(scanForControlBytes("clean.ts", clean), []);
});

test("the invisible bytes are REFUSED — including NUL and DEL", () => {
  for (const byte of [NUL, BACKSPACE, 0x0b, 0x0c, 0x1a, 0x1f, DEL]) {
    assert.equal(isRefusedByte(byte), true, `0x${byte.toString(16)} must be refused`);
  }
  // Ordinary printable text is never refused — otherwise the rung would flag every file.
  for (const byte of [0x20, 0x41, 0x7e]) {
    assert.equal(isRefusedByte(byte), false, `0x${byte.toString(16)} is printable`);
  }
});

test("THE REGRESSION: the backspace-for-\\b shape that bit land-sand.test.ts is caught", () => {
  // The literal bytes of the fault: `/<BS>uniform<BS>/` where a `\b` word boundary was meant.
  // Built numerically — writing it as text is what put it in the repo in the first place.
  const line = buf("assert.ok(!/", BACKSPACE, "uniform", BACKSPACE, "/.test(glsl));");
  const found = scanForControlBytes("land-sand.test.ts", line);

  assert.equal(found.length, 2, "both backspaces must be reported, not just the first");
  assert.equal(found[0]!.byte, BACKSPACE);
  assert.equal(found[0]!.name, "BACKSPACE");
  assert.equal(found[0]!.line, 1);
  assert.equal(found[0]!.column, 13, "column is a 1-indexed BYTE offset within the line");
  assert.equal(found[1]!.column, 21);
  // The rendering is the only way a reader sees it at all — pinned EXACTLY, so both bytes must
  // appear and the surrounding source must survive intact.
  assert.equal(found[0]!.rendered, "assert.ok(!/<0x08>uniform<0x08>/.test(glsl));");
});

test("line and column are counted on LF, and reset per line", () => {
  const src = buf("aaa", LF, "bb", NUL, "cc", LF, "dddd", BACKSPACE);
  const found = scanForControlBytes("multi.ts", src);

  assert.equal(found.length, 2);
  assert.equal(found[0]!.line, 2, "the NUL is on the second line");
  assert.equal(found[0]!.column, 3);
  assert.equal(found[0]!.name, "NUL");
  assert.equal(found[1]!.line, 3, "the backspace is on the third");
  assert.equal(found[1]!.column, 5);
  // ⚠ The rendered line is the OFFENDING line, not the first one — a report that always showed
  // line 1 would be useless on exactly the files this rung exists for.
  assert.equal(found[0]!.rendered, "bb<0x00>cc");
  assert.equal(found[1]!.rendered, "dddd<0x08>");
});

test("a refused byte on the LAST line, with no trailing newline, still renders", () => {
  // The unterminated-final-line case: `indexOf(LF)` returns -1 there, and a renderer that sliced
  // on it without handling -1 would return the empty string or one character.
  const found = scanForControlBytes("tail.ts", buf("end", BACKSPACE));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.rendered, "end<0x08>");
});

test("every refused byte has a NAME, because the report cannot show the byte itself", () => {
  for (let byte = 0x00; byte <= 0x1f; byte += 1) {
    if (!isRefusedByte(byte)) continue;
    assert.notEqual(refusedByteName(byte), "UNNAMED CONTROL BYTE", `0x${byte.toString(16)} is unnamed`);
  }
  assert.equal(refusedByteName(DEL), "DEL");
});

test("the verdict passes on a clean scan and names the count", () => {
  const body = formatControlByteVerdict([], 1234);
  assert.match(body, /PASS/);
  assert.match(body, /1234/);
});

test("the FAILING verdict names the byte, the place and the mechanism", () => {
  const found = scanForControlBytes("pkg/src/a.ts", buf("x", BACKSPACE));
  const body = formatControlByteVerdict(found, 10);

  assert.match(body, /FAIL/);
  assert.match(body, /pkg\/src\/a\.ts:1:2/, "the place, so it can be opened");
  assert.match(body, /0x08 BACKSPACE/, "the byte by name, since it cannot be shown");
  // ⚠ The remedy matters as much as the finding: a session meeting this has already looked at the
  // line in four tools that rendered it as correct, so the report must say so and name `cat -v`.
  assert.match(body, /cat -v/);
  assert.match(body, /heredoc/);
});
