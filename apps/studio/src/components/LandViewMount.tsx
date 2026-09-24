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

import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { SceneG } from '@storytree/forest-world';
import {
  forestRegrowPresentation,
  type Descriptor3D,
  type ForestRegrowCursor,
  type ForestRegrowPresentation,
  type NativePropHitEnvelope,
} from '@storytree/forest-world-r3f';
import type { RegisteredUnderlay } from '@storytree/forest-world-r3f/canvas';

import { landViewStream } from '../lib/landView.js';
import { mountedLandCamera } from '../lib/landViewMount.js';
import {
  BROWSER_LAND_FRAMES,
  afterFirstDrawnFrame,
  detectWebGL2,
  landMountStatus,
  type LandCanvasPhase,
  type LandMountStatus,
} from '../lib/landViewStatus.js';
import type { Camera } from '../lib/worldCamera.js';

/** What the canvas slot is handed in registered mode: the stream, and the host's own camera. */
export interface LandMountCanvasProps {
  descriptors: readonly Descriptor3D[];
  /** The host legend's presentation state; never a filter on the scene or its placements. */
  hiddenStatuses: ReadonlySet<string>;
  registered: RegisteredUnderlay;
  /** The app-owned cursor, adapted here for the canvas without creating another clock. */
  regrow: ForestRegrowPresentation | null;
  /** Whether the host route is active. The registered canvas handles parking. */
  active: boolean;
  /** The host's receiver for the native plants' click targets; absent ⇒ none are computed. */
  onNativePropTargets?: (targets: readonly NativePropHitEnvelope[]) => void;
  /** Reports the canvas's own progress (loading → ready, or unsupported / failed). Stable. */
  onPhase: (phase: LandCanvasPhase) => void;
}

/** The real canvas, in its own chunk — the same chunk `LandView` loads, so opening both costs one. */
const ForestWorldCanvas = lazy(async () => {
  const mod = await import('@storytree/forest-world-r3f/canvas');
  return { default: mod.ForestWorldCanvas };
});

function DefaultMountCanvas({ descriptors, hiddenStatuses, registered, regrow, active, onNativePropTargets, onPhase }: LandMountCanvasProps) {
  // ⚠ ASKED BEFORE THE CHUNK IS FETCHED: a browser without WebGL 2 is told so, and never downloads
  // the renderer only to fail inside it (ADR-0608 D5).
  const [supported] = useState(() => detectWebGL2());
  useEffect(() => {
    if (!supported) onPhase({ kind: 'unsupported' });
  }, [supported, onPhase]);
  // `ready` is reported once the land has DRAWN a frame, not when its context was made — the first
  // growth is anchored to it (see `afterFirstDrawnFrame`).
  const cancelReady = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelReady.current?.(), []);
  const onRendererState = useCallback(
    (state: 'ready' | 'lost') => {
      cancelReady.current?.();
      cancelReady.current = null;
      if (state === 'ready') cancelReady.current = afterFirstDrawnFrame(BROWSER_LAND_FRAMES, () => onPhase({ kind: 'ready' }));
      else onPhase({ kind: 'failed', reason: 'the browser took the graphics context away' });
    },
    [onPhase],
  );
  if (!supported) return null;
  return (
    <Suspense fallback={null}>
      <ForestWorldCanvas
        descriptors={descriptors}
        hiddenStatuses={hiddenStatuses}
        registered={registered}
        regrow={regrow}
        active={active}
        onRendererState={onRendererState}
        {...(onNativePropTargets === undefined ? {} : { onNativePropTargets })}
      />
    </Suspense>
  );
}

/** The seam's default: the real canvas as a COMPONENT (it holds hooks), never called as a function. */
const renderDefaultCanvas = (props: LandMountCanvasProps): React.ReactNode => <DefaultMountCanvas {...props} />;

/**
 * THE CANVAS SLOT'S ERROR BOUNDARY. A renderer chunk that fails to load, or a WebGL context that
 * cannot be created (R3F throws that into React), must become a message — never an unmounted map
 * route and never a silent blank. The working map above is untouched either way.
 */
interface LandCanvasBoundaryState {
  readonly failed: boolean;
}

class LandCanvasBoundary extends Component<{ onFailed: (reason: string) => void; children: ReactNode }, LandCanvasBoundaryState> {
  override state: LandCanvasBoundaryState = { failed: false };
  static getDerivedStateFromError(): LandCanvasBoundaryState {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    const detail = error instanceof Error && error.message ? error.message : String(error);
    this.props.onFailed(`the 3D renderer stopped (${detail})`);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface LandViewMountProps {
  /** The scene graph the SVG map was built from — the SAME object, never a second layout. */
  scene: SceneG | null;
  /** The exact hidden-status set owned by the host legend. */
  hiddenStatuses?: ReadonlySet<string>;
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
  /** The route's existing active state, forwarded without changing regrow ownership. */
  active?: boolean;
  /**
   * Receives the native plants' click targets once the props are drawn (and an empty list when
   * they stop), for the host to render into its OWN hit layer. The canvas stays inert: this is data,
   * never a second picker. Must be a stable function.
   */
  onNativePropTargets?: (targets: readonly NativePropHitEnvelope[]) => void;
  /**
   * What the host should TELL the member (ADR-0608 D5): loading, ready, unsupported or failed.
   * Called when the status changes. The land layer itself is `aria-hidden`, so the host renders
   * the message in its own accessible layer (`LandViewNotice`). Must be a stable function.
   */
  onStatus?: (status: LandMountStatus) => void;
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

const NO_HIDDEN_STATUSES: ReadonlySet<string> = new Set();
const LOADING_PHASE: LandCanvasPhase = { kind: 'loading' };

/**
 * The land layer. Draws the ground when it can be registered, and NOTHING otherwise — never a
 * best-effort approximation, and never anything that could catch a pointer or a screen reader.
 *
 * `data-state` / `data-reason` are how a test (and a person with devtools) reads which branch was
 * taken without the picture having to say. They are the only observable this layer adds.
 */
export function LandViewMount({
  scene,
  hiddenStatuses = NO_HIDDEN_STATUSES,
  camera,
  regrowCursor = null,
  active = true,
  onNativePropTargets,
  onStatus,
  renderCanvas = renderDefaultCanvas,
}: LandViewMountProps): React.JSX.Element {
  const [ref, frame] = useMeasuredFrame();
  const [phase, setPhase] = useState<LandCanvasPhase>(LOADING_PHASE);
  const onFailed = useCallback((reason: string) => setPhase({ kind: 'failed', reason }), []);
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
    // The kit props are always drawn: the mounted land IS the forest (ADR-0608 D1), so its trees,
    // coverage plants and UAT flowers are the map's picture, not a staging arm (`?landMountProps`
    // retired with the flat look).
    const registered: RegisteredUnderlay = {
      zoom: registration.camera.zoom,
      target: { x: registration.camera.target.x, z: registration.camera.target.z },
      props: true,
    };
    const canvasProps: LandMountCanvasProps = {
      descriptors: stream.descriptors,
      hiddenStatuses,
      registered,
      regrow,
      active,
      onPhase: setPhase,
    };
    if (onNativePropTargets !== undefined) canvasProps.onNativePropTargets = onNativePropTargets;
    return {
      state: 'drawn' as const,
      node: <LandCanvasBoundary onFailed={onFailed}>{renderCanvas(canvasProps)}</LandCanvasBoundary>,
    };
  })();
  const status = landMountStatus({ state: body.state, reason: 'reason' in body ? body.reason : undefined }, phase);
  const statusKey = `${status.kind}::${'message' in status ? status.message : ''}`;
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    onStatus?.(statusRef.current);
  }, [statusKey, onStatus]);

  return (
    <div
      className="land-mount"
      data-testid="land-mount"
      data-state={body.state}
      data-reason={'reason' in body ? body.reason : undefined}
      data-canvas={body.state === 'drawn' ? phase.kind : undefined}
      ref={ref}
      aria-hidden="true"
    >
      {body.node}
    </div>
  );
}
