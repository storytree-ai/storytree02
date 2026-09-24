---
id: "work-hierarchy-camp-fence"
tier: capability
story: cli
arc: map-freshness-arc
title: "Every work-hierarchy reader declares which clock it must agree with, and a gate rung holds it to that"
outcome: "A pure judge computes, from each module's own code, whether it reads the work hierarchy off the checkout or out of the live store, and a gate rung holds that computed fact against a declared camp in repo-manifest/hierarchy-camps/_domain.json — so the render/prove split cannot silently acquire an undeclared or wrong-camp reader."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [445]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/hierarchy-camps.test.ts"]
    sourceGlobs: ["packages/cli/src/hierarchy-camps.ts"]
---

# Every work-hierarchy reader declares which clock it must agree with

**Outcome —** A pure judge computes, from each module's own code, whether it reads the work hierarchy
off the CHECKOUT or out of the LIVE store, and `pnpm check:hierarchy-camps` holds that computed fact
against a camp declared in
[`repo-manifest/hierarchy-camps/_domain.json`](../../repo-manifest/hierarchy-camps/_domain.json) →
`hierarchyCamps.readers` — so the render/prove split ADR-0445 D1 created cannot silently acquire an
undeclared or wrong-camp reader.

**The condition being fenced.** ADR-0445 D1 gave the work hierarchy two readers with different
currencies, permanently: a story is disk-canonical for PROVING and live-canonical for RENDERING. Its
own Consequences name the failure mode — *"a THIRD reader added later without asking which camp it is
in"* — and nothing mechanical asked. The question a new reader has to answer is not "which is THE
source", which is malformed; it is **which clock must I agree with**. A proof must agree with the
commit it was taken at. A map must agree with now.

**Why it is not premature.** This repo has already lost the same bet once. `readCorpusStoryDocs` walks
every `stories/*/` directory and NONE of the UAT instruments filter `status: retired`, so every new
instrument built over those readers inherited that blindness for free (ADR-0396's Context). A split
with no fence acquires wrong-camp readers the same way — silently, one convenience at a time.

**Three answers, and the third is fenced rather than trusted.** `prove` reads `stories/**` off the
checkout. `render` reads the store's projection. `bridge` is the loader that writes one into the other
and the drift rung that compares them: it is not a third clock but the role of measuring the GAP, and
a `bridge` MUST read both sources — which is what stops it becoming the label a reader reaches for to
avoid answering.

**Why this is not the presence check ADR-0427 deleted.** That rung asked only whether a target's body
MENTIONED its amender's number — a string the renderer already printed, so the cheapest possible
compliance satisfied it. This one never consults a string the subject writes about itself. It computes
which source the module NAMES and holds it against an independent declaration, in both directions.
Prose cannot satisfy either half: to pass, a module has to read the source it says it reads.

**The reader is the module that NAMES the source.** A module HANDED a folded hierarchy chose no clock,
and giving it a camp would invent an answer to a question it never faced.
`apps/studio/server/hierarchySource.ts` and `apps/desktop/src/backend/hierarchy-live.ts` are therefore
deliberately absent from the map: they are SEAMS that pick between two callbacks and read nothing
themselves. Their callers name the sources and carry the camps.

**No `real:` arm** — as for its `work-hierarchy-drift-gate` sibling, and for the same reason: the
red→green is verified by mutation against the shipped suite, and there is nothing here a `--real`
build could observe that the mutation proof does not.

## Proof walkthrough first

Start from a GREEN baseline, then move exactly one thing and observe the red that moves with it — the
whole point being that a fence which cannot go red certifies the thing it was added to catch.

Add a module that names `storiesDir` and declare nothing: observe an `undeclared-reader` failure whose
text asks WHICH CLOCK rather than citing a rule number. Remove a declaration instead and observe the
same red from the other side. Point a `render` reader at the checkout and observe both
`source-not-declared` and `unstated-checkout-fallback`; add the `fallback` reason ADR-0445 D2 requires
and observe it pass. Give a `prove` reader a `PgWorkHierarchyStore` and observe
`live-read-in-the-prove-camp`. Make a `render` reader with no stated fallback import a `prove` reader's
exported walker and observe `render-reaches-a-prove-reader` — reaching the wrong clock through a helper
is still reaching it. Declare a single-source module a `bridge` and observe `bridge-that-spans-nothing`.
Finally hand it each shape of blindness — an absent manifest, no `hierarchyCamps` block, an empty
reader map, a sweep that walked no files — and observe that none of them ever reads as a clean pass:
each is a BLIND CHECK, distinct from a breach, because a reader must not go hunting for a wrong-camp
module when what actually broke is an enumeration.

## Build boundary

Author only:

- `packages/cli/src/hierarchy-camps.ts` (the pure judge) and its `.test.ts`
- `packages/cli/src/check-hierarchy-camps.ts` (the thin gatherer — and the wiring: the
  `/* gate-check` declaration it opens with is the whole registration, since the gate finds a check
  by its file name and reads where it runs from that header, ADR-0606 D1)
- `repo-manifest/hierarchy-camps/_domain.json` (`hierarchyCamps`, the declared map)
- `package.json` (the root `check:hierarchy-camps` script — a by-hand convenience; the gate does not
  read it)

*(Corrected in place 2026-09-24 for ADR-0606 D1: the last bullet named `package.json`,
`packages/cli/src/gate-order.ts`, `packages/cli/src/gate-order.test.ts` and `.github/workflows/ci.yml`
as the wiring. The gate's hand-kept plan and CI's check steps are gone — a check is found from its own
file — so none of those is where a rung is registered any more.)*

Every rule lives in the judge; the rung walks the disk, reads the manifest, prints and sets an exit
code. It is `own-work` on both ordering axes — offline, disk-only, no store and no credential — so it
sits cheap-first beside `check:boundaries` and `check:ownership-totality`, and its store-reading
sibling `check:hierarchy-drift` stays in the shared-environment block.

## Contracts

1. **`hierarchy-camps-holds-the-reader-map-total`** — the map is total in BOTH directions.
   - **asserts —** a module the sweep classifies as reading the hierarchy and that no declaration
     names FAILS as `undeclared-reader`; and a declaration naming a module that reads nothing, or a
     file the sweep never saw, FAILS too — told apart from each other, because "drop the entry" and
     "the sweep can no longer see how it reads" are different repairs.
   - **proven by —** `packages/cli/src/hierarchy-camps.test.ts`, with test titles beginning with this
     exact contract id.
2. **`hierarchy-camps-reds-on-a-wrong-camp-read`** — the declared camp is held to the computed one.
   - **asserts —** a `prove` reader that opens the live store FAILS; a `render` reader that reads the
     checkout with no stated `fallback` FAILS and passes once it is stated (ADR-0445 D2 permits the
     fallback and requires it to be STATED); a source the code performs and the declaration omits
     FAILS; a source the declaration claims and the code no longer performs FAILS; and a `bridge`
     that reads a single source FAILS, so the role cannot be worn to dodge the question.
   - **proven by —** `packages/cli/src/hierarchy-camps.test.ts`, same prefix.
3. **`hierarchy-camps-reds-when-a-render-reader-reaches-through-a-helper`** — the indirect route is
   fenced as well as the direct one.
   - **asserts —** a `render` reader with no stated fallback that value-imports a symbol a `prove`
     reader exports FAILS, naming both modules and the symbol; the same reader with a stated fallback
     does not, because the statement is what ADR-0445 D2 asks for.
   - **proven by —** `packages/cli/src/hierarchy-camps.test.ts`, same prefix.
4. **`hierarchy-camps-never-reports-a-blinded-sweep-as-clean`** — an unknown answer is refused, not
   waved through.
   - **asserts —** a sweep that walked zero modules and an empty declaration map both THROW
     `VacuousCampSweep` rather than returning a verdict; and every unreadable manifest shape — invalid
     JSON, no `hierarchyCamps` block, no `readers` object, a camp outside the three, an empty or
     invalid `reads`, a non-string `fallback` — is reported as `unread` rather than silently dropping
     the entry, which downstream would read as an undeclared reader and send the author to write a
     declaration that is already there.
   - **proven by —** `packages/cli/src/hierarchy-camps.test.ts`, same prefix.
5. **`hierarchy-camps-classifies-by-what-the-code-names`** — naming the tree is not reading it.
   - **asserts —** an identifier naming the stories directory is a checkout read while `storiesDirty`
     is not; a mention in a COMMENT and a `stories` fragment inside a REGEX LITERAL are neither (a
     pattern matches paths, it does not read them — which is also what keeps this judge from
     classifying itself, on the same rule as every other matcher rather than by a name exemption); a
     module that imports no `node:` builtin cannot be a checkout reader and becomes one when it can; a
     barrel that RE-EXPORTS the store door obtains nothing; opening `PgWorkHierarchyStore` IS a live
     read; only VALUE imports count and a dynamic destructured `await import` is one; and the comment
     scanner does not end a regex literal inside a character class — the defect that made this judge
     classify itself on its own doc prose, caught 2026-08-26.
   - **proven by —** `packages/cli/src/hierarchy-camps.test.ts`, same prefix.

## Open modeling calls

- **The aperture is stated rather than closed.** A module that names the tree in a literal and reads
  it through an INJECTED filesystem — no `node:` import of its own and no `storiesDir`-shaped name —
  is invisible to the sweep. No such module exists today (measured across 782 modules, 2026-08-26).
  If one appears, the remedy is to widen the seed, not to loosen the rule.
- **The cross-camp rule resolves helpers by SYMBOL NAME, not by module path.** A name collision
  over-reports, which is the safe direction; a renamed export is simply no longer the same symbol.
  Resolving specifiers properly would need barrel-hop resolution for every workspace package, and the
  measured benefit did not justify it.
