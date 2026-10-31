#!/usr/bin/env bash
# Rule: catch auto-rewrite damage shapes that cross register seams.
# The 2026-05-23 meta-analysis named this as the loop's primary failure mode:
# a single-persona-optimal lift can break the multi-register voice the post
# is held to. Specific damage shapes the analysis named:
#   · "claim worth attacking" / "line worth attacking" — invites academic
#     register intrusion on procurement register
#   · "post" as self-referential noun (the post / this post / the rest of
#     this post) — thought-leadership register, not buyer register
#   · "claim made early so you can attack it" — argumentative meta-stance
#
# Fail = damage shape found in body prose.
# Exempt = post-scaffolding comments, planning docs, scratchpad.
FILE="$1"

case "$FILE" in
  docs/05-content/blog/scratchpad/*) exit 0 ;;
  *.html) exit 0 ;;  # spec docs use these phrases legitimately
esac

# Damage shapes — regex on body prose (skip frontmatter + JSX containers)
damage_patterns=(
  '(claim|line|thesis|argument)[s]? worth attacking'
  'attack the (claim|line|thesis|argument)'
  '(the |this )post (commits|argues|asserts|holds|presents|reads|opens|closes)'
  'the rest of (the |this )post'
  '\(the post\)'
)

hits=0
for pat in "${damage_patterns[@]}"; do
  matches=$(grep -niE "$pat" "$FILE" | grep -vE '^\s*\{?/?\*' | grep -vE '<!--' || true)
  if [ -n "$matches" ]; then
    echo "register-coherence: damage shape '$pat':" >&2
    echo "$matches" | head -3 | sed 's/^/  /' >&2
    hits=$((hits+1))
  fi
done

[ "$hits" -eq 0 ]
