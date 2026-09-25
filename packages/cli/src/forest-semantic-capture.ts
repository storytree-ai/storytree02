export type ForestTarget =
  | { kind: "square"; x: number; y: number; size: number }
  | { kind: "story-node"; id: string }
  | { kind: "island"; id: string }
  | { kind: "resting" }
  | { kind: "fit" };

type Camera = { tx: number; ty: number; scale: number };
type Viewport = { width: number; height: number };
type Padding = { top: number; right: number; bottom: number; left: number };
type CaptureReceipt = {
  ok: true;
  kind: ForestTarget["kind"];
  frame: Viewport;
  camera: Camera;
  resolved?: { id?: string; bounds?: { x: number; y: number; width: number; height: number } };
};
type Settled = { settled: boolean; phase: string; camera: Camera; serial: number };

type ForestBrowser = {
  capture(target: ForestTarget, viewport: Viewport, padding: Padding): Promise<CaptureReceipt>;
  settledAfter(camera: Camera): Promise<Settled>;
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type ForestSemanticCaptureDeps = {
  connect(studioUrl: string): Promise<ForestBrowser>;
  start(): Promise<{ browser: ForestBrowser; studioUrl: string; close(): Promise<void> }>;
  revision(): Promise<string | null>;
  writeCandidate(path: string, content: Uint8Array | string): Promise<void>;
  publish(path: string): Promise<void>;
  removeCandidate(path: string): Promise<void>;
  settledAfter?: (camera: Camera) => Promise<Settled>;
};

export type ForestSemanticCaptureResult = { ok: true } | { ok: false; code: string };

type Options = { studioUrl?: string; browser?: string; output: string; viewport: Viewport; padding: Padding; targets: ForestTarget[] };

function parseSquare(value: string): ForestTarget | undefined {
  const values = value.split(",").map(Number);
  if (values.length !== 3 || values.some((entry) => !Number.isFinite(entry))) return undefined;
  const [x, y, size] = values;
  if (x === undefined || y === undefined || size === undefined) return undefined;
  return { kind: "square", x, y, size };
}

function parseOptions(argv: string[]): Options | undefined {
  let studioUrl: string | undefined;
  let browser: string | undefined;
  let output: string | undefined;
  let viewport: Viewport | undefined;
  let padding: Padding | undefined;
  const targets: ForestTarget[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--resting") { targets.push({ kind: "resting" }); continue; }
    if (flag === "--fit") { targets.push({ kind: "fit" }); continue; }
    if (value === undefined) return undefined;
    index += 1;
    if (flag === "--studio-url") studioUrl = value;
    else if (flag === "--browser") browser = value;
    else if (flag === "--output") output = value;
    else if (flag === "--square") { const target = parseSquare(value); if (!target) return undefined; targets.push(target); }
    else if (flag === "--story") targets.push({ kind: "story-node", id: value });
    else if (flag === "--island") targets.push({ kind: "island", id: value });
    else if (flag === "--viewport") {
      const [width, height, ...rest] = value.split("x").map(Number);
      if (rest.length || !Number.isFinite(width) || !Number.isFinite(height) || width === undefined || height === undefined) return undefined;
      viewport = { width, height };
    } else if (flag === "--padding") {
      const values = value.split(",").map(Number);
      const [top, right, bottom, left] = values;
      if (values.length !== 4 || values.some((entry) => !Number.isFinite(entry)) || top === undefined || right === undefined || bottom === undefined || left === undefined) return undefined;
      padding = { top, right, bottom, left };
    } else return undefined;
  }
  if (!output || !viewport || !padding || targets.length === 0) return undefined;
  return { ...(studioUrl === undefined ? {} : { studioUrl }), ...(browser === undefined ? {} : { browser }), output, viewport, padding, targets };
}

const sameCamera = (left: Camera, right: Camera) => left.tx === right.tx && left.ty === right.ty && left.scale === right.scale;

export async function captureForestSemantics(argv: string[], deps: ForestSemanticCaptureDeps): Promise<ForestSemanticCaptureResult> {
  const options = parseOptions(argv);
  if (!options) return { ok: false, code: "invalid-target" };
  let browser: ForestBrowser;
  let owned: { browser: ForestBrowser; close(): Promise<void> } | undefined;
  try {
    if (options.studioUrl !== undefined) browser = await deps.connect(options.studioUrl);
    else if (options.browser !== undefined) browser = await deps.connect("http://served-studio.test");
    else { owned = await deps.start(); browser = owned.browser; }
    const revision = await deps.revision();
    if (!revision) return { ok: false, code: "revision-ambiguous" };
    for (const [index, target] of options.targets.entries()) {
      const seam = await browser.capture(target, options.viewport, options.padding);
      const settled = await browser.settledAfter(seam.camera);
      if (!settled.settled || !sameCamera(seam.camera, settled.camera)) return { ok: false, code: "unsettled-page" };
      const stem = `${options.output}/forest-${index + 1}`;
      const png = `${stem}.png`;
      const json = `${stem}.json`;
      try {
        await deps.writeCandidate(png, await browser.screenshot());
        await deps.writeCandidate(json, JSON.stringify({ requested: target, resolved: seam.resolved, applied: seam.camera, viewport: options.viewport, padding: options.padding, revision, settled }));
        await deps.publish(png);
        await deps.publish(json);
      } catch {
        await deps.removeCandidate(png);
        await deps.removeCandidate(json);
        return { ok: false, code: "screenshot-failed" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "capture-failed" };
  } finally {
    if (owned) {
      await browser!.close();
      await owned.close();
    }
  }
}
