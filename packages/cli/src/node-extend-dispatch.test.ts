/**
 * `storytree node extend` — the orchestrator's answer to a held build (ADR-0592 D3/D4), driven through
 * `run([...])`, the function `main` calls.
 *
 * WHY END-TO-END AND NOT JUST THE COMMAND FUNCTION. A missing dispatch arm answers
 * `unknown node command "extend"` at `ok:false` with `nodeExtendCommand` perfectly healthy, and no unit
 * test of that function can see it. Only an invocation through the dispatch hits that — the trap
 * `a-new-cli-verb-has-four-registration-points` was written about, and the one ADR-0588's own landing
 * paid for. So the flag parsing, the `--pg`-lessness and the two answers are all proved from the argv.
 *
 * The holds directory is INJECTED. Nothing below reads or writes this machine's real
 * `~/.storytree/holds`, and no case shares a fixture with another: a leftover notice from one would
 * satisfy the next one's assertion.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReliabilityGate } from "@storytree/library";
import { InMemoryStore } from "@storytree/storage-protocol";

import type { StoredHold } from "@storytree/drive";
import type { HoldDecision } from "@storytree/orchestrator";

import { makeGateDeps, run, type RunDeps } from "./commands.js";
import { defaultNodeExtendDeps, type NodeExtendDeps } from "./node-extend.js";

const MIN = 60_000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function hold(over: Partial<StoredHold> = {}): StoredHold {
  return {
    unitId: "a-unit",
    runId: "real-abc",
    pid: 4242,
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: NOW - 3 * MIN,
    extensions: [],
    ...over,
  };
}

/** A recording deps bag: the holds it lists, and every answer written through it. */
function deps(holds: readonly StoredHold[]) {
  const written: { hold: StoredHold; decision: HoldDecision }[] = [];
  // Annotated with the NAMED contracts rather than an anonymous shape: `no-known-value-widening`
  // refuses an explicit anonymous object type, and the named ones are what give the `write` callback
  // its parameter types.
  const nodeExtend: NodeExtendDeps = {
    dir: "/fake/holds",
    now: () => NOW,
    list: () => Promise.resolve(holds),
    write: (_dir, hold, decision) => {
      written.push({ hold, decision });
      return Promise.resolve(`/fake/holds/${hold.unitId}/${hold.runId}.decision.json`);
    },
  };
  // `store` is required on `RunDeps` and this verb never touches it — which is itself the point of
  // ADR-0592 D4: an in-memory store here would still be a store, so the assertion that matters is that
  // no invocation below passes `--pg` or reads anything out of it.
  const runDeps: RunDeps = { store: new InMemoryStore(), nodeExtend };
  return { runDeps, written };
}

// ---------------------------------------------------------------------------
// The verb is wired
// ---------------------------------------------------------------------------

test("the verb is REACHABLE through the dispatch — not answered as an unknown node command", async () => {
  const { runDeps } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "30", "--reason", "progress"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(/unknown node command/.test(env.body), false);
});

test("it needs NO --pg, because a held build must be answerable with the store down", async () => {
  // ADR-0592 D4's whole reason for choosing a file over the live store: the store is the dependency a
  // build in trouble is most likely to have lost, and refusing without one here would reintroduce
  // exactly the stall the file channel exists to prevent. No `--pg` appears in any invocation below.
  const { runDeps } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--stop", "--reason", "wedged"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(/--pg/.test(env.body), false, "the answer must not send the operator to fetch a database");
});

test("with no unit id it asks which held build, rather than answering an arbitrary one", async () => {
  const { runDeps, written } = deps([hold(), hold({ unitId: "another" })]);
  const env = await run(["node", "extend"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /which held build\?/);
  // The two suggestions are placeholders (`<unit-id>`), unlike every other refusal's `next`, because
  // there is no unit to fill them in with yet — that is the whole reason this refusal exists.
  assert.deepEqual(env.next, [
    'storytree node extend <unit-id> --minutes 30 --reason "<why>"',
    'storytree node extend <unit-id> --stop --reason "<why>"',
  ]);
  assert.deepEqual(written, []);
});

// ---------------------------------------------------------------------------
// The two answers
// ---------------------------------------------------------------------------

test("--minutes writes an extend carrying the operator's reason, and reports the clock it bought", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(
    ["node", "extend", "a-unit", "--minutes", "30", "--reason", "the diff shows real progress"],
    runDeps,
  );
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(written, [
    { hold: hold(), decision: { kind: "extend", minutes: 30, reason: "the diff shows real progress" } },
  ]);
  // Whole-body golden (ADR-0592 D5): every literal here is a promise an operator reads before deciding
  // whether the money kept flowing was worth it, so a dropped line must fail loudly rather than let
  // a spot `assert.match` wave it through.
  assert.equal(
    env.body,
    [
      'EXTENDED "a-unit" by 30 min — its clock goes from 120 min to 150 min.',
      "",
      "The build resumes the SAME build and the same files — its next slice is a repair slice with the",
      "work so far on disk, exactly as every in-build repair is (ADR-0582 D7). It is NOT a new attempt,",
      "and this extension is listed in the build envelope with your reason (ADR-0592 D5).",
      "",
      "reason:   the diff shows real progress",
      "run:      real-abc (pid 4242)",
      "written:  /fake/holds/a-unit/real-abc.decision.json",
      "",
      "The build looks for this every couple of seconds and had 7 min of its grace left.",
    ].join("\n"),
  );
  assert.deepEqual(env.next, ["storytree node peek a-unit --pg", "storytree node log a-unit --pg"]);
});

test("--stop writes a stop and says plainly that it is ONE failed attempt", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--stop", "--reason", "rewriting the same file"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(written, [
    { hold: hold(), decision: { kind: "stop", reason: "rewriting the same file" } },
  ]);
  // Whole-body golden, same reasoning as the EXTENDED case above: this is the accounting an operator
  // reads to know the stop costs no more than the ONE attempt ADR-0563 already charges it.
  assert.equal(
    env.body,
    [
      'STOPPED "a-unit" — it will end unsigned rather than resume.',
      "",
      "That is ONE failed attempt under ADR-0563, which is what a build that ran out of time always was.",
      "The extensions it was granted earlier, if any, are listed in its envelope and count for nothing",
      "against it.",
      "",
      "reason:   rewriting the same file",
      "run:      real-abc (pid 4242)",
      "written:  /fake/holds/a-unit/real-abc.decision.json",
      "",
      "The build looks for this every couple of seconds and had 7 min of its grace left.",
    ].join("\n"),
  );
  assert.deepEqual(env.next, ["storytree node peek a-unit --pg", "storytree node log a-unit --pg"]);
});

test("an answer with no --reason still lands, recorded as having given none", async () => {
  // A missing why must not block an answer: the grace window is running, and refusing here would cost
  // the build. It is recorded as absent rather than invented.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "15"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.decision.reason, "no reason given");
});

test("a --stop with no --reason also lands with none given — the fallback is not extend-only", async () => {
  // `chooseHoldDecision` has TWO `reason || "no reason given"` fallbacks, one per branch. The case
  // above only ever drives the extend one; this drives the stop one on its own terms.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--stop"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.decision.reason, "no reason given");
});

// ---------------------------------------------------------------------------
// Refusals — each writes nothing
// ---------------------------------------------------------------------------

test("both answers at once is refused rather than resolved by precedence", async () => {
  // Extending and stopping are opposites. Choosing for the operator would spend or abandon a build on
  // a coin toss.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "30", "--stop"], runDeps);
  assert.equal(env.ok, false);
  // Whole-body golden: `assert.match` on the first sentence alone would leave the second sentence — the
  // part that actually explains WHY choosing for the operator is unsafe — free for a mutant to erase.
  assert.equal(
    env.body,
    "--minutes and --stop are the two opposite answers to a hold; pass exactly one. " +
      "Extending and stopping cannot both be meant, and choosing for you would spend or abandon a " +
      "build on a guess.",
  );
  // This `next` is shared by every malformed-answer refusal (both flags, neither flag, a bad
  // --minutes) — proved once here, from a real unit id this time (unlike the no-unit-id case above,
  // whose `next` is a fixed `<unit-id>` placeholder).
  assert.deepEqual(env.next, [
    'storytree node extend a-unit --minutes 30 --reason "<why>"',
    'storytree node extend a-unit --stop --reason "<why>"',
  ]);
  assert.deepEqual(written, [], "a refused answer writes nothing");
});

test("neither answer is refused, and the refusal says what happens if the operator walks away", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /pass --minutes <n> to buy the build more time, or --stop to end it now/);
  assert.match(env.body, /the build stops itself when its grace window runs out/);
  assert.deepEqual(written, []);
});

test("a non-positive or unreadable --minutes is refused, and points at --stop instead", async () => {
  // `--minutes=-10` rather than `--minutes -10`: Node's own `parseArgs` refuses a dash-leading value
  // before this validator sees it, with a message naming the `=` form. That refusal is honest and
  // earlier, so the `=` form is the one that actually reaches the rule under test here.
  //
  // Whole-body golden, keyed to the RAW text `chooseHoldDecision` quotes back — pinning only the two
  // ends (as two `assert.match`es used to) leaves the middle sentence, the one that says WHY the
  // figure matters (it bounds the build's whole wall clock), free for a mutant to erase.
  const cases: { readonly argv: readonly string[]; readonly raw: string }[] = [
    { argv: ["--minutes", "0"], raw: "0" },
    { argv: ["--minutes=-10"], raw: "-10" },
    { argv: ["--minutes", "soon"], raw: "soon" },
    { argv: ["--minutes", ""], raw: "" },
  ];
  for (const { argv, raw } of cases) {
    const { runDeps, written } = deps([hold()]);
    const env = await run(["node", "extend", "a-unit", ...argv], runDeps);
    assert.equal(env.ok, false, `${argv.join(" ")} must not buy time`);
    assert.equal(
      env.body,
      `--minutes must be a positive number of minutes; got "${raw}". ` +
        "It is added to the build's whole wall clock, which both authoring slices and every in-build " +
        "repair spend (ADR-0581 D2). To end the build instead, pass --stop.",
    );
    assert.deepEqual(written, []);
  }
});

test("a dash-leading --minutes is refused by the arg parser itself, before any hold is read", async () => {
  // Kept as its own case rather than folded above, because it proves a DIFFERENT wall: the refusal
  // comes from `parseArgs` and names the `=` form, so an operator who typed a negative is told how to
  // type it rather than being told nothing.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "-10"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /--minutes=-XYZ/);
  assert.deepEqual(written, []);
});

// ---------------------------------------------------------------------------
// Finding the hold
// ---------------------------------------------------------------------------

test("a unit that is not holding is told so, and LISTED what actually is", async () => {
  // ⚠ The story-versus-member keying: a peek matches the id in the registered argv, which for a chain
  // is the STORY's, while the hold is announced under the MEMBER. Listing turns that into a pointer
  // rather than a dead end, which is the whole reason this refusal is not one line.
  //
  // Two holds, not one: alongside the answerable one, a SECOND that is past its grace, so the listing
  // exercises `heldElsewhere`'s "grace EXPIRED" branch too (an expired hold does not vanish from the
  // board — it is still worth knowing about, just not worth trying to answer).
  const { runDeps, written } = deps([
    hold({ unitId: "the-member", runId: "real-m1" }),
    hold({ unitId: "the-other-member", runId: "real-m2", heldAt: NOW - 11 * MIN }),
  ]);
  const env = await run(["node", "extend", "the-story", "--minutes", "30"], runDeps);
  assert.equal(env.ok, false);
  // Whole-body golden: this refusal's fixed prose is FOUR lines the two spot-`assert.match`es above
  // never touched (the "chain member" explanation's second and third lines, and the blank separators
  // either side of it), plus the join separator itself — any of which a mutant could have erased.
  assert.equal(
    env.body,
    [
      '"the-story" is not holding — no build of it has announced a spent budget on this machine.',
      "",
      "A build only holds once its time budget is SPENT, and a chain member announces its hold under",
      "its OWN id while a peek of the chain reports the STORY's — so the id you peeked may not be the",
      "id that is held.",
      "",
      "Currently held on this machine:",
      "  the-member  (run real-m1, pid 4242, 120 min spent, 7 min left)",
      "  the-other-member  (run real-m2, pid 4242, 120 min spent, grace EXPIRED)",
    ].join("\n"),
  );
  assert.deepEqual(env.next, ["storytree node peek the-story --pg", "storytree own --all"]);
  assert.deepEqual(written, []);
});

test("with nothing held at all it says exactly that, rather than printing an empty list", async () => {
  const { runDeps } = deps([]);
  const env = await run(["node", "extend", "a-unit", "--stop"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /Nothing on this machine is currently held\./);
});

test("--run names which hold to answer, and a run that is not held is refused by name", async () => {
  const held = [hold({ runId: "real-one" }), hold({ runId: "real-two", heldAt: NOW - MIN })];
  const { runDeps, written } = deps(held);
  const chosen = await run(["node", "extend", "a-unit", "--run", "real-one", "--minutes", "5"], runDeps);
  assert.equal(chosen.ok, true, chosen.body);
  assert.equal(written[0]?.hold.runId, "real-one", "--run selects, it does not merely filter the render");

  const { runDeps: missDeps, written: missWritten } = deps(held);
  const miss = await run(["node", "extend", "a-unit", "--run", "real-nope", "--minutes", "5"], missDeps);
  assert.equal(miss.ok, false);
  assert.match(miss.body, /has no hold for run "real-nope"/);
  assert.deepEqual(missWritten, []);
});

test("with two holds and no --run, the NEWEST is answered", async () => {
  // Abnormal — a build removes its own notice on the way out — but the one an orchestrator was just
  // shown is the latest, and answering an older one would extend a build that has already ended.
  const { runDeps, written } = deps([
    hold({ runId: "older", heldAt: NOW - 9 * MIN }),
    hold({ runId: "newer", heldAt: NOW - MIN }),
  ]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "5"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.hold.runId, "newer");
});

test("two holds at the SAME instant answer the FIRST, which is what the old sort did", async () => {
  // The last thing the comparator can get wrong: `>` and `>=` differ ONLY on a tie — `>` keeps the
  // first, `>=` keeps the last. Both cases above use distinct instants, so neither can tell them apart.
  // `>` is the behaviour the `sort((a, b) => b.heldAt - a.heldAt)[0]` this replaced had, because
  // Array#sort is stable, so this pins a tie rule that was preserved rather than chosen afresh.
  const { runDeps, written } = deps([
    hold({ runId: "first", heldAt: NOW - 3 * MIN }),
    hold({ runId: "second", heldAt: NOW - 3 * MIN }),
  ]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "5"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.hold.runId, "first");
});

test("the newest is answered even when it is listed FIRST — the comparator, not the order", async () => {
  // ⚠ The case above has the newest LAST, so it is satisfied by "take the last one" as well as by
  // "take the newest" — a comparator that always prefers its right-hand argument passes it. This one
  // reverses the order so only an actual heldAt comparison answers correctly. Both are kept: together
  // they pin the comparator rather than the input order, and neither alone does.
  const { runDeps, written } = deps([
    hold({ runId: "newer", heldAt: NOW - MIN }),
    hold({ runId: "older", heldAt: NOW - 9 * MIN }),
  ]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "5"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.hold.runId, "newer");
});

// ---------------------------------------------------------------------------
// The expired hold
// ---------------------------------------------------------------------------

test("a hold whose grace has passed is refused, writes nothing, and offers a longer budget instead", async () => {
  // The one case where the operator did everything right and merely arrived too late. Writing here
  // would tell them they had saved a build that had already stopped.
  const { runDeps, written } = deps([hold({ heldAt: NOW - 11 * MIN })]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "60"], runDeps);
  assert.equal(env.ok, false);
  // Whole-body golden: the second suggestion sentence ("re-run it with a longer budget...") and the
  // join separator between all four lines were both free for a mutant to erase under spot `assert.match`es.
  assert.equal(
    env.body,
    [
      '"a-unit" (run real-abc) was held, but its grace window of 10 min expired 1 min ago, so the ' +
        "build has already stopped unsigned (or died while held and left this notice behind). An answer " +
        "now would be read by nothing.",
      "",
      "Nothing was written. The build recorded ONE failed attempt for its spent budget (ADR-0563);",
      "re-run it with a longer budget rather than extending a hold that has passed:",
    ].join("\n"),
  );
  assert.deepEqual(written, [], "an answer nothing will read must not be written");
  // Both suggestions, not just the first: doubling the SAME budget the build already spent, then the
  // peek an operator would reach for to see what it was doing when it held.
  assert.deepEqual(env.next, ["storytree node build a-unit --real --time-budget 240", "storytree node peek a-unit --pg"]);
});

test("a hold at exactly its expiry is already too late — the same boundary the build stops on", async () => {
  const { runDeps, written } = deps([hold({ heldAt: NOW - 10 * MIN })]);
  const env = await run(["node", "extend", "a-unit", "--stop"], runDeps);
  assert.equal(env.ok, false);
  assert.deepEqual(written, []);

  const { runDeps: justInTime, written: landed } = deps([hold({ heldAt: NOW - 10 * MIN + 1 })]);
  const ok = await run(["node", "extend", "a-unit", "--stop"], justInTime);
  assert.equal(ok.ok, true, "one millisecond earlier it is still answerable");
  assert.equal(landed.length, 1);
});

// ---------------------------------------------------------------------------
// The live wiring
// ---------------------------------------------------------------------------

test("the default deps point at the per-user holds directory, not at a test one", () => {
  // The seam the tests above inject is the ONLY thing between them and the operator's own records, so
  // it is worth one assertion that the production path is still the real directory.
  const live = defaultNodeExtendDeps();
  assert.match(live.dir.replaceAll("\\", "/"), /\.storytree\/holds$/);
  assert.equal(typeof live.now(), "number");
});

test("the default deps' list and write thunks are the real hold-channel functions, not stubs", async () => {
  // `dir` and `now` are driven above; `list` and `write` are the other two live-wiring thunks
  // (`defaultNodeExtendDeps` just closes over `listStoredHolds`/`writeHoldDecision`) and neither is
  // exercised anywhere else in this file. Driven against our OWN mkdtemp directory — never
  // `~/.storytree/**`, which is the operator's real record store.
  const dir = await mkdtemp(join(tmpdir(), "storytree-node-extend-live-"));
  try {
    const live = defaultNodeExtendDeps();

    // `list` on a directory with nothing announced yet: the real reader, not `() => undefined`.
    assert.deepEqual(await live.list(dir), []);

    // Hand-write a notice in the on-disk shape `listStoredHolds` reads (mirrors what a held build's
    // real channel writes), then confirm `list` finds and parses it.
    const notice: StoredHold = {
      unitId: "live-unit",
      runId: "live-run",
      pid: 777,
      budgetMs: 120 * MIN,
      elapsedMs: 121 * MIN,
      graceMs: 10 * MIN,
      heldAt: NOW - MIN,
      extensions: [],
    };
    await mkdir(join(dir, notice.unitId), { recursive: true });
    await writeFile(join(dir, notice.unitId, `${notice.runId}.json`), JSON.stringify(notice), "utf8");
    assert.deepEqual(await live.list(dir), [notice]);

    // `write`: the real writer, not `() => undefined` — it must return a path and actually put the
    // decision on disk at that path, in the shape a held build's poll would parse back. `decidedAt` is
    // stamped by the writer's own clock at write time, so it is bounded rather than pinned exactly —
    // pinning it against a second, later `live.now()` call would be one flaky millisecond away.
    const decision: HoldDecision = { kind: "stop", reason: "verifying the live wiring" };
    const before = Date.now();
    const written = await live.write(dir, notice, decision);
    const after = Date.now();
    assert.equal(written, join(dir, notice.unitId, `${notice.runId}.decision.json`));
    const onDisk = JSON.parse(await readFile(written, "utf8")) as Record<string, unknown>;
    const { decidedAt, ...rest } = onDisk;
    assert.deepEqual(rest, {
      unitId: "live-unit",
      runId: "live-run",
      answersHeldAt: notice.heldAt,
      kind: "stop",
      reason: "verifying the live wiring",
    });
    assert.equal(typeof decidedAt === "number" && decidedAt >= before && decidedAt <= after, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `--hold-grace` (ADR-0592 D3) threads through commands.ts elsewhere too — the build-tests gate
// driver and the `build` workflow help. Neither is `node extend`, but both are the same flag this
// ADR added to the same file, so they live here rather than forking a third owned test file.
// ---------------------------------------------------------------------------

test("--hold-grace threads from argv into the gate build driver under its own key, not a typo'd one", async () => {
  // `makeGateDeps`'s `driveBuildTestsGate` closure reads `values["hold-grace"]` into
  // `driverDeps.holdGrace`. A wrong key (e.g. `values[""]`) would read `undefined` instead, which
  // `chooseHoldGraceMs` treats as "omitted" (no refusal at all) rather than as the malformed value
  // actually typed — so a bogus `--hold-grace` proves the wiring precisely because it must be
  // ECHOED BACK in the refusal. The real `driveBuildTestsGate` (gate-build-driver.ts) validates
  // `--hold-grace` before it touches the story tree, a signer or the store, so this reaches the
  // refusal with no disk, DB or network involved — no `driverSeams` needed.
  const { runDeps } = deps([]);
  const gateDeps = makeGateDeps(runDeps, { "hold-grace": "not-a-number" }, "/fake/stories");
  const fakeGate: ReliabilityGate = {
    id: "fake-gate#gate-1",
    title: "fake gate",
    kind: "build-tests",
    covers: [],
    retired: false,
  };
  const env = await gateDeps.driveBuildTestsGate?.(fakeGate, undefined);
  assert.ok(env, "driveBuildTestsGate must be wired on the returned GateDeps");
  assert.equal(env.ok, false);
  assert.match(env.body, /--hold-grace must be a number of minutes, zero or more; got "not-a-number"/);
});

test("the build workflow help lists --hold-grace among the --real flags", async () => {
  const { runDeps } = deps([]);
  const env = await run(["build"], runDeps);
  assert.equal(env.ok, true, env.body);
  // Pins the WHOLE flags line, not just a substring: it is one line in the flags block and a mutant
  // that blanked it would otherwise still pass a narrower match on a neighbouring line.
  assert.equal(
    env.body.includes(
      "       --budget <usd> (Claude only) · --max-turns <n> · --time-budget <minutes> (--real) · " +
        "--hold-grace <minutes> (--real)   ·   --runtime pi is --live only (ADR-0449)",
    ),
    true,
    env.body,
  );
});
