// Type declarations for the pure helpers resolve-bun.mjs exports, so a TS test (and `tsc --noEmit`)
// can import them without `allowJs` — the same arrangement as scripts/resolve-bash.d.mts. The
// resolver itself stays plain Node ESM (no tsx/deps) by design, because `pnpm gate:bg` must start
// before any toolchain does; this sibling only types the exported surface.

/** A process environment, as `process.env` presents one. */
export type BunEnv = Readonly<Record<string, string | undefined>>;

/** Whether a path exists — injected so tests drive real cases, not this box's installs. */
export type ExistsProbe = (candidate: string) => boolean;

/** What the launcher should do about Bun before spawning the detached child. */
export type BunResolution =
  /** The inherited environment already resolves `bun`; change nothing. */
  | { readonly status: "on-path"; readonly dir: string }
  /** Bun is installed where its installer puts it, but this PATH predates it; prepend `dir`. */
  | { readonly status: "prepend"; readonly dir: string }
  /** No Bun anywhere; `message` names the repair and the caller refuses rather than dispatching. */
  | { readonly status: "absent"; readonly message: string };

/**
 * The names a Bun executable goes by on `platform` — Windows needs the extensions spelled out,
 * because PATH resolution there is PATHEXT-driven.
 */
export function bunExecutableNames(platform: string): string[];

/** The directory on `env`'s PATH holding a Bun executable, or undefined when none does. */
export function bunDirOnPath(env: BunEnv, platform: string, exists?: ExistsProbe): string | undefined;

/**
 * The standard per-user Bun bin directory (`~/.bun/bin`) — but only when it actually holds an
 * executable, so a phantom directory is never prepended.
 */
export function userBunBinDir(env: BunEnv, platform: string, exists?: ExistsProbe): string | undefined;

/** {@link BunResolution} for `env` — see resolve-bun.mjs for why this stats rather than invokes. */
export function resolveBunForChild(
  env: BunEnv,
  platform?: string,
  exists?: ExistsProbe,
): BunResolution;
