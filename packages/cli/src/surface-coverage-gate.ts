// ⚠ UNWIRED — part of retired `check:surface-coverage`, which ADR-0311 D2 removed from the gate
// on 2026-08-05. This module is the gate logic; its entrypoint `check-surface-coverage.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
/**
 * `check:surface-coverage` — the process↔entrypoint bijection sweep (ADR-0154 decision 2).
 *
 * ADR-0034 §2 makes a `process` artifact the derived, operational view of a way-of-working; ADR-0154
 * makes the CLI/pnpm surface a declared PROJECTION of that process tier and gates it on coverage
 * (never on necessity). This is that gate: a best-effort, WARN-only sweep — the contract↔test
 * (`check:coverage`) / seed↔live (`check:corpus-sync`) analogue — that computes the bijection
 *
 *   (a) every entrypoint a process NAMES in its `surfaces` resolves to a real entrypoint, and
 *   (b) every operator-facing entrypoint has SOME process behind it (else it is an orphan),
 *   (c) every `storytree …` command a process PRESCRIBES in its four prose fields is still mounted.
 *
 * and prints all three gaps. "Which commands do we need?" is a judgement the gate must not adjudicate —
 * it only asserts the bijection holds over what exists. The orphan list IS the process-tier backfill
 * worklist.
 *
 * Axis (c) is the later addition and reads the fields (a) never looked at; its recognition rule, the
 * four things it deliberately does not match, and its resolution rule are stated in full above
 * {@link parsePrescribedCommands}. Read that block before widening anything here — the design
 * constraint is that arbitrary prose must never be treated as an entrypoint.
 *
 * BOUNDED AT A DRAIN CEILING since 2026-07-27 (`verification-integrity-arc`, ADR-0252 D3, in ADR-0168
 * D4's shape). It was WARN-only and exited 0 at every gap count — so when ADR-0195 added the
 * `ci:affected` script with no process behind it, the bijection broke on `main` and stayed broken for
 * thirteen days without failing anything. The ceiling itself, the measured evidence, and both axes'
 * baselines live in `surface-coverage-drain.ts`; this module is unchanged in what it COMPUTES, and the
 * OK/WARN levels below are unchanged — RED is layered above them by the thin shell.
 *
 * ─── The `surfaces`-names-an-entrypoint convention (ADR-0154 left the grammar to this unit) ───
 * A `process`'s `surfaces` prose names each enacting entrypoint as a BACKTICK span. A span is read as
 * an entrypoint reference when it is one of:
 *   • `` `storytree <area> …` `` (also `` `pnpm storytree <area> …` ``) → the CLI area `storytree <area>`
 *       (resolved at AREA granularity — trailing sub-verbs/flags are ignored).
 *   • `` `pnpm <script> …` `` → the root script `pnpm <script>` (first token after `pnpm`).
 *   • `` `pnpm --filter <app> <script> …` `` → the per-app script `pnpm --filter <app> <script>`.
 *   • a LENIENT bare `` `<script>` `` span that EXACTLY equals a known root script name (e.g.
 *       `` `studio:up` ``) → `pnpm <script>`. Script names are distinctive tokens, so this is
 *       unambiguous; a bare AREA name (a common English word) is NOT recognised — areas need the
 *       explicit `storytree` prefix.
 * Every other backtick span (file paths, table/CI words, flags like `--pg`) is ordinary prose and
 * ignored. So the six existing agent-ceremony processes — whose `surfaces` name no launcher — simply
 * contribute no refs, and the operational launchers Unit-3 backfills will name theirs canonically.
 *
 * The gate reads the LIVE store for its `process` tier (ADR-0302 D1). It read the committed seed
 * until that decision, which made it DB-free but also made it judge a MIRROR: a process authored
 * live lagged here until an export ceremony ran, and those ceremonies are deleted (ADR-0302 D4). It
 * still runs identically local + CI — CI now holds the credential (ADR-0302 D3) — and the
 * entrypoints half is still pure disk (`package.json`), so only the process half moved.
 *
 * Pure-by-injection: {@link parseSurfaceRefs} / {@link classifySurfaceCoverage} /
 * {@link formatSurfaceCoverage} are deterministic over their inputs (offline-testable with fixtures);
 * {@link loadSurfaceCoverageInputs} is the only I/O, and the thin `check-surface-coverage.ts`
 * entrypoint is the only place that runs the sweep, prints, and exits 0.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Store } from "@storytree/storage-protocol";

import { CLI_AREAS } from "./cli-areas.js";

const TAG = "[check:surface-coverage]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which surface namespace an entrypoint lives in (only for reporting/grouping). */
export type EntrypointNamespace = "cli" | "pnpm" | "pnpm-app";

/** One enumerated operator surface. `id` is the canonical form a `surfaces` ref normalises to. */
export interface Entrypoint {
  /** Canonical id: `storytree <area>` | `pnpm <script>` | `pnpm --filter <app> <script>`. */
  id: string;
  /** The namespace it came from (reporting only). */
  namespace: EntrypointNamespace;
  /**
   * Whether it participates in orphan detection (b). CLI areas are enumerated as RESOLUTION targets
   * for (a) but are NOT orphan-checked in this first cut — deriving the command STRUCTURE from the
   * process graph (every area traces to a process) is the ADR-0154 deferred `next:`-graph follow-on.
   * Internal gate/generator scripts (`check:*`, `build:*`, `sync:*`, the raw `-r` dev verbs) are
   * mechanics of the gate/merge ceremony, not standalone ways-of-working, so they are excluded too.
   */
  orphanChecked: boolean;
}

/** A process's parsed surface refs (its `surfaces` prose already reduced to canonical entrypoint ids). */
export interface ProcessSurfaces {
  /** The process artifact id. */
  id: string;
  /** Canonical entrypoint refs named in its `surfaces` field (deduped, in first-seen order). */
  refs: string[];
  /**
   * `storytree …` invocations this process PRESCRIBES in its four prescriptive fields — the (c) axis
   * (see {@link PRESCRIPTIVE_PROCESS_FIELDS}). Absent on inputs built before the axis existed, which
   * simply contributes no (c) findings.
   */
  prescribed?: PrescribedCommand[];
}

/** A named surface that resolves to no real entrypoint — a fix-the-ref-or-add-the-entrypoint gap. */
export interface UnresolvedSurface {
  processId: string;
  ref: string;
}

/** The whole sweep result. */
export interface SurfaceCoverageReport {
  /** (a) named surfaces resolving to no entrypoint, in scan order. */
  unresolved: UnresolvedSurface[];
  /** (b) orphan-checked entrypoints named by no process — the backfill worklist, in enum order. */
  orphans: string[];
  /** (c) prescribed `storytree …` commands the mounted register no longer accepts, in scan order. */
  danglingCommands: DanglingCommand[];
  /** How many processes were scanned. */
  processCount: number;
  /** How many entrypoints were enumerated. */
  entrypointCount: number;
  /** True iff all three gaps are empty. */
  clean: boolean;
}

// ---------------------------------------------------------------------------
// Pure parse: `surfaces` prose → canonical entrypoint refs
// ---------------------------------------------------------------------------

const BACKTICK_SPAN = /`([^`]+)`/g;

/**
 * PURE: extract the canonical entrypoint refs a process's `surfaces` prose names, per the convention
 * documented in this file's header. `knownScripts` enables the lenient bare-script-token form (a
 * backtick span that is exactly a known root script name); omit it to recognise only the explicit
 * `storytree …` / `pnpm …` prefixed forms. Deterministic; deduped in first-seen order.
 */
export function parseSurfaceRefs(prose: string, knownScripts: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  for (const m of prose.matchAll(BACKTICK_SPAN)) {
    const span = (m[1] ?? "").trim();
    if (span === "") continue;
    let toks = span.split(/\s+/).filter((t) => t !== "");
    if (toks.length === 0) continue;

    // `pnpm storytree <area> …` is a CLI-area ref — drop the pnpm forwarder so the two forms unify.
    if (toks[0] === "pnpm" && toks[1] === "storytree") toks = toks.slice(1);

    if (toks[0] === "storytree") {
      const area = toks[1];
      // A `storytree <area>` ref resolves at area granularity; a bare `storytree` or `storytree --flag`
      // names no area, so it is not a ref. An unknown area is still emitted → flagged unresolved.
      if (area !== undefined && !area.startsWith("-")) push(`storytree ${area}`);
      continue;
    }

    if (toks[0] === "pnpm") {
      if (toks[1] === "--filter") {
        const app = toks[2];
        const script = toks[3];
        if (app !== undefined && script !== undefined) push(`pnpm --filter ${app} ${script}`);
      } else if (toks[1] !== undefined && !toks[1].startsWith("-")) {
        push(`pnpm ${toks[1]}`);
      }
      continue;
    }

    // Lenient bare form: a single-token span that is EXACTLY a known root script (e.g. `studio:up`).
    const only = toks[0];
    if (toks.length === 1 && only !== undefined && knownScripts.has(only)) push(`pnpm ${only}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (c) Prescriptive fields → prescribed `storytree …` commands
//
// WHY THIS AXIS EXISTS. Axis (a) reads ONE field — `surfaces` — and resolves it at AREA granularity,
// so `storytree library export-corpus` resolved as long as `library` was still an area. PR #1148
// (ADR-0302 D4 / ADR-0307) deleted three Library verbs — `library sync-agents`, `library sync-corpus`,
// `library export-corpus` — and both `library-edit-ceremony` and `retire-realized-proposal` went on
// prescribing them in their PROSE while every rung stayed green. Twice over, which is what makes it
// a detectable class rather than an incident: an operator following a green process artifact runs a
// command that no longer exists.
//
// ─── THE RECOGNITION RULE, and what it deliberately does NOT match ───────────────────────────────
// A backtick span in a prescriptive field is read as a command reference ONLY when, after stripping
// an env-var assignment prefix and one recognised forwarder (`pnpm`, `pnpm --silent`/`-s`,
// `npx tsx packages/cli/src/main.ts`, `node packages/cli/launch.mjs`), its first token is exactly
// `storytree`. The command PATH is then the run of following tokens that are bare command words
// (`^[a-z][a-z0-9:-]*$`); the first token that is not — a flag, a `<placeholder>`, a quoted arg, a
// path, `|`, `&&`, an ellipsis — ENDS the path, because everything after it is argument territory.
//
// It therefore does NOT match, by construction and on purpose:
//   • any other tool — `git`, `gh`, `gcloud`, `docker`, `curl`, `node`, `npx` (bar the one exact
//     `main.ts` form). Their inventories are not ours to know.
//   • a bare `pnpm <script>` span. Root scripts have a clean inventory, but `pnpm install` /
//     `pnpm add` / `pnpm -r test` are pnpm builtins, not scripts, so checking them would need a
//     hand-kept allow-list — a false-positive engine. Axis (a) already covers `pnpm <script>` in
//     `surfaces`, where the author has DECLARED it an entrypoint.
//   • a BARE token naming a command — `` `sync-corpus` ``, `` `export-corpus` ``,
//     `` `check:corpus-content` ``. This is the load-bearing exclusion: today's live corpus names
//     all three deleted ceremonies, in prose that says they are GONE. Prose ABOUT a command is not
//     a prescription OF it, and only the fully-qualified invocation form is read as one.
//   • ordinary prose, file paths, field names, flags — nothing outside a backtick span is read at all.
//
// ─── THE RESOLUTION RULE ─────────────────────────────────────────────────────────────────────────
// The path is resolved against the MOUNTED REGISTER derived from the CLI's own sources (see
// {@link deriveCommandRegister}) — never a hand-kept list, so a deleted verb leaves the register in
// the same commit that deletes it. Resolution is conservative at every fork: the area is judged
// against `CLI_AREAS`; below it, an advertised `<placeholder>` at a position ABSORBS that token and
// everything after it (this is what keeps `storytree library artifact <some-artifact-id>` and
// `storytree agents <some-agent-name>` from reading as unknown verbs), and a register node with no
// children accepts the rest rather than guessing. A token is reported ONLY when the register knows
// siblings at that exact position and this one is not among them.
// ---------------------------------------------------------------------------

/** The `process` fields whose prose PRESCRIBES commands to an operator (ADR-0154's (c) axis). */
export const PRESCRIPTIVE_PROCESS_FIELDS = ["statement", "steps", "verification", "failureModes"] as const;

/** One `storytree …` invocation a process prescribes, and where it says it. */
export interface PrescribedCommand {
  /** The `process` field it was read from — a member of {@link PRESCRIPTIVE_PROCESS_FIELDS}. */
  field: string;
  /** The command path BELOW `storytree`, e.g. `["library", "export-corpus"]`. Never empty. */
  path: string[];
  /** The canonical rendering, e.g. `storytree library export-corpus`. */
  ref: string;
}

/** A prescribed command the mounted register does not accept, with the process that prescribes it. */
export interface DanglingCommand extends PrescribedCommand {
  /** The process artifact id. */
  processId: string;
  /** The token that failed to resolve (the area, or the verb at the diverging position). */
  token: string;
}

/**
 * One node of the mounted command register: the tokens the CLI advertises at this position, and
 * whether it advertises a free-form ARGUMENT here (a `<placeholder>`), which absorbs any token.
 */
export interface CommandNode {
  children: Map<string, CommandNode>;
  wildcard: boolean;
}

const BARE_COMMAND_WORD = /^[a-z][a-z0-9:-]*$/;
const PLACEHOLDER = /^[[<]/;
const ENV_ASSIGNMENT = /^[A-Z][A-Z0-9_]*=/;

function newCommandNode(): CommandNode {
  return { children: new Map(), wildcard: false };
}

/**
 * PURE: the tokens of a `storytree` invocation, with any env-var prefix and one recognised forwarder
 * stripped — or `undefined` when the span is not a `storytree` invocation at all. See the rule above.
 */
export function storytreeInvocationTokens(span: string): string[] | undefined {
  let toks = span.trim().split(/\s+/).filter((t) => t !== "");
  while (toks[0] !== undefined && ENV_ASSIGNMENT.test(toks[0])) toks = toks.slice(1);
  if (toks[0] === "pnpm") {
    toks = toks.slice(1);
    while (toks[0] === "--silent" || toks[0] === "-s") toks = toks.slice(1);
  } else if (toks[0] === "npx" && toks[1] === "tsx" && toks[2] === "packages/cli/src/main.ts") {
    toks = ["storytree", ...toks.slice(3)];
  } else if (toks[0] === "node" && toks[1] === "packages/cli/launch.mjs") {
    toks = ["storytree", ...toks.slice(2)];
  }
  return toks[0] === "storytree" ? toks : undefined;
}

/** PURE: the bare-command-word run following `storytree`, i.e. the resolvable command path. */
function commandPathOf(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tokens.slice(1)) {
    if (!BARE_COMMAND_WORD.test(t)) break;
    out.push(t);
  }
  return out;
}

/**
 * PURE: every `storytree …` command a field's prose prescribes, deduped in first-seen order.
 * `field` is carried through so a finding names the field, not just the process.
 */
export function parsePrescribedCommands(field: string, prose: string): PrescribedCommand[] {
  const out: PrescribedCommand[] = [];
  const seen = new Set<string>();
  for (const m of prose.matchAll(BACKTICK_SPAN)) {
    const tokens = storytreeInvocationTokens(m[1] ?? "");
    if (tokens === undefined) continue;
    const commandPath = commandPathOf(tokens);
    if (commandPath.length === 0) continue; // a bare `storytree` / `storytree --help` names nothing
    const ref = `storytree ${commandPath.join(" ")}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ field, path: commandPath, ref });
  }
  return out;
}

/**
 * PURE: blank out line comments and block comments so only CODE (string literals included)
 * contributes to the register.
 *
 * THIS IS THE DECISIVE HALF OF THE DERIVATION, not tidiness. All three verbs PR #1148 deleted
 * still appear in `commands.ts` TODAY — in comments explaining that they are gone. A register built
 * over raw source would re-mount every command the codebase merely REMEMBERS, and this axis would
 * silently never fire. Line-oriented and deliberately simple (this module has no parser, by design):
 * a `//` inside a string literal ends the line early, which can only DROP register entries — the
 * permissive direction for a check whose failure mode to avoid is a false positive.
 */
export function stripSourceComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlocks
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * PURE: build the mounted command register from CLI source TEXT (injected, so this is offline-
 * testable). Every `storytree …` span the code itself carries — the per-area help listings, the
 * `next:` offers, the refusal hints — is an advertisement of a real command path, and they are
 * authored beside the dispatch they describe: PR #1148 deleted the three verbs' dispatch arms and
 * their help lines in the same commit, which is exactly the coupling this axis rests on.
 *
 * DELIBERATELY OVER-BROAD. Descriptive words trailing a usage line ("… `<id>`  view one artifact")
 * enter the register too. That only ever ADDS accepted tokens, so it cannot manufacture a finding —
 * and the tokens that matter here are absent from every string literal, which is what makes the
 * derivation sound.
 */
export function deriveCommandRegister(sources: readonly string[]): CommandNode {
  const root = newCommandNode();
  for (const source of sources) {
    const code = stripSourceComments(source);
    for (const m of code.matchAll(/\bstorytree\b/g)) {
      const rest = code.slice((m.index ?? 0) + "storytree".length);
      let node = root;
      for (const tok of rest.split(/\s+/)) {
        if (tok === "") continue;
        if (PLACEHOLDER.test(tok)) {
          node.wildcard = true; // an argument lives here: it absorbs this token and everything after
          break;
        }
        if (!BARE_COMMAND_WORD.test(tok)) break;
        let next = node.children.get(tok);
        if (next === undefined) {
          next = newCommandNode();
          node.children.set(tok, next);
        }
        node = next;
      }
    }
  }
  return root;
}

/**
 * Read every non-test `.ts` under each given `src/` — the sources {@link deriveCommandRegister} reads.
 *
 * ⚠ VARIADIC BECAUSE THE MOUNTED SURFACE IS NO LONGER ONE PACKAGE. `arc-tier-extraction-arc` moved
 * `arc.ts` / `increment.ts` / `question.ts` into `@storytree/arc`, so a register derived from
 * `packages/cli/src` alone stops mounting `storytree arc …` and every process prescribing an arc verb
 * reads as dangling. The register must be derived from every package that CONTRIBUTES verbs to the
 * one dispatcher, not from the package the dispatcher happens to live in.
 */
export function readCliSources(...srcDirs: string[]): string[] {
  return srcDirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .sort()
      .map((f) => readFileSync(path.join(dir, f), "utf8")),
  );
}

/**
 * PURE: does the register accept this command path? Returns the DIVERGING token when it does not.
 *
 * Conservative at every fork — see the resolution rule above. The area is judged against
 * `CLI_AREAS`; a wildcard absorbs the rest; an unadvertised area, or a register node with no
 * children, accepts the rest rather than guessing.
 */
export function resolveCommandPath(
  register: CommandNode,
  commandPath: readonly string[],
  areas: ReadonlySet<string> = new Set(CLI_AREAS),
): { ok: true } | { ok: false; token: string } {
  const area = commandPath[0];
  if (area === undefined) return { ok: true };
  if (!areas.has(area)) return { ok: false, token: area };

  let node = register.children.get(area);
  if (node === undefined) return { ok: true }; // a real area the sources never spell out — nothing to check
  for (const tok of commandPath.slice(1)) {
    if (node.wildcard) return { ok: true }; // argument territory
    const next = node.children.get(tok);
    if (next === undefined) {
      // Nothing advertised at this position at all ⇒ the register is silent, so accept. Siblings
      // advertised but not this one ⇒ the register knows this position and rejects the token.
      return node.children.size === 0 ? { ok: true } : { ok: false, token: tok };
    }
    node = next;
  }
  return { ok: true };
}

/** PURE: every prescribed command in the scanned processes that the register does not accept. */
export function classifyPrescribedCommands(input: {
  processes: readonly ProcessSurfaces[];
  register: CommandNode;
  areas?: ReadonlySet<string>;
}): DanglingCommand[] {
  const areas = input.areas ?? new Set(CLI_AREAS);
  const out: DanglingCommand[] = [];
  for (const p of input.processes) {
    for (const cmd of p.prescribed ?? []) {
      const verdict = resolveCommandPath(input.register, cmd.path, areas);
      if (!verdict.ok) out.push({ ...cmd, processId: p.id, token: verdict.token });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure classify + format
// ---------------------------------------------------------------------------

/**
 * PURE: compute the bijection. (a) a process ref not in the enumerated entrypoint id set is
 * `unresolved`; (b) an `orphanChecked` entrypoint named by no process is an `orphan`. Deterministic
 * and order-preserving.
 */
export function classifySurfaceCoverage(input: {
  processes: readonly ProcessSurfaces[];
  entrypoints: readonly Entrypoint[];
  /** The mounted register for axis (c). Omit to skip it — the two original axes are unaffected. */
  register?: CommandNode;
}): SurfaceCoverageReport {
  const validIds = new Set(input.entrypoints.map((e) => e.id));
  const named = new Set<string>();
  const unresolved: UnresolvedSurface[] = [];

  for (const p of input.processes) {
    for (const ref of p.refs) {
      if (validIds.has(ref)) named.add(ref);
      else unresolved.push({ processId: p.id, ref });
    }
  }

  const orphans = input.entrypoints.filter((e) => e.orphanChecked && !named.has(e.id)).map((e) => e.id);

  const danglingCommands =
    input.register === undefined
      ? []
      : classifyPrescribedCommands({ processes: input.processes, register: input.register });

  return {
    unresolved,
    orphans,
    danglingCommands,
    processCount: input.processes.length,
    entrypointCount: input.entrypoints.length,
    clean: unresolved.length === 0 && orphans.length === 0 && danglingCommands.length === 0,
  };
}

export interface FormatSurfaceCoverageResult { warn: boolean; lines: string[] }

/**
 * PURE: render the sweep as console lines + a `warn` flag. WARN names both gap lists (the backfill
 * worklist); OK reports the covered counts. NEVER throws or exits — the caller prints, then applies
 * the drain ceiling (`surface-coverage-drain.ts`) to decide the exit code. These two levels are
 * UNCHANGED by that ceiling: RED is layered above them, never a band opened beneath.
 */
export function formatSurfaceCoverage(report: SurfaceCoverageReport): FormatSurfaceCoverageResult {
  if (report.clean) {
    return {
      warn: false,
      lines: [
        `${TAG} OK — every process names a real entrypoint and every operator-facing entrypoint has a ` +
          `process (${report.processCount} processes, ${report.entrypointCount} entrypoints).`,
      ],
    };
  }
  const lines = [
    `${TAG} WARN — the process↔entrypoint bijection has gaps (ADR-0154). This is the process-tier ` +
      "backfill worklist; it reds the gate above its drain ceiling (surface-coverage-drain.ts).",
  ];
  if (report.unresolved.length > 0) {
    lines.push(
      `${TAG}   ${report.unresolved.length} named surface(s) resolve to NO entrypoint ` +
        "(fix the `surfaces` ref, or add the entrypoint):",
    );
    for (const u of report.unresolved) lines.push(`${TAG}     ${u.processId} → "${u.ref}"`);
  }
  if (report.orphans.length > 0) {
    lines.push(
      `${TAG}   ${report.orphans.length} operator-facing entrypoint(s) have NO process ` +
        "(author a `process` deriving from its ADR, or retire the entrypoint):",
    );
    for (const o of report.orphans) lines.push(`${TAG}     ${o}`);
  }
  if (report.danglingCommands.length > 0) {
    lines.push(
      `${TAG}   ${report.danglingCommands.length} PRESCRIBED command(s) the CLI no longer mounts ` +
        "(an operator following the process runs a command that does not exist):",
    );
    for (const d of report.danglingCommands) {
      lines.push(`${TAG}     ${d.processId}.${d.field} → "${d.ref}" (unknown: ${d.token})`);
    }
  }
  return { warn: true, lines };
}

// ---------------------------------------------------------------------------
// Injectable runner (the input loader is the seam)
// ---------------------------------------------------------------------------

/** Everything the runner reads, injected for offline testability (the disk loader is the seam). */
export interface SurfaceCoverageDeps {
  loadInputs: () => Promise<{
    processes: ProcessSurfaces[];
    entrypoints: Entrypoint[];
    /** The mounted register for axis (c); omitted by fixtures that only exercise (a)/(b). */
    register?: CommandNode;
  }>;
}

/**
 * The injectable gate runner: load → classify → format. Pure-by-injection. The classified `report` is
 * returned alongside the rendered lines so the shell can apply the drain ceiling to the same sweep
 * without re-running it (`surface-coverage-drain.ts`).
 */
export async function runSurfaceCoverageGate(deps: SurfaceCoverageDeps): Promise<{
  warn: boolean;
  lines: string[];
  report: SurfaceCoverageReport;
}> {
  const report = classifySurfaceCoverage(await deps.loadInputs());
  return { ...formatSurfaceCoverage(report), report };
}

// ---------------------------------------------------------------------------
// Entrypoint enumeration (the operator-facing surface set)
// ---------------------------------------------------------------------------

/**
 * The operator-facing per-app launchers (ADR-0154): scripts an operator/agent runs to LAUNCH an app,
 * discoverable only via `pnpm --filter`. Kept as a small documented allow-list (not every per-app
 * script — most are internal); a launcher process names one of these in its `surfaces`.
 */
export const PER_APP_ENTRYPOINTS: readonly { app: string; script: string }[] = [
  { app: "studio", script: "dev" }, // ADR-0042 launch-studio (the Vite dev server)
  { app: "desktop", script: "start" }, // ADR-0109/0111 launch-desktop (the Electron client — the originating drift)
];

/**
 * PURE: is a root script INTERNAL — a mechanic of the gate/merge ceremony rather than a standalone
 * way-of-working? Such scripts are enumerated (so a process MAY still name them) but are not
 * orphan-checked, keeping the orphan worklist to real operator launchers. The `storytree` forwarder is
 * excluded because the CLI is represented by its AREAS instead (`storytree <area>`).
 */
export function isInternalScript(name: string): boolean {
  return (
    name.startsWith("check:") || // gate verification steps
    name.startsWith("build:") || // generators the gate runs
    name.startsWith("sync:") || // web-engine sync (gate/CD mechanic)
    name === "storytree" || // the CLI forwarder — represented by the CLI areas
    name === "build" ||
    name === "typecheck" ||
    name === "test" || // the `-r` dev/CI verbs (mechanics of the gate/merge ceremony)
    name === "sync" // the `git rebase origin/main` shortcut
  );
}

/**
 * PURE: enumerate every entrypoint from the CLI areas + the root `package.json` script names + the
 * per-app allow-list. CLI areas are resolution targets only (not orphan-checked — the deferred
 * `next:`-graph follow-on); operator-facing scripts + per-app launchers are orphan-checked.
 */
export function enumerateEntrypoints(scriptNames: readonly string[]): Entrypoint[] {
  const eps: Entrypoint[] = [];
  for (const area of CLI_AREAS) {
    eps.push({ id: `storytree ${area}`, namespace: "cli", orphanChecked: false });
  }
  for (const s of scriptNames) {
    eps.push({ id: `pnpm ${s}`, namespace: "pnpm", orphanChecked: !isInternalScript(s) });
  }
  for (const { app, script } of PER_APP_ENTRYPOINTS) {
    eps.push({ id: `pnpm --filter ${app} ${script}`, namespace: "pnpm-app", orphanChecked: true });
  }
  return eps;
}

// ---------------------------------------------------------------------------
// Disk enumeration (parameterized I/O — the production `loadInputs`)
// ---------------------------------------------------------------------------

/** The `process` fields this gate reads off a stored library doc. */
interface ProcessDocLike {
  surfaces?: unknown;
  statement?: unknown;
  steps?: unknown;
  verification?: unknown;
  failureModes?: unknown;
}

/**
 * Load the gate inputs: the operator entrypoints from `package.json` (+ CLI areas + per-app
 * allow-list) — pure disk — and the process refs from the LIVE store (ADR-0302 D1; it read the
 * committed seed until that decision). The `package.json` path is injected so the thin entrypoint
 * resolves it against the repo root; the store is injected so this stays testable without a DB.
 */
export async function loadSurfaceCoverageInputs(opts: {
  store: Store;
  packageJsonPath: string;
  /**
   * Every `src/` that contributes verbs to the one dispatcher — the mounted register for axis (c) is
   * derived from all of them. Omit (or pass an empty list) to load the two original axes only, which
   * is what a fixture-only caller wants. Plural since `arc-tier-extraction-arc` split the verb
   * surface across `@storytree/cli` and `@storytree/arc`.
   */
  cliSrcDirs?: readonly string[];
}): Promise<{ processes: ProcessSurfaces[]; entrypoints: Entrypoint[]; register?: CommandNode }> {
  const pkg = JSON.parse(readFileSync(opts.packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const scriptNames = Object.keys(pkg.scripts ?? {});
  const knownScripts = new Set(scriptNames);
  const entrypoints = enumerateEntrypoints(scriptNames);

  const processes: ProcessSurfaces[] = [];
  for (const d of await opts.store.queryDocs({ kind: "process" })) {
    const doc = d.doc as ProcessDocLike;
    const surfaces = typeof doc.surfaces === "string" ? doc.surfaces : "";
    const prescribed: PrescribedCommand[] = [];
    for (const field of PRESCRIPTIVE_PROCESS_FIELDS) {
      const prose = doc[field];
      if (typeof prose === "string") prescribed.push(...parsePrescribedCommands(field, prose));
    }
    processes.push({ id: d.id, refs: parseSurfaceRefs(surfaces, knownScripts), prescribed });
  }
  return opts.cliSrcDirs === undefined || opts.cliSrcDirs.length === 0
    ? { processes, entrypoints }
    : {
        processes,
        entrypoints,
        register: deriveCommandRegister(readCliSources(...opts.cliSrcDirs)),
      };
}
