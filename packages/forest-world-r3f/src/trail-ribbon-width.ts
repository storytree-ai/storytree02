/**
 * THE ROAD RIBBON'S ON-SCREEN WIDTH — the one rule for how wide the 3D land draws a road at a given
 * zoom, so that a road SCALES WITH THE LAND and never thickens as you zoom out.
 *
 * The owner, 2026-09-25, looking at the new default map: "I also noticed that pathways get thicker
 * as you zoom out which is not something we want." Measured the same day on the real forest
 * (`docs/research/pathways-scale-with-zoom-2026-09-25/`): the ribbon was a drei `<Line>` whose
 * `lineWidth` is in SCREEN pixels, so it stayed ~6 px wide at every zoom while the islands under it
 * went from 255 px (zoomed in) to 119 px (the opening view) to 16 px (zoomed right out) — a road
 * 2.5% of an island's width zoomed in and 37% of it zoomed out. The SVG layer's selection lanes,
 * sized in ground units, held a constant ~5% throughout, so the two layers also slid out of register
 * as the zoom moved.
 *
 * The rule: the descriptor's `width` (`trailFillWidth(usage)`, the ONE width rule every surface
 * shares) is read in GROUND units at {@link RIBBON_GROUND_SCALE}, and the camera's zoom (CSS px per
 * ground unit — the same number the SVG camera's scale is, `canvasRegistration.ts`) turns it into
 * pixels. Above the floor, the road's width as a share of an island is therefore the same at every
 * zoom.
 *
 * ⚠ THE SCALE PRESERVES THE LOOK THE OWNER APPROVED AT THE OPENING VIEW (ADR-0608, "roads look good
 * now"). The opening view measured 1.97 px per ground unit on the live corpus, where the old
 * screen-pixel ribbon drew `width` px; half a ground unit per width unit draws 0.99x that at the
 * opening view, so the approved picture is unchanged where he judged it and only the zoom behaviour
 * moves. It is NOT the flat map's retired `TRAIL_STROKE_SCALE` (0.41), which would thin every road by
 * a fifth at the opening view — an appearance change nobody asked for.
 *
 * ⚠ THE FLOOR KEEPS A ROAD VISIBLE, AND IT CAN NEVER MAKE ONE THICKER AS YOU ZOOM OUT. Below
 * {@link RIBBON_MIN_SCREEN_PX} a line stops reading as a road and starts reading as noise, so the
 * width stops falling there: on screen it is then constant, never growing. Measured, only a
 * one-edge spur reaches the floor, and only near the zoom-out limit.
 */

/** Ground units of ribbon per unit of `trailFillWidth` — see the module note for why one half. */
export const RIBBON_GROUND_SCALE = 0.5;
/** The narrowest a road is ever drawn on screen, in CSS px. */
export const RIBBON_MIN_SCREEN_PX = 1;

/**
 * The ribbon's width on screen in CSS px for a descriptor `width` at a camera `zoom` (CSS px per
 * ground unit). A zoom or width that is not a finite number projects nothing, so the road keeps the
 * floor rather than vanishing or exploding; a zero or negative one reaches the floor through the
 * `max` on its own.
 */
export function trailRibbonScreenWidth(width: number, zoom: number): number {
  if (!Number.isFinite(zoom) || !Number.isFinite(width)) return RIBBON_MIN_SCREEN_PX;
  return Math.max(RIBBON_MIN_SCREEN_PX, width * RIBBON_GROUND_SCALE * zoom);
}

/** The slice of a drei `<Line>` (three-stdlib's `Line2`) the zoom hook touches. */
export interface ZoomScaledRibbon {
  onBeforeRender(renderer: never, scene: never, camera: never, ...rest: never[]): void;
  readonly material: { linewidth: number };
}

/**
 * Make a road ribbon take its width from the camera's zoom AT EVERY DRAW, whichever path draws it.
 *
 * ⚠ IT RIDES THE RENDERER'S OWN PER-OBJECT HOOK, NOT `useFrame`. Under a host the canvas draws the
 * host's camera synchronously in the host's own commit (`presentRegisteredCamera`, a direct
 * `gl.render` — it is what stops the land tearing on pan), and a direct render runs no `useFrame`
 * callback, so a width set there would lag the zoom by a frame on exactly the gestures that change
 * it. `onBeforeRender` runs inside every `gl.render`, before the object's uniforms are uploaded, so
 * the width drawn is always the width for the camera being drawn with.
 *
 * The line's own hook still runs first (it sets the material's resolution from the viewport). A
 * camera that is not orthographic has no zoom in this sense and leaves the width alone. Returns the
 * undo, for an effect's cleanup.
 */
export function scaleRibbonWithZoom(line: ZoomScaledRibbon, width: number): () => void {
  const own = Object.prototype.hasOwnProperty.call(line, 'onBeforeRender');
  const base = line.onBeforeRender;
  line.onBeforeRender = function (this: ZoomScaledRibbon, renderer: never, scene: never, camera: never, ...rest: never[]) {
    base.call(this, renderer, scene, camera, ...rest);
    const cam = camera as { readonly isOrthographicCamera?: boolean; readonly zoom?: number } | null;
    if (cam?.isOrthographicCamera === true && typeof cam.zoom === 'number') {
      line.material.linewidth = trailRibbonScreenWidth(width, cam.zoom);
    }
  };
  return () => {
    if (own) line.onBeforeRender = base;
    else delete (line as { onBeforeRender?: unknown }).onBeforeRender;
  };
}
