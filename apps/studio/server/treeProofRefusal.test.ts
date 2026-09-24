// `/api/tree` must not paint a proof-less map as current when the live store answered.
//
// On 2026-09-24 every island on the studio map read `proposed`: the two proof reads (`latestVerdicts`,
// `verdictEvents`) are advisory, null on ANY failure, and a timed-out read was folded exactly like a
// store that holds no verdicts — every island fell back to its authored status. The trigger that day
// was a CPU-stalled event loop (fixed in the roll-ups, #2084), but any failed read did the same.
// These tests pin the route's answer to that state: re-read once, and refuse if the proof still
// cannot be read. The DB-down path (hierarchy from disk) keeps its advisory behaviour.

import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildTreePayload, TREE_PROOF_UNREAD } from './apiRouter';
import { HttpError } from './httpUtil';
import type { LibraryBackend } from './libraryBackend';

const snapshot = {
  schemaVersion: 1,
  commitSha: 'fe'.repeat(20),
  storiesTreeSha: 'ab'.repeat(20),
  generatedAt: '2026-09-24T00:00:00.000Z',
  generator: 'treeProofRefusal.test fixture',
  stories: [
    {
      id: 'alpha',
      title: 'Alpha',
      outcome: 'the alpha outcome',
      status: 'proposed',
      proofMode: 'UAT',
      uatWitness: 'human',
      dependsOn: [],
      consumedBy: [],
      decisions: [],
      building: false,
      capabilities: ['cap-a'],
      uatTestCriteria: [],
      reliabilityGates: [],
    },
  ],
  capabilities: [
    {
      id: 'cap-a',
      storyId: 'alpha',
      title: 'Capability A',
      outcome: 'the cap-a outcome',
      status: 'proposed',
      proofMode: 'integration-test',
      dependsOn: [],
      contractCount: 0,
    },
  ],
};

const PASS = { outcome: 'pass' as const, at: '2026-09-24T00:00:00.000Z' };

type Reads = {
  verdicts: (Record<string, typeof PASS> | null)[];
  events: (unknown[] | null)[];
};

/** A backend whose proof reads answer from a queue, one entry per call, so a test scripts a failed
 * first read and a recovered second one. `live: false` omits the projection seam (the disk path). */
function backend(reads: Reads, live = true) {
  const calls = { verdicts: 0, events: 0 };
  const b: Partial<LibraryBackend> = {
    latestVerdicts: async () => reads.verdicts[calls.verdicts++] ?? null,
    verdictEvents: async () => (reads.events[calls.events++] ?? null) as never,
    inFlightBuilds: async () => null,
  };
  if (live) b.workHierarchy = async () => snapshot as never;
  return { b: b as LibraryBackend, calls };
}

async function tree(b: LibraryBackend) {
  const storiesDir = await mkdtemp(path.join(tmpdir(), 'tree-proof-'));
  return buildTreePayload({ paths: { storiesDir } as never, backend: b });
}

describe('the map never paints a proof-less tree as current when the live store answered', () => {
  it('refuses with 503 when both proof reads fail twice — the 2026-09-24 all-proposed payload', async () => {
    const { b, calls } = backend({ verdicts: [null, null], events: [null, null] });
    const err = await tree(b).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect((err as HttpError).message).toBe(TREE_PROOF_UNREAD);
    expect(calls).toEqual({ verdicts: 2, events: 2 });
  });

  it('refuses when only the event stream fails — a half-proven map is as false as a bare one', async () => {
    const { b } = backend({ verdicts: [{ 'cap-a': PASS }, { 'cap-a': PASS }], events: [null, null] });
    await expect(tree(b)).rejects.toMatchObject({ status: 503 });
  });

  it('refuses when only the verdict map fails', async () => {
    const { b } = backend({ verdicts: [null, null], events: [[], []] });
    await expect(tree(b)).rejects.toMatchObject({ status: 503 });
  });

  it('re-reads once and serves the proof when the second read answers', async () => {
    const { b, calls } = backend({ verdicts: [null, { 'cap-a': PASS }], events: [null, []] });
    const payload = await tree(b);
    expect(payload.stories[0]?.capabilities[0]?.verdict).toEqual(PASS);
    expect(calls).toEqual({ verdicts: 2, events: 2 });
  });

  it('reads the proof once when it answers first time', async () => {
    const { b, calls } = backend({ verdicts: [{ 'cap-a': PASS }], events: [[]] });
    const payload = await tree(b);
    expect(payload.stories[0]?.capabilities[0]?.verdict).toEqual(PASS);
    expect(calls).toEqual({ verdicts: 1, events: 1 });
  });

  it('keeps the advisory under-claim when the hierarchy itself came from disk (the store is down)', async () => {
    const { b, calls } = backend({ verdicts: [null], events: [null] }, false);
    const payload = await tree(b);
    expect(payload.stories).toEqual([]);
    expect(calls).toEqual({ verdicts: 1, events: 1 });
  });
});
