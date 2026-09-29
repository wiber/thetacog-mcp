#!/usr/bin/env bash
# Rule: MDX file passes validate-mdx.sh (no forbidden chars, no bullet lists,
# frontmatter present, etc.). This is the syntax floor — fails block the build.
FILE="$1"
case "$FILE" in
  *.mdx) ;;
  *)
    # Non-MDX writing files (book .md chapters) skip MDX validation
    exit 0 ;;
esac

if ./scripts/validate-mdx.sh "$FILE" 2>&1 | grep -qE "FAILED|ERROR"; then
  echo "MDX validator reports errors — run: ./scripts/validate-mdx.sh $FILE" >&2
  exit 1
fi
exit 0
