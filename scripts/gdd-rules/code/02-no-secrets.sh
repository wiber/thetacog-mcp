#!/usr/bin/env bash
# Rule: no obvious secrets in the file (API keys, OAuth tokens, credentials).
# Heuristic regex covers the most common leak shapes; not exhaustive (use
# gitleaks for prod gates). Designed to be fast and silent on clean files.
FILE="$1"

# Skip generated/lockfile files
case "$FILE" in
  *.lock|*-lock.json|*-lock.yaml|*.lockfile) exit 0 ;;
  package-lock.json|yarn.lock|pnpm-lock.yaml) exit 0 ;;
esac

hits=$(grep -nE '(AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{32,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)' "$FILE" 2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "potential secret(s) in $FILE:" >&2
  echo "$hits" | head -5 | sed 's/^/  /' >&2
  exit 1
fi
exit 0
