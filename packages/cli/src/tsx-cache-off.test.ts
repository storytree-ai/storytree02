/**
 * Contract for `scripts/tsx-cache-off.mjs` and the launcher's copy of the same line
 * (`the-gate-costs-what-the-change-risks-arc` inc 4 — aim at the cost centre).
 *
 * WHAT IS BEING PINNED, AND WHY THE OBVIOUS ASSERTION WOULD NOT PIN IT. tsx writes every esbuild
 * transform into a FLAT directory under `os.tmpdir()` and never evicts it; on the dev box that
 * directory had reached 232,254 files / 4.18 GB, at which point a cache LOOKUP measured as costing
 * more than the transform it saves. (⚠ Re-measured on 2026-08-21 that difference did not reproduce —
 * see `scripts/tsx-cache-off.mjs`. What THIS file pins is unaffected: it asserts the preload is
 * arranged so the variable is set BEFORE tsx reads it, which is a question about ORDER, not about
 * how much the cache costs.) Measured by running the WHOLE `pnpm -r --no-bail test` suite twice per arm,
 * interleaved on a quiet box: 745 s / 621 s of wall with the cache against 444 s / 424 s without —
 * about 36% off the whole monorepo's test leg, and every one of the 23 reporting projects got
 * faster. The same 5,446 tests ran in every arm. No test was deleted, skipped, sampled or moved off
 * the gate; the same proof simply costs less.
 *
 * The regression this file exists to catch is SILENT in the way inc-02's was: the variable still
 * reads correctly if it is set too late, so "assert the env var is set somewhere" passes on the
 * broken arrangement. tsx reads `process.env.TSX_DISABLE_CACHE` ONCE, when its own module graph is
 * evaluated, so what has to hold is an ORDER — the assignment before tsx loads. Hence the two order
 * assertions below (`--import` order in the scripts, source order in the launcher) and the one
 * end-to-end observation that a real spawned CLI leaves NO transform files behind.
 *
 * Bare `tsx <file>` invocations (the tsx BINARY, which spawns its own node) are deliberately out of
 * the totality rule's scope: they are a different launch shape with no `--import` list to order, and
 * only two remain (`packages/cli`'s `storytree` and `db` fallbacks), neither on the gate's path.
 *
 * ── THE SECOND LAUNCH SHAPE: `bun test` (`bun-test-tsx-cache-off-totality`) ──────────────────────
 *
 * A package converted to `bun test` runs no tsx itself, so it carries no `--import` list and the
 * rule above cannot see it — but its TESTS can still spawn `node <launch.mjs>` / `node --import tsx`
 * children, and the shim works by setting an INHERITED env var. So the conversion silently moves the
 * flag from "this package's own script sets it" to "whatever the caller happened to export", which
 * reverses ADR-0401 for that workload on every direct `pnpm --filter <x> test` and every bare
 * `pnpm -r test`. It only looks fine under `pnpm gate`, where the gate runner itself is a
 * `--import ../../scripts/tsx-cache-off.mjs` process and every child inherits from it.
 *
 * That is not hypothetical: `45d7637e` converted `packages/drive` and `packages/context-traversal-capture`
 * in one commit, gave drive `--preload ../../scripts/tsx-cache-off.mjs` with the reason written out
 * in the commit message — "the tsx-cache-off totality guard cannot see `bun test` scripts, so
 * nothing would catch it" — and left capture without one. Nothing did catch it.
 *
 * THE RULE, and the direction it fails in. A `bun test` script whose suite roots contain any file
 * importing `node:child_process` must pass `--preload <shim>` to `bun test`. "Can spawn a child at
 * all" is deliberately WIDER than "can spawn a tsx child": a false positive costs one env var in a
 * package that never reads it, a false negative silently reverses ADR-0401, and no text scan can
 * tell a spawned `node --import tsx` from a spawned `git` without resolving the command. Scanning
 * for a tsx entry point instead was MEASURED and rejected — `packages/forest-world-r3f` names one
 * only inside `//` comments (a false positive), while `packages/drive`'s spawning files name none
 * (a false negative, on the one package the commit above proves needs it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { declaredTestRoots } from "./mutation-diff.js";
import { nodeExecutable } from "./node-executable.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHIM_REL = "../../scripts/tsx-cache-off.mjs";
const SHIM_ABS = path.join(REPO_ROOT, "scripts", "tsx-cache-off.mjs");
/** `--import` takes a module SPECIFIER: a Windows absolute path is not one, a file:// URL is. */
const SHIM_URL = pathToFileURL(SHIM_ABS).href;
const LAUNCHER = fileURLToPath(new URL("../launch.mjs", import.meta.url));

/** Every workspace `package.json`, by repo-relative path. */
function workspaceManifests(): string[] {
  const out = [path.join(REPO_ROOT, "package.json")];
  for (const group of ["packages", "apps"]) {
    const dir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const manifest = path.join(dir, entry, "package.json");
      if (fs.existsSync(manifest)) out.push(manifest);
    }
  }
  return out;
}

/** This process's env with the flag REMOVED, so a spawn can prove what a caller's shell did not. */
function withoutFlag(): NodeJS.ProcessEnv {
  const { TSX_DISABLE_CACHE: _flag, ...rest } = process.env;
  return rest;
}

function scriptsOf(manifest: string): Array<{ name: string; command: string }> {
  const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({ name, command }));
}

test("every `--import tsx` script preloads the cache-off shim FIRST", () => {
  const offenders: string[] = [];
  const guarded = new Set<string>();
  for (const manifest of workspaceManifests()) {
    for (const { name, command } of scriptsOf(manifest)) {
      const tsxAt = command.indexOf("--import tsx");
      if (tsxAt === -1) continue;
      const shimAt = command.indexOf(`--import ${SHIM_REL}`);
      const where = `${path.relative(REPO_ROOT, manifest).replace(/\\/g, "/")} :: ${name}`;
      if (shimAt === -1) {
        offenders.push(`${where} — no \`--import ${SHIM_REL}\``);
      } else if (shimAt > tsxAt) {
        // The silent shape: the variable IS set, just after tsx has already read it.
        offenders.push(`${where} — the shim is preloaded AFTER tsx, so tsx never sees the flag`);
      } else {
        guarded.add(where);
      }
    }
  }
  assert.deepEqual(offenders, [], `scripts running tsx without the cache-off preload:\n${offenders.join("\n")}`);

  // ANTI-VACUITY, TIED TO THE EXECUTION SHAPES RATHER THAN TO A COUNT.
  //
  // This was `assert.ok(guarded >= 20)`, and a count is the wrong instrument for the job it was
  // doing: it says how MANY scripts matched, never WHICH, so the one shape whose cost the
  // measurement was actually taken on could drift out of the rule while nineteen siblings held the
  // number up. Naming the scripts makes the guard fail on the change that matters and stay quiet on
  // the churn that does not — a package added or removed no longer moves it at all.
  //
  // Both shapes the repo ships are named, because they are guarded by different text: a ROOT rung
  // (`pnpm -C packages/cli exec node --import …`) and a package-local `test`.
  for (const required of [
    "package.json :: gate",
    "package.json :: check:mutation-diff",
    "package.json :: uat:drive",
    "packages/orchestrator/package.json :: test",
  ]) {
    assert.ok(
      guarded.has(required),
      `\`${required}\` is no longer a guarded \`--import tsx\` script — either it stopped running tsx ` +
        "(then drop it from this list) or it lost the preload (then the rule above should have caught " +
        "it, and did not)",
    );
  }
});

test("the relative shim path every script uses really resolves from a package directory", () => {
  // The scripts run with cwd set to their own package (`packages/<x>`, `apps/<x>`, or — for the
  // root's `pnpm -C packages/cli exec …` rungs — `packages/cli`), so ONE relative path serves them
  // all. If the workspace ever gains a differently-nested package this fails rather than producing
  // a `Cannot find module` at gate time.
  for (const manifest of workspaceManifests()) {
    for (const { name, command } of scriptsOf(manifest)) {
      // BOTH spellings, for the same reason: node preloads with `--import`, bun with `--preload`,
      // and a bun script's path has exactly the same one chance to be wrong.
      if (!command.includes(`--import ${SHIM_REL}`) && !command.includes(`--preload ${SHIM_REL}`)) continue;
      const cwd = manifest === path.join(REPO_ROOT, "package.json")
        ? path.join(REPO_ROOT, "packages", "cli") // the root rungs all `exec` inside packages/cli
        : path.dirname(manifest);
      assert.equal(
        path.resolve(cwd, SHIM_REL),
        SHIM_ABS,
        `${path.relative(REPO_ROOT, manifest)} :: ${name} — the shim path does not resolve from its cwd`,
      );
    }
  }
});

/**
 * The `bun test` half of a `test` script — everything from the `bun test` token onward, or `null`
 * when the script does not run `bun test` at all.
 *
 * SLICING IS THE ORDER ASSERTION, and it is the only one bun needs. `packages/cli` runs the HYBRID
 * shape — `node --import <shim> --import tsx scripts/validate-corpus.ts && bun test …` — so a plain
 * `command.includes("--preload <shim>")` would be satisfied by the NODE half alone and read as
 * guarded while `bun test` ran bare. Everything this function returns is text bun actually parses.
 */
function bunSegmentOf(script: string): string | null {
  const at = script.search(/\bbun\s+test\b/);
  return at === -1 ? null : script.slice(at);
}

/**
 * Whether a `bun test` script must carry the preload, and why — pure, so the negative fixture below
 * can state a conversion that never happened.
 *
 * `spawnWitness` is the caller's answer to "can this package's suites spawn a child process at
 * all", named as a FILE rather than a boolean so the offence can point at the evidence instead of
 * asserting it.
 */
function bunPreloadOffence(args: {
  readonly where: string;
  readonly bunSegment: string;
  readonly spawnWitness: string | null;
}): string | null {
  if (args.spawnWitness === null) return null;
  if (args.bunSegment.includes(`--preload ${SHIM_REL}`)) return null;
  return (
    `${args.where} — \`bun test\` with no \`--preload ${SHIM_REL}\`, and ${args.spawnWitness} ` +
    "spawns child processes, which would inherit tsx's on-disk cache back on"
  );
}

/** The first file under `roots` that imports `node:child_process`, or `null`. */
function spawnWitnessFor(packageDir: string, roots: readonly string[]): string | null {
  const walk = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = walk(full);
        if (nested !== null) return nested;
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs)$/.test(entry.name)) continue;
      // Read as BYTES, not text. The scan covers ~35 MB of workspace source and the only question
      // asked of it is whether one ASCII specifier appears, so decoding every file to UTF-16 first
      // IS the cost, for an identical answer. Measured under bun on this repo: this test 9.2 s ->
      // 0.8 s, and the whole file 29.4 s -> 20.9 s.
      if (fs.readFileSync(full).includes("node:child_process")) {
        return path.relative(REPO_ROOT, full).replace(/\\/g, "/");
      }
    }
    return null;
  };
  for (const root of roots) {
    const found = walk(path.join(packageDir, root));
    if (found !== null) return found;
  }
  return null;
}

test("every `bun test` script whose suites can spawn preloads the cache-off shim", () => {
  const offenders: string[] = [];
  const guarded = new Set<string>();
  for (const manifest of workspaceManifests()) {
    const packageDir = path.dirname(manifest);
    for (const { name, command } of scriptsOf(manifest)) {
      const bunSegment = bunSegmentOf(command);
      if (bunSegment === null) continue;
      const where = `${path.relative(REPO_ROOT, manifest).replace(/\\/g, "/")} :: ${name}`;
      // The project's OWN answer to where its suites live, reused rather than re-derived — the
      // same parser the mutation rung narrows on, so the two cannot disagree about `src/ electron/`.
      const roots = declaredTestRoots({
        testScript: command,
        isDirectory: (rel) => {
          try {
            return fs.statSync(path.join(packageDir, rel)).isDirectory();
          } catch {
            return false;
          }
        },
      });
      const spawnWitness = spawnWitnessFor(packageDir, roots);
      const offence = bunPreloadOffence({ where, bunSegment, spawnWitness });
      if (offence !== null) offenders.push(offence);
      else if (spawnWitness !== null) guarded.add(where);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `bun test scripts whose suites spawn children, without the cache-off preload:\n${offenders.join("\n")}`,
  );

  // Anti-vacuity on the same principle as the `--import` rule above, and naming the two packages
  // the conversion commit itself reasoned about: `drive` is the shape that GOT the preload and
  // `cli` the hybrid, which is the one a whole-string match would wave through.
  for (const required of ["packages/drive/package.json :: test", "packages/cli/package.json :: test"]) {
    assert.ok(guarded.has(required), `\`${required}\` is no longer a guarded spawning bun suite`);
  }
});

test("a Bun conversion that drops the preload is named — the negative fixture", () => {
  // The regression stated as input rather than found in the tree: this is exactly what
  // `packages/drive`'s script would have looked like had `45d7637e` translated it the way it
  // translated `packages/context-traversal-capture`'s.
  assert.equal(
    bunPreloadOffence({
      where: "packages/example/package.json :: test",
      bunSegment: "bun test --timeout 300000 src/",
      spawnWitness: "packages/example/src/thing.test.ts",
    }),
    "packages/example/package.json :: test — `bun test` with no `--preload ../../scripts/tsx-cache-off.mjs`, " +
      "and packages/example/src/thing.test.ts spawns child processes, which would inherit tsx's on-disk cache back on",
  );

  // …and the two states that are NOT offences, so the rule cannot be satisfied by refusing everything.
  assert.equal(
    bunPreloadOffence({
      where: "packages/example/package.json :: test",
      bunSegment: `bun test --preload ${SHIM_REL} --timeout 300000 src/`,
      spawnWitness: "packages/example/src/thing.test.ts",
    }),
    null,
  );
  assert.equal(
    bunPreloadOffence({
      where: "packages/pure/package.json :: test",
      bunSegment: "bun test --timeout 300000 src/",
      spawnWitness: null,
    }),
    null,
  );
});

test("the preload is read off the `bun test` half, never the whole command", () => {
  // The hybrid shape's silent failure: node is preloaded, bun is not, and a whole-string match
  // cannot tell that apart from the real thing. `packages/cli` ships the correct version of this
  // exact command, so the wrong reading would be green on it forever.
  assert.equal(bunSegmentOf(`node --import ${SHIM_REL} --import tsx scripts/x.ts && bun test src/`), "bun test src/");
  assert.equal(
    bunPreloadOffence({
      where: "packages/example/package.json :: test",
      bunSegment: bunSegmentOf(`node --import ${SHIM_REL} --import tsx scripts/x.ts && bun test src/`) ?? "",
      spawnWitness: "packages/example/src/thing.test.ts",
    }),
    "packages/example/package.json :: test — `bun test` with no `--preload ../../scripts/tsx-cache-off.mjs`, " +
      "and packages/example/src/thing.test.ts spawns child processes, which would inherit tsx's on-disk cache back on",
  );
  assert.equal(bunSegmentOf("node --import tsx --test src/"), null);
});

test("the shim sets TSX_DISABLE_CACHE, observed in a real preloaded process", () => {
  const res = spawnSync(
    nodeExecutable(),
    ["--import", SHIM_URL, "-e", "process.stdout.write(process.env.TSX_DISABLE_CACHE ?? '<unset>')"],
    // The child's env is built explicitly, with the flag REMOVED: the claim is what the shim does
    // when nothing has set it, and inheriting an ambient value would make this test agree with
    // whatever the caller already had — including the empty-string escape hatch.
    { encoding: "utf8", env: withoutFlag() },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "1");
});

test("the shim leaves an explicit TSX_DISABLE_CACHE alone — the escape hatch", () => {
  // tsx tests the variable for TRUTHINESS, so `=0` would still disable the cache; the EMPTY string
  // is the only way back to the on-disk cache, and `??=` is what preserves it.
  const res = spawnSync(
    nodeExecutable(),
    ["--import", SHIM_URL, "-e", "process.stdout.write(JSON.stringify(process.env.TSX_DISABLE_CACHE))"],
    { encoding: "utf8", env: { ...process.env, TSX_DISABLE_CACHE: "" } },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '""', "an explicitly emptied flag must survive, or the cache cannot be re-enabled");
});

test("bun's --preload runs the same shim, escape hatch and all", () => {
  // The bun rule above is only worth anything if `--preload` really is the faithful translation of
  // `--import`, so this OBSERVES it rather than assuming it — the two flags belong to different
  // runtimes and nothing but a run can say they agree.
  //
  // BOTH arms, because the escape hatch is the half a conversion could silently break: CI sets
  // `TSX_DISABLE_CACHE: ""` on every job (a hosted runner's cache is fresh and worth keeping), and
  // that only survives because the shim assigns with `??=`. A bun package that preloaded something
  // which overwrote the variable would cost CI ~30% while reading as correct in the diff.
  const run = (env: NodeJS.ProcessEnv): string => {
    const res = spawnSync(
      "bun",
      ["--preload", SHIM_ABS, "-e", "process.stdout.write(JSON.stringify(process.env.TSX_DISABLE_CACHE))"],
      { encoding: "utf8", env, shell: process.platform === "win32" },
    );
    assert.equal(res.status, 0, `bun must be on PATH for this repo's test runners — ${res.stderr}`);
    return res.stdout;
  };
  assert.equal(run(withoutFlag()), '"1"', "a bun suite with no ambient flag must still disable the cache");
  assert.equal(
    run({ ...process.env, TSX_DISABLE_CACHE: "" }),
    '""',
    "CI's explicitly-emptied flag must survive the preload, or a bun package costs CI its cache",
  );
});

test("the launcher sets the flag BEFORE it imports tsx", () => {
  // A source-ORDER assertion for the same reason inc-02 needed one: move the assignment below the
  // import and every behaviour still holds, the cache is simply back on. Nothing else would fail.
  const src = fs.readFileSync(LAUNCHER, "utf8");
  const set = src.indexOf('process.env["TSX_DISABLE_CACHE"]');
  const importTsx = src.indexOf('import("tsx/esm/api")');
  assert.notEqual(set, -1, "launch.mjs must disable tsx's on-disk transform cache");
  assert.notEqual(importTsx, -1, "launch.mjs must still register tsx");
  assert.ok(set < importTsx, "the flag is read when tsx loads — setting it afterwards buys nothing");
});

test("a real spawned CLI writes NO tsx transform-cache files", () => {
  // The end-to-end observation, and the only assertion here that would survive tsx changing how it
  // spells the flag: run the REAL launcher with its temp directory redirected somewhere empty, and
  // look at what it left behind. On the pre-change launcher this directory fills with one file per
  // transformed module.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tsx-cache-off-"));
  try {
    const res = spawnSync(nodeExecutable(), [LAUNCHER, "not-a-real-storytree-command"], {
      encoding: "utf8",
      // Ambient flag stripped for the same reason as above — what is on trial is the LAUNCHER's own
      // line, not whatever the shell that started the gate happened to export.
      env: { ...withoutFlag(), TMPDIR: scratch, TEMP: scratch, TMP: scratch },
    });
    assert.notEqual(res.status, 0, "an unknown command still exits non-zero — the CLI is unchanged");

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(path.relative(scratch, full));
      }
    };
    walk(scratch);
    assert.deepEqual(
      files,
      [],
      `the launcher left transform-cache files behind, so tsx's on-disk cache is still on:\n${files
        .slice(0, 10)
        .join("\n")}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("this very test process inherited the preload — the wiring reaches where the work happens", () => {
  // The end of the chain, asserted from INSIDE it. `node --test` spawns one child per test file and
  // forwards its `--import` list, so if that forwarding ever stopped, every runner child would be
  // back on the on-disk cache while the package script still looked correct — the whole win lost in
  // silence. Nothing else in this file would notice: the script-order test reads package.json, and
  // the launcher tests spawn a process that sets the flag for itself.
  //
  // What is asserted is that the variable is DEFINED, not that it equals "1", and the difference is
  // the whole point. `undefined` is the only value that means "the preload never ran here" — the
  // regression. Any defined value means it ran: "1" is its default, and the EMPTY string is a caller
  // who deliberately kept tsx's cache, which CI does on every job (see `.github/workflows/ci.yml`)
  // because a fresh runner's cache is healthy. Asserting "1" here would red the whole suite on the
  // one configuration the repo deliberately ships.
  //
  // Running this file by hand as `node --import tsx --test src/tsx-cache-off.test.ts` fails here, and
  // that is the intended reading: that invocation is not the one the gate runs. Use `pnpm test`, or
  // add `--import ../../scripts/tsx-cache-off.mjs` ahead of `--import tsx`.
  assert.notEqual(
    process.env["TSX_DISABLE_CACHE"],
    undefined,
    "the cache-off preload did not reach this test process — run the package's own `pnpm test`",
  );
});

test("CI opts back IN to tsx's cache, and spells it the one way that works", () => {
  // A hosted runner gets a fresh VM per job, so its cache cannot bloat and is a large WIN there —
  // measured at suite scale: a fresh cache runs `pnpm -r --no-bail test` in 273-296s against 358s
  // with the cache off. So CI sets the variable back.
  //
  // THE SPELLING IS THE WHOLE RISK. tsx tests this variable for TRUTHINESS, so `"0"` — the spelling
  // anyone would reach for to mean "off" — still DISABLES the cache, silently costing CI ~30% while
  // reading as correct in the diff. Only the empty string survives `??=` AND reads falsy to tsx.
  const ci = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const declared = /^\s*TSX_DISABLE_CACHE:\s*(.*)$/m.exec(ci);
  assert.ok(declared, "ci.yml must declare TSX_DISABLE_CACHE — a runner's cache is healthy and worth keeping");
  assert.equal(
    declared[1]?.trim(),
    '""',
    'CI must set TSX_DISABLE_CACHE to the EMPTY string — "0" is truthy to tsx and would disable the cache',
  );
});
