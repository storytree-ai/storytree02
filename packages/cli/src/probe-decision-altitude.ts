/**
 * `pnpm probe:decision-altitude` — `decision-read-measurement-arc-inc-03`'s reproducer: classify the
 * decision log by altitude, then test whether reach clusters by it.
 *
 * **A PROBE, NOT A GATE RUNG, for `probe:decision-baseline`'s reason exactly.** Its reach half is a
 * property of ONE LAPTOP's transcript history, so nothing it prints is a repo invariant anyone could
 * be held to, and a `check:` name would be picked up by the gate plan's unplanned-check guard.
 *
 * ## THIS FILE IS THE ONLY HALF THAT TOUCHES THE WORLD
 *
 * Every number is computed by `decision-altitude.ts`, which is pure. This half gathers four things:
 *
 *   - THE DECISION LOG — every `adr` row from the live store, for its title, its `## Decision` prose
 *     and its two support-edge arrays. The store, never a file: `docs/decisions/` was deleted by
 *     ADR-0403 dec 1 and a reader pointed at it would report a confident census of nothing.
 *   - PASS A, the EDITORIAL classification — a committed JSON of labels, one per decision, made by
 *     reading titles and `## Decision` prose BLIND to every read figure. It is a report input, not a
 *     stored classification: this increment must not write an altitude field onto live artifacts.
 *   - PASS C, a BLIND RE-TEST of a seeded held-out sample, in the same file.
 *   - REACH — from an `-inc-02` baseline JSON (`pnpm probe:decision-baseline --json-out <path>`),
 *     whose rows this file never recomputes. One gather, one definition of a read, one instrument.
 *
 * PASS B, the lexical classifier, is computed here from the rows and is committed CODE rather than
 * data, so anyone can re-derive it.
 *
 * ## WHY THE BASELINE ARRIVES AS A FILE RATHER THAN BEING RE-GATHERED
 *
 * The baseline sweeps 4,330 transcripts. Re-running that sweep inside this probe would put a second
 * copy of the read definition in the repo, and the two would drift the first time either was
 * touched — which is the failure `probe-decisions.ts` was written to end for the three ADR probes.
 * Requiring the file is the honest cost: this probe REFUSES without one rather than quietly
 * measuring altitude against an empty reach record and reporting that nothing clusters.
 *
 * ## THE `## Decision` SECTION IS SLICED BY INDEX, NEVER BY A `\Z` LOOKAHEAD
 *
 * JavaScript has no `\Z` anchor. `(?=^##\s|\Z)` compiles to an alternation whose second branch is a
 * LITERAL `z`, so it cuts every section at its first one — `Operationali|ze`, `normali|zed`,
 * `reali|zes`. The first draft of this increment's extractor did exactly that and truncated 228 of
 * 416 sections before it was caught, 30 of them to under 200 characters. It is index arithmetic here
 * for that reason, and {@link decisionSection} has a test that would fail if it came back.
 *
 * ## EXIT CODES
 *
 * 0 when the reading was taken; 1 when it could not be (no store, an empty log, a missing or
 * unreadable baseline or label file) or when the pure half reports a VACUITY reason. "Nothing
 * clusters" exits 0 and is a finding; "nothing was classified" exits 1 and is an instrument reading,
 * and the whole point of the pair is that they must never print the same way.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDecisionId } from "@storytree/context-traversal-transcript";
import { adrDocumentFieldsOf } from "@storytree/library/adr-doc";
import { closePool, createPool, PgLibraryStore } from "@storytree/library/store";

import { frozenAmendsEdges } from "./probe-decision-gather.js";
import {
  agreementBetween,
  ALTITUDE_CLASSES,
  classifyAltitudeLexically,
  computeAltitudeReading,
  decisionSection,
  drawHeldOutSample,
  resolveLabelSet,
  type AgreementReading,
  type AltitudeClass,
  type AltitudeEdge,
  type AltitudeLabel,
  type AltitudeReading,
} from "./decision-altitude.js";

const EXIT_UNREADABLE = 1;

/**
 * The committed label file, anchored to THIS MODULE rather than to `process.cwd()`.
 *
 * `pnpm probe:decision-altitude` runs through `pnpm -C packages/cli exec`, so the working directory
 * is the package and a repo-relative default would resolve to `packages/cli/docs/research/…` and
 * refuse. Anchoring to the module makes the default correct from any directory.
 */
const DEFAULT_LABELS = fileURLToPath(
  new URL("../../../docs/research/decision-altitude-labels-2026-08-23.json", import.meta.url),
);

const out = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const num = (n: number, dp = 2): string => n.toFixed(dp);

interface DecisionRow {
  readonly number: number;
  readonly title: string;
  readonly section: string;
  readonly amends: readonly number[];
  readonly dependsOn: readonly string[];
}

async function loadDecisionRows(store: PgLibraryStore): Promise<DecisionRow[]> {
  const frozenBySource = new Map<number, number[]>();
  for (const edge of frozenAmendsEdges()) {
    const existing = frozenBySource.get(edge.from);
    if (existing === undefined) frozenBySource.set(edge.from, [edge.to]);
    else existing.push(edge.to);
  }
  const rows: DecisionRow[] = [];
  for (const stored of await store.queryDocs({ kind: "adr" })) {
    // The number is the id's (ADR-0609 D1 — nothing stores it); `adrDocumentFieldsOf` degrades a
    // non-decision id to 0 rather than throwing.
    const fields = adrDocumentFieldsOf(stored.id, stored.doc as Record<string, unknown>);
    const fromId = resolveDecisionId(stored.id);
    const number = fromId?.number ?? fields.number;
    if (number === 0) continue;
    rows.push({
      number,
      title: fields.title,
      section: decisionSection(fields.body),
      // THE FROZEN EDGE SET, NOT THE LIVE ROWS. ADR-0431 D1 retired `amends` and `-inc-19` removed
      // the field, so the document can no longer carry it — but this probe's altitude reading is
      // compared against figures frozen BEFORE the migration
      // (`docs/research/decision-altitude-2026-08-23.md`), and an arm that silently read 0 would
      // report a collapse where a join key was retired. Both arms therefore read the ADR-0431 D2
      // snapshot, which is the same thing `probe:amends-reach` does for the same reason.
      amends: frozenBySource.get(number) ?? [],
      dependsOn: fields.dependsOn ?? [],
    });
  }
  return rows.sort((a, b) => a.number - b.number);
}

interface LabelFile {
  readonly passA: { readonly labels: readonly AltitudeLabel[] };
  readonly heldOut: {
    readonly seed: number;
    readonly size: number;
    readonly passC: { readonly labels: readonly AltitudeLabel[] };
    readonly contaminated?: readonly number[];
  };
}

interface BaselineFile {
  readonly reachByWindow: readonly { readonly decision: number; readonly sessions: number }[];
  readonly chainDepthByWindow: { readonly sessionsWithAnyDecisionRead: number };
  readonly decisionsInLog: number;
  readonly amendsEdges: number;
  readonly dependsOnEdges: number;
}

function readJson<T>(file: string, what: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${what} not found at ${file}. This probe REFUSES rather than measuring altitude against an ` +
        "empty record and reporting that nothing clusters.",
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function printAgreement(title: string, reading: AgreementReading, note?: string): void {
  out(`  ${title}`);
  if (note !== undefined) out(`    ${note}`);
  if (reading.compared === 0) {
    out("    compared 0 decisions — the two passes share no decision, so there is no rate to report");
    return;
  }
  out(
    `    compared ${String(reading.compared)}   agreed ${String(reading.agreed)}   ` +
      `rate ${pct(reading.rate)}   expected-by-chance ${pct(reading.expectedByChance)}   ` +
      `kappa ${reading.kappa === null ? "n/a" : num(reading.kappa, 3)}`,
  );
  if (reading.onlyInA > 0 || reading.onlyInB > 0) {
    out(`    (only in the first pass: ${String(reading.onlyInA)}; only in the second: ${String(reading.onlyInB)})`);
  }
  const disagreements = reading.confusion.filter((c) => c.a !== c.b).sort((x, y) => y.count - x.count);
  if (disagreements.length > 0) {
    out(
      `    where they part: ${disagreements
        .map((c) => `${c.a}→${c.b} ${String(c.count)}`)
        .join("  ")}`,
    );
  }
}

function printReading(reading: AltitudeReading, label: string): void {
  out(`  REACH BY ALTITUDE — ${label}`);
  out("    class       decisions   share   read  never   totalReach  shareOfReach   mean  median   max");
  for (const row of reading.classCounts) {
    out(
      `    ${row.altitude.padEnd(11)} ${String(row.decisions).padStart(6)}  ` +
        `${pct(row.shareOfLog).padStart(6)}  ${String(row.read).padStart(5)}  ` +
        `${String(row.neverRead).padStart(5)}  ${String(row.totalReach).padStart(10)}  ` +
        `${pct(row.shareOfReach).padStart(12)}  ${num(row.meanReach).padStart(5)}  ` +
        `${num(row.medianReach, 1).padStart(6)}  ${String(row.maxReach).padStart(4)}`,
    );
  }
  const c = reading.clustering;
  out("");
  out(
    `    Kruskal-Wallis H = ${num(c.statistic, 3)} over ${String(c.groupsCompared)} classes and ` +
      `${String(c.observationsCompared)} decisions (unread ones entering as 0)`,
  );
  out(
    `    permutation p = ${num(c.pValue, 4)}  (${String(c.iterations)} shuffles, seed ${String(c.seed)}) — ` +
      `median spread ${num(c.medianSpread, 1)}, mean ratio ${c.meanRatio === null ? "n/a" : `${num(c.meanRatio)}x`}`,
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const intFlag = (name: string, fallback: number): number => {
    const raw = flag(name);
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };

  const baselinePath = flag("--baseline");
  if (baselinePath === undefined) {
    out("✗ probe:decision-altitude — --baseline <path> is REQUIRED.");
    out("");
    out("  Reach comes from the -inc-02 baseline, never recomputed here — one gather, one");
    out("  definition of a read. Produce one with:");
    out("");
    out("    pnpm probe:decision-baseline --from 2026-06-08T00:00:00.000Z \\");
    out("      --to 2026-08-23T00:00:00.000Z --json-out <path>");
    return EXIT_UNREADABLE;
  }

  const seed = intFlag("--seed", 20260823);
  const iterations = intFlag("--iterations", 20000);
  const labelsPath = flag("--labels") ?? DEFAULT_LABELS;

  let labelFile: LabelFile;
  let baseline: BaselineFile;
  try {
    labelFile = readJson<LabelFile>(path.resolve(labelsPath), "the altitude label file");
    baseline = readJson<BaselineFile>(path.resolve(baselinePath), "the -inc-02 baseline JSON");
  } catch (err) {
    out(`✗ probe:decision-altitude — ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_UNREADABLE;
  }

  let handle: Awaited<ReturnType<typeof createPool>> | undefined;
  try {
    handle = await createPool();
  } catch (err) {
    out("✗ probe:decision-altitude — the decision log is in the store since ADR-0403 and it could not be opened:");
    out(`  ${err instanceof Error ? err.message : String(err)}`);
    out("  This is a FAILURE, not a skip: no decision was read, so nothing was classified.");
    out("  Bring the DB up (pnpm db:up) and re-run.");
    return EXIT_UNREADABLE;
  }

  try {
    const rows = await loadDecisionRows(new PgLibraryStore(handle.pool));
    if (rows.length === 0) {
      out("✗ probe:decision-altitude — the store holds NO decisions.");
      out("  Zero is never the real decision log; it means an unmigrated or wrong store.");
      return EXIT_UNREADABLE;
    }

    const inLog = new Set(rows.map((r) => r.number));
    const amends: AltitudeEdge[] = [];
    const dependsOn: AltitudeEdge[] = [];
    let danglingAmends = 0;
    let dependsOnNonDecisionTargets = 0;
    for (const row of rows) {
      for (const target of row.amends) {
        if (inLog.has(target)) amends.push({ from: row.number, to: target });
        else danglingAmends += 1;
      }
      for (const pointer of row.dependsOn) {
        const resolved = resolveDecisionId(pointer);
        if (resolved !== null && inLog.has(resolved.number)) {
          dependsOn.push({ from: row.number, to: resolved.number });
        } else {
          dependsOnNonDecisionTargets += 1;
        }
      }
    }

    // --- the three passes ------------------------------------------------------------------
    const passA = resolveLabelSet(labelFile.passA.labels, resolveDecisionId);
    const passC = resolveLabelSet(labelFile.heldOut.passC.labels, resolveDecisionId);
    const passB = new Map<number, AltitudeClass>();
    let nearTies = 0;
    for (const row of rows) {
      const verdict = classifyAltitudeLexically({ title: row.title, decisionText: row.section });
      passB.set(row.number, verdict.altitude);
      if (verdict.nearTie) nearTies += 1;
    }

    const sample = drawHeldOutSample([...passA.byDecision.keys()], {
      seed: labelFile.heldOut.seed,
      size: labelFile.heldOut.size,
    });
    const sampleSet = new Set(sample);
    const missingFromPassC = sample.filter((n) => !passC.byDecision.has(n));
    const strayInPassC = [...passC.byDecision.keys()].filter((n) => !sampleSet.has(n));

    const restrict = (
      map: ReadonlyMap<number, AltitudeClass>,
      keep: (n: number) => boolean,
    ): Map<number, AltitudeClass> => new Map([...map].filter(([n]) => keep(n)));

    const contaminated = new Set(labelFile.heldOut.contaminated ?? []);
    const clean = (n: number): boolean => sampleSet.has(n) && !contaminated.has(n);

    // --- the join --------------------------------------------------------------------------
    const readingA = computeAltitudeReading({
      decisionsInLog: [...inLog],
      labels: passA.byDecision,
      reach: baseline.reachByWindow,
      sessionsInDenominator: baseline.chainDepthByWindow.sessionsWithAnyDecisionRead,
      amends,
      dependsOn,
      seed,
      iterations,
    });
    const readingB = computeAltitudeReading({
      decisionsInLog: [...inLog],
      labels: passB,
      reach: baseline.reachByWindow,
      sessionsInDenominator: baseline.chainDepthByWindow.sessionsWithAnyDecisionRead,
      amends,
      dependsOn,
      seed,
      iterations,
    });

    // --- report ----------------------------------------------------------------------------
    out("storytree probe:decision-altitude — decision-read-measurement-arc-inc-03");
    out("");
    out("THE SUBJECT");
    out(`  decisions in the live log                ${String(rows.length)}`);
    out(`  amends edges (resolvable, counted apart) ${String(amends.length)}`);
    out(`  dependsOn edges (resolvable, apart)      ${String(dependsOn.length)}`);
    out(`  amends targets the log does not hold     ${String(danglingAmends)}`);
    out(`  dependsOn pointers naming no decision    ${String(dependsOnNonDecisionTargets)}`);
    out(
      `  the baseline's own subject               ${String(baseline.decisionsInLog)} decisions, ` +
        `${String(baseline.amendsEdges)} amends, ${String(baseline.dependsOnEdges)} dependsOn`,
    );
    out("  (a live log that has grown past the frozen baseline is expected — the READS are frozen,");
    out("   the SUBJECT is not, and the two are reported apart rather than reconciled.)");
    out("");

    out("THE CLASSIFICATION");
    out(`  pass A (editorial)  labels ${String(labelFile.passA.labels.length)}, resolved ${String(passA.byDecision.size)}, unresolved ${String(passA.unresolved.length)}, duplicates ${String(passA.duplicates.length)}`);
    out(`  pass B (lexical)    labels ${String(passB.size)}, of which near-ties ${String(nearTies)} (${pct(nearTies / passB.size)})`);
    out(`  pass C (blind re-test) labels ${String(passC.byDecision.size)} over a seeded held-out sample of ${String(sample.length)}`);
    if (missingFromPassC.length > 0 || strayInPassC.length > 0) {
      out(
        `  ⚠ pass C does not cover the drawn sample exactly — missing ${String(missingFromPassC.length)}, ` +
          `stray ${String(strayInPassC.length)}. The sample is DRAWN from a declared seed, never picked.`,
      );
    }
    for (const klass of ALTITUDE_CLASSES) {
      const a = [...passA.byDecision.values()].filter((v) => v === klass).length;
      const b = [...passB.values()].filter((v) => v === klass).length;
      out(`    ${klass.padEnd(11)} pass A ${String(a).padStart(4)}   pass B ${String(b).padStart(4)}`);
    }
    out("");

    out("AGREEMENT — the increment's own brief calls this worth more than the join");
    printAgreement(
      "pass A vs pass B, whole log",
      agreementBetween(passA.byDecision, passB),
      "editorial reading against a committed lexical classifier — how much of an altitude judgment is recoverable from surface text",
    );
    printAgreement(
      "pass A vs pass C, held-out sample",
      agreementBetween(restrict(passA.byDecision, (n) => sampleSet.has(n)), passC.byDecision),
      "SAME RATER re-testing under a reduced, id-hidden, order-scrambled presentation — a REPLICATION, not a second mind",
    );
    printAgreement(
      "pass A vs pass C, contamination excluded",
      agreementBetween(restrict(passA.byDecision, clean), restrict(passC.byDecision, clean)),
      `the same, minus ${String(contaminated.size)} decision(s) whose titles were re-exposed between the draw and the pass`,
    );
    printAgreement(
      "pass B vs pass C, held-out sample",
      agreementBetween(restrict(passB, (n) => sampleSet.has(n)), passC.byDecision),
    );
    out("");

    printReading(readingA, "pass A (editorial), the primary reading");
    out("");
    printReading(readingB, "pass B (lexical), as a SENSITIVITY check on the classifier");
    out("");

    out("SUPPORT EDGES — do chains stay inside one altitude class?");
    out("  population        edges  joined  within  cross   top pairs");
    for (const crossing of readingA.edgeCrossings) {
      const pairs = crossing.byPair
        .slice(0, 3)
        .map((p) => `${p.from.slice(0, 4)}→${p.to.slice(0, 4)} ${String(p.count)}`)
        .join("  ");
      out(
        `  ${crossing.population.padEnd(16)} ${String(crossing.edges).padStart(5)}  ` +
          `${String(crossing.joined).padStart(6)}  ${String(crossing.withinClass).padStart(6)}  ` +
          `${String(crossing.crossClass).padStart(5)}   ${pairs}`,
      );
    }
    out("  (`amends` and `dependsOn` are counted APART — ADR-0419 D1. The union row is the ADJACENCY");
    out("   the depth walk traverses, printed beside the pair and never instead of it.)");
    out("");

    if (readingA.vacuity.length > 0) {
      out("✗ VACUITY — this reading measured nothing, and that is not the same as 'nothing clusters':");
      for (const reason of readingA.vacuity) out(`  • ${reason}`);
      return EXIT_UNREADABLE;
    }
    out("✓ every figure above measured its subject: no vacuity reason applies.");
    out(
      `  A p of ${num(readingA.clustering.pValue, 4)} is therefore a FINDING about how altitude relates to reach, ` +
        "not an instrument reading.",
    );
    return 0;
  } finally {
    if (handle !== undefined) await closePool(handle.pool, handle.connector);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    out(`✗ probe:decision-altitude — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT_UNREADABLE;
  });
