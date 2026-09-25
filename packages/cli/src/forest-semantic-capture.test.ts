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
    await captureForestSemantics([...invocation, "--square", "1,2,3"], reusedStudio);
    assert.equal(reusedStudio.starts, 0);
    assert.deepEqual(reusedStudio.closed, [], "a supplied Studio URL remains the caller's resource");

    const reusedBrowser = successfulDeps();
    await captureForestSemantics([...invocation.filter((arg) => arg !== "--studio-url" && arg !== "http://served-studio.test"), "--browser", "compatible", "--square", "1,2,3"], reusedBrowser);
    assert.equal(reusedBrowser.starts, 0);
    assert.deepEqual(reusedBrowser.closed, [], "a supplied browser remains the caller's resource");

    const owned = successfulDeps();
    await captureForestSemantics(["forest", "capture", "--output", "/captures", "--viewport", "1280x720", "--padding", "18,24,18,24", "--square", "1,2,3"], owned);
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
