#!/usr/bin/env bash
# thetacog-rewrite — open the Ghost-Read Matrix on a file.
#
#   thetacog-rewrite docs/chapter-08.md
#   thetacog-rewrite src/app/blog/post/page.tsx --port 4400
#   thetacog-rewrite --tracks A,C            # local vs cloud, no Tesseract fence
#
# SINGLE RUNNER ON A FIXED PORT, same discipline as attest-serve: a second console on a
# second port would be a second view of the same mailbox, and two views that disagree is
# how you end up debugging the instrument instead of the prose. If the port answers, we
# open that one rather than binding a new one.

set -euo pipefail

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${REWRITE_PORT:-4319}"
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    -h|--help)
      echo "usage: thetacog-rewrite [file] [--port N] [--tracks A,B,C,D]"
      echo "  A = local · B = local+Tesseract · C = cloud · D = cloud+Tesseract"
      exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
  echo "  ◧ already running on :${PORT} — opening that one"
  open "http://localhost:${PORT}/rewrite" 2>/dev/null || echo "     http://localhost:${PORT}/rewrite"
  exit 0
fi

FILE=""
if [[ ${#ARGS[@]} -gt 0 && "${ARGS[0]}" != --* ]]; then FILE="${ARGS[0]}"; ARGS=("${ARGS[@]:1}"); fi

exec node "$PKG/scripts/rewrite/serve.mjs" \
  --port "$PORT" \
  ${FILE:+--file "$FILE"} \
  "${ARGS[@]+"${ARGS[@]}"}"
