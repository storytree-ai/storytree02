/**
 * What a build worker's child process may inherit from the spine's environment.
 *
 * ADR-0581 D1 keeps the limits that protect the outside world: no live store, secrets or network
 * beyond what the runtime adapter supplies. The CLI hydrates `CLAUDE_CODE_OAUTH_TOKEN` and
 * `STORYTREE_DB_USER` into the spine's own environment at startup (`packages/drive/src/secrets.ts`),
 * and a child inherits the whole of it unless it is handed something narrower. This module is
 * that something narrower.
 *
 * The two workers reach their environment differently, so they get different strengths:
 * - **The Codex worker has a shell.** Anything in its environment is one command away from the
 *   model, so it loses every secret-shaped name, every store pointer, and every git locator that
 *   would point its git straight at a repository (see {@link scrubShellWorkerEnv}).
 * - **The Claude worker has no shell.** Its environment reaches only the SDK's own child process,
 *   which authenticates with it, so it keeps its credentials and loses only the store pointers
 *   (see {@link scrubToolWorkerEnv}).
 *
 * Every match is case-insensitive, because Windows environment names are.
 */

/**
 * Pointers to the live store and to the credentials that open it. No worker needs any of them: a
 * worker authors files, and the spine alone persists evidence.
 * - `STORYTREE_DB_USER` — the Cloud SQL IAM identity the connector logs in as.
 * - `STORYTREE_STORE_URL` — the store's HTTP door (ADR-0259).
 * - `STORYTREE_SECRETS_FILE` — where the hydrator reads its secrets from.
 * - `GOOGLE_APPLICATION_CREDENTIALS` — an explicit credential file for Google client libraries.
 * - `DATABASE_URL` — the conventional connection string, password included when there is one.
 */
export const STORE_POINTER_ENV_NAMES: readonly string[] = [
  "STORYTREE_DB_USER",
  "STORYTREE_STORE_URL",
  "STORYTREE_SECRETS_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "DATABASE_URL",
];

/**
 * Variables that tell git where a repository is outright. Git's upward discovery is what
 * `GIT_CEILING_DIRECTORIES` stops; these skip discovery entirely, so a shell worker inheriting one
 * would reach the build's repository whatever the ceiling said. `GIT_CEILING_DIRECTORIES` itself is
 * on the list so an inherited value can never widen the one the Codex author sets.
 */
export const GIT_LOCATOR_ENV_NAMES: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
];

/**
 * A name that carries a credential by its shape: a token, a secret, a password, a credential, a
 * fused `APIKEY`, anything auth-shaped, or a cookie. Deliberately broad — stripping a harmless
 * `GIT_AUTHOR_NAME` costs a shell worker nothing, and missing a token costs the outside world.
 */
const SECRET_SHAPED_NAME = /TOKEN|SECRET|PASSW|PASSPHRASE|CREDENTIAL|APIKEY|AUTH|COOKIE/i;

/**
 * A `KEY` segment — `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `SIGNING_PRIVATE_KEY`, `KEY_FILE` — but
 * not a word that merely contains the letters (`MONKEY`, `KEYBOARD_LAYOUT`).
 */
const KEY_SEGMENT = /(?:^|_)KEY(?:_|$)/i;

/** libpq's connection variables (`PGHOST`, `PGUSER`, `PGPASSWORD`, …): each points at a database. */
const LIBPQ_NAME = /^PG[A-Z]+$/i;

/** True when a variable's NAME alone marks it as a credential or a database pointer. */
export function isSecretShapedEnvName(name: string): boolean {
  return SECRET_SHAPED_NAME.test(name) || KEY_SEGMENT.test(name) || LIBPQ_NAME.test(name);
}

function withoutNames(
  env: NodeJS.ProcessEnv,
  refuse: (name: string) => boolean,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => value !== undefined && !refuse(name)),
  );
}

function listed(names: readonly string[]): (name: string) => boolean {
  const folded = new Set(names.map((name) => name.toLowerCase()));
  return (name) => folded.has(name.toLowerCase());
}

const isStorePointer = listed(STORE_POINTER_ENV_NAMES);
const isGitLocator = listed(GIT_LOCATOR_ENV_NAMES);

/**
 * The environment a SHELL-bearing worker (Codex) may inherit: everything except secret-shaped
 * names, store pointers and git locators. What stays is what a shell and the Codex CLI need to run
 * at all — `PATH`, the home and profile directories Codex reads its ChatGPT login from, and the
 * system variables Windows needs — none of which opens anything.
 */
export function scrubShellWorkerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutNames(
    env,
    (name) => isSecretShapedEnvName(name) || isStorePointer(name) || isGitLocator(name),
  );
}

/**
 * The environment a TOOL-only worker (Claude, whose model has no shell) may inherit: everything
 * except the store pointers. Its credentials stay, because the SDK's own child process
 * authenticates with them and the model cannot read them.
 */
export function scrubToolWorkerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutNames(env, isStorePointer);
}
