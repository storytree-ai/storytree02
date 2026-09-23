// The gate's checks, FOUND rather than listed (ADR-0606 D1, D2, D6).
//
// A gate check is a FILE named `check-<name>.ts` or `<name>-check.ts`, anywhere in a workspace
// project, and it OPENS with a declaration of itself — read here as text, never by importing the
// check, because several checks act on import and four exit the process when they do:
//
//     /* gate-check
//     runs: both                  # both | local | ci — which runs execute it (ADR-0606 D3/D4)
//     subject: own-work           # own-work | shared-environment — whose a red can be (gate-order.ts)
//     cost: seconds               # seconds | minutes
//     ciIdentity: ci-presence     # only for a check that reads the live store (ADR-0560's split)
//     skip:                       # only for a check that may exit 3 (`GATE_SKIP_EXIT_CODE`)
//       when: <the condition under which it verifies nothing>
//       inCi: failure             # failure | accepted — what a CI run makes of that skip
//     runsBefore: [check:<name>]  # only for a real dependency
//     why: <why it exists — the catch that justified it>
//     */
//
// A RETIRED check keeps its file (ADR-0311 D5: re-wiring stays cheap) and says so itself (D6):
//
//     /* gate-check
//     retired: ADR-0311 D2        # the decision that retired it
//     sources: [helper.ts]        # other files it left behind, beside it, each bannered UNWIRED
//     */
//
// Writing the file is the whole registration: the name comes from the FILE NAME, so there is no
// second place for it to be spelled. A file named like a check whose declaration is missing or
// malformed is REFUSED, loudly — never run on a guess and never skipped in silence. The one risk the
// convention cannot close is the one test files have always carried: a check renamed AWAY from the
// pattern drops out (ADR-0606's accepted cost).
//
// ORDER IS DERIVED (D2). The gate's fixed legs stay where they are — `pnpm lint` first, the two `-r`
// legs as the wall, the studio build after the own-work checks — and each check lands in the block
// its declared subject and cost put it in, in name order, moved only by a `runsBefore`. Both ordering
// axes therefore hold by construction rather than by a hand-arranged list and a second set checking it.
//
// Pure except {@link discoverChecks}, which lists the working tree through git and reads the files.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import type {
  BuiltInLegs,
  CiIdentity,
  GateCost,
  GatePlacement,
  GatePlanStep,
  GateSubject,
  StepSkip,
} from "./gate-order.js";

/** The first line of every declaration — exactly this, at the top of the file. */
export const DECLARATION_OPENER = "/* gate-check";

/** The line that ends a declaration — exactly this, alone on its line. */
export const DECLARATION_CLOSER = "*/";

/** A check's name, as every surface prints it: `check:` and a kebab-case stem. */
export const CHECK_NAME = /^check:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a live check says about itself. */
export interface LiveCheckDeclaration {
  readonly status: "live";
  readonly runs: GatePlacement;
  readonly subject: GateSubject;
  readonly cost: GateCost;
  /** The identity it signs in as under `--ci`; absent for a check that reads no store. */
  readonly ciIdentity: CiIdentity | undefined;
  /** When it may exit 3, and what CI makes of that — absent for a check that never does. */
  readonly skip: StepSkip | undefined;
  /** Checks that must run after this one — declared only for a real dependency. */
  readonly runsBefore: readonly string[];
  readonly why: string;
}

/** What a retired check says about itself (ADR-0606 D6). */
export interface RetiredCheckDeclaration {
  readonly status: "retired";
  /** The decision that retired it, e.g. `ADR-0311 D2`. */
  readonly retiredBy: string;
  /** Other files it left behind, named relative to its own directory. */
  readonly sources: readonly string[];
}

export type CheckDeclaration = LiveCheckDeclaration | RetiredCheckDeclaration;

/** A declaration read, or the reason it could not be. */
export type DeclarationRead =
  | { readonly ok: true; readonly declaration: CheckDeclaration }
  | { readonly ok: false; readonly reason: string };

/** Free text that must say something. */
const prose = z.string().trim().min(1);

const LIVE_DECLARATION = z
  .object({
    runs: z.enum(["both", "local", "ci"]),
    subject: z.enum(["own-work", "shared-environment"]),
    cost: z.enum(["seconds", "minutes"]),
    ciIdentity: z.enum(["ci-presence", "ci-webverdict"]).optional(),
    skip: z.object({ when: prose, inCi: z.enum(["failure", "accepted"]) }).strict().optional(),
    runsBefore: z.array(z.string().regex(CHECK_NAME)).optional(),
    why: prose,
  })
  .strict();

const RETIRED_DECLARATION = z
  .object({
    retired: prose,
    sources: z.array(z.string().regex(/^[\w.-]+\.ts$/)).optional(),
  })
  .strict();

/** Every zod issue, one clause each, naming the key it is about. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(the whole declaration)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Read the declaration a check file opens with. Strict everywhere: the opener must be the file's
 * first line, the closer must stand alone, the body must be YAML with no error AND no warning, and
 * the keys must be exactly the ones above — an unknown key is a typo until proven otherwise.
 */
export function readCheckDeclaration(source: string): DeclarationRead {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== DECLARATION_OPENER) {
    return {
      ok: false,
      reason:
        `it does not open with \`${DECLARATION_OPENER}\` — a gate check declares itself on its ` +
        "first line, before anything else (ADR-0606 D1)",
    };
  }
  const closer = lines.indexOf(DECLARATION_CLOSER);
  if (closer === -1) {
    return {
      ok: false,
      reason: `its declaration never closes — no line reads exactly \`${DECLARATION_CLOSER}\``,
    };
  }
  const document = parseDocument(lines.slice(1, closer).join("\n"));
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem !== undefined) {
    return { ok: false, reason: `its declaration is not clean YAML: ${problem.message.split("\n")[0]}` };
  }
  const raw: unknown = document.toJS();
  if (typeof raw === "object" && raw !== null && "retired" in raw) {
    const retired = RETIRED_DECLARATION.safeParse(raw);
    if (!retired.success) {
      return { ok: false, reason: `its retired declaration is malformed — ${describeIssues(retired.error)}` };
    }
    return {
      ok: true,
      declaration: {
        status: "retired",
        retiredBy: retired.data.retired,
        sources: retired.data.sources ?? [],
      },
    };
  }
  const live = LIVE_DECLARATION.safeParse(raw);
  if (!live.success) {
    return { ok: false, reason: `its declaration is malformed — ${describeIssues(live.error)}` };
  }
  return {
    ok: true,
    declaration: {
      status: "live",
      runs: live.data.runs,
      subject: live.data.subject,
      cost: live.data.cost,
      ciIdentity: live.data.ciIdentity,
      skip: live.data.skip,
      runsBefore: live.data.runsBefore ?? [],
      why: live.data.why,
    },
  };
}

/**
 * The check a file's NAME makes it — `check-<stem>.ts` or `<stem>-check.ts` → `check:<stem>` — or
 * `undefined` for a file that is not named like a check at all. A test file never is.
 *
 * The stem is not validated here: a file named like a check whose stem is not kebab-case is still
 * check-SHAPED, and {@link findCheckFiles} refuses it rather than ignoring it.
 */
export function checkNameFor(basename: string): string | undefined {
  if (basename.endsWith(".test.ts")) return undefined;
  // The second pattern needs no `^`: `(.+)` already reaches back to the start of the name.
  const stem = /^check-(.+)\.ts$/.exec(basename)?.[1] ?? /(.+)-check\.ts$/.exec(basename)?.[1];
  return stem === undefined ? undefined : `check:${stem}`;
}

/** A file the gate treats as a check. */
export interface CheckFile {
  /** `check:<stem>`, from the file name. */
  readonly name: string;
  /** Repo-relative, forward slashes. */
  readonly path: string;
  /** The workspace project directory it runs from, repo-relative (e.g. `packages/cli`). */
  readonly workspace: string;
}

/** A check-shaped file the gate will not run, and why. */
export interface CheckRefusal {
  readonly path: string;
  readonly reason: string;
}

export interface CheckFiles {
  /** In name order. */
  readonly files: readonly CheckFile[];
  readonly refused: readonly CheckRefusal[];
}

/**
 * Pick the check files out of a listing of repo-relative paths, each assigned to the workspace
 * project it lives in. Refuses a check-shaped file whose name is not a valid check name, one outside
 * every workspace (there is no directory to run it from), and every file of a name two files share.
 */
export function findCheckFiles(paths: readonly string[], workspaces: readonly string[]): CheckFiles {
  const found: CheckFile[] = [];
  const refused: CheckRefusal[] = [];
  for (const file of paths) {
    const name = checkNameFor(path.posix.basename(file));
    if (name === undefined) continue;
    if (!CHECK_NAME.test(name)) {
      refused.push({
        path: file,
        reason: `it is named like a gate check, but \`${name}\` is not a kebab-case check name`,
      });
      continue;
    }
    const workspace = workspaces.find((dir) => file.startsWith(`${dir}/`));
    if (workspace === undefined) {
      refused.push({
        path: file,
        reason: "it sits outside every workspace project, so there is no directory to run it from",
      });
      continue;
    }
    found.push({ name, path: file, workspace });
  }
  const files: CheckFile[] = [];
  for (const file of found) {
    const twins = found.filter((other) => other.name === file.name);
    if (twins.length > 1) {
      refused.push({
        path: file.path,
        reason: `${twins.length} files are named as \`${file.name}\`: ${twins.map((t) => t.path).join(", ")}`,
      });
    } else {
      files.push(file);
    }
  }
  return { files: files.sort((a, b) => a.name.localeCompare(b.name, "en")), refused };
}

/** A found check and what it declares. */
export interface LiveCheck extends CheckFile {
  readonly declaration: LiveCheckDeclaration;
}

export interface RetiredCheck extends CheckFile {
  readonly declaration: RetiredCheckDeclaration;
}

/** Every check the working tree holds, split by what each declared. */
export interface CheckDiscovery {
  /** In name order. */
  readonly live: readonly LiveCheck[];
  /** In name order. */
  readonly retired: readonly RetiredCheck[];
  readonly refused: readonly CheckRefusal[];
}

/**
 * Split found files by their declarations. `read` returns a file's text, or `undefined` for a file
 * listed but no longer on disk (deleted in the working tree and not yet committed — not a check).
 */
export function sortDeclaredChecks(
  found: CheckFiles,
  read: (file: CheckFile) => string | undefined,
): CheckDiscovery {
  const live: LiveCheck[] = [];
  const retired: RetiredCheck[] = [];
  const refused: CheckRefusal[] = [...found.refused];
  for (const file of found.files) {
    const source = read(file);
    if (source === undefined) continue;
    const result = readCheckDeclaration(source);
    if (!result.ok) refused.push({ path: file.path, reason: result.reason });
    else if (result.declaration.status === "live") live.push({ ...file, declaration: result.declaration });
    else retired.push({ ...file, declaration: result.declaration });
  }
  return { live, retired, refused };
}

/**
 * Every check in the working tree under `workspaces` (repo-relative project directories): the files
 * git would commit — tracked, plus untracked-but-not-ignored, so a check being written counts before
 * it is committed and nothing in `node_modules` ever does.
 *
 * THROWS when git cannot list the tree: a discovery that could not look has found nothing, and an
 * empty plan read as a clean one is exactly the failure this module exists to remove.
 */
export function discoverChecks(repoRoot: string, workspaces: readonly string[]): CheckDiscovery {
  // ~110 KB for the whole repo (2026-09-24, 2,336 paths) — far inside spawnSync's default buffer.
  const listing = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...workspaces],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (listing.status !== 0) {
    // A git that could not even start leaves `error` set and no stderr at all.
    const why = listing.error?.message ?? listing.stderr.split("\n")[0];
    throw new Error(
      `the gate could not list its checks: git ls-files exited ${String(listing.status)} — ${why}`,
    );
  }
  // An EMPTY listing is not "no checks": git answers exit 0 with nothing from a directory it ignores
  // (the mutation rung's `.stryker-tmp/` copy is the measured case) or one that holds no workspace.
  if (listing.stdout === "") {
    throw new Error(
      `the gate could not list its checks: git listed no files at all under ${workspaces.join(", ")} ` +
        `in ${repoRoot} — refusing to read that as a gate with no checks`,
    );
  }
  const found = findCheckFiles(listing.stdout.split("\0"), workspaces);
  return sortDeclaredChecks(found, (file) => {
    const absolute = path.join(repoRoot, file.path);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  });
}

export type PlanDerivation =
  | { readonly ok: true; readonly plan: readonly GatePlanStep[] }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * How the gate RUNS a found check: its own file, from its own workspace, in exactly the form the
 * root `check:*` scripts always used — `pnpm -C <workspace> exec` with the tsx loader. `-C … exec`
 * keeps the child's exit code, so a declared skip still arrives as 3; `--filter … exec` would
 * collapse it to 1 (`EXIT_CODE_COLLAPSING_INVOCATION`).
 */
export function checkInvocation(check: CheckFile): string {
  const up = check.workspace
    .split("/")
    .map(() => "..")
    .join("/");
  const file = check.path.slice(check.workspace.length + 1);
  return `pnpm -C ${check.workspace} exec node --import ${up}/scripts/tsx-cache-off.mjs --import tsx ${file}`;
}

/** One found check as a plan step: labelled by its name, run by its own file, as it declared. */
export function checkStep(check: LiveCheck): GatePlanStep {
  const { runs, subject, cost, ciIdentity, skip, why } = check.declaration;
  const step: GatePlanStep = {
    command: check.name,
    check: check.name,
    invocation: checkInvocation(check),
    source: check.path,
    runs,
    subject,
    cost,
    why,
  };
  const skipping: GatePlanStep = skip === undefined ? step : { ...step, skip };
  return ciIdentity === undefined ? skipping : { ...skipping, ciIdentity };
}

/** One block in run order, and whatever a `runsBefore` cycle left unplaced. */
interface BlockOrder {
  readonly ordered: readonly LiveCheck[];
  readonly stuck: readonly LiveCheck[];
}

/**
 * Order one block: input order (name order, from discovery), except that a check never runs before
 * one that declared `runsBefore` it.
 */
function orderBlock(block: readonly LiveCheck[]): BlockOrder {
  const remaining = [...block];
  const ordered: LiveCheck[] = [];
  // At most one placement per check, so the walk is bounded by the block itself: a cycle ends it
  // early with the checks it caught still `remaining`, and nothing can make it spin.
  for (const _ of block) {
    const ready = remaining.findIndex(
      (check) => !remaining.some((other) => other.declaration.runsBefore.includes(check.name)),
    );
    if (ready === -1) break;
    ordered.push(...remaining.splice(ready, 1));
  }
  return { ordered, stuck: remaining };
}

/**
 * The gate plan: the fixed legs, and each live check in the block its declaration puts it in —
 *
 *     lead · own-work/seconds · wall · own-work/minutes · trail · shared/seconds · shared/minutes
 *
 * — which is both ordering axes by construction: every cheap own-work check precedes the wall, and
 * every shared-environment check follows all own work. REFUSES a cycle among `runsBefore`, a
 * `runsBefore` naming no live check, and one pointing at a check whose block runs EARLIER — a
 * declaration its own subject and cost contradict.
 */
export function deriveGatePlan(checks: readonly LiveCheck[], builtIns: BuiltInLegs): PlanDerivation {
  const reasons: string[] = [];
  const block = (subject: GateSubject, cost: GateCost): GatePlanStep[] => {
    const { ordered, stuck } = orderBlock(
      checks.filter((c) => c.declaration.subject === subject && c.declaration.cost === cost),
    );
    if (stuck.length > 0) {
      reasons.push(`these checks' runsBefore declarations form a cycle: ${stuck.map((c) => c.name).join(", ")}`);
    }
    return ordered.map(checkStep);
  };
  const plan = [
    ...builtIns.lead,
    ...block("own-work", "seconds"),
    ...builtIns.wall,
    ...block("own-work", "minutes"),
    ...builtIns.trail,
    ...block("shared-environment", "seconds"),
    ...block("shared-environment", "minutes"),
  ];
  // Within a block `orderBlock` already honoured every `runsBefore`, so a check placed AFTER one it
  // must precede can only have been put there by the blocks themselves: its subject and cost.
  const names = new Set(checks.map((check) => check.name));
  const at = (name: string): number => plan.findIndex((step) => step.check === name);
  for (const check of checks) {
    for (const later of check.declaration.runsBefore) {
      if (!names.has(later)) {
        reasons.push(`${check.name} declares runsBefore ${later}, which is not a live gate check`);
      } else if (at(later) < at(check.name)) {
        reasons.push(
          `${check.name} declares runsBefore ${later}, but ${later}'s subject and cost run it earlier`,
        );
      }
    }
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, plan };
}

/** The gate's plan, found and ordered — or every reason it could not be. */
export type GatePlanLoad =
  | {
      readonly ok: true;
      readonly plan: readonly GatePlanStep[];
      /** Found and never run (ADR-0606 D6), in name order. */
      readonly retired: readonly RetiredCheck[];
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * THE GATE'S PLAN, as `pnpm gate` and `pnpm gate --ci` both walk it: every check the workspace
 * projects' working tree holds, ordered around the fixed legs (ADR-0606 D1/D2).
 *
 * ALL OR NOTHING. It refuses — and the gate then runs no step at all — when git cannot list the
 * tree, when any check-shaped file is refused, when no live check is found, or when the
 * declarations contradict each other. A plan with a check quietly missing is the one outcome worse
 * than no plan, because it would still print a verdict.
 */
export function loadGatePlan(
  repoRoot: string,
  workspaces: readonly string[],
  legs: BuiltInLegs,
): GatePlanLoad {
  let discovery: CheckDiscovery;
  try {
    discovery = discoverChecks(repoRoot, workspaces);
  } catch (err) {
    return { ok: false, reasons: [(err as Error).message] };
  }
  const reasons = discovery.refused.map((refusal) => `${refusal.path}: ${refusal.reason}`);
  if (discovery.live.length === 0) {
    reasons.push("no live check was found at all — a gate of only its fixed legs is not the gate");
  }
  if (reasons.length > 0) return { ok: false, reasons };
  const derived = deriveGatePlan(discovery.live, legs);
  return derived.ok ? { ok: true, plan: derived.plan, retired: discovery.retired } : derived;
}

/** One step as `pnpm gate --list --json` reports it — `null` where the step declares nothing. */
export interface ListedStep {
  readonly command: string;
  readonly check: string | null;
  readonly runs: GatePlacement;
  readonly subject: GateSubject;
  readonly cost: GateCost;
  readonly ciIdentity: CiIdentity | null;
  readonly skip: StepSkip | null;
  /** The check's file — `null` for a fixed leg. */
  readonly source: string | null;
  /** The story node the ownership map gives that file (ADR-0606 D1) — `null` when it names none. */
  readonly owner: string | null;
}

/** A retired check as `--list` reports it: found, and never run (ADR-0606 D6). */
export interface ListedRetired {
  readonly check: string;
  readonly retiredBy: string;
  readonly source: string;
  readonly owner: string | null;
}

/** What `pnpm gate --list` shows, and exactly what `--list --json` prints. */
export interface GatePlanListing {
  /** In plan order. */
  readonly steps: readonly ListedStep[];
  readonly retired: readonly ListedRetired[];
}

/** The plan and its retired checks, each file shown with its owner (`ownerOf` asks the ownership map). */
export function listGatePlan(
  plan: readonly GatePlanStep[],
  retired: readonly RetiredCheck[],
  ownerOf: (file: string) => string | undefined,
): GatePlanListing {
  return {
    steps: plan.map((step) => ({
      command: step.command,
      check: step.check ?? null,
      runs: step.runs,
      subject: step.subject,
      cost: step.cost,
      ciIdentity: step.ciIdentity ?? null,
      skip: step.skip ?? null,
      source: step.source ?? null,
      owner: step.source === undefined ? null : (ownerOf(step.source) ?? null),
    })),
    retired: retired.map((check) => ({
      check: check.name,
      retiredBy: check.declaration.retiredBy,
      source: check.path,
      owner: ownerOf(check.path) ?? null,
    })),
  };
}

/** The listing for a reader: one line per step in run order, then the retired checks. */
export function renderGatePlanListing(listing: GatePlanListing): string[] {
  const local = listing.steps.filter((step) => step.runs !== "ci").length;
  const ci = listing.steps.filter((step) => step.runs !== "local").length;
  const lines = [
    `the gate plan — ${listing.steps.length} steps, found and ordered from each check's own declaration ` +
      `(\`pnpm gate\` runs ${local}: both + local; \`pnpm gate --ci\` runs ${ci}: both + ci)`,
  ];
  for (const [index, step] of listing.steps.entries()) {
    const identity = step.ciIdentity === null ? "" : `, signs in as ${step.ciIdentity}`;
    const skip = step.skip === null ? "" : ", may SKIP";
    const where =
      step.source === null ? "a fixed leg of the gate" : `${step.source} — owner ${step.owner ?? "(none declared)"}`;
    lines.push(
      `  ${String(index + 1).padStart(2)}. ${step.command} [${step.runs}; ${step.subject}; ${step.cost}${identity}${skip}] ${where}`,
    );
  }
  lines.push(`retired — found, never run (ADR-0606 D6): ${listing.retired.length}`);
  for (const check of listing.retired) {
    lines.push(`  ${check.check} [${check.retiredBy}] ${check.source} — owner ${check.owner ?? "(none declared)"}`);
  }
  return lines;
}
