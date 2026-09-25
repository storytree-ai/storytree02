import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { captureComparativeForest } from "./forest-comparative-capture.js";

type Deps = Parameters<typeof captureComparativeForest>[1];
type Target = { kind: "square"; x: number; y: number; size: number }
  | { kind: "story-node"; id: string }
  | { kind: "island"; id: string }
  | { kind: "resting" }
  | { kind: "fit" };

const targets: Target[] = [
  { kind: "square", x: 10, y: 20, size: 30 },
  { kind: "story-node", id: "alpha" },
  { kind: "island", id: "shore" },
  { kind: "resting" },
  { kind: "fit" },
];
const viewport = { width: 1440, height: 900 };
const padding = { top: 11, right: 23, bottom: 37, left: 41 };
const argv = [
  "forest", "compare", "--branch-url", "http://branch.test", "--baseline-url", "http://baseline.test",
  "--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41",
  "--square", "10,20,30", "--story", "alpha", "--island", "shore", "--resting", "--fit",
];

function receipt(target: Target, arm: "baseline" | "branch", index: number) {
  return {
    requested: target,
    resolved: target.kind === "square"
      ? { bounds: { x: target.x, y: target.y, width: target.size, height: target.size } }
      : target.kind === "story-node" || target.kind === "island"
        ? { id: target.id, bounds: { x: 1, y: 2, width: 3, height: 4 } }
        : undefined,
    applied: { tx: arm === "baseline" ? index : index + 100, ty: -index, scale: 1.25 },
    viewport,
    padding,
    revision: arm === "baseline" ? "base-sha" : "branch-sha",
    settled: { settled: true, phase: "settled", serial: index + 1 },
  };
}

function successfulDeps(overrides: Partial<Deps> = {}) {
  const calls: Array<{ arm: "baseline" | "branch"; target: Target; viewport: unknown; padding: unknown }> = [];
  const writes: Array<{ path: string; content: Uint8Array | string }> = [];
  const published: string[] = [];
  const countCalls: Array<"baseline" | "branch"> = [];
  const deps = {
    async capture(arm: "baseline" | "branch", target: Target, frame: typeof viewport, inset: typeof padding) {
      calls.push({ arm, target, viewport: frame, padding: inset });
      const index = calls.filter((call) => call.arm === arm).length - 1;
      return { receipt: receipt(target, arm, index), png: new Uint8Array([index, arm === "baseline" ? 0 : 1]) };
    },
    async elementCounts(arm: "baseline" | "branch") {
      countCalls.push(arm);
      if (arm === "baseline") return { parcels: 5, islands: 2, portals: 1 };
      assert.equal(arm, "branch");
      return { parcels: 6, islands: 2, portals: 1 };
    },
    async writeCandidate(path: string, content: Uint8Array | string) { writes.push({ path, content }); },
    async publish(path: string) { published.push(path); },
    async removeCandidate(_path: string) {},
    ...overrides,
  } satisfies Deps;
  return { deps, calls, countCalls, writes, published };
}

describe("fcsc-cli-replays-one-canonical-target-list-to-both-arms: both revisions receive one ordered semantic frame", () => {
  test("replays square, story, island, resting and fit targets with one viewport and asymmetric padding", async () => {
    const fixture = successfulDeps();
    assert.deepEqual(await captureComparativeForest(argv, fixture.deps), { ok: true });
    assert.deepEqual(fixture.calls.map((call) => call.arm), [
      "baseline", "baseline", "baseline", "baseline", "baseline",
      "branch", "branch", "branch", "branch", "branch",
    ]);
    assert.deepEqual(fixture.calls.slice(0, 5).map((call) => call.target), targets);
    assert.deepEqual(fixture.calls.slice(5).map((call) => call.target), targets);
    for (const call of fixture.calls) {
      assert.deepEqual(call.viewport, viewport);
      assert.deepEqual(call.padding, padding);
    }
  });
});

describe("fcsc-cli-refuses-an-incomplete-or-malformed-frame-before-capture", () => {
  test("requires output, a strict positive-looking WxH token, four finite padding values, and at least one target", async () => {
    const invalidArguments = [
      argv.filter((entry) => entry !== "/review" && entry !== "--output"),
      argv.filter((entry) => entry !== "1440x900" && entry !== "--viewport"),
      argv.filter((entry) => entry !== "11,23,37,41" && entry !== "--padding"),
      ["forest", "compare", "--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41"],
      ["--output", "/review", "--viewport", "1440x", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "x900", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "1440x900extra", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37", "--fit"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,nope,41", "--fit"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41", "--square", "10,20"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41", "--square", "10,nope,30"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41", "--story"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41", "--island"],
      ["--unknown", "injected-output", "--viewport", "1440x900", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--unknown", "1440x900", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "extra1440x900", "--padding", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "1440x900", "--unknown", "11,23,37,41", "--fit"],
      ["--output", "/review", "--viewport", "1440x900", "--padding", "11,23,37,41", "--unknown", "10,20,30"],
      [...argv, "--output"],
      [...argv, "--viewport"],
      [...argv, "--padding"],
      [...argv, "--square"],
    ];
    for (const invalid of invalidArguments) {
      const fixture = successfulDeps();
      assert.deepEqual(await captureComparativeForest(invalid, fixture.deps), { ok: false, code: "comparison-failed" });
      assert.equal(fixture.calls.length, 0, `capture must not start for ${invalid.join(" ")}`);
      assert.equal(fixture.countCalls.length, 0);
      assert.equal(fixture.writes.length, 0);
      assert.equal(fixture.published.length, 0);
    }
  });

  test("requires a resolved subject when both arms agree that a square or named subject is unresolved", async () => {
    const fixture = successfulDeps({
      async capture(arm: "baseline" | "branch", target: Target) {
        return { receipt: { ...receipt(target, arm, 0), resolved: undefined }, png: new Uint8Array([1]) };
      },
    });
    assert.deepEqual(await captureComparativeForest(argv, fixture.deps), { ok: false, code: "comparison-failed" });
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.published.length, 0);
  });
});

describe("fcsc-cli-validates-applied-receipt-pairs-before-output: comparability is established before any review artifact", () => {
  test("refuses mismatched subjects, frame, settlement, or revision before publishing", async () => {
    const broken = [
      (value: ReturnType<typeof receipt>) => ({ ...value, requested: { kind: "fit" } as Target }),
      (value: ReturnType<typeof receipt>) => ({ ...value, resolved: undefined }),
      (value: ReturnType<typeof receipt>) => ({ ...value, resolved: { id: "wrong", bounds: { x: 1, y: 2, width: 3, height: 4 } } }),
      (value: ReturnType<typeof receipt>) => ({ ...value, viewport: { width: 1, height: 1 } }),
      (value: ReturnType<typeof receipt>) => ({ ...value, padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
      (value: ReturnType<typeof receipt>) => ({ ...value, settled: { ...value.settled, settled: false } }),
      (value: ReturnType<typeof receipt>) => ({ ...value, settled: { ...value.settled, phase: "moving" } }),
      (value: ReturnType<typeof receipt>) => ({ ...value, revision: "" }),
    ];
    for (const corrupt of broken) {
      const fixture = successfulDeps({
        async capture(arm: "baseline" | "branch", target: Target, _frame: typeof viewport, _inset: typeof padding) {
          const index = target.kind === "fit" ? 4 : 0;
          const value = receipt(target as Target, arm, index);
          return { receipt: arm === "branch" ? corrupt(value) : value, png: new Uint8Array([1]) };
        },
      });
      const result = await captureComparativeForest(argv, fixture.deps);
      assert.equal(result.ok, false);
      assert.equal(fixture.published.length, 0, "a corrupt pair must never become public");
      assert.equal(fixture.writes.some((entry) => /contact|index/.test(entry.path)), false);
    }
  });
});

describe("fcsc-cli-publishes-a-complete-target-indexed-review-set: several targets become one scannable review batch", () => {
  test("publishes paired views, original receipts, count comparison, and a target-indexed contact sheet only after every pair is coherent", async () => {
    const fixture = successfulDeps();
    assert.deepEqual(await captureComparativeForest(argv, fixture.deps), { ok: true });
    const paths = fixture.writes.map((entry) => entry.path);
    for (let index = 1; index <= targets.length; index += 1) {
      assert.ok(paths.includes(`/review/baseline/forest-${index}.png`));
      assert.ok(paths.includes(`/review/branch/forest-${index}.png`));
      assert.ok(paths.includes(`/review/baseline/forest-${index}.json`));
      assert.ok(paths.includes(`/review/branch/forest-${index}.json`));
    }
    const index = fixture.writes.find((entry) => entry.path === "/review/index.json");
    assert.ok(index, "the review set has a target-indexed entry point");
    const review = JSON.parse(String(index.content));
    assert.deepEqual(review.targets.map((entry: { requested: Target }) => entry.requested), targets);
    assert.deepEqual(review.targets.map((entry: { order: number }) => entry.order), [1, 2, 3, 4, 5]);
    assert.equal(review.comparison.baseline.parcels, 5);
    assert.equal(review.comparison.branch.parcels, 6);
    assert.ok(paths.includes("/review/contact-sheet.png"));
    assert.deepEqual(fixture.published.sort(), [...paths].sort(), "publication is the complete private batch, not a loose image pile");
  });
});

describe("fcsc-cli-keeps-arm-provenance-separate-and-explicit: each render names the revision that served it", () => {
  test("keeps arm-specific applied cameras and revisions in the paired receipts and index", async () => {
    const fixture = successfulDeps();
    assert.deepEqual(await captureComparativeForest(argv, fixture.deps), { ok: true });
    const baseline = JSON.parse(String(fixture.writes.find((entry) => entry.path === "/review/baseline/forest-1.json")?.content));
    const branch = JSON.parse(String(fixture.writes.find((entry) => entry.path === "/review/branch/forest-1.json")?.content));
    assert.equal(baseline.revision, "base-sha");
    assert.equal(branch.revision, "branch-sha");
    assert.notDeepEqual(baseline.applied, branch.applied, "applied cameras are evidence for their own arm, not forced equal");
    const index = JSON.parse(String(fixture.writes.find((entry) => entry.path === "/review/index.json")?.content));
    assert.deepEqual(index.revisions, { baseline: "base-sha", branch: "branch-sha" });
  });
});

describe("fcsc-cli-refuses-without-a-ready-looking-partial-comparison: failures leave no complete-looking review result", () => {
  test("cleans candidate output when the contact sheet or index cannot be written", async () => {
    for (const failedPath of ["/review/contact-sheet.png", "/review/index.json"]) {
      const removed: string[] = [];
      const writes: Array<{ path: string; content: Uint8Array | string }> = [];
      const fixture = successfulDeps({
        async writeCandidate(path: string, content: Uint8Array | string) {
          if (path === failedPath) throw new Error("review metadata write failed");
          writes.push({ path, content });
        },
        async removeCandidate(path: string) { removed.push(path); },
      });
      assert.deepEqual(await captureComparativeForest(argv, fixture.deps), { ok: false, code: "comparison-failed" });
      assert.equal(fixture.published.length, 0);
      assert.ok(removed.length > 0, "private candidates are removed after a failed batch");
      assert.equal(writes.some((entry) => entry.path === "/review/index.json"), failedPath === "/review/contact-sheet.png");
    }
  });
});
