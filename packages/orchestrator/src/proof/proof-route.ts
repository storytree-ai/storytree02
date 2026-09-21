/**
 * THE PROOF-ROUTE CLASSIFIER (`custom-proof-command-red-accounting` on `parallel-red-green-arc`).
 *
 * ONE place decides what a node's declared proof command IS — the arc's standing instruction, because
 * the custom-`proofCommand` population is implicated in several separate findings and a second
 * classifier would let them disagree. It classifies by the command's SHAPE alone (ADR-0580 D1), at
 * RESOLVE time and before any authoring turn is spent, and two consumers read the answer:
 *
 *  - the resolver's REFUSAL of a route that can never observe the authored test (below);
 *  - {@link perTestChannelOf}, which arms per-test observation only on a route that runs the node's OWN
 *    test file through a runner whose per-test report was measured (ADR-0573 D2/D3).
 *
 * Every other route is observed by its exit code alone (ADR-0020 §3).
 *
 * THE REFUSAL is deliberately narrow: it fires only where the classifier can PROVE the command cannot
 * observe the authored test — it identified the single explicit test file the command runs, and that
 * file is NOT the one AUTHOR_TEST writes. The leaf would author a test the spine never runs, so
 * CONFIRM_RED is unreachable by construction and every authoring turn is spent before the halt. Zero
 * nodes are in that state today (all 48 single-file commands name their own `testFile`) — it is a
 * fail-closed fence, not a migration. A command the classifier merely cannot READ is a different
 * thing — unverified, not broken — and it builds, observed by its exit code.
 *
 * WHAT IS DELIBERATELY *NOT* REFUSED: the suite-scoped and foreign-runner routes. ADR-0098's R2
 * `refactorForTests` arm is STRUCTURALLY suite-scoped — its schema refine REQUIRES a `proofCommand`
 * because the whole package suite IS its regression wall — so a blanket refusal of suites would make
 * every R2 node unbuildable.
 *
 * (Until ADR-0580 D1 this module also decided whether the ADR-0211 assert-oracle guard could measure a
 * route, and how to wire it on. That axis went with the guard, and so did the two suite bases that
 * existed only to route it and the package-manifest read behind one of them.)
 */

import * as path from "node:path";

import type { RealProofConfig } from "../proof-config.js";
import type { ShellCommand } from "../shell-test-executor.js";
import { nodeTestReporterArgs } from "./per-test-report.js";
import type { PerTestChannel } from "./per-test-report.js";

/** Why a route landed where it did — the vocabulary every consumer of this classifier reads. */
export type ProofRouteBasis =
  /** No declared command: the spine's own `node --import tsx --test <testFile>`. */
  | "default-node-test"
  /** A declared node command over exactly this node's own `testFile` (observed per test only with `--test`). */
  | "custom-node-test-own-file"
  /**
   * A declared `bun test` over exactly this node's own `testFile` (ADR-0573 D2): ONE file in ONE
   * process, not the opaque package-script suite `bun` otherwise names.
   */
  | "bun-test-own-file"
  /** A declared command that observes MORE than this node's test file (a package script, a glob, >1 file). */
  | "suite-scoped"
  /** A declared command whose runner is not node's own test runner (vitest, jest, mocha, …). */
  | "foreign-runner"
  /** A declared command the resolver cannot read: no recognised runner, no identifiable observed file. */
  | "unrecognised-runner"
  /** A declared command that runs ONE explicit test file — and it is not the one AUTHOR_TEST writes. */
  | "observes-another-file";

/**
 * The classified route: its basis, and — on the one refused basis — the reason the resolver refuses
 * with, BEFORE any authoring turn.
 */
export type ProofRoute =
  | { basis: Exclude<ProofRouteBasis, "observes-another-file"> }
  | {
      basis: "observes-another-file";
      /** Names the remedy; the resolver refuses with this BEFORE any authoring turn. */
      reason: string;
    };

/**
 * The node binary, NAMED — what a command that means NODE must carry as its `file`.
 *
 * ⚠ `process.execPath` does NOT mean node; it means "whatever runtime is running this process". That
 * was node for as long as every package's test script was `node --test`, but under `bun test` it is
 * `bun.exe` — whose basename is in {@link PACKAGE_MANAGERS} below, so a proof command the spine
 * BUILT ITSELF got classified as an opaque package-manager invocation and routed away from the
 * node-runner branch. That single substitution accounted for 25 of the 26 residual `bun test` failures
 * across `orchestrator` and `drive` (`bun-runtime-migration-arc` inc-09/inc-10), and it is the same
 * fault class inc-06 fixed for `agent` and `context-traversal-transcript`.
 *
 * The rule is NOT "never use `process.execPath`". A `-e` eval, or a stand-in for "some absolute
 * executable an administrator pinned", is correctly runtime-agnostic and must stay as it is. Only a
 * command whose flags are node's own (`--test`, `--import`) or whose child is a node program means
 * node, and only those name it here.
 */
export const NODE_BINARY = "node";

/**
 * Package managers whose bare `<script>` invocation runs a package's own script (a suite).
 *
 * `bun` belongs here — `bun test <pkg>` really is an opaque suite invocation — and its presence is
 * exactly why a command the spine builds must name {@link NODE_BINARY} rather than inherit its own
 * runtime; see that constant for the failure it caused.
 */
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "npx", "bun"]);

/** Test runners that are not node's own — a declared command naming one is a `foreign-runner` route. */
const FOREIGN_RUNNERS = new Set(["vitest", "jest", "mocha", "playwright", "ava", "tap"]);

/**
 * Node flags that CONSUME the following token, so the token is a flag VALUE and never a test path.
 * Only the ones a proof command plausibly carries — an unknown `--flag value` pair degrades to
 * "value looks like a path", which can only ever push a route toward the conservative side.
 */
export const NODE_FLAGS_TAKING_A_VALUE = new Set([
  "--import",
  "--require",
  "-r",
  "--loader",
  "--experimental-loader",
  "--conditions",
  "-C",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-shard",
  "--test-timeout",
  "--env-file",
]);

/** `bun test` flags that CONSUME the following token, for the same reason (ADR-0573 D2's bun route). */
export const BUN_TEST_FLAGS_TAKING_A_VALUE = new Set([
  "--preload",
  "-r",
  "--timeout",
  "--reporter",
  "--reporter-outfile",
  "--test-name-pattern",
  "-t",
  "--rerun-each",
  "--coverage-dir",
  "--coverage-reporter",
  "--tsconfig-override",
  "--config",
  "-c",
  "--env-file",
  "--cwd",
]);

/** A path spec that can match more than one file — never a single-file run. */
function isGlob(spec: string): boolean {
  return /[*?[\]{}]/.test(spec);
}

/** Normalise a declared path for comparison: forward slashes, no leading `./`. */
function normalisePath(p: string): string {
  return p.split(path.win32.sep).join("/").replace(/^\.\//, "");
}

/**
 * Does `arg` name the SAME file as the node's repo-relative `testFile`? A declared command often runs
 * inside a package (`pnpm --filter <pkg> exec node --test src/x.test.ts`), so the argument is
 * package-relative while `testFile` is repo-relative. A path-boundary SUFFIX match is what relates the
 * two without the classifier having to resolve `--filter` to a directory.
 */
export function namesTestFile(arg: string, testFile: string): boolean {
  const a = normalisePath(arg);
  const t = normalisePath(testFile);
  return t === a || t.endsWith(`/${a}`);
}

/** The basename of an executable token, lower-cased and stripped of a `.exe`/`.cmd` suffix. */
function executableName(token: string): string {
  const base = normalisePath(token).split("/").pop() ?? token;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

function isNodeExecutable(token: string): boolean {
  return executableName(token) === "node";
}

/**
 * The explicit path-looking positional arguments after `startIndex` — the files a runner was pointed
 * at. Flag VALUES are skipped so `--import <url>` never reads as a test path, and only tokens with a
 * JS/TS test extension count, so a `--filter @storytree/library` package name cannot masquerade as one.
 */
function explicitTestPaths(
  tokens: readonly string[],
  startIndex: number,
  flagsTakingAValue: ReadonlySet<string> = NODE_FLAGS_TAKING_A_VALUE,
): string[] {
  const paths: string[] = [];
  for (let i = startIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token.startsWith("-")) {
      if (flagsTakingAValue.has(token) && !token.includes("=")) i += 1;
      continue;
    }
    if (/\.(m|c)?[jt]sx?$/.test(token) || isGlob(token)) paths.push(token);
  }
  return paths;
}

/**
 * Classify a node's REAL proof route. Total and pure — every declared command lands in exactly one
 * basis, read off the command's own tokens.
 */
export function classifyProofRoute(real: RealProofConfig): ProofRoute {
  const declared = real.proofCommand;
  if (declared === undefined) {
    return { basis: "default-node-test" };
  }

  const tokens = [declared.file, ...declared.args];
  const nodeIndex = tokens.findIndex(isNodeExecutable);
  const foreignIndex = tokens.findIndex((t) => FOREIGN_RUNNERS.has(executableName(t)));

  // A foreign runner is checked FIRST: `pnpm exec vitest run <file>` carries no node token, but a
  // hypothetical `node …/vitest.mjs` would carry both, and the runner is what decides how it reports.
  if (foreignIndex !== -1) {
    const paths = explicitTestPaths(tokens, foreignIndex + 1);
    const single = paths.length === 1 ? paths[0] : undefined;
    if (single !== undefined && !isGlob(single) && !namesTestFile(single, real.testFile)) {
      return unobservableTestFile(single, real);
    }
    return { basis: "foreign-runner" };
  }

  if (nodeIndex !== -1) {
    const paths = explicitTestPaths(tokens, nodeIndex + 1);
    const single = paths.length === 1 ? paths[0] : undefined;
    if (single !== undefined && !isGlob(single)) {
      return namesTestFile(single, real.testFile)
        ? { basis: "custom-node-test-own-file" }
        : unobservableTestFile(single, real);
    }
    // A WHOLE-SUITE node:test run: a glob, several files, or no explicit file.
    if (tokens.includes("--test")) return { basis: "suite-scoped" };
    // A node command that is neither the test runner nor pointed at one identifiable file: the spine
    // cannot say what it observes. Fall through.
  }

  // ADR-0573 D2: `bun test <file>` over this node's OWN test file runs one file in one process, so it
  // is a single-file route, never the package-script suite `bun` otherwise names. Checked before
  // PACKAGE_MANAGERS, where `bun` also sits. A `bun test` over anything else (a directory, several
  // files, no file) falls through to that suite branch unchanged.
  if (executableName(declared.file) === "bun" && declared.args[0] === "test") {
    const paths = explicitTestPaths(tokens, 2, BUN_TEST_FLAGS_TAKING_A_VALUE);
    const single = paths.length === 1 ? paths[0] : undefined;
    if (single !== undefined && !isGlob(single)) {
      return namesTestFile(single, real.testFile)
        ? { basis: "bun-test-own-file" }
        : unobservableTestFile(single, real);
    }
  }

  // A package-manager invocation runs a package's own script — a whole suite. This is the ADR-0098 R2
  // shape (the package suite IS the regression wall), so it builds.
  if (PACKAGE_MANAGERS.has(executableName(declared.file))) {
    return { basis: "suite-scoped" };
  }

  // The residue: a command this spine cannot read (an inline `node -e` probe, a shell script, a make
  // target). It builds rather than being refused, and the line between the two is deliberate: the
  // refusal above fires on something the classifier can PROVE is broken (it identified the one file
  // the command runs, and that file is not the one being authored), whereas this bucket is only
  // unVERIFIED. Refusing the unverified would fence off a shape the schema explicitly contemplates —
  // "use a node-based command for an install-free proof" — to protect nothing: its red/green is still
  // the exit code the spine observes.
  return { basis: "unrecognised-runner" };
}

/** The refusal for a single-file command pointed at a file the leaf is not authoring. */
function unobservableTestFile(observed: string, real: RealProofConfig): ProofRoute {
  return {
    basis: "observes-another-file",
    reason:
      `the declared real.proofCommand runs exactly one test file, \`${observed}\`, but AUTHOR_TEST ` +
      `writes \`${real.testFile}\` — the spine would never run the authored test, so CONFIRM_RED can ` +
      `never observe its red and every authoring turn would be spent before the halt. Point the ` +
      `command at \`${real.testFile}\`, or drop real.proofCommand for the default route ` +
      `(\`node --import tsx --test ${real.testFile}\`).`,
  };
}

/**
 * THE PER-TEST CHANNEL a route carries (ADR-0573 D2/D3), decided from the route's basis so ONE
 * classifier says both what a route is and whether its red and green can be observed per test. A route
 * gets a channel only when it runs ONE test file — this node's own — through a runner whose per-test
 * report was measured:
 *
 *  - `node-test` — the default `node --import tsx --test <file>`, or a declared node:test command over
 *    the node's own file that names `--test` (the reporter flags are the test runner's own);
 *  - `bun-junit` — a declared `bun test <own file>`;
 *  - `vitest-json` — a declared `vitest run <own file>`, directly or through a package manager.
 *
 * Everything else stays observed by its exit code alone: a whole-package or multi-file suite
 * (attribution was measured over single files only, and a suite reports rows the unit's static read
 * never declared), and a foreign or unrecognised runner. A command whose single test path cannot be
 * told apart from a flag value reads as more than one path, and so stays unarmed.
 */
export function perTestChannelOf(real: RealProofConfig, route: ProofRoute): PerTestChannel | undefined {
  if (route.basis === "default-node-test") return "node-test";
  if (route.basis === "custom-node-test-own-file") {
    return real.proofCommand?.args.includes("--test") === true ? "node-test" : undefined;
  }
  if (route.basis === "bun-test-own-file") return "bun-junit";
  if (route.basis !== "foreign-runner" || real.proofCommand === undefined) return undefined;
  const tokens = [real.proofCommand.file, ...real.proofCommand.args];
  const runnerAt = tokens.findIndex((t) => executableName(t) === "vitest");
  if (runnerAt === -1) return undefined;
  const paths = explicitTestPaths(tokens, runnerAt + 1);
  const single = paths.length === 1 ? paths[0] : undefined;
  return single !== undefined && !isGlob(single) && namesTestFile(single, real.testFile)
    ? "vitest-json"
    : undefined;
}

/**
 * Put a per-test report channel onto the ONE resolved proof command (ADR-0573 D2), returning a NEW
 * command. The spine's CONFIRM observations and the leaf's `run_proof` spawn this same command, so a
 * feedback run writes the report too — and is never trusted, because the spine clears the report before
 * every observation it reads (ADR-0249).
 *
 *  - `node-test`: the spine's reporter plus `spec` named to stdout, right after `--test`, where node
 *    still reads them as its own options;
 *  - `bun-junit`: `--reporter=junit --reporter-outfile=<path>`, right after `test`;
 *  - `vitest-json`: `--reporter=default --reporter=json --outputFile=<path>`, appended.
 *
 * A command with no `--test` / `test` token to anchor on comes back unchanged. {@link perTestChannelOf}
 * never gives such a command a channel, and if one ever arrived its report would read ABSENT, which the
 * review refuses (C1) rather than advancing.
 */
export function withPerTestReport(command: ShellCommand, channel: PerTestChannel, reportPath: string): ShellCommand {
  if (channel === "vitest-json") {
    return {
      ...command,
      args: [...command.args, "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`],
    };
  }
  const anchor = command.args.indexOf(channel === "node-test" ? "--test" : "test");
  if (anchor === -1) return command;
  const flags =
    channel === "node-test"
      ? nodeTestReporterArgs(reportPath)
      : ["--reporter=junit", `--reporter-outfile=${reportPath}`];
  return { ...command, args: [...command.args.slice(0, anchor + 1), ...flags, ...command.args.slice(anchor + 1)] };
}
