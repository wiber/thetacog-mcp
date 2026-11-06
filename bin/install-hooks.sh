#!/bin/bash
# Installs ThetaCog git hooks: the async cognitive-ingest post-commit, and — with --pre-push (or
# the `npx thetacog-mcp init-hooks` entrypoint) — the README-as-spec ADVISORY governor pre-push.

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
GIT_HOOK_DIR=".git/hooks"

if [ ! -d ".git" ]; then
    echo "❌ Error: Must be run from the root of a git repository."
    exit 1
fi
mkdir -p "$GIT_HOOK_DIR"

install_hook() {   # <src> <dest-name> <label>
    local src="$1" dest="$GIT_HOOK_DIR/$2" label="$3"
    if [ -f "$dest" ] && ! grep -q "ThetaCog" "$dest" 2>/dev/null; then
        echo "⚠️  A $2 hook already exists at $dest — not overwriting."
        echo "   Merge manually from: $src"
        return 0
    fi
    cp "$src" "$dest"; chmod +x "$dest"
    echo "✅ Installed $label at $dest"
}

install_hook "$DIR/../hooks/post-commit.example" "post-commit" "ThetaCog async-ingest post-commit"

# --pre-push (or `init-hooks`): arm the README-as-spec advisory governor.
if [ "${1:-}" = "--pre-push" ] || [ "${1:-}" = "--all" ]; then
    install_hook "$DIR/../hooks/pre-push.example" "pre-push" "ThetaCog README-as-spec governor (advisory pre-push)"
    echo ""
    echo "🛰️  The governor is armed. On every push it measures code-vs-README-spec (LLM-free, ~1s) and,"
    echo "    on a rupture, prints a 'get to work' investigation prompt to .thetacog/prepush.log."
    echo "    It NEVER blocks the push. Recompute any time: npx thetacog-mcp spec-drift"
fi

# --interventions (or --all): arm the out-of-lane INTERVENTION knock-on (detached post-commit).
# If a ThetaCog post-commit is already installed, the dispatch is CHAINED onto it (never overwritten).
if [ "${1:-}" = "--interventions" ] || [ "${1:-}" = "--all" ]; then
    PC="$GIT_HOOK_DIR/post-commit"
    if [ -f "$PC" ] && grep -q "ThetaCog" "$PC" 2>/dev/null && ! grep -q "intervene --sha" "$PC" 2>/dev/null; then
        sed -e '1{/^#!/d;}' -e '/^exit 0$/d' "$DIR/../hooks/intervention-fire.example" >> "$PC"
        echo "✅ Chained the ThetaCog intervention fire onto the existing post-commit"
    elif [ ! -f "$PC" ]; then
        install_hook "$DIR/../hooks/intervention-fire.example" "post-commit" "ThetaCog intervention fire (detached post-commit)"
    elif grep -q "intervene --sha" "$PC" 2>/dev/null; then
        echo "ℹ️  Intervention fire already armed in $PC"
    else
        echo "⚠️  A non-ThetaCog post-commit exists — merge manually from hooks/intervention-fire.example"
    fi
    echo ""
    echo "🛠️  The intervention loop is armed. When a commit's drift receipt lands OUT of its lane"
    echo "    (driftPct > kill vs your README-as-spec) it counts ONE event, sensemakes the drift"
    echo "    (INTERVENE_LLM=claude|gemini|none), publishes the story, and MEASURES whether prior"
    echo "    interventions actually reduced drift (the loop is graded by the pipeline, never by itself)."
    echo "    Recompute: npx thetacog-mcp intervene · close the loop: npx thetacog-mcp intervene --verify"
fi

echo "   Customize post-commit to point to your preferred LLM CLI (Gemini or Claude)."
