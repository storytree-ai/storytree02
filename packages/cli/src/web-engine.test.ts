// `check:web-engine` end to end, over REAL git state (`wes-off-pin-checkout-refuses-first`).
//
// The pure half — which sight means what — is `web-engine-sync.test.ts`. What only a real repository
// can show is the shell's reading of it: that the pin comes from the parent's INDEX, that a `web/`
// with no git of its own is not mistaken for the parent, and that an off-pin checkout stops the run
// before any file is compared while a checkout ON the pin still gets the ordinary drift diagnosis.
// Each fixture is a throwaway parent repository whose index records `web` as a gitlink — exactly the
// entry a submodule bump stages — over a nested `web/` repository holding a synced copy.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkWebEngine, readCheckoutPin, type EngineCheckout } from "./web-engine.js";
import { computeSyncPlan, judgeEngineCheck, type EnginePackage } from "./web-engine-sync.js";

/** One small synced package. The real two need the real forest-world sources, and what is under test
 *  here is the reading of the checkout, not their contents. */
const PKG: EnginePackage = {
  srcDir: "pkg/src",
  destDir: "src/lib/pkg",
  requiredFiles: ["index.ts"],
  bannerBody: (file) => `// Synced from pkg/src/${file} (fixture).\n`,
};
const SOURCES = new Map([["index.ts", "export const answer = 42;\n"]]);
const SYNCED_FILE = ["src", "lib", "pkg", "index.ts"] as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c", "user.email=fixture@example.invalid", "-c", "user.name=Web Engine Fixture",
      "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** Record `web` at `sha` in the parent's index — the gitlink a submodule bump stages. */
function record(repoRoot: string, sha: string): void {
  git(repoRoot, "update-index", "--add", "--cacheinfo", `160000,${sha},web`);
}

/** Commit whatever is in `web/` and hand back the new commit. */
function commitWeb(webRoot: string, message: string): string {
  git(webRoot, "add", "-A");
  git(webRoot, "commit", "-q", "-m", message);
  return git(webRoot, "rev-parse", "HEAD");
}

/** A throwaway parent + `web/` pair, and the web commit the parent records. */
interface Fixture {
  readonly at: EngineCheckout;
  readonly first: string;
}

/** A parent whose index records `web` at the nested repository's first commit, which holds a
 *  faithful synced copy of {@link PKG}. */
function fixture(): Fixture {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "web-engine-pin-"));
  const webRoot = path.join(repoRoot, "web");
  git(repoRoot, "init", "-q");
  mkdirSync(path.join(repoRoot, "pkg", "src"), { recursive: true });
  for (const [file, text] of SOURCES) writeFileSync(path.join(repoRoot, "pkg", "src", file), text);

  mkdirSync(path.join(webRoot, ...SYNCED_FILE.slice(0, -1)), { recursive: true });
  git(webRoot, "init", "-q");
  for (const item of computeSyncPlan(SOURCES, PKG)) {
    writeFileSync(path.join(webRoot, ...item.path.split("/")), item.content);
  }
  const first = commitWeb(webRoot, "synced");
  record(repoRoot, first);
  return { at: { repoRoot, webRoot }, first };
}

function check(at: EngineCheckout): ReturnType<typeof checkWebEngine> {
  return checkWebEngine(at, { inCi: false, packages: [PKG] });
}

test("wes-off-pin-checkout-refuses-first: a checkout on the recorded commit reads as on the pin, and its faithful copy compares OK", () => {
  const { at, first } = fixture();
  try {
    assert.deepEqual(readCheckoutPin(at), { pin: first, checkedOut: first });
    assert.deepEqual(check(at), {
      status: "ok",
      message: "check:web-engine — OK: 1 synced file(s) across src/lib/pkg match their packages.",
    });
  } finally {
    rmSync(at.repoRoot, { recursive: true, force: true });
  }
});

test("wes-off-pin-checkout-refuses-first: a checkout moved off the recorded commit refuses BEFORE comparing — even over a drifted copy", () => {
  const { at, first } = fixture();
  try {
    // The friction's exact shape: web/ moves to another commit while the parent still records the
    // first, AND the copy on disk differs from the packages — so a comparison, had it run, would
    // have reported source drift and prescribed a sync.
    writeFileSync(path.join(at.webRoot, ...SYNCED_FILE), "// an older engine\n");
    const moved = commitWeb(at.webRoot, "elsewhere");

    assert.deepEqual(readCheckoutPin(at), { pin: first, checkedOut: moved });
    const verdict = check(at);
    assert.deepEqual(verdict, judgeEngineCheck({ kind: "off-pin", pin: first, checkedOut: moved }, { inCi: false }));
    assert.doesNotMatch(verdict.message, /drifted/, "no file was compared");
  } finally {
    rmSync(at.repoRoot, { recursive: true, force: true });
  }
});

test("wes-off-pin-checkout-refuses-first: a bump staged in the index IS the recorded commit — the pin is read from the index, not HEAD", () => {
  const { at, first } = fixture();
  try {
    git(at.repoRoot, "add", "pkg");
    git(at.repoRoot, "commit", "-q", "-m", "parent records the first web commit");
    writeFileSync(path.join(at.webRoot, "README.md"), "a website change that leaves the copy faithful\n");
    const bumped = commitWeb(at.webRoot, "website moves on");
    record(at.repoRoot, bumped); // staged, not committed — how `pnpm land:web-engine` leaves it

    assert.equal(git(at.repoRoot, "rev-parse", "HEAD:web"), first, "fixture: HEAD still records the old commit");
    assert.deepEqual(readCheckoutPin(at), { pin: bumped, checkedOut: bumped });
    assert.equal(check(at).status, "ok");
  } finally {
    rmSync(at.repoRoot, { recursive: true, force: true });
  }
});

test("wes-off-pin-checkout-refuses-first: genuine drift ON the recorded commit keeps the source-drift diagnosis", () => {
  const { at } = fixture();
  try {
    writeFileSync(path.join(at.webRoot, ...SYNCED_FILE), "// a hand edit to the public copy\n");
    record(at.repoRoot, commitWeb(at.webRoot, "drifted, and recorded"));

    const verdict = check(at);
    assert.equal(verdict.status, "fail");
    assert.equal(
      verdict.message.split("\n").slice(0, 3).join("\n"),
      "check:web-engine — BLOCKED: the website's synced copy of pkg/src has drifted (1 file(s)):\n\n" +
        "  ✗ src/lib/pkg/index.ts: the synced copy is STALE — the core changed; re-run `pnpm sync:web-engine`",
    );
    assert.match(verdict.message, /RUN: {2}pnpm land:web-engine/, "here the sync-and-bump remedy is the right one");
  } finally {
    rmSync(at.repoRoot, { recursive: true, force: true });
  }
});

test("wes-off-pin-checkout-refuses-first: a web/ with no git of its own is unreadable — never read as the parent's HEAD", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "web-engine-pin-"));
  const webRoot = path.join(repoRoot, "web");
  try {
    git(repoRoot, "init", "-q");
    mkdirSync(path.join(webRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "README.md"), "parent\n");
    git(repoRoot, "add", "README.md");
    git(repoRoot, "commit", "-q", "-m", "a parent HEAD that `git -C web` would walk up to");
    const parentHead = git(repoRoot, "rev-parse", "HEAD");
    const at = { repoRoot, webRoot };

    // No gitlink recorded yet: the pin itself is unreadable.
    assert.deepEqual(readCheckoutPin(at), { pin: null, checkedOut: null });

    record(repoRoot, parentHead);
    assert.deepEqual(readCheckoutPin(at), { pin: parentHead, checkedOut: null }, "not the parent's HEAD");
    assert.deepEqual(
      check(at),
      judgeEngineCheck(
        { kind: "pin-unreadable", what: "the commit web/ is checked out at (`git -C web rev-parse HEAD`)" },
        { inCi: false },
      ),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
