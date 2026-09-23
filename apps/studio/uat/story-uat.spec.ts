// The scripted shadow of the studio Story UAT (stories/studio/story.md § "UAT Test Criteria") —
// one coherent operator journey against the REAL running studio (real dev server, real browser,
// real /api/* middleware, real seeded corpus). The only stub is the cross-story live-store seam:
// the server is pinned to the offline json backend (playwright.config.ts,
// STORYTREE_STUDIO_STORE=json) — ADR-0010 §5's mock-UAT allowance; in-story collaborators stay
// real. No Cloud SQL, no network, no API keys.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// RE-POINTED AT THE APP'S OWN AFFORDANCES (2026-08-23). This file had drifted behind six accepted
// decisions and asserted retired chrome — `.brand-name` (a HUD brand chip ADR-0205 deleted) and
// `getByLabel('operator identity')` (an editable identity input ADR-0204 D4 deleted). It failed on
// the FIRST assertion of the first test, so the story's ONE reliability gate
// (`pnpm --filter studio uat`, studio#gate-1) was red and all thirteen machine legs stayed
// unsigned. What moved under it:
//   • ADR-0204      — the standalone Overview/Home page is retired; `/` lands on the FOREST map.
//   • ADR-0204 D4   — attribution is server-stamped; there is no editable operator input.
//   • ADR-0205      — the HUD brand chip is gone; the account avatar is the only floating control.
//   • ADR-0185 dec6 — the standalone `#/library` page is retired; the Library is a LENS in the
//                     forest's top drawer (`?overlay=library`), reached via its handle.
//   • ADR-0187 dec2 — an artifact opens in a full-detail OVERLAY over the map, not a route away.
//   • ADR-0267 D1 / ADR-0314 D6 — that drawer now has TWO lenses (Arcs | Library), arcs default.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// REWRITTEN ONTO THE STUDIO WE HAVE (2026-08-23, ADR-0425). Re-pointing the selectors did NOT make
// the gate green, because eight of the thirteen criteria described surfaces the product no longer
// has. Those eight were left deliberately FAILING rather than skipped — a skip makes the command
// pass and would sign all thirteen legs including eight nothing exercised. The owner has now
// settled both gaps, and the criteria themselves are rewritten (never cut — ADR-0294 D1 names this
// walkthrough the corpus's reference shape and ADR-0425 dec 3 fences it):
//
//   • Criteria 2, 3, 9 read a decision record as a FILE on disk. ADR-0403 dec 1 made decisions
//     ROWS in the store and deleted `docs/decisions/`. ADR-0425 dec 4 takes them onto decisions as
//     they now are — `adr` artifacts surfaced through the Library — so the journey keeps its shape
//     (find a decision, open it, hop a citation) and only the SUBJECT's home changes. The offline
//     fixture corpus gained two `adr` rows for the sandbox to have a decision at all
//     (`packages/library/src/fixture/corpus.ts`; ADR-0425 dec 4 names that growth as the accepted
//     cost), and `deep-modules`'s own source moved from the dead `doc:decisions/0002-….md` path to
//     `asset:adr-0002` — which is what stops the app rendering its own citation as "(unknown doc)".
//   • Criteria 4, 5, 6, 12, 13 posted, recovered, resolved and deleted a COMMENT. ADR-0425 dec 1
//     retires studio commenting deliberately, with MULTIPLAYER as the named revival trigger: the
//     owner never adopted it and grounds his conversations against the Library from Claude Code or
//     Codex. They are re-pointed at the journey he actually performs — open the Library, find the
//     artifact that grounds a question, follow its source into the decision behind it, read it,
//     come back — at equal weight (dec 3). The studio-side half-promise went with it: ReviewEditor
//     no longer polls `api.reviewFeed` or renders a read-only peer-comment list, so no surface
//     offers a comment control that stores nothing. The server-side comment store, its routes, and
//     the proven InlineCommentThread/ReviewBlocks pair are KEPT (dec 5) as the revival's
//     foundation — which is exactly why criterion 13 asserting `comments.json` byte-identical is
//     now load-bearing: it is the standing proof that nothing in the studio writes to that store.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// MOVED WITH THE FEATURE (2026-09-24, ADR-0605). The citation tier is gone end to end: `3ea9c3cc`
// retired the artifact page's "Sources" block and `fa4f96a5` then deleted the `references` field
// itself — schema, readers and the fixture pointers ADR-0425 dec 4 had added for these legs — so
// there is no in-product link from one artifact to another left to follow (ADR-0477 D1:
// `depends_on` is the library's only edge, and the fixture rows carry none by design). Six legs
// walked that link (3, 4, 5, 6, 9, 12). Under ADR-0605 a leg broken by a deliberate removal moves
// with the feature, like a unit test attached to removed code, and nothing is built just to keep a
// leg alive. So each is RE-POINTED at the navigation the studio still offers — the Library
// finder's Decisions scope, the full-detail overlay and its Close control, the artifact page's
// `library` crumb, and route history — and none is retired: the walkthrough keeps its thirteen
// steps and its shape (ground a question, read the decision behind it, come back).
//
// The mutating tests write through the real handlers into the offline stores (git-tracked
// apps/studio/data/comments.json; the gitignored, first-run-seeded
// apps/studio/data/assets.runtime.json — ADR-0210) and MUST leave them at their seeded baseline: a
// beforeAll/afterAll snapshot-restore guard puts the baseline back if a test dies midway.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuidanceAsset } from '../src/types';

// The two decision rows the offline fixture carries (ADR-0425 dec 4). Criterion 3 walks between
// them through the Library finder; `adr-0002` is the decision behind `deep-modules`, the artifact
// that grounds the question in criteria 4-6, 9 and 12. Nothing LINKS the two any more (ADR-0605 —
// see the header): the operator reaches the decision through the Library, as he does today.
const ADR_0002 = 'adr-0002';
const ADR_0013 = 'adr-0013';
const ADR_0002_TITLE = 'The work hierarchy — story, capability, contract';
const ADR_0013_TITLE = 'A structured, schema-validated corpus; markdown as a generated view';
/** The artifact that grounds the question in criteria 4-6 — a principle that rests on ADR-0002. */
const GROUNDING_ID = 'deep-modules';
const GROUNDING_TITLE = 'Deep modules';

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMENTS_FILE = path.join(studioDir, 'data', 'comments.json');
// ADR-0210: the offline backend serves a gitignored runtime store, seeded from the library fixture
// on first read — not the retired committed assets.json.
const ASSETS_FILE = path.join(studioDir, 'data', 'assets.runtime.json');

// The forest is a real Pixi world over a real /api/tree fetch; give the first paint room on a cold
// vite process without making a slow box look like a failure.
const WORLD_MS = 60_000;

/** Land on the forest and wait for the map route and its persistent drawer (criterion 1's surface). */
async function landOnForest(page: Page, at = '/'): Promise<void> {
  await page.goto(at);
  await expect(page.locator('[data-testid="tree-route"]')).toBeAttached({ timeout: WORLD_MS });
  await expect(page.locator('[data-testid="library-drawer"]')).toBeAttached({ timeout: WORLD_MS });
}

/**
 * Open the Library LENS the way an operator does: expand the forest's persistent top drawer from
 * its handle, then pick the Library lens (the drawer opens on Arcs, its primary slot since
 * ADR-0267 D1). Deliberately NOT a `?overlay=library` deep link — criterion 2 says "expand the
 * persistent Library drawer", so the handle is the affordance under test.
 */
async function openLibraryLens(page: Page): Promise<void> {
  const expand = page.locator('[data-testid="library-drawer-toggle"]');
  await expect(expand).toHaveAttribute('aria-label', 'expand library', { timeout: WORLD_MS });
  await expand.click();
  await page.locator('[data-testid="library-drawer-lens:library"]').click();
  await expect(page.locator('[data-testid="library-finder"]')).toBeVisible();
}

/** The lifecycle state the offline fixture's artifacts project onto (ADR-0196 D1 / ADR-0197 D2). */
async function selectLifecycle(page: Page, state: 'open' | 'active' | 'archived'): Promise<void> {
  await page.locator(`[data-testid="library-lifecycle-selector-${state}"]`).click();
  await expect(page.locator(`[data-testid="library-lifecycle-selector-${state}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/**
 * Narrow the open Library lens to one artifact and raise it in the full-detail overlay — shelf row
 * → finder query → result row → the SELECTION CARD's Open control. Clicking a finder row only
 * SELECTS; the card's Open button is what raises the separate overlay (ADR-0187 dec 2).
 */
async function openInOverlay(page: Page, shelfTestId: string, query: string, id: string): Promise<void> {
  await page.locator(`[data-testid="${shelfTestId}"]`).click();
  await page.locator('.library-finder-input').fill(query);
  await page.locator(`[data-testid="library-finder-row-${id}"]`).click();
  await page.locator('[data-testid="library-selection-card"]').getByLabel('Open').click();
  await expect(page.locator('[data-testid="library-open-overlay"]')).toBeVisible();
}

/** The full-detail overlay the selection card's Open control raises over the map. */
const openOverlay = (page: Page): Locator => page.locator('[data-testid="library-open-overlay"]');

/**
 * Assert `scope` renders `adr-0002`'s own SUBSTANCE — its `## Status` and `## Decision` sections —
 * not a title over an empty shell. Every leg that "reads the decision" asserts through here.
 */
async function expectDecisionSubstance(scope: Scope): Promise<void> {
  const body = scope.locator('.asset-body');
  await expect(body.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
  await expect(body.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
}

/** Assert `scope` renders `deep-modules`'s title AND its derived body — the grounding itself. */
async function expectGrounding(scope: Scope): Promise<void> {
  await expectDetail(scope, GROUNDING_TITLE);
  await expect(scope.locator('.asset-body')).toContainText('deletion test');
}

/** Assert `scope` is showing the named artifact's detail (its own title heading renders first). */
async function expectDetail(scope: Scope, title: string): Promise<void> {
  await expect(scope.locator('article.asset-detail h1').first()).toHaveText(title);
}

/** Whole page or one container (the overlay, the route) — the mounts AssetView renders under. */
type Scope = { locator(selector: string): Locator };

/**
 * The NON-MAP route container — where an artifact opened as its own route renders.
 *
 * Scoping here is load-bearing, not tidiness. The forest map is RETAINED across SPA routes
 * (ADR-0240 stage 1, `map-route-retention`): leaving `#/tree` parks the map — `data-parked`,
 * `aria-hidden`, `inert` — but does NOT unmount it, so a Library overlay raised earlier keeps its
 * `article.asset-detail` in the DOM. A page-wide `article.asset-detail h1` therefore matches the
 * PARKED overlay as readily as the live route, and `.first()` picks whichever comes first in
 * document order — the map. That is how criterion 9 first failed here (it read "Deep modules" from
 * the overlay it had just navigated out of), and worse, it is how a leg could PASS while asserting
 * against stale content it never navigated to. Scoping to the route makes the assertion say what it
 * means: this artifact is open as its own route, now.
 */
const libraryRoute = (page: Page): Locator => page.locator('[data-testid="library-route"]');

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

// =============================================================================================
// Criteria 1, 7, 8 — boot on the forest, browse the knowledge-derived Library, narrow it.
// =============================================================================================

test('story UAT (criteria 1, 7, 8): boot on the forest → browse the knowledge-derived Library lens → narrow it deterministically', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);

  // —— Criterion 1: the persistence backbone is live and the app lands on the FOREST map.
  // The /api/* middleware answers (the world draws from /api/tree) and the offline-store status is
  // visible. The retired Overview page and pre-fold sidebar are asserted ABSENT rather than merely
  // unused — that absence is what the criterion claims ("no retired Overview page or pre-fold
  // sidebar is required"), and ADR-0205's brand chip is gone with them.
  await landOnForest(page);
  await expect(page.locator('.store-badge')).toHaveText('offline store (json)');
  await expect(page.locator('[data-testid="hud-avatar"]')).toBeVisible();
  await expect(page.locator('.brand-name, .hud-brand')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  // The persistent Library drawer is the corpus entry point on the landing surface (ADR-0191) —
  // collapsed it is the top handle, so assert the handle's control rather than the panel's box.
  await expect(page.locator('[data-testid="library-drawer-toggle"]')).toBeVisible();

  // —— Criterion 7: the Library lens renders the knowledge-derived corpus, one row per non-empty
  // category with live counts. The expected counts are READ FROM THE DERIVATION SEAM as actually
  // served (`/api/assets` — the offline backend seeds it from
  // `deriveOfflineAssets(loadFixtureSeedUnits())`, ADR-0210) and never pinned: the fixture is a
  // small offline sandbox that drifts from the live Library by design (ADR-0302 D1), so this
  // proves the derivation is WIRED, not that the offline Library mirrors the corpus.
  await openLibraryLens(page);

  const served = (await (await fetch(`${baseURL}/api/assets`)).json()) as GuidanceAsset[];
  expect(served.length).toBeGreaterThan(0);

  // Every derived asset projects onto exactly ONE lifecycle state, so the three shelves partition
  // the served corpus. Reading all three also proves the selector governs the whole panel
  // (ADR-0197 D2/D3) rather than one category's rail.
  let shelfTotal = 0;
  for (const state of ['open', 'active', 'archived'] as const) {
    await selectLifecycle(page, state);
    const rows = page.locator('[data-testid="library-shelf"] .library-shelf-row');
    for (const text of await rows.locator('.library-shelf-row-count').allTextContents()) {
      const n = Number(text);
      expect(n).toBeGreaterThan(0); // a rendered row is a NON-EMPTY category
      shelfTotal += n;
    }
  }
  expect(shelfTotal).toBe(served.length);

  // —— Criterion 8: narrow by the declared lifecycle/category scope, then by search — the finder
  // end-to-end, with the forest still the underlying surface.
  await selectLifecycle(page, 'active');
  const shelfRows = page.locator('[data-testid="library-shelf"] .library-shelf-row');
  await expect(shelfRows.first()).toBeVisible();
  const principleRow = page.locator('[data-testid="library-shelf-row-principle"]');
  const principleCount = Number(await principleRow.locator('.library-shelf-row-count').textContent());
  expect(principleCount).toBeGreaterThan(0);

  await principleRow.click();
  await expect(page.locator('[data-testid="library-scope-chip"]')).toContainText('principle');
  await expect(page.locator('[data-testid="library-finder-results"] .library-finder-row')).toHaveCount(
    principleCount,
  );

  await page.locator('.library-finder-input').fill('deep');
  await expect(page.locator(`[data-testid="library-finder-row-${GROUNDING_ID}"]`)).toBeVisible();
  expect(
    await page.locator('[data-testid="library-finder-results"] .library-finder-row').count(),
  ).toBeLessThan(principleCount);

  // The lens is an overlay within the world frame, never a route away (ADR-0185 dec 6).
  await expect(page.locator('[data-testid="tree-route"]')).toBeAttached();
});

// =============================================================================================
// Criteria 2, 3 — the DECISION tier, reached where decisions actually live (ADR-0403 dec 1).
// =============================================================================================

test('story UAT (criteria 2, 3): open a decision through the Library chrome → move to a sibling decision through the finder', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await landOnForest(page);
  await openLibraryLens(page);

  // —— Criterion 2: the only global HUD chrome is the verified-identity avatar (ADR-0205), and the
  // Decisions scope opens a decision in the full-detail overlay.
  await expect(page.locator('[data-testid="hud-avatar"]')).toBeVisible();
  await expect(page.locator('.hud-brand, .brand-name')).toHaveCount(0);

  // `active` because the ROW says `accepted`: `lifecycleOf('adr', …)` projects accepted → active
  // (packages/library/src/lifecycle.ts). Finding the decision here is what proves the projection
  // reached the offline wire at all — the derivation drops schema metadata unless it is crossed
  // deliberately, and without `status` an accepted decision would file itself under `open`.
  await selectLifecycle(page, 'active');
  const decisionsRow = page.locator('[data-testid="library-shelf-decisions-row"]');
  await expect(decisionsRow).toBeVisible();
  expect(Number(await decisionsRow.locator('.library-shelf-row-count').textContent())).toBeGreaterThan(0);

  await openInOverlay(page, 'library-shelf-decisions-row', '0002', ADR_0002);
  const overlay = page.locator('[data-testid="library-open-overlay"]');
  await expectDetail(overlay, ADR_0002_TITLE);
  // A decision record is a body-only artifact: the store row carries the whole document, so the
  // rendered body is its own `# ADR-0002:` H1 and the `## Status` section beneath it. Asserting
  // the SECTIONS (not just the title) is what distinguishes a served decision from an empty shell.
  const decisionBody = overlay.locator('.asset-body');
  await expect(decisionBody.getByRole('heading', { name: /ADR-0002/ })).toBeVisible();
  await expect(decisionBody.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
  await expect(overlay.locator('.chip.cat-adr')).toHaveText('adr');

  // —— Criterion 3: move between decisions through the Library itself. There is no citation link
  // left to hop (ADR-0605 — see the header), so the decision tier is walked the way the product
  // offers: dismiss the open decision, and — the finder still holding its Decisions scope — search
  // for the sibling and open it. The swap is asserted BOTH ways — the sibling's own heading renders
  // AND the first decision's is gone — because an overlay that kept stale content would pass the
  // first assertion alone.
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('[data-testid="library-scope-chip"]')).toBeVisible();
  await page.locator('.library-finder-input').fill('0013');
  await page.locator(`[data-testid="library-finder-row-${ADR_0013}"]`).click();
  await page.locator('[data-testid="library-selection-card"]').getByLabel('Open').click();
  await expectDetail(overlay, ADR_0013_TITLE);
  await expect(overlay.locator('.asset-body').getByRole('heading', { name: /ADR-0013/ })).toBeVisible();
  await expect(overlay.locator('.asset-body').getByRole('heading', { name: /ADR-0002/ })).toHaveCount(0);
});

// =============================================================================================
// Criteria 4, 5, 6 — the grounding round trip that replaces the retired comment loop (ADR-0425).
// =============================================================================================

test('story UAT (criteria 4, 5, 6): find the artifact that grounds the question → it survives a reload → read the decision behind it and come back', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // —— Criterion 4: arrive with a question from a conversation held elsewhere and open the
  // artifact that grounds it, entering the review affordance the way an operator reading closely
  // would.
  await page.goto(`/#/asset/${GROUNDING_ID}`);
  await expectGrounding(libraryRoute(page));

  await page.getByRole('button', { name: /switch to Edit/i }).click();
  // The review surface IS mounted — asserted POSITIVELY first, because every absence below would
  // also "hold" on a page that failed to render at all. This is the anchor that makes them mean
  // something.
  await expect(page.getByLabel('Markdown source')).toBeVisible();
  // …and it offers nothing it cannot honour. No editable operator identity (ADR-0204 D4 —
  // attribution is server-stamped), and no comment affordance of any kind: ADR-0425 dec 1 retires
  // studio commenting rather than leaving a control that accepts a remark and files it nowhere.
  await expect(page.locator('[aria-label="operator identity"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="Peer comments"]')).toHaveCount(0);
  await expect(page.locator('.inline-comment-thread')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);

  // —— Criterion 5: reload, then reopen the same artifact through the Library lens. The grounding
  // is reconstructed from the real offline-store read-back rather than surviving in the first
  // render's memory.
  await page.reload();
  await expectGrounding(libraryRoute(page));
  await landOnForest(page);
  await openLibraryLens(page);
  await selectLifecycle(page, 'active');
  await openInOverlay(page, 'library-shelf-row-principle', 'deep', GROUNDING_ID);
  await expectGrounding(openOverlay(page));

  // —— Criterion 6: read the decision behind it, then come back — the round trip the owner performs
  // when grounding a conversation held in Claude Code or Codex. With no citation link left
  // (ADR-0605) he reaches the decision the way the product offers: the artifact page's `library`
  // crumb into the Library, the Decisions scope, the decision itself; then Back to where the
  // question started.
  await page.goto(`/#/asset/${GROUNDING_ID}`);
  await expectGrounding(libraryRoute(page));
  await libraryRoute(page).locator('.doc-crumb a').click();
  await expect(page.locator('[data-testid="library-drawer"]')).toBeAttached({ timeout: WORLD_MS });
  await page.locator('[data-testid="library-drawer-lens:library"]').click();
  await expect(page.locator('[data-testid="library-finder"]')).toBeVisible();
  await selectLifecycle(page, 'active');
  await openInOverlay(page, 'library-shelf-decisions-row', '0002', ADR_0002);
  await expectDetail(openOverlay(page), ADR_0002_TITLE);
  await expectDecisionSubstance(openOverlay(page));
  await page.goBack();
  await expectGrounding(libraryRoute(page)); // back on the grounding artifact, intact
});

// =============================================================================================
// Criterion 9 — reading an artifact through the full-detail OVERLAY mount specifically.
// =============================================================================================

test('story UAT (criterion 9): read deep-modules in the full-detail overlay → dismiss it back onto the Library', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await landOnForest(page);
  await openLibraryLens(page);
  await selectLifecycle(page, 'active');

  // The selection card's Open control raises the SEPARATE full-detail overlay over the map
  // (ADR-0187 dec 2) — the artifact's derived body, rendered by the byte-locked
  // LibraryDiveBody → AssetView router. The derived body (not just the stored title) is what
  // proves the router reached the renderer through THIS mount.
  await openInOverlay(page, 'library-shelf-row-principle', 'deep', GROUNDING_ID);
  const overlay = openOverlay(page);
  await expectGrounding(overlay);
  await expect(overlay.locator('.chip.cat-principle')).toBeVisible();

  // …and the overlay is TRANSIENT: its Close control dismisses it back onto the Library lens, whose
  // finder still holds the operator's narrowed result — reading the artifact cost him no place.
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(`[data-testid="library-finder-row-${GROUNDING_ID}"]`)).toBeVisible();
});

// =============================================================================================
// Criteria 10, 11, 12, 13 — the mutating journey. Serial: each test consumes the durable state the
// previous one wrote; that chaining IS the durability claim under test.
// =============================================================================================

const PROBE_ID = 'uat-probe-pattern';

const probeAsset = (assets: GuidanceAsset[]): GuidanceAsset | undefined =>
  assets.find((a) => a.id === PROBE_ID);

test.describe('story UAT (criteria 10-13): the mutating journey', () => {
  test.describe.configure({ mode: 'serial' });

  // Snapshot the comment store (git-tracked) and the offline runtime assets store (gitignored,
  // ADR-0210); restore them if any test dies before its cleanup runs. On a green run the restore
  // is a no-op (writes round-trip byte-identically through the backend's serializer).
  let commentsBaseline = '';
  let assetsBaseline = '';

  test.beforeAll(async ({ baseURL }) => {
    // Force the offline backend to SEED its runtime assets store before snapshotting, so the
    // baseline exists even if this block runs before any page has listed assets.
    if (baseURL) await fetch(`${baseURL}/api/assets`).catch(() => undefined);
    commentsBaseline = await fs.readFile(COMMENTS_FILE, 'utf8');
    assetsBaseline = await fs.readFile(ASSETS_FILE, 'utf8');
  });

  test.afterAll(async () => {
    for (const [file, baseline] of [
      [COMMENTS_FILE, commentsBaseline],
      [ASSETS_FILE, assetsBaseline],
    ] as const) {
      if (baseline && (await fs.readFile(file, 'utf8')) !== baseline) {
        console.warn(`story-uat: restoring ${path.basename(file)} to its pre-test baseline`);
        await fs.writeFile(file, baseline, 'utf8');
      }
    }
  });

  test('criteria 10, 11: author a structured Library artifact → edit it (id relocked) → delete it', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // —— Criterion 10: author a fresh artifact. The default category (pattern) is a structured
    // kind, so it is authored through its per-kind fields and the live preview renders the derived
    // body.
    await page.goto('/#/asset/new');
    await page.getByLabel(/^Title/).fill('UAT probe pattern');
    await expect(page.getByLabel(/^Id /)).toHaveValue(PROBE_ID); // the title auto-slugs the id
    await expect(page.getByLabel(/^Category/)).toHaveValue('pattern');
    await page
      .getByLabel(/^Description/)
      .fill('A throwaway probe the scripted story UAT authors, edits and deletes.');
    await page
      .getByLabel(/^The pattern/)
      .fill('Drive every mutation through the real UI and assert on the durable store.');
    await page
      .getByLabel(/^Problem/)
      .fill('A scripted UAT must prove durability without leaving residue in git-tracked stores.');
    await page
      .getByLabel(/^Approach/)
      .fill('Author through the editor, assert the JSON store on disk, then delete the probe.');
    await expect(page.locator('.editor-preview')).toContainText('Drive every mutation through the real UI');
    await expect(page.locator('.editor-preview h2', { hasText: 'Problem' })).toBeVisible();

    const [createdRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create artifact' }).click(),
    ]);
    expect(createdRes.status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`#/asset/${PROBE_ID}$`));
    await expect(page.locator('article.asset-detail h1')).toHaveText('UAT probe pattern');

    const createdAsset = probeAsset(await readJson<GuidanceAsset[]>(ASSETS_FILE));
    expect(createdAsset).toBeDefined();
    expect(createdAsset!.createdAt).toBe(createdAsset!.updatedAt);

    // —— Criterion 11: edit (the id input is re-locked), save, then delete through the UI.
    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`#/asset/${PROBE_ID}/edit$`));
    await expect(page.getByLabel(/^Id /)).toBeDisabled();
    await page
      .getByLabel(/^Approach/)
      .fill(
        'Author through the editor, assert the JSON store on disk, then delete the probe. Edited once to prove the update path.',
      );
    const [patchedRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(patchedRes.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`#/asset/${PROBE_ID}$`));

    const editedAsset = probeAsset(await readJson<GuidanceAsset[]>(ASSETS_FILE));
    expect(editedAsset!.createdAt).toBe(createdAsset!.createdAt); // preserved
    expect(editedAsset!.updatedAt > editedAsset!.createdAt).toBe(true);
    expect(editedAsset!.fields?.approach).toContain('Edited once to prove the update path.');

    page.once('dialog', (d) => void d.accept());
    const [deletedRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'DELETE'),
      page.locator('.asset-actions').getByRole('button', { name: 'Delete' }).click(),
    ]);
    expect(deletedRes.status()).toBe(200);
    // Deleting returns to the forest's Library lens — the standalone `#/library` page is retired
    // (ADR-0185 dec 6), so the landing surface is the map.
    await expect(page.locator('[data-testid="tree-route"]')).toBeAttached({ timeout: WORLD_MS });
    expect(probeAsset(await readJson<GuidanceAsset[]>(ASSETS_FILE))).toBeUndefined();
  });

  test('criteria 12, 13: a cold dev-server restart serves the durable state → the stores are left as found', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // —— Criterion 12: restart durability. Playwright's managed webServer cannot be bounced
    // mid-run, so the shadow spawns a SECOND, cold dev-server process on its own port — the same
    // proof: a fresh process reconstructs the whole state from the JSON stores alone.
    const cold = await startColdServer();
    try {
      // The deleted artifact is correctly absent after a cold restart (criterion 11's delete,
      // reconstructed from storage rather than from the first process's memory).
      await page.goto(`${cold.url}/#/asset/${PROBE_ID}`);
      await expect(page.locator('.error-box h2')).toHaveText('Artifact not found');

      // …and the grounding is reconstructed on a process that has never served it before: the
      // artifact and the decision behind it each render their own body from storage.
      await page.goto(`${cold.url}/#/asset/${GROUNDING_ID}`);
      await expectGrounding(libraryRoute(page));
      await page.goto(`${cold.url}/#/asset/${ADR_0002}`);
      await expectDetail(libraryRoute(page), ADR_0002_TITLE);
      await expectDecisionSubstance(libraryRoute(page));

      // —— Criterion 13: return to the forest where the journey began, and leave the stores as
      // found. `assets.runtime.json` round-trips because the probe was authored, edited and
      // deleted back out. `comments.json` is byte-identical for a stronger reason: since ADR-0425
      // dec 1 retired the studio-side commenting surface, NOTHING in the studio writes to the
      // comment store at all — so this assertion is the retirement's standing proof, not a
      // cleanup check. The server-side store it guards is kept intact for the multiplayer revival
      // (dec 5).
      await page.goto(`${cold.url}/`);
      await expect(page.locator('[data-testid="tree-route"]')).toBeAttached({ timeout: WORLD_MS });
      expect(await fs.readFile(COMMENTS_FILE, 'utf8')).toBe(commentsBaseline);
      expect(await fs.readFile(ASSETS_FILE, 'utf8')).toBe(assetsBaseline);
    } finally {
      await cold.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------
// The criterion-12 cold server: the same command as playwright.config.ts's webServer (and the
// package's own dev script), on port 5175 so neither the managed 5174 instance nor a live
// 5173 session is disturbed. --host 127.0.0.1 because vite's default `localhost` can bind
// IPv6-only on Windows, which the readiness poll would never see.
// ---------------------------------------------------------------------------------------

const COLD_PORT = 5175;

async function startColdServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  const url = `http://127.0.0.1:${COLD_PORT}`;
  const logs: string[] = [];
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', 'node_modules/vite/bin/vite.js', '--port', String(COLD_PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: studioDir,
      env: { ...process.env, STORYTREE_STUDIO_STORE: 'json' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  proc.stdout?.on('data', (c: Buffer) => logs.push(String(c)));
  proc.stderr?.on('data', (c: Buffer) => logs.push(String(c)));

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    if (process.platform === 'win32' && proc.pid) {
      // kill() only terminates the node process on Windows; take the tree down.
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
  };

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`cold dev server exited before becoming ready:\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return { url, stop };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`cold dev server never became ready on ${url}:\n${logs.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
