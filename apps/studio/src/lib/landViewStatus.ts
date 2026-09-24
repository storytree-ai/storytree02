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
  switch (body.state) {
    case 'no-land':
    case 'refused':
      return failed(body.reason ?? 'the land could not be laid out for this map');
    case 'waiting-for-world':
    case 'waiting-for-frame':
    case 'waiting-for-camera':
      return { kind: 'loading', message: LOADING_MESSAGE };
    case 'drawn':
      break;
  }
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

/**
 * Whether this browser can create a WebGL 2 context — asked ONCE, before any renderer code is
 * fetched, so an old browser never downloads the 3D chunk only to fail in it. A throwing probe is a
 * "no": a browser that cannot answer the question cannot draw the map either.
 */
export function detectWebGL2(
  env: { readonly hasWebGL2Api: boolean; readonly createCanvas: () => { getContext(kind: 'webgl2'): unknown } } = {
    hasWebGL2Api: typeof WebGL2RenderingContext !== 'undefined',
    createCanvas: () => document.createElement('canvas'),
  },
): boolean {
  if (!env.hasWebGL2Api) return false;
  try {
    const context = env.createCanvas().getContext('webgl2') as {
      getExtension?: (name: string) => { loseContext?: () => void } | null;
    } | null;
    if (context === null || context === undefined) return false;
    // Hand the probe's context straight back: browsers cap live contexts, and this one draws nothing.
    context.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}
