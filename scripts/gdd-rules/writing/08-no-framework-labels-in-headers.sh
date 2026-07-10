#!/usr/bin/env bash
# Rule: framework labels (Six-Needs words, cardinal letters, ShortLex coords)
# belong in scaffolding/spec docs, NOT in published section headers.
# Caught by the Claude ghost-read run on 2026-05-23 as the highest-leverage
# voice-discipline gap the other runs missed.
#
# Specifically: §C "(Connection)", §F "(Uncertainty, named honestly)" etc.
# leak the writing framework into the rendered prose. Strip them; the section
# does its job without naming its slot in the framework.
#
# Operator rule from memory: "labels in scaffolding only, stripped from
# published prose" (auto-coincidence at every scale).
FILE="$1"

# Only enforce on published surface — published blog .mdx files
case "$FILE" in
  src/content/blog/*.mdx) ;;
  *) exit 0 ;;
esac

# Frameworks whose labels should NOT appear in <span> section titles
framework_labels='(Connection|Contribution|Growth|Uncertainty|Certainty|Significance)'

hits=$(grep -nE "<span[^>]*font-semibold[^>]*>[A-J] —.*\($framework_labels[^)]*\)" "$FILE" || true)

if [ -n "$hits" ]; then
  echo "framework-label leak in section header(s):" >&2
  echo "$hits" | head -5 | sed 's/^/  /' >&2
  echo "  → strip the parenthetical; labels belong in scaffolding only" >&2
  exit 1
fi
exit 0
