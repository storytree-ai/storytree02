---
id: "per-test-reporter-survives-unprintable-causes"
tier: contract
story: drive-machinery
capability: prove-it-gate
arc: verification-integrity-arc
title: "Keep the Node per-test reporter alive for an unprintable cause"
outcome: "An unprintable failure cause cannot stop the Node per-test reporter from recording later tests or change the review's assertion-red classification."
status: proposed
proof_mode: contract-test
depends_on: []
decisions: [573]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/orchestrator", "test"]
  scope:
    testGlobs: ["packages/orchestrator/src/proof/per-test-reporter-cause.test.ts"]
    sourceGlobs: ["packages/orchestrator/src/proof/per-test-reporter.mjs"]
  real:
    testFile: "packages/orchestrator/src/proof/per-test-reporter-cause.test.ts"
    sourceFile: "packages/orchestrator/src/proof/per-test-reporter.mjs"
    scope:
      testGlobs: ["packages/orchestrator/src/proof/per-test-reporter-cause.test.ts"]
      sourceGlobs: ["packages/orchestrator/src/proof/per-test-reporter.mjs"]
    install: true
    editsExisting: true
    proofCommand:
      file: node
      args:
        - "--import"
        - "./scripts/tsx-cache-off.mjs"
        - "--import"
        - "./packages/drive/node_modules/tsx/dist/loader.mjs"
        - "--test"
        - "packages/orchestrator/src/proof/per-test-reporter-cause.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/orchestrator", "typecheck"]
---

# Keep the Node per-test reporter alive for an unprintable cause

**Outcome —** An unprintable failure cause cannot stop the Node per-test reporter from recording later
tests or change the review's assertion-red classification.

## Proof walkthrough

The focused Node test imports the actual async-generator reporter and gives it a finite synthetic
node:test event stream. Its first failure has a null-prototype cause that cannot be coerced to text. The
next failure has an ordinary `AssertionError` cause with a code and a multi-line message, followed by a
passing test. The test uses `assert.doesNotReject` while consuming every JSONL line from the generator,
then parses the emitted records, so the current raw `TypeError` is an assertion-red rather than a
load/runtime error. A bounded offline Node subprocess runs a disposable fixture with the same
unprintable-cause failure before later assertion-red and pass records. It clones the child environment
without every `NODE_TEST*` variable, names the reporter with `--test-reporter` beside `spec`, has a
bounded timeout, expects the fixture's intentional assertion failure at exit 1, and writes a report file.

1. **An unprintable cause is local to its event.** `assert.doesNotReject` proves the unprintable
   failure emits valid JSON without throwing or truncating the stream. Its cause rendering is absent or
   a safe non-identity fallback; it never fabricates an assertion name, code, or message. The following
   assertion failure and pass still each produce their own records.
2. **Usable cause fields remain exact.** For the ordinary assertion cause, the emitted record preserves
   its `causeName`, `causeCode`, and the first line of its string message. The later pass remains a pass;
   no event is reclassified because an earlier cause was unprintable.
3. **The reporter stays a reporting boundary.** The bounded subprocess invokes the committed reporter
   through Node's reporter protocol on the same unprintable failure before its later assertion-red and
   pass records, and yields readable JSONL alongside human `spec` output. The reader
   can therefore retain its existing missing/unknown rows and assertion-red refusal behaviour; this
   change neither turns a non-assertion red into proof nor changes review classification.

The observable is the complete ordered JSONL stream and the bounded subprocess's report file. No live
leaf, build, database, or mutation interpretation participates. `packages/orchestrator` remains outside
the mutation rung, so the signed verdict declares the `NARROWED:` coverage gap rather than substituting
a self-audit.


## Evidence

**Signed PASS —** `real-22fda112-f9c4-4dc5-98d1-a6c65e26e275` passed all three contracts on attempt 2
at `09629bdc`, then was adjudicated **LAND**. The focused Node proof and orchestrator typecheck passed;
two in-build repair slices completed before signing. `packages/orchestrator` remains outside the mutation
rung, so the verdict declares the expected `NARROWED:` coverage gap. The disk contract retains
`status: proposed`, consistent with its signed contract siblings; the signed verdict is the proof status.

## Guidance

**Leaf test acceptance (prompt-exposed).** Read this full walkthrough and every contract assertion
before writing. The contract identifier in the phase prompt is only an index to this content.

Edit only `packages/orchestrator/src/proof/per-test-reporter.mjs` and add the declared focused test. Keep
the reporter an async generator over Node's event stream and retain its current event selection and JSONL
shape. Make only cause-message rendering total: when `cause.message` is a string, preserve its first
line exactly; when ordinary string coercion is safe, it may retain the current rendered first line; when
coercion throws, yield the event with no fabricated assertion identity and continue to the next event.

Do not change `per-test-report.ts`, the reader's optional-field treatment, node reporter flags, proof
classification, or any per-test policy. `causeName` and `causeCode` remain available when the event
carries them. A reporting failure must not erase later failure/pass events, but robustness is not a new
acceptance path: the existing review still decides whether every declared test ran and whether a new red
is an assertion red.

The focused test may create a disposable test file and report path for the bounded Node subprocess and
must remove them in `finally`. It must exercise the reporter directly with a null-prototype, uncoercible
cause plus subsequent assertion-red and pass events, asserting consumption does not reject so the old
raw TypeError is an assertion-red. Its subprocess fixture repeats that unprintable failure before the
later assertion-red and pass records. Clone its child environment with every `NODE_TEST*` variable
removed, bound the child, and expect its intentional assertion failure at exit 1 while reading both the
human `spec` output and JSONL report. The subprocess is a protocol witness, not a substitute for the
direct control.

## Contracts (3)

1. **`per-test-reporter-continues-after-an-unprintable-cause`** — one unprintable cause cannot abort the
   reporter or hide later records.
   - **asserts —** a `test:fail` event whose null-prototype cause cannot be string-coerced is consumed through
     `assert.doesNotReject`, yields valid JSONL, and the same stream's later assertion-failure and pass
     events both yield records in order. The unprintable event supplies no invented assertion identity.
   - **covers —** `packages/orchestrator/src/proof/per-test-reporter.mjs` (cause rendering and async
     event iteration).
   - **proven by —** the focused test's direct async-generator event stream.

2. **`per-test-reporter-preserves-readable-cause-data`** — robustness preserves the data the report
   already carries when it is safe to read.
   - **asserts —** an ordinary assertion cause retains its name, code, and first message line in its
     JSONL failure record, while a later pass retains its pass event. The unprintable prior cause does not
     alter either record's type or fields.
   - **covers —** `packages/orchestrator/src/proof/per-test-reporter.mjs` (failure detail projection).
   - **proven by —** the same ordered direct event stream.

3. **`per-test-reporter-remains-a-node-reporter`** — the repaired module remains usable through Node's
   reporter protocol for the same unprintable cause beside human-readable test output.
   - **asserts —** a bounded offline `node --test` subprocess whose first failing test has the same unprintable cause,
     using the committed reporter and `spec`, writes readable JSONL for that failure and its later
     assertion-red and pass records while preserving `spec` stdout. The
     witness does not claim the reporter made a non-assertion red acceptable; that decision remains the
     existing reader and per-test review.
   - **covers —** `packages/orchestrator/src/proof/per-test-reporter.mjs` (Node reporter protocol).
   - **proven by —** the focused test's disposable subprocess/report-file witness and the declared
     orchestrator typecheck.
