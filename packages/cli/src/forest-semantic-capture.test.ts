import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  captureForestSemantics,
  type ForestSemanticCaptureDeps,
} from "./forest-semantic-capture.js";

type Target =
  | { kind: "square"; x: number; y: number; size: number }
  | { kind: "story-node"; id: string }
  | { kind: "island"; id: string }
  | { kind: "resting" }
  | { kind: "fit" };

type Camera = { tx: number; ty: number; scale: number };

const CAMERA: Camera = { tx: 41, ty: -18, scale: 1.25 };
const VIEWPORT = { width: 1280, height: 720 };
const PADDING = { top: 18, right: 24, bottom: 18, left: 24 };

function successfulDeps(overrides: Partial<ForestSemanticCaptureDeps> = {}): ForestSemanticCaptureDeps & {
  requests: Target[];
  settled: Camera[];
  writes: Array<{ path: string; content: Uint8Array | string }>;
  published: string[];
  closed: string[];
  starts: number;
} {
  const requests: Target[] = [];
  const settled: Camera[] = [];
  const writes: Array<{ path: string; content: Uint8Array | string }> = [];
  const published: string[] = [];
  const closed: string[] = [];
  let starts = 0;
  const browser = {
    async capture(target: Target, frame: typeof VIEWPORT, padding: typeof PADDING) {
      requests.push(target);
      assert.deepEqual(frame, VIEWPORT, "the page seam receives the explicit viewport");
      assert.deepEqual(padding, PADDING, "the page seam receives the explicit padding");
      return {
        ok: true as const,
        kind: target.kind,
        frame,
        camera: { ...CAMERA },
        resolved: target.kind === "square"
          ? { bounds: { x: target.x, y: target.y, width: target.size, height: target.size } }
          : target.kind === "story-node" || target.kind === "island"
            ? { id: target.id, bounds: { x: 10, y: 20, width: 30, height: 40 } }
            : undefined,
      };
    },
    async settledAfter(camera: Camera) {
      if (overrides.settledAfter) {
        return overrides.settledAfter(camera);
      }
      settled.push(camera);
      return { settled: true, phase: "settled", camera: { ...camera }, serial: settled.length };
    },
    async screenshot() { return new Uint8Array([137, 80, 78, 71]); },
    async close() { closed.push("browser"); },
  };
  const deps = {
    async connect(url: string) { assert.equal(url, "http://served-studio.test"); return browser; },
    async start() { starts += 1; return { browser, studioUrl: "http://owned-studio.test", async close() { closed.push("server"); } }; },
    async revision() { return "served-revision-42"; },
    async writeCandidate(path: string, content: Uint8Array | string) { writes.push({ path, content }); },
    async publish(path: string) { published.push(path); },
    async removeCandidate(path: string) { closed.push(`remove:${path}`); },
    ...overrides,
  } as ForestSemanticCaptureDeps;
  Object.assign(deps, { requests, settled, writes, published, closed });
  Object.defineProperty(deps, "starts", { enumerable: true, get: () => starts });
  return deps as ForestSemanticCaptureDeps & {
    requests: Target[];
    settled: Camera[];
    writes: Array<{ path: string; content: Uint8Array | string }>;
    published: string[];
    closed: string[];
    starts: number;
  };
}

const invocation = [
  "forest", "capture", "--studio-url", "http://served-studio.test", "--output", "/captures",
  "--viewport", "1280x720", "--padding", "18,24,18,24",
];

describe("fsc-cli-normalizes-one-semantic-target-grammar: target flags become canonical page requests", () => {
  test("normalizes repeatable target flags once, in invocation order, without input gestures", async () => {
    const deps = successfulDeps();
    const result = await captureForestSemantics([
      ...invocation, "--square", "1,2,3", "--story", "alpha", "--island", "shore", "--resting", "--fit",
    ], deps);

    assert.equal(result.ok, true);
    assert.deepEqual(deps.requests, [
      { kind: "square", x: 1, y: 2, size: 3 }, { kind: "story-node", id: "alpha" },
      { kind: "island", id: "shore" }, { kind: "resting" }, { kind: "fit" },
    ]);
    assert.equal(deps.settled.length, 5, "each semantic request is followed by a fresh settle attestation");
  });
});

describe("fsc-cli-reuses-or-owns-the-session-explicitly: lifecycle does not change capture semantics", () => {
  // test-updated (refactor): retain the fixture's live start counter instead of copying its initial getter value.
  test("reuses supplied Studio and compatible browser sessions, while closing only resources it started", async () => {
    const reusedStudio = successfulDeps();
    assert.deepEqual(await captureForestSemantics([...invocation, "--square", "1,2,3"], reusedStudio), { ok: true });
    assert.equal(reusedStudio.starts, 0);
    assert.equal(reusedStudio.requests.length, 1);
    assert.deepEqual(reusedStudio.closed, [], "a supplied Studio URL remains the caller's resource");

    const reusedBrowser = successfulDeps();
    assert.deepEqual(await captureForestSemantics([...invocation.filter((arg) => arg !== "--studio-url" && arg !== "http://served-studio.test"), "--browser", "compatible", "--square", "1,2,3"], reusedBrowser), { ok: true });
    assert.equal(reusedBrowser.starts, 0);
    assert.equal(reusedBrowser.requests.length, 1);
    assert.deepEqual(reusedBrowser.closed, [], "a supplied browser remains the caller's resource");

    const owned = successfulDeps();
    assert.deepEqual(await captureForestSemantics(["forest", "capture", "--output", "/captures", "--viewport", "1280x720", "--padding", "18,24,18,24", "--square", "1,2,3"], owned), { ok: true });
    assert.equal(owned.starts, 1);
    assert.deepEqual(owned.closed.sort(), ["browser", "server"]);
  });
});

describe("fsc-cli-publishes-an-applied-settled-receipt: an image has a machine-checkable account of itself", () => {
  test("writes no public artifact until the seam receipt and fresh settled camera agree", async () => {
    const deps = successfulDeps();
    const result = await captureForestSemantics([...invocation, "--square", "1,2,3"], deps);
    assert.equal(result.ok, true);
    assert.equal(deps.writes.length, 2, "PNG and JSON are first written as a private pair");
    assert.equal(deps.published.length, 2, "only a coherent pair is published");
    const receipt = JSON.parse(String(deps.writes.find((write: { path: string }) => write.path.endsWith(".json"))?.content));
    assert.deepEqual(receipt.requested, { kind: "square", x: 1, y: 2, size: 3 });
    assert.deepEqual(receipt.applied, CAMERA);
    assert.deepEqual(receipt.resolved.bounds, { x: 1, y: 2, width: 3, height: 3 });
    assert.deepEqual(receipt.viewport, VIEWPORT);
    assert.deepEqual(receipt.padding, PADDING);
    assert.deepEqual(receipt.settled.camera, CAMERA);
  });
});

describe("fsc-cli-never-labels-local-head-as-an-external-page-revision: provenance identifies the rendered page", () => {
  test("records the served revision and refuses when a reused page cannot name one", async () => {
    const deps = successfulDeps();
    const success = await captureForestSemantics([...invocation, "--square", "1,2,3"], deps);
    assert.equal(success.ok, true);
    const receipt = JSON.parse(String(deps.writes.find((write: { path: string }) => write.path.endsWith(".json"))?.content));
    assert.equal(receipt.revision, "served-revision-42");

    const unknownRevision = successfulDeps({ async revision() { return null; } });
    const refusal = await captureForestSemantics([...invocation, "--square", "1,2,3"], unknownRevision);
    assert.deepEqual(refusal, { ok: false, code: "revision-ambiguous" });
    assert.equal(unknownRevision.published.length, 0);
  });
});

describe("fsc-cli-refuses-without-a-misleading-capture: incomplete evidence never looks successful", () => {
  // test-updated (refactor): apply the settled-page override at the browser seam the command actually invokes.
  test("rejects invalid input and incomplete page evidence without publishing a PNG or receipt", async () => {
    const malformed = successfulDeps();
    assert.deepEqual(await captureForestSemantics([...invocation, "--square", "1,nope,3"], malformed), { ok: false, code: "invalid-target" });
    assert.equal(malformed.requests.length, 0, "bad target syntax never reaches a browser command");

    const stale = successfulDeps({
      async settledAfter() { return { settled: false, phase: "in-flight", camera: CAMERA, serial: 0 }; },
    });
    const refusal = await captureForestSemantics([...invocation, "--square", "1,2,3"], stale);
    assert.deepEqual(refusal, { ok: false, code: "unsettled-page" });
    assert.equal(stale.published.length, 0);
    assert.equal(stale.writes.length, 0, "an unsettled image is never even a candidate artifact");
  });
});

describe("fsc-cli-refuses-each-malformed-grammar-branch: invalid syntax never reaches Studio", () => {
  test("requires every capture option and validates square, viewport and four-sided padding values", async () => {
    const cases: string[][] = [
      ["forest", "capture", "--viewport", "1280x720", "--padding", "18,24,18,24", "--square", "1,2,3"],
      ["forest", "capture", "--output", "", "--viewport", "1280x720", "--padding", "18,24,18,24", "--square", "1,2,3"],
      ["forest", "capture", "--output", "/captures", "--padding", "18,24,18,24", "--square", "1,2,3"],
      ["forest", "capture", "--output", "/captures", "--viewport", "1280x720", "--square", "1,2,3"],
      ["forest", "capture", "--output", "/captures", "--viewport", "1280x720", "--padding", "18,24,18,24"],
      [...invocation, "--story"],
      [...invocation, "--unknown", "value"],
      [...invocation, "--fit", "--unknown", "1,2,3,4"],
      [...invocation, "--square", "1,2"],
      [...invocation, "--square", "1,2,3,4"],
      [...invocation, "--square", "1,nope,3"],
      [...invocation, "--square", "1,Infinity,3"],
      [...invocation.slice(0, 7), "1280", ...invocation.slice(8), "--fit"],
      [...invocation.slice(0, 7), "1280x720x2", ...invocation.slice(8), "--fit"],
      [...invocation.slice(0, 7), "nopex720", ...invocation.slice(8), "--fit"],
      [...invocation.slice(0, 7), "1280xInfinity", ...invocation.slice(8), "--fit"],
      [...invocation.slice(0, 9), "18,24,18", "--fit"],
      [...invocation.slice(0, 9), "18,24,18,24,0", "--fit"],
      [...invocation.slice(0, 9), "18,24,nope,24", "--fit"],
    ];
    for (const argv of cases) {
      const deps = successfulDeps();
      assert.deepEqual(await captureForestSemantics(argv, deps), { ok: false, code: "invalid-target" }, argv.join(" "));
      assert.equal(deps.requests.length, 0, argv.join(" "));
    }
  });
});

describe("fsc-cli-attests-every-camera-component-and-output-name: receipts cannot drift from pixels", () => {
  test("rejects a changed translation or scale and numbers each target pair from one", async () => {
    for (const camera of [
      { ...CAMERA, tx: CAMERA.tx + 1 },
      { ...CAMERA, ty: CAMERA.ty + 1 },
      { ...CAMERA, scale: CAMERA.scale + 1 },
    ]) {
      const deps = successfulDeps({
        async settledAfter() { return { settled: true, phase: "settled", camera, serial: 1 }; },
      });
      assert.deepEqual(await captureForestSemantics([...invocation, "--fit"], deps), { ok: false, code: "unsettled-page" });
      assert.deepEqual(deps.writes, []);
      assert.deepEqual(deps.published, []);
    }

    const numbered = successfulDeps();
    assert.deepEqual(await captureForestSemantics([...invocation, "--story", "alpha", "--fit"], numbered), { ok: true });
    assert.deepEqual(numbered.writes.map((entry) => entry.path), [
      "/captures/forest-1.png", "/captures/forest-1.json",
      "/captures/forest-2.png", "/captures/forest-2.json",
    ]);
    assert.deepEqual(numbered.published, [
      "/captures/forest-1.png", "/captures/forest-1.json",
      "/captures/forest-2.png", "/captures/forest-2.json",
    ]);
  });
});

describe("fsc-cli-cleans-each-failure-boundary: no partial pair survives", () => {
  test("maps connection failures separately from pair-publication failures", async () => {
    const unavailable = successfulDeps({
      async connect() { throw new Error("Studio unavailable"); },
    });
    assert.deepEqual(await captureForestSemantics([...invocation, "--fit"], unavailable), { ok: false, code: "capture-failed" });

    for (const failAt of ["write-json", "publish-png", "publish-json"] as const) {
      let writes = 0;
      let publishes = 0;
      const deps = successfulDeps({
        async writeCandidate(path, content) {
          writes += 1;
          if (failAt === "write-json" && path.endsWith(".json")) throw new Error("write failed");
          deps.writes.push({ path, content });
        },
        async publish(path) {
          publishes += 1;
          if (failAt === "publish-png" && publishes === 1) throw new Error("first publish failed");
          if (failAt === "publish-json" && publishes === 2) throw new Error("second publish failed");
          deps.published.push(path);
        },
      });
      assert.deepEqual(await captureForestSemantics([...invocation, "--fit"], deps), { ok: false, code: "screenshot-failed" });
      assert.ok(writes >= 1);
      assert.deepEqual(deps.closed.filter((entry) => entry.startsWith("remove:")), [
        "remove:/captures/forest-1.png", "remove:/captures/forest-1.json",
      ]);
    }
  });

  test("owned resources close on an early revision refusal", async () => {
    const owned = successfulDeps({ async revision() { return null; } });
    const argv = [
      "forest", "capture", "--output", "/captures", "--viewport", "1280x720",
      "--padding", "18,24,18,24", "--fit",
    ];
    assert.deepEqual(await captureForestSemantics(argv, owned), { ok: false, code: "revision-ambiguous" });
    assert.deepEqual(owned.closed.sort(), ["browser", "server"]);
  });
});
