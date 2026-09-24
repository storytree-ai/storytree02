import { centerOn, fitWorld, type Camera, type CameraFrame, type ScaleLimits } from './worldCamera.js';

export type ForestCaptureTarget =
  | { kind: 'square'; x: number; y: number; size: number }
  | { kind: 'story-node'; id: string }
  | { kind: 'island'; id: string }
  | { kind: 'resting' }
  | { kind: 'fit' };

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
}

function validFrame(frame: CameraFrame): boolean {
  return Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.width > 0 && frame.height > 0;
}

function receipt(
  kind: ForestCaptureTarget['kind'],
  frame: CameraFrame,
  camera: Camera,
  resolved?: ForestCaptureReceipt['resolved'],
): ForestCaptureReceipt {
  // A receipt names the committed SVG camera, whose public shape is deliberately just its transform.
  // `groundWorldY` is fit-internal metadata for the Act 2 animation, not part of a capture result.
  const applied = { tx: camera.tx, ty: camera.ty, scale: camera.scale };
  return resolved ? { ok: true, kind, frame, camera: applied, resolved } : { ok: true, kind, frame, camera: applied };
}

/** Resolve a named forest subject to the same camera math used by the mounted map. */
export function resolveForestCaptureCamera(input: ForestCaptureCameraInput): ForestCaptureResult {
  const { target, frame, world, limits, storyNodeScale, resting, fit } = input;
  if (!validFrame(frame)) return { ok: false, code: 'invalid-frame' };
  if (!world) return { ok: false, code: 'world-unavailable' };

  if (target.kind === 'resting') return receipt(target.kind, frame, resting);
  if (target.kind === 'fit') return receipt(target.kind, frame, fit);

  if (target.kind === 'square') {
    if (![target.x, target.y, target.size].every(Number.isFinite) || target.size <= 0) {
      return { ok: false, code: 'invalid-target' };
    }
    const scale = Math.min(frame.width / target.size, frame.height / target.size);
    return receipt(
      target.kind,
      frame,
      centerOn(target.x + target.size / 2, target.y + target.size / 2, frame.width, frame.height, scale, limits),
      { bounds: { x: target.x, y: target.y, width: target.size, height: target.size } },
    );
  }

  const territory = world.territories.find((candidate) =>
    target.kind === 'story-node' ? candidate.storyId === target.id : candidate.islandId === target.id,
  );
  if (!territory) return { ok: false, code: 'target-not-found' };

  if (target.kind === 'story-node') {
    return receipt(
      target.kind,
      frame,
      centerOn(territory.x, territory.y, frame.width, frame.height, storyNodeScale, limits),
      { id: target.id },
    );
  }

  if (!Number.isFinite(territory.radius) || territory.radius <= 0) return { ok: false, code: 'invalid-target' };
  const diameter = territory.radius * 2;
  const subjectFit = fitWorld(diameter, diameter, frame.width, frame.height, { fit: 'contain', align: 'center' });
  const camera = centerOn(
    territory.x,
    territory.y,
    frame.width,
    frame.height,
    subjectFit.scale,
    limits,
  );
  return receipt(target.kind, frame, camera, {
    id: target.id,
    bounds: { x: territory.x - territory.radius, y: territory.y - territory.radius, width: diameter, height: diameter },
  });
}
