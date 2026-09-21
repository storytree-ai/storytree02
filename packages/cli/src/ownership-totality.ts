/**
 * The PURE judge behind `pnpm check:ownership-totality` — the rung that keeps the source-ownership
 * map TOTAL as landings arrive (ADR-0317 D2's map, charged by ADR-0301's authorship rule).
 *
 * WHY A RUNG AT ALL, WHEN `storytree ownership` ALREADY REPORTS. The report is deliberately
 * report-only, and that posture was right at authoring: the map covered a hand-verified seed, so a
 * blocking rung would have redded the repo on day one. The seed is now drained — 555 of 595 files
 * owned — and what the drain exposed is that TOTALITY DECAYS with nothing watching. Inside a single
 * increment of `capability-layer-coverage-arc` the condition broke twice from siblings' code landing
 * on `main`, and then a third time from the session's OWN commit: two new
 * `packages/cli/src/typecheck-aperture*.ts` files were born unowned and a FULL `pnpm gate` went green
 * with the map already incomplete (2026-08-14, PR #1326). `storytree ownership` is report-only;
 * `check:boundaries` is at PACKAGE grain and correctly passes, because the package was owned all
 * along. Nothing sat between an author and the decay.
 *
 * WHAT THIS CHARGES, AND WHAT IT REFUSES TO CHARGE. Those three breaks are not one defect. Two were a
 * SIBLING's code arriving on `main` — a shared backlog whose remedy is the standing drain, and whose
 * cost, charged here, would be levied on whichever session ran the gate next. That is precisely the
 * mis-aperture ADR-0301 removed from `check:verification-decay` and ADR-0290 removed from
 * `check:corpus-content`, and re-creating it one rung over would be the same defect wearing a third
 * hat. The third break is different in kind: the session's own commit, in the session's own diff,
 * repairable in one line by the only party who knows what the new file is for.
 *
 * So the line is AUTHORSHIP, and it is the same line `decay-attribution.ts` draws:
 *
 *   - AUTHORED — this branch introduced the breach. RED. Either the file is new here, or it existed
 *     at the merge base and WAS owned there, meaning this branch removed or narrowed the declaration
 *     that covered it.
 *   - INHERITED — the file existed at the merge base and was already unowned there. WARN, named and
 *     counted, never charged. Its remedy is the standing drain, not this landing.
 *
 * THE SECOND CLAUSE OF `authored` IS NOT DECORATION — it closes the wrongly-EXCUSED direction, which
 * is the one ADR-0301's asymmetry argument says must never be taken. A branch that deletes a
 * `sourceOwnership.subtrees` entry un-owns files it never opened; under a rule that only asked "is
 * this path new?" every one of them would read INHERITED and land uncharged, and the NEXT session's
 * check would excuse them too, because by then they are genuinely inherited. Asking the base map the
 * same question the current map was asked is what makes that impossible, and it costs one read of
 * the base's `repo-manifest/` fragment tree.
 *
 * IT IS NOT A DECAY INSTRUMENT, DELIBERATELY. ADR-0252 D1 chartered four cheap instruments and
 * ADR-0278 added a fifth with its own ADR and owner ratification; a sixth is an amendment to an
 * accepted ADR and therefore an owner call, not a curation one. This is also a different SHAPE from
 * those five: every one of them LOCATES a region a later adversarial pass may refute, which is why
 * none of them blocks per finding. This makes an exact, mechanical assertion with no false-positive
 * surface — a file either falls under a declared subtree or it does not — so it belongs on the
 * `check:mirror-conformance` side of ADR-0252's own boundary, where the signal cannot be wrong and
 * blocking is therefore honest.
 *
 * PURE: no `fs`, no `git`, no `process`, no clock. The disk walk, the manifest reads and the git
 * reads all live in the thin shell ({@link file://./check-ownership-totality.ts}) — the same
 * gatherer/judge split `check-boundaries.ts` / `boundaries.ts` and `ownership.ts` /
 * `source-ownership.ts` use, and for the same reason: the rule stays exhaustively unit-testable
 * offline while the I/O stays dumb and total.
 */

/**
 * THE ANTI-VACUITY FLOOR — every enumeration this verdict rests on, and the reason each one is fatal
 * rather than degradable.
 *
 * THE RULE IT NAMES, which is `verification-decay.ts`'s {@link requireObserved} pointed at a
 * different substrate: **an empty enumeration is a BLIND check, never a clean one.** This rule is
 * subtractive in both directions at once, so it has a false-clean path AND a false-red path, and they
 * are reached by different failures. Both were measured against the real tree before this floor was
 * written, by blinding each loader in turn:
 *
 *   - blind the SOURCE WALK (`gatherSourceFiles` returns `[]`) → 0 files, so 0 unowned, so 0
 *     authored → `✓ every source file this branch adds carries a declared owner`, exit 0. A repo that
 *     could not be read reports as a repo with nothing wrong. **DEFLATES — the dangerous direction.**
 *   - blind the CURRENT DECLARATION MAP (an unreadable `repo-manifest/` tree yields `[]`) → every one
 *     of 595 files is unowned, so every file the branch touched is charged → a red naming hundreds of
 *     files. **INFLATES** — loud, and survivable, but it names the wrong defect: the reader is sent to
 *     write declarations for a map that is already complete.
 *   - blind the BASE TREE or the BASE DECLARATION MAP (git could not be consulted) → nothing is known
 *     to have existed before, so every unowned file reads as this branch's. **INFLATES**, same
 *     wrong-defect problem.
 *
 * A check that can deflate must never be allowed to; a check that inflates must at least say why. So
 * every one of the four throws, with the failed enumeration named — and the throw is the whole point
 * of the fence `WorkspaceFacts.everExisted` (PR #1318) and the #970 blind-loader finding both landed
 * on: **a probe that cannot be consulted must THROW, never answer false**, because a quiet failure
 * makes the repo look cleaner than it is.
 */
export class VacuousOwnershipSweep extends Error {
  constructor(what: string) {
    super(`${what} — the enumeration observed nothing, so this check proved nothing`);
    this.name = "VacuousOwnershipSweep";
  }
}

/** What the shell observed about where it is running — the input to {@link chooseBaseRef}. */
export interface BaseRefEvidence {
  /** `GITHUB_EVENT_NAME`, or `undefined` outside CI. */
  readonly eventName: string | undefined;
  /** Does `HEAD^2` resolve? Present ⇒ HEAD is a merge commit. */
  readonly hasSecondParent: boolean;
  /** `git merge-base origin/main HEAD`, or `null` when it did not resolve. */
  readonly mergeBase: string | null;
}

/** Which revision is "before", and how that was established. */
export interface BaseRefChoice {
  readonly ref: string;
  /** One line naming the route taken — printed, so the anchor is never silent. */
  readonly because: string;
}

/**
 * PURE: choose the revision this branch is charged against.
 *
 * WHY THIS IS NOT SIMPLY `merge-base origin/main HEAD`, and why getting it wrong would have redded
 * every PR. CI checks out the pull_request MERGE COMMIT (`refs/pull/N/merge`) at **`fetch-depth: 2`**,
 * which fetches no `origin/main` at all — so the merge-base call that is exactly right on a laptop
 * resolves to nothing in the environment that matters most. Under this module's fail-closed floor
 * that is a {@link VacuousOwnershipSweep}, i.e. a red on every pull request, caused by the check and
 * not by the tree.
 *
 * The repo already solved this, and this reuses that contract rather than inventing a second one:
 * `ci-affected-main.ts` (ADR-0195) diffs `HEAD^1..HEAD` because on that merge ref **parent 1 is the
 * base tip and parent 2 is the PR head**, which is race-free and needs no separately-fetched ref. The
 * `fetch-depth: 2` in `ci.yml` exists precisely to keep that parent, and its comment says so. Two
 * classifiers disagreeing about what "before" means is the divergence this repo keeps closing.
 *
 * ORDER IS LOAD-BEARING, and each route is POSITIVELY identified rather than inferred from the
 * other's failure:
 *
 *  1. **The CI pull_request merge ref** — `GITHUB_EVENT_NAME === "pull_request"` AND `HEAD^2` exists.
 *     Both conditions, because a LOCAL branch that has merged `origin/main` also has a second parent,
 *     and there `HEAD^1` is this branch's own previous commit — charging against it would excuse
 *     everything the branch did before its last merge.
 *  2. **`merge-base origin/main HEAD`** — the laptop, and any full clone. On a trunk run this
 *     resolves to HEAD itself, so nothing reads as new and the run correctly charges nobody.
 *  3. **Neither** — throw. There is no "before", so every file in the tree would read as this
 *     branch's; a check that cannot find its anchor must say so rather than red a whole repo it
 *     never measured.
 */
export function chooseBaseRef(evidence: BaseRefEvidence): BaseRefChoice {
  if (evidence.eventName === "pull_request" && evidence.hasSecondParent) {
    return {
      ref: "HEAD^1",
      because:
        "the CI pull_request merge ref — parent 1 is the base tip this PR was cut against " +
        "(ADR-0195's anchor; `origin/main` is not fetched at `fetch-depth: 2`)",
    };
  }
  if (evidence.mergeBase !== null && evidence.mergeBase.length > 0) {
    return {
      ref: evidence.mergeBase,
      because: `\`git merge-base origin/main HEAD\` → ${evidence.mergeBase.slice(0, 9)}`,
    };
  }
  throw new VacuousOwnershipSweep(
    "no base revision could be established — `merge-base origin/main HEAD` did not resolve (no " +
      "origin/main ref, a detached or non-repo checkout) and this is not a CI pull_request merge ref",
  );
}

/**
 * The measured facts the judge decides from. Every field is gathered by the shell; the judge itself
 * reaches nothing.
 */
export interface OwnershipTotalityFacts {
  /**
   * Every source file the disk walk found in the WORKING TREE, repo-relative and POSIX-separated.
   * Carried only as the anti-vacuity denominator — the judge partitions {@link unowned}, never this.
   */
  readonly files: readonly string[];
  /**
   * The subset of {@link files} falling under no entry of the CURRENT `sourceOwnership.subtrees` map,
   * as judged by `judgeSourceOwnership`. Supplied rather than re-derived so this rung and
   * `storytree ownership` can never disagree about what "unowned" means.
   */
  readonly unowned: readonly string[];
  /** How many declarations the CURRENT map carries — the second enumeration, guarded separately. */
  readonly declarationCount: number;
  /** Every path present in the merge-base tree (`git ls-tree -r --name-only <base>`). */
  readonly baseFiles: ReadonlySet<string>;
  /**
   * The files that were ALREADY unowned at the merge base — `judgeSourceOwnership` run over the same
   * file list against the BASE `repo-manifest/` tree. This is what separates "this branch removed the
   * declaration" from "this was already the standing backlog".
   */
  readonly baseUnowned: ReadonlySet<string>;
  /** How many declarations the BASE map carried — guarded, or a broken `git show` reads as a red. */
  readonly baseDeclarationCount: number;
  /** The branch name, for the message. `null` when git could not name one (a detached HEAD). */
  readonly branch: string | null;
}

/** One charged file, with the evidence line that placed it there — a verdict is never bare. */
export interface ChargedFile {
  /** Repo-relative, POSIX-separated. */
  readonly file: string;
  /** Why this file is this branch's, in one line. */
  readonly because: string;
}

export interface OwnershipTotalityVerdict {
  readonly verdict: "ok" | "fail";
  /** Unowned files this branch introduced — the charged set. Non-empty ⇒ `fail`. */
  readonly authored: readonly ChargedFile[];
  /** Unowned files that were already unowned at the merge base. Reported, never charged. */
  readonly inherited: readonly string[];
  /** The denominator, echoed so the report can state what was actually swept. */
  readonly filesSwept: number;
}

/**
 * Charge each currently-unowned file to a party, and fail when any of them is this branch's.
 *
 * Precedence is NEW-HERE > OWNED-AT-BASE > INHERITED, and the ordering is the fail-closed posture: a
 * file reaches `inherited` only by surviving both questions that could have made it this branch's.
 *
 * THROWS on any vacuous enumeration — see {@link VacuousOwnershipSweep}. Deliberately a throw rather
 * than a `fail` verdict: a `fail` would be indistinguishable in the report from a real breach, and
 * the reader would go looking for files to declare instead of for the loader that broke.
 */
export function judgeOwnershipTotality(facts: OwnershipTotalityFacts): OwnershipTotalityVerdict {
  if (facts.files.length === 0) {
    throw new VacuousOwnershipSweep("the source walk found no files under packages/ or apps/");
  }
  if (facts.declarationCount === 0) {
    throw new VacuousOwnershipSweep(
      "the CURRENT `sourceOwnership.subtrees` map declared nothing (was the repo-manifest/ fragment tree unreadable?)",
    );
  }
  if (facts.baseFiles.size === 0) {
    throw new VacuousOwnershipSweep("the merge-base tree listed no files");
  }
  if (facts.baseDeclarationCount === 0) {
    throw new VacuousOwnershipSweep(
      "the BASE `sourceOwnership.subtrees` map declared nothing (was the merge base's repo-manifest/ fragment tree unreadable?)",
    );
  }

  const branch = facts.branch ?? "this branch";
  const authored: ChargedFile[] = [];
  const inherited: string[] = [];

  for (const file of [...facts.unowned].sort()) {
    if (!facts.baseFiles.has(file)) {
      authored.push({ file, because: `${branch} adds it, and it falls under no declared subtree` });
      continue;
    }
    if (!facts.baseUnowned.has(file)) {
      authored.push({
        file,
        because: `it was OWNED at the merge base — ${branch} removed or narrowed the declaration covering it`,
      });
      continue;
    }
    inherited.push(file);
  }

  return {
    verdict: authored.length > 0 ? "fail" : "ok",
    authored,
    inherited,
    filesSwept: facts.files.length,
  };
}

/** The containing directory (`a/b/c.ts` → `a/b`); the repo root renders as `.`. */
function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "." : file.slice(0, at);
}

/**
 * Render the verdict as operator-facing text.
 *
 * THE REPAIR IS SPELLED OUT, with a subtree line the reader can paste. A gate that names a breach
 * without naming its fix prices the session toward the wrong remedy — the measured failure behind
 * ADR-0301, where `check:verification-decay` offered only "repair a signal you cannot cheaply repair"
 * or "raise a ceiling you are forbidden to raise". Here the fix is one manifest entry, and the
 * grain preference (capability over story, ADR-0270 D1) is stated at the point of writing it rather
 * than left for a later curation pass to discover.
 */
export function formatOwnershipTotality(verdict: OwnershipTotalityVerdict): string {
  const lines: string[] = [];

  if (verdict.inherited.length > 0) {
    lines.push(
      `⚠ ${verdict.inherited.length} source file(s) carry no declared owner and were ALREADY unowned ` +
        "at the merge base — NOT this branch's, and not charged here.",
      "  Their remedy is the standing drain (`storytree ownership --all`), not this landing.",
      "",
    );
  }

  if (verdict.verdict === "ok") {
    lines.push(
      `✓ ownership totality (ADR-0317 D2): every source file this branch adds falls under a declared ` +
        `subtree (${verdict.filesSwept} file(s) swept)`,
    );
    return lines.join("\n");
  }

  lines.push(
    `✗ ownership totality (ADR-0317 D2): ${verdict.authored.length} source file(s) this branch ` +
      "introduces carry NO declared owner",
    "",
  );
  for (const charged of verdict.authored) {
    lines.push(`  - ${charged.file}`, `      ${charged.because}`);
  }

  const dirs = [...new Set(verdict.authored.map((c) => dirOf(c.file)))].sort();
  lines.push(
    "",
    "Every source file must fall under a `sourceOwnership.subtrees` entry in `repo-manifest/source-ownership/<owner>.json`.",
    "Declare the subtree you are writing, owned by the CAPABILITY you are writing — capability grain",
    "is the grain claims are taken at (ADR-0270 D1), and ADR-0346 D2 retired story-grain work claims,",
    "so a story id here names an owner the claim ledger will not let anyone claim:",
    "",
  );
  for (const dir of dirs) {
    lines.push(`    in repo-manifest/source-ownership/<capability-id>.json → "subtrees": { "${dir}/<your-files>": "<capability-id>" }`);
  }
  lines.push(
    "",
    "Then `pnpm storytree ownership` to confirm, and `storytree noticeboard claim '<subtree-key>'",
    "--grade work --pg` to claim what you declared (ADR-0317 D3).",
  );
  return lines.join("\n");
}
