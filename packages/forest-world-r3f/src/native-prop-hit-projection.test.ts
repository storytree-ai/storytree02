import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groundFlattening, uprightForeshortening } from '@storytree/forest-world';

import { projectNativePropHitEnvelope } from './native-prop-hit-projection.js';

const ELEVATION_DEG = 37;
const GROUND = groundFlattening(ELEVATION_DEG);
const UPRIGHT = uprightForeshortening(ELEVATION_DEG);

const records = [
  Object.freeze({
    storyId: 'story-tree',
    capabilityId: 'cap-tree',
    status: 'healthy',
    root: Object.freeze({ x: 113, z: -47 }),
    relief: 9,
    footprint: 16,
    height: 31,
  }),
  Object.freeze({
    storyId: 'story-dead',
    capabilityId: 'cap-dead-tree',
    status: 'unhealthy',
    root: Object.freeze({ x: -29, z: 71 }),
    relief: -4,
    footprint: 24,
    height: 18,
  }),
  Object.freeze({
    storyId: 'story-flora',
    capabilityId: 'cap-coverage',
    status: 'building',
    root: Object.freeze({ x: 43, z: 19 }),
    relief: 6,
    footprint: 10,
    height: 14,
  }),
  Object.freeze({
    storyId: 'story-meadow',
    capabilityId: 'cap-low-wide-coverage',
    status: 'healthy',
    root: Object.freeze({ x: 5, z: 12 }),
    relief: 2,
    footprint: 30,
    height: 1,
  }),
] as const;

test('native-prop-hit-projection-preserves-native-semantic-records-in-drawing-world: tree, dead-tree, and coverage-flora records retain attribution while their roots, crowns, and bounds use the supplied elevation', () => {
  for (const record of records) {
    const envelope = projectNativePropHitEnvelope(record, ELEVATION_DEG);
    const root = { x: record.root.x, y: record.root.z * GROUND - record.relief * UPRIGHT };
    const crown = { x: record.root.x, y: root.y - record.height * UPRIGHT };
    const halfPlanSpan = (Math.SQRT2 * record.footprint) / 2;

    assert.deepEqual(envelope, {
      storyId: record.storyId,
      capabilityId: record.capabilityId,
      status: record.status,
      root,
      crown,
      bounds: {
        minX: root.x - halfPlanSpan,
        maxX: root.x + halfPlanSpan,
        minY: Math.min(crown.y, root.y - halfPlanSpan * GROUND),
        maxY: Math.max(root.y, root.y + halfPlanSpan * GROUND),
      },
    });
    assert.ok(Object.isFrozen(envelope), `${record.capabilityId}: envelope is immutable`);
    assert.ok(Object.isFrozen(envelope.root), `${record.capabilityId}: projected root is immutable`);
    assert.ok(Object.isFrozen(envelope.crown), `${record.capabilityId}: projected crown is immutable`);
    assert.ok(Object.isFrozen(envelope.bounds), `${record.capabilityId}: projected bounds are immutable`);
  }
});

// test-updated (refactor): native-prop-hit-projection-encloses-full-width-native-props-at-any-yaw compares derived floating-point spans within rounding tolerance, because subtracting rounded absolute bounds cannot be bit-identical to the original span expression.
test('native-prop-hit-projection-encloses-full-width-native-props-at-any-yaw: a sqrt(2) full-plan span contains all four corners of each full-width native box at 45 degrees', () => {
  for (const record of records) {
    const { root, bounds } = projectNativePropHitEnvelope(record, ELEVATION_DEG);
    const halfSide = record.footprint / 2;
    const cos45 = Math.cos(Math.PI / 4);
    const sin45 = Math.sin(Math.PI / 4);

    for (const xSign of [-1, 1] as const) {
      for (const zSign of [-1, 1] as const) {
        const x = record.root.x + xSign * halfSide * cos45 - zSign * halfSide * sin45;
        const z = record.root.z + xSign * halfSide * sin45 + zSign * halfSide * cos45;
        const corner = {
          x,
          y: z * GROUND - record.relief * UPRIGHT,
        };

        assert.ok(corner.x >= bounds.minX && corner.x <= bounds.maxX, `${record.capabilityId}: 45-degree corner x lies inside the full-width envelope`);
        assert.ok(corner.y >= bounds.minY && corner.y <= bounds.maxY, `${record.capabilityId}: 45-degree corner y lies inside the full-width envelope`);
      }
    }
    const expectedPlanSpan = Math.SQRT2 * record.footprint;
    const expectedGroundHalfSpan = (expectedPlanSpan * GROUND) / 2;
    const tolerance = Number.EPSILON * Math.max(1, expectedPlanSpan, expectedGroundHalfSpan) * 8;

    assert.ok(
      Math.abs((bounds.maxX - bounds.minX) - expectedPlanSpan) <= tolerance,
      `${record.capabilityId}: width is a full yaw-safe plan span, not a radius`,
    );
    assert.ok(
      Math.abs((bounds.maxY - root.y) - expectedGroundHalfSpan) <= tolerance,
      `${record.capabilityId}: ground depth is projected once`,
    );
  }
});

test('native-prop-hit-projection-keeps-records-and-host-transforms-single-source: projection neither mutates the supplied semantic record nor emits a second offset or host transform', () => {
  const record = records[0];
  const before = structuredClone(record);
  const rootBefore = record.root;
  const envelope = projectNativePropHitEnvelope(record, ELEVATION_DEG);

  assert.deepEqual(record, before);
  assert.equal(record.root, rootBefore, 'the record keeps its original nested root identity');
  assert.equal(envelope.root.x, record.root.x, 'the absolute native x root is not offset again');
  assert.equal(envelope.root.y, record.root.z * GROUND - record.relief * UPRIGHT, 'the absolute native z root is projected exactly once');
  assert.equal('worldOffset' in envelope, false, 'projection accepts no second world-offset result');
  assert.equal('camera' in envelope, false, 'projection creates no camera result');
  assert.equal('transform' in envelope, false, 'projection emits drawing coordinates rather than a host transform');
});
