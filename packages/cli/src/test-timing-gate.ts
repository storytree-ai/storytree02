// ⚠ UNWIRED — part of retired `check:test-timing`, which ADR-0311 D2 removed from the gate on
// 2026-08-05. This module is the sweep and its aperture; its entrypoint `check-test-timing.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
/**
 * `check:test-timing` — the wall-clock fence over gate-tier test files (ADR-0276 decision 3).
 *
 * ADR-0276 decided: **a wall-clock duration is never a gate-tier assertion.** Gate-tier tests assert
 * OUTCOMES; a timing SUBJECT gets an injected or fake clock; a perf number lives in an opt-in tier
 * where it means something. Increments 1+2 fixed the two classes that were actually redding gates —
 * the `elapsed < 2000` routing bound went behind `STORYTREE_PERF=1`, and studio's `waitFor` got a
 * 15 s floor. This module is increment 3: the fence that stops the class coming back.
 *
 * THE MEASURED DEFECT (ADR-0276 Context, not an argument): under 5–6 concurrent sessions a
 * wall-clock bound measures CPU starvation of the dev box, not the routine under test. The one
 * measured assertion in the suite flaked at 4737 ms loaded and **6185 ms isolated** (PR #1010) and
 * 3795 ms overnight 07-31, against 386 ms on a quiet box — while catching, ever, zero real
 * regressions. Each false red cost a 9–42 min gate re-run plus ~8 min proving innocence, and 3 of 4
 * overnight gate runs on DOCS-ONLY diffs went red on it. ADR-0276's own Consequences named the
 * window this closes: "Until increment 3 lands, nothing but review stops a NEW wall-clock assertion
 * entering."
 *
 * ─── What is scanned ───────────────────────────────────────────────────────────────────────────
 *
 * GATE-TIER means what `pnpm gate` actually runs: `pnpm -r test` over every workspace declaring a
 * `test` script. So the population is derived — the workspace globs from `pnpm-workspace.yaml`, kept
 * where the workspace has `scripts.test` — never a hardcoded directory list that could drift from
 * the chain it claims to fence. A workspace with no `test` script contributes nothing (its files
 * cannot red anyone's gate), which is also why the ADR's "a bench file" remedy works: a
 * `*.bench.ts`, or a test in a non-gate workspace, is out of aperture by construction.
 *
 * THE APERTURE IS THE TWO APIs ADR-0276 D3 NAMES: `performance.now` and `process.hrtime`. `Date.now`
 * is DELIBERATELY OUT, and the reason is measured rather than assumed — it is this repo's ordinary
 * timestamp source (fixture bases, ids, injected-clock seams), so API-presence cannot discriminate a
 * duration measurement from a timestamp there, and scanning it would drown the fence in false
 * positives. The bounded sweep of 2026-08-03 found the elapsed idiom (`Date.now()` minus a stored
 * start) at ZERO occurrences across all 474 test files, so the hole is real but empty. Widening the
 * aperture later is ADR-0269's evidence bar, and is the one legitimate upward move on a ceiling.
 *
 * COMMENTS AND STRINGS ARE MASKED BEFORE DETECTION ({@link maskNonCode}), and that is load-bearing
 * in both directions. False positive: this ADR makes prose like "no `performance.now` here — the
 * clock is injected" the natural thing to write in a test file, and one already exists for the
 * sibling API (`orientation-runner-adapter.uat.test.ts:51`); a fence that red on its own doctrine
 * would be uninstalled within a week. False negative: a call hidden inside a template
 * interpolation — `` `${performance.now() - t0}ms` `` — is REAL executing code, so the masker
 * re-enters code mode at `${` rather than blanking the whole literal.
 *
 * ─── Two independent axes ──────────────────────────────────────────────────────────────────────
 *
 * (a) UNSANCTIONED — a wall-clock API in a gate-tier test file that is not the sanctioned survivor.
 *     This is the class ADR-0276 fences, and it is the one a new test file trips.
 * (b) UNGATED SANCTIONED — the survivor lost the env gate that earns its exemption. Without this
 *     axis the allow-list is a blanket pardon: deleting the `if (process.env.STORYTREE_PERF === '1')`
 *     line would restore the exact flake increment 1 removed while axis (a) stayed at zero. An
 *     allow-list entry naming a file that no longer exists breaches here too — a dead exemption is
 *     un-drained slack that would silently pardon a future file at that path.
 *
 * The ceiling over both lives in `test-timing-drain.ts` (ADR-0252 D3's shape); the thin
 * `check-test-timing.ts` prints and sets the exit code. Pure-by-injection: {@link maskNonCode} /
 * {@link detectWallClock} / {@link classifyTestTiming} / {@link formatTestTiming} are deterministic
 * over their inputs; {@link loadTestTimingInputs} is the only I/O.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const TAG = "[check:test-timing]";

// ---------------------------------------------------------------------------
// The aperture + the allow-list
// ---------------------------------------------------------------------------

/**
 * The wall-clock APIs ADR-0276 D3 names. Matched as dotted member expressions, so
 * `process.hrtime.bigint()` is caught by the `process.hrtime` entry.
 */
export const WALL_CLOCK_APIS: readonly string[] = ["performance.now", "process.hrtime"];

const WALL_CLOCK = /\b(performance\.now|process\.hrtime)\b/g;

/** One sanctioned survivor: why it is exempt, and the env var whose gate earns the exemption. */
export interface SanctionedFile {
  /** Repo-relative path, forward slashes. */
  readonly file: string;
  /** The env var whose `process.env.<name>` guard must still be present in the file. */
  readonly envGate: string;
  /** Why this one is sanctioned — printed when axis (b) breaches. */
  readonly why: string;
}

/**
 * THE CEILING'S ALLOW-LIST — exactly the one env-gated survivor ADR-0276 D3 sanctions, and nothing
 * else. Adding an entry is not a formality: it admits a permanent exemption to a rule whose whole
 * value is that it has none, so it needs the ADR-0269 evidence bar and a real reason a fake clock
 * cannot serve. The remedy for a new timing need is in {@link REMEDIES}, never a new entry here.
 *
 * `routing.test.ts` keeps the MEASUREMENT (it prints `routed in Nms` as a TAP diagnostic every gate
 * run, so the number cannot rot unnoticed) while its `elapsed < 2000` ASSERTION runs only under
 * `STORYTREE_PERF=1`. That split is exactly what makes it safe, and axis (b) is what keeps it true.
 */
export const SANCTIONED_WALL_CLOCK: readonly SanctionedFile[] = [
  {
    file: "packages/forest-world/src/routing.test.ts",
    envGate: "STORYTREE_PERF",
    why:
      "ADR-0276 increment 1 — the 2s routing bound is asserted ONLY under STORYTREE_PERF=1; the " +
      "elapsed still prints every gate run as a TAP diagnostic, so the measurement cannot rot",
  },
];

/** The remedies a breach names, in the order ADR-0276 D3 lists them. */
export const REMEDIES: readonly string[] = [
  "fake timers (`mock.timers` / vitest's `vi.useFakeTimers`) — the house pattern for a debounce or poll",
  "an injected clock (a `now()` seam the test controls, as `drive`'s db-control and context-traversal-telemetry do)",
  "the opt-in perf gate: keep the functional assertions gate-tier and guard the duration bound with `process.env.STORYTREE_PERF === '1'`",
  "a bench file (`*.bench.ts`) or a workspace with no `test` script — outside the gate tier entirely",
];

// ---------------------------------------------------------------------------
// Pure: mask, detect
// ---------------------------------------------------------------------------

/**
 * PURE: blank out comments and string/template bodies, preserving LENGTH and every newline so line
 * numbers computed against the result are exact.
 *
 * Template interpolations re-enter code mode at `${` (tracking brace depth), because a call inside
 * one executes — blanking it would be a false negative in the fence's core claim. Escapes are
 * consumed pairwise so `'\''` does not end the literal early.
 */
export function maskNonCode(source: string): string {
  const out = source.split("");
  const n = source.length;
  // The interpolation stack: each entry is the brace depth at which we return to template mode.
  const templateDepths: number[] = [];
  let braceDepth = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  let i = 0;

  const blank = (at: number): void => {
    if (source[at] !== "\n") out[at] = " ";
  };

  while (i < n) {
    const c = source[i] as string;
    const next = i + 1 < n ? source[i + 1] : "";

    if (mode === "code") {
      if (c === "/" && next === "/") {
        blank(i);
        blank(i + 1);
        i += 2;
        mode = "line";
        continue;
      }
      if (c === "/" && next === "*") {
        blank(i);
        blank(i + 1);
        i += 2;
        mode = "block";
        continue;
      }
      if (c === "'") {
        mode = "single";
        i++;
        continue;
      }
      if (c === '"') {
        mode = "double";
        i++;
        continue;
      }
      if (c === "`") {
        mode = "template";
        i++;
        continue;
      }
      if (c === "{") braceDepth++;
      if (c === "}") {
        const back = templateDepths[templateDepths.length - 1];
        if (back !== undefined && braceDepth === back) {
          templateDepths.pop();
          mode = "template";
          i++;
          continue;
        }
        braceDepth--;
      }
      i++;
      continue;
    }

    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        i++;
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    if (mode === "block") {
      if (c === "*" && next === "/") {
        blank(i);
        blank(i + 1);
        i += 2;
        mode = "code";
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    // ---- inside a string / template literal ----
    if (c === "\\") {
      blank(i);
      if (i + 1 < n) blank(i + 1);
      i += 2;
      continue;
    }
    if (mode === "template" && c === "$" && next === "{") {
      // An interpolation is CODE. Remember the depth to come back at — the CURRENT depth, NOT one
      // deeper: the interpolation's own `}` is the one that returns us to the template, so it must
      // compare equal without an intervening `{`. Incrementing here left the comparison permanently
      // off by one, so the masker never re-entered template mode and mis-parsed the whole rest of
      // the file (caught by the real-repo baseline in test-timing-drain.test.ts, pinned below).
      templateDepths.push(braceDepth);
      mode = "code";
      i += 2;
      continue;
    }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code";
      i++;
      continue;
    }
    blank(i);
    i++;
  }
  return out.join("");
}

/** One wall-clock occurrence: which API, and where. */
export interface WallClockHit {
  /** Repo-relative path, forward slashes. */
  file: string;
  /** The matched API (`performance.now` | `process.hrtime`). */
  api: string;
  /** 1-indexed line. */
  line: number;
}

/**
 * PURE: every wall-clock API occurrence in one file's source, comments and string bodies excluded.
 * Deterministic, in source order.
 */
export function detectWallClock(file: string, source: string): WallClockHit[] {
  const masked = maskNonCode(source);
  const hits: WallClockHit[] = [];
  WALL_CLOCK.lastIndex = 0;
  for (const m of masked.matchAll(WALL_CLOCK)) {
    const at = m.index ?? 0;
    let line = 1;
    for (let i = 0; i < at; i++) if (masked[i] === "\n") line++;
    hits.push({ file, api: m[1] ?? "", line });
  }
  return hits;
}

/** PURE: does this source still guard on `process.env.<name>` in real code (not in a comment)? */
export function hasEnvGate(source: string, envVar: string): boolean {
  return new RegExp(`process\\.env\\.${envVar}\\b`).test(maskNonCode(source));
}

// ---------------------------------------------------------------------------
// Pure: classify + format
// ---------------------------------------------------------------------------

/** One scanned gate-tier test file. */
export interface ScannedTestFile {
  /** Repo-relative path, forward slashes. */
  file: string;
  source: string;
}

export interface TestTimingReport {
  /** (a) wall-clock hits in files that are NOT sanctioned — the fenced class. */
  unsanctioned: WallClockHit[];
  /** (b) sanctioned entries that no longer earn their exemption, already rendered. */
  ungatedSanctioned: string[];
  /** How many gate-tier test files were scanned (the anti-vacuity number). */
  scannedFiles: number;
  /** How many gate-tier workspaces contributed. */
  scannedWorkspaces: number;
  /** Wall-clock hits inside sanctioned files — reported, never a breach. */
  sanctionedHits: number;
  /** True iff both gap lists are empty. */
  clean: boolean;
}

/**
 * PURE: classify one sweep. A hit in a sanctioned file is counted, not flagged; a sanctioned file is
 * separately held to its env gate (axis b), and a sanctioned entry whose file is absent from the
 * scan is a stale exemption — also axis (b), because a dead allow-list entry silently pardons any
 * future file at that path.
 */
export function classifyTestTiming(input: {
  files: readonly ScannedTestFile[];
  workspaceCount: number;
  sanctioned?: readonly SanctionedFile[];
}): TestTimingReport {
  const sanctioned = input.sanctioned ?? SANCTIONED_WALL_CLOCK;
  const byPath = new Map(sanctioned.map((s) => [s.file, s]));

  const unsanctioned: WallClockHit[] = [];
  let sanctionedHits = 0;
  const seen = new Set<string>();

  for (const f of input.files) {
    seen.add(f.file);
    const hits = detectWallClock(f.file, f.source);
    if (hits.length === 0) continue;
    if (byPath.has(f.file)) sanctionedHits += hits.length;
    else unsanctioned.push(...hits);
  }

  const ungatedSanctioned: string[] = [];
  for (const s of sanctioned) {
    if (!seen.has(s.file)) {
      ungatedSanctioned.push(
        `${s.file} is sanctioned but was not found in the gate-tier scan — a stale exemption ` +
          "(drop it from SANCTIONED_WALL_CLOCK)",
      );
      continue;
    }
    const src = input.files.find((f) => f.file === s.file)?.source ?? "";
    if (!hasEnvGate(src, s.envGate)) {
      ungatedSanctioned.push(
        `${s.file} no longer guards on \`process.env.${s.envGate}\` — its exemption was earned by ` +
          `that gate (${s.why})`,
      );
    }
  }

  return {
    unsanctioned,
    ungatedSanctioned,
    scannedFiles: input.files.length,
    scannedWorkspaces: input.workspaceCount,
    sanctionedHits,
    clean: unsanctioned.length === 0 && ungatedSanctioned.length === 0,
  };
}

export interface FormatTestTimingResult { warn: boolean; lines: string[] }

/**
 * PURE: render the sweep as console lines + a `warn` flag. NEVER throws or exits — the caller prints,
 * then applies the drain ceiling (`test-timing-drain.ts`) to decide the exit code.
 */
export function formatTestTiming(report: TestTimingReport): FormatTestTimingResult {
  if (report.clean) {
    return {
      warn: false,
      lines: [
        `${TAG} OK — no wall-clock measurement in gate-tier tests beyond the ${SANCTIONED_WALL_CLOCK.length} ` +
          `sanctioned, env-gated survivor (${report.scannedFiles} test files across ` +
          `${report.scannedWorkspaces} gate-tier workspaces).`,
      ],
    };
  }
  const lines = [
    `${TAG} WARN — gate-tier tests carry wall-clock measurement (ADR-0276). A duration bound on a ` +
      "shared box measures CPU starvation, not the routine; it reds the gate above its drain ceiling.",
  ];
  if (report.unsanctioned.length > 0) {
    lines.push(`${TAG}   ${report.unsanctioned.length} unsanctioned wall-clock occurrence(s):`);
    for (const h of report.unsanctioned) lines.push(`${TAG}     ${h.file}:${h.line} — ${h.api}`);
  }
  for (const b of report.ungatedSanctioned) lines.push(`${TAG}   ${b}`);
  return { warn: true, lines };
}

// ---------------------------------------------------------------------------
// Injectable runner
// ---------------------------------------------------------------------------

/** Everything the runner reads, injected for offline testability (the disk loader is the seam). */
export interface TestTimingDeps {
  loadInputs: () => { files: ScannedTestFile[]; workspaceCount: number };
}

export interface RunTestTimingGateResult {
  warn: boolean;
  lines: string[];
  report: TestTimingReport;
}

/** The injectable gate runner: load → classify → format. Pure-by-injection. */
export function runTestTimingGate(deps: TestTimingDeps): RunTestTimingGateResult {
  const report = classifyTestTiming(deps.loadInputs());
  return { ...formatTestTiming(report), report };
}

// ---------------------------------------------------------------------------
// Disk enumeration (the production `loadInputs`)
// ---------------------------------------------------------------------------

/** Directories never walked — build output, deps, and VCS/tool state. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", ".git", ".vite", ".turbo"]);

const TEST_FILE = /\.test\.tsx?$/;

/**
 * PURE: the workspace ROOT directories `pnpm-workspace.yaml` declares (`packages/*` → `packages`).
 * Only the `<dir>/*` form is supported — the one this repo uses; anything else THROWS so the sweep
 * SKIPs loudly rather than silently scanning a subset (a fence that quietly narrows its own
 * population is a false green).
 */
export function parseWorkspaceRoots(yaml: string): string[] {
  const roots: string[] = [];
  for (const raw of yaml.split(/\r?\n/)) {
    const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(raw);
    if (m === null) continue;
    const glob = (m[1] ?? "").trim();
    if (glob === "") continue;
    const suffix = "/*";
    if (!glob.endsWith(suffix) || glob.slice(0, -suffix.length).includes("*")) {
      throw new Error(`unsupported workspace glob "${glob}" — only the <dir>/* form is understood`);
    }
    roots.push(glob.slice(0, -suffix.length));
  }
  return roots;
}

/** Recursively collect `*.test.ts(x)` under `dir`, as repo-relative forward-slash paths. */
function collectTestFiles(dir: string, repoRoot: string, into: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // an unreadable subtree contributes nothing; the population floor in the test catches a broken walk
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectTestFiles(path.join(dir, e.name), repoRoot, into);
    } else if (e.isFile() && TEST_FILE.test(e.name)) {
      into.push(path.relative(repoRoot, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  }
}

export interface LoadTestTimingInputsResult {
  files: ScannedTestFile[];
  workspaceCount: number;
}

/**
 * Load the sweep inputs off disk: every `*.test.ts(x)` under every workspace that declares a `test`
 * script — i.e. exactly the files `pnpm -r test` can red a gate with. Pure file reads, no DB, so it
 * runs identically local and in CI.
 */
export function loadTestTimingInputs(opts: { repoRoot: string }): LoadTestTimingInputsResult {
  const roots = parseWorkspaceRoots(readFileSync(path.join(opts.repoRoot, "pnpm-workspace.yaml"), "utf8"));

  const files: ScannedTestFile[] = [];
  let workspaceCount = 0;

  for (const root of roots) {
    const rootDir = path.join(opts.repoRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const wsDir = path.join(rootDir, entry.name);
      const pkgPath = path.join(wsDir, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      // GATE-TIER is defined by the chain: `pnpm -r test` runs a workspace iff it declares `test`.
      if (typeof pkg.scripts?.test !== "string") continue;
      workspaceCount++;
      const rel: string[] = [];
      collectTestFiles(wsDir, opts.repoRoot, rel);
      for (const file of rel) {
        files.push({ file, source: readFileSync(path.join(opts.repoRoot, file), "utf8") });
      }
    }
  }
  return { files, workspaceCount };
}
