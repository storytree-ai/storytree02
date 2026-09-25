# Onboarding — the one-liner installer (ADR-0207 D1)

One script. It takes a Windows machine that has nothing to a cloned, provisioned checkout in eight
idempotent steps, each carrying a `# @step:` name so a repair can be asked for by name:

| Script | Platform | Persona | Ends with |
| --- | --- | --- | --- |
| [`install.ps1`](install.ps1) | Windows (PowerShell 5.1+) | **explorer** (read-only) | `storytree doctor`, then launches the desktop app |

`infra/install.ps1` is the single re-runnable command an owner sends a trusted dev to onboard them
as an **explorer** (read-only) on Windows. The dev pastes it and enters one GitHub device code;
everything else is automatic and idempotent.

**There is no Linux installer, and that is a decision rather than a gap (ADR-0432).**
`infra/install.sh` existed for two days and was deleted: it was never executed, never published, and
was aimed at the wrong reader. A Linux dev box is provisioned by following
[`docs/machine-onboarding.md`](../docs/machine-onboarding.md), whose by-hand steps ARE the mechanism
there — the Linux consumer is an agent with the owner at the keyboard, which needs telling what to
install and how to prove it, not a script to invoke. macOS is covered by nothing.

> **Owner:** the full invite ceremony — the two access grants plus this message —
> is [`explorer-invite.md`](explorer-invite.md).

> ⚠ **The EXPLORER persona is probably not what you want if you are provisioning a machine to do
> WORK on.** An explorer gets a read-only checkout, their own Claude subscription and the desktop
> app. It has no database access, no `~/.storytree/secrets.json`, no worktree setup and no
> write-authority wall — so a machine set up this way can read the project and cannot build it.
> Provisioning a full development box is
> [`docs/machine-onboarding.md`](../docs/machine-onboarding.md), which does its own bootstrap and
> then keeps going. The distinction has misled at least one reader; if
> you found this file first, follow that link before running anything.

## What `install.ps1` does (Windows)

In dependency order, each step no-ops when already satisfied (see *Idempotency* below):

1. **git** — installs Git via winget if absent.
2. **node** — ensures Node 24+ (the workspace engine floor); brings corepack.
3. **pnpm** — activates pnpm 9 via corepack.
4. **gh-cli** — installs the GitHub CLI (drives the device sign-in).
5. **github-auth** — GitHub device sign-in (the one code the dev enters). Read access comes from
   the owner-granted **Read** role on the `storytree-ai` org (ADR-0207 D2).
6. **clone** — clones the read-only checkout (`storytree-ai/storytree02`, renamed from `Storytree` per ADR-0622) to `%USERPROFILE%\storytree`.
7. **provision** — `pnpm install` (no-op once `node_modules/.modules.yaml` exists).
8. **claude-cli** — installs the Claude Code CLI (`irm https://claude.ai/install.ps1 | iex`).
9. **codex-cli** — installs the global Codex CLI (`npm install -g @openai/codex`). **OPT-IN**:
   skipped unless you pass `-WithCodex`, because `pnpm install` already supplies the pinned default
   build/UAT leaf and the global product is needed only for interactive Codex sessions. The step still exists by name, so
   `-Step codex-cli` repairs it — which is what `storytree doctor --dev`'s `codex-cli` probe points
   at. Installing the CLI does **not** sign you in: `codex login` is the dev's own browser action
   (ADR-0232 accepts saved ChatGPT-managed auth only), and doctor reports the two separately.
   The whole Codex journey — both of them, and what proves each step took — is
   `docs/codex-onboarding.md`.

Then it runs **`storytree doctor`** (D6) to verify the setup, detects whether the dev's Claude CLI
is logged in (the `~/.claude/.credentials.json` existence probe — **never** the contents), tells the
dev how to establish the ChatGPT login required by the pinned Codex leaf, and,
pre-D5, launches the desktop app from the checkout (`pnpm desktop:start`).

## Verifying + repairing setup (`storytree doctor`, ADR-0207 D6)

`storytree doctor` is the read-only, offline-capable check the installer verifies with and the
in-app guide wraps. It probes each setup invariant — git/Node present, the checkout provisioned, its
workspace linked, dependencies current, the repo fetchable, the Claude CLI present + logged in, the
checkout current — and prints a **fix hint per failure**, exiting non-zero on any failure:

```powershell
pnpm storytree doctor          # from the checkout
```

Its fixes are not new machinery: each installer-repairable probe names the exact idempotent
`install.ps1` step that repairs it (the **repair vocabulary** — re-running that step, or the whole
installer, is the repair). The one exception is Claude login, whose fix is a **dev action** the
doctor *instructs* (run `claude` and sign in) and never executes — the D3 trust boundary. Undetermined
offline probes (remote reachability, checkout freshness) resolve to **warnings**, never failures, so
doctor itself always runs offline. `packages/cli/src/doctor.test.ts` guards both invariants.

### Enacting one repair (`-Step`)

A repair re-runs **one** idempotent step rather than re-walking the whole install:

```powershell
powershell -ExecutionPolicy Bypass -File infra/install.ps1 -Step node
```

`-Step` runs only the named `# @step:` and stops — it skips every other step whole (neither their
`Check` nor their `Install` runs) and returns **before** the trailing verify / login-notice / app
launch, because the guide re-doctors after the repair itself. An unknown name fails loudly and lists
the valid steps, so a mistyped repair can never be misread as a successful one. Dispatch is by the
runner's own step name, so every declared `@step` is invocable by construction — there is no second
step list to drift against.

This is what makes the guide's repair loop enactable: `doctor`'s `fixStep` → `planRepairs`'
installer-step action → `guide-loop`'s `run-installer-step` directive → this command.

### The guided loop (`storytree guide`)

`storytree guide` runs that whole chain for you, so you rarely invoke `-Step` by hand:

```powershell
pnpm storytree guide          # check + explain what needs repairing — enacts NOTHING
pnpm storytree guide --fix    # repair each failure, re-checking after every step
```

Bare `guide` is a **preview**: it names the concrete steps it would run and stops. `--fix` is your
confirmation — it repairs, re-checks, and repeats until the setup is healthy, blocked on you, or
needs the owner. Your Claude sign-in is the one thing it never automates: it tells you to run
`claude`, then stops and waits for you to re-run the guide (D3).

## The trust invariant (ADR-0207 D3)

storytree **never handles Claude credentials**. The script installs the CLI and points the dev at
`claude` login; the dev completes OAuth in their own browser with their own subscription, and the
token lands in their own `~/.claude`. The script only **detects** a logged-in CLI — it never
captures, reads, or transmits a credential. `packages/cli/src/install-script.test.ts` guards this.

## Idempotency (load-bearing — ADR-0207 D1 / D6)

Every step is safely re-runnable: `Invoke-Step` runs a step's `Check` first and, when satisfied,
returns **before** the install action. Re-running the whole script is therefore both the retry
story and the **repair** story — D6's `storytree doctor` guide re-invokes these same steps to fix a
broken environment. An install step that is not safely re-runnable is a bug even when a first
install succeeds. `install-script.test.ts` asserts this structurally.

## Delivery (Windows)

**This is live** (D5 applied + published 2026-07-18). Send the dev exactly this:

```powershell
irm https://storage.googleapis.com/storytree-dist/install.ps1 | iex
```

It is served as a public object from the `storytree-dist` bucket
([`dist-bucket.md`](dist-bucket.md)) and is fetchable with **no credentials** — which is the point,
since the dev has no storytree identity yet. Verified anonymously: HTTP 200, and `irm` returns a
string, so `| iex` executes it.

⚠️ **The published copy does not update itself.** Editing `infra/install.ps1` in the repo does not
reach the bucket — re-publish with `gcloud storage cp` (**not** `gsutil`; see
[`dist-bucket.md`](dist-bucket.md) for the 401 trap). Automating this is an open follow-on.

Running from a checkout is still valid for local testing or if the bucket is ever unreachable:

```powershell
powershell -ExecutionPolicy Bypass -File infra/install.ps1
```

## Scope (v1)

Deferred to follow-on increments: **macOS** (no script covers it), the auto-update feed (D5), and the
packaged-binary desktop install (until then the app launches from the provisioned checkout in dev
mode). Publishing a Linux installer to the public GCS bucket is **not** deferred — it closed as
WON'T DO with the script itself (ADR-0432 D4), so it is not outstanding work. The fresh-machine walk is
**owner-attested** — only a real run on a clean machine proves the one command onboards end-to-end.
