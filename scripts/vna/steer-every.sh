#!/usr/bin/env bash
# scripts/vna/steer-every.sh — run ONE named steer file round after round, detached, with no chat in the loop (operator 2026-10-28:
# "the steer file should be referencing a file that we build before the run and then you can just reference it … every 10 minutes …
# that is 12 runs" · "the steer done this way should not burn a lot of tokens"). A chat-scheduled firing re-reads the whole
# conversation every tick; this loop spends only what its -p workers spend.
#
#   bash scripts/vna/steer-every.sh <steer-file> [--every-min 5] [--max-rest-min 20] [--load-per-core 0.4] [--runs 12]
#                                   [--budget-usd 7.50] [--ceiling 0.75]
#
# THE CLOCK IS REST AFTER A ROUND, never a fixed slot (operator 2026-10-28: "the anatomy of the clock is fine … five minutes of rest
# between rounds" · "the whole point is to make sure that the computer gets a certain amount of rest and clean up, clean up all
# memory between every round" · "takes as long as it needs to take to clean up the swap file"). After every round the loop calls
# mem.mjs --settle: reap, unload every ollama model, then rest at least --every-min (5), on until CALM (1-min load per core at most
# --load-per-core 0.4 AND under 100 swap-ins/s), never past --max-rest-min (20). Its one line goes in the log: minutes, calm or cap,
# load / swap-ins / swap used before and after, the biggest swap holders. Swap USED is never waited on: it shrinks only when its
# holders exit (measured 2026-10-28: 95 % swap at 71 % free). So the period is round time + rest, by design.
#
# The steer file carries one line `SCOPE: C1,C2,…`, re-read every round, so a row promoted into SCOPE mid-loop is worked without a
# restart. Each run: skip if the steer lock is held (never two at once); stop for good once the summed spend plus the largest round
# seen so far would pass the budget (a round overshoots its ceiling, so the cap is projected BEFORE the round, never found after);
# else `steer.mjs until --scope <SCOPE> --ceiling <c> --max-cycles 1`. The spend is read off the run's own `spend $x` cycle line
# and appended, with the run's last lines, to `<steer-file>.runs.log` beside the file. Nothing here pushes, ships or sends.
# Guard: tests/vna/steer-every.test.mjs.
set -u
FILE="${1:?usage: steer-every.sh <steer-file> [--every-min N] [--runs N] [--budget-usd X] [--ceiling X]}"; shift
EVERY=5; MAXREST=20; LPC=0.4; RUNS=12; BUDGET=7.50; CEIL=0.75; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --every-min) EVERY="$2"; shift 2;; --runs) RUNS="$2"; shift 2;; --budget-usd) BUDGET="$2"; shift 2;;
  --ceiling) CEIL="$2"; shift 2;; --max-rest-min) MAXREST="$2"; shift 2;; --load-per-core) LPC="$2"; shift 2;; --dry) DRY=1; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
# HOME holds the scripts (this repo, or the installed package); the repo being steered is VNA_REPO (the caller's cwd under
# `npx thetacog-mcp steer-every`), else HOME. At home the two are the same directory.
HOME_DIR="$(cd "$(dirname "$0")/../.." && pwd)"; REPO="${VNA_REPO:-$HOME_DIR}"; cd "$REPO" || exit 1
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
scope() { grep -m1 -E '^SCOPE: ' "$FILE" | sed 's/^SCOPE: *//' | tr -d ' '; }
SCOPE="$(scope)"
[ -n "$SCOPE" ] || { echo "no SCOPE: line in $FILE" >&2; exit 2; }
LOG="$FILE.runs.log"
spent() { grep -E '^RUN .* spend \$' "$LOG" 2>/dev/null | sed -E 's/.* spend \$([0-9.]+).*/\1/' | awk '{s+=$1} END {printf "%.2f", s+0}'; }
biggest() { grep -E '^RUN .* spend \$' "$LOG" 2>/dev/null | sed -E 's/.* spend \$([0-9.]+).*/\1/' | sort -n | tail -1; }
over() { awk -v a="$(spent)" -v m="$(biggest)" -v b="$BUDGET" 'BEGIN{exit !(a>=b || (m+0>0 && a+m>b))}'; }
# The rest is ONE door, never a second copy: mem.mjs --settle (reap, unload local models, rest until calm on load per core AND
# swap-ins/s, cap). STEER_EVERY_LOAD / STEER_EVERY_SWAPINS / STEER_EVERY_TICK_S let the guard drive it; --dry passes --dry through.
settle() {
  MEM_SETTLE_LOAD="${STEER_EVERY_LOAD:-}" MEM_SETTLE_SWAPINS="${STEER_EVERY_SWAPINS:-}" node "$HOME_DIR/scripts/ops/mem.mjs" --settle --min "$EVERY" --max "$MAXREST" \
    --load-per-core "$LPC" --tick-s "${STEER_EVERY_TICK_S:-60}" $([ "$DRY" = 1 ] && echo --dry) 2>/dev/null | grep -m1 "^mem --settle" || echo "mem --settle UNMEASURED"
}
echo "START $(date '+%F %T') file=$FILE scope=$SCOPE rest=${EVERY}-${MAXREST}m@${LPC}/core runs=$RUNS budget=\$$BUDGET ceiling=\$$CEIL" >> "$LOG"
for i in $(seq 1 "$RUNS"); do
  if over; then echo "STOP $(date '+%F %T') budget: \$$(spent) spent, next round projected at \$$(biggest), cap \$$BUDGET" >> "$LOG"; break; fi
  NEW="$(scope)"; [ -n "$NEW" ] && SCOPE="$NEW"
  if node "$HOME_DIR/scripts/vna/steer-lock.mjs" status 2>/dev/null | grep -qv 'free'; then
    echo "RUN $i $(date '+%F %T') skipped — steer lock held · spend \$0.00" >> "$LOG"
  elif [ "$DRY" = 1 ]; then
    echo "RUN $i $(date '+%F %T') dry · scope=$SCOPE · spend \$0.00" >> "$LOG"
  else
    OUT="$(node "$HOME_DIR/scripts/vna/steer.mjs" until --scope "$SCOPE" --ceiling "$CEIL" --max-cycles 1 --no-open 2>&1)"
    S="$(printf '%s\n' "$OUT" | grep -E '^cycle ' | sed -nE 's/.*spend \$([0-9.]+) of.*/\1/p' | sort -n | tail -1)"
    echo "RUN $i $(date '+%F %T') · scope=$SCOPE · spend \$${S:-0.00}" >> "$LOG"
    printf '%s\n' "$OUT" | grep -E '^cycle |^steer until' | sed 's/^/    /' >> "$LOG"
  fi
  [ "$i" -lt "$RUNS" ] && echo "    rest · $(settle)" >> "$LOG"
done
echo "END $(date '+%F %T') spent \$$(spent) of \$$BUDGET" >> "$LOG"
