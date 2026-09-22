/**
 * THE RULE: a tracked text file may not carry an INVISIBLE control byte.
 *
 * The pure judge behind `pnpm check:control-bytes` — the shell next door
 * ({@link file://./check-control-bytes.ts}) gathers the files and exits; this module owns the rule
 * and the report, so the rule stays exhaustively unit-testable offline.
 *
 * ⚠ WHY A MECHANICAL RUNG AND NOT A MEMORY. Writing a payload containing a backslash through a
 * quoted shell heredoc strips one level of it, so a patch script emitting `\\b` delivers `\b` to
 * the interpreter, which reads it as the BACKSPACE escape and writes byte 0x08 into the source.
 * That has now happened TWICE in this repo within days — `packages/cli/src/test-slop-scenarios.test.ts`
 * (2026-09-22) and `packages/forest-world-r3f/src/land-sand.test.ts:210`, where it turned
 * `/\buniform\b/` into a regex matching a string no GLSL source can contain, so the assertion
 * negating it could never fail and sat green proving nothing.
 *
 * ⚠⚠ THE FAULT IS INVISIBLE TO EVERY READER A SESSION NATURALLY REACHES FOR. `tsc` passes (0x08 is
 * legal inside a regex literal), `oxlint` passes, `grep -n` prints a clean line because the terminal
 * EXECUTES the backspace, `git diff` renders it as nothing, and the Read tool shows the same clean
 * line. Only `od -c` / `cat -v` reveal it. So this is not a rule a careful reader can enforce — the
 * reading is what fails — and a memory cannot help a session that never suspects it needs one.
 * The sibling shape is already recorded: a NUL byte makes git treat the file as binary and hide
 * every diff of it thereafter. One detector covers the whole class.
 *
 * ⚠ ESC (0x1B) IS ALLOWED, AND THAT IS A MEASURED EXEMPTION, NOT AN OVERSIGHT. Three tracked files
 * carry it legitimately — `packages/cli/src/leaf-test-strength.run.ts` and
 * `packages/drive/src/uat-drive-harness-end.test.ts` hold it inside ANSI-stripping regexes and
 * fixtures, and `docs/research/bun-runtime-probe-2026-08-22.md` holds captured terminal output.
 * It is exempted by VALUE rather than by an allow-list of paths, deliberately: a path list would
 * silently stop covering a file that moved, and would read as a pass for whichever subset still
 * existed.
 *
 * ⚠ AND TAB / LF / CR ARE ALLOWED BECAUSE THEY ARE LAYOUT, NOT CONTENT. Refusing CR would make this
 * rung an accidental line-ending police — a different subject, and one that would fire loudly on a
 * Windows checkout while proving nothing about invisibility.
 *
 * ⚠⚠ NOTHING IN THIS FILE, OR IN ITS TESTS, MAY CONTAIN A REFUSED BYTE AS A LITERAL — the rung
 * would flag its own source, which is the trap a source-text check most reliably walks into. Every
 * byte here is written as a NUMBER and every fixture is built in memory.
 */

/** Bytes that are control characters but carry layout or legitimate terminal meaning. */
const ALLOWED = new Set<number>([
  0x09, // TAB
  0x0a, // LF
  0x0d, // CR
  0x1b, // ESC — see the header's measured exemption
]);

/** DEL is not a C0 byte but is equally invisible, and no tracked text file carries one. */
const DEL = 0x7f;

/** The names a report prints, so a failure says WHICH byte rather than showing a blank. */
const BYTE_NAMES: ReadonlyMap<number, string> = new Map([
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
  [DEL, "DEL"],
]);

/** True when this byte is one the rung refuses. */
export function isRefusedByte(byte: number): boolean {
  if (ALLOWED.has(byte)) return false;
  return byte < 0x20 || byte === DEL;
}

/** The printable name of a refused byte, for a report that must not rely on showing it. */
export function refusedByteName(byte: number): string {
  return BYTE_NAMES.get(byte) ?? "UNNAMED CONTROL BYTE";
}

export interface ControlByteFinding {
  /** Repo-relative path, exactly as `git ls-files` printed it. */
  readonly file: string;
  /** 1-indexed line, counted on LF. */
  readonly line: number;
  /** 1-indexed BYTE offset within the line — not a character offset. */
  readonly column: number;
  readonly byte: number;
  readonly name: string;
  /** The offending line with every refused byte replaced by a visible `<0xNN>`. */
  readonly rendered: string;
}

/**
 * Every refused byte in one file's bytes.
 *
 * Takes a Buffer rather than a string on purpose: decoding to UTF-8 first would let the decoder
 * decide what a stray byte means, and the whole subject here is bytes.
 */
export function scanForControlBytes(file: string, bytes: Buffer): ControlByteFinding[] {
  const findings: ControlByteFinding[] = [];
  let line = 1;
  let lineStart = 0;

  // ⚠ ITERATED BY `entries()` RATHER THAN BY INDEX, and that is a test-strength choice rather than
  // a style one. An indexed loop under `noUncheckedIndexedAccess` needs a `byte === undefined`
  // guard that is unreachable at runtime, and both the guard and the `i < length` bound are then
  // EQUIVALENT MUTANTS — `check:mutation-diff` reports them as survivors no test can ever kill,
  // which is noise that trains a reader to skim the report. `entries()` has neither.
  for (const [i, byte] of bytes.entries()) {
    if (byte === 0x0a) {
      line += 1;
      lineStart = i + 1;
      continue;
    }
    if (!isRefusedByte(byte)) continue;
    findings.push({
      file,
      line,
      column: i - lineStart + 1,
      byte,
      name: refusedByteName(byte),
      rendered: renderLine(bytes, lineStart),
    });
  }
  return findings;
}

/** The line starting at `lineStart`, with refused bytes made visible as `<0xNN>`. */
function renderLine(bytes: Buffer, lineStart: number): string {
  let end = bytes.indexOf(0x0a, lineStart);
  if (end === -1) end = bytes.length;
  let out = "";
  // `subarray` rather than an indexed walk, for the equivalent-mutant reason in the scanner above.
  for (const byte of bytes.subarray(lineStart, end)) {
    out += isRefusedByte(byte) ? `<0x${byte.toString(16).padStart(2, "0")}>` : String.fromCharCode(byte);
  }
  return out;
}

/**
 * The report. Names the byte, the place, and the mechanism — because a session meeting this for the
 * first time will have already looked at the line in four tools that showed it as correct.
 */
export function formatControlByteVerdict(findings: readonly ControlByteFinding[], scanned: number): string {
  if (findings.length === 0) {
    return `check:control-bytes PASS — ${scanned} tracked text file(s) carry no invisible control bytes.`;
  }

  const lines = [
    `check:control-bytes FAIL — ${findings.length} invisible control byte(s) in ${
      new Set(findings.map((f) => f.file)).size
    } file(s), out of ${scanned} scanned.`,
    "",
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}:${f.line}:${f.column} — 0x${f.byte.toString(16).padStart(2, "0")} ${f.name}`);
    lines.push(`    ${f.rendered}`);
  }
  lines.push(
    "",
    "  ⚠ YOU WILL NOT SEE THIS BY LOOKING. tsc, oxlint, `grep -n`, `git diff` and the Read tool all",
    "    render these bytes as nothing — the terminal executes them. Confirm with `cat -v` or",
    "    `sed -n '<line>p' <file> | od -c`.",
    "",
    "  THE USUAL CAUSE is a patch written through a shell heredoc: a quoted heredoc strips one level",
    "    of backslash, so `\\\\b` reaches the interpreter as `\\b` and is written as byte 0x08. Repair",
    "    with the Write/Edit tool or a byte-level script — never another heredoc, which reproduces it.",
  );
  return lines.join("\n");
}
