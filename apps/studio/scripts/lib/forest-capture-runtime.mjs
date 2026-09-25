import { readMotionSettled, waitForForestSettled } from '../../../desktop/e2e/harness.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Parse the transform the browser is actually drawing, rather than recomputing camera state. */
export function parseForestCameraTransform(transform) {
  const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
  const match = new RegExp(`^translate\\((${number})[ ,]+(${number})\\)\\s*scale\\((${number})\\)$`, 'i')
    .exec(transform ?? '');
  if (!match) {
    throw new Error(`the delivered g.world-camera transform is not readable: ${String(transform)}`);
  }
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

export function sameForestCamera(left, right) {
  return left.tx === right.tx && left.ty === right.ty && left.scale === right.scale;
}

/** Read the camera from the rendered SVG. This is an attestation of delivery, not an input value. */
export async function readDeliveredForestCamera(page) {
  const transform = await page.locator('g.world-camera').getAttribute('transform');
  return { transform, ...parseForestCameraTransform(transform) };
}

/**
 * Cross a paint boundary, then wait for the app's real settled bridge and read back the camera.
 * A caller may supply the camera it asked the app to deliver; a mismatch makes the attestation red.
 */
export async function waitForForestMotionAndCamera(
  page,
  { timeout = DEFAULT_TIMEOUT_MS, expectedCamera } = {},
) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await waitForForestSettled(page, { timeout });
  const [snapshot, camera] = await Promise.all([
    readMotionSettled(page),
    readDeliveredForestCamera(page),
  ]);
  const cameraMatches = expectedCamera === undefined || sameForestCamera(expectedCamera, camera);
  return {
    ...snapshot,
    settled: snapshot.settled === true && cameraMatches,
    camera,
    cameraMatches,
  };
}

/**
 * Wait for a real, complete forest: app-attested motion settlement plus a corpus-size floor.
 * The floor remains a separate live-data guard; the old repeated count polling and sleep did not
 * prove camera settlement and is deliberately gone.
 */
export async function waitForStableForest(
  page,
  { label = 'forest', minIslands = 1, timeout = DEFAULT_TIMEOUT_MS } = {},
) {
  const attestation = await waitForForestMotionAndCamera(page, { timeout });
  if (!attestation.settled) {
    throw new Error(
      `${label}: the app did not attest a settled forest (reasons: ${attestation.reasons?.join(', ') || 'none reported'})`,
    );
  }
  const islands = await page.evaluate(
    () => new Set(
      [...document.querySelectorAll('[data-story-id]')]
        .map((element) => element.getAttribute('data-story-id'))
        .filter(Boolean),
    ).size,
  );
  if (islands < minIslands) {
    throw new Error(
      `${label}: only ${islands} islands rendered (floor ${minIslands}) — the map did not deliver the live corpus`,
    );
  }
  return { ...attestation, islands };
}
