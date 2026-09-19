import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GIT_LOCATOR_ENV_NAMES,
  isSecretShapedEnvName,
  scrubShellWorkerEnv,
  scrubToolWorkerEnv,
  STORE_POINTER_ENV_NAMES,
} from "./worker-env.js";

/** Names that carry a credential by their shape, one per branch of the rule. */
const SECRET_SHAPED = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_CLIENT_SECRET",
  "DB_PASSWORD",
  "SMTP_PASSWD",
  "GPG_PASSPHRASE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
  "ANTHROPIC_APIKEY",
  "AWS_ACCESS_KEY_ID",
  "SIGNING_PRIVATE_KEY",
  "NODE_AUTH_TOKEN",
  "SSH_AUTH_SOCK",
  "SESSION_COOKIE",
  "SSH_KEY",
  "KEY_FILE",
  "PGPASSWORD",
  "PGHOST",
  "pguser",
];

/** Names a worker process needs to run at all, none of which opens anything. */
const BENIGN = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "CODEX_HOME",
  "STORYTREE_CODEX_EXECUTABLE",
  "STORYTREE_CODEX_TIMEOUT_MS",
  "HTTPS_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "KEYBOARD_LAYOUT",
  "MONKEY",
  "PGP_HOME_1",
  "UPGRADE",
  "PG",
];

test("isSecretShapedEnvName: every credential-shaped name is caught, in any case", () => {
  for (const name of SECRET_SHAPED) {
    assert.equal(isSecretShapedEnvName(name), true, `${name} should be secret-shaped`);
    assert.equal(isSecretShapedEnvName(name.toLowerCase()), true, `${name} lower-cased`);
  }
});

test("isSecretShapedEnvName: the names a worker needs to run are not", () => {
  for (const name of BENIGN) {
    assert.equal(isSecretShapedEnvName(name), false, `${name} should not be secret-shaped`);
  }
});

test("the store pointers are exactly the live store's identity, its door, the secrets file, and the two ambient credentials", () => {
  assert.deepEqual(STORE_POINTER_ENV_NAMES, [
    "STORYTREE_DB_USER",
    "STORYTREE_STORE_URL",
    "STORYTREE_SECRETS_FILE",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "DATABASE_URL",
  ]);
});

test("the git locators are every variable that points git at a repository, and the ceiling itself", () => {
  assert.deepEqual(GIT_LOCATOR_ENV_NAMES, [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
  ]);
});

test("scrubShellWorkerEnv: secrets, store pointers and git locators go; everything else stays", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "C:\\bin",
    USERPROFILE: "C:\\Users\\dev",
    CODEX_HOME: "C:\\Users\\dev\\.codex",
    CLAUDE_CODE_OAUTH_TOKEN: "secret",
    OPENAI_API_KEY: "secret",
    STORYTREE_DB_USER: "dev@example.com",
    storytree_store_url: "https://door.example",
    STORYTREE_SECRETS_FILE: "C:\\Users\\dev\\.storytree\\secrets.json",
    DATABASE_URL: "postgres://u:p@h/db",
    GIT_DIR: "C:\\repo\\.git",
    git_work_tree: "C:\\repo",
    GIT_CEILING_DIRECTORIES: "C:\\",
    UNSET: undefined,
  };
  assert.deepEqual(scrubShellWorkerEnv(env), {
    PATH: "C:\\bin",
    USERPROFILE: "C:\\Users\\dev",
    CODEX_HOME: "C:\\Users\\dev\\.codex",
  });
});

test("scrubShellWorkerEnv: every listed store pointer and git locator goes, whatever its case", () => {
  for (const name of [...STORE_POINTER_ENV_NAMES, ...GIT_LOCATOR_ENV_NAMES]) {
    for (const spelled of [name, name.toLowerCase()]) {
      assert.deepEqual(scrubShellWorkerEnv({ [spelled]: "x", PATH: "p" }), { PATH: "p" }, spelled);
    }
  }
});

test("scrubToolWorkerEnv: only the store pointers go, so the SDK keeps its own credentials", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/bin",
    CLAUDE_CODE_OAUTH_TOKEN: "kept — the SDK authenticates with it",
    ANTHROPIC_API_KEY: "kept",
    GIT_DIR: "/repo/.git",
    STORYTREE_DB_USER: "dev@example.com",
    Storytree_Store_Url: "https://door.example",
    STORYTREE_SECRETS_FILE: "/home/dev/.storytree/secrets.json",
    GOOGLE_APPLICATION_CREDENTIALS: "/home/dev/key.json",
    DATABASE_URL: "postgres://u:p@h/db",
    UNSET: undefined,
  };
  assert.deepEqual(scrubToolWorkerEnv(env), {
    PATH: "/bin",
    CLAUDE_CODE_OAUTH_TOKEN: "kept — the SDK authenticates with it",
    ANTHROPIC_API_KEY: "kept",
    GIT_DIR: "/repo/.git",
  });
});

test("neither scrub mutates the environment it is given", () => {
  const env: NodeJS.ProcessEnv = { PATH: "p", STORYTREE_DB_USER: "u", GITHUB_TOKEN: "t" };
  scrubShellWorkerEnv(env);
  scrubToolWorkerEnv(env);
  assert.deepEqual(env, { PATH: "p", STORYTREE_DB_USER: "u", GITHUB_TOKEN: "t" });
});
