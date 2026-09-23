/* gate-check
retired: ADR-0311 D2
*/
// ⚠ UNWIRED — `check:web-experience` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and no
// root `package.json` script, `GATE_PLAN` step, or CI job invokes THIS FILE'S OWN `main()`. Its own
// unit tests still run under `pnpm -r test`, so they stay GREEN while this file's own combined
// `main()` enforces NOTHING — a passing test here is not evidence that rule is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding the WHOLE rung under this file's own name needs fresh production-catch evidence
// AND an ADR, never just the wiring. Tombstone: `RETIRED_CHECKS` in `gate-order.ts`, pinned by
// `gate-order.test.ts`.
//
// ALL THREE PROPERTIES ARE NOW RE-WIRED, SPLIT ACROSS TWO NARROWER RUNGS THAT REUSE THIS FILE'S
// PRIMITIVES RATHER THAN ITS `main()`:
//   - `check-web-experience-closure.ts` (ADR-0336, 2026-08-09) imports `findExperienceEntries` /
//     `walkStaticClosure` / `isWebGlSpecifier` / `withExtensionFallback` to back
//     `check:web-experience-closure` — the no-WebGL static-import-closure property only.
//   - `check-web-experience-markers.ts` (ADR-0454, 2026-08-26, narrowing ADR-0336 D2) imports
//     `findExperienceEntries` / `findExperienceMarkers` to back `check:web-experience-markers` — the
//     `data-experience-skip` / `data-experience-fallback` presence contract only.
// Neither import un-retires `check:web-experience` itself: the name stays in `RETIRED_CHECKS`, and
// THIS file's own combined `main()` (all three properties as one judge) stays unreachable from the
// gate — the two live rungs are independent, narrower re-derivations of its properties, not callers
// of it.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// check:web-experience — the experience-rollout-guardrails capability (ADR-0134).
//
// The pure core of the check: three judges that combine into a single verdict. The fs shell
// (main()) handles the web/ submodule local-SKIP / CI-fail posture and bootstrap allowance,
// following check-web-engine's pattern.
//
// Exported for testing:
//   findExperienceMarkers  — marker contract (data-experience-skip / data-experience-fallback)
//   extractStaticImports   — pull first-paint import specifiers from source text
//   isWebGlSpecifier       — detect three / @react-three/* / forest-world-r3f
//   walkStaticClosure      — graph walk from the Act 1 entry (injection-testable)
//   checkExperienceEntry   — the combined judge (marker contract + WebGL wall)
//   findExperienceEntries  — adoption detection (pages carrying data-experience-entry)
//   withExtensionFallback  — import-resolution reader wrapper (extensionless specifiers)
//   checkExperienceSite    — the whole-site judge (entries → findings | bootstrap SKIP)
//
// Proof: node --import tsx --test packages/cli/src/web-experience-check.test.ts

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExperienceMarkers {
  readonly hasSkip: boolean;
  readonly hasFallback: boolean;
}

export interface ExperienceProblem {
  readonly kind: "missing-skip-marker" | "missing-fallback-marker" | "webgl-leak";
  readonly detail?: string;
}

// ── findExperienceMarkers ─────────────────────────────────────────────────────

/**
 * Detect the two required affordance markers in an HTML page.
 * Presence, not adequacy — static attribute search.
 */
export function findExperienceMarkers(html: string): ExperienceMarkers {
  return {
    hasSkip: html.includes("data-experience-skip"),
    hasFallback: html.includes("data-experience-fallback"),
  };
}

// ── stripComments ─────────────────────────────────────────────────────────────

/**
 * Blank every comment in `src`, preserving offsets and line structure (comment bytes become
 * spaces; newlines survive). String and template literals are respected, so a `//` inside a
 * specifier is not mistaken for a comment.
 *
 * WHY THIS EXISTS, and why it is not tidiness. {@link extractStaticImports} matches source TEXT, so
 * without it the scanner reads prose as code in both directions. A block comment containing an
 * example import — including the one in `web/src/pages/index.astro` that documents this very rung —
 * would be reported as a WebGL leak; and a real multi-line import carrying a trailing `// (note)`
 * would be missed, because `(` is one of the characters that fences the import clause. That is the
 * "a source check that greps text trips on its own rationale" trap, and blanking comments before
 * matching is what removes it rather than documenting it.
 *
 * KNOWN LIMIT, stated rather than hidden: this is a lexer, not a parser, and it does not track
 * regex literals. A regex containing an unescaped `//` would be read as starting a line comment and
 * the rest of that line blanked — which could HIDE an import sharing the line. No such regex exists
 * in `web/src` today; a specifier is never on the same line as one in practice, and the failure
 * would be a miss rather than a false red. Handling it properly needs a real JS tokenizer, which is
 * a larger dependency than this rung is worth.
 */
export function stripComments(src: string): string {
  const out: string[] = [];
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "code";
  let i = 0;
  const blank = (ch: string): string => (ch === "\n" || ch === "\r" ? ch : " ");

  // Stryker disable next-line EqualityOperator,BlockStatement: NOT KILLABLE BY ASSERTION — both mutants make this loop non-terminating (an unreachable guard, or a body that never advances `i`), so the only observation available is a timeout, and Stryker attributes no `killedBy` test to a timeout. They ARE detected; they cannot be credited. Same reason for every `i += 1` below.
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (mode === "code") {
      if (ch === "/" && next === "/") {
        mode = "line";
        out.push("  ");
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        mode = "block";
        out.push("  ");
        i += 2;
        continue;
      }
      if (ch === "'") mode = "sq";
      else if (ch === '"') mode = "dq";
      else if (ch === "`") mode = "tpl";
      out.push(ch);
      // Stryker disable next-line AssignmentOperator: NOT KILLABLE — `i -= 1` loops forever; a hang carries no killedBy.
      i += 1;
      continue;
    }

    if (mode === "line") {
      if (ch === "\n") mode = "code";
      out.push(blank(ch));
      // Stryker disable next-line AssignmentOperator: NOT KILLABLE — `i -= 1` loops forever; a hang carries no killedBy.
      i += 1;
      continue;
    }

    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        out.push("  ");
        i += 2;
        continue;
      }
      out.push(blank(ch));
      // Stryker disable next-line AssignmentOperator: NOT KILLABLE — `i -= 1` loops forever; a hang carries no killedBy.
      i += 1;
      continue;
    }

    // Inside a string / template literal: copy verbatim, honouring backslash escapes.
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — forcing this true only changes
    // behaviour when `next` is undefined, i.e. a backslash as the final character. There
    // `out.push(ch, next)` pushes `undefined`, which `Array.join("")` renders as the empty string,
    // and `i += 2` runs past the end exactly as `i += 1` would on the following iteration. Both the
    // output and the termination are byte-identical, so no input can distinguish them.
    if (ch === "\\" && next !== undefined) {
      out.push(ch, next);
      i += 2;
      continue;
    }
    if ((mode === "sq" && ch === "'") || (mode === "dq" && ch === '"') || (mode === "tpl" && ch === "`")) {
      mode = "code";
    }
    out.push(ch);
    // Stryker disable next-line AssignmentOperator: NOT KILLABLE — `i -= 1` loops forever; a hang carries no killedBy.
    i += 1;
  }

  return out.join("");
}

// ── extractStaticImports ──────────────────────────────────────────────────────

// Matches static `import … from '…'` and bare `import '…'` statements, INCLUDING the multi-line
// form. Anchored at a statement boundary (^, ; or \n) to exclude dynamic import() calls.
//
// ⚠ THE CLAUSE CLASS MUST NOT EXCLUDE `\n` — that was the defect (2026-08-28). `[^'"(;\n]*?` made
// the scanner blind to every `import {\n  a,\n} from '…'` in the repo, which is how most of this
// codebase writes a multi-line import. A blind scanner does not report a miss; it reports a clean
// closure, so the rung certified a green over a graph it had never walked. The three fences that
// actually keep the match from running away are the ones kept here: `;` and `'`/`"` are excluded
// (so a match cannot cross a statement boundary), and `(` is excluded (so `import(` cannot match).
// Newlines were never one of those fences — an import clause simply spans them.
//
// The `type` guard sits in a lookahead placed IMMEDIATELY after `import`, not after the whitespace.
// Written the old way (`import\s+(?!type…)`), `\s+` backtracks to one space on `import  type { X }`
// and the negative lookahead then passes over a space, so a double-spaced `import type` matched.
const STATIC_IMPORT_RE =
  /(?:^|[;\n])\s*import\b(?!\s+type[\s{*,])\s*(?:[^'"();]*?\bfrom\s*)?['"]([^'"\n]+)['"]/gm;

// Matches `export { … } from '…'` and `export * from '…'`, multi-line form included.
// ⚠ The Stryker directive below must sit on the line IMMEDIATELY above the regex LITERAL, not above
// the `const`. `disable next-line` is positional, and a declaration split across two lines puts the
// mutable literal one line further down than it looks — so the directive silently covered nothing.
//
// EQUIVALENT on the `\s*`→`\S*` mutant: `\S*` matches the empty string, and the `[^'"();]*?` clause
// that follows accepts whitespace, so it absorbs whatever the first atom declines to take. Checked
// against five shapes (indented, tight, double-spaced, semicolon-anchored, fully newline-broken):
// identical specifier lists from both patterns.
const EXPORT_FROM_RE =
  // Stryker disable next-line Regex: EQUIVALENT — see the note directly above.
  /(?:^|[;\n])\s*export\b(?!\s+type[\s{*,])\s*[^'"();]*?\bfrom\s*['"]([^'"\n]+)['"]/gm;

/**
 * Extract all specifiers reachable at first paint — static import/export-from edges only.
 * Dynamic `import()` calls and `import type` declarations are excluded; comments are blanked
 * first (see {@link stripComments}) so neither prose nor a trailing note can move the result.
 */
export function extractStaticImports(src: string): string[] {
  const code = stripComments(src);
  const specifiers: string[] = [];

  for (const m of code.matchAll(STATIC_IMPORT_RE)) {
    const spec = m[1];
    if (spec !== undefined) specifiers.push(spec);
  }

  for (const m of code.matchAll(EXPORT_FROM_RE)) {
    const spec = m[1];
    if (spec !== undefined) specifiers.push(spec);
  }

  return specifiers;
}

// ── isWebGlSpecifier ──────────────────────────────────────────────────────────

/**
 * Returns true if the specifier or resolved path reaches a WebGL surface that must not
 * appear in the Act 1 static closure: the bare `three` package, any `@react-three/*`
 * namespace package, or any path whose segments include `forest-world-r3f` (the synced
 * R3F island dir, ADR-0134 §1 tech split).
 */
export function isWebGlSpecifier(specifier: string): boolean {
  if (specifier === "three") return true;
  if (specifier.startsWith("@react-three/")) return true;
  return specifier.split("/").includes("forest-world-r3f");
}

// ── Astro client-vs-build-time split ──────────────────────────────────────────

/**
 * What an Astro page's imports actually DO, split by whether the browser downloads them.
 *
 * ⚠ THIS SPLIT IS THE POINT OF THE RUNG, and its absence was the second half of the 2026-08-28
 * defect. Astro frontmatter (the `---` fenced region) runs at BUILD time: it renders to markup and
 * ships no bytes. Seeding the closure at the page FILE therefore walks a graph the visitor never
 * downloads, and `web/src/pages/index.astro` really does reach `act2-director` that way — through a
 * frontmatter import that serialises a map to SVG at build time. Measured on the built output
 * (2026-08-28, `astro build` at web `c61fbbaf`): the entry page ships ONE 20,826-byte chunk with
 * zero static imports and no `three`, `@react-three/*` or `act2-director` in it; the whole `_astro`
 * output directory is 80 KB. So the page's real client closure is WebGL-free and its file-level
 * closure is not, and only one of those two is a property about what Act 1 ships.
 *
 * The two defects CANCELLED. The seed over-reached into build-time code that genuinely reaches
 * WebGL, and the scanner under-reached past every multi-line import — including the one that would
 * have surfaced it. Net result: a rung that printed OK while walking almost nothing. Fixing either
 * alone is wrong in an obvious direction (scanner-only reds the gate on a non-defect; seed-only
 * leaves the blindness); this file fixes both.
 */
export interface AstroEntrySeeds {
  /** Specifiers the browser downloads: bundled `<script>` blocks and hydrated island components. */
  readonly client: readonly string[];
  /** Frontmatter-only specifiers — build-time, zero shipped bytes. Reported, never a failure. */
  readonly buildTime: readonly string[];
}

/**
 * The `---` fenced frontmatter region of an Astro page, or null when the page has none.
 *
 * ⚠ THE CONTENT GROUP IS OPTIONAL-AND-NEWLINE-TERMINATED, not lazy-anything. Written the obvious
 * way — `([\s\S]*?)\r?\n---` — it requires a newline BEFORE the closing fence, so an EMPTY
 * frontmatter (`---\n---`, which is ordinary Astro and what a page with no build-time code looks
 * like) did not match at all. Such a page then fell into the no-fence FAIL-WIDE branch and had its
 * whole body treated as the client seed.
 *
 * That produced the right verdict for the wrong reason, which is why it survived: the fail-wide
 * answer and the correct answer agree whenever a page has nothing in its frontmatter. It was found
 * by mutation-testing — a mutant that broke `SCRIPT_BLOCK_RE` outright did not fail the test that
 * existed to cover it, because that test's empty-frontmatter fixture never reached the script path.
 * Test fixtures with empty frontmatter are the ones to distrust here.
 */
const ASTRO_FRONTMATTER_RE = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/;

/** Every `<script …>…</script>` block. Astro BUNDLES these into the page's client payload. */
const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * A component tag carrying any `client:*` hydration directive. Astro ships a hydrated island's
 * module to the browser, so its frontmatter import is a CLIENT entry even though it is written in
 * the build-time region — the one way a frontmatter import can legitimately reach the visitor, and
 * therefore exactly how WebGL would arrive if someone added an island tomorrow. The site has no
 * island today; this is here so that adopting one cannot silently step outside the guard.
 */
// Stryker disable next-line Regex: EQUIVALENT on the `[a-z]+`→`[a-z]` mutant — nothing is anchored
// to the RIGHT of the directive name, so matching one letter of `load` / `visible` / `only` accepts
// exactly the same tags as matching all of them. Checked against those three plus two non-matching
// controls (`client:` with no name, and `clientx`): identical component lists.
const CLIENT_ISLAND_RE = /<([A-Z][A-Za-z0-9_$.]*)\b[^>]*?\sclient:[a-z]+/g;

/** `import Name from '…'` bindings in the frontmatter: component name → specifier. */
// Stryker disable next-line Regex: EQUIVALENT on the two `import type` lookahead mutants
// (`\s+`→`\s` and `\s+`→`\S+`). Both can only stop a type-only import being EXCLUDED, and an import
// that survives the lookahead still has to reach `\bfrom` immediately after one identifier — which
// `type Name from` never does, because `Name` sits between them. The match fails either way, so no
// binding is recorded in either version and no island can be promoted differently.
const DEFAULT_IMPORT_RE = /(?:^|[;\n])\s*import\b(?!\s+type\b)\s*([A-Za-z_$][\w$]*)\s*(?:,[^'"();]*?)?\bfrom\s*['"]([^'"\n]+)['"]/gm;

/**
 * Split an Astro page's imports into what ships and what does not.
 *
 * A page with no `---` frontmatter fence is not an Astro page (a plain `.html` entry, say): every
 * import it carries is a client import, so the whole file is treated as the client seed. That is
 * the fail-WIDE direction, matching the classifier posture elsewhere in the gate.
 */
export function extractAstroEntrySeeds(page: string): AstroEntrySeeds {
  const fence = ASTRO_FRONTMATTER_RE.exec(page);
  if (fence === null) return { client: extractStaticImports(page), buildTime: [] };

  // Stryker disable next-line StringLiteral: EQUIVALENT — group 1 is a mandatory capture in
  // ASTRO_FRONTMATTER_RE, so it participates in every successful match and the `?? ""` arm is
  // unreachable. It is a type-narrowing default, not a behaviour.
  const frontmatter = fence[1] ?? "";
  const body = page.slice(fence[0].length);
  const code = stripComments(body);

  const client: string[] = [];
  for (const m of code.matchAll(SCRIPT_BLOCK_RE)) {
    // Stryker disable next-line StringLiteral: EQUIVALENT — same reason: SCRIPT_BLOCK_RE's group 1
    // is mandatory, so the `?? ""` arm cannot be reached.
    client.push(...extractStaticImports(m[1] ?? ""));
  }

  // Hydrated islands: promote the component's frontmatter import to a client entry.
  const bindings = new Map<string, string>();
  for (const m of stripComments(frontmatter).matchAll(DEFAULT_IMPORT_RE)) {
    const [, name, spec] = m;
    // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT — both capture
    // groups in DEFAULT_IMPORT_RE are mandatory, so on any successful match both are strings and
    // neither can be undefined. The guard narrows types for the compiler; it never runs false.
    if (name !== undefined && spec !== undefined) bindings.set(name, spec);
  }
  const hydrated = new Set<string>();
  for (const m of code.matchAll(CLIENT_ISLAND_RE)) {
    // Stryker disable next-line StringLiteral: EQUIVALENT — CLIENT_ISLAND_RE's group 1 is mandatory
    // (so the first `?? ""` is unreachable), and `String.split` always returns at least one element
    // (so the second is too). Both are type-narrowing defaults.
    const spec = bindings.get((m[1] ?? "").split(".")[0] ?? "");
    if (spec !== undefined) hydrated.add(spec);
  }
  client.push(...hydrated);

  const buildTime = extractStaticImports(frontmatter).filter((sp) => !hydrated.has(sp));
  return { client, buildTime };
}

// ── collectEntrySeeds ─────────────────────────────────────────────────────────

/** Resolved seed paths for one entry page, walked across `.astro` component boundaries. */
export interface EntrySeeds {
  /** Paths whose module graph the browser downloads. A WebGL reach from here is a LEAK. */
  readonly client: readonly string[];
  /** Build-time-only paths: rendered to markup, zero shipped bytes. Reported, never failed. */
  readonly buildTime: readonly string[];
}

/**
 * Collect an entry page's seeds, following `.astro` components into their OWN script blocks.
 *
 * ⚠ WHY THIS WALKS RATHER THAN SPLITTING ONE FILE, and why the single-file split was a new
 * blindness of exactly the kind this rung was repaired for. Astro bundles and ships the `<script>`
 * block of EVERY `.astro` component it renders — hydration is irrelevant, because a script tag is
 * not an island. So classifying a frontmatter-imported component as "build-time" and walking no
 * further is wrong in the direction that matters: `src/pages/index.astro` imports `Base.astro`,
 * which imports `Nav.astro` and `Footer.astro`, and a `<script>` added to any of the three would
 * reach the visitor while this rung filed its WebGL as a harmless note. That is a false GREEN, and
 * a false green is worse than a red because it is read as reassurance.
 *
 * None of those three carries a script block today — which is the point. The hole is not currently
 * exploited, and a guard that only holds while nobody exercises it is not a guard.
 *
 * Non-`.astro` build-time files are NOT re-walked here: a `.ts` module has no script block, so its
 * frontmatter-reached graph stays build-time and is swept for reporting by the caller.
 */
export function collectEntrySeeds(
  page: string,
  readFile: (p: string) => string | null,
): EntrySeeds {
  const client: string[] = [];
  const buildTime: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [page];

  // Stryker disable next-line EqualityOperator,BlockStatement: NOT KILLABLE BY ASSERTION — `>= 0`
  // drains the queue forever (`shift()` on an empty array yields undefined, which reads as nothing
  // and never enqueues), and an empty body never drains it at all. Both hang, and a timeout carries
  // no `killedBy`, so neither can be credited to a test. `collectEntrySeeds: terminates on an
  // .astro import cycle` is the assertion that covers this loop's termination on real input.
  while (queue.length > 0) {
    const current = queue.shift()!;
    // Stryker disable next-line ConditionalExpression: NOT KILLABLE BY ASSERTION — dropping the
    // visited guard makes an `.astro` import cycle loop forever, which is a timeout, not a failure.
    if (visited.has(current)) continue;
    // Stryker disable next-line CallExpression: NOT KILLABLE BY ASSERTION — same cycle, same hang:
    // a visited set that is never written is a visited set that never matches.
    visited.add(current);

    const source = readFile(current);
    if (source === null) continue;

    const split = extractAstroEntrySeeds(source);
    for (const spec of split.client) client.push(resolveSpecifier(current, spec));
    for (const spec of split.buildTime) {
      const resolved = resolveSpecifier(current, spec);
      // An `.astro` component ships its own script block, so keep walking it as a page.
      if (resolved.endsWith(".astro")) queue.push(resolved);
      else buildTime.push(resolved);
    }
  }

  return { client, buildTime };
}

// ── walkStaticClosure ─────────────────────────────────────────────────────────

/**
 * Resolve a relative import specifier from the directory of `fromFile`.
 * Bare specifiers (not starting with `.`) are returned as-is and tracked in the closure.
 *
 * Kept internal deliberately: {@link collectEntrySeeds} resolves seeds with THIS function, in the
 * same space {@link walkStaticClosure} resolves in. A second copy of the rule in a caller would be
 * a duplicate of the thing under test — the fault class this file's repairs exist to remove — and
 * the two could drift apart silently.
 */
function resolveSpecifier(fromFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : ".";
  const combined = `${fromDir}/${specifier}`;
  const parts = combined.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

/**
 * Walk the static import closure from `entryPath`, returning every reachable specifier /
 * path (including the entry itself). `readFile` returns source text or null for nodes that
 * cannot be read (external packages, absent files) — those are still included in the closure
 * but not recursed into. Handles circular imports without looping.
 */
export function walkStaticClosure(
  entryPath: string,
  readFile: (p: string) => string | null,
): Set<string> {
  const closure = new Set<string>();
  const queue: string[] = [entryPath];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);

    const content = readFile(current);
    if (content === null) continue;

    for (const specifier of extractStaticImports(content)) {
      const resolved = resolveSpecifier(current, specifier);
      if (!closure.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return closure;
}

// ── checkExperienceEntry ──────────────────────────────────────────────────────

/**
 * The combined judge: marker contract + WebGL wall. Returns an empty array when the
 * entry passes, or one or more `ExperienceProblem` entries when it fails.
 */
export function checkExperienceEntry(
  page: string,
  act1Entry: string,
  readFile: (p: string) => string | null,
): ExperienceProblem[] {
  const problems: ExperienceProblem[] = [];

  // 1. Marker contract
  const markers = findExperienceMarkers(page);
  if (!markers.hasSkip) {
    problems.push({
      kind: "missing-skip-marker",
      detail: "data-experience-skip not found in the experience entry page",
    });
  }
  if (!markers.hasFallback) {
    problems.push({
      kind: "missing-fallback-marker",
      detail: "data-experience-fallback not found in the experience entry page",
    });
  }

  // 2. No-WebGL-in-Act-1 wall
  const closure = walkStaticClosure(act1Entry, readFile);
  for (const specifier of closure) {
    if (isWebGlSpecifier(specifier)) {
      problems.push({ kind: "webgl-leak", detail: specifier });
    }
  }

  return problems;
}

// ── Site-level judge ──────────────────────────────────────────────────────────

/**
 * The explicit adoption signal: a page under `src/pages/` carrying this attribute IS the
 * experience entry. Today's site has no such page, so the check SKIPs (bootstrap allowance —
 * the guard lands before the storm); the storm cap declares it when it flips home. Detection
 * must be this explicit: keying on a page PATH (e.g. index.astro exists) would arm the gate
 * against the pre-experience site and red every increment until the storm lands.
 */
export const EXPERIENCE_ENTRY_MARKER = "data-experience-entry";

/** Pages (paths under `src/pages/`) whose content carries the entry marker, sorted. */
export function findExperienceEntries(files: ReadonlyMap<string, string>): string[] {
  const entries: string[] = [];
  for (const [p, content] of files) {
    if (p.startsWith("src/pages/") && content.includes(EXPERIENCE_ENTRY_MARKER)) entries.push(p);
  }
  return entries.sort();
}

const RESOLVE_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx", ".astro"];

/**
 * Wrap a raw reader with import-resolution fallbacks: try the literal path, then the known
 * source extensions (an extensionless `../scripts/act1` resolves to `act1.ts`). Without this
 * the closure walk stops silently at extensionless specifiers and the WebGL wall is toothless
 * the day the storm lands — a silent false-green.
 */
export function withExtensionFallback(
  readFile: (p: string) => string | null,
): (p: string) => string | null {
  return (p) => {
    const direct = readFile(p);
    if (direct !== null) return direct;
    for (const ext of RESOLVE_EXTENSIONS) {
      const withExt = readFile(p + ext);
      if (withExt !== null) return withExt;
    }
    return null;
  };
}

export interface SiteFinding {
  /** web-root-relative path of the entry page the problem was found on. */
  readonly page: string;
  readonly problem: ExperienceProblem;
}

export type SiteCheckResult =
  | { readonly kind: "skip"; readonly reason: string }
  | {
      readonly kind: "checked";
      readonly entries: readonly string[];
      readonly findings: readonly SiteFinding[];
    };

/**
 * The whole-site judge the gate runs: `files` is the web/src tree as a web-root-relative
 * POSIX-path → content map. No page carries {@link EXPERIENCE_ENTRY_MARKER} → SKIP (bootstrap
 * allowance). Otherwise every entry page is held to the marker contract and the
 * no-WebGL-in-Act-1 wall, its static closure seeded at the page itself (the storm's script
 * graph hangs off the entry's imports), findings tagged with the page.
 */
export function checkExperienceSite(files: ReadonlyMap<string, string>): SiteCheckResult {
  const entries = findExperienceEntries(files);
  if (entries.length === 0) {
    return {
      kind: "skip",
      reason:
        `no page under src/pages/ carries ${EXPERIENCE_ENTRY_MARKER} — the site has not ` +
        "adopted the experience yet (bootstrap allowance: the guard lands before the storm).",
    };
  }
  const read = withExtensionFallback((p) => files.get(p) ?? null);
  const findings: SiteFinding[] = [];
  for (const page of entries) {
    const content = files.get(page) ?? "";
    for (const problem of checkExperienceEntry(content, page, read)) {
      findings.push({ page, problem });
    }
  }
  return { kind: "checked", entries, findings };
}

// ── CLI shell (main) ──────────────────────────────────────────────────────────

const TEXT_EXT = new Set([".astro", ".html", ".md", ".mdx", ".jsx", ".tsx", ".ts", ".js"]);

/** Recursively collect web-relative text-file paths under a dir (the check-web-grounding shell). */
function walkTextFiles(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTextFiles(full, base, out);
    else if (TEXT_EXT.has(path.extname(name).toLowerCase())) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

function main(): void {
  // packages/cli/src/web-experience-check.ts → four dirs up (the build-claude-md.ts pattern).
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const webRoot = path.join(repoRoot, "web");
  const webSrc = path.join(webRoot, "src");
  const inCi = process.env.CI === "true";

  // Key on web/src, not web/: an uninitialized submodule leaves an EMPTY web/ stub dir.
  if (!existsSync(webSrc)) {
    if (inCi) {
      console.error(
        "check:web-experience — web/ is not checked out in CI. The workflow must clone the " +
          "pinned storytree-web submodule before this step.",
      );
      process.exit(1);
    }
    console.log(
      "check:web-experience — SKIP: web/ submodule not checked out " +
        "(run `git submodule update --init web` to enable this check locally).",
    );
    return;
  }

  // The walk space is web-root-relative POSIX paths (never OS-native), so the pure judge's
  // string-based specifier resolution holds on Windows checkouts too.
  const files = new Map<string, string>();
  for (const rel of walkTextFiles(webSrc, webRoot)) {
    files.set(rel, readFileSync(path.join(webRoot, rel), "utf8"));
  }

  const result = checkExperienceSite(files);

  if (result.kind === "skip") {
    console.log(`check:web-experience — SKIP: ${result.reason}`);
    return;
  }

  if (result.findings.length > 0) {
    console.error(
      `check:web-experience — BLOCKED: ${result.findings.length} problem(s) across ` +
        `${result.entries.length} experience entry page(s):\n`,
    );
    for (const f of result.findings) {
      console.error(
        `  ✗ web/${f.page} [${f.problem.kind}]` +
          (f.problem.detail !== undefined ? `: ${f.problem.detail}` : ""),
      );
    }
    console.error(
      "\nThe experience entry must keep the skip + fallback affordances and a WebGL-free Act 1 " +
        "static closure (ADR-0134; dynamic import() at the inflection is the sanctioned seam).",
    );
    process.exit(1);
  }

  console.log(
    `check:web-experience — OK: ${result.entries.length} experience entry page(s) carry both ` +
      "affordance markers and their Act 1 static closure is WebGL-free.",
  );
}

// Run only when invoked directly (`tsx src/web-experience-check.ts`), not when the test imports.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
