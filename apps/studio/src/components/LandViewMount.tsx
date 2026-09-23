// LandViewMount.tsx — the 3D land, mounted UNDER the working map (`the-land-sits-under-the-working-map`).
//
// THE SANDWICH, from the bottom up: the studio's own board gradient, then THIS canvas drawing the
// land, then the existing `<svg class="world-scene">` carrying every mark that means anything —
// nameplates, hit targets, trails, the crowns and flora, the signposts, all five wisp families, the
// selection ring and the one-hop lit lane. ADR-0530 route C; ADR-0380 D6 fences 1 and 3 are what
// make it that shape rather than a replacement.
//
// ⚠⚠ THE Z-ORDER QUESTION IS SETTLED BY WHERE THIS ELEMENT SITS, NOT BY A `z-index`. "On the land"
// was undefined above a canvas, and this is the answer: the canvas is a SIBLING placed BEFORE the
// `<svg>` inside `.world-pan-layer`, and nothing in that region sets a `z-index` at all — so paint
// order is DOM order and every SVG mark is above the land, unconditionally and with nothing to
// configure. The five wisp families and the signposts are all inside that one `<svg>`
// (`forest-world`'s `buildScene` puts them in the flora layer), so they cannot be occluded by 3D
// geometry, cannot be sorted against it, and cannot be re-ordered by accident. A wisp is a claim
// about a SESSION and a signpost is a claim about a PROOF; neither is a thing standing in a
// landscape, so "above the land, always" is the honest reading as well as the cheap one.
//   (⚠ The verdict BLOOM is not in that list because it no longer exists — ADR-0529/0536 retired
//   it. Guidance that still pairs "wisps and the verdict bloom" is describing a mark this map has
//   not drawn for weeks; the surviving proof-adjacent drawable is the signpost.)
//
// ⚠⚠ IT IS INERT, AND THAT IS A FENCE RATHER THAN AN OMISSION. `pointer-events: none` in CSS and
// `aria-hidden` here: the app keeps owning picking, focus, the keyboard camera and the accessible
// name (ADR-0380 D6 fence 3), so this layer must not appear in the accessibility tree and must not
// intercept a gesture. The canvas is also mounted WITHOUT `MapControls` — see `RegisteredUnderlay`
// — because a host that owns pan and zoom has to be the only thing that owns them.
//
// ⚠ AND IT REFUSES RATHER THAN APPROXIMATING. If the two layers cannot be registered,
// `mountedLandCamera` says so and this component draws NOTHING — the working map is left exactly as
// it was. A land layer half a screen out of register is worse than no land layer, because the map's
// whole job is to say which island you are looking at.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import type { SceneG } from '@storytree/forest-world';
import {
  forestRegrowPresentation,
  type Descriptor3D,
  type ForestRegrowCursor,
  type ForestRegrowPresentation,
} from '@storytree/forest-world-r3f';
import type { RegisteredUnderlay } from '@storytree/forest-world-r3f/canvas';

import { landViewStream } from '../lib/landView.js';
import { mountedLandCamera } from '../lib/landViewMount.js';
import type { Camera } from '../lib/worldCamera.js';

/** What the canvas slot is handed in registered mode: the stream, and the host's own camera. */
export interface LandMountCanvasProps {
  descriptors: readonly Descriptor3D[];
  registered: RegisteredUnderlay;
  /** The app-owned cursor, adapted here for the canvas without creating another clock. */
  regrow: ForestRegrowPresentation | null;
}

/** The real canvas, in its own chunk — the same chunk `LandView` loads, so opening both costs one. */
const ForestWorldCanvas = lazy(async () => {
  const mod = await import('@storytree/forest-world-r3f/canvas');
  return { default: mod.ForestWorldCanvas };
});

function DefaultMountCanvas({ descriptors, registered, regrow }: LandMountCanvasProps) {
  return (
    <Suspense fallback={null}>
      <ForestWorldCanvas descriptors={descriptors} registered={registered} regrow={regrow} />
    </Suspense>
  );
}

export interface LandViewMountProps {
  /** The scene graph the SVG map was built from — the SAME object, never a second layout. */
  scene: SceneG | null;
  /**
   * The camera the SVG layer is CURRENTLY PRESENTING — `presentedCam`, the one written to
   * `<g class="world-camera">`.
   *
   * ⚠ IT IS THE PRESENTED CAMERA AND NOT THE DESIRED ONE, deliberately. During a drag the presented
   * camera is frozen and the movement rides `.world-pan-layer`'s CSS transform; this canvas is
   * inside that wrapper, so it inherits the same transform and stays registered through the gesture
   * without re-rendering. Handing over the DESIRED camera instead would make the canvas re-render
   * every frame of every drag to arrive at the same pixels.
   */
  camera: Camera | null;
  /** The app-owned regrow cursor while the world is growing; absent after settlement. */
  regrowCursor?: ForestRegrowCursor | null;
  /** Draw the kit props as well as the ground — the staging arm, off by default. */
  drawProps?: boolean;
  /** The canvas seam, so the mount is provable in jsdom. Absent ⇒ the real, lazily-loaded one. */
  renderCanvas?: (props: LandMountCanvasProps) => React.ReactNode;
}

/**
 * THE FRAME BOTH LAYERS ARE DELIVERED INTO, measured off this element's own box.
 *
 * ⚠ IT MEASURES ITSELF RATHER THAN BEING TOLD, and that is what makes the registration honest.
 * `.land-mount` is `inset: 0` inside `.world-pan-layer`, which is `inset: 0` inside
 * `.world-viewport` — the same box the SVG fills. So this element's box IS the frame the SVG's own
 * `worldToScreen` projects into, read from the live layout rather than from a number passed down a
 * chain that could have gone stale.
 *
 * ⚠ IT REPORTS `null` UNTIL IT HAS A REAL READING, and nothing mounts before then — a zero-sized
 * first pass would register against a frame that does not exist. `ResizeObserver` is absent in a
 * headless runner, which is the same case and takes the same branch.
 */
function useMeasuredFrame(): [
  React.RefObject<HTMLDivElement | null>,
  { width: number; height: number } | null,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setFrame({ width, height });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, frame];
}

/**
 * The land layer. Draws the ground when it can be registered, and NOTHING otherwise — never a
 * best-effort approximation, and never anything that could catch a pointer or a screen reader.
 *
 * `data-state` / `data-reason` are how a test (and a person with devtools) reads which branch was
 * taken without the picture having to say. They are the only observable this layer adds.
 */
export function LandViewMount({
  scene,
  camera,
  regrowCursor = null,
  drawProps = false,
  renderCanvas = DefaultMountCanvas,
}: LandViewMountProps): React.JSX.Element {
  const [ref, frame] = useMeasuredFrame();
  // Memoised on the scene, for the reason `LandView` gives: it stops the conversion being paid
  // twice when this layer re-renders for its OWN reasons. The poll-driven repeat is stopped
  // downstream, where the ground is keyed on its own content (`ground-dependency.ts`).
  const stream = useMemo(() => (scene === null ? null : landViewStream(scene)), [scene]);
  const registration = useMemo(
    () => (camera === null || frame === null ? null : mountedLandCamera(camera, frame)),
    [camera, frame],
  );
  const regrow = useMemo(() => forestRegrowPresentation(regrowCursor), [regrowCursor]);

  const body = (() => {
    if (stream === null) return { state: 'waiting-for-world' as const, node: null };
    if (!stream.ok) return { state: 'no-land' as const, reason: stream.reason, node: null };
    if (frame === null) return { state: 'waiting-for-frame' as const, node: null };
    if (registration === null) return { state: 'waiting-for-camera' as const, node: null };
    if (!registration.ok) return { state: 'refused' as const, reason: registration.reason, node: null };
    // ⚠ `props` IS ADDED ONLY WHEN ASKED FOR, as a separate statement rather than a conditional
    // spread — `exactOptionalPropertyTypes` is on, so an explicit `props: undefined` and an absent
    // `props` are different types, and the canvas's own default is what should decide the absent
    // case rather than a value passed down meaning "no".
    const registeredProps: RegisteredUnderlay = {
      zoom: registration.camera.zoom,
      target: { x: registration.camera.target.x, z: registration.camera.target.z },
    };
    const withProps: RegisteredUnderlay = drawProps ? { ...registeredProps, props: true } : registeredProps;
    return {
      state: 'drawn' as const,
      node: renderCanvas({ descriptors: stream.descriptors, registered: withProps, regrow }),
    };
  })();

  return (
    <div
      className="land-mount"
      data-testid="land-mount"
      data-state={body.state}
      data-reason={'reason' in body ? body.reason : undefined}
      ref={ref}
      aria-hidden="true"
    >
      {body.node}
    </div>
  );
}
