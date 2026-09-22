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

test("the refused bytes are named EXACTLY — the whole table, pinned", () => {
  // ⚠ A `notEqual(…, "UNNAMED CONTROL BYTE")` sweep stood here and `check:mutation-diff` emptied
  // FOURTEEN of these names one at a time without it noticing: "" is not the fallback string
  // either, so the assertion stayed green over a table that had lost its content. The names ARE
  // the report's payload — it cannot show the byte — so they are pinned by value.
  assert.deepEqual(
    [...Array(0x20).keys()].filter(isRefusedByte).map((b) => [b, refusedByteName(b)]),
    [
      [0x00, "NUL"],
      [0x01, "SOH"],
      [0x02, "STX"],
      [0x03, "ETX"],
      [0x04, "EOT"],
      [0x05, "ENQ"],
      [0x06, "ACK"],
      [0x07, "BEL"],
      [0x08, "BACKSPACE"],
      [0x0b, "VERTICAL TAB"],
      [0x0c, "FORM FEED"],
      [0x0e, "SHIFT OUT"],
      [0x0f, "SHIFT IN"],
      [0x10, "DLE"],
      [0x11, "DC1"],
      [0x12, "DC2"],
      [0x13, "DC3"],
      [0x14, "DC4"],
      [0x15, "NAK"],
      [0x16, "SYN"],
      [0x17, "ETB"],
      [0x18, "CAN"],
      [0x19, "EM"],
      [0x1a, "SUB"],
      [0x1c, "FS"],
      [0x1d, "GS"],
      [0x1e, "RS"],
      [0x1f, "US"],
    ],
  );
  assert.equal(refusedByteName(DEL), "DEL");
  // The fallback, which no refused byte reaches today — so nothing covered it until this line.
  assert.equal(refusedByteName(0x41), "UNNAMED CONTROL BYTE");
});

test("the PASSING verdict is held to an exact golden", () => {
  assert.equal(
    formatControlByteVerdict([], 1234),
    "check:control-bytes PASS — 1234 tracked text file(s) carry no invisible control bytes.",
  );
});

test("the FAILING verdict is held to an EXACT GOLDEN — the only assertion that sees a blanked line", () => {
  // ⚠⚠ A CONTAINMENT SWEEP CANNOT SEE THIS, and `check:mutation-diff` proved it here exactly as it
  // did for `land-sand.ts`'s emitter: it emptied the report's string literals one at a time and a
  // set of `assert.match(body, /cat -v/)` / `/heredoc/` assertions stayed green, because the
  // surviving lines still contain every phrase a looser test looks for. The remedy block IS this
  // report's value — a session meeting this fault has already looked at the line in four tools that
  // rendered it as correct — so a silently blanked line is a real loss, not a cosmetic one.
  //
  // TWO FILES on purpose: the header counts DISTINCT files, and with one finding that count is 1
  // however the mapping is computed — which let a mutant replace the whole `(f) => f.file` key with
  // `() => undefined` and survive.
  const findings = [
    ...scanForControlBytes("pkg/src/a.ts", buf("const x = '", BACKSPACE, "b';")),
    ...scanForControlBytes("pkg/src/b.ts", buf("const y = 1;", LF, "const z = '", NUL, "';")),
  ];
  assert.equal(findings.length, 2);

  assert.equal(
    formatControlByteVerdict(findings, 7),
    [
      "check:control-bytes FAIL — 2 invisible control byte(s) in 2 file(s), out of 7 scanned.",
      "",
      "  pkg/src/a.ts:1:12 — 0x08 BACKSPACE",
      "    const x = '<0x08>b';",
      "  pkg/src/b.ts:2:12 — 0x00 NUL",
      "    const z = '<0x00>';",
      "",
      "  ⚠ YOU WILL NOT SEE THIS BY LOOKING. tsc, oxlint, `grep -n`, `git diff` and the Read tool all",
      "    render these bytes as nothing — the terminal executes them. Confirm with `cat -v` or",
      "    `sed -n '<line>p' <file> | od -c`.",
      "",
      "  THE USUAL CAUSE is a patch written through a shell heredoc: a quoted heredoc strips one level",
      "    of backslash, so `\\\\b` reaches the interpreter as `\\b` and is written as byte 0x08. Repair",
      "    with the Write/Edit tool or a byte-level script — never another heredoc, which reproduces it.",
    ].join("\n"),
  );
});
