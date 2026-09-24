import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// @ts-expect-error -- the committed Node reporter is intentionally plain .mjs with no declaration file.
import perTestReporter from "./per-test-reporter.mjs";

type ReporterRecord = {
  readonly type: string;
  readonly name?: string;
  readonly causeName?: string;
  readonly causeCode?: string;
  readonly causeMessage?: string;
};

function unprintableCause(): object {
  const cause = Object.create(null) as { [Symbol.toPrimitive]?: () => never };
  cause[Symbol.toPrimitive] = () => {
    throw new Error("the cause must not be stringified");
  };
  return cause;
}

async function* events(): AsyncGenerator<object> {
  yield {
    type: "test:fail",
    data: {
      name: "unprintable failure",
      details: { type: "test", error: { cause: unprintableCause() } },
    },
  };
  yield {
    type: "test:fail",
    data: {
      name: "later assertion failure",
      details: {
        type: "test",
        error: {
          cause: Object.assign(new Error("Expected values to be strictly equal:\n\n1 !== 2"), { code: "ERR_ASSERTION" }),
        },
      },
    },
  };
  yield { type: "test:pass", data: { name: "later pass" } };
}

function childEnvironment() {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("NODE_TEST") && value !== undefined) environment[name] = value;
  }
  return environment;
}

async function runFixture(args: readonly string[], env: Record<string, string>): Promise<{ readonly code: number | null; readonly stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error("node:test reporter fixture timed out"));
      else resolve({ code, stdout });
    });
  });
}

test("per-test-reporter-continues-after-an-unprintable-cause: per-test-reporter-preserves-readable-cause-data: per-test-reporter-remains-a-node-reporter: an unprintable cause is local to its event", async () => {
  const lines: string[] = [];
  await assert.doesNotReject(async () => {
    for await (const line of perTestReporter(events())) lines.push(line);
  });

  const records = lines.map((line) => JSON.parse(line) as ReporterRecord);
  assert.deepEqual(records.map((record) => record.name), ["unprintable failure", "later assertion failure", "later pass"]);
  assert.equal(records[0]?.causeName, undefined, "an unprintable cause has no fabricated identity");
  assert.equal(records[0]?.causeCode, undefined, "an unprintable cause has no fabricated assertion code");
  assert.equal(records[0]?.causeMessage, undefined, "an unprintable cause has no fabricated assertion message");
  assert.deepEqual(
    records[1],
    {
      type: "test:fail",
      name: "later assertion failure",
      testType: "test",
      causeName: "Error",
      causeCode: "ERR_ASSERTION",
      causeMessage: "Expected values to be strictly equal:",
    },
    "a readable later cause preserves its classification data and first message line",
  );
  assert.deepEqual(records[2], { type: "test:pass", name: "later pass" }, "the later pass remains a pass");

  const directory = await mkdtemp(join(tmpdir(), "storytree-per-test-reporter-cause-"));
  const fixture = join(directory, "fixture.mjs");
  const report = join(directory, "per-test-report.jsonl");
  try {
    await writeFile(
      fixture,
      `import assert from "node:assert/strict";
import { test } from "node:test";

test("unprintable failure", () => {
  const cause = Object.create(null);
  cause[Symbol.toPrimitive] = () => { throw new Error("the cause must not be stringified"); };
  throw Object.assign(new Error("outer failure"), { cause });
});
test("later assertion failure", () => assert.equal(1, 2));
test("later pass", () => assert.equal(1, 1));
`,
    );
    const reporter = new URL("./per-test-reporter.mjs", import.meta.url).href;
    const result = await runFixture(
      [
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        `--test-reporter=${reporter}`,
        `--test-reporter-destination=${report}`,
        "--test",
        fixture,
      ],
      childEnvironment(),
    );
    assert.ok(result.code !== null && result.code !== 0, "the fixture's intentional failures still exit red");
    assert.match(result.stdout, /later assertion failure/, "spec output remains readable beside JSONL");
    assert.match(result.stdout, /later pass/, "spec output includes the later passing test");
    const reportRows = (await readFile(report, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as ReporterRecord);
    assert.deepEqual(reportRows.filter((row) => row.type === "test:fail" || row.type === "test:pass").map((row) => row.name), [
      "unprintable failure",
      "later assertion failure",
      "later pass",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
