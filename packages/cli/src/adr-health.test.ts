import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type AdrMeta } from "@storytree/drive";

import {
  adrHealth,
  adrGateFailures,
  extractPathTokens,
  loadStoryDecisions,
  ADR_GATE_CHECKS,
  AUTHORITY_FLOOR,
  type GuardrailView,
  RETIRED_ADR_CHECKS,
  type AdrHealthInputs,
  type StoryDecisionsView,
} from "./adr-health.js";

/**
 * THE REAL-CORPUS CASE LIVES IN `check-adr-health.ts` NOW, not here (ADR-0403 dec 1).
 *
 * This file used to end with a REPO gate: it loaded every `docs/decisions/**` file and asserted the
 * GATE-class checks were clean on the actual corpus, which is what made `pnpm -r test` the ADR-0022
 * enforcement surface for decisions. The decision log is a database now, and `pnpm -r test` is
 * deliberately credential-free (ADR-0302 D3) — so that case could not stay: a suite dialling the
 * store stops being hermetic, and a DB outage would read as a unit-test failure. It moved to a
 * `check:*` rung, which ADR-0307 D4 permits to hold a connection.
 *
 * What stayed is everything that was ever really being proven here: each rung's LOGIC, against
 * literals, with no store and no filesystem.
 */

function adr(number: number, status: AdrMeta["status"], edges?: Partial<AdrMeta>): AdrMeta {
  return {
    number,
    file: `${String(number).padStart(4, "0")}-x.md`,
    status,
    supersedes: [],
    loadBearing: false,
    ...edges,
  };
}

function inputs(partial: Partial<AdrHealthInputs>): AdrHealthInputs {
  return {
    adrs: [],
    parseErrors: [],
    stories: [],
    guardrails: [],
    // A single decision with a clean body: the default must be a corpus the blind-read floor
    // considers READ, so a rung-8 FAIL in any test below is the link it was handed, never the
    // absence of a view.
    decisionBodies: [{ number: 1, body: "no links here" }],
    // Empty is the CLEAN default here, unlike its neighbour above, because `authority-declared` is
    // floored at ADR-0519 and every fixture in this file numbers well below it. A test that means to
    // exercise the rung says so by supplying both a high-numbered decision and this view.
    decisionAuthorities: [],
    pathExists: () => true,
    ...partial,
  };
}

function levelOf(results: ReturnType<typeof adrHealth>, name: string): string | undefined {
  return results.find((r) => r.name === name)?.level;
}

// --- (a) pure-check tests ------------------------------------------------------------------------

test("adr-frontmatter: parse errors FAIL, a clean load PASSes", () => {
  assert.equal(levelOf(adrHealth(inputs({})), "adr-frontmatter"), "PASS");
  assert.equal(
    levelOf(adrHealth(inputs({ parseErrors: ["0099-x.md: no frontmatter block"] })), "adr-frontmatter"),
    "FAIL",
  );
});

test("adr-edge-integrity: a dangling edge target FAILs", () => {
  const ok = adrHealth(inputs({ adrs: [adr(1, "accepted"), adr(2, "accepted", { supersedes: [1] })] }));
  assert.equal(levelOf(ok, "adr-edge-integrity"), "PASS");
  const bad = adrHealth(inputs({ adrs: [adr(2, "accepted", { supersedes: [99] })] }));
  assert.equal(levelOf(bad, "adr-edge-integrity"), "FAIL");
});

test("story-decisions: dangling or superseded deciding ADRs FAIL", () => {
  const story = (decisions: number[]): StoryDecisionsView => ({ id: "s", status: "proposed", decisions });
  const adrs = [adr(14, "superseded"), adr(27, "accepted", { supersedes: [14] })];
  assert.equal(levelOf(adrHealth(inputs({ adrs, stories: [story([27])] })), "story-decisions"), "PASS");
  assert.equal(levelOf(adrHealth(inputs({ adrs, stories: [story([99])] })), "story-decisions"), "FAIL");
  assert.equal(levelOf(adrHealth(inputs({ adrs, stories: [story([14])] })), "story-decisions"), "FAIL");
});

test("green-flip: a healthy story on a proposed ADR FAILs; non-healthy stories never fire", () => {
  const adrs = [adr(33, "proposed")];
  const healthy: StoryDecisionsView = { id: "s", status: "healthy", decisions: [33] };
  const building: StoryDecisionsView = { id: "s", status: "building", decisions: [33] };
  assert.equal(levelOf(adrHealth(inputs({ adrs, stories: [healthy] })), "green-flip"), "FAIL");
  assert.equal(levelOf(adrHealth(inputs({ adrs, stories: [building] })), "green-flip"), "PASS");
});

test("load-bearing-live: a load_bearing ADR must be accepted (proposed/superseded FAIL)", () => {
  // accepted + load_bearing -> PASS
  const ok = adrHealth(inputs({ adrs: [adr(19, "accepted", { loadBearing: true })] }));
  assert.equal(levelOf(ok, "load-bearing-live"), "PASS");
  // proposed + load_bearing -> FAIL (and it gates)
  const tooEarly = adrHealth(inputs({ adrs: [adr(86, "proposed", { loadBearing: true })] }));
  assert.equal(levelOf(tooEarly, "load-bearing-live"), "FAIL");
  assert.ok(adrGateFailures(tooEarly).some((r) => r.name === "load-bearing-live"));
  // superseded + load_bearing -> FAIL (a dead ADR can't be current-state)
  const dead = adrHealth(
    inputs({ adrs: [adr(14, "superseded", { loadBearing: true }), adr(27, "accepted", { supersedes: [14] })] }),
  );
  assert.equal(levelOf(dead, "load-bearing-live"), "FAIL");
});

test("enforced-by-anchors: a dangling path token WARNs (never FAILs)", () => {
  const guardrail: GuardrailView = {
    id: "g",
    enforcedBy: "A rule: `packages/agent` may import, see `packages/gone/file.ts:1-9`.",
  };
  const results = adrHealth(
    inputs({ guardrails: [guardrail], pathExists: (p) => p === "packages/agent" }),
  );
  assert.equal(levelOf(results, "enforced-by-anchors"), "WARN");
  assert.deepEqual(adrGateFailures(results), [], "a WARN never gates");
});

test("extractPathTokens: backticked repo paths only, line suffixes dropped", () => {
  const tokens = extractPathTokens(
    "see `packages/cli/src/health.ts:84-102` and `apps/studio` but not prose/paths or `claim-conflict-refused`",
  );
  assert.deepEqual(tokens, ["packages/cli/src/health.ts", "apps/studio"]);
});

// --- (b) the REAL-repo gate (this is the ADR-0022 enforcement surface) --------------------------

// --- (c) loadRetiredInPartEdges (the raw frontmatter scan behind the gate) ----------------------

test("the three rungs that retired with the files are DECLARED, not silently dropped", () => {
  // A retired check leaving no record reads later as a check nobody thought to write. Each entry
  // names WHY, and the two sets must not overlap: a rung cannot be both live and retired.
  for (const name of ["adr-number-unique", "supersedes-in-part-retired", "adr-link-integrity"]) {
    assert.ok(RETIRED_ADR_CHECKS.has(name), `${name} must be declared as retired`);
    assert.equal(ADR_GATE_CHECKS.has(name), false, `${name} must not still gate`);
    assert.ok(
      (RETIRED_ADR_CHECKS.get(name) ?? "").length > 30,
      `${name}'s retirement must say why, not just that it happened`,
    );
  }
});

test("the three rungs ADR-0609 retired are DECLARED and no longer emitted: their copies are not stored", () => {
  // Each held a stored copy of a derivable fact against its source. The copies are gone (the write
  // boundary strips them), so the rungs asked a question nothing can make false — declared here with
  // the reason, and absent from the emitted set so no caller wires an input for them again.
  const emitted = new Set(adrHealth(inputs({})).map((r) => r.name));
  for (const name of ["adr-number-identity", "adr-description-identity", "supersede-consistency"]) {
    assert.match(RETIRED_ADR_CHECKS.get(name) ?? "", /ADR-0609/, `${name} must name the decision retiring it`);
    assert.equal(ADR_GATE_CHECKS.has(name), false, `${name} must not still gate`);
    assert.equal(emitted.has(name), false, `${name} must not still be emitted`);
  }
});

test("every GATE-class rung the checks emit is declared in ADR_GATE_CHECKS, and vice versa", () => {
  // The anti-vacuity pairing: a rung emitted but undeclared never gates (a silent downgrade), and a
  // rung declared but never emitted is a carve-out for something that no longer runs.
  const emitted = new Set(adrHealth(inputs({})).map((r) => r.name));
  for (const declared of ADR_GATE_CHECKS) {
    assert.ok(emitted.has(declared), `${declared} is declared as gating but is never emitted`);
  }
  const warnOnly = new Set(["enforced-by-anchors"]);
  for (const name of emitted) {
    if (warnOnly.has(name)) continue;
    assert.ok(ADR_GATE_CHECKS.has(name), `${name} is emitted but gates nothing — declare or retire it`);
  }
});

// --- 8 adr-body-links ----------------------------------------------------------------------------

test("adr-body-links: a clean body PASSes, a body linking a decision FILE FAILs", () => {
  assert.equal(
    levelOf(
      adrHealth(inputs({ decisionBodies: [{ number: 12, body: "ADR-0139 decides this." }] })),
      "adr-body-links",
    ),
    "PASS",
  );
  // The mutation: the SAME body with the number wrapped as a link to the deleted file must go RED.
  // Without this pair the rung could report PASS over any input and nothing would say so.
  const results = adrHealth(
    inputs({
      decisionBodies: [{ number: 12, body: "[ADR-0139](0139-the-accepted-adr-set.md) decides this." }],
    }),
  );
  assert.equal(levelOf(results, "adr-body-links"), "FAIL");
  const line = results.find((r) => r.name === "adr-body-links")?.lines[0] ?? "";
  assert.match(line, /ADR-0012 body links to ADR-0139/);
  assert.match(line, /storytree library artifact adr-0139/);
});

test("adr-body-links: it GATES — a dead link is a gate failure, not a warning", () => {
  const results = adrHealth(
    inputs({
      adrs: [adr(12, "accepted")],
      decisionBodies: [{ number: 12, body: "see [ADR-0139](0139-x.md)" }],
    }),
  );
  assert.ok(adrGateFailures(results).some((r) => r.name === "adr-body-links"));
});

test("adr-body-links: an UNWIRED bodies view FAILs rather than passing vacuously", () => {
  // Zero bodies alongside loaded decisions means the caller wired no view — the shape that reports
  // PASS having examined nothing.
  const results = adrHealth(inputs({ adrs: [adr(12, "accepted")], decisionBodies: [] }));
  assert.equal(levelOf(results, "adr-body-links"), "FAIL");
  assert.match(results.find((r) => r.name === "adr-body-links")?.lines[0] ?? "", /verified NOTHING/);
  // But an empty corpus with no decisions at all is not this rung's complaint to make.
  assert.equal(levelOf(adrHealth(inputs({ adrs: [], decisionBodies: [] })), "adr-body-links"), "PASS");
});

test("adr-body-links: every dead link is reported, not just the first", () => {
  const results = adrHealth(
    inputs({
      decisionBodies: [
        { number: 12, body: "[ADR-0139](0139-a.md) and [0145](0145-b.md)" },
        { number: 13, body: "[the bar](0097-c.md)" },
      ],
    }),
  );
  assert.equal(results.find((r) => r.name === "adr-body-links")?.lines.length, 3);
});

// ─── 6b authority-declared (ADR-0519 D4) ──────────────────────────────────────────────────────

test("authority-declared: an accepted decision at or above the floor must declare a basis", () => {
  const stamped = adrHealth(
    inputs({
      adrs: [adr(AUTHORITY_FLOOR, "accepted")],
      decisionAuthorities: [{ number: AUTHORITY_FLOOR, declared: true }],
    }),
  );
  assert.equal(levelOf(stamped, "authority-declared"), "PASS");

  const bare = adrHealth(
    inputs({
      adrs: [adr(AUTHORITY_FLOOR, "accepted")],
      decisionAuthorities: [{ number: AUTHORITY_FLOOR, declared: false }],
    }),
  );
  assert.equal(levelOf(bare, "authority-declared"), "FAIL");
  assert.ok(adrGateFailures(bare).some((r) => r.name === "authority-declared"), "it must GATE");
});

test("authority-declared: the floor includes the decision that created the field, and excludes what precedes it", () => {
  // ADR-0519 D5 leaves 206 earlier rows unstamped BY DECISION, so a rung with no floor would be
  // permanently red on records that are correct as they stand.
  const below = adrHealth(
    inputs({
      adrs: [adr(AUTHORITY_FLOOR - 1, "accepted"), adr(1, "accepted")],
      decisionAuthorities: [],
    }),
  );
  assert.equal(levelOf(below, "authority-declared"), "PASS");

  const atFloor = adrHealth(inputs({ adrs: [adr(AUTHORITY_FLOOR, "accepted")], decisionAuthorities: [] }));
  assert.equal(levelOf(atFloor, "authority-declared"), "FAIL");
});

test("authority-declared: only ACCEPTED decisions are in scope", () => {
  // A proposed decision is still being written and may not have reached the question yet; a
  // superseded one is dead. Neither is a record anyone calibrates on.
  for (const status of ["proposed", "superseded"] as const) {
    const r = adrHealth(inputs({ adrs: [adr(AUTHORITY_FLOOR + 5, status)], decisionAuthorities: [] }));
    assert.equal(levelOf(r, "authority-declared"), "PASS", `${status} must be out of scope`);
  }
});

test("authority-declared: a MALFORMED stamp is undeclared — the view carries the fact, not the key", () => {
  // The projection `safeParse`s, so `declared: false` is what an unparseable stamp yields. A rung
  // that accepted it would certify a shape nothing had checked, which is the vacuous green.
  const r = adrHealth(
    inputs({
      adrs: [adr(AUTHORITY_FLOOR, "accepted")],
      decisionAuthorities: [{ number: AUTHORITY_FLOOR, declared: false }],
    }),
  );
  assert.equal(levelOf(r, "authority-declared"), "FAIL");
});

test("authority-declared: an UNWIRED view fails loud rather than passing vacuously", () => {
  // The direction that matters: a caller who forgets the input yields an empty set, so every
  // in-scope decision reports undeclared and the rung REDS. The opposite default would be a rung
  // reporting PASS having examined nothing.
  const r = adrHealth(inputs({ adrs: [adr(AUTHORITY_FLOOR + 1, "accepted")], decisionAuthorities: [] }));
  assert.equal(levelOf(r, "authority-declared"), "FAIL");
});

test("authority-declared: the FAIL names the verb and the honest weaker basis, never a stronger one", () => {
  // Asserted WHOLE. The message is three `+`-concatenated segments, each its own literal, so a regex
  // matching one leaves the others unheld — and for the LAST segment that is the very sentence
  // keeping the rung's cheapest compliance the WEAKER claim (`agent-derived`). That asymmetry is what
  // separates this rung from the presence check ADR-0427 deleted, so it is load-bearing, not prose.
  const r = adrHealth(
    inputs({ adrs: [adr(AUTHORITY_FLOOR, "accepted")], decisionAuthorities: [{ number: AUTHORITY_FLOOR, declared: false }] }),
  );
  assert.deepEqual(r.find((c) => c.name === "authority-declared")?.lines ?? [], [
    "ADR-0519 is accepted and declares no authority basis (ADR-0519 D1). " +
      "Stamp it: `storytree adr authority 519 --basis <b> [--owner-said <text|@file>] --pg`. " +
      "With no directive to quote, the honest basis is `agent-derived`.",
  ]);
});

test("authority-declared: the clean note states the FLOOR, so a green says what it covered", () => {
  // A PASS line reading only "ok" would hide that ~206 accepted decisions are out of scope BY
  // DECISION (ADR-0519 D5) — which is the one thing a reader of this green needs to know.
  const r = adrHealth(
    inputs({
      adrs: [adr(AUTHORITY_FLOOR, "accepted")],
      decisionAuthorities: [{ number: AUTHORITY_FLOOR, declared: true }],
    }),
  );
  assert.deepEqual(r.find((c) => c.name === "authority-declared")?.lines ?? [], [
    "every accepted decision from ADR-0519 onward declares a basis",
  ]);
});
