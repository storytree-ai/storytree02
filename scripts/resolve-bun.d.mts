// Type declarations for the pure helpers resolve-bun.mjs exports, so a TS test (and `tsc --noEmit`)
// can import them without `allowJs` — the same arrangement as scripts/resolve-bash.d.mts and
// scripts/studio.d.mts. The resolver itself stays plain Node ESM (no tsx, no deps) by design,
// because `pnpm gate:bg` must start before any toolchain does; this sibling only types the
// exported surface.
//
// ⚠ IT IS A SECOND SURFACE THAT MUST AGREE WITH A FIRST, which is ADR-0251's class — so treat a
// change to either half as a change to both. `bun test` is transpile-only and will happily run the
// suite against a signature that no longer exists: these declarations were added because
// `tsc --noEmit` failed on the import while 36 tests passed green.

/** The standard per-user Bun bin directory, relative to a home directory (e.g. `.bun/bin`). */
export const BUN_BIN_SUBPATH: string;

/** The executable names to look for on this platform, most specific first. */
export function bunExecutableNames(platform: string): string[];

/**
 * The first `bun` executable on a PATH value, or `undefined` — the child's own lookup, reproduced.
 *
 * `exists` is injected so every branch is provable on a machine whose real answer is fixed.
 */
export function findBunOnPath(
  pathValue: string | undefined,
  platform: string,
  exists: (candidate: string) => boolean,
): string | undefined;

/** The PATH variable's name in this environment, which is case-insensitive on Windows. */
export function pathVariableName(env: Record<string, string | undefined>, platform: string): string;

/** The inherited PATH already resolves Bun; nothing to do. */
export interface BunOnPath {
  readonly status: "on-path";
  readonly executable: string;
  readonly pathKey: string;
}

/** Bun is absent from the inherited PATH but present in the standard per-user bin directory. */
export interface BunNeedsPrepend {
  readonly status: "prepend";
  readonly dir: string;
  readonly executable: string;
  readonly pathKey: string;
}

/** No resolvable Bun. `message` names what was searched and the repair. */
export interface BunAbsent {
  readonly status: "absent";
  readonly pathKey: string;
  readonly message: string;
}

export type BunResolution = BunOnPath | BunNeedsPrepend | BunAbsent;

/** Can the child resolve `bun`, and if not, what should the caller do about it? */
export function resolveBunForChild(input: {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly exists?: (candidate: string) => boolean;
}): BunResolution;

/**
 * The child's environment with the repair applied — a NEW object, never a mutation of the input.
 * Returns a plain copy for any resolution other than `prepend`.
 */
export function withBunOnPath(
  env: Record<string, string | undefined>,
  resolution: BunResolution,
  platform: string,
): Record<string, string | undefined>;
