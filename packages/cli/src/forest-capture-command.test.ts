import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStore } from "@storytree/storage-protocol";

import { run } from "./commands.js";
import { forestCaptureCommand } from "./forest-capture-command.js";

const invocation = [
  "forest", "capture", "--output", ".gate-logs/capture", "--viewport", "1280x720",
  "--padding", "20,24,20,24", "--story", "alpha", "--square", "1,2,3",
  "--fit", "--island", "shore", "--resting",
];

test("forest capture command forwards the original interleaved target argv to Studio", async () => {
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];
  const envelope = await forestCaptureCommand(invocation, {
    async invoke(argv) {
      mutableCalls.push([...argv]);
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, captures: 5, output: ".gate-logs/capture" }),
        stderr: "",
      };
    },
  });
  assert.equal(envelope.ok, true);
  assert.deepEqual(calls, [invocation]);
});

test("the central strict parser accepts repeatable semantic flags without reordering the dispatcher input", async () => {
  const forwarded: string[][] = [];
  const envelope = await run(invocation, {
    store: new InMemoryStore(),
    forestCapture: {
      async invoke(argv) {
        forwarded.push([...argv]);
        return { status: 0, stdout: JSON.stringify({ ok: true, captures: 5, output: ".gate-logs/capture" }), stderr: "" };
      },
    },
  });
  assert.equal(envelope.ok, true);
  assert.deepEqual(forwarded, [invocation]);
});

test("a typed child refusal becomes a red CLI envelope", async () => {
  const envelope = await forestCaptureCommand(invocation, {
    async invoke() {
      return {
        status: 1,
        stdout: JSON.stringify({ ok: false, code: "target-not-found", message: "story alpha is absent" }),
        stderr: "[forest-capture] Studio did not become ready",
      };
    },
  });
  assert.equal(envelope.ok, false);
  assert.match(envelope.body, /target-not-found/);
  assert.match(envelope.body, /Studio did not become ready/);
});
