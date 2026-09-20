# Onboarding Codex onto storytree

**This is the one place.** If you are setting Codex up on a host, follow this document start to
finish — you should not need to open a research note, and every step below says what proves it took
and what can check that proof for you.

Codex is the **default subscription runtime for builds and model-driven UAT** (ADR-0555); Claude is
the explicit alternative. A development host therefore needs the pinned Codex leaf and a
ChatGPT-managed login. The separate global CLI or Desktop install is still optional unless this
host will also drive interactive Codex sessions.

> **The one thing people get wrong, up front:** `pnpm install` gives you the Codex **binary** and
> never the Codex **credential**. They are separate steps with separate failure modes, and only a
> ChatGPT sign-in produces the second one. Everything in §3 is downstream of that sentence.

---

## 1. There are TWO journeys, and they are not the same journey

Deciding which one you are on is the first step, because they need different things and only one of
them involves the Codex product at all.

| | **Journey A — the session driver** | **Journey B — the prove-it leaf** |
| --- | --- | --- |
| What it is | A person opens Codex Desktop, or the `codex` CLI, on this repository, and it runs the orchestrator loop: orient, claim, build, gate, land. This is what "using Codex with storytree" usually means. | The deterministic spine drives one `codex exec` turn per phase inside a disposable replica and promotes an exact target set. It is a **build tool**, invoked by whichever session is driving — which may well be a *Claude* session. |
| How you invoke it | Codex Desktop, or `codex` | `pnpm storytree node build <id> --live` (`--runtime codex` is the explicit spelling) |
| Where its binary comes from | **you install it** — `npm install -g @openai/codex`, or Codex Desktop | **`pnpm install`** — `packages/agent` pins `@openai/codex`, and the wrapper lands in `packages/agent/node_modules` |
| What else it needs | a ChatGPT sign-in | **the same** ChatGPT sign-in |

They share the ordinary workspace setup — git, Node 24, pnpm, `gh`, the clone, `pnpm install`, the
sign-ins, the secrets file — which is `docs/machine-onboarding.md` and is **not** repeated here.
Do that first, and confirm it with `pnpm storytree doctor --dev`.

What they share beyond that is **one coupling**, and it is §3.

---

## 2. Journey A — Codex as the session driver

Steps A1–A3 (git / Node / pnpm / `gh` / clone / `pnpm install`) are ordinary machine onboarding.
The genuinely Codex-specific part of this journey is **three steps, all of them irreducibly human**.
That is not a gap waiting to be closed by a script: an install may want elevation, a sign-in happens
in your own browser under your own account, and a trust decision is a decision. Say so plainly
rather than letting a reader discover it at step four.

### A4 — install the product *(operator)*

```bash
npm install -g @openai/codex     # no root needed
```

or install Codex Desktop, which brings its own copy.

**Proves it took:** `codex --version` answers.
**Checks it for you:** `pnpm storytree doctor --dev` → the `codex-cli` row.

### A5 — sign in with a ChatGPT account *(operator, in a browser)*

```bash
codex login
codex login status     # must print exactly: Logged in using ChatGPT
```

**Proves it took:** `~/.codex/auth.json` exists and `codex login status` emits that exact line.
**Checks it for you:** `doctor --dev` → the `codex-login` row, which asks the question using the
prove-it leaf's *own* predicate, so it cannot pass on a machine whose `--runtime codex` builds would
refuse.

⚠ **An API-key login is not a lesser login here, it is the wrong one.** ADR-0232 accepts saved
ChatGPT-managed (subscription) auth **only**, and the leaf strips `OPENAI_API_KEY`, `CODEX_API_KEY`
and `CODEX_ACCESS_TOKEN` from its child processes before every run — so a perfectly valid API key
cannot be made to work, however you supply it. `doctor` reports that state as its own row rather
than telling you to run a command that would not help. storytree never mints, captures or discloses
this credential; it only observes whether one exists.

### A6 — trust the directory, and choose the approval policy *(operator, editing your own config)*

In `~/.codex/config.toml` — **your user config, never the repository**:

```toml
[projects.'/absolute/path/to/your/checkout']
trust_level = "trusted"

# Optional, and an explicit opt-in for a trusted development machine:
approval_policy = "never"
```

`approval_policy = "never"` auto-approves ordinary local terminal commands, so you keep the
responsibility to limit prompts and project instructions to work you genuinely want performed. It
does not override approvals imposed by anything outside Codex — a browser, a connector, UAC, or the
source-control host. Restart Codex Desktop and start a new task after changing it.

Codex Desktop's `Full access` setting is a *different* control and does not by itself stop the
Terminal confirmation card.

**Proves it took:** the entries are in the file, and a new task stops asking.
**Checks it for you:** nothing — this is a preference, and there is no correct value to check
against.

### A7–A12 — the rest is the ordinary loop

- **Guidance projections.** `pnpm build:guidance && pnpm build:agents` (needs the live DB up)
  produce the root `AGENTS.md` Codex reads and the ten files in `.codex/agents/*.toml`. Both are
  drift-gated by `pnpm gate` (`check:guidance` / `check:agents`). The committed
  `.codex/config.toml` raises Codex's project-instruction byte limit above the generated file's
  current size; without it, Codex's default 32 KiB limit cuts the session-orchestrator instructions
  off mid-ceremony. The gate holds that relationship rather than relying on a hand-copied byte
  count.
- **Worktrees.** `storytree worktree create --runtime codex` deliberately **refuses**: Codex Desktop
  owns `~/.codex/worktrees/*` and storytree will neither mint nor reap in a directory another
  product manages. Let the product make the worktree, or make one by hand with `git worktree add` —
  both work, because session identity is derived from git topology alone. The identity you *get*
  differs: a hand-made tree announces itself by its own name, a product-managed one as
  `storytree`, `storytree1`, … which is harder to recognise on the claim ledger.
- **Provisioning that worktree.** Codex now gets the same fresh/stale-worktree provisioner from the
  repository's `SessionStart` hook. It runs `pnpm install` only when the worktree needs it and
  announces the still-broken case to the session. `doctor --dev` → `dependencies-current`, run
  inside the worktree, remains the independent check. On first use, review and trust the project
  hooks with `/hooks`; Codex records trust against their content hash, so changed hooks must be
  reviewed again.
- **Claim, build, gate, land** exactly as any session does.

---

## 3. Journey B — Codex as the prove-it leaf

| Step | What you do | What proves it | What checks it |
| --- | --- | --- | --- |
| B1 | `pnpm install` at the repo root. **This IS the Codex install for the leaf** — `packages/agent` pins `@openai/codex`, so the wrapper appears at `packages/agent/node_modules/@openai/codex/bin/codex.js`. | the file is there and answers `--version` | `doctor --dev` → `codex-cli`, which reports `workspace-only` for exactly this state |
| B2 | **Nothing.** The ChatGPT saved login from A5 must already exist. | `codex login status` → `Logged in using ChatGPT` | `doctor --dev` → `codex-login`; and the leaf itself refuses closed with `Codex subscription auth required` |
| B3 | Keep metered keys out of the environment. | `OPENAI_API_KEY` / `CODEX_API_KEY` / `CODEX_ACCESS_TOKEN` unset | the leaf strips all three, case-insensitively, before both child processes — you cannot defeat this by exporting one |
| B4 | `pnpm storytree node build <id> --live` (or explicit `--runtime codex`) | the spine's signed verdict | the prove-it gate. `--budget` is **refused** (subscription quota is not a USD cap) and `--max-turns` is fixed at 1 |
| B5 | For `--real`, the live database as well. | `events.verdict` rows | `ensureLiveDb` starts it for you |

**The coupling, stated out loud, because nothing else in this repository states it.** Unlike the
Claude leaf — which auto-fills `CLAUDE_CODE_OAUTH_TOKEN` from `~/.storytree/secrets.json` — the
Codex leaf **hydrates no secrets, deliberately**. It reads the official saved login and strips every
key variable. So `pnpm install` gives you the binary and never the credential; the credential is
`~/.codex/auth.json`, and only a sign-in writes it. A box that has run `pnpm install` and nothing
else can run the leaf's *binary* and cannot run a *build*.

**You do not need the global product install to get the credential.** Verified 2026-08-28: the
pinned wrapper exposes the same login verb —

```bash
node packages/agent/node_modules/@openai/codex/bin/codex.js login
node packages/agent/node_modules/@openai/codex/bin/codex.js login status
```

— offering the ChatGPT browser flow (and the two metered routes ADR-0232 forbids, which you must not
use). Both binaries read the same `~/.codex/auth.json`, so either can establish it and either can be
asked about it. What was checked here is that the verb exists and offers the right flow; the sign-in
itself is yours to perform. If you only ever want Journey B, this is the cheaper route: `pnpm
install`, then sign in through the pinned wrapper, and skip A4 entirely.

**Isolation, stated accurately.** The phase runs Codex's own `--sandbox workspace-write` — on
Windows the `unelevated` sandbox, which needs no administrator setup (ADR-0583, holding the worker
to ADR-0581 D1's outside-world limit). The CLI authors in a throwaway copy under
`<repo>/.gate-logs/codex-replicas`, and that copy is the shell's **only writable root**: temp
directories are excluded, and the shell has **no network**. The child environment carries no
secret-shaped variable, store pointer or git locator, and a git ceiling at the replica's parent, so
the worker's git cannot discover the checkout it sits in. The spine still alone decides which files
come back, through the *exact promotion manifest*. This replaced `--sandbox danger-full-access`,
which the phase ran from ADR-0390's withdrawal of storytree's managed Codex permission profiles until
2026-09-20. One cost is worth knowing when reading a worker transcript: in the Windows sandbox,
PowerShell runs in constrained language mode, so a .NET method call fails where a cmdlet works.

**One knob nothing else documents:** `STORYTREE_CODEX_EXECUTABLE` overrides which Codex binary the
leaf runs. It must be an absolute path and is validated as one. `--model` overrides the default
model (`gpt-5.6-terra`).

---

## 4. Ask the box, don't infer

```bash
pnpm storytree doctor --dev
```

Two of its rows are about Codex, and both **invoke** the binary rather than checking a path —
because the case that actually bites is *installed but unreachable*, and an installed binary nothing
can reach is indistinguishable from an absent one.

| Row | Reading | What it means |
| --- | --- | --- |
| `codex-cli` | `path` | the product answered on PATH. **Both** journeys have their binary. |
| | `workspace-only` | only the pinned leaf wrapper answered. This is what `pnpm install` alone leaves, so it is the commonest reading in the fleet: `--runtime codex` builds can run, an interactive Codex session cannot be started here. |
| | `absent` | neither answered. Not even the leaf can run — usually the workspace is not provisioned, so read `checkout-provisioned` first. |
| `codex-login` | PASS | a ChatGPT-managed login is present. The only state the leaf accepts. |
| | not ChatGPT-managed | a login exists and is the forbidden kind. `--runtime codex` will refuse. |
| | no login | `~/.codex/auth.json` has not been written. Do A5. |
| | not determined | no Codex binary could be asked. That is the `codex-cli` finding, not a credential one. |

`codex-cli: workspace-only` is a **WARN**, because the pinned wrapper can run the default leaf even
though no interactive Codex session can start from PATH. An absent wrapper and every non-ChatGPT,
logged-out, or undetermined `codex-login` state are **FAIL**: the default build/UAT route cannot run.

⚠ **What these rows cannot see.** Like every `--dev` probe except `toolchain-shell`, they run in the
shell that launched doctor — which by construction is one where the toolchain resolved. A host where
`codex` resolves for your interactive shell but **not** for an ssh-driven or hook-driven one reads
`path` here and still fails that work. `toolchain-shell` is the probe that asks that question, and
`codex` is deliberately not on its list: the default leaf invokes the pinned Node wrapper, while a
PATH-resolved product is required only for an interactive Codex session.

On Windows, `infra/install.ps1 -WithCodex` performs A4 as the `codex-cli` step, and
`infra/install.ps1 -Step codex-cli` repairs just that step — which is what the `codex-cli` row's fix
points at. There is no Linux installer by design (ADR-0432) — on Linux the steps themselves are the
mechanism, which is `docs/machine-onboarding.md` for the shared setup and this document for the
Codex-specific part.

---

## 5. Codex-native session mechanics

Codex now has native lifecycle hooks, so `.codex/hooks.json` carries the Claude mechanics whose
contracts actually match the Codex events:

- `SessionStart` provisions a fresh or stale worktree, injects the claim/origin nudge, and launches
  the fail-silent all-worktree activity sweep through Codex's native background-hook mode.
- `UserPromptSubmit` runs the same prompt-keyed Library definition injection.
- `.codex/config.toml` explicitly enables hooks and gives the generated `AGENTS.md` enough byte
  budget to load in full.

These are repository hooks, so the project must be trusted and their exact definitions reviewed in
`/hooks`. Commands run from the session working directory and keep the existing bounded/fail-silent
contracts. See the current [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) for the
event and trust model.

This is behavioural parity, not a second Storytree-owned harness. Four Claude-specific surfaces are
deliberately not copied:

- remote credential bootstrap checks `CLAUDE_CODE_REMOTE` and belongs only to Claude's web pods;
- empty-slot auto-repair is hard-coded to Claude-owned `.claude/worktrees` and `claude/*` branches;
- pruning owns `.claude/worktrees`, while Codex owns and reaps `~/.codex/worktrees` itself;
- Claude's custom status line has no Codex project configuration counterpart. The same claim state
  remains available through `storytree noticeboard mine --pg` and the studio.

The **knowledge** half remains one-source rather than copied: the root `AGENTS.md` and the ten
`.codex/agents/*.toml` files are generated from the live Library and drift-gated. ADR-0291
deliberately gives Codex the generated session-orchestrator digest, not Claude's hand-authored
repository tour; the larger byte budget ensures that chosen projection is complete.

---

## 6. Where this fits

- `docs/machine-onboarding.md` — the shared host setup every runtime needs. Do that first.
- `docs/model-onboarding.md` — onboarding a *new* model or harness onto storytree. Codex is already
  onboarded; that guide points here.
- `docs/research/codex-onboarding-journey-survey-2026-08-22.md` — the survey this document was
  written from, including the silent-failure inventory. A record of how the journey was measured,
  not instructions.
