#!/usr/bin/env bash
# Rule: full blog posts carry the canonical Six Needs order in their section
# breadcrumbs: Connection → Contribution → Growth → Uncertainty → Certainty →
# Significance. Checks the section titles/labels for the keyword markers.
# Book chapters opt-out (their structure is different).
FILE="$1"

case "$FILE" in
  books/tesseract/chapters/*) exit 0 ;;
  docs/05-content/blog/scratchpad/*) exit 0 ;;
esac

# Only enforce on files that have the labeled A-J pattern
if ! grep -qE 'text-[a-z]+-500.*>(C|D|E|F|G|H)<' "$FILE"; then
  exit 0
fi

# Expected: section headers contain Connection / Contribution / Growth /
# Uncertainty / Certainty / Significance — in that ORDER. Allow trailing
# text after the keyword inside the parenthetical (e.g. "Uncertainty, named
# honestly") so headers can be enriched without breaking the order check.
order=$(grep -oE '\((Connection|Contribution|Growth|Uncertainty|Certainty|Significance)[^)]*\)' "$FILE" | sed -E 's/\(([A-Z][a-z]+).*/\1/' | head -6 | tr '\n' ' ')
expected="Connection Contribution Growth Uncertainty Certainty Significance "

if [ "$order" != "$expected" ]; then
  echo "Six Needs order mismatch:" >&2
  echo "  expected: $expected" >&2
  echo "  found:    $order" >&2
  exit 1
fi
exit 0
