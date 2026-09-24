---
id: "experience-rollout-guardrails"
tier: capability
story: website-experience
title: "Skip and fallback are first-class from the first increment — machine-guarded"
outcome: "A parent-side judge, web-experience-check.ts, reds when the experience entry page lacks the persistent skip-to-calm affordance marker or the prefers-reduced-motion / no-WebGL fallback marker, or when any module statically reachable from the Act 1 entry imports the R3F island or three; absent an experience entry it SKIPs (bootstrap allowance). It is BUILT and answers on demand — ADR-0311 D2 retired its check:web-experience rung; ADR-0336 (2026-08-09) re-wired the no-WebGL static-import-closure third as the new check:web-experience-closure gate rung, and ADR-0454 (2026-08-26) re-wired the skip/fallback MARKER-presence third too, as check:web-experience-markers, so a static R3F/three leak into Act 1 and a marker regression are both machine-stopped on every merge again."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [123, 215]
# Node-borne proof config (ADR-0057 keystone). NET-NEW: the leaf authors a node:test file importing a
# NOT-YET-EXISTING pure judge module (packages/cli/src/web-experience-check.ts) — red =
# module-not-found at HEAD — then writes the judge (green). The judge is PURE (file-path → content
# maps in, findings out; the web-engine-sync discipline), so every assertion runs offline over
# in-memory fixtures — no web/ checkout needed in the proof. This proof block is UNAFFECTED by the
# ADR-0311 D2 retirement above: it binds the judge's own test + source, both of which still exist and
# still run green. The IO shell (reading the real web/ sources) landed as orchestrator-supplemented
# GLUE and still runs on demand; the root `check:web-experience` script and its `pnpm gate` slot were
# retired and no longer exist. The site-side markers themselves (`data-experience-entry` arming
# the gate, `data-experience-skip`, `data-experience-fallback` on the entry) land WITH the
# storm/inflection caps — this cap ships the WALL, those caps satisfy it. install: true (the suite
# runs under @storytree/cli; fresh-worktree
# tsx + tsc, ADR-0031 §2) + the typecheck wall.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/web-experience-check.test.ts"]
    sourceGlobs: ["packages/cli/src/web-experience-check.ts"]
  real:
    testFile: "packages/cli/src/web-experience-check.test.ts"
    sourceFile: "packages/cli/src/web-experience-check.ts"
    scope:
      testGlobs: ["packages/cli/src/web-experience-check.test.ts"]
      sourceGlobs: ["packages/cli/src/web-experience-check.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
---

# Skip and fallback are first-class from the first increment — machine-guarded

**Outcome —** A parent-side judge reds when the experience entry page lacks the persistent
**skip-to-calm** affordance marker or the **`prefers-reduced-motion` / no-WebGL fallback** marker,
or when any module statically reachable from the Act 1 entry imports the R3F island or `three`.
Absent an experience entry it SKIPs — so the guard could land BEFORE the storm and fail closed the
moment the storm exists.

> **⚠ THE COMBINED RUNG IS RETIRED — THE JUDGE IS NOT, AND ALL THREE OF ITS PROPERTIES ARE NOW
> GATE-ENFORCED AGAIN THROUGH TWO NARROWER RUNGS. Read every `check:web-experience` mention in this
> story against this paragraph.** ADR-0311 D2 (2026-08-05) retired `check:web-experience` from the
> gate. It is **not a root `package.json` script**, **not a step of the gate's plan**, and **not a
> CI step** — its own file,
> [`packages/cli/src/web-experience-check.ts`](../../packages/cli/src/web-experience-check.ts),
> opens with a `retired: ADR-0311 D2` declaration, so the gate lists it and never runs it
> (ADR-0606 D6), and it carries the `UNWIRED` banner the tombstone pins. *(Until 2026-09-24 it was
> declared in a central `RETIRED_CHECKS` map in `packages/cli/src/gate-order.ts`, which ADR-0606 D6
> replaced with that in-file declaration.)* **That name specifically stays unwired — but its
> three properties do not**: ADR-0336 (2026-08-09) re-wired the no-WebGL static-import-closure third
> as `check:web-experience-closure`, and ADR-0454 (2026-08-26) re-wired the skip/fallback
> marker-presence third as `check:web-experience-markers` (below). Between those two dates the marker
> half genuinely had no machine watching it; since 2026-08-26 it does again.
>
> What SURVIVES is real and is the reason this is a re-scope rather than a retirement. The judge and
> its fs shell are intact and **directly runnable** —
> `npx tsx packages/cli/src/web-experience-check.ts` answers today (SKIP without the `web/`
> submodule checked out; ARMED against a checkout carrying the entry marker). Its four contracts are
> still proven: the leaf's signed PASS (`real-mr2tjkid` @ `fc9b20f`) stands, and
> `web-experience-check.test.ts` still runs green under `pnpm -r test`. That green was never by
> itself evidence the rule was enforced on a merge — it is exactly the trap ADR-0311's Consequences
> named — but as of ADR-0454 the same primitives it exercises are also reached by a live gate rung on
> every merge, so the gap that trap named is closed for all three properties now.
>
> **Re-wiring was an owner decision, not a wiring change** (ADR-0311 D5: fresh production-catch
> evidence AND an ADR, never merely the wiring). It is surfaced as the story's open modeling call 9.
>
> **UPDATE 2026-08-09 (ADR-0336):**
> call 9 closed NARROWLY. Only the no-WebGL static-import-closure THIRD of this judge is re-wired, as
> a NEW, distinct gate rung — `check:web-experience-closure`
> ([`packages/cli/src/check-web-experience-closure.ts`](../../packages/cli/src/check-web-experience-closure.ts)),
> which reuses this file's `findExperienceEntries` / `walkStaticClosure` / `isWebGlSpecifier` /
> `withExtensionFallback` exports rather than re-deriving them. `check:web-experience` itself, and the
> marker-contract half of THIS file's own judge (`findExperienceMarkers`, and the marker half of
> `checkExperienceEntry`/`checkExperienceSite`), stay exactly as retired and `UNWIRED` as described
> above — the skip/fallback marker properties remain unguarded by any machine, a known and accepted
> gap (ADR-0336 D2).
>
> **UPDATE 2026-08-26 (ADR-0454): the marker gap ADR-0336 D2 accepted is closed.** ADR-0454 found that
> the premise behind leaving the marker half retired — that re-wiring it needs a live-site fetch or a
> dependency on unmerged cross-repo work — did not match what `findExperienceMarkers` actually does: a
> plain static string search (`html.includes("data-experience-skip")`) over the SAME static source
> text `checkExperienceEntry` already reads, no network involved. On that corrected premise it re-wired
> the marker third as its own new gate rung, `check:web-experience-markers`
> ([`packages/cli/src/check-web-experience-markers.ts`](../../packages/cli/src/check-web-experience-markers.ts)),
> reusing this file's `findExperienceEntries` / `findExperienceMarkers` exports rather than re-deriving
> them, and following the same bootstrap-allowance / local-SKIP / CI-fail posture as its closure
> sibling. `check:web-experience` itself still stays retired and unwired (ADR-0454 D3) — the readmission
> is per-slice, not a restoration of the combined rung — but as of this ADR all three of the original
> judge's properties are gate-enforced again, split across two rungs instead of one. The residual gap
> both ADRs accept is unchanged: static source presence is not proof the affordance works at runtime.

**Depends on —** (root — deliberately upstream of `act1-terminal-storm`: the storm may only face
real visitors once these exits are machine-guarded. Owner decision 6, 2026-07-02.)

> **Proof status (honest) — BUILT, leaf-proven; the authored status stays `proposed`.** The gated
> SDK leaf authored `web-experience-check.test.ts` red (module-not-found) → `web-experience-check.ts`
> green through the real prove-it-gate (run `real-mr2tjkid`, signed PASS @ `fc9b20f` 2026-07-02,
> persisted to `events.verdict`; package typecheck + suite observed green in the installed worktree);
> the four contracts are cited at real `file:line` below (`storytree coverage
> experience-rollout-guardrails` → 4/4). The orchestrator glue WAS landed — the root
> `check:web-experience` script, its `pnpm gate` slot, and the CI step after "web engine in sync" —
> and verified against the real pinned site (bootstrap SKIP at that pre-storm pin — no entry marker yet;
> ARMED + OK from the 2026-07-02 home flip, which put all three markers on the entry page, until
> **ADR-0311 D2 retired all three wirings on 2026-08-05**; see the ⚠ note above. The judge itself and
> its fs shell survive and still answer when invoked directly. The ADEQUACY of the
> exits (does the fallback read as a real calm view; does the skip land well) stays human — **story-UAT
> leg 5** as of the 2026-07-25 witness re-adjudication, which gave that claim its own explicit human leg
> instead of leaving it in this prose (the exits' BEHAVIOUR — the exit resolving to the calm view, the
> a11y visitor never being played the storm — became machine leg 4, distinct from what the gate can see).
> The gate itself still guards only PRESENCE and the no-WebGL floor, which is exactly what a machine can
> honestly hold here; `healthy` stays earned, never authored (ADR-0020).

## Guidance

WHY THIS IS A CAPABILITY, NOT A CONTRACT: one cohesive guard — the marker contract, the
import-reachability walk, and the bootstrap allowance form a single judge with one verdict, proven
by integration over fixture site-trees, not one isolated assertion.

THE MARKER CONTRACT (the `data-grounds` precedent, ADR-0056). The experience entry declares its
exits as attributes the judge greps structurally: `data-experience-skip` on the persistent
skip-to-calm control and `data-experience-fallback` on the reduced-motion / no-WebGL path. Markers
are cheap for the site, stable across redesigns, and honest about what a static check can know —
presence, not adequacy.

THE ADOPTION MARKER (as built). A page under `src/pages/` becomes "the experience entry" by
carrying **`data-experience-entry`** (`EXPERIENCE_ENTRY_MARKER`,
`packages/cli/src/web-experience-check.ts:196`) — the explicit signal that ARMS the judge. Detection
must be this explicit: keying on a page PATH (e.g. `index.astro` exists) would have armed it
against the pre-experience site and redded every increment until the storm lands. The storm cap
adds all THREE markers when it flips home; the closure walk is seeded at the entry page itself (the
storm's script graph hangs off its imports, resolved extensionless-tolerant via
`withExtensionFallback`, `web-experience-check.ts:215`).

THE NO-WEBGL-IN-ACT-1 WALL (ADR-0216 D2/D4 — tech split + "the exhale buys the load"). Act 1 is
plain DOM/CSS + canvas + Web Audio; the R3F bundle may load ONLY at the inflection. The judge walks
static import edges from the Act 1 entry module (the storm's script entry) and reds if the closure
reaches `three`, `@react-three/*`, or the synced `forest-world-r3f` dir. Dynamic `import()` behind
the inflection is the sanctioned lazy-load seam and is NOT counted — the wall is against STATIC
reachability (the thing that would drag WebGL into first paint).

THE BOOTSTRAP ALLOWANCE (the `check:web-engine` posture). No experience entry in `web/` yet → SKIP
with a note, never a failure — the site has not adopted the experience. The moment the entry
exists, every rule fails closed *within the judge's own verdict*. An absent `web/` submodule follows
the established local-SKIP / CI-fail posture — though with the rung retired there is no CI leg left
to fail, so the SKIP is what a direct invocation prints on a worktree without the submodule.

FENCES — what this judge must NOT become: no pixel/appearance assertions (operator-attested,
ADR-0070); no performance budget (an open owner call — story open call 3); no page-copy rules
(`check:web-grounding` owns claims). One narrow job: the exits exist and Act 1 stays WebGL-free.

## Integration test

**Goal —** Prove the pure judge over fixture site-trees: missing markers red, static R3F
reachability from Act 1 reds, the faithful fixture greens, the empty fixture SKIPs.

1. Fixture with an entry page carrying both markers and an Act 1 module graph that never touches
   R3F → assert GREEN (no findings).
2. Remove `data-experience-skip` → assert one finding naming the entry + the missing marker; same
   for `data-experience-fallback`.
3. Add `import { ForestWorldCanvas } from "../lib/forest-world-r3f/..."` (or `from "three"`) to a
   module statically reachable from the Act 1 entry → assert a finding naming the import CHAIN; move
   the same reference behind a dynamic `import()` → assert green (the sanctioned lazy-load seam).
4. Fixture with NO experience entry → assert SKIP (bootstrap allowance), not a failure.

## Contracts (4)

Each one isolated automated test in `packages/cli/src/web-experience-check.test.ts` (`node:test`,
offline, fixture trees). Per ADR-0122 each contract id leads a distinctly-named test so
`storytree coverage experience-rollout-guardrails` reports 4/4.

1. **`erg-skip-marker-required`** — the storm is never a toll booth
   - **asserts —** an experience entry without the `data-experience-skip` marker reds with the page
     named; present → no finding.
   - **covers —** `packages/cli/src/web-experience-check.ts:41` (`findExperienceMarkers`) via
     `checkExperienceEntry:154`, page-tagged by `checkExperienceSite:250`
2. **`erg-fallback-marker-required`** — reduced-motion / no-WebGL visitors get the calm view
   - **asserts —** an experience entry without the `data-experience-fallback` marker reds with the
     page named; present → no finding.
   - **covers —** `packages/cli/src/web-experience-check.ts:41` (`findExperienceMarkers`, the
     `hasFallback` half) via `checkExperienceEntry:154`
3. **`erg-act1-static-closure-is-webgl-free`** — the R3F bundle loads only at the inflection
   - **asserts —** a static import chain from the Act 1 entry to `three` / `@react-three/*` / the
     synced r3f dir reds with the chain named; the same target behind dynamic `import()` is green.
   - **covers —** `packages/cli/src/web-experience-check.ts:64` (`extractStaticImports`, the
     static/dynamic split), `:88` (`isWebGlSpecifier`), `:122` (`walkStaticClosure`)
4. **`erg-absent-experience-skips`** — the guard lands before the storm
   - **asserts —** a site tree with no experience entry yields SKIP (not red, not green-silent), so
     the gate can merge in increment B without holding the site hostage.
   - **covers —** `packages/cli/src/web-experience-check.ts:250` (`checkExperienceSite`, the
     bootstrap-SKIP branch at `:254`)

## Guidance — the slice that earns the signed verdict

The bootstrap rung (ADR-0057 §3, NET-NEW): author the pure judge, test-first.

- **The new test —** `packages/cli/src/web-experience-check.test.ts` (`node:test` +
  `node:assert/strict`, in-memory fixture maps — mirror `web-engine-sync.test.ts`'s discipline).
  Import the judge from `"./web-experience-check.js"`. Name each test for its contract id (`erg-…`).
- **The RED the spine observes —** module-not-found: `web-experience-check.ts` does not exist at
  HEAD.
- **The GREEN —** write the pure judge (`(files: Map<path, content>, config) → findings | skip`).
  The IO shell + the root `check:web-experience` script + the `pnpm gate` slot followed as
  orchestrator glue; after the leaf, the `@storytree/cli` suite + typecheck stay green. *(The script
  and the gate slot were retired by ADR-0311 D2 — see the ⚠ note above. The shell survives.)*

Rules:

- **Presence, not adequacy** — the judge greps markers and walks imports; a human witnesses the feel
  (story-UAT leg 5), and a web-repo behaviour spec witnesses that the exits actually resolve (story-UAT
  leg 4). Do not author appearance assertions here.
- **Static reachability only** — dynamic `import()` is the sanctioned inflection seam; counting it
  would outlaw the design.
- **SKIP is loud** — the bootstrap allowance prints why, so a silent no-op can never masquerade as
  green.
- **Pure judge / IO shell split** — no `node:fs` in the judge; the shell reads the real `web/` tree.
