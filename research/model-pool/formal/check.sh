#!/bin/sh
# Research-only module, explicit pinned toolchain; no download or network here.
set -eu
: "${LEAN_BIN:?Set LEAN_BIN to the absolute path of Lean 4.28.0}"
case "$LEAN_BIN" in /*) ;; *) exit 2;; esac
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=$("$LEAN_BIN" --version)
printf '%s\n' "$version" | grep -F 'version 4.28.0,' >/dev/null
printf '%s\n' "$version" | grep -F 'commit 7e01a1bf5c70fc6167d49c345d3bf80596e9a79b,' >/dev/null
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
cp "$dir/PoolJournal.lean" "$tmp/PoolJournal.lean"
cd "$tmp"
timeout 30 "$LEAN_BIN" -j 1 -DwarningAsError=true --run PoolJournal.lean > trace.log
grep -F "'PoolJournal.reachable_safe' depends on axioms: [propext, Quot.sound]" trace.log
grep -F "'PoolJournal.frozen_first' depends on axioms: [propext]" trace.log
grep -F "'PoolJournal.unknown_absorbing' depends on axioms: [propext]" trace.log
grep -F "'PoolJournal.pending_blocks_start' depends on axioms: [propext]" trace.log
test "$(grep -c 'depends on axioms:' trace.log)" = 4
node "$dir/compare-traces.mjs" trace.log
sed 's/s.used < s.cap ∧ s.second = none/s.second = none/' PoolJournal.lean > NoBudget.lean
sed 's/| .ready, .start f =>/| .ready, .start f | .unknown, .start f =>/' PoolJournal.lean > UnknownRetry.lean
for name in NoBudget UnknownRetry; do
  if timeout 30 "$LEAN_BIN" -j 1 -DwarningAsError=true "$name.lean" > "$name.log" 2>&1; then
    printf 'Unexpected successful mutant: %s\n' "$name" >&2; exit 1
  else rc=$?
  fi
  test "$rc" = 1
  grep -F 'Tactic `decide` proved that the proposition' "$name.log" >/dev/null
  grep -Fx 'is false' "$name.log" >/dev/null
done
grep -F 'run (initial 2) [Event.start 1, Event.failed, Event.start 2, Event.failed, Event.start 3] = none' NoBudget.log
grep -F 'run (initial 2) [Event.start 1, Event.unknown, Event.start 2] = none' UnknownRetry.log
printf '%s\n' FORMAL_POOL_PILOT_PASS
