/**
 * `node-verbs-dispatch` (ADR-0576 D3): the `storytree node attempts|grant|adjudicate` dispatch over
 * `run()` — the function `main` calls. Everything here drives `run([...], deps)` from `./commands.js`
 * so a refusal, a flag classification, or a seam the dispatch never wires is caught the same way a
 * real invocation would hit it.
 *
 * ADR-0563 D6 test revision: the prior draft of this file asserted a bare TOTAL inner-loop event
 * count (`assert.equal(events.length, 1)`) against a store already seeded with three "attempt"
 * events sharing the same `INNER_LOOP_EVENT_KIND` — an unsatisfiable DELTA-as-TOTAL mistranslation
 * (escalation `real-mu47qgc4`). Every "gained no event" / "gained exactly one event" check below
 * compares a BEFORE/AFTER count (`eventCount`), never an absolute total, so a shared, already-seeded
 * ledger can never make the assertion unsatisfiable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INNER_LOOP_EVENT_KIND, type InnerLoopEventDoc } from "@storytree/proof-protocol";
import { InMemoryStore, type Store, type StoreEvent } from "@storytree/storage-protocol";
import {
  adjudicateLanding,
  appendInnerLoopEvent,
  loadNodeSpec,
  readInnerLoopLedger,
  type LandingObjection,
} from "@storytree/orchestrator";
import { renderInnerLoopEntryState, type InnerLoopEntryState } from "@storytree/drive";

import { readNodeAttempts } from "./inner-loop-verbs.js";
import { LITERAL_FLAGS, PROSE_FLAGS } from "./at-path.js";
import { run, CLI_OPTIONS, type RunDeps } from "./commands.js";
import * as Commands from "./commands.js";

// ── ledger fixtures ────────────────────────────────────────────────────────────────────────────

function attempt(unitId: string, incrementId: string, runId: string): InnerLoopEventDoc {
  return { event: "attempt", unitId, incrementId, runId };
}

function signedPass(unitId: string, incrementId: string, runId: string): InnerLoopEventDoc {
  return { event: "signed-pass", unitId, incrementId, runId };
}

function grantEventDoc(
  unitId: string,
  incrementId: string,
  runId: string,
  attempts: number,
  difference: string,
): InnerLoopEventDoc {
  return { event: "grant", unitId, incrementId, runId, attempts, kind: "fixed-defect", difference };
}

function landAdjudication(unitId: string, incrementId: string, runId: string): InnerLoopEventDoc {
  return {
    event: "adjudication",
    unitId,
    incrementId,
    runId,
    disposition: "land",
    mayRefuse: false,
    escalates: false,
    reason: "landed",
  };
}

async function buildLedger(docs: readonly InnerLoopEventDoc[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const doc of docs) await appendInnerLoopEvent(store, doc);
  return store;
}

async function eventCount(store: Pick<Store, "readEvents">): Promise<number> {
  return (await store.readEvents()).filter((e) => e.kind === INNER_LOOP_EVENT_KIND).length;
}

/** The fixed fold failure every "the ledger cannot be read" case drives. */
class ThrowingLedger extends InMemoryStore {
  override async readEvents(): Promise<StoreEvent[]> {
    throw new Error("ledger-down-marker");
  }
}

// ── usage lines (the exact `next:` strings the dispatch renders) ─────────────────────────────────

function usageAttempts(u: string): string {
  return `storytree node attempts ${u} --pg`;
}
function usageGrant(u: string): string {
  return `storytree node grant ${u} --attempts <n> --kind <changed-input|fixed-defect|new-observation|revised-test> --difference <text|@file> --pg`;
}
function usageAdjudicate(u: string): string {
  return `storytree node adjudicate ${u} --run <run-id> [--objection test-quality|rule-violation|surviving-mutants --statement <text|@file> --decision <rule> --survivors <n>] --pg`;
}

const LIVE_STORE_REFUSAL =
  "the attempt ledger lives in the live store — rerun with --pg (bring the DB up first: pnpm db:up)";

// ── the fixture repo (stories/ + packages/) unit-strength-signal reads ───────────────────────────

function fixtureStoryDoc(): string {
  return [
    "---",
    'id: "fix-story"',
    "tier: story",
    'title: "fix story"',
    'outcome: "the fixture story"',
    "status: proposed",
    "proof_mode: UAT",
    "capabilities: [cap-bun, cap-node, cap-orphan]",
    "depends_on: []",
    "---",
    "# fix story",
    "",
  ].join("\n");
}

/** Same shape as `real-chain-fixture.ts`'s `capSpec`, with a caller-chosen testFile/sourceFile pair. */
function fixtureCapDoc(id: string, testFile: string, sourceFile: string): string {
  return [
    "---",
    `id: "${id}"`,
    "tier: capability",
    'story: "fix-story"',
    `title: "${id}"`,
    `outcome: "outcome of ${id}"`,
    "status: proposed",
    "proof_mode: integration-test",
    "depends_on: []",
    "proof:",
    "  command:",
    "    file: node",
    '    args: ["--version"]',
    "  scope:",
    `    testGlobs: ["${testFile}"]`,
    `    sourceGlobs: ["${sourceFile}"]`,
    "  real:",
    `    testFile: "${testFile}"`,
    `    sourceFile: "${sourceFile}"`,
    "    scope:",
    `      testGlobs: ["${testFile}"]`,
    `      sourceGlobs: ["${sourceFile}"]`,
    "---",
    `# ${id}`,
    "",
  ].join("\n");
}

interface FixtureRepo {
  readonly root: string;
  readonly storiesDir: string;
}

/**
 * `stories/fix-story/` holding cap-bun / cap-node / cap-orphan, and `packages/` holding pkg-bun
 * (`bun test src/`) and pkg-node (`node --test`) — `packages/pkg-missing/` deliberately never
 * created, so cap-orphan's package has no `package.json` to read.
 */
async function buildFixtureRepo(): Promise<FixtureRepo> {
  const root = await mkdtemp(path.join(os.tmpdir(), "storytree-node-verbs-dispatch-"));
  const storyDir = path.join(root, "stories", "fix-story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, "story.md"), fixtureStoryDoc());
  await writeFile(
    path.join(storyDir, "cap-bun.md"),
    fixtureCapDoc("cap-bun", "packages/pkg-bun/src/cap-bun.test.ts", "packages/pkg-bun/src/cap-bun.ts"),
  );
  await writeFile(
    path.join(storyDir, "cap-node.md"),
    fixtureCapDoc("cap-node", "packages/pkg-node/src/cap-node.test.ts", "packages/pkg-node/src/cap-node.ts"),
  );
  await writeFile(
    path.join(storyDir, "cap-orphan.md"),
    fixtureCapDoc(
      "cap-orphan",
      "packages/pkg-missing/src/cap-orphan.test.ts",
      "packages/pkg-missing/src/cap-orphan.ts",
    ),
  );

  await mkdir(path.join(root, "packages", "pkg-bun"), { recursive: true });
  await writeFile(
    path.join(root, "packages", "pkg-bun", "package.json"),
    JSON.stringify({ name: "pkg-bun", scripts: { test: "bun test src/" } }),
  );
  await mkdir(path.join(root, "packages", "pkg-node"), { recursive: true });
  await writeFile(
    path.join(root, "packages", "pkg-node", "package.json"),
    JSON.stringify({ name: "pkg-node", scripts: { test: "node --test" } }),
  );
  // packages/pkg-missing/ is deliberately absent.

  return { root, storiesDir: path.join(root, "stories") };
}

// ── contract 1 ─────────────────────────────────────────────────────────────────────────────────

test("node-area-exposes-the-ledger-verbs: the node area names the three ledger verbs, declares and classifies their flags, and refuses each verb without a unit id", async () => {
  const store = new InMemoryStore();

  const unknown = await run(["node", "zzz"], { store });
  assert.deepEqual(unknown, {
    ok: false,
    body:
      'unknown node command "zzz". try: storytree node build <id> --dry-run | storytree node resolve <id> | storytree node peek <id> | storytree node log <id> --pg | storytree node walls --pg | storytree node attempts <id> --pg | storytree node grant <id> --pg | storytree node adjudicate <id> --run <run-id> --pg',
    next: [
      "storytree node resolve <id>",
      // `peek` (ADR-0588) sits beside `resolve` rather than at the end: both are FREE reads a
      // caller takes BEFORE reaching for a paid build, and this list is the refusal's whole
      // discoverability surface.
      "storytree node peek <id>",
      "storytree node log <id> --pg",
      "storytree node walls --pg",
      "storytree node build <id> --dry-run",
      "storytree node attempts <id> --pg",
    ],
  });

  const options = CLI_OPTIONS as Record<string, unknown>;
  for (const flag of ["attempts", "difference", "run", "objection", "decision", "survivors"]) {
    assert.deepEqual(options[flag], { type: "string" }, flag);
  }

  for (const flag of ["attempts", "run", "objection", "decision", "survivors"]) {
    assert.equal(LITERAL_FLAGS.has(flag), true, flag);
    assert.equal(PROSE_FLAGS.has(flag), false, flag);
  }
  assert.equal(PROSE_FLAGS.has("difference"), true);
  assert.equal(LITERAL_FLAGS.has("difference"), false);

  const noUnitCases: ReadonlyArray<readonly [string, string]> = [
    ["attempts", usageAttempts("<unit-id>")],
    ["grant", usageGrant("<unit-id>")],
    ["adjudicate", usageAdjudicate("<unit-id>")],
  ];
  for (const [sub, usage] of noUnitCases) {
    const result = await run(["node", sub], { store });
    assert.deepEqual(result, { ok: false, body: `node ${sub} needs a unit id`, next: [usage] }, sub);
  }
});

// ── contract 2 ─────────────────────────────────────────────────────────────────────────────────

test("node-attempts-renders-the-fold-and-its-entry-state: `node attempts` reads the unit's ledger lines and the entry state they leave it in, refusing without the live store", async () => {
  const store = new InMemoryStore();

  const noLedgerCase1 = await run(["node", "attempts", "cap-bun"], { store, writable: true });
  assert.deepEqual(noLedgerCase1, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAttempts("cap-bun")] });

  const noLedgerCase2 = await run(["node", "attempts", "cap-bun"], {
    store,
    writable: true,
    attemptLedger: null,
  });
  assert.deepEqual(noLedgerCase2, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAttempts("cap-bun")] });

  const readOnlyLedger = await buildLedger([attempt("cap-bun", "inc-a", "r1")]);
  const readOnlyResult = await run(["node", "attempts", "cap-bun"], {
    store,
    writable: false,
    attemptLedger: readOnlyLedger,
  });
  assert.equal(readOnlyResult.ok, true);

  const emptyLedger = new InMemoryStore();
  const emptyResult = await run(["node", "attempts", "cap-bun"], {
    store,
    writable: true,
    attemptLedger: emptyLedger,
  });
  assert.deepEqual(emptyResult, { ok: true, body: "cap-bun: no recorded attempts", next: [] });

  async function expectFold(ledger: InMemoryStore, state: InnerLoopEntryState | null): Promise<void> {
    const foldResult = await readNodeAttempts(ledger, "cap-bun");
    assert.equal(foldResult.ok, true);
    if (!foldResult.ok) throw new Error("expected the fold to render");
    const rendered = state === null ? null : renderInnerLoopEntryState(state);
    const body =
      rendered === null ? foldResult.lines.join("\n") : [...foldResult.lines, ...rendered.lines].join("\n");
    const next = rendered === null ? [] : [...rendered.next];
    const result = await run(["node", "attempts", "cap-bun"], {
      store,
      writable: true,
      attemptLedger: ledger,
    });
    assert.deepEqual(result, { ok: true, body, next });
  }

  await expectFold(await buildLedger([attempt("cap-bun", "inc-a", "r1"), attempt("cap-bun", "inc-a", "r2")]), {
    state: "attempt-failed",
    unitId: "cap-bun",
    runId: "r2",
    consecutiveFailures: 2,
    remainingGrantCount: 0,
  });

  await expectFold(
    await buildLedger([
      attempt("cap-bun", "inc-a", "r1"),
      attempt("cap-bun", "inc-a", "r2"),
      attempt("cap-bun", "inc-a", "r3"),
    ]),
    { state: "attempt-failed", unitId: "cap-bun", runId: "r3", consecutiveFailures: 3, remainingGrantCount: 0 },
  );

  await expectFold(
    await buildLedger([
      attempt("cap-bun", "inc-a", "r1"),
      attempt("cap-bun", "inc-a", "r2"),
      attempt("cap-bun", "inc-a", "r3"),
      grantEventDoc("cap-bun", "inc-a", "r3", 2, "a fixed defect"),
    ]),
    { state: "attempt-failed", unitId: "cap-bun", runId: "r3", consecutiveFailures: 3, remainingGrantCount: 2 },
  );

  await expectFold(await buildLedger([attempt("cap-bun", "inc-a", "r1"), signedPass("cap-bun", "inc-a", "r1")]), {
    state: "signed",
    unitId: "cap-bun",
    runId: "r1",
  });

  await expectFold(
    await buildLedger([
      attempt("cap-bun", "inc-a", "r1"),
      signedPass("cap-bun", "inc-a", "r1"),
      landAdjudication("cap-bun", "inc-a", "r1"),
    ]),
    null,
  );

  const throwing = new ThrowingLedger();
  const throwingResult = await run(["node", "attempts", "cap-bun"], {
    store,
    writable: true,
    attemptLedger: throwing,
  });
  assert.equal(throwingResult.ok, false);
  if (throwingResult.ok) throw new Error("expected a refusal");
  assert.match(throwingResult.body, /ledger-down-marker/);
  assert.deepEqual(throwingResult.next, ["pnpm db:probe"]);
});

// ── contract 3 ─────────────────────────────────────────────────────────────────────────────────

test("node-grant-dispatch-records-the-grant: `node grant` refuses a missing flag, parses the rest, and records exactly what the grant verb admits", async () => {
  const ledger = await buildLedger([
    attempt("cap-bun", "inc-a", "r1"),
    attempt("cap-bun", "inc-a", "r2"),
    attempt("cap-bun", "inc-a", "r3"),
  ]);
  const deps = {
    store: new InMemoryStore(),
    writable: true,
    attemptLedger: ledger,
    actor: "orchestrator@example.com",
  };

  const flagsMissingBody =
    "node grant needs --attempts <n>, --kind <kind> and --difference <text|@file>: a grant records how many further attempts, which kind of difference, and what will be different (ADR-0563 D4)";

  const missingCases: ReadonlyArray<readonly string[]> = [
    ["node", "grant", "cap-bun", "--kind", "fixed-defect", "--difference", "a fixed defect", "--pg"],
    ["node", "grant", "cap-bun", "--attempts", "2", "--difference", "a fixed defect", "--pg"],
    ["node", "grant", "cap-bun", "--attempts", "2", "--kind", "fixed-defect", "--pg"],
  ];
  for (const argv of missingCases) {
    const before = await eventCount(ledger);
    const result = await run(argv, deps);
    assert.deepEqual(result, { ok: false, body: flagsMissingBody, next: [usageGrant("cap-bun")] });
    assert.equal(await eventCount(ledger), before);
  }

  const shortLedger = await buildLedger([attempt("cap-bun", "inc-a", "r1"), attempt("cap-bun", "inc-a", "r2")]);
  {
    const before = await eventCount(shortLedger);
    const result = await run(
      [
        "node",
        "grant",
        "cap-bun",
        "--attempts",
        "2",
        "--kind",
        "fixed-defect",
        "--difference",
        "a fixed defect",
        "--pg",
      ],
      { store: new InMemoryStore(), writable: true, attemptLedger: shortLedger, actor: "orchestrator@example.com" },
    );
    assert.deepEqual(result, {
      ok: false,
      body: "grant is early: the decision point is three failures",
      next: ["storytree node attempts cap-bun --pg"],
    });
    assert.equal(await eventCount(shortLedger), before);
  }

  {
    const before = await eventCount(ledger);
    const result = await run(
      ["node", "grant", "cap-bun", "--attempts", "2", "--kind", "better-spec", "--difference", "a new fixture", "--pg"],
      deps,
    );
    assert.equal(result.ok, false);
    assert.match(result.body, /"a better spec" does not count as different \(ADR-0563 D4\)/);
    assert.deepEqual(result.next, ["storytree node attempts cap-bun --pg"]);
    assert.equal(await eventCount(ledger), before);
  }

  {
    const before = await eventCount(ledger);
    const result = await run(
      [
        "node",
        "grant",
        "cap-bun",
        "--attempts",
        "two",
        "--kind",
        "fixed-defect",
        "--difference",
        "a fixed defect",
        "--pg",
      ],
      deps,
    );
    assert.equal(result.ok, false);
    assert.match(result.body, /grants nothing/);
    assert.deepEqual(result.next, ["storytree node attempts cap-bun --pg"]);
    assert.equal(await eventCount(ledger), before);
  }

  const differenceFile = path.join(
    os.tmpdir(),
    `storytree-node-verbs-difference-${process.pid}-${Date.now()}.txt`,
  );
  await writeFile(differenceFile, "the fixture's defect is fixed");
  try {
    const before = await eventCount(ledger);
    const result = await run(
      [
        "node",
        "grant",
        "cap-bun",
        "--attempts",
        "2",
        "--kind",
        "fixed-defect",
        "--difference",
        `@${differenceFile}`,
        "--pg",
      ],
      deps,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected the grant to be recorded");

    const freshLedger = await readInnerLoopLedger(ledger, "cap-bun");
    const expectedBody = [
      "granted: cap-bun — 2 further attempt(s), fixed-defect, bound to run r3 under increment inc-a",
      "difference: the fixture's defect is fixed",
      `policy: ${freshLedger.policy.disposition} — ${freshLedger.policy.reason}`,
    ].join("\n");
    assert.deepEqual(result, { ok: true, body: expectedBody, next: ["storytree node attempts cap-bun --pg"] });

    assert.equal(await eventCount(ledger), before + 1);
    const events = await ledger.readEvents();
    const appended = events.find(
      (e) => e.kind === INNER_LOOP_EVENT_KIND && (e.doc as { event?: string }).event === "grant",
    );
    assert.ok(appended, "expected a recorded grant event");
    assert.deepEqual(appended?.doc, {
      event: "grant",
      unitId: "cap-bun",
      incrementId: "inc-a",
      runId: "r3",
      attempts: 2,
      kind: "fixed-defect",
      difference: "the fixture's defect is fixed",
    });
    assert.equal(appended?.actor, "orchestrator@example.com");
  } finally {
    await rm(differenceFile, { force: true });
  }
});

// ── contract 4 ─────────────────────────────────────────────────────────────────────────────────

test("node-adjudicate-dispatch-records-the-ruling: `node adjudicate` refuses a missing run or a stray objection qualifier, and records the landing ruler's result with the unit's own strength signal", async () => {
  const fixture = await buildFixtureRepo();
  try {
    async function freshLedgerFor(unitId: string): Promise<InMemoryStore> {
      return buildLedger([
        attempt(unitId, "inc-a", "r1"),
        attempt(unitId, "inc-b", "r2"),
        signedPass(unitId, "inc-b", "r2"),
      ]);
    }
    function depsFor(ledger: InMemoryStore): RunDeps {
      return {
        store: new InMemoryStore(),
        writable: true,
        attemptLedger: ledger,
        storiesDir: fixture.storiesDir,
        actor: "orchestrator@example.com",
      };
    }

    {
      const ledger = await freshLedgerFor("cap-bun");
      const before = await eventCount(ledger);
      const result = await run(["node", "adjudicate", "cap-bun", "--pg"], depsFor(ledger));
      assert.deepEqual(result, {
        ok: false,
        body: "node adjudicate needs --run <run-id>: the signed run it adjudicates (ADR-0576 D3)",
        next: [usageAdjudicate("cap-bun")],
      });
      assert.equal(await eventCount(ledger), before);
    }

    const qualifierCases: ReadonlyArray<readonly string[]> = [
      ["--statement", "x"],
      ["--decision", "ADR-0232 D5"],
      ["--survivors", "2"],
    ];
    for (const flag of qualifierCases) {
      const ledger = await freshLedgerFor("cap-bun");
      const before = await eventCount(ledger);
      const result = await run(["node", "adjudicate", "cap-bun", "--run", "r2", ...flag, "--pg"], depsFor(ledger));
      assert.deepEqual(result, {
        ok: false,
        body:
          "--statement, --decision and --survivors qualify an --objection: pass --objection test-quality|rule-violation|surviving-mutants with them",
        next: [usageAdjudicate("cap-bun")],
      });
      assert.equal(await eventCount(ledger), before);
    }

    {
      const ledger = await freshLedgerFor("cap-bun");
      const before = await eventCount(ledger);
      const result = await run(["node", "adjudicate", "cap-bun", "--run", "r1", "--pg"], depsFor(ledger));
      assert.deepEqual(result, {
        ok: false,
        body: "run r1 holds no unresolved signed pass for cap-bun — nothing to adjudicate (ADR-0576 D3)",
        next: ["storytree node attempts cap-bun --pg"],
      });
      assert.equal(await eventCount(ledger), before);
    }

    {
      const ledger = await freshLedgerFor("cap-bun");
      const before = await eventCount(ledger);
      const result = await run(
        ["node", "adjudicate", "cap-bun", "--run", "r2", "--objection", "test-quality", "--pg"],
        depsFor(ledger),
      );
      assert.deepEqual(result, {
        ok: false,
        body: "the objection states no statement",
        next: ["storytree node attempts cap-bun --pg"],
      });
      assert.equal(await eventCount(ledger), before);
    }

    const cases: ReadonlyArray<{
      readonly unitId: string;
      readonly args: readonly string[];
      readonly objection?: LandingObjection;
      readonly reach: boolean;
    }> = [
      { unitId: "cap-bun", args: [], reach: true },
      {
        unitId: "cap-bun",
        args: ["--objection", "test-quality", "--statement", "the asserts are thin"],
        objection: { kind: "test-quality", statement: "the asserts are thin" },
        reach: true,
      },
      {
        unitId: "cap-node",
        args: ["--objection", "test-quality", "--statement", "the asserts are thin"],
        objection: { kind: "test-quality", statement: "the asserts are thin" },
        reach: false,
      },
      {
        unitId: "cap-bun",
        args: [
          "--objection",
          "rule-violation",
          "--statement",
          "it bypasses the fence",
          "--decision",
          "ADR-0232 D5",
        ],
        objection: { kind: "rule-violation", statement: "it bypasses the fence", decision: "ADR-0232 D5" },
        reach: true,
      },
      {
        unitId: "cap-bun",
        args: ["--objection", "surviving-mutants", "--statement", "two mutants live", "--survivors", "2"],
        objection: { kind: "surviving-mutants", statement: "two mutants live", survivors: 2 },
        reach: true,
      },
    ];

    for (const c of cases) {
      const ledger = await freshLedgerFor(c.unitId);
      const result = await run(
        ["node", "adjudicate", c.unitId, "--run", "r2", ...c.args, "--pg"],
        depsFor(ledger),
      );

      const expected =
        c.objection === undefined
          ? adjudicateLanding({ unitId: c.unitId, signed: true, strengthSignalAvailable: c.reach })
          : adjudicateLanding({
              unitId: c.unitId,
              signed: true,
              objection: c.objection,
              strengthSignalAvailable: c.reach,
            });

      const expectedBody = [
        `adjudicated: ${c.unitId} run r2 under increment inc-b — ${expected.disposition}`,
        `reason: ${expected.reason}`,
      ].join("\n");
      assert.deepEqual(
        result,
        { ok: true, body: expectedBody, next: [`storytree node attempts ${c.unitId} --pg`] },
        c.unitId + " " + c.args.join(" "),
      );

      const events = await ledger.readEvents();
      const lastAdjudication = events
        .filter((e) => e.kind === INNER_LOOP_EVENT_KIND && (e.doc as { event?: string }).event === "adjudication")
        .at(-1);
      assert.ok(lastAdjudication, `${c.unitId}: expected an adjudication event`);
      const doc = lastAdjudication?.doc as Record<string, unknown>;
      assert.equal(doc.event, "adjudication");
      assert.equal(doc.runId, "r2");
      assert.equal(doc.incrementId, "inc-b");
      assert.equal(doc.disposition, expected.disposition);
      if (expected.disposition === "refuse") {
        assert.equal(doc.namedRule, "ADR-0232 D5");
      }
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ── contract 5 ─────────────────────────────────────────────────────────────────────────────────

test("node-ledger-writes-need-the-live-store: a grant or adjudication refuses unless the dispatch is writable and holds the ledger, so a read-only session can never record one", async () => {
  const grantLedger = await buildLedger([
    attempt("cap-bun", "inc-a", "r1"),
    attempt("cap-bun", "inc-a", "r2"),
    attempt("cap-bun", "inc-a", "r3"),
  ]);
  const adjudicateLedger = await buildLedger([
    attempt("cap-bun", "inc-a", "r1"),
    attempt("cap-bun", "inc-b", "r2"),
    signedPass("cap-bun", "inc-b", "r2"),
  ]);

  const grantArgv = [
    "node",
    "grant",
    "cap-bun",
    "--attempts",
    "2",
    "--kind",
    "fixed-defect",
    "--difference",
    "a fixed defect",
    "--pg",
  ];
  {
    const before = await eventCount(grantLedger);
    const result = await run(grantArgv, { store: new InMemoryStore(), writable: false, attemptLedger: grantLedger });
    assert.deepEqual(result, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageGrant("cap-bun")] });
    assert.equal(await eventCount(grantLedger), before);
  }
  {
    const before = await eventCount(grantLedger);
    const result = await run(grantArgv, { store: new InMemoryStore(), writable: true, attemptLedger: null });
    assert.deepEqual(result, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageGrant("cap-bun")] });
    assert.equal(await eventCount(grantLedger), before);
  }

  const adjudicateArgv = ["node", "adjudicate", "cap-bun", "--run", "r2", "--pg"];
  {
    const before = await eventCount(adjudicateLedger);
    const result = await run(adjudicateArgv, {
      store: new InMemoryStore(),
      writable: false,
      attemptLedger: adjudicateLedger,
    });
    assert.deepEqual(result, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAdjudicate("cap-bun")] });
    assert.equal(await eventCount(adjudicateLedger), before);
  }
  {
    const before = await eventCount(adjudicateLedger);
    const result = await run(adjudicateArgv, { store: new InMemoryStore(), writable: true, attemptLedger: null });
    assert.deepEqual(result, { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAdjudicate("cap-bun")] });
    assert.equal(await eventCount(adjudicateLedger), before);
  }

  const missingPath = path.join(
    os.tmpdir(),
    `storytree-node-verbs-missing-${process.pid}-${Date.now()}.txt`,
  );
  {
    const before = await eventCount(grantLedger);
    const result = await run(
      [
        "node",
        "grant",
        "cap-bun",
        "--attempts",
        "2",
        "--kind",
        "fixed-defect",
        "--difference",
        `@${missingPath}`,
        "--pg",
      ],
      { store: new InMemoryStore(), writable: true, attemptLedger: grantLedger, actor: "orchestrator@example.com" },
    );
    assert.equal(result.ok, false);
    assert.match(result.body, /--difference "@/);
    assert.match(result.body, /could not be read/);
    assert.equal(await eventCount(grantLedger), before);
  }
});

// ── contract 6 ─────────────────────────────────────────────────────────────────────────────────

test("unit-strength-signal-reads-its-package: a unit's strength signal is true only when its spec's real source file sits in a package whose test script the mutation rung can run", async () => {
  assert.equal(typeof Commands.unitStrengthSignalReach, "function");

  const fixture = await buildFixtureRepo();
  try {
    const reach = Commands.unitStrengthSignalReach(fixture.storiesDir);
    assert.equal(typeof reach, "function");
    assert.equal(reach("cap-bun"), true);
    assert.equal(reach("cap-node"), false);
    assert.equal(reach("fix-story"), false);
    assert.equal(reach("cap-orphan"), false);
    assert.equal(reach("no-such-unit"), false);
    assert.equal(reach("fix-story#gate-1"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ── strengthening: the branches the mutation rung found unwitnessed ─────────────────────────────

test("node-ledger-writes-need-the-live-store: a writable dispatch with no ledger wired refuses a grant or an adjudication as offline", async () => {
  const grantArgv = ["node", "grant", "cap-bun", "--attempts", "2", "--kind", "fixed-defect", "--difference", "a fixed defect", "--pg"];
  const adjudicateArgv = ["node", "adjudicate", "cap-bun", "--run", "r2", "--pg"];
  assert.deepEqual(await run(grantArgv, { store: new InMemoryStore(), writable: true }), {
    ok: false,
    body: LIVE_STORE_REFUSAL,
    next: [usageGrant("cap-bun")],
  });
  assert.deepEqual(await run(adjudicateArgv, { store: new InMemoryStore(), writable: true }), {
    ok: false,
    body: LIVE_STORE_REFUSAL,
    next: [usageAdjudicate("cap-bun")],
  });
});

test("unit-strength-signal-reads-its-package: a real source file must sit under packages/ at the path's root, not merely contain it", async () => {
  const fixture = await buildFixtureRepo();
  try {
    const storyDir = path.join(fixture.storiesDir, "fix-story");
    await writeFile(
      path.join(storyDir, "cap-nested.md"),
      fixtureCapDoc("cap-nested", "apps/packages/pkg-bun/src/cap-nested.test.ts", "apps/packages/pkg-bun/src/cap-nested.ts"),
    );
    // Ground truth: the spec loads, so a `false` below comes from the path rule, never from a thrown load.
    assert.equal(loadNodeSpec(path.join(storyDir, "cap-nested.md")).id, "cap-nested");
    assert.equal(Commands.unitStrengthSignalReach(fixture.storiesDir)("cap-nested"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node-adjudicate-dispatch-records-the-ruling: with no stories dir injected, the unit's strength signal is read from this checkout's own stories", async () => {
  const checkoutStories = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "stories");
  const unitId = "node-verbs-dispatch";
  assert.equal(
    Commands.unitStrengthSignalReach(checkoutStories)(unitId),
    true,
    "ground truth: this checkout's own spec for the unit names a source in a package the rung can run",
  );
  const ledger = await buildLedger([attempt(unitId, "inc-a", "r1"), signedPass(unitId, "inc-a", "r1")]);
  const result = await run(
    ["node", "adjudicate", unitId, "--run", "r1", "--objection", "test-quality", "--statement", "the asserts are thin", "--pg"],
    { store: new InMemoryStore(), writable: true, attemptLedger: ledger },
  );
  const expected = adjudicateLanding({
    unitId,
    signed: true,
    objection: { kind: "test-quality", statement: "the asserts are thin" },
    strengthSignalAvailable: true,
  });
  assert.deepEqual(result, {
    ok: true,
    body: [`adjudicated: ${unitId} run r1 under increment inc-a — ${expected.disposition}`, `reason: ${expected.reason}`].join("\n"),
    next: [`storytree node attempts ${unitId} --pg`],
  });
});
