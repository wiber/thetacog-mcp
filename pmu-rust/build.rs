// .thetacog/pmu/build.rs — compile the VENDORED Node/Chromium zlib (deflate side only).
//
// WHY THIS EXISTS (P2, one-pipeline-spec): `pmu-onchip --lens` must reproduce the JS
// pipeline's gzip-NCD seeding BYTE-FOR-BYTE. Node does NOT ship stock zlib: since ~v16 it
// bundles Chromium's zlib fork, whose hardware-CRC insert_string produces DIFFERENT (valid)
// deflate streams than stock zlib / miniz_oxide / zlib-ng / cloudflare-zlib. Measured
// 2026-08-06 on the 144-target corpus: miniz 287/289 length mismatches, stock zlib 287/289,
// cloudflare 13/289 — and the mismatches REORDER the top-3 seed set (B3,B3 overtakes C,C on
// the golden prompt), which moves the placement pixel. So the ONLY faithful compressor is
// Node's own: vendor/zlib is a verbatim copy of nodejs/node v20.20.0 deps/zlib (Chromium
// fork), compiled here with the same defines node's zlib.gyp uses for this platform.
// Parity proof: 289/289 identical gzip lengths vs node:zlib gzipSync (golden prompt + 144
// snippets + 144 joins). flate2/miniz stays for sense.rs (its NCD is self-consistent);
// lens.rs alone links these symbols (no other C zlib in the binary — no collisions).
//
// DEPENDENCY NOTE: if the operator's Node major changes its bundled zlib, re-run the parity
// sweep (tests/pmu-simulator/p2-lens-gate.test.mjs catches divergence at the seed level).

fn main() {
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    let mut build = cc::Build::new();
    build
        .include("vendor/zlib")
        .file("vendor/zlib/adler32.c")
        .file("vendor/zlib/cpu_features.c")
        .file("vendor/zlib/crc32.c")
        .file("vendor/zlib/deflate.c")
        .file("vendor/zlib/trees.c")
        .file("vendor/zlib/zutil.c")
        // Unprefixed symbols (no Cr_z_*): nothing else in this binary links a C zlib.
        .define("CHROMIUM_ZLIB_NO_CHROMECONF", None)
        .define("HAVE_HIDDEN", None)
        .define("USE_FILE32API", None)
        .flag_if_supported("-Wno-deprecated-non-prototype")
        .flag_if_supported("-Wno-unused-function")
        // vendored source stays VERBATIM (parity provenance) — silence its style warnings
        // here rather than patching upstream files.
        .flag_if_supported("-Wno-unused-parameter");

    // The defines below mirror node's zlib.gyp for each platform. The OUTPUT-affecting one
    // is CRC32_ARMV8_CRC32 / the SIMD insert_string path — it changes deflate's match
    // finding, which is exactly the divergence measured above. arm64-macOS is the parity
    // platform (the operator's box); other platforms get node's corresponding defines so
    // the binary still matches the Node running THERE.
    if target_arch == "aarch64" {
        build
            .define("__ARM_NEON__", None)
            .define("ADLER32_SIMD_NEON", None)
            .define("DEFLATE_SLIDE_HASH_NEON", None)
            .define("CRC32_ARMV8_CRC32", None)
            .define("INFLATE_CHUNK_READ_64LE", None)
            .file("vendor/zlib/adler32_simd.c")
            .file("vendor/zlib/crc32_simd.c");
        if target_os == "macos" {
            build.define("ARMV8_OS_MACOS", None);
        } else if target_os == "linux" {
            build.define("ARMV8_OS_LINUX", None);
        }
    } else if target_arch == "x86_64" {
        build
            .define("ADLER32_SIMD_SSSE3", None)
            .define("X86_NOT_WINDOWS", None)
            .define("DEFLATE_SLIDE_HASH_SSE2", None)
            .define("INFLATE_CHUNK_READ_64LE", None)
            .flag_if_supported("-mssse3")
            .file("vendor/zlib/adler32_simd.c");
        // node's gyp DISABLES zlib_crc32_simd on x86 (nodejs/node#45268), so deflate's
        // insert_string stays the C path there — no crc32_simd.c on x86, faithfully.
    } else {
        build.define("CPU_NO_SIMD", None);
    }

    build.compile("nodezlib");
    println!("cargo:rerun-if-changed=vendor/zlib");
}
