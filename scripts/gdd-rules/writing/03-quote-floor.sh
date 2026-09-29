#!/usr/bin/env bash
# Rule: blog posts need ≥10 italic-quoted strings (the NotebookLM/podcast/book
# quote floor from canonical-blog-architecture). Book chapters need ≥5.
# Floor differs by file type; fail message names the floor.
FILE="$1"

# Count *"..."* italic-quoted strings (the canonical quote form)
count=$(grep -oE '\*"[^"]+"\*' "$FILE" | wc -l | tr -d ' ')

floor=10
case "$FILE" in
  books/tesseract/chapters/*) floor=5 ;;
  docs/05-content/blog/scratchpad/*) floor=5 ;;
esac

if [ "$count" -lt "$floor" ]; then
  echo "quote floor: found $count, need ≥$floor italic-quoted strings (form: *\"...\"*)" >&2
  exit 1
fi
exit 0
