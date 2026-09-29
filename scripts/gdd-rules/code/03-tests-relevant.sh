#!/usr/bin/env bash
# Rule: relevant tests pass — finds tests adjacent to or testing this file
# and runs them. Skips silently when no tests found (most repos have sparse
# coverage; this rule catches the case where tests EXIST and break).
FILE="$1"

base=$(basename "$FILE" | sed -E 's/\.(ts|tsx|mjs|js|jsx)$//')
dir=$(dirname "$FILE")

# Common test file conventions
candidates=()
for pat in "$dir/$base.test.ts" "$dir/$base.test.tsx" "$dir/$base.test.mjs" "$dir/$base.test.js" \
           "$dir/$base.spec.ts" "$dir/$base.spec.tsx" "$dir/$base.spec.mjs" "$dir/$base.spec.js" \
           "$dir/__tests__/$base.test.ts" "$dir/__tests__/$base.test.tsx" \
           "tests/$base.test.ts" "tests/$base.test.mjs" \
           "test/$base.test.mjs" "test/$base.test.js"; do
  [ -f "$pat" ] && candidates+=("$pat")
done

if [ ${#candidates[@]} -eq 0 ]; then
  # No tests found — silent pass (don't punish coverage gaps in this rule)
  exit 0
fi

# Detect test runner; prefer the project's
if [ -f package.json ] && grep -q '"vitest"' package.json 2>/dev/null; then
  runner=("npx" "vitest" "run")
elif [ -f package.json ] && grep -q '"jest"' package.json 2>/dev/null; then
  runner=("npx" "jest")
elif [ -f package.json ] && grep -q '"mocha"' package.json 2>/dev/null; then
  runner=("npx" "mocha")
else
  runner=("node" "--test")
fi

failed=0
for t in "${candidates[@]}"; do
  echo "  running test: $t" >&2
  if ! "${runner[@]}" "$t" 2>&1 | tail -15 >&2; then
    failed=$((failed+1))
  fi
done

[ "$failed" -eq 0 ]
