/**
 * `storytree node peek` and the D4 fence, driven through `run([...])` — the function `main` calls.
 *
 * WHY END-TO-END AND NOT JUST THE FOLD. The fold's own suite (`@storytree/drive`'s
 * `build-peek.test.ts`) proves every state the join can reach. None of it can see a verb that is
 * not wired: a missing dispatch arm answers `unknown node command "peek"` at `ok:false` with the
 * function under test perfectly healthy. Only an invocation through the dispatch hits that.
 *
 * The registry is INJECTED here — a fake filesystem and a fake probe — so nothing below reads this
 * machine's real `~/.storytree/spawns`, signals anything, or depends on what the box is running.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { INNER_LOOP_EVENT_KIND, type BuildPhase, type InnerLoopEventDoc } from "@storytree/proof-protocol";
import { InMemoryStore, type StoreEvent } from "@storytree/storage-protocol";
import { appendInnerLoopEvent, workEvent } from "@storytree/orchestrator";
import type { SpawnRecord, SpawnRegistryIo } from "@storytree/drive";

import { run, type RunDeps } from "./commands.js";
import { defaultNodePeekDeps, readMachineSpawns, type NodePeekDeps } from "./node-peek.js";
import type { WorkLogReaderLike } from "./work-log.js";

const ROOT = "/fake/spawns";

/** A registry laid out as the real one is: `<root>/<sessionId>/<pid>.json`. */
function fakeRegistry(records: readonly SpawnRecord[]): SpawnRegistryIo {
  const files = new Map<string, string>();
  const dirs = new Map<string, string[]>();
  for (const r of records) {
    const dir = `${ROOT}/${r.sessionId}`;
    const file = `${dir}/${r.pid}.json`;
    files.set(file, JSON.stringify(r));
    dirs.set(dir, [...(dirs.get(dir) ?? []), `${r.pid}.json`]);
  }
  dirs.set(ROOT, [...new Set(records.map((r) => r.sessionId))]);
  return {
    mkdirp: () => {},
    writeText: () => {},
    remove: () => {},
    readText: (p) => {
      const text = files.get(p.replaceAll("\\", "/"));
      if (text === undefined) throw new Error(`no such record: ${p}`);
      return text;
    },
    listDir: (d) => [...(dirs.get(d.replaceAll("\\", "/")) ?? [])],
  };
}

function record(over: Partial<SpawnRecord> & { readonly pid: number }): SpawnRecord {
  return {
    sessionId: over.sessionId ?? "bold-noether-1234",
    branch: over.branch ?? "claude/bold-noether-1234",
    pid: over.pid,
    command: over.command ?? "storytree node build my-unit --real --store pg --time-budget 30",
    cwd: over.cwd ?? "C:\\code\\storytree\\.claude\\worktrees\\bold-noether-1234",
    startedAt: over.startedAt ?? "2026-09-21T11:00:00.000Z",
  };
}

function peekDeps(
  records: readonly SpawnRecord[],
  alive: (pid: number) => boolean | "unknown" = () => true,
): NodePeekDeps {
  return {
    io: fakeRegistry(records),
    root: ROOT,
    probe: alive,
    now: () => Date.parse("2026-09-21T12:00:00.000Z"),
    machine: () => "test-box",
    // ADR-0592 D6: no hold in these cases. Injected rather than defaulted so a peek test never
    // reads the operator's own ~/.storytree/holds.
    readHold: () => Promise.resolve(undefined),
  };
}

/** A work log holding one run's phase marks for `unitId`. */
function workLogOf(unitId: string, phases: readonly BuildPhase[]): WorkLogReaderLike {
  const store = new InMemoryStore();
  const events: Promise<unknown>[] = [];
  for (const phase of phases) {
    events.push(
      store.appendEvent(
        workEvent({ unitId, event: "building", runId: "real-xyz", phase }, "tester@example.com"),
      ),
    );
  }
  return {
    async readEvents(): Promise<StoreEvent[]> {
      await Promise.all(events);
      return store.readEvents();
    },
  };
}

const STORE = new InMemoryStore();

// ---------------------------------------------------------------------------
// The verb reaches its dispatch arm
// ---------------------------------------------------------------------------

test("node-peek-is-dispatched: the verb is wired, not answered as an unknown node command", async () => {
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    nodePeek: peekDeps([record({ pid: 4242 })]),
  });
  assert.equal(env.ok, true);
  assert.doesNotMatch(env.body, /unknown node command/);
  assert.match(env.body, /^ {2}Machine: test-box/m);
  assert.match(env.body, /RUNNING — "my-unit"/);
  assert.match(env.body, /pid 4242 is alive/);
});

test("node-peek-needs-a-unit-id, and says which question it could not answer", async () => {
  const env = await run(["node", "peek"], { store: STORE, nodePeek: peekDeps([]) });
  assert.deepEqual(env, {
    ok: false,
    body: "storytree node peek <unit-id> — which unit's build?",
    // The refusal's `next` is the only thing that tells a caller the SHAPE of the command they
    // meant to type, so it is pinned rather than probed: a refusal that names no usage leaves the
    // reader exactly where they started.
    next: ["storytree node peek <unit-id> --pg"],
  });
});

test("node-peek-is-offered-by-the-node-help-and-by-the-unknown-verb-refusal", async () => {
  // The two discovery surfaces a reader actually meets. Both named, because a verb nothing points
  // at is a verb nobody runs.
  const help = await run(["node"], { store: STORE });
  assert.match(help.body, /storytree node peek <id>/);
  const unknown = await run(["node", "nonsense"], { store: STORE });
  assert.equal(unknown.ok, false);
  assert.match(unknown.body, /storytree node peek <id>/);
});

// ---------------------------------------------------------------------------
// The store half is OPTIONAL — and that is the design, not a degradation
// ---------------------------------------------------------------------------

test("node-peek-answers-WITHOUT-the-live-store, and names what it therefore did not read", async () => {
  // Its two neighbours (`node log`, `node walls`) refuse without --pg and are right to: their whole
  // subject is in Postgres. This one's first input is a filesystem read, so an absent store NARROWS
  // the answer rather than withholding it — and the narrowing is printed in words, never as an
  // empty trail that would read as "this unit was never built".
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    workLog: null,
    nodePeek: peekDeps([record({ pid: 4242 })]),
  });
  assert.equal(env.ok, true);
  assert.match(env.body, /RUNNING — "my-unit"/, "the process half still answers");
  assert.match(env.body, /Phase trail: NOT READ/);
  assert.ok((env.next ?? []).includes("storytree node peek my-unit --pg"));
});

test("node-peek-reads-the-phase-trail-when-the-store-is-there", async () => {
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    workLog: workLogOf("my-unit", ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT"]),
    nodePeek: peekDeps([record({ pid: 4242 })]),
  });
  assert.match(env.body, /now in: IMPLEMENT/);
  assert.doesNotMatch(env.body, /Phase trail: NOT READ/);
  // D5: the clock is read against the 30 minutes in the registered argv, never the two-hour default.
  assert.match(env.body, /budget: {2}30m \(as launched/);
  assert.match(env.body, /elapsed: 1h 0m/);
  assert.match(env.body, /left: {4}NONE — the budget is spent by 30m\./);
});

test("node-peek-reads-marks-for-THIS-unit-only", async () => {
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    workLog: workLogOf("a-different-unit", ["IMPLEMENT"]),
    nodePeek: peekDeps([]),
  });
  // The store was read and holds nothing for this unit — which the render must not confuse with a
  // store it never opened.
  assert.match(env.body, /no `building` mark for this unit is in the store/);
  assert.doesNotMatch(env.body, /Phase trail: NOT READ/);
});

// ---------------------------------------------------------------------------
// The machine-wide sweep
// ---------------------------------------------------------------------------

test("node-peek-finds-ANOTHER-session's-build, because the question is about the unit not the reader", async () => {
  // `storytree own` reads one session's directory; the peek sweeps every session, since the build
  // it is asked about is usually a sibling's process.
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    nodePeek: peekDeps([
      record({ pid: 1, sessionId: "someone-else-9999", command: "storytree node build my-unit --real" }),
    ]),
  });
  assert.match(env.body, /RUNNING/);
  assert.match(env.body, /someone-else-9999/);
});

test("node-peek-does-not-mistake-a-READ-verb-for-the-build-it-is-reading-about", async () => {
  // The peek registers ITSELF as `storytree node peek <unit> …`. Nothing excludes the reader's own
  // pid, and nothing needs to — the argv match refuses anything that is not a `--real` build. If
  // that ever stopped holding, every peek would report itself RUNNING and always answer yes.
  const env = await run(["node", "peek", "my-unit"], {
    store: STORE,
    nodePeek: peekDeps([
      record({ pid: 1, command: "storytree node peek my-unit --pg" }),
      record({ pid: 2, command: "storytree node attempts my-unit --pg" }),
      record({ pid: 3, command: "storytree node build my-unit --dry-run" }),
    ]),
  });
  assert.match(env.body, /UNKNOWN — "my-unit"/);
});

test("readMachineSpawns-returns-every-state, not only the live ones", async () => {
  // A leaked record is the evidence a build CRASHED; dropping it would erase the one thing that
  // separates "ended" from "cannot tell".
  const spawns = readMachineSpawns(
    peekDeps(
      [record({ pid: 1 }), record({ pid: 2, sessionId: "other-1" }), record({ pid: 3, sessionId: "other-2" })],
      (pid) => (pid === 1 ? true : pid === 2 ? false : "unknown"),
    ),
  );
  assert.deepEqual(
    spawns.map((s) => [s.record.pid, s.state]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [1, "live"],
      [2, "leaked"],
      [3, "unknown"],
    ],
  );
});

// ---------------------------------------------------------------------------
// The D4 disagreement fence on `node attempts`
// ---------------------------------------------------------------------------

async function ledgerWith(docs: readonly InnerLoopEventDoc[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const doc of docs) await appendInnerLoopEvent(store, doc);
  return store;
}

const UNSIGNED_ATTEMPT: readonly InnerLoopEventDoc[] = [
  { event: "attempt", unitId: "my-unit", incrementId: "inc-a", runId: "real-xyz" },
];

test("attempts-fence: a run the peek calls RUNNING must not read as a counted failure (D4)", async () => {
  // THE MEASURE OF WHETHER THIS UNIT WORKED. The ledger's `attempt` row is appended before the walk
  // (ADR-0576 D5), so this exact ledger state is what a HEALTHY mid-walk build looks like. Without
  // the fence the orchestrator reads "1 consecutive failure" and may spend a decision point on it.
  const deps: RunDeps = {
    store: STORE,
    attemptLedger: await ledgerWith(UNSIGNED_ATTEMPT),
    nodePeek: peekDeps([record({ pid: 77, sessionId: "eager-euler-99" })]),
  };
  const env = await run(["node", "attempts", "my-unit"], deps);
  assert.equal(env.ok, true, "the fence annotates the policy, it never fails the read");
  assert.match(env.body, /RUNNING right now/);
  assert.match(env.body, /pid 77/);
  assert.match(env.body, /may be THAT BUILD IN FLIGHT rather than a failure/);
  assert.equal((env.next ?? [])[0], "storytree node peek my-unit --pg");
});

test("attempts-fence-stays-silent-when-nothing-is-running, so it never becomes background noise", async () => {
  // `unknown` is the ordinary state of every build that has finished. A caveat there would print on
  // nearly every read — and a warning that fires always warns about nothing.
  const env = await run(["node", "attempts", "my-unit"], {
    store: STORE,
    attemptLedger: await ledgerWith(UNSIGNED_ATTEMPT),
    nodePeek: peekDeps([]),
  });
  assert.equal(env.ok, true);
  assert.doesNotMatch(env.body, /RUNNING right now/);
  assert.notEqual((env.next ?? [])[0], "storytree node peek my-unit --pg");
});

test("attempts-fence-survives-an-unreadable-registry: instrumentation never fails the read it annotates", async () => {
  const exploding: NodePeekDeps = {
    ...peekDeps([]),
    io: {
      mkdirp: () => {},
      writeText: () => {},
      remove: () => {},
      readText: () => "",
      listDir: () => {
        throw new Error("registry-unreadable-marker");
      },
    },
  };
  const env = await run(["node", "attempts", "my-unit"], {
    store: STORE,
    attemptLedger: await ledgerWith(UNSIGNED_ATTEMPT),
    nodePeek: exploding,
  });
  assert.equal(env.ok, true);
  assert.doesNotMatch(env.body, /registry-unreadable-marker/);
  // And the attempt policy's own answer is untouched — the fence is additive or it is nothing.
  assert.match(env.body, /my-unit/);
});

test("attempts-with-no-peek-seam-wired-renders-the-policy-alone, and costs no filesystem sweep", async () => {
  // The seam is REQUIRED here rather than defaulted, unlike the verb. A fallback would turn every
  // hermetic `node attempts` test into a sweep of this box's real registry, whose result depends on
  // what the box happens to be running. Production cannot hit this branch — `main.ts` wires it, and
  // the next test pins that.
  const env = await run(["node", "attempts", "my-unit"], {
    store: STORE,
    attemptLedger: await ledgerWith(UNSIGNED_ATTEMPT),
  });
  assert.equal(env.ok, true);
  assert.doesNotMatch(env.body, /RUNNING right now/);
});

test("the-composition-root-wires-the-peek-seam, so the fence cannot silently stop firing", async () => {
  // The one thing no unit test of the fence can see: `main.ts` forgetting the line. Read as SOURCE
  // because importing `main.ts` runs the CLI. `defaultNodePeekDeps` is exercised for real beside it,
  // so a seam that is wired but broken is caught too.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  assert.match(source, /nodePeek: defaultNodePeekDeps\(\)/);
  const real = defaultNodePeekDeps();
  assert.equal(typeof real.now(), "number");
  assert.equal(typeof real.root, "string");
  // The real probe, asked about THIS process, must say live — a probe that answered otherwise would
  // make every peek report ENDED.
  assert.equal(real.probe(process.pid), true);
});

test("attempts-fence-does-not-fire-on-a-SIGNED-run, even with a live build registered", async () => {
  // MEASURED HERE, not assumed: the first draft fired on every rendered state and printed "the
  // unsigned attempt counted above may be THAT BUILD IN FLIGHT" under a row that reported a SIGNED
  // verdict and no unsigned attempt at all. D4 is about one ambiguity — an unsigned attempt that
  // may still be walking — and a caveat that annotates reads it does not apply to is how a caveat
  // stops being read.
  const signed: readonly InnerLoopEventDoc[] = [
    { event: "attempt", unitId: "my-unit", incrementId: "inc-a", runId: "real-xyz" },
    { event: "signed-pass", unitId: "my-unit", incrementId: "inc-a", runId: "real-xyz" },
  ];
  const env = await run(["node", "attempts", "my-unit"], {
    store: STORE,
    attemptLedger: await ledgerWith(signed),
    nodePeek: peekDeps([record({ pid: 77 })]),
  });
  assert.equal(env.ok, true);
  assert.doesNotMatch(env.body, /RUNNING right now/);
});

test("the-ledger-fixtures-above-are-real-inner-loop-events", async () => {
  // Guards the fixtures themselves: a doc that stopped being an inner-loop event would make every
  // assertion above pass against an empty fold.
  const store = await ledgerWith(UNSIGNED_ATTEMPT);
  const events = await store.readEvents();
  assert.equal(events.filter((e) => e.kind === INNER_LOOP_EVENT_KIND).length, 1);
});
