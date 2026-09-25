import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Envelope } from "./envelope.js";

export interface ForestCaptureProcessResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ForestCaptureCommandDeps {
  readonly invoke: (argv: readonly string[]) => Promise<ForestCaptureProcessResult>;
}

export interface ForestCaptureProcessRuntime {
  readonly execFile: typeof execFile;
  readonly executable: string;
  readonly cwd: string;
}

interface ScriptResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly output?: string;
  readonly captures?: number;
  readonly message?: string;
}

/** Build the process boundary separately so its executable, imports and caller-relative cwd are observable. */
export function forestCaptureProcessDeps(
  repoRoot: string,
  runtime: ForestCaptureProcessRuntime,
): ForestCaptureCommandDeps {
  const studioDir = path.join(repoRoot, "apps", "studio");
  const preload = pathToFileURL(path.join(repoRoot, "scripts", "tsx-cache-off.mjs")).href;
  // Resolve from Studio explicitly. The workspace root intentionally has no `tsx` symlink, while
  // this child must keep the caller's cwd so a relative --output remains relative to the invocation.
  const tsxLoader = pathToFileURL(path.join(studioDir, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const script = path.join(studioDir, "scripts", "semantic-capture.mjs");
  return {
    invoke: (argv) =>
      // Stryker disable next-line BlockStatement: NON-TERMINATING — deleting the Promise executor leaves invoke pending forever.
      new Promise((resolve) => {
        runtime.execFile(
          runtime.executable,
          ["--import", preload, "--import", tsxLoader, script, ...argv],
          // Preserve the CLI's path contract: a relative --output is relative to the caller, even
          // though the driver and loader are resolved absolutely from Storytree's own checkout.
          { cwd: runtime.cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          // Stryker disable next-line BlockStatement: NON-TERMINATING — deleting the callback body leaves invoke pending forever.
          (error, stdout, stderr) => {
            const code = error?.code;
            const status = typeof code === "number" ? code : error === null ? 0 : 1;
            resolve({ status, stdout, stderr });
          },
        );
      }),
  };
}

/** The Studio driver is the only process that imports Playwright. The CLI owns dispatch, not a browser. */
export function defaultForestCaptureCommandDeps(repoRoot: string): ForestCaptureCommandDeps {
  return forestCaptureProcessDeps(repoRoot, defaultForestCaptureProcessRuntime());
}

/** Exported so the otherwise side-effectful Node adapter can be checked without starting a child. */
export function defaultForestCaptureProcessRuntime(): ForestCaptureProcessRuntime {
  return {
    execFile,
    executable: process.execPath,
    cwd: process.cwd(),
  };
}

export function forestCaptureHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree forest capture — frame and screenshot named forest subjects without mouse input.",
      "",
      "  storytree forest capture --output <dir> --viewport <WxH> --padding <t,r,b,l> <targets...>",
      "",
      "Targets are repeatable and run in the order written:",
      "  --square <x,y,size>   frame an exact world-space square",
      "  --story <id>          centre a story node",
      "  --island <id>         fit a story island",
      "  --resting             use the designed resting camera",
      "  --fit                 fit the whole forest",
      "",
      "Session options:",
      "  --studio-url <url>    reuse an already-running Studio",
      "  --browser <cdp-url>   reuse a compatible Chromium CDP endpoint",
      "",
      "One browser session serves every target. Each successful target publishes forest-N.png and",
      "forest-N.json together; a target that cannot be resolved or attested settled publishes neither.",
    ].join("\n"),
    next: [
      "storytree forest capture --output .gate-logs/forest --viewport 1600x1000 --padding 32,32,32,32 --fit",
    ],
  };
}

/** Forward the ORIGINAL argv: target order is semantic and parseArgs' value map cannot retain it. */
export async function forestCaptureCommand(
  argv: readonly string[],
  deps: ForestCaptureCommandDeps,
): Promise<Envelope> {
  const result = await deps.invoke(argv);
  let payload: ScriptResult | null = null;
  try {
    payload = JSON.parse(result.stdout.trim()) as ScriptResult;
  } catch {
    // A malformed/missing script envelope is a refusal even if the child happened to exit zero.
  }
  if (result.status === 0 && payload?.ok === true) {
    return {
      ok: true,
      body: `captured ${String(payload.captures ?? 0)} forest frame(s) in ${payload.output ?? "the requested output directory"}`,
      next: payload.output ? [`inspect ${payload.output}/forest-1.json beside its PNG`] : [],
    };
  }
  const details = [payload?.message, result.stderr.trim()].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const detail = details.length > 0
    ? details.join("\n")
    : "the Studio capture driver returned no diagnostic";
  return {
    ok: false,
    body: `forest capture refused (${payload?.code ?? "driver-failed"}): ${detail}`,
    next: ["storytree forest capture --help"],
  };
}
