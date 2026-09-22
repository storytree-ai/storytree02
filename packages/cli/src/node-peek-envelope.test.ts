/**
 * `node peek`'s ENVELOPE — the `next:` array, pinned per state.
 *
 * A golden on the rendered BODY reaches none of this: `next` is the other half of the envelope and
 * is built by its own branches, one per state. Those branches are what decide whether a reader is
 * pointed at the read that corrects the ambiguity (`node attempts`) or at the flag that widens the
 * answer (`--pg`), so getting them wrong sends a reader to the wrong command at exactly the moment
 * they are trying to decide whether a build is stuck.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { SpawnRecord, SpawnRegistryIo } from "@storytree/drive";

import { defaultNodePeekDeps, nodePeekCommand, type NodePeekDeps } from "./node-peek.js";

const ROOT = "/fake/spawns";

function fakeRegistry(records: readonly SpawnRecord[]): SpawnRegistryIo {
  const files = new Map<string, string>();
  const dirs = new Map<string, string[]>();
  for (const r of records) {
    const dir = `${ROOT}/${r.sessionId}`;
    files.set(`${dir}/${r.pid}.json`, JSON.stringify(r));
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

function deps(records: readonly SpawnRecord[]): NodePeekDeps {
  return {
    io: fakeRegistry(records),
    root: ROOT,
    probe: () => true,
    now: () => Date.parse("2026-09-21T12:00:00.000Z"),
    machine: () => "test-box",
    // ADR-0592 D6: no hold in these cases. Injected rather than defaulted so a peek test never
    // reads the operator's own ~/.storytree/holds.
    readHold: () => Promise.resolve(undefined),
  };
}

const LIVE_BUILD: SpawnRecord = {
  sessionId: "bold-noether-1234",
  branch: "claude/bold-noether-1234",
  pid: 4242,
  command: "storytree node build my-unit --real --store pg",
  cwd: "C:\\wt\\bold-noether-1234",
  startedAt: "2026-09-21T11:00:00.000Z",
};

test("peek-envelope-RUNNING-with-the-store-read: points at the read this one corrects", () => {
  // ADR-0588 D4 in its offered form: a reader looking at a RUNNING build is pointed straight at
  // `node attempts`, which is the read that would otherwise have told them it failed.
  const env = nodePeekCommand("my-unit", [], deps([LIVE_BUILD]));
  assert.equal(env.ok, true);
  assert.deepEqual(env.next, [
    "storytree node attempts my-unit --pg",
    "storytree node log my-unit --pg",
    "storytree own --all",
  ]);
});

test("peek-envelope-RUNNING-without-the-store: offers BOTH the correction and the widening", () => {
  // The two branches are independent and both fire here — the ambiguity is worth naming even when
  // the trail could not be read, since the process half is what makes RUNNING knowable at all.
  const env = nodePeekCommand("my-unit", null, deps([LIVE_BUILD]));
  assert.deepEqual(env.next, [
    "storytree node attempts my-unit --pg",
    "storytree node peek my-unit --pg",
    "storytree node log my-unit --pg",
    "storytree own --all",
  ]);
});

test("peek-envelope-UNKNOWN-with-the-store-read: neither branch fires", () => {
  // Nothing is running, so there is no ambiguity to point at; the store WAS read, so there is
  // nothing to widen. The base pair is what is left, and it must not acquire either extra.
  const env = nodePeekCommand("my-unit", [], deps([]));
  assert.deepEqual(env.next, ["storytree node log my-unit --pg", "storytree own --all"]);
});

test("peek-envelope-UNKNOWN-without-the-store: offers the widening alone", () => {
  const env = nodePeekCommand("my-unit", null, deps([]));
  assert.deepEqual(env.next, [
    "storytree node peek my-unit --pg",
    "storytree node log my-unit --pg",
    "storytree own --all",
  ]);
});

test("peek-envelope-carries-the-MACHINE-SCOPE-line-first, before the peek itself", () => {
  // The registry is per-machine, so an inventory that did not say which machine it covers reads as
  // a fleet answer. It leads, because a reader who stops after the headline has still been told.
  const env = nodePeekCommand("my-unit", null, deps([LIVE_BUILD]));
  const lines = env.body.split("\n");
  assert.equal(
    lines[0],
    "  Machine: test-box — only work registered on THIS machine is listed; nothing running on any other machine appears here.",
  );
  assert.equal(lines[1], "");
  assert.match(lines[2] ?? "", /^RUNNING — "my-unit"$/);
});

test("peek-envelope-names-the-unit-it-was-ASKED-about-in-every-next-entry", () => {
  // Each `next` line is built from the argument rather than from the matched record, so a peek at a
  // unit with no record still hands back commands that name that unit.
  const env = nodePeekCommand("some-other-unit", null, deps([LIVE_BUILD]));
  for (const line of env.next ?? []) {
    assert.ok(
      line.includes("some-other-unit") || line === "storytree own --all",
      `next entry should name the asked-about unit: ${line}`,
    );
  }
});

test("the-real-deps-read-this-machine, and every seam answers", () => {
  // `defaultNodePeekDeps` is the production wiring and is reached by nothing else here — a seam
  // wired but broken would leave every test above passing against fakes.
  const real = defaultNodePeekDeps();
  assert.equal(typeof real.now(), "number");
  assert.equal(typeof real.root, "string");
  assert.ok(real.root.length > 0);
  // A hostname, or an explicit null when it could not be read — never an empty string, which would
  // render as a machine called "".
  const machine = real.machine();
  assert.ok(machine === null || machine.length > 0);
  // The real probe, asked about THIS process, must say live: a probe answering otherwise would make
  // every peek report that nothing is running.
  assert.equal(real.probe(process.pid), true);
});
