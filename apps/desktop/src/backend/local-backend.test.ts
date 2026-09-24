// Integration test for the local-backend factory (apps/desktop/src/backend/local-backend.ts).
//
// WHAT IT PINS: the factory composes a local studio backend from injected organism drivers
// and returns an /api/* request handler that dispatches real read/build routes, replacing
// the 503 stub in static-server.ts. The test drives it headlessly over a real node:http
// server (no Electron, no DOM) with a stub backend and a stub build seam — no live SDK,
// no DB, no network.
//
// INTEGRATION TIER: real HTTP requests against the real route dispatch with real discovery
// (the orchestrator's findNodeSpecFile / loadNodeSpec over an empty storiesDir) and a
// stub read backend. The "no /api/health 503" assertion IS the deletion test — if the
// factory were removed, every assertion here would fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { readFileSync, promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Verdict, criterionRevisionId } from "@storytree/proof-protocol";
import { canonicalUatCriterionContent } from "@storytree/library";

import { createLocalBackend, createBrokerForestWriter, resetHierarchyCache } from "./local-backend.js";
import type { LocalBackendDeps, ForestWriter } from "./local-backend.js";
import type { ForestWrite } from "./forest-readiness.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal stub backend — satisfies the read seam without touching a DB or disk. */
function stubBackend(): LocalBackendDeps["backend"] {
  return {
    listAssets: async () => [],
    health: async () => ({ db: "n/a" as const }),
    inFlightBuilds: async () => null,
    latestVerdicts: async () => null,
    // verdictEvents is optional; omitting it is fine — the handler falls back gracefully.
  };
}

/**
 * Spin up a node:http server wrapping the local-backend handler, run `fn` with the base URL,
 * then CLOSE the server before returning — no OS handle leaks.
 */
async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}

// Point to paths that do not exist so the real orchestrator discovery returns [] without
// touching anything in the worktree. The readTree implementation handles a missing dir gracefully.
const NO_STORIES_DIR = "/tmp/local-backend-test-stories-empty";
const NO_DOCS_DIR = "/tmp/local-backend-test-docs-empty";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Pins the CORE outcome: the factory serves /api/health with a real JSON envelope, NOT the
// 503 that static-server.ts returns before the local backend is wired.
test("local-backend: GET /api/health returns a real { store, db } envelope — not a 503", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/health`);

    // Health must always be 200 (even when the DB is unreachable — that is the contract).
    assert.equal(res.status, 200, "health must return 200, never a 503");

    const body = (await res.json()) as Record<string, unknown>;

    // Concrete assertions about the envelope — not just a 200 passthrough.
    assert.equal(body["store"], "json", "envelope must echo the injected store kind");
    assert.equal(body["db"], "n/a", "envelope must carry the db probe result from the stub backend");
    // The identity stamp the studio's handleHealth gained: WHICH process is answering, so a launcher
    // can tell its own sidecar from a foreign listener already holding the port instead of measuring
    // one as the other. This route is RE-COMPOSED from the studio's, never imported, so the mirror
    // only carries what someone deliberately put here — which is exactly how a mirrored route
    // silently drifts. Pinned so the drift is a red, not a discovery.
    assert.equal(body["pid"], process.pid, "envelope must stamp the answering process's own pid");
  });
});

// Pins that the route dispatches real orchestrator discovery: the real readTree is called
// and returns { stories: [] } over a non-existent dir (not undefined, not an error).
test("local-backend: GET /api/tree returns { stories: [] } from real discovery over empty dir", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/tree`);

    assert.equal(res.status, 200, "tree must be 200 over a non-existent stories dir");

    const body = (await res.json()) as Record<string, unknown>;

    // Deletion test: if the factory routed /api/tree to the 503 stub, `stories` would be absent.
    assert.ok(
      Array.isArray(body["stories"]),
      "tree response must contain a `stories` array — the real dispatch ran",
    );
    assert.equal(
      (body["stories"] as unknown[]).length,
      0,
      "real discovery over a non-existent dir returns zero stories, not an error",
    );
  });
});

// ===========================================================================
// VERDICT / ACTIVITY OVERLAY (ADR-0119 deferred overlay) — the desktop forest paints
// proof-health from signed verdicts, NOT the authored-status brown the bare tree fell back to.
//
// These pin the chip's outcome end-to-end over the REAL route dispatch + REAL discovery: GET /api/tree
// folds an injected signed-verdict fixture into island/plant hue (green from a signed pass), and
// GET /api/activity serves the in-flight-build overlay (advisory: a null seam answers a 200
// `{ builds: null }`, never a 404 or a crash). The self-reported PRESENCE overlay is RETIRED
// (ADR-0200 D7) — /api/presence is no longer a route, pinned below.
// ===========================================================================

const TS = "2026-06-27T10:00:00.000Z";
const STORY_CRITERION_ID = "uatc_000000000000000000000001";
const STORY_CRITERION_PROSE = "**The one leg** (witness: machine) — it works end to end.";
const STORY_REVISION_ID = criterionRevisionId(
  canonicalUatCriterionContent(`1. ${STORY_CRITERION_PROSE}`),
);

/** A full signed PASS verdict event for `unitId` (rollupStatus requires the doc to parse as a Verdict). */
function passEvent(
  seq: number,
  unitId: string,
  proofMode: "capability" | "story" | "contract",
  revisionId?: string,
) {
  return {
    kind: "signing",
    seq,
    // `Verdict.parse` takes `unknown`, so the criterion pair is chosen by a ternary on the WHOLE
    // candidate — a criterion verdict carries BOTH criterionId and revisionId, a plain one NEITHER.
    doc: Verdict.parse(
      revisionId === undefined
        ? {
            unitId,
            proofMode,
            outcome: "pass",
            commitSha: "ca".repeat(20),
            signer: "ci@example.com",
            runId: `run-${unitId}`,
            at: TS,
          }
        : {
            unitId,
            proofMode,
            outcome: "pass",
            commitSha: "ca".repeat(20),
            signer: "ci@example.com",
            runId: `run-${unitId}`,
            at: TS,
            criterionId: unitId,
            revisionId,
          },
    ),
  };
}

/** Seed a temp stories dir with one `proposed` story `alpha` + cap `cap-a` + one `## Story UAT` leg. */
async function seedStoriesDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "local-backend-tree-"));
  const storyDir = path.join(dir, "alpha");
  await fsp.mkdir(storyDir);
  await fsp.writeFile(
    path.join(storyDir, "story.md"),
    [
      "---",
      'id: "alpha"',
      "tier: story",
      'title: "Alpha story"',
      'outcome: "the alpha outcome"',
      "status: proposed",
      "proof_mode: UAT",
      "capabilities: [cap-a]",
      "---",
      "",
      "# Alpha",
      "",
      "## Story UAT",
      "",
      `1. ${STORY_CRITERION_PROSE} (criterion-id: ${STORY_CRITERION_ID})(revision-id: ${STORY_REVISION_ID})`,
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(storyDir, "cap-a.md"),
    [
      "---",
      'id: "cap-a"',
      "tier: capability",
      'title: "Capability A"',
      'outcome: "the cap-a outcome"',
      "status: proposed",
      "proof_mode: contract-test",
      "---",
      "",
      "# Capability A",
    ].join("\n"),
    "utf8",
  );
  return {
    dir,
    cleanup: async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    },
  };
}

/** The stub backend with verdict-overlay seams overridden. */
function overlayBackend(over: Partial<LocalBackendDeps["backend"]>): LocalBackendDeps["backend"] {
  return { ...stubBackend(), ...over };
}

// THE CHIP'S OUTCOME: a signed-verdict fixture greens the island AND the plant on the live /api/tree.
test("local-backend: GET /api/tree paints proof-health — a signed-verdict fixture greens the island and plant", async () => {
  const { dir, cleanup } = await seedStoriesDir();
  try {
    const backend = overlayBackend({
      latestVerdicts: async () => ({ "cap-a": { outcome: "pass", at: TS } }),
      verdictEvents: async () => [
        passEvent(1, "cap-a", "capability"),
        passEvent(2, STORY_CRITERION_ID, "story", STORY_REVISION_ID),
      ],
    });
    const handler = createLocalBackend({ storiesDir: dir, docsDir: NO_DOCS_DIR, backend, store: "pg" });

    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/tree`);
      assert.equal(res.status, 200, "tree must be 200");
      const body = (await res.json()) as { stories: Array<Record<string, unknown>> };
      const alpha = body.stories.find((s) => s["id"] === "alpha");
      assert.ok(alpha, "the seeded story is in the payload");

      // Deletion test: drop the verdict fold and these are undefined → the island/plant stay brown.
      const storyVerdict = alpha["verdict"] as { outcome?: string } | undefined;
      assert.equal(
        storyVerdict?.outcome,
        "pass",
        "the ISLAND greens — story.verdict.outcome=pass from the per-test crown roll-up",
      );
      const caps = alpha["capabilities"] as Array<Record<string, unknown>>;
      const capVerdict = caps[0]?.["verdict"] as { outcome?: string } | undefined;
      assert.equal(
        capVerdict?.outcome,
        "pass",
        "the PLANT greens — cap.verdict.outcome=pass from its own signed verdict",
      );
    });
  } finally {
    await cleanup();
  }
});

// Advisory under-claim: with null verdict seams (the json backend / a down DB) the tree carries NO
// verdict — the authored brown stands, never a forged green (ADR-0033 presence-block discipline).
test("local-backend: GET /api/tree under-claims (no verdict) when the verdict seams answer null", async () => {
  const { dir, cleanup } = await seedStoriesDir();
  try {
    const handler = createLocalBackend({
      storiesDir: dir,
      docsDir: NO_DOCS_DIR,
      backend: stubBackend(), // all seams null
      store: "pg",
    });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/tree`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { stories: Array<Record<string, unknown>> };
      const alpha = body.stories.find((s) => s["id"] === "alpha");
      assert.ok(alpha);
      assert.equal(alpha["verdict"], undefined, "no crown verdict — the island keeps its authored hue");
    });
  } finally {
    await cleanup();
  }
});

// GET /api/activity serves the in-flight-build overlay (the wisp layer) from the injected seam.
test("local-backend: GET /api/activity returns the in-flight-build overlay { builds } from the seam", async () => {
  const builds = [{ unitId: "cap-a", tier: "capability", runId: "run-1", at: TS, phase: "IMPLEMENT" }];
  const backend = overlayBackend({ inFlightBuilds: async () => builds });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200, "activity must be 200");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body["builds"], builds, "{ builds } is the backend's inFlightBuilds result");
  });
});

// GET /api/activity is advisory: a null seam (down DB / json) answers 200 { builds: null } — never 404.
test("local-backend: GET /api/activity is advisory — 200 { builds: null } when the seam can't answer", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(), // inFlightBuilds → null
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200, "advisory absence is a 200, not a 404 or 500");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["builds"], null, "{ builds: null } is the honest advisory-absent answer");
  });
});

// GET /api/activity ALSO surfaces story claims (ADR-0138): the claim wisp layer rides the SAME wire as
// builds. A claim carries kind:"claim" (the §5 honesty wall) — it must render distinct from a green bloom.
test("local-backend: GET /api/activity surfaces story claims { builds, claims } from the seam, distinct from a proven-green bloom", async () => {
  const claims = [
    { unitId: "wisp-as-story-claim", kind: "claim", sessionId: "s1", branch: "b1", intent: "orchestrate", at: TS },
  ];
  const backend = overlayBackend({ inFlightClaims: async () => claims });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200, "activity must be 200");
    const body = (await res.json()) as { builds: unknown; claims: Array<{ kind: string }> };
    assert.deepEqual(body.claims, claims, "{ claims } is the backend's inFlightClaims result");
    assert.equal(body.builds, null, "builds is independently advisory-null here");
    // §5 honesty wall: every claim activity is discriminated kind:"claim", never green/bloom.
    for (const c of body.claims) {
      assert.equal(c.kind, "claim");
      assert.ok(!["green", "bloom"].includes(c.kind));
    }
  });
});

// GET /api/activity claims are advisory: a seam that omits inFlightClaims answers { claims: null } — never throws.
test("local-backend: GET /api/activity is advisory for claims — { claims: null } when the seam omits inFlightClaims", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(), // no inFlightClaims → claims: null
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["claims"], null, "{ claims: null } is the honest advisory-absent answer");
  });
});

// GET /api/activity ALSO surfaces claim DEPARTURES (ADR-0200 D7 wisp-out legibility) — the third
// layer on the SAME wire the studio serves (`{builds, claims, departures}`). Without it a released
// claim vanishes from the desktop map indistinguishably from a lost one, which is the exact friction
// the departure fade exists to close.
test("local-backend: GET /api/activity surfaces claim departures { builds, claims, departures } from the seam", async () => {
  const departures = [
    { unitId: "desktop", sessionId: "s-departed", grade: "work", ageMs: 48_000, at: TS },
  ];
  const backend = overlayBackend({ inFlightDepartures: async () => departures });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200, "activity must be 200");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(
      body["departures"],
      departures,
      "{ departures } is the backend's inFlightDepartures result, served verbatim",
    );
    assert.equal(body["builds"], null, "builds is independently advisory-null here");
    assert.equal(body["claims"], null, "claims is independently advisory-null here");
  });
});

// Departures are advisory exactly like claims: a narrow seam that omits inFlightDepartures answers
// { departures: null } — a courtesy read is silently absent, never a 500 and never a missing key.
test("local-backend: GET /api/activity is advisory for departures — { departures: null } when the seam omits it", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(), // no inFlightDepartures → departures: null
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/activity`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok("departures" in body, "the key is always present — absence is null, never a missing key");
    assert.equal(body["departures"], null, "{ departures: null } is the honest advisory-absent answer");
  });
});

// PRESENCE IS RETIRED (ADR-0200 D7): /api/presence is no longer a route — it falls through to the
// 404 'unknown endpoint', and the tree payload no longer weaves a `sessions` block. The claim
// ledger (/api/claims below) is the one coordination + observability surface.
test("local-backend: GET /api/presence is retired — 404 unknown endpoint (ADR-0200 D7)", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "pg",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/presence`);
    assert.equal(res.status, 404, "the presence mirror is gone — the route falls through to 404");
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof body["error"] === "string", "carries the standard 404 error body");
  });
});

// The tree payload carries NO self-reported `sessions` weave any more (ADR-0200 D7).
test("local-backend: GET /api/tree carries no `sessions` block — the presence weave is retired", async () => {
  const { dir, cleanup } = await seedStoriesDir();
  try {
    const handler = createLocalBackend({
      storiesDir: dir,
      docsDir: NO_DOCS_DIR,
      backend: stubBackend(),
      store: "pg",
    });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/tree`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(!("sessions" in body), "no self-reported sessions weave rides the tree payload");
    });
  } finally {
    await cleanup();
  }
});

// ===========================================================================
// GET /api/claims — the claim-ledger DOCK view (ADR-0200 D7). Re-composes the studio's handleClaims:
// fold the backend's raw live claim rows through the pure `groupClaimsBySession`. Sibling to
// /api/activity but its OWN endpoint (the studio dock fetches it only while open). Before
// this route existed the request fell through to the local-backend 404 'unknown endpoint' — the exact
// class of desktop-only gap PR #751 fixed for /api/docs/content. Advisory: a null/absent seam answers
// 200 { sessions: null }, never a 503; the only error path is the 405 method guard.
// ===========================================================================

// A fresh (non-stale) claim row: heartbeat = NOW, so `groupClaimsBySession` marks it `stale: false`.
// ⚠ THE FOLD DOES NOT DROP STALE ROWS AND HAS NOT SINCE ADR-0346 D1 — it MARKS them, and the route
// carries them (ADR-0535 D1). Mirrors the ClaimDocT shape (packages/notice-board/src/claim.ts) the
// pg store's listAllClaims yields.
function freshClaim(over: Record<string, unknown> = {}) {
  const nowIso = new Date().toISOString();
  return {
    unitId: "notice-board",
    sessionId: "sess-1",
    branch: "claude/dock",
    intent: "wiring the dock",
    grade: "work",
    claimedAt: nowIso,
    heartbeatAt: nowIso,
    ...over,
  } satisfies Record<string, unknown>;
}

test("local-backend: GET /api/claims folds the backend's live claim rows into session groups", async () => {
  const backend = overlayBackend({
    sessionClaims: async () => [
      freshClaim({ unitId: "notice-board", sessionId: "sess-1", branch: "claude/dock" }),
      freshClaim({ unitId: "library", sessionId: "sess-1", branch: "claude/dock", grade: "exploring" }),
    ],
  });
  const handler = createLocalBackend({ storiesDir: NO_STORIES_DIR, docsDir: NO_DOCS_DIR, backend, store: "pg" });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/claims`);
    // Deletion test: before the /api/claims route existed this fell through to the 404 'unknown endpoint'.
    assert.equal(res.status, 200, "claims must be 200 — the route is mounted, not a 404 fall-through");
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; branch: string; claims: unknown[] }>;
    };
    assert.ok(Array.isArray(body.sessions), "the answer carries a grouped `sessions` array");
    assert.equal(body.sessions.length, 1, "both claims share one session → one group");
    assert.equal(body.sessions[0]!.sessionId, "sess-1");
    assert.equal(body.sessions[0]!.branch, "claude/dock");
    assert.equal(body.sessions[0]!.claims.length, 2, "the session's two live claims are folded in");
  });
});

test("local-backend: GET /api/claims is advisory — 200 { sessions: null } when the seam is absent", async () => {
  // stubBackend omits sessionClaims → the handler falls back to null (the json / down-DB posture).
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "pg",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/claims`);
    assert.equal(res.status, 200, "advisory absence is a 200, never a 503");
    assert.deepEqual(await res.json(), { sessions: null }, "{ sessions: null } is the honest advisory answer");
  });
});

test("local-backend: GET /api/claims is advisory — 200 { sessions: null } when the seam answers null", async () => {
  const backend = overlayBackend({ sessionClaims: async () => null });
  const handler = createLocalBackend({ storiesDir: NO_STORIES_DIR, docsDir: NO_DOCS_DIR, backend, store: "pg" });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/claims`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sessions: null });
  });
});

test("local-backend: /api/claims refuses a non-GET method with 405 (the only error path)", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "pg",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/claims`, { method: "POST" });
    assert.equal(res.status, 405, "claims is a read — non-GET is a typed 405, never a silent fall-through");
  });
});

// ===========================================================================
// GET /api/arcs — the ARC SURFACE (ADR-0267 / ADR-0314). Re-composes the studio's handleArcs over
// the SAME shared join (@storytree/arc's loadArcRollup/loadArcRollups), so the desktop, the studio and
// `storytree arc show` cannot disagree about what an arc contains.
//
// THE GAP THESE CLOSE, measured rather than theorised: the Electron app loads the COMPILED STUDIO
// BUNDLE against this backend, so it already shipped the arc lens that landed in the studio — and
// the lens 404'd here, leaving the thick client with NO arc orientation while the studio showed the
// whole portfolio. Every assertion below fails if the route is removed.
// ===========================================================================

/**
 * A minimal in-memory document store, defined HERE rather than imported: `@storytree/storage-protocol`
 * is drive's declared dep and not desktop's, so pnpm's strict isolation will not resolve `InMemoryStore`
 * from apps/desktop (the same reason chat-sse-mount.test.ts carries its own `FixtureStore`). Only
 * `getDoc`/`queryDocs` are exercised by the rollup; the rest satisfy the seam's shape — and the
 * class now `implements` that seam rather than being asserted into it at each call site
 * (anti-slop `no-chained-type-assertions`, inc-09), so a method the rollup starts calling is a
 * compile error here instead of a runtime `undefined is not a function`.
 */
/** The `Store` seam the arc rollup reads through — reached without importing it directly. */
type ArcRollupStoreSeam = Parameters<typeof import("@storytree/arc").loadArcRollup>[0]["store"];

class ArcFixtureStore implements ArcRollupStoreSeam {
  readonly #docs = new Map<string, { id: string; kind: string; doc: unknown; createdAt: string; updatedAt: string }>();
  #seq = 0;

  async upsertDoc(input: { id: string; kind: string; doc: unknown; actor?: string }) {
    const now = new Date().toISOString();
    const entry = {
      id: input.id,
      kind: input.kind,
      doc: input.doc,
      createdAt: this.#docs.get(input.id)?.createdAt ?? now,
      updatedAt: now,
    };
    this.#docs.set(input.id, entry);
    return entry;
  }
  /** Field-scoped write (ADR-0352) — shallow merge, enough for a fixture. */
  async patchDoc(input: {
    id: string;
    fields: Readonly<Record<string, unknown>>;
    actor?: string;
    kind?: string;
    validate?: (mergedDoc: unknown) => unknown;
  }) {
    const existing = this.#docs.get(input.id);
    if (!existing) return null;
    const merged = { ...(existing.doc as Record<string, unknown>), ...input.fields };
    const doc = input.validate ? input.validate(merged) : merged;
    const entry = { ...existing, kind: input.kind ?? existing.kind, doc, updatedAt: new Date().toISOString() };
    this.#docs.set(input.id, entry);
    return entry;
  }
  async getDoc(id: string) {
    return this.#docs.get(id) ?? null;
  }
  async queryDocs(filter?: { kind?: string }) {
    const all = [...this.#docs.values()];
    return filter?.kind === undefined ? all : all.filter((d) => d.kind === filter.kind);
  }
  async deleteDoc(id: string) {
    return this.#docs.delete(id);
  }
  async appendEvent(e: {
    id: string;
    kind: string;
    type: "created" | "updated" | "deleted";
    doc: unknown;
    actor?: string;
  }) {
    return { seq: ++this.#seq, ...e, actor: e.actor ?? "system", at: new Date().toISOString() };
  }
  async readEvents() {
    return [];
  }
}

/**
 * Seed the three inputs the rollup joins over: the doc store (arc + increment + open-question rows,
 * each carrying the `arcRef` containment edge ADR-0183 D3 puts on the CHILD), a `docs/decisions`
 * tree with a frontmatter `arc:` stamp, and a `stories/` tree with the same stamp.
 */
async function seedArcFixture(): Promise<{
  store: ArcFixtureStore;
  docsDir: string;
  storiesDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "local-backend-arcs-"));
  const docsDir = path.join(root, "docs");
  const storiesDir = path.join(root, "stories");
  await fsp.mkdir(path.join(docsDir, "decisions"), { recursive: true });
  await fsp.mkdir(path.join(storiesDir, "surface-story"), { recursive: true });
  await fsp.writeFile(
    path.join(storiesDir, "surface-story", "story.md"),
    '---\nid: "surface-story"\ntier: story\narc: surface-arc\n---\n\n# Surface story\n',
    "utf8",
  );

  const store = new ArcFixtureStore();
  // The decision is a ROW, not a file (ADR-0403 dec 1). The arc's ADR leg joins on `arcRef`, so the
  // `decisions/` directory above survives only because `listDocs` still walks the whole `docs/` tree.
  await store.upsertDoc({
    id: "adr-0267",
    kind: "adr",
    doc: {
      kind: "adr",
      id: "adr-0267",
      title: "Arcs take the slot",
      description: "ADR-0267 — Arcs take the slot",
      body: "# ADR-0267: Arcs take the slot\n",
      number: 267,
      status: "accepted",
      amends: [],
      supersedes: [],
      loadBearing: false,
      arcRef: "asset:surface-arc",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  });
  await store.upsertDoc({
    id: "surface-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "surface-arc",
      title: "Arcs as the primary orientation surface",
      description: "the arc surface",
      intent: "Arcs are what the owner meets on the map.",
      endState: "The owner stops asking for a re-onboarding briefing.",
      createdAt: "2026-07-29",
      updatedAt: "2026-07-30",
    },
  });
  await store.upsertDoc({
    id: "surface-arc-inc-01",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "surface-arc-inc-01",
      title: "the rollup landed",
      description: "d",
      objective: "the rollup landed",
      body: "the rollup landed",
      arcRef: "asset:surface-arc",
      status: "closed",
      outcome: { date: "2026-07-30", pr: "#1010" },
      createdAt: "2026-07-30",
      updatedAt: "2026-07-30",
    },
  });
  await store.upsertDoc({
    id: "oq-blocked-meaning",
    kind: "open-question",
    doc: {
      kind: "open-question",
      id: "oq-blocked-meaning",
      title: "What exactly qualifies as blocked?",
      description: "D7 names blocked but does not define it",
      stakes: "The surface cannot render a blocked state until this is settled.",
      statement: "s",
      context: "c",
      arcRef: "asset:surface-arc",
      createdAt: "2026-07-30",
      updatedAt: "2026-07-30",
    },
  });

  return {
    store,
    docsDir,
    storiesDir,
    cleanup: async () => fsp.rm(root, { recursive: true, force: true }),
  };
}

// THE CORE OUTCOME: the thick client serves the arc surface's list, joined from the store + the two
// on-disk trees. Deletion test — before this route existed the request fell through to the 404
// 'unknown endpoint', which is exactly what left the desktop arc lens empty.
test("local-backend: GET /api/arcs serves the arc rollups — not a 404 fall-through", async () => {
  const { store, docsDir, storiesDir, cleanup } = await seedArcFixture();
  try {
    const backend = overlayBackend({ docStore: async () => store });
    const handler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/arcs`);
      assert.equal(res.status, 200, "arcs must be 200 — the route is mounted, not a 404");
      const body = (await res.json()) as { arcs: Array<Record<string, unknown>> };
      assert.ok(Array.isArray(body.arcs), "the list answer carries an `arcs` array");
      assert.deepEqual(
        body.arcs.map((a) => a["id"]),
        ["surface-arc"],
      );
    });
  } finally {
    await cleanup();
  }
});

// THE LIST IS THE SUMMARY PROJECTION OF THAT SAME JOIN — the desktop's half of the two-width
// contract, asserted against `summariseArcRollup` itself rather than a hand-shaped literal. The
// narrowing is SHARED code (`loadArcRollupSummaries` in @storytree/arc); a desktop copy that
// re-picked the fields would be exactly the envelope drift the MIRRORS row exists to catch, and
// this is where it goes red first.
test("local-backend: GET /api/arcs serves the SUMMARY projection, not the whole rollup", async () => {
  const { store, docsDir, storiesDir, cleanup } = await seedArcFixture();
  try {
    const backend = overlayBackend({ docStore: async () => store });
    const handler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });
    await withServer(handler, async (base) => {
      const body = (await (await fetch(`${base}/api/arcs`)).json()) as {
        arcs: Array<Record<string, unknown>>;
      };

      const { loadArcRollup, summariseArcRollup } = await import("@storytree/arc");
      const rollup = await loadArcRollup(
        {
          store,
          storiesDir,
        },
        "surface-arc",
      );
      assert.deepEqual(body.arcs, JSON.parse(JSON.stringify([summariseArcRollup(rollup!)])));

      // AND THE NARRATIVE PROSE IS ABSENT, asserted on the real response rather than on the
      // projection function, because what this route ships is the whole point. Measured against the
      // live store on 2026-08-20, the un-narrowed list was 1,364,425 bytes over 76 arcs — 75.5% of
      // it in four fields no lane draws (increment `outcome` 39.4%, arc `intent` 14.8%, arc
      // `endState` 11.1%, increment `objective` 10.2%) — against 226,836 narrowed. Each is one
      // property away from returning, and nothing else would notice.
      const [arc] = body.arcs;
      assert.deepEqual(Object.keys(arc!).sort(), [
        "gates",
        "id",
        "increments",
        "lifecycle",
        "openQuestions",
        "title",
        "waiting",
      ]);
      // The question COUNT crosses; the questions and their cold-answerable `stakes` prose do not.
      assert.equal(arc!["openQuestions"], 1);
      assert.equal(Object.hasOwn(arc!, "questions"), false);
    });
  } finally {
    await cleanup();
  }
});

// The payload is THE ARC PACKAGE'S JOIN, with nothing derived locally — asserted against `loadArcRollup`
// itself rather than a hand-shaped literal, so a handler that ever started deriving its own view
// (or a desktop copy that drifted from the studio's) goes red HERE.
test("local-backend: GET /api/arcs/<id> serves the SAME rollup drive's join produces", async () => {
  const { store, docsDir, storiesDir, cleanup } = await seedArcFixture();
  try {
    const backend = overlayBackend({ docStore: async () => store });
    const handler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/arcs/surface-arc`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;

      const { loadArcRollup } = await import("@storytree/arc");
      const expected = await loadArcRollup(
        {
          store,
          storiesDir,
        },
        "surface-arc",
      );
      assert.deepEqual(body, JSON.parse(JSON.stringify(expected)));

      // And the join really joined: the children reached the desktop payload, not just an arc shell.
      assert.deepEqual(body["adrs"], [
        { number: 267, status: "accepted", title: "Arcs take the slot" },
      ]);
      assert.deepEqual(body["stories"], ["surface-story"]);
      assert.equal((body["increments"] as unknown[]).length, 1);
      assert.equal(body["waiting"], true, "ADR-0267 D7's one defined state rides the payload");
    });
  } finally {
    await cleanup();
  }
});

// An unknown id is a 404, never a confident empty shell.
test("local-backend: GET /api/arcs/<unknown> is a 404, not an empty arc", async () => {
  const { store, docsDir, storiesDir, cleanup } = await seedArcFixture();
  try {
    const backend = overlayBackend({ docStore: async () => store });
    const handler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/arcs/no-such-arc`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(typeof body["error"] === "string", "carries the standard error body");
    });
  } finally {
    await cleanup();
  }
});

// "NO STORE" AND "NO ARCS" ARE DIFFERENT FACTS, and the pair of answers is what keeps them apart:
// the list is 200 { arcs: null } (the frontend's `null` branch — "needs the live store"), a single
// id is 503. An `{ arcs: [] }` here would tell the owner this machine HAS the store and the
// portfolio is empty, which is the confident-empty lie the surface exists to avoid.
test("local-backend: /api/arcs distinguishes no-store from no-arcs — list 200 { arcs: null }, one id 503", async () => {
  // stubBackend omits docStore entirely — the narrow/offline posture.
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });
  await withServer(handler, async (base) => {
    const list = await fetch(`${base}/api/arcs`);
    assert.equal(list.status, 200, "a missing store is a 200 with a null payload, never a 503");
    assert.deepEqual(await list.json(), { arcs: null }, "null — NOT [], which would claim emptiness");

    const one = await fetch(`${base}/api/arcs/surface-arc`);
    assert.equal(one.status, 503, "one arc without a store is a 503 — there is no honest null here");
  });
});

// A seam that ANSWERS null (wired, but this backend has no document store) reads identically to an
// absent seam — the frontend's `null` branch either way.
test("local-backend: /api/arcs answers { arcs: null } when the docStore seam answers null", async () => {
  const backend = overlayBackend({ docStore: async () => null });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "json",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/arcs`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { arcs: null });
  });
});

// Read-only BY DECISION, not by omission (ADR-0267 D6 / ADR-0314 D9): a write is a typed 405 with
// the reason, never a silent fall-through to the 404.
test("local-backend: /api/arcs refuses a non-GET method with 405 — read-only by decision", async () => {
  const { store, docsDir, storiesDir, cleanup } = await seedArcFixture();
  try {
    const backend = overlayBackend({ docStore: async () => store });
    const handler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/arcs/surface-arc`, { method: "POST" });
      assert.equal(res.status, 405, "a write is refused by decision, with the ADR named");
      const body = (await res.json()) as Record<string, unknown>;
      assert.match(String(body["error"]), /read-only/, "the refusal states WHY, not just that");
    });
  } finally {
    await cleanup();
  }
});

// ===========================================================================
// GET /api/floor-health — the FACTORY-FLOOR reading (ADR-0316) behind ADR-0314 D7's strip.
// Re-composes the studio's handleFloorHealth over the SAME shared composition (drive's
// `loadFloorHealthReading`), so the desktop band, the hosted studio and `storytree factory health`
// cannot disagree about how the floor is doing.
//
// THE GAP THESE CLOSE, measured rather than theorised, and the SECOND instance of one class: the
// Electron app loads the COMPILED STUDIO BUNDLE against this backend, so it already ships the band
// #1228 wired — and with no route here the band rendered `declined` ("no reading — the floor-health
// read didn't answer here"). Honest rather than broken, by design, but it is not the reading. That is
// the same shape #1192 found and #1195 closed for /api/arcs. Every assertion below fails if the route
// is removed.
// ===========================================================================

const FLOOR_LOUD_ID = "a-live-guardrail-that-keeps-firing";

/**
 * The floor-health fixture, served VERBATIM — docs AND events, with every `at` written down.
 *
 * THAT IS NOT FASTIDIOUSNESS, IT IS THE ONLY WAY THIS FIXTURE MEANS ANYTHING. A reinforcement is
 * attributed to the route STANDING WHEN IT LANDED, read off the event log's timestamps
 * (`RECURRENCE_ATTRIBUTION_RULE`). `Store.appendEvent` accepts no `at` — the implementation stamps
 * it — so a store that recorded its own events would date every route to TODAY and read every
 * reinforcement as PRE-route, leaving `loudest` absent and the interesting half of the reading
 * unexercised. The studio's own floorHealthApi.integration.test.ts carries the same fixture for the
 * same reason.
 *
 * The dates are chosen to exercise the rule rather than merely to produce a number: the route is set
 * on 07-11, so the 07-11 reinforcement is SAME-DAY (never post-route — day-granular dates cannot
 * prove ordering) and only the three later ones count.
 */
const FLOOR_DOCS = [
  {
    id: FLOOR_LOUD_ID,
    kind: "friction",
    doc: {
      title: FLOOR_LOUD_ID,
      route: "guardrail",
      reinforcedBy: ["2026-07-11", "2026-07-12", "2026-07-16", "2026-07-28"].map((date) => ({
        branch: "claude/x",
        date,
        evidence: "`e`",
      })),
    },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  },
];

const FLOOR_EVENTS = [
  {
    seq: 1,
    id: FLOOR_LOUD_ID,
    kind: "friction",
    type: "created" as const,
    doc: {},
    actor: "cli",
    at: "2026-07-11T09:00:00.000Z",
  },
  {
    seq: 2,
    id: FLOOR_LOUD_ID,
    kind: "friction",
    type: "updated" as const,
    doc: { route: "guardrail" },
    actor: "cli",
    at: "2026-07-11T13:54:04.888Z",
  },
];

/**
 * A minimal document store over that fixture — defined HERE for the same reason `ArcFixtureStore` is:
 * `@storytree/storage-protocol` is drive's declared dep and not desktop's, so pnpm's strict isolation
 * will not resolve `InMemoryStore` from apps/desktop.
 *
 * Only `queryDocs` and `readEvents` are on this route (`loadFloorHealthReading` reads nothing else).
 * The remaining four satisfy the seam's SHAPE and THROW: this backend's floor-health path is
 * report-only by ADR-0316 D4, so a route that ever started writing — or reaching for a doc by id —
 * should break loudly here rather than quietly widening what these tests cover.
 */
class FloorHealthFixtureStore {
  async queryDocs(filter?: { kind?: string }) {
    return FLOOR_DOCS.filter((d) => filter?.kind === undefined || d.kind === filter.kind);
  }
  async readEvents(filter?: { id?: string }) {
    return FLOOR_EVENTS.filter((e) => filter?.id === undefined || e.id === filter.id);
  }
  async upsertDoc(): Promise<never> {
    throw new Error("floor-health is report-only (ADR-0316 D4) — it must not upsert");
  }
  async patchDoc(): Promise<never> {
    throw new Error("floor-health is report-only (ADR-0316 D4) — it must not patch");
  }
  async getDoc(): Promise<never> {
    throw new Error("floor-health must not read a doc by id");
  }
  async deleteDoc(): Promise<never> {
    throw new Error("floor-health is report-only (ADR-0316 D4) — it must not delete");
  }
  async appendEvent(): Promise<never> {
    throw new Error("floor-health is report-only (ADR-0316 D4) — it must not append events");
  }
}

// THE CORE OUTCOME: the thick client serves the reading, and it is DRIVE'S composition with nothing
// derived locally — asserted against `loadFloorHealthReading` itself rather than a hand-shaped
// literal, so a handler that ever started computing its own figure (or a desktop copy that drifted
// from the studio's) goes red HERE. Deletion test: before this route existed the request fell through
// to the 404 'unknown endpoint', which is exactly what left the desktop band `declined`.
test("local-backend: GET /api/floor-health serves the SAME reading drive composes — not a 404 fall-through", async () => {
  const store = new FloorHealthFixtureStore();
  const backend = overlayBackend({ docStore: async () => store });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "pg",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/floor-health`);
    assert.equal(res.status, 200, "floor-health must be 200 — the route is mounted, not a 404");
    const body = (await res.json()) as { reading: Record<string, unknown> };

    const { loadFloorHealthReading } = await import("@storytree/drive");
    const expected = await loadFloorHealthReading(store);
    assert.deepEqual(body.reading, JSON.parse(JSON.stringify(expected)));

    // And the instrument really read: the loudest DISTINCT cause reached the desktop payload, with
    // the ONE number this wire may carry (ADR-0316 D3) — not an empty shell that happens to be equal.
    const loudest = body.reading["loudest"] as { cause: string; route: string; recurrences: number };
    assert.equal(loudest.cause, FLOOR_LOUD_ID);
    assert.equal(loudest.route, "guardrail");
    assert.equal(loudest.recurrences, 3, "3 post-route — the same-day reinforcement never counts");
    assert.ok(Object.hasOwn(body.reading, "window"), "every figure arrives with its window (D2)");
  });
});

// "NO STORE" AND "A QUIET FLOOR" ARE DIFFERENT FACTS, and `reading: null` is what keeps them apart.
// A band that rendered a missing instrument as "all clear" is the exact failure the whole strip
// exists to avoid, so the offline/json posture must not collapse into a quiet reading.
test("local-backend: /api/floor-health answers { reading: null } with no document store — not a quiet floor", async () => {
  // stubBackend omits docStore entirely — the narrow/offline posture.
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/floor-health`);
    assert.equal(res.status, 200, "a missing store is a 200 with a null reading, never a 503");
    assert.deepEqual(await res.json(), { reading: null });
  });
});

// A seam that ANSWERS null (wired, but this backend has no document store) reads identically to an
// absent seam — the band's `declined` branch either way.
test("local-backend: /api/floor-health answers { reading: null } when the docStore seam answers null", async () => {
  const backend = overlayBackend({ docStore: async () => null });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "json",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/floor-health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { reading: null });
  });
});

// Report-only BY DECISION, not by omission (ADR-0316 D4): a write is a typed 405 that states WHY,
// never a silent fall-through to the 404.
test("local-backend: /api/floor-health refuses a non-GET with 405 — it reports, it does not adjudicate", async () => {
  const backend = overlayBackend({ docStore: async () => new FloorHealthFixtureStore() });
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend,
    store: "pg",
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/floor-health`, { method: "POST" });
    assert.equal(res.status, 405, "a write is refused by decision, with the ADR named");
    const body = (await res.json()) as Record<string, unknown>;
    assert.match(String(body["error"]), /does not adjudicate/, "the refusal states WHY, not just that");
  });
});

// Pins that the read-dispatch seam is wired: listAssets is called and its result (the stub's
// empty array) is serialised as the response body.
test("local-backend: GET /api/assets returns the stub backend's result as an array", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/assets`);

    assert.equal(res.status, 200, "assets must be 200");

    const body = (await res.json()) as unknown;

    // Concrete content check: the stub's [] was serialised — not a 503, not a 500.
    assert.ok(Array.isArray(body), "assets response must be an array from the backend dispatch");
    assert.equal((body as unknown[]).length, 0, "stub backend returns an empty array");
  });
});

// Pins that the build seam is wired: an unknown unit (isBuildable returns false) is 404,
// not a crash or the 503 stub. The runner is injected but never called in this path.
test("local-backend: POST /api/build with an unknown unitId returns 404 from the build seam", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
    build: {
      isBuildable: async (_unitId: string) => false,
      runner: async (_unitId: string, _sink: (line: string) => void) =>
        ({ ok: false, body: "stub: not buildable" }),
    },
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: "no-such-unit" }),
    });

    assert.equal(res.status, 404, "an unknown unit must be 404, not a 503 or crash");

    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(
      typeof body["error"] === "string",
      "error response must carry an error field (real error dispatch, not the 503 stub)",
    );
  });
});

// Pins that the route table is real: an unrecognised /api/* path returns 404 with an error body
// (not the static-server 503, not an unhandled crash).
test("local-backend: an unrecognised /api/* endpoint returns 404 with an error body", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/no-such-endpoint`);
    assert.equal(res.status, 404, "an unrecognised /api/* path must be 404");
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof body["error"] === "string", "must carry an error field");
  });
});

// ===========================================================================
// FOREST-WRITE ROUTE (ADR-0117) — the local backend's verdict writes are BROKERED.
// (Brokered PRESENCE writes retired with self-reported presence, ADR-0200 D7 — pinned below.)
//
// These pin step 3 of the re-home: POST /api/forest/write routes through the injected broker writer
// (never a direct @storytree/store / PgWorkStore path), surfaces the broker's refusal honestly
// (never a forged success), and the production `createBrokerForestWriter` POSTs the exact
// { type, payload } envelope to the broker over a REAL fetch — opening no DB connection.
// ===========================================================================

/** A minimal fully-valid, locally-signed verdict attributed to the member. */
function validVerdict() {
  return Verdict.parse({
    unitId: "shared-forest-connection#gate-1",
    proofMode: "capability",
    outcome: "pass",
    commitSha: "cafebabecafebabecafebabecafebabecafebabe",
    signer: "friend-builder@example.com",
    runId: "run-local-backend-forest-1",
    at: "2026-06-27T10:00:00.000Z",
  });
}

// Pins that the route routes through the INJECTED broker writer with the VALIDATED ForestWrite —
// a persisted result → 201, and the writer (not a DB store) is what got called.
test("local-backend: POST /api/forest/write forwards the validated verdict to the broker writer (201)", async () => {
  const verdict = validVerdict();
  const received: ForestWrite[] = [];
  const forestWrite: ForestWriter = {
    write: async (w) => {
      received.push(w);
      return { persisted: true, status: 201, body: { ok: true, verdict } };
    },
  };
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
    forestWrite,
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/forest/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "verdict", payload: verdict }),
    });

    assert.equal(res.status, 201, "a persisted write returns 201");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["ok"], true);

    // The route called the broker writer with the validated ForestWrite — the brokered write path.
    assert.equal(received.length, 1, "the forest writer was called exactly once");
    const w = received[0];
    assert.ok(w, "the writer received a ForestWrite");
    assert.equal(w.type, "verdict");
    assert.deepEqual(w.payload, verdict, "the writer received the exact validated verdict");
  });
});

// Pins fail-closed honesty: a broker refusal (e.g. 403 not-a-builder) is surfaced with its status —
// never masked as a 2xx success.
test("local-backend: POST /api/forest/write surfaces a broker refusal status, never a forged success", async () => {
  const forestWrite: ForestWriter = {
    write: async () => ({
      persisted: false,
      status: 403,
      guidance: "you are not yet an authorized builder — ask the owner via the Members panel",
    }),
  };
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
    forestWrite,
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/forest/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "verdict", payload: validVerdict() }),
    });

    assert.equal(res.status, 403, "a broker refusal is surfaced with its status, not masked as 2xx");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["ok"], false, "the route reports the write did NOT persist");
    assert.ok(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      "carries the member-actionable guidance",
    );
  });
});

// Pins that an absent forest-write seam is a clean 404 (read-only deployment), not a crash.
test("local-backend: POST /api/forest/write returns 404 when the forest-write seam is not wired", async () => {
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/forest/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404, "an unwired forest-write seam → 404 (not a crash, not a 503)");
  });
});

// Pins shape-validation BEFORE any write: a malformed payload is 400 and the writer is never called.
test("local-backend: POST /api/forest/write rejects a malformed payload (400) before any write", async () => {
  let called = false;
  const forestWrite: ForestWriter = {
    write: async () => {
      called = true;
      return { persisted: true, status: 201, body: {} };
    },
  };
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
    forestWrite,
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/forest/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "verdict", payload: { signer: "x" } }), // missing required fields
    });
    assert.equal(res.status, 400, "a malformed verdict is rejected with 400");
    assert.equal(called, false, "the writer is NOT called when the shape is invalid — no forged write");
  });
});

// Pins the presence retirement (ADR-0200 D7): `presence` is no longer a forest-write type — it is
// refused as unknown (400) and the writer is never called.
test("local-backend: POST /api/forest/write refuses type 'presence' as unknown (400) — presence writes are retired", async () => {
  let called = false;
  const forestWrite: ForestWriter = {
    write: async () => {
      called = true;
      return { persisted: true, status: 201, body: {} };
    },
  };
  const handler = createLocalBackend({
    storiesDir: NO_STORIES_DIR,
    docsDir: NO_DOCS_DIR,
    backend: stubBackend(),
    store: "json",
    forestWrite,
  });

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/forest/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "presence",
        payload: {
          sessionId: "s1",
          branch: "b1",
          workingOn: "x",
          startedAt: "2026-06-27T10:00:00.000Z",
          lastSeenAt: "2026-06-27T10:00:00.000Z",
        },
      }),
    });
    assert.equal(res.status, 400, "presence is an unknown forest-write type since ADR-0200 D7");
    assert.equal(called, false, "the writer is NOT called for the retired presence type");
  });
});

// Pins the PRODUCTION wiring end-to-end: createBrokerForestWriter POSTs the exact { type, payload }
// envelope to the broker over a REAL fetch and maps a 201 to persisted — no DB connector in the path.
test("local-backend: createBrokerForestWriter POSTs { type, payload } to the broker over real fetch (no DB connector)", async () => {
  const verdict = validVerdict();
  const received: { url: string | undefined; body: unknown }[] = [];

  const brokerDouble = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const raw = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
    received.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
    res.statusCode = 201;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, verdict }));
  };

  await withServer(brokerDouble, async (base) => {
    const writer = createBrokerForestWriter(base);
    const result = await writer.write({ type: "verdict", payload: verdict });

    assert.equal(result.persisted, true, "a 201 from the real broker means persisted");
    assert.equal(received.length, 1, "the broker received exactly one POST");
    const got = received[0];
    assert.ok(got, "the broker recorded the POST");
    assert.equal(got.url, "/api/write-broker", "POSTed to the write-broker endpoint");
    assert.deepEqual(
      got.body,
      { type: "verdict", payload: verdict },
      "the exact { type, payload } envelope crossed the wire",
    );
  });
});

// Static guard: the desktop write path imports no pg connector, no dissolved store, no studio server.
test("local-backend: the write path imports no pg connector and no studio server (brokered only)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "local-backend.ts"), "utf8");
  // Check IMPORT lines (static + dynamic) only — prose comments legitimately mention these names.
  const importLines = src
    .split(/\r?\n/)
    .filter((l) => /^\s*import\b/.test(l) || /import\(/.test(l))
    .join("\n");

  assert.ok(!/cloud-sql-connector/.test(importLines), "must not import the Cloud SQL connector");
  assert.ok(!/\bfrom\s+["']pg["']/.test(importLines), "must not import pg");
  assert.ok(!/@storytree\/store/.test(importLines), "must not import the dissolved @storytree/store");
  assert.ok(!/@storytree\/library\/store/.test(importLines), "must not import the library node-only pg store");
  assert.ok(!/studio\/server/.test(importLines), "must not import the studio server (surface boundary)");
  // PgWorkStore/PgBackend/PgPresenceStore can only be referenced via an import — scope the check to
  // import lines so prose comments (which legitimately name what we DON'T do) don't false-positive.
  assert.ok(
    !/PgWorkStore|PgBackend|PgPresenceStore/.test(importLines),
    "must not import a direct pg store into the desktop write path",
  );
});

// The process-lifetime hierarchy cache (ADR-0445 D2) and the seam that clears it.
//
// WHY THE SEAM EXISTS AT ALL, since a production process never calls it: `selectDesktopHierarchy`
// degrades live → CACHE → disk, and the studio has no cache (live → disk). A probe replaying a LIVE
// arm and then a DISK arm in one process would therefore compare the studio's disk walk against this
// surface's cache — two different reads, a divergence in neither. The `/api/tree` mirror row's
// `tree-mirror-probe.ts` resets between arms so each arm's comparison is the one it claims to be.
//
// PINNED HERE because the seam is otherwise proved by nothing this suite runs: the probe is spawned
// in its own process by a gate step, so `pnpm --filter desktop test` would stay green through a
// `resetHierarchyCache` that cleared nothing — and the failure it would cause is a mirror row
// reporting a divergence that is not one, which is the reading that teaches people to distrust a rung.
test("local-backend: resetHierarchyCache actually clears what the live read cached", async () => {
  const snapshot = {
    schemaVersion: 1,
    commitSha: "sha-live",
    storiesTreeSha: "tree-live",
    generatedAt: "2026-08-31T00:00:00.000Z",
    generator: "test",
    stories: [
      {
        id: "cached-story",
        title: "Cached story",
        outcome: "read from the live projection",
        status: "proposed" as const,
        proofMode: "UAT",
        uatWitness: null,
        dependsOn: [],
        consumedBy: [],
        decisions: [],
        building: false,
        capabilities: [],
        uatTestCriteria: [],
        reliabilityGates: [],
      },
    ],
    capabilities: [],
  };

  // Driven through the handler DIRECTLY rather than through `withServer`, unlike its neighbours in
  // this file. Three servers per call, in a test that calls it three times, is nine socket
  // lifecycles — and this file is in the mutation rung's witness set, where every STATIC mutant
  // re-runs it end to end. That turned assertion-kills into 60s timeouts under load, which the rung
  // scores UNPROVEN and reports as "no test named", reading exactly like a coverage gap it is not.
  const storyIdsFrom = async (live: boolean): Promise<string[]> => {
    const handler = createLocalBackend({
      storiesDir: NO_STORIES_DIR,
      docsDir: NO_DOCS_DIR,
      store: "json",
      // The live arm answers its proof read: a live hierarchy with a FAILED proof read is refused
      // (503) rather than painted, which is a different test's subject.
      backend: live
        ? { ...stubBackend(), workHierarchy: async () => snapshot, latestVerdicts: async () => ({}) }
        : stubBackend(),
    });
    // REAL node objects with only `end` swapped for a capture — the idiom the mirror probes use
    // (anti-slop-adoption-arc inc-03: no `as unknown as` fake claiming to be something it shares
    // nothing with). Nothing writes to the socket; the route ends synchronously.
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/api/tree";
    let raw = "";
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    res.end = ((chunk?: unknown): ServerResponse => {
      raw = typeof chunk === "string" ? chunk : "";
      return res;
    }) as ServerResponse["end"];
    await handler(req, res);
    return (JSON.parse(raw) as { stories: { id: string }[] }).stories.map((story) => story.id);
  };

  // 1. A live read populates the module-scoped cache.
  assert.deepEqual(await storyIdsFrom(true), ["cached-story"], "the live projection is served");

  // 2. With NO live seam and an empty stories dir, the cache is what answers — this is the state
  //    that would silently corrupt a probe's disk arm, so it is asserted rather than assumed.
  assert.deepEqual(
    await storyIdsFrom(false),
    ["cached-story"],
    "without a reset, a degraded read is served from the cache, not from disk",
  );

  // 3. After the reset it falls all the way through to disk, which here is empty.
  resetHierarchyCache();
  assert.deepEqual(
    await storyIdsFrom(false),
    [],
    "after the reset the degraded read reaches disk — the cache is genuinely gone",
  );
});

// The studio's rule, re-composed (apiRouter.ts `buildTreePayload`): when the LIVE store served the
// hierarchy, a null proof read is a FAILED read, and folding it would paint every island its
// authored status as if current — the 2026-09-24 all-`proposed` studio map. Re-read once, then refuse
// with 503. The `tree-live-proof-unread` conformance arm holds the two surfaces to the same answer;
// these pin the re-read, which that arm (both reads fail twice) cannot distinguish from no re-read.
test("local-backend: /api/tree refuses a proof-less map when the live store served the hierarchy", async () => {
  const snapshot = {
    schemaVersion: 1,
    commitSha: "sha-live",
    storiesTreeSha: "tree-live",
    generatedAt: "2026-09-24T00:00:00.000Z",
    generator: "test",
    stories: [
      {
        id: "live-story",
        title: "Live story",
        outcome: "read from the live projection",
        status: "proposed" as const,
        proofMode: "UAT",
        uatWitness: null,
        dependsOn: [],
        consumedBy: [],
        decisions: [],
        building: false,
        capabilities: [],
        uatTestCriteria: [],
        reliabilityGates: [],
      },
    ],
    capabilities: [],
  };

  const treeWith = async (
    verdicts: (Record<string, never> | null)[],
    events: (unknown[] | null)[],
  ): Promise<{ status: number; body: { error?: string; stories?: unknown[] }; calls: number[] }> => {
    const calls = [0, 0];
    const handler = createLocalBackend({
      storiesDir: NO_STORIES_DIR,
      docsDir: NO_DOCS_DIR,
      store: "json",
      backend: {
        ...stubBackend(),
        workHierarchy: async () => snapshot,
        latestVerdicts: async () => verdicts[calls[0]!++] ?? null,
        verdictEvents: async () => events[calls[1]!++] ?? null,
      },
    });
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/api/tree";
    let raw = "";
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    res.end = ((chunk?: unknown): ServerResponse => {
      raw = typeof chunk === "string" ? chunk : "";
      return res;
    }) as ServerResponse["end"];
    await handler(req, res);
    resetHierarchyCache();
    return { status: res.statusCode, body: JSON.parse(raw) as { error?: string; stories?: unknown[] }, calls };
  };

  const refused = await treeWith([null, null], [null, null]);
  assert.equal(refused.status, 503, "both proof reads failing twice is refused, not painted");
  assert.match(refused.body.error ?? "", /signed verdicts could not be read/);
  assert.deepEqual(refused.calls, [2, 2], "the proof is re-read exactly once before refusing");

  const halfProven = await treeWith([{}, {}], [null, null]);
  assert.equal(halfProven.status, 503, "a failed event stream alone is refused too");

  const mapless = await treeWith([null, null], [[], []]);
  assert.equal(mapless.status, 503, "a failed verdict map alone is refused too");

  const recovered = await treeWith([null, {}], [null, []]);
  assert.equal(recovered.status, 200, "a re-read that answers serves the map");
  assert.equal(recovered.body.stories?.length, 1);
  assert.deepEqual(recovered.calls, [2, 2]);

  const firstTime = await treeWith([{}], [[]]);
  assert.equal(firstTime.status, 200);
  assert.deepEqual(firstTime.calls, [1, 1], "a proof that answers first time is read once");
});
