# Onboarding a machine onto storytree

**You are the agent onboarding this machine.** Someone pointed you at this repository on a computer
that has never run it, and asked you to make it a working development box. This guide is your answer
and your work plan: you will provision this machine **yourself**, prove each step with something you
observed rather than something you assert, and stop only at the small number of things a human must
do in a browser.

The human who handed you this has exactly **three irreducible jobs**, all of them browser sign-ins
([§2](#2-the-three-sign-ins)). Everything else is yours. Do not ask the human to run a command you
can run.

> **This is the MACHINE guide.** Its sibling [`model-onboarding.md`](model-onboarding.md) onboards a
> *model or harness* onto a checkout that already works. If the box is provisioned and the question
> is "can we drive it with a different model?", you are in the wrong document.
>
> [`CLAUDE.md`](../CLAUDE.md) is a third thing again: the orientation a session reads once the
> machine works. It tells you how to *behave* here, not how the box came to exist. Hand off to it
> the moment [§6](#6-prove-it) passes.

## ⚠ Read this before you trust a single Linux instruction below

**This guide was authored on the Windows dev box, and its Linux specifics were guesses until
2026-08-24, when the first real Linux run scored every one of them** (Linux Mint 22.3 — the
`second-box-absorbs-the-expensive-work-arc` inc-02 blind run). Each claim now carries
**`[CONFIRMED]`** or **`[FALSIFIED]`** with the date and what was actually observed, and the full
scoring sheet — including three findings the sheet never predicted — is [§8](#8-the-unverified-index).

**Read §8 first if you are provisioning a Linux box.** One row was outright wrong in the direction
that stalls you hardest: the guide used to route every install through `apt`, and **none of the
toolchain needs root.**

Two obligations survive, and they now point forward rather than back:

- **A verdict is one box, not all boxes.** Everything below was measured on Mint 22.3 with no
  passwordless `sudo`. A different distro, or a box where you hold root, may legitimately differ —
  that is a correction worth making, not a failure on your part.
- **Do not silently change a verdict.** If you falsify something marked `[CONFIRMED]`, say so and say
  what you saw. A guide that quietly absorbs corrections loses the only record of what it got wrong.

Untagged claims were read from this repository's own source and are as reliable as anything here.

---

## 1. Bootstrap the machine

The end state of this section is a **cloned, installed checkout** — nothing about credentials yet.

### There is no installer for Linux — the steps below ARE the mechanism

| Platform | Script | State |
|---|---|---|
| Windows | `infra/install.ps1` | Built. Eight idempotent steps, `-Step <name>` repairs one. Serves the read-only *explorer* persona, not a dev box. |
| Linux | none | Deliberate, not a gap (ADR-0432). Follow the steps below. |

If you are on Linux you are not missing a tool. `infra/install.sh` existed for two days and was
deleted: it was never executed, never published, and was written for a human at a terminal rather
than for you. Running the steps yourself and reporting what each one did is the better outcome
anyway — a script would have hidden exactly the findings this run exists to produce.

### The steps

```bash
git --version                      # install via your package manager if absent
node --version                     # must satisfy engines: ">=24"
corepack enable pnpm               # Node 24 ships corepack; no global pnpm install
gh --version                       # the GitHub CLI — you cannot land work without it
bun --version                      # the TEST RUNTIME for 21 packages — see the warning below
```

`packageManager` in the root `package.json` pins **pnpm@9.15.0**; corepack activates exactly that,
so do not install pnpm globally and do not pick a version yourself.

> ### ⚠ On Linux, put the toolchain lines ABOVE `~/.bashrc`'s early return
>
> **`[CONFIRMED 2026-08-24]`** Installing the toolchain is not the same as making it reachable, and
> the gap is invisible from an interactive shell. A stock `~/.bashrc` opens with bash's own
> non-interactive early return:
>
> ```bash
> case $- in *i*) ;; *) return;; esac
> ```
>
> Every installer that "appends to your shell profile" — nvm, gcloud, Bun — appends BELOW that line.
> So the toolchain resolves when you type, and does not exist to anything that does not:
>
> ```bash
> env -i HOME=$HOME bash -lc 'node --version'   # v24.19.0          (login shell: reads .bashrc)
> env -i HOME=$HOME bash -c  'node --version'   # command not found (reads NEITHER dotfile)
> ```
>
> **What breaks, measured on Mint:** `ssh box 'pnpm gate'` answers `pnpm: command not found`, and the
> `SessionStart` provision hook cannot resolve `node`, so it silently leaves a worktree with no
> `node_modules` — the hook whose job is to ANNOUNCE a broken worktree, defeated by the same gap it
> would have reported. Meanwhile `doctor --dev` reported the toolchain healthy, because it ran in
> your shell.
>
> **The fix is placement, not re-installation.** Move the toolchain lines ABOVE the early return, or
> into `~/.profile`. `pnpm storytree doctor --dev` has a `toolchain-shell` probe (ADR-0441) — ask it
> rather than guessing, and note that a plain non-login shell never sources `~/.bashrc` **at all**, so
> if the probe says `login-only`, no further edit to that file can change it: only a wrapper that sets
> the environment itself, or `BASH_ENV`, reaches that shape.

> ### ⚠ Bun is a test RUNTIME here. **Never run `bun install`.**
>
> pnpm installs everything and owns `pnpm-lock.yaml`; Bun's only job is running tests — 21 packages'
> `test` scripts are literally `bun test`. `bun-runtime-migration-arc` ruled the package-manager axis
> out of scope deliberately, so reaching for `bun install` because "Bun is required" makes things
> worse rather than better.
>
> **`pnpm install` cannot supply Bun**, which is the whole reason it is listed here beside `git` and
> `gh` rather than left to the workspace. It is a *machine* dependency (ADR-0433 D1): onboarding owns
> it being installed **and resolvable on `PATH`** — both halves.
>
> **The half that actually bites is `PATH`.** Measured on the owner's Windows box on 2026-08-24: Bun
> had been installed for four days, was not on `PATH`, and the gate reported **seven packages**
> `test: Failed` — a message naming neither Bun nor `PATH`. The same gap now reads as *19 packages
> failing*, so it looks more catastrophic the more of the stack migrates, and it is never a real red.
> If you see a broad, unexplained band of test failures, check `bun --version` before you debug
> anything else.
>
> Install from [bun.sh](https://bun.sh); CI pins **1.4.0** (`oven-sh/setup-bun@v2` in
> `.github/workflows/ci.yml`). `pnpm storytree doctor --dev` has a `bun` probe — ask it rather than
> guessing.

**`[CONFIRMED 2026-08-24]`** On Linux, Bun's own installer (`curl -fsSL https://bun.sh/install | bash`)
drops the binary at `~/.bun/bin` and appends that directory to your shell profile — so it is on `PATH`
in *new* shells and not in the one you are standing in. Measured on Mint: the installer reported
success, `~/.bun/bin/bun --version` answered `1.4.0`, and bare `bun` was still not found in the same
shell. Re-source the profile or open a new shell. Do **not** re-install, and do not add a second PATH
entry — this is the identical trap the Windows box hit, arriving through a different installer.

### ⚠ You almost certainly do NOT need `sudo` — and assuming you do will stall you at step one

**`[FALSIFIED 2026-08-24]`** This section used to say `git` comes from apt, that Node 24 needs
NodeSource, and that the GitHub CLI needs GitHub's own apt repository. **Every one of those routes
needs root, and none of them is necessary.** On the first real Linux run the box had no passwordless
`sudo` (`sudo -n true` → `sudo: a password is required`) and an agent cannot answer an interactive
password prompt — so read as written, the guide reads as a hard block before any storytree work
begins. It is not. **The entire toolchain installs into the home directory with no root at all**, and
that is now the primary route:

| Tool | No-root route | Verified on Mint 22.3 |
|---|---|---|
| Node 24 | `nvm` (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh \| bash`, then `nvm install 24`) | 24.19.0 → `~/.nvm` |
| pnpm | `corepack enable pnpm` (ships with Node) | 9.15.0, the pinned version |
| GitHub CLI | release tarball → `~/.local/bin` | 2.75.0 — **no apt repo needed** |
| gcloud | the tarball installer → `~/google-cloud-sdk` | 581.0.0 (+ `cloud-sql-proxy` component) |
| Bun | `curl -fsSL https://bun.sh/install \| bash` | 1.4.0 → `~/.bun/bin` |
| Claude CLI | `curl -fsSL https://claude.ai/install.sh \| bash` | 2.1.241 → `~/.local/bin` |

Only `git` came from the system, and it was already present (2.43.0). Each installer appends its
directory to `~/.bashrc`, so **every one of them carries the new-shell caveat above**, not just Bun.
If you already hold root, apt is fine — but reach for it as the exception, and never escalate to your
human for a password before trying the user-local route.

**Set a git identity before you try to commit, or your first commit fails and nothing earlier warns
you.** A fresh box has none, and git's refusal (`Author identity unknown … unable to auto-detect
email address`) arrives at the *end* of a green unit, which is the worst moment to discover a setup
step. Match the identity the repo's own history uses (`git log -1 --format='%an <%ae>' origin/main`):

```bash
git config user.name "<the name on your GitHub account>"
git config user.email "<the email your commits should carry>"
```

Repo-scoped (no `--global`) is enough and is the conservative choice — worktrees share the primary
checkout's config, so setting it once covers every worktree you cut. Use `--global` only if you want
it for your other projects too.

The box provisioned this way reached `GATE GREEN — 14 passed, 0 failed, 0 skipped` and
`doctor --dev` 15-passing, so the no-root path is not a degraded mode.

### Clone and install

The repository is **private** to the `storytree-ai` org, so the clone needs GitHub auth *before* you
can read anything in it — including this file. That is a genuine chicken-and-egg and it is why
[§2](#2-the-three-sign-ins)'s third sign-in effectively comes first in practice.

```bash
gh auth login                                   # device code — a human enters it
gh repo clone storytree-ai/storytree02 storytree   # 0.2; the bare name is the 0.3 rebuild (ADR-0622)
cd storytree
pnpm install
git submodule update --init web
```

**Initialise the `web` submodule.** Four gate steps — `check:web-grounding`,
`check:web-experience-closure`, `check:web-experience-markers` (ADR-0454), `check:web-engine` — exit
the reserved code 3 (SKIP) when it is absent. A skipped step is **unverified, not passed**, and a box
with different submodule state is running a different gate plan while printing a green-looking
summary. If you are here to compare this machine against another, the plans must match.

`legacy/Agentic` is a second submodule: a read-only vendored copy of the V1 Rust project, reference
only. You do not need it initialised and you must never edit it.

### Codex — the default subscription build/UAT runtime

ADR-0555 makes the pinned Codex leaf the default for builds and model-driven UAT, with Claude kept
as an explicit alternative. `pnpm install` supplies that pinned binary; a ChatGPT-managed sign-in
supplies its credential. The separate global Codex CLI remains optional unless this box will drive
interactive Codex sessions.

**The whole journey is `docs/codex-onboarding.md`** — both what Codex means here
(a session driver, and a build tool, with different binaries), the three steps only you can perform,
and what proves each one took. Two things worth knowing before you go there:

- **`pnpm install` gives the Codex binary and never the Codex credential.** Unlike the Claude leaf,
  the Codex leaf hydrates no secrets, deliberately. Only a ChatGPT sign-in writes `~/.codex/auth.json`,
  and ADR-0232 accepts that kind of login *only* — an API key cannot be made to work here however
  valid it is.
- **Ask the box rather than guessing:** `pnpm storytree doctor --dev` carries a `codex-cli` row and a
  `codex-login` row, both of which **invoke** the binary rather than checking a path.

---

## 2. The four sign-ins

**Name all four to your human now, before the first one blocks you.** Discovering them one at a
time, an hour apart, is the single most annoying way to run this section and it is entirely
avoidable. Each has its own proof; do not treat one passing as evidence for another.

| # | Credential | What it unlocks | Proof it worked |
|---|---|---|---|
| 1 | Google application-default credentials | The Postgres store | `pnpm db:probe` exits 0 |
| 2 | Claude OAuth token | The Claude Agent SDK leaf | a `--pg` read, then a trivial `--pg` write |
| 3 | GitHub CLI auth | Cloning, and opening a PR | `gh pr list` returns |
| 4 | Codex ChatGPT login | The default build and model-driven UAT leaf | `codex login status` prints `Logged in using ChatGPT` |

### 2.1 Google — application-default credentials

```bash
gcloud auth login --no-launch-browser                    # authenticates the gcloud CLI itself
gcloud auth application-default login --no-launch-browser # writes ADC, which the connector reads
```

**These are two different credentials and you need both.** The first authenticates the `gcloud`
command — without it you cannot read a secret in §2.2. The second writes application-default
credentials, which is what the Cloud SQL connector uses. Running only one leaves the other half
failing in a way that reads as a permissions problem rather than a missing login.

`--no-launch-browser` prints a URL and waits for a code, which is what keeps your human to a single
click on a machine you may not be sitting at. Then:

```bash
pnpm db:probe
```

Exit 0 prints `reachable — SELECT 1 answered in N ms`. Exit 1 prints the exact failure.

**Do not hand-roll this probe.** It runs the canonical connector through the CLI's own composition
root — secrets hydration, the `PoolHandle` shape, and pool teardown are all handled inside the verb.
Three separate attempts have been lost to re-deriving it.

**A slow answer is not a failure.** The instance can take minutes to accept connections after a cold
start while already reporting status RUNNABLE. Wait and re-probe rather than concluding it is down.
And a **saturated machine makes the probe lie** — if the box is loaded, check `storytree own --all`
before believing a red result.

**`[CONFIRMED IN PART 2026-08-24]`** Installing the Google Cloud SDK on Mint IS its own step and is
not covered by anything in this repo — use the **tarball installer**, which needs no root
(`~/google-cloud-sdk`, 581.0.0 verified). Add the `cloud-sql-proxy` component
(`gcloud components install cloud-sql-proxy`), which the store connector wants. The quota-project
half was **NOT** needed: `pnpm db:probe` and every Secret Manager read worked on plain ADC, and where
a raw REST call needed a billing project the `x-goog-user-project: storytree-498613` header sufficed.
Reach for `set-quota-project` only if something actually complains.

⚠ **`gcloud auth login` and `gcloud auth application-default login` are two different credentials and
the difference bites here.** ADC alone is enough for the database *and* for reading secrets over the
Secret Manager REST API — but the `gcloud secrets …` **CLI** needs the first one, and without it fails
with `You do not currently have an active account selected`, which reads like a permissions problem
rather than a missing login. Run both.

### 2.2 Claude — the OAuth token

⚠ **Do NOT run `claude setup-token` here.** The token already exists in Google Secret Manager, and
the §2.1 sign-in is enough to read it:

```bash
gcloud secrets versions access latest --secret=claude-code-oauth-token --project storytree-498613
```

Put that value in `CLAUDE_CODE_OAUTH_TOKEN` ([§3](#3-the-secrets-file)). It is a subscription-funded
credential, not an API key.

**Minting a fresh one is the hazard.** `setup-token` produces a one-year token, and whether a new one
invalidates existing ones is **undocumented in both directions** — the feature requests to list and
revoke them imply several coexist, but the revoke request was closed as not planned. Another machine
depends on the current value, so minting a second could take that box down for a credential you did
not need. `setup-token` remains the way to CREATE one where none exists; that is not this case.

**The trust boundary moved, and the half that moved is worth knowing (ADR-0430).** ADR-0207 D3's
"storytree never handles Claude credentials" invariant is retired — credentials live in the vault and
storytree code may hold one. What did NOT change is disclosure: nothing here may print, log or hash
the value, and you can confirm a credential is present without ever reading it.

### 2.3 GitHub

```bash
gh auth login          # device code
gh auth setup-git      # REQUIRED — see below; not optional on a fresh box
gh pr list             # the proof
```

Without this the machine can run the gate but cannot land anything, which makes it a very expensive
read-only checkout.

⚠ **`gh pr list` passing does NOT mean you can push, and the gap only surfaces at the moment you
land.** Measured 2026-08-24: with `gh` fully authenticated *and* SSH to GitHub working, the first
`git push` still died with `fatal: could not read Username for 'https://github.com': No such device
or address`. The cause is that `origin` is an **HTTPS** remote while `gh auth login` recorded
`Git operations protocol: ssh` — so neither credential was wired to the transport git actually used.
`gh auth setup-git` installs `gh` as git's credential helper for HTTPS and fixes it in one command.
Run it during setup rather than discovering it after a green gate, at the end of a unit, with a
commit you cannot push.

**A second GitHub credential you will need, which the four-sign-in table does not cover:** an **SSH
key** on the account. `.gitmodules` points `web` and `legacy/Agentic` at `git@github.com:` URLs, so
`git submodule update --init web` needs SSH regardless of how `origin` is configured — and without
the `web` submodule three gate rungs SKIP, which is *unverified*, not passed. `gh auth login` offers
to generate and upload a key; accept it, or add one yourself at github.com/settings/keys.

---

## 3. The secrets file

`~/.storytree/secrets.json` fills environment variables the live paths need, so they survive across
sessions **and across git worktrees** — an in-repo secrets file would not, because untracked files do
not follow worktrees. **No CLI verb creates this file.** `packages/drive/src/secrets.ts` only reads
it. Creating it is a step in this guide and nowhere else.

```json
{
  "CLAUDE_CODE_OAUTH_TOKEN": "<read from Secret Manager in §2.2 — do NOT mint a new one>",
  "STORYTREE_DB_USER": "<the Google account you signed in as in §2.1>"
}
```

**The vault is the source of truth for that first value, not this file (ADR-0430).** You are copying
it here because nothing in the code reads Secret Manager yet; when that lands, this file becomes an
override and an offline fallback rather than the place the credential lives. Which means: if the two
ever disagree, the vault is right and this file is stale.

**Exactly two keys are read. Nothing else in the file is honoured**, so it cannot be used to inject
arbitrary environment.

### The database identity is per-PERSON, not per-machine

This is the fact that removes what looks like the largest obstacle on a second machine, so it is
worth stating plainly: `STORYTREE_DB_USER` is a **human Google account**, and Cloud SQL IAM grants
attach to that identity. A new machine whose §2.1 sign-in used the **same account** inherits the same
database access.

**There is no per-host grant, no service account to create, and no infrastructure change.** If you
find yourself reading Terraform to get a second machine onto the database, stop — you have gone down
the wrong path.

### Two traps the code already knows about

- **Environment always wins.** The file only fills variables that are unset. A stale export in your
  shell silently beats the file.
- **A blank value is a gap, not a credential.** `VAR=` is how a shell says "not configured", and a
  mangled command substitution produces exactly that. Read as present, it travels to the connector
  and surfaces as *a perfectly healthy database reporting itself unreachable* — measured once at
  ~25 minutes of `{"store":"pg","db":"unreachable"}` while a direct `SELECT 1` answered the whole
  time. That is worse than a wasted probe: it manufactures convincing evidence for the wrong
  diagnosis. `presentEnv()` exists for exactly this and treats whitespace-only as absent.

---

## 4. Work from a linked worktree

**Do not work in the primary checkout.** Two separate mechanisms make it a dead end, and both are
correct behaviour that is baffling on first contact:

- **`storytree noticeboard declare` refuses outright from it.** Session identity derives from the
  worktree, and `deriveIdentity()` returns nothing for a primary checkout — the shared lobby has no
  isolated identity to claim under. There is deliberately no flag to supply one by hand.
- **Anything you run there registers with `storytree own` as nothing at all**, so the machine is
  invisible to its own runtime inventory from day one.

```bash
pnpm storytree worktree create --runtime claude --node <unit-id> --intent "<what you are doing>" --pg
```

That is the claim-gated ceremony: it cuts a branch from a freshly-fetched `origin/main`, creates the
worktree, runs `pnpm install` in it, and takes your claim in one step. Work from the path it prints.

**A fresh worktree has no `node_modules` of its own.** The ceremony installs for you; if you create
one by hand with `git worktree add`, install in it before any `pnpm storytree …` or `pnpm db:*`
command, or they fail with errors naming entirely the wrong cause.

Invoke the CLI as **`pnpm storytree …`**, not a bare `node --import tsx …` — `tsx` resolves only
through the workspace, so the bare form fails from a worktree root with `ERR_MODULE_NOT_FOUND 'tsx'`.

---

## 5. Install the write-authority wall

```bash
pnpm storytree write-authority install          # dry run — shows what would change
pnpm storytree write-authority install --write  # install it
```

This generates a `permissions.deny` block in the **user-level** `~/.claude/settings.json` that
refuses file-tool writes into the primary checkout, so §4's rule is enforced rather than merely
advised. The block is **derived from the repo manifest's root allow-list**
(`repo-manifest/repo-surface/_domain.json`) — never hand-edit it; re-run `install --write` when that
allow-list changes.

**Know its limits before you rely on it (ADR-0284).** It is a static permissions block and nothing
more: it binds the three file-editing tools, **not Bash** — a shell write into the primary checkout
still succeeds and is still a violation. It is claim-blind, so it permits writes into a *sibling*
worktree. And it does not bind Codex at all.

**`[CONFIRMED 2026-08-24]` — and it was the claim most likely to fail, so the result is worth stating
precisely.** The wall works on Linux, and it genuinely BINDS rather than merely installing. Measured
on a fresh Mint box: `install --write` created `~/.claude/settings.json` (it did not exist) with **144
deny rules** over `Write`/`Edit`/`NotebookEdit`, and **zero** rules touching `.claude/worktrees`. A
file-tool write into `<primary>/scripts/` was then refused with the documented *"File is in a
directory that is denied by your permission settings"*, while the same write into a linked worktree
succeeded.

⚠ **The generated paths carry a DOUBLE leading slash on Linux too — `//home/you/code/storytree/**` —
and that is correct, not a porting bug.** It is the deliberate absolute-path form
(`write-authority-rules.test.ts`: *"a single slash anchors at the settings file"*), and the
Windows-shaped `//c/code/storytree` rules come from the same line. Do not "fix" it.

ADR-0284's named gap is also confirmed here: a **Bash** write into the primary checkout still
succeeds. The wall binds three file tools and nothing else.

---

## 6. Prove it

Run these in order. Each proves a different thing, and a pass on one is not evidence for another.

```bash
pnpm storytree doctor --dev      # the machine-level verdict
```

**Pass `--dev`; a bare `doctor` is not the dev verdict.** The dev-persona probes — application-default
credentials, database reachability, the secrets file, GitHub auth, **Bun**, **the Codex binary and
login**, **the toolchain shell**, write-authority, worktree identity — are an **opt-in group**, because an explorer legitimately has
none of them. Bare, `doctor` runs the eleven explorer probes and prints `DEV_SCOPE_NOT_RUN`: a green
that names what it did not check, not a stopping condition. Three of the ten can only ever WARN by
decision (`db-reachable`, `write-authority`, `worktree-identity`), so green-with-those-warning is the
expected shape rather than a defect.

**`toolchain-shell` is the one that reads differently on each platform, and both readings are
correct** (ADR-0441). It asks a shell that is NOT doctor's own whether `node`, `pnpm` and `bun`
resolve — the one question no other probe here can answer, since every other probe runs in the shell
that launched doctor, and that shell is by construction one where the toolchain already worked. On
**Windows** it reads **WARN / not determined**, deliberately: PATH there comes from the persistent
user environment and there is no login/non-login split to compare, so a PASS would be a green for a
mechanism only ever exercised on Linux. On **Linux** it can reach `login-only` (a WARN — see
[§1](#1-bootstrap-the-machine)) or `unresolvable` (a FAIL).

A green doctor is still one signal and not a provisioned box. Run the rest of this list regardless.

```bash
pnpm -r typecheck                                             # hermetic — no DB, no token
pnpm -r test                                                  # hermetic
pnpm db:probe                                                 # §2.1
pnpm storytree library artifact merge-ceremony                # a live read
pnpm storytree arc list --pg                                  # a live read that needs the DB up
gh pr list                                                    # §2.3
```

Then a **trivial live write**, because a read proves less than you think — the read path and the
write path do not share a seam:

```bash
pnpm storytree noticeboard declare --working-on "onboarding this machine" --node <unit-id> --pg
pnpm storytree noticeboard done --pg
```

Finally the whole gate, which is the real verdict:

```bash
pnpm gate
```

Read **the per-step table, not the tail**. `SKIP` and `NOT RUN` both mean *unverified* — never
passed. A laptop with no `web` submodule normally reads **GREEN, NARROWED** with three steps named,
and that is an honest green, not a defect. Never `timeout`-wrap the gate and never pipe it to
`tail`: both kill the run and leave a log that reads like one still in progress.

---

## 7. Gotchas

- **You cannot smoke-test yourself in the third person.** Every proof here is something you
  **observe** — an exit code, a printed row, the gate's own table — never something you assert about
  yourself. If a proof did not run, the honest report is "unverified", and stopping to say so is
  cheap. A self-onboarding that grades its own homework has failed at the only step nobody can review
  from the diff.
- **`pnpm storytree --help` does not list `doctor`.** The verb exists; the help output omits it. If
  you are discovering the CLI from its own help, you will not find the command that tells you whether
  your machine works.
- **A green `pnpm install` that says "Already up to date" still changed things.** That line is about
  dependency *resolution*, not linking. Never read it as "the install was a no-op".
- **`pnpm db:up` exit 75 means the instance is still warming**, not that anything failed. Re-probe;
  do not issue another start. Exit 1 means the activation genuinely did not take.
- **Leave the database running.** Bring it up when you need it and do not stop it when you finish —
  nothing stops it automatically, and stopping it takes CI, the gate, every read command and the
  hosted studio down together.
- **Reads no longer need `--pg`; writes do.** A bare `storytree library …` read already dials the
  live store. Adding `--pg` to a read buys nothing and costs the follow-up offers.
- **Long prose into an artifact field goes through a file, never a `>` redirect.** Under
  `pnpm storytree …` a redirect captures pnpm's two-line run banner as the field's first bytes. Use
  `--out` to capture and `--set field=@path` to write.
- **`[CONFIRMED 2026-08-24]` Line endings.** A fresh Linux clone produces **no CRLF churn**.
  `git status` stayed empty through clone, `pnpm install`, `git submodule update --init web`, and a
  full gate. `.gitattributes` carries `* text=auto eol=lf`, which is what holds it.
- **`[CONFIRMED 2026-08-24]` The gate runs on Linux — `GATE GREEN, 14 passed, 0 failed, 0 skipped.`**
  Every rung executed, including the three `web/` submodule checks (`check:web-grounding`,
  `check:web-experience-closure`, `check:web-engine`) that had never run on any Linux box before. The
  hooks fired, both `-r` legs ran, Bun-backed suites passed. Test leg 1m54s; whole gate ≈3½ min. **No
  Linux-specific defect surfaced anywhere.**
  - Two things worth carrying forward from that run. **Initialise the `web` submodule** or those three
    rungs SKIP and you have verified nothing (`git submodule update --init web`; it needs the SSH
    remote, so `gh auth login` first). And an earlier run of the same gate went **RED on
    `check:guidance` / `check:agents`** — which was NOT a Linux problem: the live store had moved ahead
    of the committed projections, so `main` was red for every branch on every machine at that moment.
    The check says so itself. Read its "WHICH SIDE MOVED" line before suspecting your box.

---

## 8. The `[UNVERIFIED]` index

**SCORED 2026-08-24 — the first real Linux run happened** (Linux Mint 22.3, `second-box-...-arc-inc-02`).
Every row below now carries a verdict and what was actually observed. Re-running the experiment is no
longer the point; **correcting a row that turns out wrong on a DIFFERENT Linux box is.**

| # | Claim | Verdict |
|---|---|---|
| ~~1~~ | ~~`infra/install.sh` provisions a bare machine idempotently~~ | **RETIRED**, not answered — the script was deleted (ADR-0432). Never executed, and now never will be. |
| 2 | Node 24 needs NodeSource or nvm; distro `nodejs` is too old | ✅ **CONFIRMED** — the box had no system Node at all. `nvm` → 24.19.0, no root. |
| 3 | The GitHub CLI needs GitHub's apt repo, not the distro package | ❌ **FALSIFIED** — it needs **neither**. The release tarball into `~/.local/bin` gave 2.75.0 with no root and no apt repo. See §1's no-sudo table. |
| 4 | Installing the Google Cloud SDK is an extra step, possibly needing a quota project | ⚠️ **HALF** — extra step confirmed (tarball, no root, 581.0.0). Quota project **not** needed; `x-goog-user-project` sufficed. §2.1 also gained the two-different-logins trap this exposed. |
| 5 | `write-authority install --write` works on Linux and writes sane paths | ✅ **CONFIRMED**, and it BINDS — 144 rules, a real file-tool write refused, worktrees still writable, `//`-prefix correct by design. §5. |
| ~~6~~ | ~~`storytree doctor` still reports healthy on an unprovisioned machine~~ | **ANSWERED** before this run — the dev probes landed; a bare sweep says `DEV_SCOPE_NOT_RUN`. |
| 7 | A fresh Linux clone produces no CRLF churn | ✅ **CONFIRMED** — clean through clone, install, submodule init and a full gate. |
| 8 | `pnpm gate` passes on Linux, hooks and `check:*` rungs included | ✅ **CONFIRMED** — `GATE GREEN, 14 passed, 0 failed, 0 skipped`, the three `web/` rungs included. No Linux-specific defect anywhere. |
| 9 | Bun's Linux installer puts it on `PATH` only for NEW shells | ✅ **CONFIRMED** — `~/.bun/bin/bun` answered 1.4.0 while bare `bun` was not found in the same shell. |

**The untagged claim HOLDS, and it was the one that mattered most:** the database grant is
per-identity ([§3](#3-the-secrets-file)). The same Google account on a brand-new machine inherited
full access — `pnpm db:probe` green, live `--pg` reads and a live `--pg` write all worked. **No
per-host grant, no service account, no Terraform.**

### What this run found that the sheet did not predict

Three things cost real time and none of them had a row:

1. **The sudo assumption is the single biggest stall risk** (row 3's deeper cause). Read literally,
   §1 sent an agent that cannot `sudo` to its human for a password before any storytree work began.
   The whole toolchain is user-local. This is now stated up front in §1.
2. **`pnpm db:schema` is not a read.** It reads like an inspection verb and **applies DDL to the
   shared live store**. This run invoked it while answering a read-only question. Harm was zero — the
   two `DROP TABLE IF EXISTS` lines are a completed ADR-0200 D7 retirement that no-ops on every later
   run — but that was the schema file's good manners, not a guard. Filed as friction
   (`db-schema-applies-ddl-while-reading-as-an-inspection-verb`).

   > **REMEDIED 2026-09-22** — increment `db-schema-requires-explicit-write-posture` on
   > `tool-signal-gaps-arc`. **The bare `pnpm db:schema` now PREVIEWS and opens no connection**: it
   > lists every top-level statement the DDL would apply, grouped by kind, and reads out the ones
   > that are not purely additive — today the two `DROP TABLE`s above and the two `DO $$ … $$` blocks
   > whose effect their opening word does not disclose. **`pnpm db:schema --write` is what applies
   > it.** So the finding above is history: the guard this run found missing now exists, and the
   > schema file's good manners are no longer what is standing between a read-only question and a
   > write to the shared store.
3. **`doctor`'s Claude probe FAILED a correctly-provisioned box** — FIXED, and it is now called
   `claude-credential`. Under ADR-0430 the token comes from Secret Manager and
   `~/.claude/.credentials.json` is legitimately absent, but the probe looked only for a
   browser-logged-in CLI and its fix hint prescribed the very `claude setup-token` §2.2 forbids in
   bold. Filed as friction (`doctor-claude-login-fails-a-correctly-provisioned-vault-box`). It now
   PASSes on EITHER route — a logged-in CLI, or a non-blank `CLAUDE_CODE_OAUTH_TOKEN` this machine can
   hydrate — and names in its detail which one it found. The RENAME landed with it rather than after
   it: `claude-login` is a keyed discriminant on the escalation path, so a widened probe still called
   `claude-login` would both read `[ok]` on a box with no login and route a vault-side failure down
   the identity branch. A FAIL now means neither route produced a credential, and says so.

**Also not yet true: ADR-0430 D5.** There is no GitHub credential in the vault and no code path reads
Secret Manager, so "one sign-in provisions a machine" is the target, not the present. This run needed
three sign-ins plus an SSH key for the submodules.
