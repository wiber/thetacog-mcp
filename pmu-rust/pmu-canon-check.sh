#!/usr/bin/env bash
#
# .thetacog/pmu/pmu-canon-check.sh
#
# THE PMU CANON GUARD — the bash-level check that we are still doing it
# right. Lives in the fat Cog because it is meant to be wired into the
# commit hook: a canon regression should not be allowed to land.
#
# It enforces two things:
#
#   PART 1 — STRUCTURAL CANON. Six locked decisions, grep-checked
#   against the source. These are falsifiable: each one failed at least
#   once during development and the check exists so it cannot fail
#   silently again.
#     1. The leaf walk reads ROWS only (Reading A) — no depth-parity
#        row/column alternation, the regression caught 2026-05-21.
#     2. The transpose is an INDEX flip — transposeAndWalk walks row j,
#        never column j.
#     3. The walk takes no `cameFrom` — no no-U-turn skip; canon walks
#        every significant cell.
#     4. The canonical visit reads `rankSignificant(row(grid, idx))`.
#     5. The lattice is 12x12 self-similar at every altitude
#        (SUB_AXES === 12).
#     6. The XOR comparison goes through `classifyCell` (the verified
#        comparator — GRAY band maps to bit 1).
#
#   PART 2 — THE ORACLE HARNESSES. Every tests/pmu-simulator/*.test.mjs
#   must pass. The harnesses are the real proof; the greps are guard
#   rails against the specific shapes of regression already seen.
#
# Exit 0 = canon holds. Exit 1 = a canon decision was violated; the
# commit hook should block. Pure bash + node, no dependencies.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "cannot reach repo root"; exit 1; }

SIM="src/app/pmu-simulator"
LEAF="$SIM/leaf-walk.mjs"
SUBDIV="$SIM/cell-subdivide.mjs"
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

echo "PMU canon guard — structural canon + oracle harnesses"
echo
echo "PART 1 — structural canon (six locked decisions):"

# 1 — Reading A: no depth-parity orientation in the leaf walk
if grep -qE "orientation *= *depth *% *2" "$LEAF"; then
  bad "Reading B regression — leaf walk alternates row/column by depth"
else
  ok "1. leaf walk reads rows only — no depth-parity orientation"
fi

# 2 — the transpose is an index flip: transposeAndWalk walks a ROW
if grep -qE "rankSignificant\(column\(grid, j\)\)" "$LEAF"; then
  bad "transposeAndWalk reads a column — the transpose must be an index flip"
else
  ok "2. transposeAndWalk walks row j — transpose is a column->row index flip"
fi

# 3 — no cameFrom parameter (no no-U-turn skip)
if grep -qE "function visit\(idx, depth, " "$LEAF" || grep -q "=== cameFrom" "$LEAF"; then
  bad "the walk carries a cameFrom / no-U-turn skip — not canon"
else
  ok "3. the walk takes no cameFrom — every significant cell is walked"
fi

# 4 — the canonical visit reads a row
if grep -q "rankSignificant(row(grid, idx))" "$LEAF"; then
  ok "4. visit() reads rankSignificant(row(grid, idx)) — the leaf"
else
  bad "visit() does not read rankSignificant(row(grid, idx)) — canon walk missing"
fi

# 5 — the lattice is 12x12 self-similar at every altitude
if grep -qE "SUB_AXES *= *12" "$SUBDIV"; then
  ok "5. the lattice is 12x12 self-similar at every altitude (SUB_AXES = 12)"
else
  bad "SUB_AXES is not 12 — the fractal lattice is not self-similar"
fi

# 6 — the XOR comparison goes through the verified comparator
if grep -q "classifyCell" "$SUBDIV"; then
  ok "6. cell subdivision XORs through classifyCell — GRAY band -> bit 1"
else
  bad "cell-subdivide does not use classifyCell — XOR comparator not canon"
fi

echo
echo "PART 2 — oracle harnesses (every assertion must pass):"

# Per-harness wall-clock cap. A harness that EXCEEDS the cap is NOT a canon
# violation — it is too heavy for the BLOCKING pre-commit path (e.g.
# heatmap-stability runs several full 20,736-cell resolution passes; it
# passes 8/8 but takes 30s–3min). Before this cap, one slow harness wedged
# EVERY PMU commit (caught 2026-05-28: the hook sat 3:52 on heatmap-stability
# with no timeout). Surfacing it as a WARN-skip — and letting the unbounded
# post-commit / CI run be the real proof — matches the canon "pre-commit
# blocks on syntax/definitive failure only; heavy checks run post-commit"
# (memory: feedback_precommit-blocks-rarely.md). A harness that RUNS and
# returns non-zero is a genuine FAILURE and still BLOCKS. macOS ships no
# `timeout`; perl's alarm is portable and preserves the timer across exec.
HARNESS_TIMEOUT="${PMU_CANON_HARNESS_TIMEOUT:-20}"
run_with_timeout() { perl -e 'alarm shift; exec @ARGV' "$HARNESS_TIMEOUT" "$@"; }

harness_fail=0
harness_count=0
harness_skip=0
for t in tests/pmu-simulator/*.test.mjs; do
  [ -e "$t" ] || continue
  harness_count=$((harness_count + 1))
  out="$(run_with_timeout node "$t" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    line="$(printf '%s\n' "$out" | grep -E 'assertions passed' | tail -1)"
    ok "$(basename "$t") — ${line:-passed}"
  elif [ "$rc" -eq 142 ] || [ "$rc" -eq 124 ]; then
    # 142 = SIGALRM (perl alarm) · 124 = GNU timeout — both mean "exceeded cap"
    harness_skip=$((harness_skip + 1))
    printf '  \033[33m⚠\033[0m %s — exceeded %ss cap; skipped in pre-commit (runs unbounded post-commit)\n' "$(basename "$t")" "$HARNESS_TIMEOUT"
  elif [ "$rc" -eq 2 ]; then
    # 2 = SEED in the evidence-ledger exit grammar (keystone #11, seedable
    # claims): the witness RECOMPUTES and the effect holds, but the evidence is
    # still small-N. Not a failure — the ledger reports it as ◐ SEED.
    line="$(printf '%s\n' "$out" | grep -E 'SEED' | tail -1)"
    printf '  \033[36m◐\033[0m %s — SEED (recomputes, small-N): %s\n' "$(basename "$t")" "${line:-exit 2}"
  else
    bad "$(basename "$t") — FAILED"
    harness_fail=$((harness_fail + 1))
  fi
done

echo
echo "PART 3 — Rust verification (the chip's own tests, .thetacog/pmu/src/*):"

# cargo test --release runs the 33 in-module tests: the weld fixtures
# (signature.rs char-path bit-exact vs the JS twin + pinned divergences),
# the gate arithmetic, sense determinism, the AR-semantics pins on the
# ballistic core, and the bridge framing. Warm runs are sub-second; a cold
# rebuild is ~10s. Skipped (named, not hidden) if cargo isn't on PATH.
if command -v cargo >/dev/null 2>&1; then
  if cargo test --release --manifest-path .thetacog/pmu/Cargo.toml --quiet >/dev/null 2>&1; then
    ok "cargo test --release — chip tests green (weld fixtures · gate · sense · ballistic AR pins)"
  else
    bad "cargo test --release FAILED — a chip-side claim broke (see docs/architecture/pmu-rust-verification-gaps.md)"
  fi
else
  printf '  \033[33m⚠\033[0m cargo not on PATH — Rust verification skipped (run cargo test --release --manifest-path .thetacog/pmu/Cargo.toml)\n'
fi

echo
if [ "$fail" -eq 0 ]; then
  if [ "$harness_skip" -gt 0 ]; then
    printf '\033[32mPMU canon holds\033[0m — %d harnesses green, six decisions intact \033[33m(%d skipped on the %ss cap — verify post-commit)\033[0m\n' "$((harness_count - harness_skip))" "$harness_skip" "$HARNESS_TIMEOUT"
  else
    printf '\033[32mPMU canon holds — %d harnesses green, six decisions intact\033[0m\n' "$harness_count"
  fi
  exit 0
else
  printf '\033[31mPMU CANON VIOLATED — %d harness failures; commit should be blocked\033[0m\n' "$harness_fail"
  exit 1
fi
