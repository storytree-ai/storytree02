#!/usr/bin/env bash
# gate:bg — run the gate so a BACKGROUNDED run reports THE GATE'S OWN STATUS.
#
#   pnpm gate:bg                  # runs `pnpm gate`
#   pnpm gate:bg <cmd> [args...]  # runs <cmd> instead (used by its own test)
#
# WHY THIS EXISTS. A backgrounded command's completion notification reports the OUTER SHELL's
# exit code, not the wrapped command's. Measured: `pnpm gate` was backgrounded as
# `{ pnpm gate; echo "GATE_EXIT=$?"; } > gate3.log 2>&1`. The gate FAILED — the log's last line
# read `GATE_EXIT=1` — while the completion notification read `completed (exit code 0)`: true of
# the wrapper, false of the gate. The session reported the gate GREEN TO THE OWNER and had to
# correct it a turn later. Every shape that captures the status also destroys it:
#
#   { cmd; echo $?; }        -> 0    cmd | tail       -> 0
#   ( cmd ; echo EXIT=$? )   -> 0    cmd 2>&1 | tee   -> 0     (all measured, for a cmd exiting 1)
#
# The last one is the trap in this very script: a pipeline exits with its RIGHTMOST command, so
# piping the gate into `tee` hands you tee's success. `${PIPESTATUS[0]}` below is the load-bearing
# line — it is the wrapped command's status, unaffected by tee. Do not "simplify" it away; the
# test at packages/cli/src/gate-bg.test.ts fails if you do.
#
# Run this AS the backgrounded command. Then the harness notification, `$?`, and the `.exit` file
# all report the gate, and no session has to decide whether to trust the notification.
#
# SHELL SUPPORT — tested under Git Bash (bash 5.3.9, Windows), which is the shell sessions on this
# repo actually background with, and bash on ubuntu-latest in CI. It is NOT tested under PowerShell
# or cmd, and the exit-code propagation genuinely differs there — invoke it through `pnpm gate:bg`,
# which pins `bash`, rather than porting it. Bash-specific by design (PIPESTATUS, BASH_SOURCE).
#
# LOG PATH — session-unique by CONSTRUCTION, never a fixed /tmp path. Git Bash's /tmp is shared
# across worktrees, and a sibling's `gate.log` has already been read as this session's result. The
# path is anchored to THIS worktree (derived from the script's own location, so it holds however
# the worktree was reached) and suffixed with timestamp + pid, so neither a concurrent sibling
# worktree nor a second run in this one can collide. Override with GATE_BG_LOG=<path>.
#
# Deliberately NOT a guidance rule: prose about which capture shapes force zero is exactly what
# failed here twice, including when it was written into the task brief. The script is the fix.
set -uo pipefail

# The worktree this script belongs to — NOT the cwd, and no `git rev-parse` (an unprovisioned
# worktree husk resolves that UP to the primary checkout, which is how logs cross worktrees).
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -gt 0 ]; then
  cmd=( "$@" )
else
  cmd=( pnpm gate )
fi

if [ -n "${GATE_BG_LOG:-}" ]; then
  log="$GATE_BG_LOG"
else
  log="$root/.gate-logs/gate-$(date +%Y%m%d-%H%M%S)-$$.log"
fi
exit_file="$log.exit"

mkdir -p "$(dirname "$log")" || exit 1
# A previous run's sentinel at this same path would read as THIS run's verdict until it finishes.
# (`gate-bg.mjs` already removes it before printing the handle; this covers a direct invocation.)
rm -f "$exit_file" || exit 1

printf 'gate:bg log:       %s\n' "$log"
printf 'gate:bg exit-file: %s\n' "$exit_file"
printf 'gate:bg command:   %s\n\n' "${cmd[*]}"

# THE LOAD-BEARING LINE. PIPESTATUS[0] is the wrapped command's status, read positionally and so
# independent of `pipefail`. Do NOT "simplify" it to `$?`: that reads the PIPELINE's status, which
# is tee's success unless `pipefail` happens to be set — i.e. it would leave the whole guarantee
# resting silently on the `set -o pipefail` line above. Measured: without pipefail, `$?` after
# `cmd 2>&1 | tee log` is 0 for a cmd that exited 1. The test at packages/cli/src/gate-bg.test.ts
# strips pipefail from a copy of this script and re-checks propagation, so that swap goes red.
"${cmd[@]}" 2>&1 | tee "$log"
status="${PIPESTATUS[0]}"

# THE SENTINEL APPEARS WHOLE, OR NOT AT ALL. `printf ... > "$exit_file"` CREATES the file and only
# then writes into it, so for an instant the sentinel EXISTS and is EMPTY — and every reader that
# treats existence as completion reads "" as the verdict. Measured 2026-09-01: that redded a full
# gate with `'' !== '3'` for a job which had exited 3 correctly, and only on a box already running
# a gate, because the window is microseconds wide. Writing to a sibling and RENAMING is atomic on
# both POSIX and NTFS, so the window does not exist rather than merely being narrow. `.exit.tmp` is
# chosen so it does not match the `*.exit` glob a hand-rolled waiter would use, and the `&&` means
# a failed write never renames a half-file into place. `storytree dispatch` was never fooled —
# `readDispatchHandle` reports an empty sentinel as `unreadable` rather than parsing it — but the
# launcher test's poller, a `cat`, and any hand-rolled waiter all read existence as completion.
# Do not "simplify" this back to one redirect; gate-bg.test.ts reads the CODE and goes red if you do.
printf '%s\n' "$status" > "$exit_file.tmp" && mv -f "$exit_file.tmp" "$exit_file"

if [ "$status" -eq 0 ]; then verdict='PASS'; else verdict="FAIL"; fi
{
  printf '\n=== gate:bg verdict ===\n'
  printf 'command : %s\n' "${cmd[*]}"
  printf 'exit    : %s (%s)\n' "$status" "$verdict"
  printf 'log     : %s\n' "$log"
} | tee -a "$log"

# Exit with the GATE's status, not this script's own bookkeeping.
exit "$status"
