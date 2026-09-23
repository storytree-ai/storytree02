/* gate-check
runs: local
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  reds when a `definition` row is neither carrying an authored dependsOn edge nor named as
  deliberately carrying none (ADR-0468 D3). It sits beside check:library-dag-acyclic for the same
  reason: the tier it judges is live state, so ANY session's artifact edit can red it even on a
  branch that touched no corpus. Deliberately NOT the weaker `every definition carries an edge` —
  that shape prices the tier toward padding, which is the failure ADR-0464's candidate-D refusal
  names
*/
/**
 * `pnpm check:definition-adjudication` — ADR-0468 D3's rung over the `definition` tier.
 *
 * THE THIN HALF. Every rule lives in the pure judge (`evaluateDefinitionAdjudication`); this file
 * reads the corpus, hands it over, prints, and sets an exit code. It decides nothing.
 *
 * WHY IT IS A `check:*` RUNG AND NOT A TEST IN `pnpm -r test`, following its
 * `check:library-dag-acyclic` / `check:adr-health` neighbours exactly: its subject is the LIVE
 * corpus, and `pnpm -r test` is credential-free by ADR-0302 D3. ADR-0307 D4 states the resulting
 * line verbatim — an assertion about the real corpus belongs on a rung that may hold a connection.
 * The pure rule it calls is unit-tested in that leg, where it belongs.
 *
 * SHARED-ENVIRONMENT, not own-work: the tier it judges is live state any session can edit, so a
 * sibling's `library artifact edit <definition>` can red this branch. That is why it sits in the
 * gate plan's block C behind the two expensive legs (`gate-order.ts`, axis 2).
 *
 * FAIL-CLOSED ON AN UNREADABLE CORPUS and it does NOT declare a `GATE_SKIP_EXIT_CODE` skip, for
 * `check:library-dag-acyclic`'s reason: offline is not a supported mode (ADR-0302 D2), and an
 * adjudication claim made against a corpus nobody read is the "believing something is watching when
 * nothing is" failure the retired-checks register exists to prevent.
 */

import { openCorpusStore } from "@storytree/drive";

import {
  evaluateDefinitionAdjudication,
  isVacuousDefinitionRead,
  VACUOUS_DEFINITION_READ_FLOOR,
} from "./definition-adjudication.js";

const TAG = "check:definition-adjudication";

async function main(): Promise<void> {
  const corpus = await openCorpusStore(TAG);
  try {
    // ONE bulk read, not a per-id walk: the dangling-target half needs every live id, so the
    // denominator is the corpus. `queryDocs()` unfiltered is a single round trip — the shape
    // ADR-0345 measured as ~10x cheaper in CI than repeated `getDoc`s over the same set.
    const docs = await corpus.store.queryDocs();
    const verdict = evaluateDefinitionAdjudication(docs);

    // AN INSTRUMENT THAT CANNOT SEE ITS SUBJECT MUST NOT REPORT SUCCESS. A handful of definitions is
    // a reader that has lost the kind, not a tier that shrank. UNVERIFIED, never PASS and never
    // FAIL: there is nothing to name and no repair to prescribe, so the remedy is aimed at the
    // reader rather than at the corpus.
    if (isVacuousDefinitionRead(verdict)) {
      console.error(
        `${TAG} UNVERIFIED — only ${verdict.scanned} definition artifacts were read, beneath the ` +
          `floor of ${VACUOUS_DEFINITION_READ_FLOOR}, so this run verified NOTHING about the tier.`,
      );
      console.error("");
      console.error(
        "The tier stood at 53 when ADR-0468 landed. A read this thin means the READER is blind — " +
          "usually a store pointed somewhere unexpected, or a `kind` filter that stopped matching.",
      );
      process.exitCode = 1;
      return;
    }

    if (verdict.ok) {
      console.log(
        `${TAG} PASS — all ${verdict.scanned} definitions adjudicated: ${verdict.withEdges} carry ` +
          `${verdict.edges} authored dependsOn edges, ${verdict.exempt.length} deliberately carry ` +
          `none (${verdict.exempt.join(", ")}).`,
      );
      return;
    }

    console.error(`${TAG} FAIL — the definition tier is not fully adjudicated.`);
    console.error("");
    if (verdict.unadjudicated.length > 0) {
      console.error(
        `${verdict.unadjudicated.length} definition(s) carry no authored edge and no exemption:`,
      );
      for (const id of verdict.unadjudicated) console.error(`  ${id}`);
      console.error("");
      console.error(
        "Decide which it is, and say so. If it rests on a recorded decision, author the edge:",
      );
      console.error(
        "  storytree library artifact edit <id> --set 'dependsOn=[\"asset:adr-NNNN\"]' --pg",
      );
      console.error(
        "If it rests on nothing, add its id to ADJUDICATED_WITHOUT_EDGES with a prose reason — " +
          "that is a first-class pass, not a concession (ADR-0468 D3).",
      );
      console.error("");
    }
    if (verdict.staleExemptions.length > 0) {
      console.error(
        `${verdict.staleExemptions.length} exemption(s) are STALE — the definition now carries edges, ` +
          "so the claim that it rests on nothing is no longer true. Remove the id from " +
          "ADJUDICATED_WITHOUT_EDGES:",
      );
      for (const id of verdict.staleExemptions) console.error(`  ${id}`);
      console.error("");
    }
    if (verdict.phantomExemptions.length > 0) {
      console.error(
        `${verdict.phantomExemptions.length} exemption(s) name no definition in the corpus — ` +
          "renamed, retired, or a typo. Remove or correct them:",
      );
      for (const id of verdict.phantomExemptions) console.error(`  ${id}`);
      console.error("");
    }
    if (verdict.danglingTargets.length > 0) {
      console.error(
        `${verdict.danglingTargets.length} authored edge(s) point at nothing in the corpus. An ` +
          "authored edge that rotted is worse than none: the tier gained these edges precisely to " +
          "replace a citation list nobody maintained (ADR-0464 D8).",
      );
      for (const t of verdict.danglingTargets) console.error(`  ${t}`);
      console.error("");
    }
    console.error(
      `Scanned ${verdict.scanned} definitions: ${verdict.withEdges} with edges, ` +
        `${verdict.exempt.length} exempt.`,
    );
    process.exitCode = 1;
  } finally {
    await corpus.close();
  }
}

main().catch((err: unknown) => {
  // Fail-closed: an unreadable corpus is an UNVERIFIED adjudication claim, never a passing one.
  console.error(`${TAG} — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
