import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { InMemoryStore } from "@storytree/storage-protocol";

import { run } from "./commands.js";
import {
  defaultForestCaptureCommandDeps,
  defaultForestCaptureProcessRuntime,
  forestCaptureCommand,
  forestCaptureHelp,
  forestCompareCommand,
  forestCompareHelp,
  forestHelp,
  forestCaptureProcessDeps,
} from "./forest-capture-command.js";

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

test("the process adapter resolves its imports from the checkout but preserves the caller cwd", async () => {
  const calls: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
  const fakeExec = (executable: string, args: readonly string[], options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
    calls.push({ executable, args, options });
    callback(null, "driver stdout", "driver stderr");
  };
  const root = path.resolve("C:/storytree-fixture");
  const deps = forestCaptureProcessDeps(root, {
    execFile: fakeExec,
    executable: "node-fixture",
    cwd: path.resolve("C:/caller-fixture"),
  });
  const result = await deps.invoke(["forest", "capture", "--fit"]);

  assert.deepEqual(result, { status: 0, stdout: "driver stdout", stderr: "driver stderr" });
  assert.deepEqual(calls, [{
    executable: "node-fixture",
    args: [
      "--import",
      pathToFileURL(path.join(root, "scripts", "tsx-cache-off.mjs")).href,
      "--import",
      pathToFileURL(path.join(root, "apps", "studio", "node_modules", "tsx", "dist", "loader.mjs")).href,
      path.join(root, "apps", "studio", "scripts", "semantic-capture.mjs"),
      "forest", "capture", "--fit",
    ],
    options: { cwd: path.resolve("C:/caller-fixture"), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  }]);
  assert.equal(typeof defaultForestCaptureCommandDeps(root).invoke, "function");
  assert.deepEqual(defaultForestCaptureProcessRuntime(), {
    execFile: (await import("node:child_process")).execFile,
    executable: process.execPath,
    cwd: process.cwd(),
  });
});

test("the process adapter selects the comparative Studio runner without changing argv", async () => {
  const calls: Array<{ args: readonly string[] }> = [];
  const root = path.resolve("C:/storytree-fixture");
  const deps = forestCaptureProcessDeps(root, {
    execFile: (_executable, args, _options, callback) => {
      calls.push({ args });
      callback(null, "{}", "");
    },
    executable: "node-fixture",
    cwd: "C:/caller-fixture",
  });
  await deps.invoke(["forest", "compare", "--fit"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.args[4], path.join(root, "apps", "studio", "scripts", "comparative-capture.mjs"));
  assert.deepEqual(calls[0]?.args.slice(5), ["forest", "compare", "--fit"]);
});

test("the process adapter preserves numeric exits and maps non-numeric launch failures to one", async () => {
  const invokeWith = async (error: null | { code?: string | number }) => {
    const fakeExec = (_executable: string, _args: readonly string[], _options: unknown, callback: (error: null | { code?: string | number }, stdout: string, stderr: string) => void) => {
      callback(error, "out", "err");
    };
    return forestCaptureProcessDeps("C:/repo", { execFile: fakeExec, executable: "node", cwd: "C:/caller" }).invoke([]);
  };
  assert.equal((await invokeWith({ code: 17 })).status, 17);
  assert.equal((await invokeWith({ code: "ENOENT" })).status, 1);
  assert.equal((await invokeWith({})).status, 1);
});

test("forest capture help is an exact runnable contract", () => {
  assert.deepEqual(forestCaptureHelp(), {
    ok: true,
    body: [
      "storytree forest capture — frame and screenshot named forest subjects without mouse input.",
      "",
      "  storytree forest capture --output <dir> --viewport <WxH> --padding <t,r,b,l> <targets...>",
      "",
      "Targets are repeatable and run in the order written:",
      "  --square <x,y,size>   frame an exact world-space square",
      "  --story <id>          centre a story node",
      "  --island <id>         fit a story island",
      "  --resting             use the designed resting camera",
      "  --fit                 fit the whole forest",
      "",
      "Session options:",
      "  --studio-url <url>    reuse an already-running Studio",
      "  --browser <cdp-url>   reuse a compatible Chromium CDP endpoint",
      "",
      "One browser session serves every target. Each successful target publishes forest-N.png and",
      "forest-N.json together; a target that cannot be resolved or attested settled publishes neither.",
    ].join("\n"),
    next: [
      "storytree forest capture --output .gate-logs/forest --viewport 1600x1000 --padding 32,32,32,32 --fit",
    ],
  });
});

test("forest compare help is an exact runnable contract", () => {
  assert.deepEqual(forestCompareHelp(), {
    ok: true,
    body: [
      "storytree forest compare — capture identical semantic forest views on baseline and branch.",
      "",
      "  storytree forest compare --output <dir> --viewport <WxH> --padding <t,r,b,l> <targets...>",
      "",
      "Targets are required, repeatable, and run in the order written:",
      "  --square <x,y,size>   frame an exact world-space square",
      "  --story <id>          centre a story node",
      "  --island <id>         fit a story island",
      "  --resting             use the designed resting camera",
      "  --fit                 fit the whole forest",
      "",
      "One Chromium process keeps one page per revision across the whole target batch. Publication",
      "fails closed unless every paired receipt names the same target, frame, padding, and resolved",
      "subject. The output includes paired PNG/JSON evidence, index.json, and contact-sheet.png.",
      "Pass --force to run when the branch render-surface trigger would otherwise skip capture.",
    ].join("\n"),
    next: [
      "storytree forest compare --output .gate-logs/forest-compare --viewport 1600x1000 --padding 32,32,32,32 --story <id> --fit --force",
    ],
  });
});

test("forest help is an exact command index", () => {
  assert.deepEqual(forestHelp(), {
    ok: true,
    body: [
      "storytree forest — deterministic forest framing and review evidence without mouse panning.",
      "",
      "  capture   screenshot semantic targets on one served revision",
      "  compare   screenshot the same semantic targets on baseline and branch",
      "",
      "Run storytree forest capture --help or storytree forest compare --help for target syntax.",
    ].join("\n"),
    next: ["storytree forest capture --help", "storytree forest compare --help"],
  });
});

test("forest dispatch distinguishes capture, help, and an unknown subcommand", async () => {
  let calls = 0;
  const deps = {
    store: new InMemoryStore(),
    forestCapture: {
      async invoke() {
        calls += 1;
        return { status: 0, stdout: JSON.stringify({ ok: true, captures: 1, output: "/captures" }), stderr: "" };
      },
    },
  };
  assert.deepEqual(await run(["forest", "--help"], deps), forestHelp());
  assert.deepEqual(await run(["forest", "other"], deps), forestHelp());
  assert.deepEqual(await run(["forest", "capture", "--help"], deps), forestCaptureHelp());
  assert.deepEqual(await run(["forest", "compare", "--help"], deps), forestCompareHelp());
  assert.equal(calls, 0);
  assert.equal((await run(["forest", "capture", "--fit"], deps)).ok, true);
  assert.equal((await run(["forest", "compare", "--output", "/review", "--viewport", "1440x900", "--padding", "1,2,3,4", "--fit"], deps)).ok, true);
  assert.equal(calls, 2);
});

test("forest compare reports its contact-sheet entry point and typed refusal", async () => {
  const argv = ["forest", "compare", "--output", "/review", "--viewport", "1440x900", "--padding", "1,2,3,4", "--fit"];
  assert.deepEqual(await forestCompareCommand(argv, {
    async invoke() { return { status: 0, stdout: JSON.stringify({ ok: true, captures: 1, output: "/review" }), stderr: "" }; },
  }), {
    ok: true,
    body: "compared 1 forest frame(s) in /review",
    next: ["inspect /review/contact-sheet.png and index.json"],
  });
  assert.deepEqual(await forestCompareCommand(argv, {
    async invoke() { return { status: 1, stdout: JSON.stringify({ ok: false, code: "comparison-failed", message: "receipts differ" }), stderr: "" }; },
  }), {
    ok: false,
    body: "forest compare refused (comparison-failed): receipts differ",
    next: ["storytree forest compare --help"],
  });
});

test("the command reports exact success defaults and refuses malformed or contradictory child envelopes", async () => {
  const invoke = async (status: number, stdout: string, stderr = "") => forestCaptureCommand(invocation, {
    async invoke() { return { status, stdout, stderr }; },
  });
  assert.deepEqual(await invoke(0, JSON.stringify({ ok: true, captures: 2, output: "/captures" })), {
    ok: true,
    body: "captured 2 forest frame(s) in /captures",
    next: ["inspect /captures/forest-1.json beside its PNG"],
  });
  assert.deepEqual(await invoke(0, JSON.stringify({ ok: true })), {
    ok: true,
    body: "captured 0 forest frame(s) in the requested output directory",
    next: [],
  });
  assert.deepEqual(await invoke(0, "not json"), {
    ok: false,
    body: "forest capture refused (driver-failed): the Studio capture driver returned no diagnostic",
    next: ["storytree forest capture --help"],
  });
  assert.deepEqual(await invoke(1, JSON.stringify({ ok: true, output: "/captures" }), "process failed"), {
    ok: false,
    body: "forest capture refused (driver-failed): process failed",
    next: ["storytree forest capture --help"],
  });
  assert.deepEqual(await invoke(1, JSON.stringify({ ok: false, code: "target-not-found", message: "missing node" }), "stderr detail"), {
    ok: false,
    body: "forest capture refused (target-not-found): missing node\nstderr detail",
    next: ["storytree forest capture --help"],
  });
  assert.deepEqual(await invoke(1, JSON.stringify({ ok: false, code: "target-not-found", message: "" }), ""), {
    ok: false,
    body: "forest capture refused (target-not-found): the Studio capture driver returned no diagnostic",
    next: ["storytree forest capture --help"],
  });
  assert.deepEqual(await invoke(1, JSON.stringify({ ok: false, code: "target-not-found" }), "  padded detail  "), {
    ok: false,
    body: "forest capture refused (target-not-found): padded detail",
    next: ["storytree forest capture --help"],
  });
});
