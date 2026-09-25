import { describe, expect, it } from 'vitest';
import {
  resolveForestCaptureCamera,
  type ForestCaptureCameraInput,
  type ForestCaptureTarget,
  type ForestCaptureWorld,
} from './forestCaptureCamera.js';
import { centerOn, fitWorld, restingWorld, worldToScreen, type CameraFrame } from './worldCamera.js';

const frame: CameraFrame = { width: 300, height: 200 };
const limits = { min: 0.25, max: 4 };
const resting = { tx: 11, ty: 22, scale: 0.75 };
const fit = { tx: 33, ty: 44, scale: 0.5 };

// The real layout carries both identities. They deliberately differ here so a story-node lookup
// cannot accidentally stand in for island resolution.
const world = {
  territories: [
    { storyId: 'story-alpha', islandId: 'island-cedar', x: 40, y: 60, radius: 20 },
    { storyId: 'story-bravo', islandId: 'island-pine', x: 210, y: 120, radius: 35 },
  ],
} satisfies ForestCaptureWorld;

function resolve(target: ForestCaptureTarget, overrides: Partial<ForestCaptureCameraInput> = {}) {
  return resolveForestCaptureCamera({
    target,
    frame,
    world,
    limits,
    storyNodeScale: 7,
    resting,
    fit,
    ...overrides,
  });
}

type CapturePadding = { top: number; right: number; bottom: number; left: number };
type PaddedCaptureInput = ForestCaptureCameraInput & { captureFrame?: CapturePadding };
type PaddedReceipt = {
  padding: CapturePadding;
  usableFrame: { x: number; y: number; width: number; height: number };
};

const asymmetricPadding: CapturePadding = { top: 17, right: 43, bottom: 29, left: 61 };
const usableFrame = {
  x: asymmetricPadding.left,
  y: asymmetricPadding.top,
  width: frame.width - asymmetricPadding.left - asymmetricPadding.right,
  height: frame.height - asymmetricPadding.top - asymmetricPadding.bottom,
};

function resolveWithPadding(
  target: ForestCaptureTarget,
  captureFrame?: CapturePadding,
  overrides: Partial<ForestCaptureCameraInput> = {},
) {
  return resolveForestCaptureCamera({
    target,
    frame,
    world,
    limits,
    storyNodeScale: 1,
    resting,
    fit,
    ...(captureFrame === undefined ? {} : { captureFrame }),
    ...overrides,
  } as PaddedCaptureInput);
}

function paddedCamera(worldX: number, worldY: number, scale: number) {
  const camera = centerOn(worldX, worldY, usableFrame.width, usableFrame.height, scale, limits);
  return { ...camera, tx: camera.tx + usableFrame.x, ty: camera.ty + usableFrame.y };
}

function expectPaddedReceipt(result: ReturnType<typeof resolveWithPadding>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected padded receipt, received ${result.code}`);
  expect(result as typeof result & PaddedReceipt).toMatchObject({
    frame,
    padding: asymmetricPadding,
    usableFrame,
  });
  return result as typeof result & PaddedReceipt;
}

describe('fccs-square-is-contained-and-centred: finite positive world squares', () => {
  it('uses the width-limited scale, centres the square, and contains its projected corners', () => {
    const portraitFrame = { width: 200, height: 300 };
    const result = resolve({ kind: 'square', x: 10, y: 40, size: 200 }, { frame: portraitFrame });
    expect(result).toEqual({
      ok: true,
      kind: 'square',
      frame: portraitFrame,
      camera: centerOn(110, 140, portraitFrame.width, portraitFrame.height, 1, limits),
      resolved: { bounds: { x: 10, y: 40, width: 200, height: 200 } },
    });
    if (!result.ok) return;
    const topLeft = worldToScreen(result.camera, 10, 40);
    const bottomRight = worldToScreen(result.camera, 210, 240);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(portraitFrame.width);
    expect(bottomRight.y).toBeLessThanOrEqual(portraitFrame.height);
  });

  it('uses the height-limited scale and refuses every malformed square field', () => {
    expect(resolve({ kind: 'square', x: 10, y: 20, size: 200 })).toMatchObject({
      ok: true,
      camera: centerOn(110, 120, frame.width, frame.height, 1, limits),
    });
    for (const target of [
      { kind: 'square', x: Number.NaN, y: 1, size: 1 },
      { kind: 'square', x: 1, y: Number.POSITIVE_INFINITY, size: 1 },
      { kind: 'square', x: 1, y: 1, size: Number.NEGATIVE_INFINITY },
      { kind: 'square', x: 1, y: 1, size: 0 },
      { kind: 'square', x: 1, y: 1, size: -1 },
    ] as ForestCaptureTarget[]) {
      expect(resolve(target)).toEqual({ ok: false, code: 'invalid-target' });
    }
  });
});

describe('fccs-story-node-and-island-resolve-separately: real layout geometry', () => {
  it('centres a story node at the configured scale after applying the camera clamp', () => {
    expect(resolve({ kind: 'story-node', id: 'story-alpha' })).toEqual({
      ok: true,
      kind: 'story-node',
      frame,
      camera: centerOn(40, 60, frame.width, frame.height, 7, limits),
      resolved: { id: 'story-alpha' },
    });
  });

  it('resolves an island by its island id and fits its diameter as a contained subject', () => {
    const diameter = 40;
    const subjectFit = fitWorld(diameter, diameter, frame.width, frame.height, { fit: 'contain', align: 'center' });
    expect(resolve({ kind: 'island', id: 'island-cedar' })).toEqual({
      ok: true,
      kind: 'island',
      frame,
      camera: centerOn(40, 60, frame.width, frame.height, subjectFit.scale, limits),
      resolved: { id: 'island-cedar', bounds: { x: 20, y: 40, width: diameter, height: diameter } },
    });
    expect(resolve({ kind: 'story-node', id: 'missing' })).toEqual({ ok: false, code: 'target-not-found' });
    expect(resolve({ kind: 'island', id: 'missing' })).toEqual({ ok: false, code: 'target-not-found' });
    expect(resolve({ kind: 'island', id: 'island-cedar' }, {
      world: { territories: [{ storyId: 'story-alpha', islandId: 'island-cedar', x: 40, y: 60, radius: 0 }] } satisfies ForestCaptureWorld,
    })).toEqual({ ok: false, code: 'invalid-target' });

    const pineDiameter = 70;
    const pineFit = fitWorld(pineDiameter, pineDiameter, frame.width, frame.height, { fit: 'contain' });
    expect(resolve({ kind: 'island', id: 'island-pine' })).toMatchObject({
      ok: true,
      camera: centerOn(210, 120, frame.width, frame.height, pineFit.scale, limits),
    });
  });
});

describe('fccs-named-views-reuse-canonical-camera-policy: resting and fit', () => {
  it('returns the supplied canonical resting and contain-fit cameras exactly', () => {
    expect(resolve({ kind: 'resting' })).toEqual({ ok: true, kind: 'resting', frame, camera: resting });
    expect(resolve({ kind: 'fit' })).toEqual({ ok: true, kind: 'fit', frame, camera: fit });
    expect(restingWorld(400, 800, frame.width, frame.height, [40])).not.toEqual(fitWorld(400, 800, frame.width, frame.height, { fit: 'contain' }));
  });
});

describe('fccs-refusal-preserves-the-current-camera: invalid input', () => {
  it('refuses invalid frames before reading the world and keeps no mutable camera state', () => {
    for (const invalidFrame of [
      { width: 0, height: 20 }, { width: -1, height: 20 }, { width: Number.NaN, height: 20 },
      { width: 20, height: 0 }, { width: 20, height: -1 }, { width: 20, height: Number.POSITIVE_INFINITY },
    ]) {
      expect(resolve({ kind: 'square', x: 0, y: 0, size: 1 }, { frame: invalidFrame, world: null })).toEqual({ ok: false, code: 'invalid-frame' });
    }
    expect(resolve({ kind: 'square', x: 0, y: 0, size: 1 }, { world: null })).toEqual({ ok: false, code: 'world-unavailable' });
  });
});

describe('fccs-live-seam-returns-the-applied-camera-and-cleans-up: resolver receipts', () => {
  it('returns only the applied transform, not fit-internal camera metadata', () => {
    const result = resolve({ kind: 'fit' }, { fit: { ...fit, groundWorldY: 900 } });
    expect(result).toEqual({ ok: true, kind: 'fit', frame, camera: fit });
  });
});

describe('fccp-validates-four-sided-css-pixel-padding: explicit capture frames', () => {
  it('accepts omitted and zero padding as the existing frame, but refuses every invalid side before resolving a target', () => {
    const baseline = resolve({ kind: 'square', x: 10, y: 20, size: 50 });
    const omitted = resolveWithPadding({ kind: 'square', x: 10, y: 20, size: 50 });
    expect(omitted).toMatchObject(baseline);
    const zero = resolveWithPadding({ kind: 'square', x: 10, y: 20, size: 50 }, {
      top: 0, right: 0, bottom: 0, left: 0,
    });
    expect(zero).toMatchObject(baseline);
    if (zero.ok) expect(zero as typeof zero & PaddedReceipt).toMatchObject({
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      usableFrame: { x: 0, y: 0, width: frame.width, height: frame.height },
    });

    for (const captureFrame of [
      { ...asymmetricPadding, top: -1 },
      { ...asymmetricPadding, right: Number.POSITIVE_INFINITY },
      { ...asymmetricPadding, bottom: Number.NaN },
      { ...asymmetricPadding, left: Number.NEGATIVE_INFINITY },
    ]) {
      expect(resolveWithPadding({ kind: 'story-node', id: 'missing' }, captureFrame)).toEqual({
        ok: false,
        code: 'invalid-frame',
      });
    }
  });
});

describe('fccp-square-and-island-stay-within-the-usable-rectangle: asymmetric fitting', () => {
  it('contains both fitted subjects inside all four padded edges', () => {
    const square = expectPaddedReceipt(resolveWithPadding(
      { kind: 'square', x: 10, y: 20, size: 120 },
      asymmetricPadding,
    ));
    expect(square.camera).toEqual(paddedCamera(70, 80, Math.min(usableFrame.width / 120, usableFrame.height / 120)));
    for (const point of [worldToScreen(square.camera, 10, 20), worldToScreen(square.camera, 130, 140)]) {
      expect(point.x).toBeGreaterThanOrEqual(usableFrame.x - 1e-10);
      expect(point.x).toBeLessThanOrEqual(usableFrame.x + usableFrame.width + 1e-10);
      expect(point.y).toBeGreaterThanOrEqual(usableFrame.y - 1e-10);
      expect(point.y).toBeLessThanOrEqual(usableFrame.y + usableFrame.height + 1e-10);
    }

    const island = expectPaddedReceipt(resolveWithPadding({ kind: 'island', id: 'island-pine' }, asymmetricPadding));
    const islandScale = Math.min(usableFrame.width / 70, usableFrame.height / 70);
    expect(island.camera).toEqual(paddedCamera(210, 120, islandScale));
    for (const point of [worldToScreen(island.camera, 175, 85), worldToScreen(island.camera, 245, 155)]) {
      expect(point.x).toBeGreaterThanOrEqual(usableFrame.x - 1e-10);
      expect(point.x).toBeLessThanOrEqual(usableFrame.x + usableFrame.width + 1e-10);
      expect(point.y).toBeGreaterThanOrEqual(usableFrame.y - 1e-10);
      expect(point.y).toBeLessThanOrEqual(usableFrame.y + usableFrame.height + 1e-10);
    }
  });
});

describe('fccp-named-centres-use-the-asymmetric-usable-centre: story-node capture', () => {
  it('places the named territory at the usable rectangle centre rather than the raw viewport centre', () => {
    const result = expectPaddedReceipt(resolveWithPadding(
      { kind: 'story-node', id: 'story-alpha' },
      asymmetricPadding,
    ));
    expect(result.camera).toEqual(paddedCamera(40, 60, 1));
    expect(worldToScreen(result.camera, 40, 60)).toEqual({
      x: usableFrame.x + usableFrame.width / 2,
      y: usableFrame.y + usableFrame.height / 2,
    });
  });
});

describe('fccp-live-seam-returns-the-padded-applied-camera: padded receipts', () => {
  it('keeps the outer viewport, reports the requested and usable frames, and applies the same usable dimensions to resting and fit', () => {
    const paddedResting = { tx: 101, ty: 102, scale: 0.4 };
    const paddedFit = { tx: 201, ty: 202, scale: 0.3 };
    for (const target of [{ kind: 'resting' } as const, { kind: 'fit' } as const]) {
      const result = expectPaddedReceipt(resolveWithPadding(target, asymmetricPadding, { resting: paddedResting, fit: paddedFit }));
      const camera = target.kind === 'resting' ? paddedResting : paddedFit;
      expect(result.camera).toEqual(camera);
      expect(result.frame).toEqual(frame);
      expect(result.usableFrame).toEqual(usableFrame);
    }
  });
});

describe('fccp-padding-refusal-preserves-the-current-camera: impossible capture frames', () => {
  it('refuses exhausted width or height rather than returning a camera for a false usable frame', () => {
    for (const captureFrame of [
      { top: 0, right: frame.width, bottom: 0, left: 0 },
      { top: frame.height, right: 0, bottom: 0, left: 0 },
    ]) {
      expect(resolveWithPadding({ kind: 'square', x: 10, y: 20, size: 30 }, captureFrame)).toEqual({
        ok: false,
        code: 'invalid-frame',
      });
    }
  });
});
