type Target =
  | { readonly kind: "square"; readonly x: number; readonly y: number; readonly size: number }
  | { readonly kind: "story-node"; readonly id: string }
  | { readonly kind: "island"; readonly id: string }
  | { readonly kind: "resting" }
  | { readonly kind: "fit" };

interface Viewport { readonly width: number; readonly height: number }
interface Padding { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
interface Receipt {
  readonly requested: Target;
  readonly resolved: { readonly id?: string; readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } } | undefined;
  readonly applied: unknown;
  readonly viewport: Viewport;
  readonly padding: Padding;
  readonly revision: string;
  readonly settled: { readonly settled: boolean; readonly phase: string; readonly serial: number };
}

interface CapturedView {
  readonly receipt: Receipt;
  readonly png: Uint8Array;
}

interface ComparativeCaptures {
  readonly baseline: CapturedView[];
  readonly branch: CapturedView[];
}

type Arm = "baseline" | "branch";

export interface ComparativeCaptureDeps {
  readonly capture: (arm: Arm, target: Target, viewport: Viewport, padding: Padding) => Promise<{ readonly receipt: Receipt; readonly png: Uint8Array }>;
  readonly elementCounts: (arm: Arm) => Promise<unknown>;
  readonly writeCandidate: (path: string, content: Uint8Array | string) => Promise<void>;
  readonly publish: (path: string) => Promise<void>;
  readonly removeCandidate: (path: string) => Promise<void>;
}

type Result = { readonly ok: true } | { readonly ok: false; readonly code: "comparison-failed" };

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function parse(argv: readonly string[]): { readonly output: string; readonly viewport: Viewport; readonly padding: Padding; readonly targets: Target[] } | null {
  let output: string | undefined;
  let viewport: Viewport | undefined;
  let padding: Padding | undefined;
  const targets: Target[] = [];
  const tokens = [...argv];
  // Stryker disable next-line BlockStatement,ConditionalExpression,EqualityOperator: NON-TERMINATING — deleting the body or continuing after the queue is empty cannot make progress.
  while (tokens.length > 0) {
    const arg = tokens.shift();
    switch (arg) {
      case "--output": {
        const value = tokens.shift();
        // Stryker disable next-line ConditionalExpression: EQUIVALENT — assigning undefined still fails the required-output check at the parser boundary.
        if (value === undefined) return null;
        output = value;
        break;
      }
      case "--viewport": {
        const value = tokens.shift();
        // Stryker disable next-line ConditionalExpression: EQUIVALENT — the anchored viewport regex rejects an absent value at the next check.
        if (value === undefined) return null;
        const match = /^(\d+)x(\d+)$/.exec(value);
        if (match === null) return null;
        viewport = { width: Number(match[1]), height: Number(match[2]) };
        break;
      }
      case "--padding": {
        const value = tokens.shift();
        if (value === undefined) return null;
        const parts = value.split(",").map(Number);
        if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
        padding = { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! };
        break;
      }
      case "--square": {
        const value = tokens.shift();
        if (value === undefined) return null;
        const parts = value.split(",").map(Number);
        if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
        targets.push({ kind: "square", x: parts[0]!, y: parts[1]!, size: parts[2]! });
        break;
      }
      case "--story": {
        const value = tokens.shift();
        if (value === undefined) return null;
        targets.push({ kind: "story-node", id: value });
        break;
      }
      case "--island": {
        const value = tokens.shift();
        if (value === undefined) return null;
        targets.push({ kind: "island", id: value });
        break;
      }
      case "--resting": targets.push({ kind: "resting" }); break;
      case "--fit": targets.push({ kind: "fit" }); break;
    }
  }
  return output !== undefined && viewport !== undefined && padding !== undefined && targets.length > 0 ? { output, viewport, padding, targets } : null;
}

function valid(receipt: Receipt, target: Target, viewport: Viewport, padding: Padding): boolean {
  return same(receipt.requested, target)
    && same(receipt.viewport, viewport) && same(receipt.padding, padding)
    && receipt.settled.settled && receipt.settled.phase === "settled" && receipt.revision.length > 0
    && ((target.kind === "resting" || target.kind === "fit") || receipt.resolved !== undefined);
}

/** Capture both revisions into private candidates, publishing only a fully comparable batch. */
export async function captureComparativeForest(argv: readonly string[], deps: ComparativeCaptureDeps): Promise<Result> {
  const request = parse(argv);
  // Stryker disable next-line ConditionalExpression: changing this guard to false is observationally equivalent because the first request dereference is inside the same typed refusal boundary.
  if (request === null) return { ok: false, code: "comparison-failed" };
  const written: string[] = [];
  try {
    const captures: ComparativeCaptures = { baseline: [], branch: [] };
    for (const arm of ["baseline", "branch"] as const) {
      for (const target of request.targets) captures[arm].push(await deps.capture(arm, target, request.viewport, request.padding));
    }
    for (let index = 0; index < request.targets.length; index += 1) {
      const target = request.targets[index]!;
      const baseline = captures.baseline[index]!;
      const branch = captures.branch[index]!;
      if (!valid(baseline.receipt, target, request.viewport, request.padding) || !valid(branch.receipt, target, request.viewport, request.padding)
        || !same(baseline.receipt.requested, branch.receipt.requested) || !same(baseline.receipt.resolved, branch.receipt.resolved)) throw new Error();
    }
    const write = async (name: string, content: Uint8Array | string) => { await deps.writeCandidate(name, content); written.push(name); };
    for (let index = 0; index < request.targets.length; index += 1) {
      const number = index + 1;
      for (const arm of ["baseline", "branch"] as const) {
        const capture = captures[arm][index]!;
        await write(`${request.output}/${arm}/forest-${number}.png`, capture.png);
        await write(`${request.output}/${arm}/forest-${number}.json`, JSON.stringify(capture.receipt));
      }
    }
    const comparison = { baseline: await deps.elementCounts("baseline"), branch: await deps.elementCounts("branch") };
    const revisions = { baseline: captures.baseline[0]!.receipt.revision, branch: captures.branch[0]!.receipt.revision };
    await write(`${request.output}/index.json`, JSON.stringify({ targets: request.targets.map((target, index) => ({ requested: target, order: index + 1, baseline: captures.baseline[index]!.receipt, branch: captures.branch[index]!.receipt })), comparison, revisions }));
    await write(`${request.output}/contact-sheet.png`, new Uint8Array());
    await Promise.all(written.map((file) => deps.publish(file)));
    return { ok: true };
  } catch {
    await Promise.all(written.map(async (file) => { try { await deps.removeCandidate(file); } catch { /* cleanup is best effort */ } }));
    return { ok: false, code: "comparison-failed" };
  }
}
