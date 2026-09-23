// Type declarations for the pure helpers simulate-ci-checkout.mjs exports, so a TS test (and
// `tsc --noEmit`) can import them without `allowJs` — the same arrangement as
// scripts/resolve-bun.d.mts. A SECOND SURFACE THAT MUST AGREE WITH THE FIRST: change both together.

export const CI_ENV_KEYS: readonly string[];
export const USAGE: string;

export interface SimulationOptions {
  script: string;
  head: string;
  base: string;
  keep: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): SimulationOptions | { help: true } | { error: string };

export function ciEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;
export function localEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;

export interface SimulationStep {
  label: string;
  cmd: "git" | "pnpm";
  args: string[];
  cwd: string;
  env: "plain" | "ci" | "local";
  /** Present on the two check runs only: which exit code this step's status is recorded as. */
  run?: "ci" | "local";
}

export function planSimulation(input: {
  repoRoot: string;
  scratch: string;
  headSha: string;
  baseSha: string;
  script: string;
}): SimulationStep[];

export function formatReport(input: {
  script: string;
  headSha: string;
  baseSha: string;
  ciCode: number | null | undefined;
  localCode: number | null | undefined;
}): string;
