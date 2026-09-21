/**
 * `storytree context` — the render, and the two refusals around it (`linked-session-context-arc`,
 * increment `hand-a-running-session-its-own-occupancy`).
 *
 * The FOLD is proved next door, over real transcript bytes
 * (`packages/context-traversal-transcript/src/context-windows.test.ts`). What is proved HERE is the
 * half this file actually owns: that the identity refusal fires in the lobby, that the harness's
 * window id is passed through as a selector, and — the load-bearing one — that an ABSENCE renders as
 * an absence. A session handed "0 tokens resident" when the truth is "I could not read your window"
 * takes on work it has no room for, which is the exact failure ADR-0411 D6 exists to prevent, so the
 * absence render is pinned on its own words rather than on the envelope's `ok`.
 */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type {
  CodexContextWindowRead,
  OwnWindowArgs,
  OwnWindowOccupancy,
  OwnWindowRead,
  WindowComposition,
} from "@storytree/context-traversal-transcript";

import { contextCommand, contextHelp, defaultContextDeps, type ContextDeps } from "./context.js";

const NOW = Date.parse("2026-08-26T12:00:00Z");

function occupancy(overrides: Partial<OwnWindowOccupancy> = {}): OwnWindowOccupancy {
  return {
    windowId: "a2e1e82e-b05c-432d-84e6-19440160bf5f",
    file: "/tmp/projects/slug/a2e1e82e-b05c-432d-84e6-19440160bf5f.jsonl",
    residentTokens: 225_013,
    peakTokens: 225_013,
    observationCount: 54,
    syntheticObservations: 0,
    modelId: "claude-opus-5",
    lastObservedAt: "2026-08-26T11:58:00Z",
    lastWrittenAt: "2026-08-26T11:58:00Z",
    ...overrides,
  };
}

function reading(overrides: Partial<OwnWindowRead> = {}): OwnWindowRead {
  return {
    sessionId: "angry-hopper-092898",
    scan: { root: "/tmp/projects", windowFilesFound: 3219, windowFilesRead: 60, candidateLimit: 60, correlatedWindows: 4 },
    window: occupancy(),
    band: "calm",
    absence: null,
    selectedBy: "harness-window-id",
    harnessWindowUnmatched: false,
    ...overrides,
  };
}

/** A composition shaped like the ones measured on this machine: tool output dominant, guidance unlabelled. */
function composition(overrides: Partial<WindowComposition> = {}): WindowComposition {
  return {
    file: "/tmp/projects/slug/a2e1e82e-b05c-432d-84e6-19440160bf5f.jsonl",
    windowId: "a2e1e82e-b05c-432d-84e6-19440160bf5f",
    slices: [
      { category: "tool-output", bytes: 612_000, records: 140 },
      { category: "tool-calls", bytes: 180_000, records: 140 },
      { category: "harness-reminder", bytes: 90_000, records: 300 },
      { category: "assistant-text", bytes: 60_000, records: 20 },
      { category: "human-prompt", bytes: 8_000, records: 1 },
    ],
    accountedBytes: 950_000,
    // ADR-0524's SECOND cut. `storytree context` renders the record-type slices above and reads none
    // of these — the bar in the studio panel is their only consumer — so the fixture states them as
    // empty rather than inventing traffic this reader would never look at.
    toolSubjects: [],
    otherToolNames: [],
    knowledgeSurfaces: [],
    unclassifiedLabels: [],
    bookkeeping: { bytes: 4_000, records: 6, kinds: ["last-prompt", "queue-operation"] },
    sidechainLinesExcluded: 0,
    unparseableLines: 0,
    nonRecordLines: 0,
    residual: {
      firstRequestResidentTokens: 106_000,
      visibleBytesBeforeFirstRequest: 50_089,
      visibleTokensEstimate: 13_182,
      residualTokens: 92_818,
      charsPerToken: 3.8,
    },
    residualAbsence: null,
    ...overrides,
  };
}

function deps(overrides: Partial<ContextDeps> = {}): ContextDeps {
  return {
    sessionId: () => "angry-hopper-092898",
    env: {},
    codexSessionsRoot: () => "/tmp/codex/sessions",
    readCodex: () => codexReading(),
    read: () => reading(),
    composition: () => composition(),
    now: () => NOW,
    ...overrides,
  };
}

function codexReading(
  overrides: Partial<Extract<CodexContextWindowRead, { status: "available" }>> = {},
): CodexContextWindowRead {
  return {
    status: "available",
    threadId: "0198de4f-codex-thread",
    usageSource: "token_usage_record",
    residentInputTokens: 167_204,
    peakInputTokens: 234_228,
    modelContextWindow: { status: "available", tokens: 258_400 },
    composition: { status: "unavailable", reason: "not-exposed" },
    schedulingBand: { status: "unavailable", reason: "policy-unsettled" },
    ...overrides,
  };
}

test("the default Codex rollout root is the current user's .codex sessions tree", () => {
  assert.equal(defaultContextDeps().codexSessionsRoot(), path.join(os.homedir(), ".codex", "sessions"));
});

test("a Codex task is read by exact thread identity even in the primary checkout", () => {
  let claudeReads = 0;
  let compositions = 0;
  const calls: Array<{ root: string; env: Readonly<Record<string, string | undefined>> }> = [];
  const env = contextCommand(
    deps({
      sessionId: () => {
        throw new Error("Codex selection must happen before Storytree worktree identity");
      },
      env: { CODEX_THREAD_ID: " 0198de4f-codex-thread ", CODEX_SESSION_ID: "parent-thread" },
      codexSessionsRoot: () => "/users/operator/.codex/sessions",
      readCodex: (root, identity) => {
        calls.push({ root, env: identity });
        return codexReading();
      },
      read: () => {
        claudeReads++;
        return reading();
      },
      composition: () => {
        compositions++;
        return composition();
      },
    }),
  );

  assert.equal(env.ok, true);
  assert.deepEqual(calls, [
    {
      root: "/users/operator/.codex/sessions",
      env: { CODEX_THREAD_ID: " 0198de4f-codex-thread ", CODEX_SESSION_ID: "parent-thread" },
    },
  ]);
  assert.equal(claudeReads, 0);
  assert.equal(compositions, 0);
  assert.match(env.body, /Codex task "0198de4f-codex-thread"/);
  assert.match(env.body, /resident:\s+167,204 tokens/);
  assert.match(env.body, /peak:\s+234,228 tokens/);
  assert.match(env.body, /usage source:\s+token_usage_record/);
  assert.match(env.body, /capacity:\s+258,400 tokens .*declared by Codex/i);
  assert.match(env.body, /composition:\s+UNAVAILABLE .*not exposed/i);
  assert.match(env.body, /scheduling band:\s+UNAVAILABLE .*policy is unsettled/i);
  assert.ok(!/\b(?:CALM|SOFT|HARD)\b/.test(env.body), env.body);
  assert.ok(!/700k|850k/.test(env.body), env.body);
  assert.deepEqual(env, {
    ok: true,
    body: [
      'storytree context — Codex task "0198de4f-codex-thread"',
      "",
      "  resident:          167,204 tokens",
      "  peak:              234,228 tokens",
      "  usage source:      token_usage_record",
      "  capacity:          258,400 tokens (declared by Codex)",
      "  composition:       UNAVAILABLE — Codex usage metadata does not expose what fills the window (not exposed)",
      "  scheduling band:   UNAVAILABLE — the Codex continuation policy is unsettled (policy unsettled)",
      "  root:              /users/operator/.codex/sessions",
      "",
      "This is the exact task's raw, read-only occupancy. It makes no scheduling judgment.",
    ].join("\n"),
    next: ["storytree arc show <arc-id> --pg", "storytree own"],
  });
});

test("Codex keeps usable occupancy when the rollout declares no model capacity", () => {
  const env = contextCommand(
    deps({
      env: { CODEX_THREAD_ID: "0198de4f-codex-thread" },
      readCodex: () => codexReading({ modelContextWindow: { status: "unavailable", reason: "not-declared" } }),
    }),
  );

  assert.equal(env.ok, true);
  assert.match(env.body, /resident:\s+167,204 tokens/);
  assert.match(env.body, /capacity:\s+UNAVAILABLE .*not declare/i);
  assert.match(env.body, /not a zero/i);
  assert.ok(!/capacity:\s+0\b/.test(env.body), env.body);
});

test("Codex identity, rollout and usage absences render as three honest NO READING outcomes", () => {
  const cases: ReadonlyArray<{
    reason: Extract<CodexContextWindowRead, { status: "unavailable" }>["reason"];
    message: RegExp;
    explanation: readonly [string, string];
  }> = [
    {
      reason: "identity-unavailable",
      message: /CODEX_THREAD_ID was unavailable/,
      explanation: [
        "CODEX_THREAD_ID was unavailable to the reader, so no rollout can be attributed to this task.",
        "The current Codex task is identified only by that exact harness-provided value.",
      ],
    },
    {
      reason: "rollout-unavailable",
      message: /No single rollout exactly identified this Codex task/,
      explanation: [
        "No single rollout exactly identified this Codex task.",
        "A filename, working directory, parent session or newest-file guess is not a task identity.",
      ],
    },
    {
      reason: "usage-unavailable",
      message: /exact rollout was found but it carried no usable input-token usage/,
      explanation: [
        "The exact rollout was found but it carried no usable input-token usage.",
        "Malformed or missing usage metadata is an absence, not an empty context window.",
      ],
    },
  ];

  for (const current of cases) {
    const env = contextCommand(
      deps({
        env: { CODEX_THREAD_ID: "0198de4f-codex-thread" },
        readCodex: () => ({ status: "unavailable", reason: current.reason }),
      }),
    );
    assert.equal(env.ok, true);
    assert.match(env.body, /NO READING/);
    assert.match(env.body, current.message);
    assert.match(env.body, /not a zero/i);
    assert.ok(!/resident:\s*0\b/.test(env.body), env.body);
    assert.ok(!/\b(?:CALM|SOFT|HARD)\b|700k|850k/.test(env.body), env.body);
    assert.deepEqual(env, {
      ok: true,
      body: [
        'storytree context — NO READING for Codex task "0198de4f-codex-thread", and that is not a zero.',
        "",
        ...current.explanation,
        "",
        `  reason:     ${current.reason}`,
        "  root:       /tmp/codex/sessions",
        "",
        "No occupancy, capacity, composition or scheduling conclusion is inferred from this absence.",
      ].join("\n"),
      next: ["storytree context", "storytree own"],
    });
  }
});

test("the primary checkout is refused, and the refusal says why a guess would be worse", () => {
  const env = contextCommand(deps({ sessionId: () => null }));
  const blankCodexIdentity = contextCommand(
    deps({ sessionId: () => null, env: { CODEX_THREAD_ID: "   " } }),
  );

  assert.equal(env.ok, false);
  assert.deepEqual(blankCodexIdentity, env, "a blank Codex identity preserves the Claude flow byte-for-byte");
  assert.match(env.body, /needs a session identity/);
  // The reason has to be the SPECIFIC one, not a generic identity boilerplate: without a worktree
  // there is nothing for a recorded `cwd` to match, so any answer would be somebody else's window.
  assert.match(env.body, /working directory/i);
  assert.match(env.body, /somebody else's number/i);
});

test("a reading prints the figure, its band and D3's own marks", () => {
  const env = contextCommand(deps());

  assert.equal(env.ok, true);
  assert.match(env.body, /225,013 tokens/);
  assert.match(env.body, /CALM/);
  assert.match(env.body, /room for another increment/);
  assert.match(env.body, /soft ~700k · hard 850k/);
  assert.match(env.body, /a2e1e82e-b05c-432d-84e6-19440160bf5f/);
  // The caveat that stops a low number on a fan-out session reading as a broken instrument.
  assert.match(env.body, /ADR-0413 D2/);
  assert.match(env.body, /increment boundary/i);
});

test("each band is labelled and carries its own instruction", () => {
  const soft = contextCommand(deps({ read: () => reading({ window: occupancy({ residentTokens: 437_477 }), band: "soft" }) }));
  assert.match(soft.body, /SOFT MARK/);
  assert.match(soft.body, /no new increment/i);

  const hard = contextCommand(deps({ read: () => reading({ window: occupancy({ residentTokens: 512_000 }), band: "hard" }) }));
  assert.match(hard.body, /HARD MARK/);
  assert.match(hard.body, /fresh session continue/);
});

test("an ABSENCE renders as an absence, never as a zero, and routes to ADR-0411 D6", () => {
  const env = contextCommand(
    deps({ read: () => reading({ window: null, band: null, absence: "no-readable-occupancy", selectedBy: null }) }),
  );

  assert.equal(env.ok, true, "a truthful 'I could not read it' is the command working, not failing");
  assert.match(env.body, /NO READING/);
  assert.match(env.body, /not a zero/i);
  assert.match(env.body, /ADR-0411 D6/);
  assert.match(env.body, /estimated/i);
  // It must never print a token figure it does not have.
  assert.ok(!/resident:/.test(env.body), `an absence printed a resident figure:\n${env.body}`);
});

test("each absence reason sends the reader somewhere different", () => {
  const noRoot = contextCommand(deps({ read: () => reading({ window: null, band: null, absence: "no-transcript-root" }) }));
  assert.match(noRoot.body, /No session transcript exists/);

  const noneMine = contextCommand(
    deps({ read: () => reading({ window: null, band: null, absence: "no-correlated-window" }) }),
  );
  assert.match(noneMine.body, /worktree \(angry-hopper-092898\)/);
});

test("every render says WHERE it looked and how far, so an absence is not a bare 'not found'", () => {
  for (const read of [reading(), reading({ window: null, band: null, absence: "no-correlated-window" })]) {
    const env = contextCommand(deps({ read: () => read }));
    assert.match(env.body, /the 60 most recently written of 3219 session transcripts/);
    assert.match(env.body, /root:\s+\/tmp\/projects/);
  }
});

test("the harness window id is passed through as a selector, and a blank one is not", () => {
  const seen: OwnWindowArgs[] = [];
  const capture = (args: OwnWindowArgs): OwnWindowRead => {
    seen.push(args);
    return reading();
  };

  contextCommand(deps({ env: { CLAUDE_CODE_SESSION_ID: " a2e1e82e-b05c-432d-84e6-19440160bf5f " }, read: capture }));
  assert.equal(seen[0]?.harnessWindowId, "a2e1e82e-b05c-432d-84e6-19440160bf5f", "it must arrive trimmed");

  contextCommand(deps({ env: { CLAUDE_CODE_SESSION_ID: "   " }, read: capture }));
  assert.equal(seen[1]?.harnessWindowId, undefined, "a blank env var is no hint at all, not an empty-string hint");

  contextCommand(deps({ env: {}, read: capture }));
  assert.equal(seen[2]?.harnessWindowId, undefined);
  assert.equal(seen[2]?.sessionId, "angry-hopper-092898");
});

test("how the window was identified is stated — an unconfirmed pick never reads as a confirmed one", () => {
  // Each line is pinned WHOLE rather than probed for a word. The three differ by a shade of meaning
  // that a regex on "confirmed" cannot see — and the pair that matters most, `unconfirmed` and
  // `UNCONFIRMED`, differ only in case and in what the second half of the sentence claims.
  const confirmed = contextCommand(deps());
  assert.ok(
    confirmed.body.includes(
      "  identity:   confirmed — the harness named this window id and it is one of yours",
    ),
    `the confirmed identity line changed:\n${confirmed.body}`,
  );

  const unconfirmed = contextCommand(deps({ read: () => reading({ selectedBy: "latest-activity" }) }));
  assert.ok(
    unconfirmed.body.includes(
      "  identity:   unconfirmed — no harness window id here, so this is the most recently active window in your worktree",
    ),
    `the unconfirmed identity line changed:\n${unconfirmed.body}`,
  );

  const disagreed = contextCommand(
    deps({ read: () => reading({ selectedBy: "latest-activity", harnessWindowUnmatched: true }) }),
  );
  assert.ok(
    disagreed.body.includes(
      "  identity:   UNCONFIRMED — the harness named a window no transcript on this machine answers" +
        " to; this is the most recently active window in your worktree",
    ),
    `the UNCONFIRMED identity line changed:\n${disagreed.body}`,
  );
});

// ── the fresh worktree the merge ceremony mandates ───────────────────────────
//
// ADR-0275 D1 requires a fresh worktree the moment repo code is touched again, and ADR-0411 D5 has
// the session read its context at that same increment boundary. So the one moment this is certain to
// be asked is the one moment the worktree has written no transcript of its own. The fold resolves it
// by the harness's own window id (`context-verb-resolves-the-session-not-just-the-worktree`); what is
// proved HERE is that the render says so, and does not present a confirmed identity as a doubt.

test("a reading carried in from another worktree is CONFIRMED, and says which question it answered", () => {
  const env = contextCommand(deps({ read: () => reading({ selectedBy: "harness-window-id-elsewhere" }) }));

  assert.ok(
    env.body.includes(
      "  identity:   confirmed — the harness named this window id. Nothing in the worktree you ran" +
        " this from wrote it, so the reading follows your SESSION rather than this directory (a" +
        " worktree you stood up mid-run has written no transcript of its own yet)",
    ),
    `the elsewhere arm did not render its own identity line:\n${env.body}`,
  );
  assert.ok(!/UNCONFIRMED/.test(env.body), "the harness named this window — presenting that as a doubt is the defect");
  assert.match(env.body, /resident:\s+225,013 tokens/, "and it is a real reading, not an absence");
});

test("the no-correlated-window absence names WHICH routes were tried, and they are different states", () => {
  const blind = contextCommand(
    deps({
      read: () => reading({ window: null, band: null, absence: "no-correlated-window", selectedBy: null }),
    }),
  );
  assert.ok(
    blind.body.includes(
      [
        "None of the transcripts read was written inside this worktree (angry-hopper-092898).",
        "This harness named no window id, so the worktree was the only route available, and a",
        "worktree that has written no transcript of its own has nothing to match a `cwd` on.",
        "Either the bound below did not reach your window, or this harness writes them elsewhere.",
      ].join("\n"),
    ),
    `the no-hint absence did not say the worktree was the only route:\n${blind.body}`,
  );

  const unmatched = contextCommand(
    deps({
      read: () =>
        reading({
          window: null,
          band: null,
          absence: "no-correlated-window",
          selectedBy: null,
          harnessWindowUnmatched: true,
        }),
    }),
  );
  assert.ok(
    unmatched.body.includes(
      [
        "None of the transcripts read was written inside this worktree (angry-hopper-092898).",
        "The harness named a window id for this process, and no transcript on this machine",
        "answers to it — so neither route reached your window: not the worktree, not the name.",
        "Either the bound below did not reach your window, or this harness writes them elsewhere.",
      ].join("\n"),
    ),
    `the unmatched absence did not say the NAME route failed too:\n${unmatched.body}`,
  );
});

test("the compaction note appears only when peak actually exceeds the current reading", () => {
  const flat = contextCommand(deps());
  assert.ok(!/COMPACTED/.test(flat.body), "the note is noise on the common case where the two figures agree");

  const compacted = contextCommand(
    deps({ read: () => reading({ window: occupancy({ residentTokens: 120_000, peakTokens: 460_000 }) }) }),
  );
  assert.match(compacted.body, /COMPACTED/);
  assert.match(compacted.body, /ADR-0248 D1/);
});

test("the synthetic exclusion is reported when it bit, and silent when it did not", () => {
  const none = contextCommand(deps());
  assert.ok(!/synthetic/.test(none.body));

  const one = contextCommand(deps({ read: () => reading({ window: occupancy({ syntheticObservations: 1 }) }) }));
  assert.match(one.body, /1 synthetic reading excluded/);

  const many = contextCommand(deps({ read: () => reading({ window: occupancy({ syntheticObservations: 3 }) }) }));
  assert.match(many.body, /3 synthetic readings excluded/);
});

test("help distinguishes Claude's scheduled composition reading from Codex's raw occupancy", () => {
  const env = contextHelp();

  assert.equal(env.ok, true);
  assert.match(env.body, /Claude transcript path\s+resident tokens, peak, its current band — and what it is made of,\n/);
  assert.match(env.body, /Codex rollout path\s+raw resident tokens, peak, usage source and declared model capacity;\n/);
  assert.match(env.body, /composition and scheduling band are explicitly UNAVAILABLE/);
  assert.match(env.body, /Those marks and that band are Claude-only/);
  assert.match(env.body, /Codex selects its exact rollout by CODEX_THREAD_ID/);
  assert.match(env.body, /scheduling policy is unsettled/);
  assert.match(env.body, /neither a band nor the Claude ~700k\/850k\nmarks are applied to a Codex reading/);
  assert.match(env.body, /On the Claude path, the `made of:` block splits the window's INTAKE by the labels the harness itself puts on each\n/);
  assert.match(env.body, /record \(ADR-0516 D3 — labels and lengths, never content\), in bytes \(ADR-0330 D1's unit\)\. The\n/);
  assert.match(env.body, /`unseen:` line is the harness's own preamble — system prompt and tool definitions — which no\n/);
  assert.match(env.body, /transcript records and which can only be shown as what was resident at the first request minus\n/);
  assert.match(env.body, /what the transcript accounts for \(D4\)\. It is reported as an unknown quantity, never omitted and\n/);
  assert.match(env.body, /never zero\. The `remedy:` line names the one lever the dominant class leaves this session\.\n\nOffline and read-only/);
  assert.match(env.body, /~700k/);
  assert.match(env.body, /850k/);
  assert.match(env.body, /never enforces/i);
  assert.match(env.body, /ESTIMATED/);
  assert.deepEqual(env, {
    ok: true,
    body: [
      "storytree context — how full is THIS session's own context window? (ADR-0411 D3/D6)",
      "",
      "  Claude transcript path   resident tokens, peak, its current band — and what it is made of,",
      "                           by the harness's own labels, with a remedy",
      "  Codex rollout path       raw resident tokens, peak, usage source and declared model capacity;",
      "                           composition and scheduling band are explicitly UNAVAILABLE",
      "",
      "On Claude, run it at an INCREMENT BOUNDARY, before deciding whether to take on the next one —",
      "that is what ADR-0411 D5 makes it, a scheduling read rather than an interruption. Past the soft mark",
      "(~700k) take on no NEW increment; at the hard mark (850k) land what is green, write",
      "the handover onto the owning arc, release your claims, and let a fresh session continue.",
      "",
      "The marks govern whether you take the NEXT unit, never how carefully you do THIS one. If finishing the unit in hand properly crosses a mark, cross it — that is the expected case, not a failure. Below the soft mark there is no economy to practise, and economising on the very artifact you are deciding about is always wrong: if the window cannot hold what your conclusion rests on, hand over or fan out to a subagent whose window is its own, never read it partially.",
      "",
      "Those marks and that band are Claude-only. Codex selects its exact rollout by CODEX_THREAD_ID",
      "and reports raw resident/peak occupancy plus any capacity Codex declared. Codex composition is",
      "not exposed and its scheduling policy is unsettled, so neither a band nor the Claude ~700k/850k",
      "marks are applied to a Codex reading.",
      "",
      "It reads and never enforces (D8). On Claude, D6's point is that the judgement is INFORMED rather than",
      "guessed — where this prints no reading, say in your debrief that you ESTIMATED.",
      "",
      "The figure is your OWN conversation window. Helper and subagent windows are never folded in",
      "(ADR-0413 D2 / ADR-0411 D4): a session that fans work out has a small number, and that is",
      "correct rather than an under-report.",
      "",
      "On the Claude path, the `made of:` block splits the window's INTAKE by the labels the harness itself puts on each",
      "record (ADR-0516 D3 — labels and lengths, never content), in bytes (ADR-0330 D1's unit). The",
      "`unseen:` line is the harness's own preamble — system prompt and tool definitions — which no",
      "transcript records and which can only be shown as what was resident at the first request minus",
      "what the transcript accounts for (D4). It is reported as an unknown quantity, never omitted and",
      "never zero. The `remedy:` line names the one lever the dominant class leaves this session.",
      "",
      "Offline and read-only — host transcripts and Codex rollouts are local files, so it needs no",
      "database and no network. `STORYTREE_TRANSCRIPT_DIR` moves the Claude root; Codex reads the",
      "current user's `.codex/sessions` tree.",
    ].join("\n"),
    next: ["storytree context"],
  });
});

test("every surface that states a mark also says what the mark asks for", () => {
  // ADR-0499 D2-D4. The measured failure was a session reading the soft mark as a spend budget and
  // economising on the work in hand, so the number must never appear anywhere without the clause
  // that says what it governs. All THREE surfaces print a mark: the reading, the absence fallback
  // (which restates the marks precisely because it has no figure), and the help.
  const withFigure = contextCommand(deps());
  const absent = contextCommand(
    deps({ read: () => reading({ window: null, band: null, absence: "no-correlated-window", selectedBy: null }) }),
  );

  for (const body of [withFigure.body, absent.body, contextHelp().body]) {
    assert.match(body, /NEXT unit/, "a mark is stated without saying what it governs");
    assert.match(body, /cross it/i, "crossing a mark mid-increment is the expected case, not a failure");
  }

  // The ABSENCE render restates both marks in words precisely because it has no figure to band —
  // it is the one branch a session reads when `storytree context` cannot help it, so a tune that
  // left these two numbers behind would mislead exactly the session with the least to go on.
  assert.match(absent.body, /no new increment past ~700k/i);
  assert.match(absent.body, /hand over at 850k/i);
});

test("the reading says what the window is MADE OF, largest first, in bytes, from the same file the fullness came from", () => {
  const files: string[] = [];
  const env = contextCommand(
    deps({
      composition: (file) => {
        files.push(file);
        return composition();
      },
    }),
  );

  assert.deepEqual(files, ["/tmp/projects/slug/a2e1e82e-b05c-432d-84e6-19440160bf5f.jsonl"], "read from the selected file, never re-selected");
  assert.match(env.body, /made of:/);
  const toolOutput = env.body.indexOf("tool output");
  const toolCalls = env.body.indexOf("tool calls the session authored");
  const reminders = env.body.indexOf("harness reminders");
  assert.ok(toolOutput > 0 && toolOutput < toolCalls && toolCalls < reminders, "largest first");
  // One row pinned byte-for-byte: label padded to the longest label, bytes right-aligned in 12,
  // share right-aligned in 6, then the record count. The longest label here is
  // "tool calls the session authored" (31 characters).
  assert.ok(
    env.body.includes("\n    tool output                      " + "     612,000 B   64.4%  140 records\n"),
    env.body,
  );
  assert.ok(env.body.includes("       8,000 B    0.8%  1 record\n"), "singular for one record");
  assert.ok(!/1 records/.test(env.body));
  assert.ok(
    env.body.includes("\n              6 bookkeeping record(s) set aside (last-prompt, queue-operation)\n"),
    env.body,
  );
  assert.ok(!/helper-window/.test(env.body), "no exclusion line when nothing was excluded");
  assert.ok(!/unparseable/.test(env.body));
  assert.ok(!/non-record/.test(env.body));
  assert.match(env.body, /unit\) — its intake over its life, not what is resident after a compaction\n/);
  // The block ends on the remedy and is followed by exactly one blank line before the standing text.
  assert.match(env.body, /remedy:[^\n]+\n\nThis is YOUR window/);
});

test("what was set aside is listed on one line, each part only when it bit", () => {
  const env = contextCommand(
    deps({
      composition: () =>
        composition({
          sidechainLinesExcluded: 2,
          unparseableLines: 3,
          nonRecordLines: 4,
          bookkeeping: { bytes: 10, records: 1, kinds: ["pr-link"] },
        }),
    }),
  );
  assert.ok(
    env.body.includes(
      "\n              2 helper-window line(s) excluded (ADR-0413 D2) · 1 bookkeeping record(s) set aside (pr-link) · 3 unparseable line(s) · 4 non-record line(s)\n",
    ),
    env.body,
  );

  const none = contextCommand(
    deps({ composition: () => composition({ bookkeeping: { bytes: 0, records: 0, kinds: [] } }) }),
  );
  assert.ok(!/set aside/.test(none.body));
  // Nothing set aside means NO line at all — the last row is followed directly by the guidance note.
  assert.ok(
    none.body.includes("  1 record\n              project guidance (CLAUDE.md / MEMORY.md) is not labelled"),
    none.body,
  );
});

test("the dominant-class threshold is a boundary at exactly 40%, on all three arms", () => {
  const at = (slices: WindowComposition["slices"], accountedBytes: number) =>
    contextCommand(deps({ composition: () => composition({ slices, accountedBytes }) })).body;

  // tool output: 400,000 of 1,000,000 fires; 399,999 does not.
  assert.match(at([{ category: "human-prompt", bytes: 600_000, records: 1 }, { category: "tool-output", bytes: 400_000, records: 1 }], 1_000_000), /no single class dominates/);
  assert.match(
    at([{ category: "tool-output", bytes: 400_000, records: 1 }, { category: "human-prompt", bytes: 300_000, records: 1 }, { category: "assistant-text", bytes: 300_000, records: 1 }], 1_000_000),
    /remedy:\s+tool output is 40\.0%/,
  );
  assert.match(
    at([{ category: "tool-output", bytes: 399_999, records: 1 }, { category: "human-prompt", bytes: 300_001, records: 1 }, { category: "assistant-text", bytes: 300_000, records: 1 }], 1_000_000),
    /no single class dominates \(largest: tool output at 40\.0%\)/,
  );
  // tool calls, same boundary.
  assert.match(
    at([{ category: "tool-calls", bytes: 400_000, records: 1 }, { category: "human-prompt", bytes: 300_000, records: 1 }, { category: "assistant-text", bytes: 300_000, records: 1 }], 1_000_000),
    /the session's own tool-call payloads are 40\.0%/,
  );
  assert.match(
    at([{ category: "tool-calls", bytes: 399_999, records: 1 }, { category: "human-prompt", bytes: 300_001, records: 1 }, { category: "assistant-text", bytes: 300_000, records: 1 }], 1_000_000),
    /no single class dominates/,
  );
  // mandatory: summed across its categories, 400,000 fires; 399,999 does not.
  assert.match(
    at([{ category: "human-prompt", bytes: 350_000, records: 1 }, { category: "harness-reminder", bytes: 250_000, records: 1 }, { category: "hook-injection", bytes: 150_000, records: 1 }, { category: "assistant-text", bytes: 250_000, records: 1 }], 1_000_000),
    /mandatory context is 40\.0%/,
  );
  assert.match(
    at([{ category: "human-prompt", bytes: 350_001, records: 1 }, { category: "harness-reminder", bytes: 250_000, records: 1 }, { category: "hook-injection", bytes: 149_999, records: 1 }, { category: "assistant-text", bytes: 250_000, records: 1 }], 1_000_000),
    /no single class dominates \(largest: the human's own words at 35\.0%\)/,
  );
});

test("the harness floor is reported as an UNSEEN quantity with its arithmetic — never omitted, and never zero when it cannot be read", () => {
  const sized = contextCommand(deps());
  assert.match(sized.body, /unseen:\s+≈92,818 tokens were resident at the first request that no transcript line\n/);
  assert.match(sized.body, /\n\s+accounts for — the harness's system prompt, tool definitions, and anything it injected\n/);
  assert.match(sized.body, /106,000 resident − ≈13,182 for 50,089 visible bytes at 3\.8 chars\/token/);
  assert.match(sized.body, /Not this session's to trim \(ADR-0330 D1\)/);

  const unread = contextCommand(
    deps({ composition: () => composition({ residual: null, residualAbsence: "no-readable-request" }) }),
  );
  assert.match(unread.body, /unseen:\s+UNKNOWN/);
  assert.match(unread.body, /It is not zero/);
  assert.ok(!/≈0 tokens/.test(unread.body));
});

test("project guidance the harness did not label is said to travel inside the unseen slice, and the note goes away once it is labelled", () => {
  const unlabelled = contextCommand(deps());
  assert.match(unlabelled.body, /project guidance \(CLAUDE\.md \/ MEMORY\.md\) is not labelled by this harness/);

  const labelled = contextCommand(
    deps({
      composition: () =>
        composition({
          slices: [
            { category: "tool-output", bytes: 500_000, records: 100 },
            { category: "project-guidance", bytes: 70_000, records: 1 },
          ],
          accountedBytes: 570_000,
        }),
    }),
  );
  assert.ok(!/not labelled by this harness/.test(labelled.body));
  // The guidance row is followed by the set-aside line and then straight by `unseen:` — no note, no
  // stray line in between.
  assert.ok(
    labelled.body.includes(
      "project guidance (CLAUDE.md, when labelled)        70,000 B   12.3%  1 record\n" +
        "              6 bookkeeping record(s) set aside (last-prompt, queue-operation)\n" +
        "  unseen:",
    ),
    labelled.body,
  );
});

test("the remedy names the lever the dominant class leaves the session, and hands back none for mandatory context", () => {
  const toolOutput = contextCommand(deps());
  assert.match(
    toolOutput.body,
    /remedy:\s+tool output is 64\.4% of what entered — page long outputs \(`\| head`, `--out <file>`\) and hand exploration to a digest subagent whose window is its own \(`storytree library artifact delegate-exploration-to-digest-subagents`\)\n/,
  );

  const toolCalls = contextCommand(
    deps({
      composition: () =>
        composition({
          slices: [
            { category: "tool-calls", bytes: 500_000, records: 40 },
            { category: "tool-output", bytes: 300_000, records: 40 },
          ],
          accountedBytes: 800_000,
        }),
    }),
  );
  assert.match(toolCalls.body, /remedy:\s+the session's own tool-call payloads are 62\.5%/);
  assert.match(toolCalls.body, /edit it in place/);

  const mandatory = contextCommand(
    deps({
      composition: () =>
        composition({
          slices: [
            { category: "harness-catalogue", bytes: 300_000, records: 3 },
            { category: "tool-output", bytes: 250_000, records: 10 },
            { category: "harness-reminder", bytes: 200_000, records: 400 },
          ],
          accountedBytes: 750_000,
        }),
    }),
  );
  assert.match(
    mandatory.body,
    /remedy:\s+mandatory context is 66\.7% — none of it is this session's to trim; the repo-owned part is budgeted by ADR-0330 D1 and `storytree doctor` reports it\n/,
  );
  assert.ok(!/delegate-exploration/.test(mandatory.body));

  const spread = contextCommand(
    deps({
      composition: () =>
        composition({
          slices: [
            { category: "tool-output", bytes: 300_000, records: 10 },
            { category: "assistant-text", bytes: 290_000, records: 10 },
            { category: "human-prompt", bytes: 280_000, records: 10 },
          ],
          accountedBytes: 870_000,
        }),
    }),
  );
  assert.match(spread.body, /remedy:\s+no single class dominates \(largest: tool output at 34\.5%\)/);

  const empty = contextCommand(deps({ composition: () => composition({ slices: [], accountedBytes: 0 }) }));
  assert.match(empty.body, /remedy:\s+nothing entered this window yet/);
});

test("an unclassified slice carries the labels that fell through, so the remedy is a table row", () => {
  const env = contextCommand(
    deps({
      composition: () =>
        composition({
          slices: [
            { category: "tool-output", bytes: 500_000, records: 100 },
            { category: "unclassified", bytes: 40_000, records: 4 },
          ],
          accountedBytes: 540_000,
          unclassifiedLabels: ["attachment:brand_new", "block:document"],
        }),
    }),
  );
  assert.match(env.body, /unclassified\s+40,000 B\s+7\.4%\s+4 records  \(attachment:brand_new, block:document\)\n/);
  assert.match(env.body, /tool output\s+500,000 B\s+92\.6%\s+100 records\n/, "labels ride only on the unclassified row");
});

test("an unreadable composition says so under the fullness rather than blanking either", () => {
  const env = contextCommand(
    deps({
      composition: () =>
        composition({ slices: [], accountedBytes: 0, residual: null, residualAbsence: "unreadable-file" }),
    }),
  );
  assert.match(env.body, /resident:\s+225,013 tokens/);
  assert.match(env.body, /made of:\s+UNREADABLE — the transcript this reading came from could not be re-read for its\n\s+composition\. The fullness above stands; what fills it is not known\.\n\nThis is YOUR window/);
  assert.ok(!/remedy:/.test(env.body));
});

test("an ABSENCE renders no composition at all — there is no file to fold, and nothing is read", () => {
  let called = 0;
  const env = contextCommand(
    deps({
      read: () => reading({ window: null, band: null, absence: "no-correlated-window", selectedBy: null }),
      composition: () => {
        called++;
        return composition();
      },
    }),
  );
  assert.equal(called, 0);
  assert.ok(!/made of:/.test(env.body));
});
