#!/usr/bin/env bash
# Rule: code file passes its language's syntax check.
#  .ts/.tsx → tsc --noEmit
#  .mjs/.js → node --check
#  .py      → python -m py_compile
#  .sh      → bash -n
#  .json    → node -e JSON.parse(readFile)
#  .rs      → cargo check (if Cargo.toml present)
# Returns 0 on clean syntax. FIX=1 triggers auto-fix where supported
# (prettier for ts/js/tsx, ruff for py, shfmt for sh).
FILE="$1"

case "$FILE" in
  *.ts|*.tsx)
    if [ "${FIX:-0}" = "1" ]; then
      npx --yes prettier --write "$FILE" 2>&1 | sed 's/^/      [prettier] /' >&2 || true
    fi
    npx --yes tsc --noEmit --skipLibCheck --jsx preserve --target es2022 --moduleResolution bundler "$FILE" 2>&1 | head -10 >&2
    exit ${PIPESTATUS[0]} ;;
  *.mjs|*.js|*.jsx)
    if [ "${FIX:-0}" = "1" ]; then
      npx --yes prettier --write "$FILE" 2>&1 | sed 's/^/      [prettier] /' >&2 || true
    fi
    node --check "$FILE" 2>&1 | head -5 >&2 ;;
  *.py)
    if [ "${FIX:-0}" = "1" ]; then
      python -m ruff format "$FILE" 2>&1 | sed 's/^/      [ruff] /' >&2 || true
    fi
    python -m py_compile "$FILE" 2>&1 | head -5 >&2 ;;
  *.sh)
    if [ "${FIX:-0}" = "1" ]; then
      command -v shfmt >/dev/null && shfmt -w "$FILE" 2>&1 | sed 's/^/      [shfmt] /' >&2 || true
    fi
    bash -n "$FILE" 2>&1 | head -5 >&2 ;;
  *.json)
    node -e "JSON.parse(require('fs').readFileSync('$FILE','utf8'))" 2>&1 | head -3 >&2 ;;
  *.rs)
    [ -f Cargo.toml ] || { exit 0; }
    cargo check --quiet 2>&1 | head -10 >&2 ;;
  *)
    # Unknown extension — pass (nothing to check)
    exit 0 ;;
esac
