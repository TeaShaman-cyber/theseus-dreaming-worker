#!/bin/sh
# One explicit bounded experiment. Nonzero exit is preserved, not suppressed.
set -eu
umask 077
if [ "$#" -lt 3 ]; then
  echo "usage: run-bounded.sh NEW_DIR SECONDS COMMAND [ARGS...]" >&2
  exit 2
fi
out=$1
seconds=$2
shift 2
# Canonical positive decimal seconds, at most one hour. No zero/overflow.
case "$seconds" in ''|*[!0-9]*|0*|?????*) exit 2;; esac
[ "$seconds" -le 3600 ] || exit 2
mkdir -- "$out"
printf '%s\n' STARTED > "$out/state"
# Conditional prevents inherited errexit from skipping status capture.
if timeout --kill-after=5s "${seconds}s" "$@" > "$out/process.log" 2>&1; then
  rc=0
else
  rc=$?
fi
printf '%s\n' "$rc" > "$out/exit.tmp"
mv -- "$out/exit.tmp" "$out/exit"
printf '%s\n' EXIT_RECORDED > "$out/state.tmp"
mv -- "$out/state.tmp" "$out/state"
exit "$rc"
