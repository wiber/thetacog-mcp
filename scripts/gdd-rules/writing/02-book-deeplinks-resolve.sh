#!/usr/bin/env bash
# Rule: every /book/chapters/*#anchor link in the file resolves to an actual
# id="anchor" in the built HTML at public/book/chapters/.
# Catches the Apr-26 incident where stale deep links 404'd in production.
FILE="$1"

missing=0
while read -r anchor; do
  [ -z "$anchor" ] && continue
  if ! grep -lqE "id=\"${anchor#\#}\"" public/book/chapters/*.html 2>/dev/null; then
    echo "missing book anchor: $anchor (no id= match in public/book/chapters/)" >&2
    missing=$((missing+1))
  fi
done < <(grep -oE '/book/chapters/[^)#]+#[a-z][a-z0-9-]+' "$FILE" 2>/dev/null | sed 's|.*#|#|' | sort -u)

[ "$missing" -eq 0 ]
