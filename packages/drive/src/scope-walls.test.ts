import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";

import {
  appendSliceScope,
  liveAuthorScopeWalls,
  ownedLoopScopeWalls,
  sliceScopeDocs,
  type ClaudeScopeSource,
  type CodexScopeSource,
  type OwnedLoopScopeSource,
  type PiScopeSource,
  type ScopeEventSink,
  type ScopeWallReport,
} from "./scope-walls.js";

/**
 * The fold from each fence mechanism's own violation shape onto the one wire shape (ADR-0446).
 *
 * Four properties are asserted over and over here because each is one this arc could quietly lose:
 * a silent slice still BANKS a row (a zero is a measurement); a no-path call is NEVER counted as a
 * refusal (the mechanisms disagree about it, and merging them would erase the disagreement); a
 * tool-surface refusal is never counted as one either (it resolved no path, so it is not a
 * write-fence firing at all); and every row STATES its mechanism's disposition rather than leaving
 * a reader to derive it.
 */

const IDS = { unitId: "cap-x", runId: "run-1" };

function claude(
  violations: ClaudeScopeSource["violations"],
  runs: readonly { phase: "AUTHOR_TEST" | "IMPLEMENT" }[] = [{ phase: "AUTHOR_TEST" }],
): ClaudeScopeSource {
  return { runtime: "claude", runs, violations };
}

function pi(
  violations: PiScopeSource["violations"],
  runs: readonly { phase: "AUTHOR_TEST" | "IMPLEMENT" }[] = [{ phase: "AUTHOR_TEST" }],
): PiScopeSource {
  return { runtime: "pi", runs, violations };
}

test("fold-claude-silent: an armed slice with no refusal still yields ONE doc, refusals empty", () => {
  const docs = sliceScopeDocs(IDS, liveAuthorScopeWalls(claude([])));
  assert.equal(docs.length, 1, "the armed slice must produce a row — a zero, not an absence");
  assert.deepEqual(docs[0]?.refusals, []);
  assert.equal(docs[0]?.armed, true);
  assert.equal(docs[0]?.noPathCalls, 0);
  assert.equal(docs[0]?.source, "sdk-leaf");
});

test("fold-no-slices: a leaf that never ran and refused nothing yields NO docs at all", () => {
  // The honest under-report: with no evidence a wall was ever armed, inventing a row would put a
  // denominator under a measurement nobody took.
  assert.deepEqual(sliceScopeDocs(IDS, liveAuthorScopeWalls(claude([], []))), []);
});

test("fold-claude-no-path: the disputed case is counted APART, never as a refusal", () => {
  const report = liveAuthorScopeWalls(
    claude([
      { phase: "AUTHOR_TEST", tool: "Write", path: "(no path)", reason: "no readable file_path", kind: "no-path" },
      { phase: "AUTHOR_TEST", tool: "Write", path: "impl.ts", reason: "phase scope", kind: "scope" },
    ]),
  );
  const docs = sliceScopeDocs(IDS, report);
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.refusals.length, 1, "only the scoped-path refusal counts as a refusal");
  assert.equal(docs[0]?.refusals[0]?.kind, "scope");
  assert.equal(docs[0]?.noPathCalls, 1);
  // Claude's hook FAILS CLOSED here — the side of the disagreement this row records.
  assert.equal(docs[0]?.noPathDisposition, "refused");
});

test("fold-claude-outside-workspace: an escaping path is a refusal, and keeps its own kind", () => {
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      claude([
        { phase: "AUTHOR_TEST", tool: "Edit", path: "../../etc/evil", reason: "outside the workspace", kind: "outside-workspace" },
      ]),
    ),
  );
  assert.equal(docs[0]?.refusals[0]?.kind, "outside-workspace");
  assert.equal(docs[0]?.noPathCalls, 0);
});

test("fold-owned-loop: refusals are scope-kind, and its no-path calls are PASSED THROUGH", () => {
  const author: OwnedLoopScopeSource = {
    slices: [{ phase: "AUTHOR_TEST" }, { phase: "IMPLEMENT" }],
    violations: [{ phase: "IMPLEMENT", tool: "write_file", path: "unit.test.cjs" }],
    noPathCalls: [{ phase: "AUTHOR_TEST", tool: "write_file" }],
  };
  const docs = sliceScopeDocs(IDS, ownedLoopScopeWalls(author));
  assert.deepEqual(docs.map((d) => d.phase), ["AUTHOR_TEST", "IMPLEMENT"]);
  assert.equal(docs[0]?.refusals.length, 0);
  assert.equal(docs[0]?.noPathCalls, 1);
  assert.equal(docs[1]?.refusals[0]?.kind, "scope");
  assert.equal(docs[1]?.noPathCalls, 0);
  // The OPPOSITE side of the same disagreement Claude's row records as "refused".
  for (const doc of docs) assert.equal(doc.noPathDisposition, "passed-through");
});

test("fold-owned-loop: a record stamped with a NON-authoring phase is dropped", () => {
  // No leaf runs outside the two authoring slices, so a row claiming one would describe a slice
  // that never happened.
  const docs = sliceScopeDocs(
    IDS,
    ownedLoopScopeWalls({
      slices: [{ phase: "IMPLEMENT" }],
      violations: [{ phase: "CONFIRM_RED", tool: "write_file", path: "x.ts" }],
      noPathCalls: [{ phase: "GATE", tool: "write_file" }],
    }),
  );
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.phase, "IMPLEMENT");
  assert.equal(docs[0]?.refusals.length, 0);
  assert.equal(docs[0]?.noPathCalls, 0);
});

test("fold-codex: the no-path case is NOT-APPLICABLE, not silently reported as agreement", () => {
  const codex: CodexScopeSource = {
    runtime: "codex",
    runs: [{ phase: "IMPLEMENT" }],
    violations: [
      { phase: "IMPLEMENT", tool: "file_change", path: "elsewhere.ts", reason: "outside the replica", kind: "outside-workspace" },
    ],
  };
  const docs = sliceScopeDocs(IDS, liveAuthorScopeWalls(codex));
  assert.equal(docs[0]?.source, "codex-leaf");
  assert.equal(docs[0]?.noPathCalls, 0);
  // Codex reads a replica DIFF, never a tool input — so it cannot be in the disputed state at all.
  assert.equal(docs[0]?.noPathDisposition, "not-applicable");
});

test("fold-union: a refusal in a phase with NO recorded run still lands a row", () => {
  // A slice whose model died records no run; dropping its refusals would lose exactly the evidence
  // a fence refusal might have explained.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      claude(
        [{ phase: "IMPLEMENT", tool: "Write", path: "unit.test.ts", reason: "phase scope", kind: "scope" }],
        [{ phase: "AUTHOR_TEST" }],
      ),
    ),
  );
  assert.deepEqual(docs.map((d) => d.phase), ["AUTHOR_TEST", "IMPLEMENT"]);
  assert.equal(docs[1]?.refusals.length, 1);
});

test("fold-model: the coarse model label rides the row when the caller knows one", () => {
  const withModel = sliceScopeDocs({ ...IDS, model: "claude-sonnet-5" }, liveAuthorScopeWalls(claude([])));
  assert.equal(withModel[0]?.model, "claude-sonnet-5");
  assert.equal(sliceScopeDocs(IDS, liveAuthorScopeWalls(claude([])))[0]?.model, undefined);
});

test("append-slice-scope: every doc reaches the store, keyed one per slice", async () => {
  const store = new InMemoryStore();
  const report = ownedLoopScopeWalls({
    slices: [{ phase: "AUTHOR_TEST" }, { phase: "IMPLEMENT" }],
    violations: [],
    noPathCalls: [],
  });
  assert.equal(await appendSliceScope(store, IDS, report, "tester@storytree.invalid"), 2);
  const events = (await store.readEvents()).filter((e) => e.kind === "scope");
  assert.deepEqual(events.map((e) => e.id), [
    "scope:run-1:cap-x:AUTHOR_TEST",
    "scope:run-1:cap-x:IMPLEMENT",
  ]);
});

test("append-slice-scope: a failing store is ADVISORY — it warns and never throws", async () => {
  const warnings: string[] = [];
  const broken: ScopeEventSink = {
    async appendEvent(): Promise<never> {
      throw new Error("store down");
    },
  };
  const report: ScopeWallReport = {
    source: "sdk-leaf",
    slices: ["AUTHOR_TEST"],
    refusals: [],
    noPathCalls: [],
    noPathDisposition: "refused",
    toolSurfaceRefusals: [],
  };
  // A build that already proved (or honestly failed) its unit must not go red because an
  // observability row would not persist. The cost is fail-SILENT capture, which is why the wire
  // shape is strict and why the reading always names its denominator.
  const appended = await appendSliceScope(broken, IDS, report, "tester", (m) => warnings.push(m));
  assert.equal(appended, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /did not persist/);
});

// ── the pi leaf: a fourth mechanism, with a wall the other three do not have ──

test("fold-pi-silent: an armed pi slice banks a row with BOTH lists empty", () => {
  const docs = sliceScopeDocs(IDS, liveAuthorScopeWalls(pi([])));
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.source, "pi-leaf");
  assert.deepEqual(docs[0]?.refusals, []);
  assert.deepEqual(docs[0]?.toolSurfaceRefusals, []);
  // pi's fence fails closed on an unreadable path, exactly as the SDK hook does — so it declares
  // the SAME disposition, and the two are directly comparable against the owned loop's.
  assert.equal(docs[0]?.noPathDisposition, "refused");
});

test("fold-pi-tool-surface: a shell call is counted APART, never as a write-fence refusal", () => {
  // THE property this fold exists for. A `tool-surface` refusal resolved no path and compared
  // nothing against the phase predicate; folding it into `refusals` would inflate the one number
  // ADR-0446 exists to report with events that are not write-fence firings.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      pi([
        {
          phase: "AUTHOR_TEST",
          tool: "bash",
          path: "(no path)",
          reason: "refused: 'bash' is not on the authoring tool surface",
          kind: "tool-surface",
        },
        {
          phase: "AUTHOR_TEST",
          tool: "write",
          path: "impl.ts",
          reason: "phase scope",
          kind: "scope",
        },
      ]),
    ),
  );
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.refusals.length, 1, "only the scoped-path refusal counts as a refusal");
  assert.equal(docs[0]?.refusals[0]?.kind, "scope");
  assert.equal(docs[0]?.toolSurfaceRefusals.length, 1);
  assert.equal(docs[0]?.toolSurfaceRefusals[0]?.tool, "bash");
  // And it carries no path: there was never one to carry.
  assert.equal(Object.hasOwn(docs[0]?.toolSurfaceRefusals[0] ?? {}, "path"), false);
});

test("fold-pi-no-path: pi's disputed case rides the no-path count, like the SDK hook's", () => {
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      pi([
        {
          phase: "AUTHOR_TEST",
          tool: "write",
          path: "(no path)",
          reason: "no readable path",
          kind: "no-path",
        },
      ]),
    ),
  );
  assert.equal(docs.length, 1);
  assert.deepEqual(docs[0]?.refusals, []);
  assert.deepEqual(docs[0]?.toolSurfaceRefusals, []);
  assert.equal(docs[0]?.noPathCalls, 1);
});

test("fold-pi-union: a tool-surface refusal in a phase with NO recorded run still lands a row", () => {
  // The same union rule the other mechanisms get: a slice whose model then died records no run,
  // and dropping its refusals would lose exactly the evidence the refusal might have explained.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      pi(
        [
          {
            phase: "IMPLEMENT",
            tool: "powershell",
            path: "(no path)",
            reason: "not on the authoring tool surface",
            kind: "tool-surface",
          },
        ],
        [],
      ),
    ),
  );
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.phase, "IMPLEMENT");
  assert.equal(docs[0]?.toolSurfaceRefusals.length, 1);
});

test("fold-tool-surface: the three mechanisms WITHOUT that wall report an empty list, not a gap", () => {
  // A measured zero of a wall they do not have. The Claude leaf keeps Bash off `LEAF_TOOLS` but
  // has no handler-level allowlist to refuse at, the owned loop runs only spine-registered tools,
  // and Codex inspects no tool call at all.
  const claudeDocs = sliceScopeDocs(IDS, liveAuthorScopeWalls(claude([])));
  const codexDocs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls({
      runtime: "codex",
      runs: [{ phase: "AUTHOR_TEST" }],
      violations: [],
    } satisfies CodexScopeSource),
  );
  const ownedDocs = sliceScopeDocs(
    IDS,
    ownedLoopScopeWalls({
      slices: [{ phase: "AUTHOR_TEST" }],
      violations: [],
      noPathCalls: [],
    } satisfies OwnedLoopScopeSource),
  );
  for (const docs of [claudeDocs, codexDocs, ownedDocs]) {
    assert.equal(docs.length, 1);
    assert.deepEqual(docs[0]?.toolSurfaceRefusals, []);
  }
});

test("append-slice-scope: a pi slice's row reaches the store and parses on the way out", async () => {
  // The wire shape is `.strict()` and capture is fail-SILENT, so a field emitted but not admitted
  // stops the whole stream persisting with nothing going red (the ModelTokenUsage scar). This
  // asserts the pi row actually lands rather than being warned about.
  const store = new InMemoryStore();
  const warnings: string[] = [];
  const appended = await appendSliceScope(
    store,
    IDS,
    liveAuthorScopeWalls(
      pi([
        {
          phase: "AUTHOR_TEST",
          tool: "bash",
          path: "(no path)",
          reason: "not on the authoring tool surface",
          kind: "tool-surface",
        },
      ]),
    ),
    "tester",
    (m) => warnings.push(m),
  );
  assert.equal(appended, 1);
  assert.deepEqual(warnings, [], "a pi row must persist, not be swallowed by a validation warning");
});

// ── ADR-0589 D2: a helper write refusal is NOT a write-fence firing ──────────

test("fold-claude-helper: a helper refusal is never counted as a scoped refusal", () => {
  // It carries no path (it is refused before one is read), so admitting it to `refusals` would
  // force a fabricated `path` onto a required field and inflate every "how often did the write
  // fence fire?" reading — the exact harm `ScopeToolSurfaceRefusal` was given its own field for.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      claude([
        {
          phase: "AUTHOR_TEST",
          tool: "Write",
          path: "(helper)",
          reason: "write refused: 'Write' came from helper agent 'agent-7'",
          kind: "helper",
        },
      ]),
    ),
  );

  assert.equal(docs.length, 1, "the armed slice still banks its row");
  assert.deepEqual(docs[0]?.refusals, [], "the write fence did not fire");
  assert.equal(docs[0]?.noPathCalls, 0, "nor is it the disputed no-path case");
  assert.deepEqual(docs[0]?.toolSurfaceRefusals, [], "nor a tool-surface refusal — Write IS on the surface");
});

test("fold-claude-helper: a REAL scope refusal in the same slice is still carried", () => {
  // The control arm: without it, a fold that dropped EVERY violation would pass the test above.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      claude([
        { phase: "AUTHOR_TEST", tool: "Write", path: "(helper)", reason: "helper", kind: "helper" },
        { phase: "AUTHOR_TEST", tool: "Write", path: "impl.cjs", reason: "out of scope", kind: "scope" },
      ]),
    ),
  );

  assert.deepEqual(docs[0]?.refusals, [
    { kind: "scope", tool: "Write", path: "impl.cjs", reason: "out of scope" },
  ]);
});

test("fold-claude-helper: a slice reached ONLY by a helper refusal is not invented into existence", () => {
  // `sliceScopeDocs` derives its phase list partly from the refusals themselves. A helper refusal
  // in a phase the leaf never ran must not conjure a row claiming that phase's wall was armed.
  const docs = sliceScopeDocs(
    IDS,
    liveAuthorScopeWalls(
      claude(
        [{ phase: "IMPLEMENT", tool: "Write", path: "(helper)", reason: "helper", kind: "helper" }],
        [{ phase: "AUTHOR_TEST" }],
      ),
    ),
  );

  assert.deepEqual(
    docs.map((d) => d.phase),
    ["AUTHOR_TEST"],
    "only the slice that actually ran banks a row",
  );
});
