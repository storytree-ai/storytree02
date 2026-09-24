// LandView.tsx — the land, drawn BESIDE the working map (`a-land-view-beside-the-working-map`).
//
// The panel around `<ForestWorldCanvas>`: it takes the scene graph the SVG map was built from,
// converts it to the 3D land stream (`lib/landView.ts` owns that and its ⚠s), measures its own
// frame, and hands both to the canvas. It steers nothing, selects nothing and writes nothing —
// every interaction the studio has stays on the SVG layer, which this sits next to and never over.
//
// ⚠ THE CANVAS ARRIVES BEHIND `React.lazy`, AND THAT IS A PRODUCT DECISION RATHER THAN A TIDINESS
// ONE. `@storytree/forest-world-r3f/canvas` pulls three.js, R3F, drei and the bought kit — ADR-0530
// costed the kit alone at ~1.71 MB compressed, about 24x three.js itself — and the map's own
// history is the warning it names: the dependency hover-highlight was removed in July because it
// made the map lag. Behind `lazy` it is its own chunk, fetched the first time someone opens the
// view and never on the ordinary map's path.
//
// ⚠ AND THE CANVAS IS A SLOT, so this panel is provable in jsdom. `vi.mock` is lint-refused here
// (`anti-slop/no-module-mocking`), and mocking a module would take the panel's real arithmetic with
// it; `renderCanvas` substitutes the ONE thing a headless runner cannot execute — a WebGL context —
// and leaves the framing, the failure path and the measurement real.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import type { SceneG } from '@storytree/forest-world';
import {
  forestRegrowPresentation,
  type Descriptor3D,
  type ForestRegrowCursor,
  type ForestRegrowPresentation,
} from '@storytree/forest-world-r3f';

import { landViewStream } from '../lib/landView.js';

/** What the canvas slot is handed: the drawable stream and the frame it is delivered into. */
export interface LandCanvasProps {
  descriptors: readonly Descriptor3D[];
  /** CSS px. Present ⇒ the canvas opens on the DESIGNED RESTING VIEW (ADR-0471) rather than a fit,
   *  which is what makes this view and the map beside it open on the same composition. */
  viewport: { width: number; height: number };
  /** The app-owned cursor, adapted here for the canvas without creating another clock. */
  regrow: ForestRegrowPresentation | null;
  /** Whether the host route is active. This flag does not change the app clock or cursor ownership. */
  active: boolean;
}

/** The real canvas, in its own chunk. */
const ForestWorldCanvas = lazy(async () => {
  const mod = await import('@storytree/forest-world-r3f/canvas');
  return { default: mod.ForestWorldCanvas };
});

function DefaultLandCanvas({ descriptors, viewport, regrow, active }: LandCanvasProps) {
  return (
    <Suspense fallback={<p className="muted land-view-status">Loading the land…</p>}>
      <ForestWorldCanvas descriptors={descriptors} viewport={viewport} regrow={regrow} active={active} />
    </Suspense>
  );
}

export interface LandViewProps {
  /** The scene graph the SVG map was built from — the SAME object, never a second layout. `null`
   *  while the world is still resolving, which is a panel with a note in it and not an empty
   *  canvas claiming there is no forest. */
  scene: SceneG | null;
  /** The app-owned regrow cursor while the world is growing; absent after settlement. */
  regrowCursor?: ForestRegrowCursor | null;
  /** The route's existing active state, forwarded without changing regrow ownership. */
  active?: boolean;
  /** The canvas seam (above). Absent ⇒ the real, lazily-loaded one. */
  renderCanvas?: (props: LandCanvasProps) => React.ReactNode;
}

/**
 * THE FRAME THIS PANEL OCCUPIES, measured rather than assumed.
 *
 * The resting composition is stated in CSS px ("the frame's shorter side spans nine median
 * islands"), so the canvas has to be told the size of the box it is delivered into. A
 * `ResizeObserver` is the honest source: the panel is a flex child of the map route and its width
 * moves whenever the window does.
 *
 * ⚠ IT REPORTS `null` UNTIL IT HAS A REAL READING, and the canvas is not mounted before then. A
 * zero-sized first pass would frame the world against a frame that does not exist, and the fix
 * would be a resize the viewer never asked for. `ResizeObserver` is also absent in a headless
 * runner, which is the same case and takes the same branch.
 */
function useMeasuredFrame(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number } | null] {
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
    return () => { ro.disconnect(); };
  }, []);
  return [ref, frame];
}

/**
 * The land view panel. Renders one of four honest states and never throws: waiting for the world,
 * waiting for a frame, the land, or the reason the land could not be built.
 */
export function LandView({
  scene,
  regrowCursor = null,
  active = true,
  renderCanvas = DefaultLandCanvas,
}: LandViewProps): React.JSX.Element {
  const [ref, frame] = useMeasuredFrame();
  // ⚠ MEMOISED ON THE SCENE, AND THAT IS THE SMALLER HALF OF THE CURE RATHER THAN THE CURE. It stops
  // the conversion being paid twice when this panel re-renders for its OWN reasons — the frame
  // measurement arriving is one per mount — but it does NOT stop the poll-driven repeat the land
  // view's load cost was made of, because the studio replaces the scene OBJECT on every clock tick
  // and every live-activity poll (`docs/research/land-view-performance-2026-09-15/`). What stops
  // that is downstream, where the ground is keyed on its own CONTENT rather than on this array's
  // identity (`@storytree/forest-world-r3f`'s `ground-dependency.ts`).
  const stream = useMemo(() => (scene === null ? null : landViewStream(scene)), [scene]);
  const regrow = useMemo(() => forestRegrowPresentation(regrowCursor), [regrowCursor]);
  return (
    <aside className="land-view" data-testid="land-view" aria-label="the land, drawn beside the map">
      <header className="land-view-head">
        <strong>The land</strong>
        <span className="muted">
          {/* ⚠ SAID OUT LOUD rather than left to be inferred: this panel makes no claim about any
              unit's proof state, which is why ADR-0418 D5's texture fence does not bind it. */}
          the same forest, drawn — a view, not the map
        </span>
      </header>
      <div className="land-view-frame" ref={ref}>
        {stream === null && <p className="muted land-view-status">Waiting for the forest…</p>}
        {stream !== null && !stream.ok && (
          <p className="land-view-status land-view-error">The land could not be drawn: {stream.reason}</p>
        )}
        {stream !== null && stream.ok && frame === null && (
          <p className="muted land-view-status">Measuring the frame…</p>
        )}
        {stream !== null && stream.ok && frame !== null && renderCanvas({ descriptors: stream.descriptors, viewport: frame, regrow, active })}
      </div>
    </aside>
  );
}
