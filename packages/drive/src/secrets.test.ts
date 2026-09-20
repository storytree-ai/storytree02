import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { scrubShellWorkerEnv, scrubToolWorkerEnv } from "@storytree/agent";

import { defaultSecretsFile, loadLocalSecrets, presentEnv, SECRET_KEYS } from "./secrets.js";

function withFixture(content: string | null, env: NodeJS.ProcessEnv): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytree-secrets-"));
  const file = path.join(dir, "secrets.json");
  try {
    if (content !== null) fs.writeFileSync(file, content);
    return loadLocalSecrets({ ...env, STORYTREE_SECRETS_FILE: file });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("fills only unset known keys from the file; env always wins", () => {
  const env: NodeJS.ProcessEnv = { STORYTREE_DB_USER: "already@set.example" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytree-secrets-"));
  const file = path.join(dir, "secrets.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      CLAUDE_CODE_OAUTH_TOKEN: "tok-from-file",
      CURSOR_API_KEY: "cursor-from-file",
      STORYTREE_DB_USER: "file@user.example",
      NOT_A_KNOWN_KEY: "must-not-leak",
    }),
  );
  const target: NodeJS.ProcessEnv = { ...env, STORYTREE_SECRETS_FILE: file };
  const filled = loadLocalSecrets(target);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(filled, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.equal(target["CLAUDE_CODE_OAUTH_TOKEN"], "tok-from-file");
  assert.equal(target["CURSOR_API_KEY"], undefined); // retired (ADR-0198) — not hydrated
  assert.equal(target["STORYTREE_DB_USER"], "already@set.example"); // env wins
  assert.equal(target["NOT_A_KNOWN_KEY"], undefined); // no arbitrary injection
});

test("missing file, malformed JSON, and non-object payloads are silent no-ops", () => {
  assert.deepEqual(withFixture(null, {}), []);
  assert.deepEqual(withFixture("not json {", {}), []);
  assert.deepEqual(withFixture('"just a string"', {}), []);
  assert.deepEqual(withFixture(JSON.stringify({ CLAUDE_CODE_OAUTH_TOKEN: "   " }), {}), []); // blank refused
});

test("the default location is ~/.storytree/secrets.json and the key list is exact", () => {
  assert.equal(defaultSecretsFile(), path.join(os.homedir(), ".storytree", "secrets.json"));
  assert.deepEqual([...SECRET_KEYS], ["CLAUDE_CODE_OAUTH_TOKEN", "STORYTREE_DB_USER"]);
});

// ---------------------------------------------------------------------------
// blank-is-unset (the credential read path)
// ---------------------------------------------------------------------------

test("presentEnv reads a blank or whitespace-only value as UNSET, and trims a real one", () => {
  // The house precedent, applied to credentials: `resolveRepoRoot`'s `usable()` already settled the
  // identical question for paths, on the reasoning that `VAR=` is how a shell says "not configured".
  const env: NodeJS.ProcessEnv = { EMPTY: "", SPACES: "   ", TABBED: "\t\n", REAL: "  iam@example.com  " };
  assert.equal(presentEnv("EMPTY", env), undefined);
  assert.equal(presentEnv("SPACES", env), undefined);
  assert.equal(presentEnv("TABBED", env), undefined);
  assert.equal(presentEnv("ABSENT", env), undefined);
  assert.equal(presentEnv("REAL", env), "iam@example.com");
});

test("RED→GREEN: a BLANK env value is hydrated over, so a mangled export self-heals", () => {
  // The measured failure: `STORYTREE_DB_USER=` (a shell-mangled command substitution) read as PRESENT,
  // which SUPPRESSED the very hydration that would have fixed it, travelled to the connector, and came
  // back as `{"store":"pg","db":"unreachable"}` — ~25 minutes on a database that was never down.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytree-secrets-"));
  const file = path.join(dir, "secrets.json");
  fs.writeFileSync(file, JSON.stringify({ STORYTREE_DB_USER: "file@user.example" }));
  const target: NodeJS.ProcessEnv = { STORYTREE_DB_USER: "", STORYTREE_SECRETS_FILE: file };
  const filled = loadLocalSecrets(target);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(filled, ["STORYTREE_DB_USER"]);
  assert.equal(target["STORYTREE_DB_USER"], "file@user.example");
});

test("env-always-wins is PRESERVED for every non-blank value", () => {
  // The one behaviour with any reach is that a blank is now overwritten. A real value must still win,
  // or this would have quietly changed the precedence the whole credential model rests on.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytree-secrets-"));
  const file = path.join(dir, "secrets.json");
  fs.writeFileSync(file, JSON.stringify({ STORYTREE_DB_USER: "file@user.example" }));
  const target: NodeJS.ProcessEnv = { STORYTREE_DB_USER: "real@set.example", STORYTREE_SECRETS_FILE: file };
  const filled = loadLocalSecrets(target);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(filled, []);
  assert.equal(target["STORYTREE_DB_USER"], "real@set.example");
});

test("a whitespace-only export is a gap too — hydration is not fooled by `VAR='   '`", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytree-secrets-"));
  const file = path.join(dir, "secrets.json");
  fs.writeFileSync(file, JSON.stringify({ STORYTREE_DB_USER: "file@user.example" }));
  const target: NodeJS.ProcessEnv = { STORYTREE_DB_USER: "   ", STORYTREE_SECRETS_FILE: file };
  loadLocalSecrets(target);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(target["STORYTREE_DB_USER"], "file@user.example");
});

/**
 * The hydrator fills these keys into the spine's own environment, and a build worker inherits the
 * spine's environment through the leaf that launches it (ADR-0581 D1, ADR-0583). So every key added
 * here must be one the worker scrubs — or the worker gains a credential nobody decided to give it.
 * The agent package cannot import this list (it imports no other storytree package), so the check
 * lives on this side of the edge.
 */
test("every hydrated secret is kept from the Codex worker's shell", () => {
  for (const key of SECRET_KEYS) {
    assert.deepEqual(scrubShellWorkerEnv({ [key]: "hydrated", PATH: "p" }), { PATH: "p" }, key);
  }
});

test("every hydrated secret except the Claude worker's own SDK credential is kept from the Claude worker", () => {
  // CLAUDE_CODE_OAUTH_TOKEN is how the SDK process authenticates; the Claude worker's model has no
  // shell to read it with. Every OTHER hydrated key must go.
  const sdkOwnCredential = "CLAUDE_CODE_OAUTH_TOKEN";
  assert.ok(SECRET_KEYS.includes(sdkOwnCredential));
  for (const key of SECRET_KEYS) {
    const expected = key === sdkOwnCredential ? { [key]: "hydrated", PATH: "p" } : { PATH: "p" };
    assert.deepEqual(scrubToolWorkerEnv({ [key]: "hydrated", PATH: "p" }), expected, key);
  }
});
