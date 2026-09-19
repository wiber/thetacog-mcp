#!/bin/bash
# Builds (if needed) and runs the PMU Rust on-chip daemon shipped in thetacog-mcp.
# Prefers the PREBUILT daemon (ships for macOS Apple Silicon) so `npx thetacog-pmu-rust`
# runs instantly with no toolchain; falls back to `cargo build` from the bundled source
# on other platforms. All args pass through (e.g. --throughput, --ballistic, --sense).

set -e

# Resolve through the npm .bin SYMLINK to the real script location — without this,
# `$DIR/../pmu-rust` resolves to node_modules/pmu-rust (wrong) when invoked via npx.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    TARGET="$(readlink "$SOURCE")"
    case "$TARGET" in
        /*) SOURCE="$TARGET" ;;
        *)  SOURCE="$(cd "$(dirname "$SOURCE")" && pwd)/$TARGET" ;;
    esac
done
DIR="$( cd "$( dirname "$SOURCE" )" && pwd )"
PKG_ROOT="$( cd "$DIR/.." && pwd )"

# 1) Prebuilt daemon (macOS arm64 ships this) — run it directly, no build.
PREBUILT="$PKG_ROOT/.thetacog/pmu/target/release/pmu-onchip"
if [ -x "$PREBUILT" ]; then
    exec "$PREBUILT" "$@"
fi

# 2) Build from the bundled Rust source (other platforms; needs a Rust toolchain).
PMU_DIR="$PKG_ROOT/pmu-rust"
if [ ! -d "$PMU_DIR" ]; then
    echo "Error: no prebuilt daemon and no pmu-rust source found under $PKG_ROOT" >&2
    exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
    echo "Error: the prebuilt daemon is macOS Apple Silicon only; on $(uname -s)/$(uname -m) you need a Rust toolchain to build it." >&2
    echo "Install rustup (https://rustup.rs), then re-run. Native Linux prebuilds are on the roadmap." >&2
    exit 1
fi
echo "🦀 Building PMU Rust daemon from source ($(uname -s)/$(uname -m))…" >&2
cargo build --release --manifest-path "$PMU_DIR/Cargo.toml"
exec "$PMU_DIR/target/release/pmu-onchip" "$@"
