// landViewStatus.ts — what the mounted 3D map TELLS a member while it is not simply drawn.
//
// ADR-0608 D5 (owner, verbatim): "If other browsers can't run because they not using a modern stack
// then i'm happy just to show an error message." So there is no fallback map; there IS a message,
// and a silent blank is the one outcome that is not acceptable. Every state the mount can be in
// resolves here to exactly one of: loading, ready (say nothing), unsupported (name what is missing),
// failed (say it could not be drawn, and why).
//
// ⚠ THE MESSAGE IS RENDERED BY THE HOST, OUTSIDE THE `aria-hidden` LAND LAYER. A message inside that
// wrapper would be invisible to assistive technology — the land layer is hidden from it on purpose.

/** What the browser needs to draw the 3D map, in words a member can act on. */
export const LAND_MAP_REQUIREMENT = 'a modern browser with WebGL 2';

/** The canvas slot's own progress, reported upward by the canvas (or its error boundary). */
export type LandCanvasPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly reason: string };

/** The mount's own branch (`LandViewMount`'s `data-state`), with the refusal reason when it has one. */
export interface LandMountBody {
  readonly state: 'waiting-for-world' | 'no-land' | 'waiting-for-frame' | 'waiting-for-camera' | 'refused' | 'drawn';
  readonly reason?: string | undefined;
}

export type LandMountStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

export const LOADING_MESSAGE = 'Loading the 3D forest map…';
export const UNSUPPORTED_MESSAGE =
  `This browser can't draw the forest map. It needs ${LAND_MAP_REQUIREMENT} turned on — ` +
  'a current version of Chrome, Edge, Firefox or Safari.';

function failed(reason: string): LandMountStatus {
  return { kind: 'failed', message: `The forest map couldn't be drawn: ${reason}. Reloading the page may help.` };
}

/** The one status a member is shown for a mount body and its canvas phase. */
export function landMountStatus(body: LandMountBody, phase: LandCanvasPhase): LandMountStatus {
  if (body.state === 'no-land' || body.state === 'refused') {
    return failed(body.reason ?? 'the land could not be laid out for this map');
  }
  // Still waiting for its world, frame or camera: whatever the canvas says, nothing is drawn yet.
  if (body.state !== 'drawn') return { kind: 'loading', message: LOADING_MESSAGE };
  switch (phase.kind) {
    case 'ready':
      return { kind: 'ready' };
    case 'loading':
      return { kind: 'loading', message: LOADING_MESSAGE };
    case 'unsupported':
      return { kind: 'unsupported', message: UNSUPPORTED_MESSAGE };
    case 'failed':
      return failed(phase.reason);
  }
}

/** The part of the browser `detectWebGL2` asks — injectable, so every branch is provable. */
export interface WebGL2Probe {
  readonly hasWebGL2Api: boolean;
  readonly createElement: (tag: 'canvas') => { getContext(kind: 'webgl2'): unknown };
}

/** The real browser, read when asked (never at import, so a runner without a DOM can import this). */
export function browserWebGL2Probe(): WebGL2Probe {
  return {
    hasWebGL2Api: typeof WebGL2RenderingContext !== 'undefined',
    createElement: (tag) => document.createElement(tag),
  };
}

interface ProbeContext {
  getExtension?: (name: string) => { loseContext?: () => void } | null;
}

/** The probe's context, or `null` when it cannot be created — including when creating it throws. */
function probeContext(probe: WebGL2Probe): ProbeContext | null {
  try {
    return (probe.createElement('canvas').getContext('webgl2') as ProbeContext | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this browser can create a WebGL 2 context — asked ONCE, before any renderer code is
 * fetched, so an old browser never downloads the 3D chunk only to fail in it. A probe that throws
 * while creating the context is a "no": a browser that cannot answer cannot draw the map either.
 */
export function detectWebGL2(probe: WebGL2Probe = browserWebGL2Probe()): boolean {
  if (!probe.hasWebGL2Api) return false;
  const context = probeContext(probe);
  if (context === null) return false;
  // Hand the probe's context straight back: browsers cap live contexts, and this one draws nothing.
  context.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  return true;
}

/** The browser's frame clock, injectable so the deferral below is provable without a renderer. */
export interface LandFrameScheduler {
  readonly request: (callback: () => void) => number;
  readonly cancel: (requestId: number) => void;
}

export const BROWSER_LAND_FRAMES: LandFrameScheduler = {
  request: (callback) => window.requestAnimationFrame(() => callback()),
  cancel: (requestId) => window.cancelAnimationFrame(requestId),
};

/**
 * Call `report` once the renderer's FIRST FRAME has been drawn — two frames after the context was
 * made, never on the making itself.
 *
 * ⚠ WHY NOT AT `onCreated`: R3F announces the renderer BEFORE its first frame, and that first frame
 * is the expensive one (shader compiles; measured on a production build 2026-09-24 as ~1 s of
 * blocked frames straight after it). `ready` is what the member's first growth is anchored to
 * (the-3d-map-opens-on-its-first-growth), so announcing it early spends the start of the growth on
 * a frozen screen. Two frame callbacks bracket one whole frame whichever order the renderer's own
 * loop registered in, so the second runs after the renderer has drawn at least once.
 *
 * A hidden page delivers no frames, so a land made while hidden reports ready when it is first SEEN
 * — which is when it can first draw. Returns a cancel for unmount / context loss.
 */
export function afterFirstDrawnFrame(frames: LandFrameScheduler, report: () => void): () => void {
  let cancelled = false;
  let requestId = frames.request(() => {
    if (cancelled) return;
    requestId = frames.request(() => {
      if (!cancelled) report();
    });
  });
  return () => {
    cancelled = true;
    frames.cancel(requestId);
  };
}
