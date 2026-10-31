#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# scripts/gdd-iterate.sh — GDD iteration loop, meta-rule-checker pattern.
#
# Decomposition:
#   · MODE detection: writing | code | auto (default: --auto inspects path)
#   · RULES live at scripts/gdd-rules/<mode>/*.sh — each rule is a small,
#     composable shell script that returns exit 0 = pass, non-zero = fail
#   · TRIGGER: every iteration runs all rules; failures dispatch fixes
#     · writing: fix = ghost-read + GDD_AUTO_REWRITE_LIVE=1 auto-rewrite
#     · code:    fix = each rule emits its own fix command on stderr
#   · CONVERGENCE: all rules pass → exit 0
#   · CAPS:
#     · GDD_MAX_ITER (default 8)             — iteration ceiling
#     · GDD_DIFF_BUDGET_PCT (default 25)     — per-iter diff cap (drift guard)
#     · GDD_DAILY_AUTO_APPLY_CAP (env to ghost-read-auto-rewrite)
#
# Usage:
#   ./scripts/gdd-iterate.sh <file> [--mode writing|code|auto]
#   ./scripts/gdd-iterate.sh src/content/blog/2026-05-23-reach-is-verify.mdx
#   ./scripts/gdd-iterate.sh books/tesseract/chapters/chapter-04.md
#   ./scripts/gdd-iterate.sh src/lib/foo.ts --mode code
#
# Self-tests: ./scripts/gdd-iterate.sh --self-test
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── Self-test mode ──────────────────────────────────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
  echo "GDD self-test: discovering rules…"
  for mode in writing code; do
    n=0
    for rule in scripts/gdd-rules/"$mode"/*.sh; do
      [ -x "$rule" ] || continue
      n=$((n+1))
      echo "  $mode/$(basename "$rule")"
    done
    echo "  → $n rule(s) found for mode=$mode"
  done
  exit 0
fi

FILE="${1:-}"
MODE="${2:---auto}"
MAX_ITER="${GDD_MAX_ITER:-8}"
DIFF_BUDGET_PCT="${GDD_DIFF_BUDGET_PCT:-25}"

if [ -z "$FILE" ]; then
  echo "usage: $0 <file> [--mode writing|code|auto]" >&2
  exit 2
fi

if [ ! -f "$FILE" ]; then
  echo "✗ file not found: $FILE" >&2
  exit 2
fi

# ── Mode auto-detect ───────────────────────────────────────────────────────
if [ "$MODE" = "--auto" ] || [ "$MODE" = "auto" ]; then
  case "$FILE" in
    *.mdx)                                              MODE="writing" ;;
    src/content/blog/*.md|src/content/blog/*.mdx)        MODE="writing" ;;
    books/tesseract/chapters/*.md)                       MODE="writing" ;;
    docs/05-content/blog/scratchpad/*.md*)               MODE="writing" ;;
    *.ts|*.tsx|*.mjs|*.js|*.jsx|*.py|*.sh|*.rs|*.go)     MODE="code" ;;
    *.json|*.toml|*.yaml|*.yml)                          MODE="code" ;;
    *)                                                   MODE="writing" ;;
  esac
fi

RULES_DIR="scripts/gdd-rules/$MODE"
if [ ! -d "$RULES_DIR" ]; then
  echo "✗ no rules dir for mode=$MODE (looked for $RULES_DIR)" >&2
  exit 2
fi

# Collect rule scripts, sort by filename (numeric prefix gives ordering)
shopt -s nullglob 2>/dev/null || true
rules=()
for r in "$RULES_DIR"/*.sh; do
  [ -x "$r" ] && rules+=("$r")
done

if [ "${#rules[@]}" -eq 0 ]; then
  echo "✗ no executable rules in $RULES_DIR" >&2
  exit 2
fi

# ── Logging helpers ─────────────────────────────────────────────────────────
log() { printf '%s\n' "$*" >&2; }
hdr() { printf '\n\033[1m=== %s ===\033[0m\n' "$*" >&2; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*" >&2; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

hdr "GDD iterate · file=$FILE · mode=$MODE · rules=${#rules[@]}"

# ── Adaptive convergence: soften AVG_FLOOR by 0.5 per stalled iter ─────────
# If avg crosses 95 but the rule keeps failing on PASS_PCT (stuck just under
# 80%), we soften the criterion progressively (94.5, 94, 93.5) so the loop
# converges on the diminishing-returns plateau instead of grinding forever.
# User directive tonight: "94 is very close to 95 for example, the sh rules
# need to allow for this — maximise and push." This soft-ramp is the
# mechanical implementation of "maximise then accept."
GDD_ADAPTIVE_SOFTEN="${GDD_ADAPTIVE_SOFTEN:-1}"

# ── Iteration loop ─────────────────────────────────────────────────────────
iter=0
stalled_iters=0
last_fail_set=""
prev_hash=""
while [ "$iter" -lt "$MAX_ITER" ]; do
  iter=$((iter+1))
  hdr "GDD iter $iter / $MAX_ITER"

  # Track file hash for drift-budget check
  cur_hash=$(git hash-object "$FILE" 2>/dev/null || md5 -q "$FILE" 2>/dev/null || md5sum "$FILE" | cut -d' ' -f1)

  if [ -n "$prev_hash" ] && [ "$prev_hash" != "$cur_hash" ]; then
    cur_lines=$(wc -l < "$FILE" | tr -d ' ')
    diff_lines=$(git diff --shortstat "$FILE" 2>/dev/null | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | awk '{sum+=$1} END {print sum+0}')
    if [ -n "$cur_lines" ] && [ "$cur_lines" -gt 0 ]; then
      pct=$((diff_lines * 100 / cur_lines))
      if [ "$pct" -gt "$DIFF_BUDGET_PCT" ]; then
        log "⚠ diff budget exceeded: $diff_lines lines changed of $cur_lines ($pct% > $DIFF_BUDGET_PCT%)"
        log "   → exiting to prevent voice drift; review changes manually"
        exit 3
      fi
    fi
  fi
  prev_hash="$cur_hash"

  fail_count=0
  fail_names=()
  for rule in "${rules[@]}"; do
    rname=$(basename "$rule" .sh)
    if "$rule" "$FILE" 2>/tmp/gdd-rule-stderr; then
      pass "$rname"
    else
      fail "$rname"
      [ -s /tmp/gdd-rule-stderr ] && sed 's/^/      /' /tmp/gdd-rule-stderr >&2
      fail_count=$((fail_count+1))
      fail_names+=("$rname")
    fi
  done

  if [ "$fail_count" -eq 0 ]; then
    hdr "✅ Converged: all ${#rules[@]} rules pass on $FILE"
    exit 0
  fi

  # ── Stall detection ────────────────────────────────────────────────────
  # If the SAME rule set fails two iterations in a row, we are stalled.
  # Soften GDD_AVG_FLOOR by 0.5 each stalled iter (down to a floor of 92).
  cur_fail_set="${fail_names[*]}"
  if [ "$cur_fail_set" = "$last_fail_set" ]; then
    stalled_iters=$((stalled_iters+1))
    if [ "$GDD_ADAPTIVE_SOFTEN" = "1" ]; then
      cur_avg_floor="${GDD_AVG_FLOOR:-95}"
      new_avg_floor=$(node -e "console.log(Math.max(92, $cur_avg_floor - 0.5))")
      export GDD_AVG_FLOOR="$new_avg_floor"
      log "⚠ stalled iter $stalled_iters — adaptive: GDD_AVG_FLOOR → $new_avg_floor (max-softened to 92)"
    fi
  else
    stalled_iters=0
  fi
  last_fail_set="$cur_fail_set"

  log ""
  log "→ $fail_count rule(s) failed: ${fail_names[*]}"
  log "→ dispatching fixes (mode=$MODE)…"

  # ── Dispatch fixes ────────────────────────────────────────────────────
  if [ "$MODE" = "writing" ]; then
    # The writing fix-dispatch fires ghost-read with LIVE auto-rewrite enabled.
    #
    # AUTH PATH: we explicitly UNSET GEMINI_API_KEY and GOOGLE_GEMINI_API_KEY
    # for the dispatched process so ghost-read-async.mjs routes through the
    # OAuth/CLI path (which works) instead of the broken API-key REST path
    # (which returns 400 INVALID_ARGUMENT when the key in .env.local is
    # expired/wrong). User's observation tonight: "this one must have been
    # called with api key instead of oauth (which works)" — fix is to force
    # the CLI fallback by absence of the env key.
    #
    # OPT-OUT: set GDD_USE_GEMINI_API_KEY=1 to keep the env key (e.g. CI
    # where the OAuth path is unavailable and a working key is provided).
    if [ -x "scripts/ghost-read-async.mjs" ] || [ -f "scripts/ghost-read-async.mjs" ]; then
      sha=$(git rev-parse HEAD)
      if [ "${GDD_USE_GEMINI_API_KEY:-0}" = "1" ]; then
        log "   fire (API path): GHOST_READ_DUAL=1 GDD_AUTO_REWRITE_LIVE=1"
        GHOST_READ_DUAL=1 GDD_AUTO_REWRITE_LIVE=1 \
          node scripts/ghost-read-async.mjs --file "$FILE" --sha "$sha" 2>&1 | tail -10 >&2 || true
      else
        log "   fire (OAuth/CLI path): GEMINI_API_KEY unset to force gemini CLI auth"
        GEMINI_API_KEY="" GOOGLE_GEMINI_API_KEY="" \
        GHOST_READ_DUAL=1 GDD_AUTO_REWRITE_LIVE=1 \
          node scripts/ghost-read-async.mjs --file "$FILE" --sha "$sha" 2>&1 | tail -10 >&2 || true
      fi
    else
      log "   ✗ scripts/ghost-read-async.mjs missing — cannot dispatch writing fix"
      exit 4
    fi
  elif [ "$MODE" = "code" ]; then
    # Code-mode fixes are emitted by each rule on stderr (prescription line).
    # The dispatch here re-runs the failing rules with FIX=1 env so they can
    # invoke their own fixer (e.g. eslint --fix, prettier, tsc auto-fix).
    for rname in "${fail_names[@]}"; do
      rule="$RULES_DIR/$rname.sh"
      if [ -x "$rule" ]; then
        log "   fix: FIX=1 $rule $FILE"
        FIX=1 "$rule" "$FILE" 2>&1 | sed 's/^/      /' >&2 || true
      fi
    done
  fi

  # Small pause to let async dispatches settle (post-commit hook + ghost-read)
  # Not a poll — just lets the file-system settle before next rule pass.
  sleep 2
done

hdr "⚠ Iteration cap hit ($MAX_ITER); $fail_count rule(s) still failing"
log "  failing rules: ${fail_names[*]}"
log "  manual review required at $FILE"
exit 1
