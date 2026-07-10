#!/bin/bash
# Installs the example post-commit hook for async cognitive ingest

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOOK_SRC="$DIR/../hooks/post-commit.example"
GIT_HOOK_DIR=".git/hooks"
HOOK_DEST="$GIT_HOOK_DIR/post-commit"

if [ ! -d ".git" ]; then
    echo "❌ Error: Must be run from the root of a git repository."
    exit 1
fi

mkdir -p "$GIT_HOOK_DIR"

if [ -f "$HOOK_DEST" ]; then
    echo "⚠️  A post-commit hook already exists at $HOOK_DEST."
    echo "   Please merge the contents manually from:"
    echo "   $HOOK_SRC"
    exit 0
fi

cp "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "✅ Installed ThetaCog async ingest post-commit hook at $HOOK_DEST"
echo "   Customize it to point to your preferred LLM CLI (Gemini or Claude)."
