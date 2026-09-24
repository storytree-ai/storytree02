/**
 * WHEN THE CANVAS MAY SAY IT IS DRAWING — the rule behind `onRendererState('ready')`, kept pure so
 * it is provable without a GPU.
 *
 * ⚠ READY MEANS EVERYTHING THIS CANVAS WAS ASKED TO DRAW HAS ARRIVED, not merely that a WebGL
 * context exists. The bought plant kit loads AFTER the context: it is fetched, parsed and colour-
 * sampled, its meshes are merged and its shaders compiled on the first frame that draws them —
 * measured on a production build on 2026-09-24 as ~1 s of blocked main thread straight after the
 * ground's own first frame. A host anchors the member's first growth to `ready`
 * (the-3d-map-opens-on-its-first-growth), so announcing it before the plants spent that second of
 * the growth on a frozen screen. Held until the kit has SETTLED, the same second is spent behind
 * the host's loading notice instead.
 *
 * "Settled" includes a kit that FAILED to load: the ground still reports proof state correctly
 * with bare islands, so a broken kit must never hold the map at "loading" forever.
 */
export interface CanvasReadiness {
  /** The WebGL context exists and the R3F canvas has been created. */
  readonly created: boolean;
  /** This canvas was asked to draw the kit props. */
  readonly drawsProps: boolean;
  /** The kit has loaded and its meshes are committed — or it failed, and none will be. */
  readonly propsSettled: boolean;
}

export function canvasReady({ created, drawsProps, propsSettled }: CanvasReadiness): boolean {
  if (!created) return false;
  return !drawsProps || propsSettled;
}
