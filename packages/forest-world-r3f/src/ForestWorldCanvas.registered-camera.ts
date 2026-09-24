// ForestWorldCanvas.registered-camera.ts — the host's camera, applied AND DRAWN in the host's commit.
//
// ⚠⚠ WHY THIS IS NOT A COMPONENT INSIDE THE `<Canvas>` ANY MORE. Registered mode used to apply the
// host's camera from a child of `<Canvas>` (`RegisteredCamera`), in a layout effect of R3F's OWN
// reconciler, and then `invalidate()` for a demand frame. That is two hops the host's commit never
// waits for: the outer `<Canvas>` hands its children to R3F's root, which renders them on its own
// schedule, and the demand frame is drawn on a later animation frame still. The studio, meanwhile,
// moves the SVG layer and resets `.world-pan-layer`'s compositor translate in ONE commit
// (`compositor-pan-transform`). So on every camera change the page painted at least one frame with
// the SVG on the new camera and the land on the old one — measured on the production studio,
// 2026-09-25 (`docs/research/map-pan-steady-2026-09-25/`): every drag RELEASE showed the land for a
// frame back where the drag began (183–323 px out of register), and every wheel notch and arrow key
// did the same at 60–192 px. That is the flicker and the shake the owner saw.
//
// ⚠ SO THE CAMERA IS SET, AND THE FRAME DRAWN, SYNCHRONOUSLY in a layout effect of the HOST's
// reconciler — the same commit, before the same paint, as the SVG transform it has to match. The
// drawing buffer a synchronous `render` fills is presented with the DOM changes of the task that
// drew it, so both layers change on one frame by construction rather than by a race going our way.
//
// ⚠ IT DERIVES NOTHING. `zoom` and `target` arrive solved from the host (`registrationCamera`); the
// only thing computed here is where the eye sits, as the SAME offset from the target the standalone
// framing uses — so the view direction (the 50° elevation the registration is about) is unchanged.
// There is still one camera authority (the host's) and no renderer clock: this draws only when the
// host's camera moved.

/** The slice of an orthographic camera this touches — a three.js `OrthographicCamera` satisfies it. */
export interface RegisteredCameraTarget {
  zoom: number;
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): void;
  updateProjectionMatrix(): void;
}

/** The slice of R3F's root state this needs, read at the moment the host commits. */
export interface RegisteredCameraRoot<C, S> {
  readonly camera: C;
  readonly scene: S;
  readonly gl: { render(scene: S, camera: C): void };
  readonly invalidate: () => void;
}

export interface RegisteredCameraPose {
  readonly zoom: number;
  readonly target: { readonly x: number; readonly z: number };
  /** Eye minus target, from the canvas's own framing. */
  readonly eye: readonly [number, number, number];
}

/** Put the camera where the host says. Pure with respect to everything but `camera`. */
export function applyRegisteredCamera(camera: RegisteredCameraTarget, pose: RegisteredCameraPose): void {
  camera.zoom = pose.zoom;
  camera.position.set(pose.target.x + pose.eye[0], pose.eye[1], pose.target.z + pose.eye[2]);
  camera.lookAt(pose.target.x, 0, pose.target.z);
  camera.updateProjectionMatrix();
}

/**
 * Apply the host's camera and draw the frame NOW, in the caller's task.
 *
 * `paint` is the canvas's own presentability (`frameloop !== 'never'`): a parked or hidden canvas
 * takes the camera but draws nothing, and is asked for a demand frame instead so it is current the
 * moment R3F resumes it. Returns whether a frame was drawn.
 */
export function presentRegisteredCamera<C extends RegisteredCameraTarget, S>(
  root: RegisteredCameraRoot<C, S>,
  pose: RegisteredCameraPose,
  paint: boolean,
): boolean {
  applyRegisteredCamera(root.camera, pose);
  if (!paint) {
    root.invalidate();
    return false;
  }
  root.gl.render(root.scene, root.camera);
  return true;
}
