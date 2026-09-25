#Requires -Version 5.1
<#
  storytree - explorer onboarding, D1 one-liner installer (Windows / PowerShell).

  ADR-0207 D1: ONE re-runnable terminal command installs everything a trusted dev needs to
  onboard as an EXPLORER - read-only checkout, own Claude subscription, desktop app. The owner
  sends this; the dev pastes it and enters one GitHub device code. Nothing else.

  LOAD-BEARING INVARIANT (ADR-0207 D1 / D6): every step is IDEMPOTENT and no-ops when already
  satisfied. Re-running is both the retry story AND the repair story - D6's `storytree doctor`
  guide re-invokes these same steps to fix a broken environment. So an install step that is not
  safely re-runnable is a bug even when a first install succeeds. The `Invoke-Step` runner below
  enforces this: it NEVER runs a step's install action while that step's Check already passes.

  TRUST INVARIANT (ADR-0207 D3): storytree NEVER handles Claude credentials. This script installs
  the Claude Code CLI and points the dev at `claude` login - the dev completes OAuth in their own
  browser with their own subscription; the credential lands in their own ~/.claude and never
  passes through storytree code. This script only DETECTS a logged-in CLI; never captures a token.

  SCOPE (v1, Windows-only): the packaged-binary desktop install is still a follow-on. There is NO
  sh variant and deliberately never will be - infra/install.sh existed briefly and was deleted by
  ADR-0432, because it was never executed, never published, and aimed at an explorer at a terminal
  rather than at the agent-with-owner-present model a Linux box actually uses. A Linux dev box is
  provisioned by following docs/machine-onboarding.md, whose by-hand steps are the mechanism there.
  Do not re-create this script for Linux without re-opening ADR-0432; the one condition that would
  justify it is a genuinely UNATTENDED bootstrap, with no human and no agent able to ask one.
  macOS is uncovered.
  Until D5 ships public binaries from the distribution bucket, the desktop app is launched from the
  provisioned checkout (dev launch), not a packaged install. See infra/install.md.

  ASCII-ONLY by design: this file is fetched and executed via `irm ... | iex`, and Windows
  PowerShell 5.1 mis-decodes non-ASCII bytes in a BOM-less UTF-8 file. Keep it plain ASCII.

  Usage:
    powershell -ExecutionPolicy Bypass -File infra/install.ps1
    # or once D5 lands the public bucket:
    #   irm https://storage.googleapis.com/storytree-dist/install.ps1 | iex

    # D6 targeted repair - re-run ONE idempotent step (what the guide's repair loop invokes):
    powershell -ExecutionPolicy Bypass -File infra/install.ps1 -Step node
#>
[CmdletBinding()]
param(
  # Where the read-only checkout lands. Default: %USERPROFILE%\storytree.
  [string]$CheckoutDir = (Join-Path $HOME 'storytree'),
  # The read-only clone URL. This is storytree 0.2, renamed `storytree02` (ADR-0622); the bare name
  # `storytree-ai/storytree` now belongs to the 0.3 rebuild, so never point this back at it.
  [string]$RepoUrl = 'https://github.com/storytree-ai/storytree02.git',
  # Skip the final desktop-app launch (provision only) - used by re-run/repair flows.
  [switch]$SkipLaunch,
  # Also install the global Codex CLI (the 'codex-cli' step). OPT-IN, deliberately: `pnpm install`
  # already supplies the pinned default build/UAT leaf (ADR-0555); the global product is needed only
  # for an interactive Codex session. The step still EXISTS, so `-Step codex-cli` repairs it (the D6
  # repair vocabulary, which is what `storytree doctor`'s codex-cli fixStep names).
  [switch]$WithCodex,
  # Run ONLY the named `# @step:<name>` and stop - the D6 targeted repair (ADR-0207). The guide's
  # repair loop names the exact step to re-invoke (doctor's fixStep -> planRepairs' InstallerStepAction
  # -> the run-installer-step directive), so a repair re-runs ONE idempotent step rather than
  # re-walking the whole install. An unknown name fails loudly. Omit for the full install sequence.
  [string]$Step
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- output helpers ------------------------------------------------------------------------------
function Write-Info($m) { Write-Host "[storytree-install] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[storytree-install] $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[storytree-install] $m" -ForegroundColor Yellow }

# True iff a command is resolvable on PATH (the universal "already satisfied" primitive).
function Test-Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# winget updates the persisted PATH but not this process's env; refresh it so a just-installed
# tool is resolvable in the SAME run (and the post-install Check below sees it).
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

# Install a winget package by id, then refresh PATH. Fails loudly if winget itself is absent
# (Windows 10 1809+ / Windows 11 ship it; a missing winget is an escalation, not a silent skip).
function Install-Winget($id) {
  if (-not (Test-Have winget)) {
    throw "winget is not available. Install 'App Installer' from the Microsoft Store, then re-run."
  }
  winget install --id $id --exact --source winget `
    --accept-package-agreements --accept-source-agreements --disable-interactivity
  Update-SessionPath
}

# The idempotent step runner - D1's load-bearing invariant lives HERE. Check returns $true when the
# step is already satisfied; in that case Install is NEVER called (the no-op-when-satisfied contract).
# After an install, Check is re-run to confirm convergence; a step that does not converge throws.
$script:StepNames = @()
$script:StepMatched = $false

function Invoke-Step {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Check,
    [Parameter(Mandatory)][scriptblock]$Install
  )
  $script:StepNames += $Name
  # -Step: run ONLY the named step (the D6 targeted repair). Non-matching steps are skipped whole.
  if ($script:Step) {
    if ($Name -ne $script:Step) { return }
    $script:StepMatched = $true
  }
  if (& $Check) { Write-Ok "$Name - already satisfied"; return }
  Write-Info "$Name - setting up..."
  & $Install
  if (-not (& $Check)) { throw "$Name - still not satisfied after setup; re-run or escalate." }
  Write-Ok "$Name - done"
}

# --- step predicates -----------------------------------------------------------------------------
function Test-Node24 {
  if (-not (Test-Have node)) { return $false }
  $raw = (node --version) -replace '^v', ''      # e.g. "24.15.0"
  $major = 0
  [void][int]::TryParse($raw.Split('.')[0], [ref]$major)
  return $major -ge 24
}
function Test-GithubAuth {
  if (-not (Test-Have gh)) { return $false }
  gh auth status --hostname github.com 1>$null 2>$null
  return ($LASTEXITCODE -eq 0)
}
function Test-Checkout {
  if (-not (Test-Path (Join-Path $CheckoutDir '.git'))) { return $false }
  $remote = (git -C $CheckoutDir remote get-url origin 2>$null)
  # Anchored on the full name: an unanchored 'storytree-ai/storytree' would also match the 0.3 repo.
  return ($remote -match 'storytree-ai/storytree02(\.git)?$')
}
# pnpm writes node_modules/.modules.yaml only when an install COMPLETES - the same provisioned
# marker packages/cli/provision-worktree.mjs keys on. Absence => fresh or truncated => re-provision.
function Test-Provisioned {
  return (Test-Path (Join-Path $CheckoutDir 'node_modules\.modules.yaml'))
}

# --- the install sequence ------------------------------------------------------------------------
# Each idempotent prerequisite carries a `# @step:<name>` marker (asserted by the structural test
# in packages/cli/src/install-script.test.ts). Ordered: each step's Check assumes its predecessors.
Write-Info "storytree explorer onboarding - Windows installer (ADR-0207 D1)."
Write-Info "checkout: $CheckoutDir"

# @step:git - version control, and the clone below needs it.
Invoke-Step -Name 'git' `
  -Check  { Test-Have git } `
  -Install { Install-Winget 'Git.Git' }

# @step:node - Node 24+ (the workspace engine floor); brings corepack for pnpm.
Invoke-Step -Name 'node' `
  -Check  { Test-Node24 } `
  -Install { Install-Winget 'OpenJS.NodeJS.LTS' }

# @step:pnpm - the workspace package manager, activated via corepack (ships with Node).
Invoke-Step -Name 'pnpm' `
  -Check  { Test-Have pnpm } `
  -Install { corepack enable pnpm; Update-SessionPath }

# @step:gh-cli - the GitHub CLI drives the device sign-in in the next step.
Invoke-Step -Name 'gh-cli' `
  -Check  { Test-Have gh } `
  -Install { Install-Winget 'GitHub.cli' }

# @step:github-auth - device sign-in (the ONE code the dev enters). Read access comes from the
# owner-granted Read role on the storytree-ai org (ADR-0207 D2).
Invoke-Step -Name 'github-auth' `
  -Check  { Test-GithubAuth } `
  -Install { gh auth login --hostname github.com --git-protocol https --web }

# @step:clone - the read-only checkout. gh's credential helper authenticates the HTTPS clone.
Invoke-Step -Name 'clone' `
  -Check  { Test-Checkout } `
  -Install {
    git -C ([System.IO.Path]::GetDirectoryName($CheckoutDir)) clone $RepoUrl $CheckoutDir
  }

# @step:provision - install workspace deps (idempotent: no-op once .modules.yaml exists).
Invoke-Step -Name 'provision' `
  -Check  { Test-Provisioned } `
  -Install {
    Push-Location $CheckoutDir
    try { corepack enable pnpm; pnpm install } finally { Pop-Location }
  }

# @step:claude-cli - the dev's OWN agent. Install the CLI; the dev logs in themselves (D3 trust
# invariant - storytree detects a logged-in CLI, never handles the credential).
Invoke-Step -Name 'claude-cli' `
  -Check  { Test-Have claude } `
  -Install { irm https://claude.ai/install.ps1 | iex; Update-SessionPath }

# @step:codex-cli - the optional GLOBAL session product (ADR-0232 / ADR-0555). The pinned default
# build/UAT leaf arrived with `pnpm install`; this step is skipped unless -WithCodex, but remains
# reachable by name so `-Step codex-cli` is a real repair for the interactive-product WARN. Same D3
# trust invariant as claude-cli, and MORE binding: ADR-0232 accepts saved
# ChatGPT-managed auth ONLY (an API-key fallback is forbidden), so `codex login` is the dev's own
# browser action and never something this script performs. Installing the CLI does NOT produce a
# credential - `storytree doctor --dev` reports the two separately for exactly that reason.
if ($WithCodex -or $Step -eq 'codex-cli') {
  Invoke-Step -Name 'codex-cli' `
    -Check  { Test-Have codex } `
    -Install { npm install -g @openai/codex; Update-SessionPath }
} else {
  Write-Info "codex-cli - skipped (opt in with -WithCodex, or repair with -Step codex-cli)"
}

# --- targeted repair (-Step) stops here ----------------------------------------------------------
# A -Step run is the D6 repair loop enacting ONE idempotent step; the guide re-doctors afterwards,
# so the installer skips the trailing verify/login-notice/launch entirely. An unknown step name is a
# loud failure (never a silent no-op that the guide would misread as a successful repair).
if ($Step) {
  if (-not $script:StepMatched) {
    throw "unknown -Step '$Step'. Valid steps: $($script:StepNames -join ', ')."
  }
  Write-Ok "step '$Step' complete."
  return
}

# --- trailing actions (not idempotent-convergent steps) ------------------------------------------
# Verify the setup with `storytree doctor` (ADR-0207 D6: the installer verifies with it). doctor is
# read-only and offline-capable; a non-zero exit (e.g. Claude login still pending) does NOT halt this
# script - it is surfaced for the dev, and re-running the doctor / this installer is the repair loop.
Write-Info "verifying setup with 'storytree doctor'..."
Push-Location $CheckoutDir
try { pnpm storytree doctor } catch { Write-Warn "doctor could not run yet: $_" } finally { Pop-Location }

# Claude login is the dev's action in their own browser - we DETECT + INSTRUCT, never capture (D3).
# A logged-in CLI writes ~/.claude/.credentials.json; its presence is the "already logged in" signal
# (storytree reads only its EXISTENCE, never its contents).
$claudeCreds = Join-Path $HOME '.claude\.credentials.json'
if (Test-Path $claudeCreds) {
  Write-Ok "Claude login - detected (guide seat will light in the app)"
} else {
  Write-Warn "Claude login - not yet done. Run 'claude' and complete sign-in in your browser (your own subscription)."
}

# Codex subscription auth is required by the default build/UAT leaf (ADR-0555). Detect and instruct,
# never capture (ADR-0207 D3): a browser sign-in writes ~/.codex/auth.json, and ADR-0232 accepts
# nothing else. The global product remains optional; the pinned wrapper exposes the same login flow.
if (Test-Have codex) {
  Write-Info "Codex login - run 'codex login' and sign in with your ChatGPT account. Installing the CLI does NOT sign you in, and 'storytree doctor --dev' reports the binary and login separately."
} else {
  $pinnedCodex = Join-Path $CheckoutDir 'packages/agent/node_modules/@openai/codex/bin/codex.js'
  if (Test-Path $pinnedCodex) {
    Write-Info "Codex login - run 'node `"$pinnedCodex`" login' and sign in with your ChatGPT account. The pinned default leaf and a global Codex product share the same saved login."
  } else {
    Write-Warn "Codex leaf - the pinned wrapper is absent. Re-run the provision step, then sign in; 'storytree doctor --dev' treats this as a failure."
  }
}

# Desktop app: pre-D5 there is no packaged binary, so launch from the provisioned checkout. When
# D5 ships public binaries this becomes a packaged install+launch (see infra/install.md).
if ($SkipLaunch) {
  Write-Info "provision complete. To launch the desktop app:  cd `"$CheckoutDir`"; pnpm desktop:start"
} else {
  Write-Info "launching the storytree desktop app..."
  Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoExit', '-Command', "Set-Location `"$CheckoutDir`"; pnpm desktop:start"
  )
}

Write-Ok "storytree explorer onboarding: setup complete."
