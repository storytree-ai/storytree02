# The apps/studio boundary — a proposal, 2026-09-23

**What this is.** The first of the per-boundary proposals ADR-0542 D3 asks for, and the largest:
`apps/studio` is the main host of eleven of the fifteen stories on the grandfather register. It
decides all eleven **whole footprint** — including their rooms in `apps/desktop`, `packages/cli`,
`packages/library`, `packages/drive`, `packages/notice-board` and `packages/agent` — because
ADR-0192 D3 moves a story whole, and a half-moved story is a cycle the gate refuses. The
`packages/cli` (inc-03) and `packages/library` (inc-04) proposals do not re-decide any of them.

**What this is not.** Nothing moves here: no package is created, no story is edited, no register
entry changes, no code is written. What remains to decide goes to the owner as the open question
`oq-studio-boundary-fold-or-carve` on `system-shape-review-arc`. His answer will be recorded as an
ADR that narrows or supersedes ADR-0192 for this boundary, and the work it authorises will be parked
on the arc in that same landing.

**The owner's default, which this applies.** While this proposal was being written, the owner
settled `oq-migrate-when-touched-or-drive-it` (2026-09-23): the moves are DRIVEN through this arc,
and — wider than that question — *"regarding the circular/shared files this is a strong smell that
these should not be separate storynodes."* The settlement records it as a default for every
per-boundary proposal: merge stories that share files or form loops into one story node rather than
engineer seams to keep them apart. All eleven stories here fall under it (§2), so this proposal is
that default applied. The one reading it needs — whether two stories that own buildings of their own
merge whole or only by their tangled pieces (§4.2) — is what the open question asks.

It starts from the survey (`docs/research/system-shape-survey-2026-09-08.md`) and July's halted
migration attempts (`model-uat-promotion-inc-07`, `-08`, `-12`, `-13`, `-18`). It re-measures only
what they could not see: each footprint *today*, the direction of every import across the line, and
what a move would do to test runs. Every figure names how it was produced (end of document).

---

## The short version

1. **None of the eleven can move into a package of its own today, so none is a plain move that
   ADR-0192 D3 already authorises.** Five files each carry the proofs of two or three stories; most
   tenants import the studio's own internals while the studio imports them back; several are bound
   to their host's core files, which can never leave. July found this for the then-eighteen entries.
   It still holds, with two more shared files than July recorded (§2).

2. **A package of its own would not give a studio tenant a smaller test suite.** The gate runs the
   tests of the packages a branch changes *plus every package that depends on them*. The studio
   imports every one of these panels, so it would become each one's dependent and its whole suite
   would still run on every change to the panel. The studio's suite is 19% of the repo's test work;
   the tenants' tests are about a third of it. The owner's test-scoping motive is real, but this is
   not the boundary where packaging collects it (§3). The `packages/cli` proposal reached the same
   finding independently.

3. **The owner's 2026-09-23 default — merge stories that share files or form loops — gives a redraw
   (B) in two shapes, and the evidence supports it** (§4):
   - **Fold what is entangled.** Six stories whose code cannot be separated from the buildings it
     sits in become capabilities of the stories that own those buildings — studio-side pieces to
     `studio`, library-store pieces to `library`, desktop-backend pieces to `desktop`, and so on —
     and two landowners (`app-surface`, `desktop`) fold only their pieces in the studio. No code
     moves, capability verdicts carry over unchanged, and the few signed UAT legs that move are
     re-proven by a machine re-run.
   - **Merge what is self-contained.** `embedded-terminal`, `terminal-tabs` and
     `terminal-repo-picker` are six files that import nothing from either app — one context split
     into three stories by one shared file. Merged into one story, its move into a package of its
     own becomes a plain move that ADR-0192 D3 already authorises.

4. **The register loses all eleven entries** — ten in the landings that fold and merge (the gate
   itself forces each removal, because an entry with no hosting evidence is a violation), the
   eleventh when the terminal moves (§6).

5. **The price is visible on the map.** Eight stories stop being islands of their own (36 live
   stories become 28), and the studio story grows from about 20 live capabilities to roughly
   55–60 — the honest size of the studio app, but one island where there were several (§4.5).

6. **One reading goes to the owner.** `app-surface` and `desktop` each own a building of their own;
   only a few of their pieces sit in the studio and cause the tangles. The proposal merges just those
   pieces (§4.2); the literal reading of the default would merge the whole stories. That choice is
   the open question.

---

## 1. The eleven, as they stand today

"Where its code sits" joins the two records: each unit's declared build target (what the hosting
rule reads) and the source-ownership map (who is responsible for each file).

| story | what it is | live capabilities | where its code sits | UAT legs (signed) |
| --- | --- | ---: | --- | --- |
| `uat-detail-studio` | the one-line UAT rows in the studio's detail panel, and opening their detail | 2 | entirely inside `apps/studio/src/components/TreeView.tsx` | 0 |
| `library-tech-tree-overlay` | the Library browsing overlay on the map: drawer, finder, dependency canvas, overview, dive body, selection card | 16 | 16 files in `apps/studio`; bindings on 3 of `packages/library`'s own files | 1 (0) |
| `library-review` | review mode for Library documents: inline comments, suggested edits, accept/reject, live refresh | 9 | 10 files in `apps/studio` (server routes and components); 2 stores in `packages/library` | 5 (5) |
| `app-guide` | the in-app guide chat — its UI is currently dormant | 4 | the chat panel in `apps/studio`; a reset route in `apps/desktop`; a binding on `packages/drive`'s orchestrator | 1 (0) |
| `studio-cloud` | the hosted, members-only studio: serve mode, write broker, database wake, image hygiene | 7 + 1 contract | 6 studio server files; 4 files in `packages/cli`; 1 in `packages/library` | 5 (0) |
| `wisp-as-story-claim` | live work drawn as wisps around a story on the map | 7 | six buildings: `packages/notice-board`, `packages/drive`, `packages/agent`, `apps/studio`, `apps/desktop`, `packages/cli` | 5 (0) |
| `app-surface` | the shared product surface (owns `packages/app-surface`) — here, only its studio adapter | 3 of 7 | `TreeView.tsx`, `SemanticGrowthDemo.tsx`, a two-line `SceneView.tsx` shim | its 1 leg stays |
| `desktop` | the desktop app (owns `apps/desktop`) — here, only its screens in the studio and its checks in the CLI | 3 of 12 | credentials panel, auth and apply helpers, ten server-side route probes in `apps/studio`; five files in `packages/cli` | its 6 legs stay |
| `embedded-terminal` | the terminal docked in the desktop app | 2 | `TerminalDock.tsx` (studio); `pty-session-manager.ts` (desktop) | 5 (5) |
| `terminal-tabs` | several terminal sessions in that dock | 2 | `TerminalDock.tsx`, `terminalToolkit.ts` (studio) | 2 (2) |
| `terminal-repo-picker` | choosing which checkout the terminal opens in | 3 | `RepoPicker.tsx`, `TerminalRepoGate.tsx` (studio); `repo-selection.ts` (desktop) | 4 (0) |

---

## 2. Why none of them is a plain move

A plain move — the kind ADR-0192 D3 already authorises — takes a story's whole footprint into a
package of its own with no cycle and no shared file. Three things block every one of the eleven.

**Shared ("welded") files — one file carrying several stories' proofs.** Re-measured today over
every live story's build targets:

| file | proof-bound by |
| --- | --- |
| `apps/studio/src/components/TreeView.tsx` | `app-surface` (3 capabilities), `uat-detail-studio` (the story and both capabilities), and the `studio` story itself (5 capabilities) |
| `apps/studio/src/components/TerminalDock.tsx` (and its test file) | `embedded-terminal`, `terminal-tabs` |
| `apps/studio/src/components/ChatPanel.tsx` (and its test file) | `app-guide`, `studio` (its `chat-panel` capability) |
| `apps/studio/src/components/LibraryFocusGraph.tsx` | `library-tech-tree-overlay`, `studio` (`map-boot-independence`) — **not recorded in July** |
| `apps/studio/src/components/LibrarySelectionCard.tsx` | `library-tech-tree-overlay`, `studio` (`map-boot-independence`) — **not recorded in July** |

July recorded `TreeView.tsx` as two stories' file; it is three, counting the studio's own.

**Imports in both directions.** A package cannot import an app. So a tenant can leave only if its
files import nothing from the studio — otherwise the studio imports the tenant's package while the
package needs the studio, a cycle the gate refuses. Read file by file:

- `library-review`'s studio files import the studio's HTTP helpers, API client, types, polling, app
  data, Markdown renderer and library backend — and `guestPolicy.ts` imports `apiRouter.ts`, the
  studio's entire read API — while `apiRouter.ts`, `serve.ts`, `ReviewBlocks.tsx`, `AssetView.tsx`
  and `DocView.tsx` import them.
- `library-tech-tree-overlay`'s files import `kindDisplay.ts`, `types.ts`, `AssetView.tsx` and
  `DocView.tsx`; `TreeView.tsx` and `ArcSurface.tsx` import them.
- `app-surface`'s `SemanticGrowthDemo.tsx` imports `TreeView.tsx`, which imports it back.
- `studio-cloud`'s serve mode *is* the studio's server entry (`serve.ts`, six studio imports) and
  read API (`apiRouter.ts`, thirteen). The source-ownership map declares those files to
  `studio-cloud`, while the build-target record binds `apiRouter.ts` to the studio's own
  `map-server-memo` — the two records disagree about who owns the studio's API.
- `wisp-as-story-claim`'s files are each wired into their host: the claim store and claim modules
  into `notice-board`'s index; claim release, namespace, universe and the wisp smoke into `drive`'s
  index and build drivers; the in-flight activity into the studio's library backend and types; the
  claim activity into the desktop's backend entry.
- `desktop`'s studio files (credentials panel, auth and apply helpers) import nothing from the
  studio and are imported by `Hud.tsx`, `App.tsx` and `StoreBanner.tsx` — but `desktop` already
  depends on `studio` (the desktop app ships the studio's compiled renderer), so a desktop-owned
  package the studio imports is the cycle `model-uat-promotion-inc-08` proved.

**Bindings on the host's own core.** Some units bind files that are their landlord's own machinery,
which can never leave: `uat-detail-studio` and `app-surface` on `TreeView.tsx`;
`library-tech-tree-overlay` on the studio's router `route.ts` (nine studio files import it) and on
`packages/library`'s barrel, `render-doc.ts` and `lifecycle.ts`; `app-guide` on the studio's API
client `api.ts` (seventeen production importers) and on `packages/drive/src/orchestrate.ts`. These
record where a build *edited*, not what the story *owns*.

**The one exception.** The terminal family's six files — `TerminalDock.tsx`, `terminalToolkit.ts`,
`TerminalRepoGate.tsx` and `RepoPicker.tsx` in the studio, `pty-session-manager.ts` and
`repo-selection.ts` in the desktop — import **nothing** from either app and no `@storytree` package.
The studio side is imported only by `BottomDock.tsx`, the desktop side only by the Electron main.
The only thing stopping it is that three stories share `TerminalDock.tsx`, and
`terminal-repo-picker`'s gate imports it.

| story | plain move today? | why not |
| --- | --- | --- |
| `uat-detail-studio` | no | nothing to move — its whole footprint is lines inside `TreeView.tsx` |
| `library-tech-tree-overlay` | no | two shared files; imports studio internals; binds the studio's router and three library core files |
| `library-review` | no | imports studio internals in both directions, down to `apiRouter.ts` |
| `app-guide` | no | shares `ChatPanel.tsx`; binds `api.ts` and drive's orchestrator |
| `studio-cloud` | no | its serve mode is the studio's own server |
| `wisp-as-story-claim` | no | six buildings, every file wired into its host |
| `app-surface` (studio rooms) | no | shares `TreeView.tsx`; its demo imports `TreeView.tsx` |
| `desktop` (studio rooms) | no | cycle: desktop depends on studio (inc-08) |
| `embedded-terminal` | no | shares `TerminalDock.tsx` with terminal-tabs |
| `terminal-tabs` | no | shares `TerminalDock.tsx` with embedded-terminal |
| `terminal-repo-picker` | no | imports `TerminalDock.tsx`, which the other two share |

---

## 3. The test-suite question, measured

On 2026-09-23 the owner named the benefit a story with its own package should bring: *"we have
failed to apply the story level microservices which would of allowed locking a smaller testsuite to
the storynode."* This boundary is where that expectation meets the gate's mechanism, so it is
measured rather than assumed.

**The mechanism.** `pnpm gate` and CI narrow the test leg to the packages a branch changes **plus
their dependents** — `pnpm --filter ...<name>` (`packages/cli/src/ci-affected.ts`). Nothing depends
on `apps/studio` or on `apps/desktop`: neither lists the other, because the desktop ships the
studio's built output rather than taking it as a package dependency. So today:

- a change to a studio tenant's file runs **the studio's suite**, and only it;
- a change to a desktop file runs **the desktop's suite**, and only it.

Move a tenant into `packages/x`, and the studio — which must import it to show it — becomes `x`'s
dependent:

- a change to the tenant runs **x's suite plus the studio's whole suite**. The tenant's tests left
  the studio suite and came back in by another door, so the total barely changes;
- for the terminal family, which both apps would import, a change runs **terminal + studio +
  desktop** — more than today's one app;
- a change to the *rest* of the studio no longer runs the moved tenant's tests. That is the one real
  saving.

**The size of that saving.** The studio's suite was 19.0% of the repo's summed test work at the last
instrumented run (ADR-0394, re-measured 2026-08-21; `packages/cli` was 34.7%). Of its 167 test
files, 51 exercise a tenant's own studio file: `library-review` 19, `library-tech-tree-overlay` 16,
`wisp-as-story-claim` 4, `app-guide` 4, `studio-cloud` 3, the terminal family 3, `desktop` 1,
`app-surface` 1. Carving every tenant out would therefore lighten test runs for changes elsewhere in
the studio by at most about a third of its test files — tens of seconds of test work per run — and
give no tenant a suite of its own size.

**What follows.** At this boundary, packaging buys **boundary honesty** — a package's dependencies
are checked by the compiler and the blocking gate rather than advisorily — but not the test scoping
the owner named. That benefit is concentrated where the test work is, in `packages/cli`. The
`packages/cli` proposal (inc-03) found the same mechanism independently and puts a route that does
not depend on packaging at all — selecting tests *inside* a package from the source-ownership map —
to the owner as its own question, `oq-story-sized-test-suites-without-moving-code`.

And honesty can be had here without packaging. A folded unit belongs to the story that owns its
building, and that story's dependencies *are* blocking-checked. The three tenants the advisory
report flags today (`app-guide`, `studio-cloud`, `uat-detail-studio`) stop being flagged, because
the flags are artefacts of binding a host's file: `uat-detail-studio` "imports" `app-surface`,
`forest-world` and `notice-board` only because `TreeView.tsx` does.

---

## 4. The proposal

The owner's default says stories that share files or form loops are one story. Applying it here
needs one more rule, because a merged story still may not keep rooms in a third story's building
(the gate refuses that): **a unit belongs to the story that owns the building its code sits in —
unless it is part of a context that should own a building of its own.** Applied to the eleven, that
gives three kinds of redraw (B), and none is a migration onto the existing line (A). *Fold*, below,
names the commonest shape: merging a tenant into its landlord's story.

### 4.1 Fold — the studio's own panels (five stories, retired into their landlords)

**`uat-detail-studio` → `studio`.**
- Moves: `uat-row-one-liner` and `uat-row-opens-detail` into `studio`; the story retires, and its
  story-level build target on `TreeView.tsx` with it.
- Evidence: its entire footprint is lines inside the studio's central component. It has no file, no
  ownership entry and no UAT leg of its own, and its advisory flags are `TreeView.tsx`'s imports.
- Cost: two capability specs re-homed. The smallest fold.
- Register: its entry is removed in that landing.

**`library-tech-tree-overlay` → `studio` (14 capabilities) and `library` (2).**
- Moves: the fourteen studio-side capabilities — the category and lifecycle shelves, dependency
  canvas, dive body, drawer shell, finder, open overlay and trigger, overview, permanent lens,
  process flow, retiring the standalone page, selection card and top drawer — into `studio`;
  `library-lifecycle-wire` and `library-typed-edges`, which bind `packages/library`'s own
  `render-doc.ts`, `lifecycle.ts` and barrel, into `library`. The story retires; its one machine UAT
  leg moves to `studio`.
- Evidence: the overlay is how the studio shows the Library. `TreeView.tsx` and `ArcSurface.tsx`
  mount it, it is built from the studio's `kindDisplay.ts`, `types.ts`, `AssetView.tsx` and
  `DocView.tsx`, and it shares two files with the studio's own `map-boot-independence`. Its two
  library-side capabilities are edits to the library's core, which is where they then belong.
  ADR-0192 D3 held this story back until `library-tech-tree-overlay-arc` closed; that arc is closed
  (last landing 2026-07-16), so the hold has lapsed.
- Cost: sixteen capability specs re-homed and one unsigned UAT leg moved. Its ownership entries name
  capabilities rather than the story, so they follow their capabilities without edits.
- Register: entry removed.

**`library-review` → `studio` (7) and `library` (2).**
- Moves: the review UI and routes — accept/reject, the collapsed suggestion view, the inline comment
  thread, the member write policy, the review toggle, the refresh feed and
  `remove-text-selection-anchoring` — into `studio`; `block-position-comment-anchor` and
  `suggestion-edit-store`, which bind `packages/library`'s comment and suggestion stores, into
  `library`. The story retires; its five machine UAT legs, all signed, move to `studio`.
- Evidence: review mode is a mode of the studio's Library document view. `apiRouter.ts` mounts its
  routes, `serve.ts` wires its policy, `ReviewBlocks.tsx`, `AssetView.tsx` and `DocView.tsx` mount its
  components, and it imports the studio's API client and HTTP helpers in turn. Its two stores sit
  beside the library's other Postgres stores and are exported through the library's store barrel.
- Cost: nine capability specs re-homed and five signed UAT legs moved. Each leg names its story's
  own proof gate and detail entry in its text (`library-review#gate-1`, `library-review#uat-2`), so
  re-pointing them changes the leg's content hash and the five are re-proven by a machine re-run
  (`storytree uat run`) rather than carried. The story's three story-grain ownership entries
  (`ReviewEditor.tsx`, `blocks.ts`, `criticmarkup.ts`) are re-pointed when it retires.
- Register: entry removed.

**`app-guide` → `studio` (3) and `desktop` (1).**
- Moves: `auto-grow-input`, `multi-turn-transcript` and `transcript-reset` — the chat panel — into
  `studio`, beside the studio's own `chat-panel`, which already binds the same file;
  `backend-chat-reset-route` into `desktop`, whose building holds its route. That capability's second
  binding — a literal build target on `packages/drive/src/orchestrate.ts`, where the reset clears
  drive's composition guard — must be re-adjudicated in the same landing: dropped as an edit-scope
  record, or re-expressed as a drive contract. Left as it is, it would make `desktop` a tenant of
  `drive`.
- Evidence: the chat UI shares its file with the studio's own capability and is dormant — no
  production code imports `ChatDock` or `ChatPanel`, and `TreeView.tsx` notes the dock is waiting for a
  future app-guide. The reset route, recorded in July as absent because unbuilt (inc-18), is now
  built and mounted by the desktop's backend entry. The one advisory flag (an undeclared `library`
  import) is drive's orchestrator's import, attributed to `app-guide` only through that binding.
- Cost: four capability specs, one binding re-adjudicated, one machine UAT leg moved.
- Register: entry removed.

**`studio-cloud` → `studio` (7, or 6 if one CLI check must stay with `cli`), `library` (1 contract).**
- Moves: serve mode, the write broker, hosted database wake, guest scope and the IAP front door into
  `studio` — they are the studio running as a hosted service. The `cloud-sql-admin-rest` contract,
  which binds `packages/library`'s Cloud SQL Admin client (the same client the database-wake path
  uses outside the studio), is re-parented under a `library` capability. `container-image` and
  `deploy-health-signal`, whose files are in `packages/cli`, go with studio-cloud's other pieces to
  `studio` — they guard the studio's container image and deploy — and where a story's code in the
  CLI lives is the CLI proposal's class answer (`oq-cli-front-door-or-move-each-storys-code-out`).
  One corner binds: `deploy-health-signal`'s build target is a CLI file, so if that answer still
  counts the CLI as a foreign building, this capability folds into `cli` instead, because the studio
  is not on the register and the gate would refuse it as a new tenant. The story retires; its five
  machine UAT legs, none yet bound to a proof gate, move to `studio`.
- Evidence: serve mode is the studio's own server; folding ends the two records' disagreement over
  `apiRouter.ts`. Of the CLI files, `gcloudignore-mirror` is a live gate rung and CI merge wall that
  keeps credentials out of the studio's container image (ADR-0544 D5, ADR-0547 D1); `deploy-health`
  is a check retired from the gate by ADR-0311 D2 and deliberately kept (D5).
- Cost: seven capability specs and one contract. `coverage-gate.test.ts` pins
  `deploy-health-signal`'s binding by name, so re-homing it is safe, but retiring or moving that file
  must update the test in the same landing.
- Register: entry removed.

### 4.2 Fold the adapter — two landowners' rooms in the studio (both stories stay) — the owner's call

This is the one place the proposal reads the owner's default narrowly, so it is the open question.
Taken literally, "these should not be separate storynodes" would merge `app-surface` and `desktop`
into `studio` whole — the studio story would then own three buildings (one story owning several
packages has precedent, ADR-0537). The proposal merges only their pieces in the studio, because
those pieces cause every tangle and both stories are otherwise genuinely separate: the product
surface has a second consumer (the public site, ADR-0237), and the desktop is its own runtime
(ADR-0176). A separate story can still be merged later; a merged one would have to be split by
drawing these lines again.

**`app-surface`** keeps `packages/app-surface` and its four package-side capabilities.
`studio-app-surface-adapter`, `semantic-growth-studio-demo` and `organic-growth-app-witness` move to
`studio`.
- Evidence: ADR-0237 D2 designs this seam as two controllers adapting into one shared surface, and
  names the *studio controller* the studio's. These three capabilities are that controller: they bind
  `TreeView.tsx`, and a demo that imports `TreeView.tsx` back. The studio's own `SceneView.tsx` is a
  two-line compatibility re-export that nothing imports any more; its comment says it existed while
  the adapter switched `TreeView` over.
- Cost: three capability specs. Its one UAT leg stays.
- Register: entry removed. Its register note already calls this room "the directed first-consumer
  seam".

**`desktop`** keeps `apps/desktop` and its desktop-side capabilities. Its screens in the studio move
to `studio`; its checks in the CLI follow the CLI's class answer.
- Moves: the renderer half of `credential-broker` — `CredentialsPanel.tsx`, which is the capability's
  build target, plus `DesktopCredentialsDock.tsx` and `desktopAuth.ts` — becomes a `studio`
  capability, while the broker itself (keychain and OAuth, in `apps/desktop`) stays with `desktop`.
  `desktopApply.ts`'s ownership moves with it. The ten studio-side route probes (`*MirrorProbe.ts`,
  which import `apiRouter.ts`) go to `studio`. The five CLI files — the route tables, the desktop
  route-coverage check and the mirror-conformance harness, which the CLI's own checks import — stay
  `desktop`'s, whose routes they check, and live wherever the CLI's class answer
  (`oq-cli-front-door-or-move-each-storys-code-out`) puts a story's CLI code. They are not build
  targets, so the register is unaffected either way.
- Evidence: the desktop has no renderer of its own; it ships the studio's compiled one. So any
  desktop-only screen must live in the studio's building, and a desktop-owned package the studio
  imports is the cycle inc-08 proved. The line that holds is the renderer line.
- Cost: one capability split (story-author work) and a handful of ownership entries re-pointed. Its
  six UAT legs stay.
- Register: entry removed. Only `credential-broker`'s build target makes `desktop` a register tenant
  today.

### 4.3 Dissolve by building — a feature cut across six buildings

**`wisp-as-story-claim` → `notice-board`, `drive-machinery`, `agent` and `studio`.**
- Moves: `claim-store-work-time` and `claim-at-declare` into `notice-board`, which owns the claim
  ledger; `colour-by-subagent` and `ci-clear-on-merge` into `drive-machinery`;
  `take-claim-at-spawn` into `agent`; `render-claim-as-wisp` and `appearance-uat` into `studio`.
  Ownership entries for its scattered files follow their buildings: the claim modules in
  `packages/drive` (`claim-namespace.ts`, `claim-universe.ts`, `claim-release.ts`, `wisp-smoke.ts`)
  to `drive-machinery`, and the claim activity in the desktop to `desktop`. `check-declared.ts` in the
  CLI goes with `claim-at-declare` to `notice-board`, whose claims it checks; where notice-board's
  CLI code lives is the CLI proposal's class answer. It is not a build target, so the register is
  unaffected. The story retires; its five machine UAT legs, not yet bound to a proof gate, move with
  the capabilities they describe, mostly to `studio`.
- Downstream: `system-shape-review-arc-inc-05` (the `packages/drive` boundary, parked by the CLI
  proposal) starts from this row, because the notice board's claim-ledger code in `packages/drive`
  sits beside `claim-namespace.ts` and `claim-universe.ts`. If inc-05 re-homes the claim ledger as a
  cluster, these two go with it; this row gives it its starting point rather than pre-empting it.
- Evidence: every file is wired into its host's own index or drivers. The claim ledger *is* the notice
  board's function, and the wisp is how the studio draws it. This is the second orphan island
  ADR-0192's July audit found — organs in four other stories' territories — and it is a feature that
  cuts across the system, not a context that could own a package.
- Cost: seven capability specs to four stories, and ownership entries in six buildings. The widest
  fold.
- ⚠ Two things for whoever executes it. `take-claim-at-spawn`'s `spawn-claim.ts` has no production
  importer, and its only other reference is a desktop test named `spawn-surface-retired`: re-read it
  before re-homing it, because it may be one to retire instead (and per inc-18, confirm rather than
  infer). And `notice-board` is itself a register tenant of `packages/cli` and `packages/drive`
  (inc-03's and inc-05's to decide): `claim-at-declare`'s files in `packages/drive` must be
  re-pointed to `drive-machinery` rather than handed to `notice-board`, or this fold would widen that
  tenancy before inc-05 has decided it.
- Register: entry removed.

### 4.4 Merge, then move — the terminal family

**`embedded-terminal` ⟵ `terminal-tabs` + `terminal-repo-picker`.** One story: seven capabilities,
eleven UAT legs (seven signed).
- The merge (B — the owner's 2026-09-23 default applied, since they share `TerminalDock.tsx`):
  `multi-session-tabs`, `seed-opens-new-tab`, `repo-picker-panel`,
  `repo-selection` and `terminal-repo-gate` re-homed into `embedded-terminal`, which keeps its id —
  so the register gains no name — and the other two retire. The `TerminalDock.tsx` weld dissolves,
  because one story binds it, and `terminal-tabs`' stale dependency on the retired
  `map-terminal-build` goes with it.
- The move (A, authorised by ADR-0192 D3 once merged): after the merge the family is a plain
  whole-footprint move — no shared file, no cycle — into a package of its own (for example
  `packages/terminal`), imported by the studio's `BottomDock.tsx` and by the desktop's Electron main.
  The owner chose to drive moves (`oq-migrate-when-touched-or-drive-it`, 2026-09-23), so it is
  parked and worked after the merge rather than left for a session that happens to touch it.
- Evidence: the six files import nothing from either app. The bridge they talk over is declared
  twice today — once in the desktop's `preload.ts`, whose comment says it cannot share the
  renderer's copy "because the desktop must not import across the surface boundary", and once in
  `TerminalDock.tsx`; the repo picker's bridge is the same. A package both sides import would
  single-source it. ADR-0542 D1's model — a story is a bounded context that owns a package — fits
  this family better than a fold would, since a fold splits one context across two stories.
- Cost of the merge: five capability specs and six UAT legs moved — `terminal-tabs`' two signed legs
  are re-proven by a machine re-run, since their text names that story's gates (§4.5), and
  `embedded-terminal`'s own five signed legs do not move at all. Cost of the later move: six source
  files and their tests. The `@xterm` dependencies move with the pty manager (node-pty stays external
  to the Electron bundle); the renderer tests need their jsdom setup in the new package; the Electron
  main is an esbuild CommonJS bundle with a known `import.meta` constraint that the pty manager
  already works around; seven build targets are re-pointed and re-proven.
- Test runs, honestly: after the move a terminal change runs terminal + studio + desktop suites
  instead of one app's (§3). This is proposed for coherence, not test speed.
- Register: `terminal-tabs` and `terminal-repo-picker` removed at the merge; `embedded-terminal`
  removed at the move.

### 4.5 What the whole proposal costs, in one place

- **No code moves** for any fold or for the merge. Signed capability verdicts key on the unit's id,
  which does not change, so they carry over. UAT legs keep their opaque ids (ADR-0253), and their
  content hash ignores the list number — but each leg names its story's proof gate and detail entry
  in its own text, so re-pointing those at the receiving story changes the hash. The seven signed legs
  among those moved (`library-review` 5, `terminal-tabs` 2) are therefore re-proven by a machine
  re-run, not carried. All seven are machine-witnessed, so no owner signature is lost.
- **Story-author work, landable one story at a time in any order.** About 50 capability specs and one
  contract re-homed into six or seven stories (seven if one CLI check must fold into `cli`), plus five more for
  the terminal merge; 23 UAT legs moved; one
  capability split; two build-target bindings re-adjudicated; scattered ownership entries re-pointed.
  Each landing removes exactly one register entry, and the gate forces it.
- **Eight stories retire** (`uat-detail-studio`, `library-tech-tree-overlay`, `library-review`,
  `app-guide`, `studio-cloud`, `wisp-as-story-claim`, `terminal-tabs`, `terminal-repo-picker`). 36
  live stories become 28, and eight islands leave the map.
- **The studio story grows** from about 20 live capabilities to roughly 55–60, by far the largest.
  That is the honest size of the studio app — one package, one test suite. Claims are taken per
  capability, so size adds no contention.

---

## 5. The alternatives

**Still open — merge `app-surface` and `desktop` whole** (option 2 of the open question). The
literal reading of the owner's default. The studio story would own three buildings and about 70
capabilities, and the desktop's own journeys (launch, keychain, local backend) would become the
studio's. It fixes nothing option 1 leaves unfixed; its merit is that it takes the owner's words at
face value.

**Ruled out by the owner's default** — kept here so a later reader can see they were weighed.

**B, but fold all eleven — the terminal included.** The terminal's capabilities are already
one-sided — two in the desktop (`pty-session-manager`, `repo-selection`), five in the studio — so
folding them is clean: three stories retire, three entries drain, nothing moves, no test run grows.
It is the cheapest answer. It gives up the one context at this boundary that could honestly own a
package, splits that context across two stories, and leaves the twice-declared bridge as it is. The
default's "one bounded context, one package" points the other way: the three terminal stories merge
into one.

**A — finish the migration.** Each tenant keeps its story and gets a package of its own, after the
studio pieces it leans on are carved out so nothing points back at the app. ADR-0192 D3 permits
exactly that factoring ("into a shared package or props"). It is the only answer that keeps every
island. It is also by far the most expensive: the pieces the panels lean on are the studio's API
client (seventeen production importers), types, HTTP helpers, Markdown renderer, document views and,
in one case, `apiRouter.ts` itself; the shared files must be unbound from the studio's own
capabilities; and the survey records one comparable extraction growing to 26 files and
+2,623/−1,399 lines once an import ban surfaced mid-build. Per §3 it buys boundary honesty, which
folding also buys, but not smaller test runs for the panels. It is also the seam-engineering the
owner's default ruled out. If a story is ever wanted as its own island regardless, the library
panels are where it is most arguable — 25 capabilities and 35 of the studio's test files — and it
would need pricing as its own proposal first.

**Leave all eleven as they are.** That was the RETIRE answer to
`oq-migrate-when-touched-or-drive-it`; the owner chose DRIVE.

---

## 6. The register and ADR-0192

- ADR-0542 names the risk a re-cut carries: the register's remaining entries become moves toward a
  shape being abandoned. For this boundary the answer is that **all eleven entries leave**, and the
  gate enforces it — an entry whose story has no hosting evidence left is a stale violation, so each
  fold's landing must remove its entry (`packages/cli/src/check-boundaries.ts`; the register's own
  comment in `repo-manifest/hosted-stories/_domain.json`).
- What remains on the register afterwards: `binding-staleness`, `drive-machinery`, `notice-board` and
  `website-experience` (inc-03's and inc-04's), plus `embedded-terminal` until its move.
- The ADR that records the owner's answer narrows ADR-0192 for `apps/studio`: D3's whole-footprint
  migration is satisfied here by redraw rather than by moves, and the register loses these entries
  as each redraw lands. ADR-0192's landlord rule (D1) and its refusal of new tenants (D2) are
  untouched. That ADR owes ADR-0192 an in-place annotation in the same landing.

---

## 7. What this does not decide

- **Whether decided moves get driven** — already settled: `oq-migrate-when-touched-or-drive-it` was
  answered DRIVE on 2026-09-23, with this arc as the vehicle. So once this boundary's answer is
  recorded, its folds, the merge and the terminal's later move are parked here and worked. (That
  answer is not yet written up as an ADR; the ADR recording this boundary should cite it.)
- **Selecting tests inside a package** — the route to smaller suites that does not depend on
  packaging: `oq-story-sized-test-suites-without-moving-code` (inc-03).
- **Where the CLI's line falls** — `oq-cli-front-door-or-move-each-storys-code-out` (inc-03). This
  proposal's CLI rows (desktop's route and mirror checks, studio-cloud's image and deploy checks,
  the wisp story's declare check) follow its class answer rather than deciding it (§4.1–4.3). One
  consequence runs the other way: if the owner takes the CLI's shared-front-door answer and wants
  the same rule for the studio, the two landowners' studio rooms (`app-surface`'s adapter,
  `desktop`'s screens) could stay theirs instead of folding, since a front door presumes a home
  elsewhere and both of them have one. The eight package-less tenants have no other home, so the
  front-door reading does not reach them.
- **The duplicated contracts between the studio and the desktop.** The desktop re-implements the
  studio's read API, and 6,253 lines exist only to prove the two still match (survey §4.5). The four
  Electron bridges — auth, apply, terminal, repo — are each declared separately on both sides, with
  nothing checking at compile time that they agree. ADR-0176 itself names "a shared read-route
  organism" as a possible consolidation it did not take, and a shared contract package would retire
  both. It moves no register entry, so it is not decided here; it is a candidate for its own proposal
  on this line.

---

## 8. Found on the way

- Two shared files July did not record: `LibraryFocusGraph.tsx` and `LibrarySelectionCard.tsx`
  (§2). `TreeView.tsx` carries three stories' proofs, not two.
- `app-guide`'s `chat-reset-route.ts`, absent-by-design in July (inc-18), is now built and mounted.
- The terminal's gate, repo picker and dock are mounted by `BottomDock.tsx`, not by `TreeView.tsx` as
  the July increments recorded.
- `terminal-tabs` still declares a dependency on `map-terminal-build`, which retired on 2026-08-21.
- `apps/studio/src/components/SceneView.tsx` is a compatibility re-export with no remaining importer.
- The build-target record and the source-ownership map disagree about
  `apps/studio/server/apiRouter.ts` (`studio`'s `map-server-memo` against `studio-cloud`'s
  `serve-mode`).
- `take-claim-at-spawn`'s `spawn-claim.ts` has no production importer.
- UAT inventories have moved since July (for example `terminal-tabs` now has 2 legs, not 8, and
  `app-guide` 1, not 5). §1 gives today's.

---

## How this was measured

| what | how |
| --- | --- |
| each story's build targets, shared files and buildings | `loadNodeSpec` over every live `stories/*/*.md` — the same reader as `check-boundaries.ts`'s `readUnitSourceFiles` — mapped to buildings through `repo-manifest/package-ownership`; plus `repo-manifest/source-ownership/*.json` |
| imports across the line | a scan of relative and `@storytree/*` imports (type imports included) over `apps/studio`, `apps/desktop` and `packages/{cli,library,drive,agent,notice-board}` |
| advisory flags | `pnpm check:boundaries` |
| UAT legs and signed state | `storytree witness <story> list --pg` |
| how the gate narrows | `packages/cli/src/ci-affected.ts` (`--filter ...<name>`); the `@storytree/*` dependencies in `apps/*/package.json` |
| test-work shares | ADR-0394's instrumented run, re-measured 2026-08-21 (the current table is in ADR-0399) |
| the tenants' share of the studio's test files | the same import scan over `apps/studio`'s 167 test files, excluding the shared core files every test touches |
| arc lifecycles | `storytree arc list --all --pg` |
| live story count | `stories/*/story.md`, 47 directories, 11 with `status: retired` |

The scans were one-off, read-only scripts and are not committed; the table above is enough to
reproduce them. As with the survey, a figure that disagrees with a re-run is stale here, not in the
repository.
