/**
 * The SOURCE-OWNERSHIP judge — the pure half of the second declared ownership map (ADR-0317 D2).
 *
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT. `packageOwnership`
 * (`repo-manifest/package-ownership/_domain.json`) maps every
 * workspace package to its owning story, and `check:boundaries` holds it to the disk — 24 of 24
 * packages classified, zero unmapped (ADR-0074). That check is CORRECT at its own grain and nothing
 * here replaces or weakens it. What has never existed is the grain BELOW it: a map from a source
 * SUBTREE to the addressable unit responsible for it. This module judges that second map.
 *
 * WHY NOT DERIVE IT FROM `proof.real.sourceFile` — the trap ADR-0317 exists to prevent. That field is
 * typed `sourceFile: string`: a total function **unit → the one file that unit authors**. Ownership
 * needs the opposite total function, **file → its owner**, and the first cannot be inverted into the
 * second. It is not surjective (one `sourceFile` per real-buildable unit bounds its image by the NODE
 * count, 296, not the file count, 519 — even at 100% adoption it could not cover the repo) and it is
 * not injective (`apps/studio/src/components/TreeView.tsx` is named by SEVEN different units).
 * Inverting it would hand that file seven owners and 402 files none. `scope.sourceGlobs` is no better
 * a candidate: it is the per-phase WRITE FENCE, deliberately broader than what a unit owns, which is
 * exactly why `check-boundaries.ts:227` filters globs out of the proof-bound set ("a WILDCARD glob is
 * the write-scope breadth, not the unit's owned file — resolving it would over-attribute siblings
 * owned by OTHER units/stories"). So the enumeration in `sourceFile` is NOT decayed — it is nearly
 * full, 111 owned against 117 declared-and-existing targets — it simply was never an ownership map.
 * Neither field is read here, and neither changes: the prove-it-gate, the phase machine, the write
 * scopes and every signed verdict carry ZERO risk from this module.
 *
 * WHY GLOBS ARE ALLOWED HERE AND REFUSED THERE. The proof map must be literal because a verdict has
 * to name what it covered. This map binds no verdict, so it may be coarse — and that coarseness is
 * the whole economy: it keeps the entry count in the tens rather than at 519, the same economy that
 * makes 24 `packageOwnership` entries sustainable by hand.
 *
 * WHAT KEEPS IT HONEST. `packageOwnership` is ALSO a hand-typed enumeration with zero globs; it does
 * not decay because a procedure walks the disk and demands totality. The difference between the two
 * grains was never procedure-versus-declaration — it was CHECKED-FOR-TOTALITY versus UNCHECKED. So
 * this module's centre is {@link judgeSourceOwnership}'s totality rule: every source file the walk
 * finds must fall under some declared subtree, and one falling under none is NAMED.
 *
 * REPORT-ONLY, DELIBERATELY (ADR-0317 D2 / ADR-0310 D3). At authoring the map covers a small,
 * hand-verified seed, so a blocking rung would red the repo on day one. This returns data; the caller
 * renders it and exits zero. But note what subtree grain does to the ratchet argument: the blocking
 * version was impossible against 398 *files*, while against unowned *subtrees* the backlog is a
 * walkable list — which is why {@link SourceOwnershipReport.unownedSubtrees}, not the file list, is
 * the report's headline payload. ADR-0311 retired sixteen gate rungs for want of evidence, so any
 * future blocking rung must earn its place on this report's own numbers before it lands.
 *
 * PURE: no I/O, no `fs`, no `process`, no clock. The disk walk that supplies `files` is the
 * gatherer's job ({@link file://./ownership.ts}).
 *
 * ONE IMPORT, ADDED DELIBERATELY 2026-08-06 (ADR-0317 D3). This module used to advertise no imports
 * at all, "like `boundaries.ts`, so the suite proves offline in a bare worktree". The subtree
 * MATCHER now has a second caller — the claim namespace, which answers "you named a FILE; the
 * declared subtree over it is X" (`claim-namespace.ts`) — and it lives in `@storytree/drive` because
 * `cli` may import `drive` and `drive` may never import `cli`. A second copy would let "who owns
 * this file" diverge between the report and the claim resolver, silently, in exactly the direction
 * this arc exists to close; that was judged worth more than a bare-worktree property no test asserts
 * and `pnpm -r test` cannot exercise anyway. The invariant that carries weight — no I/O of any kind —
 * is untouched.
 */

import { matchesSubtree } from "@storytree/drive";

// Re-exported so this module stays the ownership map's front door: callers of the judge ask it what
// a subtree covers, and never have to know the matcher was lifted to be shared.
export { matchesSubtree };

/**
 * One entry of the declared map: a subtree, and the addressable object responsible for it.
 *
 * The owner is an id in the work graph — a CAPABILITY id by preference, since that is the grain
 * claims are taken at (ADR-0270 D1), or a story id where the whole package genuinely is one
 * competence and no capability is the honest answer. ADR-0317 D3 settled that the claim unit is any
 * addressable object, so a declared subtree is itself claimable; {@link judgeSourceOwnership} reports
 * the grain mix rather than forcing one, because a map that is all story-grain has satisfied the
 * totality rule while leaving "claim the capability you are writing" with nothing finer to bind to.
 */
export interface SubtreeDeclaration {
  /**
   * The subtree, repo-relative and POSIX-separated. Globs permitted (see {@link matchesSubtree}); a
   * pattern with no `*` names either one exact file or a directory whose whole contents it claims.
   */
  readonly subtree: string;
  /** The addressable owner — a capability id, or a story id where no capability is right. */
  readonly owner: string;
  /** Why this subtree belongs to this owner. Free prose; the report never parses it. */
  readonly note?: string;
}

/** A recorded measurement the current run is compared against — the trend's only input. */
export interface OwnershipBaseline {
  /** ISO date the baseline was measured (`YYYY-MM-DD`). */
  readonly date: string;
  /** Source files the walk found then. */
  readonly files: number;
  /** How many of them fell under no declared subtree. */
  readonly unowned: number;
}

export interface SourceOwnershipInput {
  /**
   * Every source file the totality rule covers, repo-relative and POSIX-separated. The predicate
   * (which extensions, which roots, tests excluded) is the GATHERER's, deliberately: the judge must
   * not be able to quietly shrink its own denominator.
   */
  readonly files: readonly string[];
  /** The declared map, in declaration order — order decides the winner of an overlap. */
  readonly declarations: readonly SubtreeDeclaration[];
  /**
   * Every id that exists in the work graph, when the caller can supply it. Present ⇒ every declared
   * owner is resolved against it and the unresolvable ones are named
   * ({@link SourceOwnershipReport.unresolvedOwners}). Absent ⇒ that check is SKIPPED rather than
   * faked green, and the report says so — the same insufficient-data skip `check:boundaries` takes.
   */
  readonly knownUnitIds?: readonly string[];
  /**
   * The subset of {@link knownUnitIds} that are STORY ids — used only to report the grain mix, since
   * a story-grain entry is legal but coarser than the grain claims are taken at (ADR-0270 D1).
   */
  readonly storyIds?: readonly string[];
  /**
   * Story id → the unit ids that story declares. Present ⇒ every story-grain declaration is
   * CLASSIFIED ({@link StoryGrainDeclaration}); absent ⇒ each is reported `unclassified` rather than
   * guessed, the same insufficient-data skip {@link knownUnitIds} takes.
   */
  readonly unitsByStory?: ReadonlyMap<string, readonly string[]>;
  /** The recorded baseline, when one exists. Absent ⇒ no trend line, stated as such. */
  readonly baseline?: OwnershipBaseline;
}

/** Per-package coverage — the grouping the arc's measurements are reported in. */
export interface PackageCoverage {
  /** The workspace package root, e.g. `packages/cli` or `apps/studio`. */
  readonly pkg: string;
  readonly total: number;
  readonly owned: number;
  readonly unowned: number;
}

/**
 * One directory holding unowned files — THE WALKABLE BACKLOG, and the reason subtree grain changes
 * the ratchet argument. 398 unowned files is not a list anyone walks; the ~50 directories they sit in
 * is.
 */
export interface UnownedSubtree {
  /** The containing directory, repo-relative POSIX. */
  readonly dir: string;
  /** How many unowned source files sit directly in it. */
  readonly count: number;
  /**
   * EVERY unowned file in the directory, sorted — not a sample. The summary view truncates for
   * readability, but the data must be complete: `--all` promises the full list, and a report that
   * silently capped it would be the "no silent caps" defect this instrument exists to name.
   */
  readonly files: readonly string[];
}

/** A file matched by more than one declaration — a defect a glob map can have and an exact map cannot. */
export interface ContestedFile {
  readonly file: string;
  /** Every matching owner, in declaration order. The FIRST is the one credited. */
  readonly owners: readonly string[];
}

/**
 * WHY one declaration sits at story grain — the distinction the grain COUNT alone destroys.
 *
 * ADR-0346 D2 retired story-grain `work` claims, so every story-grain entry answers "who owns this
 * file" with a node the claim ledger will not let anyone claim. That much is uniform. What is NOT
 * uniform, and what a single number asserts falsely, is whether that is a DECISION or a GAP — and
 * the map's own authoring rules (`repo-manifest/source-ownership/_domain.json`) already settle most
 * of them:
 *
 *  - `barrel` — the subtree names a package `src/index.ts`. Rule (4) settles this as story grain BY
 *    NATURE: a bare re-export barrel is the union of every organ the package fronts, so no single
 *    capability is responsible for it and one that claimed it would be claiming its siblings' code.
 *    DECIDED, not residue.
 *  - `no-capability-declared` — the owning story declares no units at all, so there is nothing finer
 *    to name. Rule (1)'s root-port case (`proof-protocol`, `storage-protocol`): the story IS the one
 *    competence.
 *  - `residue` — the owning story DOES declare capabilities, so a finer owner may exist. THIS is the
 *    `capability-layer-coverage-arc` worklist, and only this.
 *  - `unclassified` — {@link SourceOwnershipInput.unitsByStory} was not supplied, so the question was
 *    not asked. Stated rather than defaulted, because defaulting it to `residue` would inflate the
 *    worklist with entries nobody measured.
 *
 * THE `barrel` TEST IS PATH-BASED, AND THAT APERTURE IS STATED RATHER THAN GLOSSED. It recognises the
 * SHAPE rule (4) describes, not the CONTENT it requires — rule (4) itself says an `index.ts` carrying
 * real logic is ordinary code and gets rule (1)'s treatment, which no path can tell. So this reports
 * the map's own DEFAULT ANSWER for a barrel, never a proof that the file only re-exports.
 */
export type StoryGrainReason = "barrel" | "no-capability-declared" | "residue" | "unclassified";

/** One story-grain declaration, named by the SUBTREE KEY — which is the claimable object (ADR-0317 D3). */
export interface StoryGrainDeclaration {
  /** The subtree, exactly as keyed — this is what `noticeboard claim` takes. */
  readonly subtree: string;
  /** The owning story id — legal, but not claimable at `work` grade (ADR-0346 D2). */
  readonly owner: string;
  readonly reason: StoryGrainReason;
  /** How many source files it currently covers — the size of what sits at this grain. */
  readonly files: number;
}

/** How much of the map is declared at the claim-relevant grain. */
export interface GrainTally {
  /** Declarations whose owner resolves to a capability or contract id. */
  readonly capability: number;
  /** Declarations whose owner resolves to a story id — legal, but coarser than claims are taken at. */
  readonly story: number;
  /** Declarations whose owner could not be resolved at all (or was not checked). */
  readonly unresolved: number;
}

/** The comparison against {@link OwnershipBaseline}, when one was supplied. */
export interface OwnershipTrend {
  readonly since: string;
  /** Unowned then, unowned now, and now − then (negative is progress). */
  readonly wasUnowned: number;
  readonly nowUnowned: number;
  readonly delta: number;
  /** The denominator moved too — a delta read without this is not a like-for-like comparison. */
  readonly wasFiles: number;
  readonly nowFiles: number;
}

export interface SourceOwnershipReport {
  readonly total: number;
  readonly owned: number;
  readonly unowned: number;
  /** Descending by unowned, then by package name — the biggest debt first. */
  readonly byPackage: readonly PackageCoverage[];
  /** Descending by file count — the backlog, walkable. */
  readonly unownedSubtrees: readonly UnownedSubtree[];
  /** Owner id → files credited to it, descending. Only owners that matched something appear. */
  readonly owners: readonly { readonly owner: string; readonly files: number }[];
  /** Declarations matching NO file on disk — stale entries, the `hostedStories` self-pruning rule. */
  readonly staleDeclarations: readonly SubtreeDeclaration[];
  /** Files claimed by more than one declaration. */
  readonly contested: readonly ContestedFile[];
  /**
   * Declared owners naming nothing in the work graph. Empty when
   * {@link SourceOwnershipInput.knownUnitIds} was absent — read {@link ownersChecked} first, because
   * "none unresolved" and "not checked" are different claims.
   */
  readonly unresolvedOwners: readonly string[];
  /** Whether owner resolution actually ran. */
  readonly ownersChecked: boolean;
  readonly grain: GrainTally;
  /**
   * EVERY story-grain declaration, each named by its subtree KEY and classified by WHY it sits at
   * that grain — descending by file count, then by subtree.
   *
   * The keys are the payload. {@link formatSourceOwnershipReport} used to tell a reader that "every
   * subtree KEY below is itself claimable … claim the subtree you are writing" while printing no
   * subtree keys anywhere — the guidance pointed at a list that was not rendered, so the one
   * claimable object a session could actually bind to was invisible. That is the map answering "who
   * owns this file" with something unusable, which is the defect, rather than the grain itself.
   */
  readonly storyGrain: readonly StoryGrainDeclaration[];
  /** Absent when no baseline was supplied — no trend is stated rather than a zero invented. */
  readonly trend: OwnershipTrend | undefined;
}

/** The workspace package a repo-relative path belongs to (`packages/cli/src/x.ts` → `packages/cli`). */
function packageOf(file: string): string {
  const parts = file.split("/");
  const root = parts[0];
  const name = parts[1];
  if (root === undefined || name === undefined) return file;
  return `${root}/${name}`;
}

/** The containing directory (`a/b/c.ts` → `a/b`); the repo root renders as `.`. */
function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "." : file.slice(0, at);
}

/**
 * Judge one declared map against the files actually on disk — the totality rule (ADR-0317 D2).
 *
 * Deterministic and total: every input file lands in exactly one of owned/unowned, overlaps and
 * stale entries are reported rather than silently resolved, and nothing is inferred from a field the
 * prove-it-gate owns.
 */
export function judgeSourceOwnership(input: SourceOwnershipInput): SourceOwnershipReport {
  const { files, declarations } = input;
  const known = input.knownUnitIds === undefined ? undefined : new Set(input.knownUnitIds);

  const ownerFiles = new Map<string, number>();
  // Per-DECLARATION credit, alongside the per-OWNER tally: one owner may hold many subtrees, and the
  // story-grain listing has to say how big EACH is, not how big the owner is.
  const declarationFiles = new Map<number, number>();
  const matchedDeclarations = new Set<number>();
  const contested: ContestedFile[] = [];
  const unowned: string[] = [];
  const perPackage = new Map<string, { total: number; owned: number }>();

  for (const file of [...files].sort()) {
    const pkg = packageOf(file);
    const tally = perPackage.get(pkg) ?? { total: 0, owned: 0 };
    tally.total += 1;

    // Every match is collected, not just the first: the first WINS, but a second one is an authoring
    // defect worth naming — the failure mode an exact-key map like `packageOwnership` cannot have.
    const hits: string[] = [];
    let winningIndex: number | undefined;
    declarations.forEach((decl, at) => {
      if (!matchesSubtree(decl.subtree, file)) return;
      matchedDeclarations.add(at);
      if (winningIndex === undefined) winningIndex = at;
      hits.push(decl.owner);
    });

    const winner = hits[0];
    if (winner === undefined || winningIndex === undefined) {
      unowned.push(file);
    } else {
      tally.owned += 1;
      ownerFiles.set(winner, (ownerFiles.get(winner) ?? 0) + 1);
      // Credited to the WINNER only, exactly as the owner tally is — a contested file is counted once.
      declarationFiles.set(winningIndex, (declarationFiles.get(winningIndex) ?? 0) + 1);
      if (hits.length > 1) contested.push({ file, owners: hits });
    }
    perPackage.set(pkg, tally);
  }

  const byDir = new Map<string, string[]>();
  for (const file of unowned) {
    const dir = dirOf(file);
    const bucket = byDir.get(dir);
    if (bucket === undefined) byDir.set(dir, [file]);
    else bucket.push(file);
  }

  const unownedSubtrees: UnownedSubtree[] = [...byDir.entries()]
    .map(([dir, list]) => ({ dir, count: list.length, files: list }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  const byPackage: PackageCoverage[] = [...perPackage.entries()]
    .map(([pkg, t]) => ({ pkg, total: t.total, owned: t.owned, unowned: t.total - t.owned }))
    .sort((a, b) => b.unowned - a.unowned || a.pkg.localeCompare(b.pkg));

  const owners = [...ownerFiles.entries()]
    .map(([owner, count]) => ({ owner, files: count }))
    .sort((a, b) => b.files - a.files || a.owner.localeCompare(b.owner));

  const staleDeclarations = declarations.filter((_, at) => !matchedDeclarations.has(at));

  // Resolution is SKIPPED, never faked, when the caller could not supply the namespace.
  const unresolvedOwners =
    known === undefined
      ? []
      : [...new Set(declarations.map((d) => d.owner).filter((o) => !known.has(o)))].sort();

  const storyIds = new Set(input.storyIds ?? []);
  let capabilityGrain = 0;
  let storyGrain = 0;
  let unresolvedGrain = 0;
  for (const decl of declarations) {
    if (known === undefined || !known.has(decl.owner)) unresolvedGrain += 1;
    else if (storyIds.has(decl.owner)) storyGrain += 1;
    else capabilityGrain += 1;
  }
  const grain: GrainTally = {
    capability: capabilityGrain,
    story: storyGrain,
    unresolved: unresolvedGrain,
  };

  const storyGrainDeclarations: StoryGrainDeclaration[] = declarations
    .map((decl, at) => ({ decl, at }))
    .filter(({ decl }) => known !== undefined && known.has(decl.owner) && storyIds.has(decl.owner))
    .map(({ decl, at }) => ({
      subtree: decl.subtree,
      owner: decl.owner,
      reason: classifyStoryGrain(decl, input.unitsByStory),
      files: declarationFiles.get(at) ?? 0,
    }))
    .sort((a, b) => b.files - a.files || a.subtree.localeCompare(b.subtree));

  const base = input.baseline;
  const trend: OwnershipTrend | undefined =
    base === undefined
      ? undefined
      : {
          since: base.date,
          wasUnowned: base.unowned,
          nowUnowned: unowned.length,
          delta: unowned.length - base.unowned,
          wasFiles: base.files,
          nowFiles: files.length,
        };

  return {
    total: files.length,
    owned: files.length - unowned.length,
    unowned: unowned.length,
    byPackage,
    unownedSubtrees,
    owners,
    staleDeclarations,
    contested,
    unresolvedOwners,
    ownersChecked: known !== undefined,
    grain,
    storyGrain: storyGrainDeclarations,
    trend,
  };
}

/** A package re-export barrel, by PATH — `.../src/index.ts` (see {@link StoryGrainReason}). */
const BARREL_SUBTREE = /(^|\/)index\.ts$/;

/**
 * Why this story-grain declaration is at story grain. See {@link StoryGrainReason} for what each
 * verdict means and which of the source-ownership map's authoring rules
 * (`repo-manifest/source-ownership/_domain.json`) settles it.
 *
 * Ordered barrel-first because rule (4) is the more specific settlement: a story with no capabilities
 * that also declares a barrel is answered by the barrel rule, which holds regardless of how many
 * capabilities the story grows later.
 */
function classifyStoryGrain(
  decl: SubtreeDeclaration,
  unitsByStory: ReadonlyMap<string, readonly string[]> | undefined,
): StoryGrainReason {
  if (BARREL_SUBTREE.test(decl.subtree)) return "barrel";
  if (unitsByStory === undefined) return "unclassified";
  return (unitsByStory.get(decl.owner) ?? []).length === 0 ? "no-capability-declared" : "residue";
}

/** A whole percent, with the degenerate empty-repo case reading 0 rather than `NaN`. */
function pct(part: number, whole: number): string {
  return whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

/** The heading and the remedy for each {@link StoryGrainReason} — the whole point of classifying. */
const STORY_GRAIN_SECTIONS: readonly {
  readonly reason: StoryGrainReason;
  readonly heading: string;
  readonly remedy: string;
}[] = [
  {
    reason: "residue",
    heading: "RESIDUE — the owning story DOES declare capabilities, so a finer owner may exist",
    remedy:
      "The `capability-layer-coverage-arc` worklist, and ONLY this. Resolving one means authoring a " +
      "capability that STATES ITS PROOF — re-pointing a declaration ahead of authoring the organ is " +
      "the opening move that arc forbids (the source-ownership map's rule 4, in " +
      "repo-manifest/source-ownership/_domain.json).",
  },
  {
    reason: "barrel",
    heading: "DECIDED — a package re-export barrel is story grain BY NATURE (manifest rule 4)",
    remedy:
      "Not residue and not awaiting a capability: a bare barrel is the union of every organ the " +
      "package fronts, so one capability claiming it would be claiming its siblings' code. " +
      "Recognised by PATH, so it states the map's default answer for a barrel, not that the file " +
      "only re-exports.",
  },
  {
    reason: "no-capability-declared",
    heading: "DECIDED — the owning story declares no units at all (manifest rule 1)",
    remedy: "The root-port case: the story IS the one competence, so there is nothing finer to name.",
  },
  {
    reason: "unclassified",
    heading: "NOT CLASSIFIED — no story→unit namespace was supplied to this run",
    remedy: "A limit of this run, not a verdict. These are neither decided nor counted as residue.",
  },
];

/**
 * The story-grain listing, split by WHY each entry sits at that grain.
 *
 * SPLIT RATHER THAN COUNTED, because the count alone asserts something false. The grain line reports
 * one number and the old guidance called all of it a "`story-author` worklist" where "no capability
 * exists for that subtree" — but the manifest's own rules already SETTLE most of these entries as
 * decided, and for the rest a capability may well exist. One number, three remedies: draining the
 * decided ones is not progress, and only the `residue` block is anybody's worklist.
 */
function formatStoryGrain(entries: readonly StoryGrainDeclaration[]): string[] {
  const lines: string[] = [
    `STORY-GRAIN DECLARATIONS (${entries.length}) — the OWNER is not claimable at \`work\` grade`,
    "  (ADR-0346 D2); the SUBTREE KEY is (ADR-0317 D3). Claim the key, exactly as printed and quoted:",
    "    storytree noticeboard claim '<subtree-key>' --grade work --pg",
    "  Writing with no capability to name? Claim the INCREMENT you are driving instead (ADR-0308 D5).",
  ];
  for (const section of STORY_GRAIN_SECTIONS) {
    const members = entries.filter((e) => e.reason === section.reason);
    if (members.length === 0) continue;
    const files = members.reduce((sum, m) => sum + m.files, 0);
    lines.push("", `  ${section.heading} — ${members.length} declaration(s), ${files} file(s):`, `    ${section.remedy}`, "");
    const width = Math.max(1, ...members.map((m) => m.subtree.length));
    // EVERY member, uncapped: this list is the claimable-object index, so a truncation would hide
    // exactly the key a session came to find.
    for (const m of members) {
      lines.push(`    ${m.subtree.padEnd(width)}  ${String(m.files).padStart(4)} file(s)  → ${m.owner}`);
    }
  }
  return lines;
}

export interface FormatOptions {
  /** List every unowned file rather than the per-subtree counts + samples. */
  readonly all?: boolean;
  /** How many subtrees to print before truncating (the rest are counted). */
  readonly limit?: number;
}

/**
 * Render the report as operator-facing text.
 *
 * The framing is load-bearing and is asserted by the suite: this is a statement about how much of the
 * tree carries a declared owner, NEVER a maintenance backlog against a decayed enumeration, and never
 * a verdict on `check:boundaries`, which is correct at its own grain.
 */
export function formatSourceOwnershipReport(
  report: SourceOwnershipReport,
  options: FormatOptions = {},
): string {
  const limit = options.limit ?? 20;
  const lines: string[] = [
    "Source-file ownership — the declared subtree map, held to the disk (ADR-0317 D2)",
    "",
    `files: ${report.total}   owned: ${report.owned} (${pct(report.owned, report.total)})   ` +
      `unowned: ${report.unowned} (${pct(report.unowned, report.total)})`,
  ];

  if (report.trend !== undefined) {
    const t = report.trend;
    const move =
      t.delta === 0
        ? "no change"
        : t.delta < 0
          ? `${Math.abs(t.delta)} fewer unowned`
          : `${t.delta} more unowned`;
    lines.push(
      `trend since ${t.since}: unowned ${t.wasUnowned} → ${t.nowUnowned} (${move}); ` +
        `files ${t.wasFiles} → ${t.nowFiles}`,
    );
  } else {
    lines.push("trend: no baseline recorded — this run establishes one, nothing to compare against.");
  }

  lines.push(
    "",
    "REPORT ONLY — this names what carries no declared owner; it fails nothing (ADR-0317 D2).",
    "It is NOT a decayed enumeration being chased: `proof.real.sourceFile` is a unit→file build",
    "target, near-full at what it does, and was never an ownership map. `check:boundaries` is",
    "correct at ITS grain (24/24 packages) and is untouched here — shared substrate reaching many",
    "stories is intended architecture (ADR-0074), not drift.",
    "",
  );

  if (options.all === true) {
    // EVERY file, uncapped. `--all` is the view a session authoring declarations reads, so a
    // truncation here would hide exactly the work it came to see.
    lines.push(`UNOWNED FILES (${report.unowned}):`);
    for (const subtree of report.unownedSubtrees) {
      lines.push(`  ${subtree.dir}/  (${subtree.count})`);
      for (const file of subtree.files) lines.push(`    ${file}`);
    }
  } else {
    const shown = report.unownedSubtrees.slice(0, limit);
    lines.push(
      `THE BACKLOG — unowned SUBTREES, not unowned files (${report.unownedSubtrees.length}):`,
      "  Subtree grain is what makes this walkable: a declaration covers a directory, so the work is",
      "  this list, not the file count above.",
      "",
    );
    const width = Math.max(1, ...shown.map((s) => s.dir.length));
    for (const subtree of shown) {
      lines.push(`  ${subtree.dir.padEnd(width)}  ${String(subtree.count).padStart(4)} unowned`);
    }
    if (report.unownedSubtrees.length > shown.length) {
      lines.push(`  … ${report.unownedSubtrees.length - shown.length} more subtree(s)`);
    }
  }

  lines.push("", "BY PACKAGE:");
  const pkgWidth = Math.max(1, ...report.byPackage.map((p) => p.pkg.length));
  for (const p of report.byPackage) {
    lines.push(
      `  ${p.pkg.padEnd(pkgWidth)}  ${String(p.unowned).padStart(4)} unowned / ${String(p.total).padStart(4)}` +
        `   (${pct(p.owned, p.total)} owned)`,
    );
  }

  if (report.owners.length > 0) {
    lines.push("", `DECLARED OWNERS (${report.owners.length}):`);
    const ownerWidth = Math.max(1, ...report.owners.map((o) => o.owner.length));
    for (const o of report.owners) {
      lines.push(`  ${o.owner.padEnd(ownerWidth)}  ${String(o.files).padStart(4)} file(s)`);
    }
    lines.push(
      `  grain: ${report.grain.capability} capability-grain, ${report.grain.story} story-grain, ` +
        `${report.grain.unresolved} unresolved`,
    );
    if (report.grain.story > 0) {
      lines.push(
        "  A story-grain entry satisfies totality but is coarser than claims are taken at",
        "  (ADR-0270 D1), and ADR-0346 D2 retired story-grain `work` claims — so the OWNER is not",
        "  claimable. The SUBTREE KEY is (ADR-0317 D3); every one is listed below.",
      );
    }
  }

  if (report.storyGrain.length > 0) {
    lines.push("", ...formatStoryGrain(report.storyGrain));
  }

  if (report.contested.length > 0) {
    lines.push("", `⚠ CONTESTED — ${report.contested.length} file(s) matched by more than one declaration:`);
    for (const c of report.contested.slice(0, limit)) {
      lines.push(`  ${c.file}  →  ${c.owners.join(", ")}  (credited to ${c.owners[0]})`);
    }
    lines.push("  Narrow one of the overlapping subtrees until no file matches both — declaration order decides nothing.");
  }

  if (report.staleDeclarations.length > 0) {
    lines.push("", `⚠ STALE — ${report.staleDeclarations.length} declaration(s) match no file on disk:`);
    for (const d of report.staleDeclarations) lines.push(`  ${d.subtree}  (${d.owner})`);
    lines.push("  Moved, deleted, or a typo. Remove the entry — the map is a self-pruning worklist.");
  }

  if (!report.ownersChecked) {
    lines.push(
      "",
      "⚠ owner ids were NOT resolved against the work graph (the caller supplied no id namespace),",
      "  so an owner naming nothing would be invisible here. That is a limit of this run, not a pass.",
    );
  } else if (report.unresolvedOwners.length > 0) {
    lines.push(
      "",
      `⚠ ${report.unresolvedOwners.length} declared owner(s) name nothing in the work graph: ` +
        `${report.unresolvedOwners.join(", ")}.`,
      "  A subtree owned by a phantom id is unclaimable, which is the whole point of declaring it",
      "  (ADR-0317 D3). Point it at a real unit, or author the unit.",
    );
  }

  return lines.join("\n");
}
