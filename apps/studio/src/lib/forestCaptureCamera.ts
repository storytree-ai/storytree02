import { centerOn, fitWorld, type Camera, type CameraFrame, type ScaleLimits } from './worldCamera.js';

export type ForestCaptureTarget =
  | { kind: 'square'; x: number; y: number; size: number }
  | { kind: 'story-node'; id: string }
  | { kind: 'island'; id: string }
  | { kind: 'resting' }
  | { kind: 'fit' };

export interface ForestCapturePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ForestCaptureUsableFrame extends CameraFrame {
  x: number;
  y: number;
}

export type ForestCaptureRefusal = {
  ok: false;
  code: 'invalid-target' | 'target-not-found' | 'invalid-frame' | 'world-unavailable';
};

export type ForestCaptureReceipt = {
  ok: true;
  kind: ForestCaptureTarget['kind'];
  frame: CameraFrame;
  camera: Camera;
  resolved?: { id?: string; bounds?: { x: number; y: number; width: number; height: number } };
  /** Present when the caller explicitly requested a capture inset. */
  padding?: ForestCapturePadding;
  /** The camera's coordinate frame after applying {@link padding}. */
  usableFrame?: ForestCaptureUsableFrame;
};

export type ForestCaptureResult = ForestCaptureReceipt | ForestCaptureRefusal;

export interface ForestCaptureTerritory {
  storyId: string;
  islandId: string;
  x: number;
  y: number;
  radius: number;
}

export interface ForestCaptureWorld {
  territories: readonly ForestCaptureTerritory[];
}

export interface ForestCaptureCameraInput {
  target: ForestCaptureTarget;
  frame: CameraFrame;
  world: ForestCaptureWorld | null;
  limits: ScaleLimits;
  storyNodeScale: number;
  resting: Camera;
  fit: Camera;
  /** Explicit CSS-pixel inset reserved inside the outer map viewport. */
  captureFrame?: ForestCapturePadding;
}

function validFrame(frame: CameraFrame): boolean {
  return Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.width > 0 && frame.height > 0;
}

function receipt(
  kind: ForestCaptureTarget['kind'],
  frame: CameraFrame,
  camera: Camera,
  resolved?: ForestCaptureReceipt['resolved'],
  padding?: ForestCapturePadding,
  usableFrame?: ForestCaptureUsableFrame,
): ForestCaptureReceipt {
  // A receipt names the committed SVG camera, whose public shape is deliberately just its transform.
  // `groundWorldY` is fit-internal metadata for the Act 2 animation, not part of a capture result.
  const applied = { tx: camera.tx, ty: camera.ty, scale: camera.scale };
  const result: ForestCaptureReceipt = resolved
    ? { ok: true, kind, frame, camera: applied, resolved }
    : { ok: true, kind, frame, camera: applied };
  // Stryker disable next-line LogicalOperator: EQUIVALENT — this private helper receives both inset values together or neither.
  return padding && usableFrame ? { ...result, padding, usableFrame } : result;
}

function usableFrame(frame: CameraFrame, padding: ForestCapturePadding | undefined): ForestCaptureUsableFrame | null {
  if (!padding) return { x: 0, y: 0, width: frame.width, height: frame.height };
  if (![padding.top, padding.right, padding.bottom, padding.left].every((side) => Number.isFinite(side) && side >= 0)) {
    return null;
  }
  const width = frame.width - padding.left - padding.right;
  const height = frame.height - padding.top - padding.bottom;
  return width > 0 && height > 0 ? { x: padding.left, y: padding.top, width, height } : null;
}

function insideUsableFrame(camera: Camera, frame: ForestCaptureUsableFrame): Camera {
  return { tx: camera.tx + frame.x, ty: camera.ty + frame.y, scale: camera.scale };
}

/** Resolve a named forest subject to the same camera math used by the mounted map. */
export function resolveForestCaptureCamera(input: ForestCaptureCameraInput): ForestCaptureResult {
  const { target, frame, world, limits, storyNodeScale, resting, fit, captureFrame } = input;
  if (!validFrame(frame)) return { ok: false, code: 'invalid-frame' };
  const usable = usableFrame(frame, captureFrame);
  if (!usable) return { ok: false, code: 'invalid-frame' };
  if (!world) return { ok: false, code: 'world-unavailable' };

  const paddedReceipt = (kind: ForestCaptureTarget['kind'], camera: Camera, resolved?: ForestCaptureReceipt['resolved']) =>
    receipt(kind, frame, camera, resolved, captureFrame, captureFrame ? usable : undefined);

  if (target.kind === 'resting') return paddedReceipt(target.kind, resting);
  if (target.kind === 'fit') return paddedReceipt(target.kind, fit);

  if (target.kind === 'square') {
    if (![target.x, target.y, target.size].every(Number.isFinite) || target.size <= 0) {
      return { ok: false, code: 'invalid-target' };
    }
    const scale = Math.min(usable.width / target.size, usable.height / target.size);
    return paddedReceipt(
      target.kind,
      insideUsableFrame(centerOn(target.x + target.size / 2, target.y + target.size / 2, usable.width, usable.height, scale, limits), usable),
      { bounds: { x: target.x, y: target.y, width: target.size, height: target.size } },
    );
  }

  const territory = world.territories.find((candidate) =>
    target.kind === 'story-node' ? candidate.storyId === target.id : candidate.islandId === target.id,
  );
  if (!territory) return { ok: false, code: 'target-not-found' };

  if (target.kind === 'story-node') {
    return paddedReceipt(
      target.kind,
      insideUsableFrame(centerOn(territory.x, territory.y, usable.width, usable.height, storyNodeScale, limits), usable),
      { id: target.id },
    );
  }

  if (!Number.isFinite(territory.radius) || territory.radius <= 0) return { ok: false, code: 'invalid-target' };
  const diameter = territory.radius * 2;
  // Only the fitted scale is consumed below; vertical alignment cannot affect that value. Omitting
  // an alignment option keeps this call honest and avoids an equivalent mutation with no observable
  // camera consequence.
  const subjectFit = fitWorld(diameter, diameter, usable.width, usable.height, { fit: 'contain' });
  const camera = insideUsableFrame(centerOn(
    territory.x,
    territory.y,
    usable.width,
    usable.height,
    subjectFit.scale,
    limits,
  ), usable);
  return paddedReceipt(target.kind, camera, {
    id: target.id,
    bounds: { x: territory.x - territory.radius, y: territory.y - territory.radius, width: diameter, height: diameter },
  });
}
