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

export type ForestCaptureExecFile = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly windowsHide: boolean; readonly maxBuffer: number },
  callback: (
    error: { readonly code?: string | number } | null,
    stdout: string,
    stderr: string,
  ) => void,
) => void;

export interface ForestCaptureProcessRuntime {
  readonly execFile: ForestCaptureExecFile;
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

type ForestAction = "capture" | "compare";

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
  return {
    invoke: (argv) => {
      const script = path.join(studioDir, "scripts", argv[1] === "compare" ? "comparative-capture.mjs" : "semantic-capture.mjs");
      return new Promise((resolve) => {
        runtime.execFile(
          runtime.executable,
          ["--import", preload, "--import", tsxLoader, script, ...argv],
          // Preserve the CLI's path contract: a relative --output is relative to the caller, even
          // though the driver and loader are resolved absolutely from Storytree's own checkout.
          { cwd: runtime.cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const code = error?.code;
            const status = typeof code === "number" ? code : error === null ? 0 : 1;
            resolve({ status, stdout, stderr });
          },
        );
      });
    },
  };
}

/** The Studio driver is the only process that imports Playwright. The CLI owns dispatch, not a browser. */
export function defaultForestCaptureCommandDeps(repoRoot: string): ForestCaptureCommandDeps {
  return forestCaptureProcessDeps(repoRoot, defaultForestCaptureProcessRuntime());
}

/** Exported so the otherwise side-effectful Node adapter can be checked without starting a child. */
export function defaultForestCaptureProcessRuntime(): ForestCaptureProcessRuntime {
  return {
    execFile: execFile as ForestCaptureExecFile,
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

export function forestCompareHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree forest compare — capture identical semantic forest views on baseline and branch.",
      "",
      "  storytree forest compare --output <dir> --viewport <WxH> --padding <t,r,b,l> <targets...>",
      "",
      "Targets are required, repeatable, and run in the order written:",
      "  --square <x,y,size>   frame an exact world-space square",
      "  --story <id>          centre a story node",
      "  --island <id>         fit a story island",
      "  --resting             use the designed resting camera",
      "  --fit                 fit the whole forest",
      "",
      "One Chromium process keeps one page per revision across the whole target batch. Publication",
      "fails closed unless every paired receipt names the same target, frame, padding, and resolved",
      "subject. The output includes paired PNG/JSON evidence, index.json, and contact-sheet.png.",
      "Pass --force to run when the branch render-surface trigger would otherwise skip capture.",
    ].join("\n"),
    next: [
      "storytree forest compare --output .gate-logs/forest-compare --viewport 1600x1000 --padding 32,32,32,32 --story <id> --fit --force",
    ],
  };
}

export function forestHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree forest — deterministic forest framing and review evidence without mouse panning.",
      "",
      "  capture   screenshot semantic targets on one served revision",
      "  compare   screenshot the same semantic targets on baseline and branch",
      "",
      "Run storytree forest capture --help or storytree forest compare --help for target syntax.",
    ].join("\n"),
    next: ["storytree forest capture --help", "storytree forest compare --help"],
  };
}

/** Forward the ORIGINAL argv: target order is semantic and parseArgs' value map cannot retain it. */
export async function forestCaptureCommand(
  argv: readonly string[],
  deps: ForestCaptureCommandDeps,
): Promise<Envelope> {
  return forestActionCommand("capture", argv, deps);
}

export async function forestCompareCommand(
  argv: readonly string[],
  deps: ForestCaptureCommandDeps,
): Promise<Envelope> {
  return forestActionCommand("compare", argv, deps);
}

async function forestActionCommand(
  action: ForestAction,
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
    const noun = action === "compare" ? "compared" : "captured";
    return {
      ok: true,
      body: `${noun} ${String(payload.captures ?? 0)} forest frame(s) in ${payload.output ?? "the requested output directory"}`,
      next: payload.output
        ? [action === "compare" ? `inspect ${payload.output}/contact-sheet.png and index.json` : `inspect ${payload.output}/forest-1.json beside its PNG`]
        : [],
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
    body: `forest ${action} refused (${payload?.code ?? "driver-failed"}): ${detail}`,
    next: [`storytree forest ${action} --help`],
  };
}
