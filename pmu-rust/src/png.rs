// .thetacog/pmu/src/png.rs — THE PANEL'S LAST MILE, ON THE METAL.
//
// ── WHY THIS IS THE FIRST THING PORTED, NOT THE LAST ──────────────────────────────────────────
// Operator, 2026-08-20: "it concerns me that the one thing we keep returning to as the baseline is
// not in rust. The PNG conversion should be in rust because the encircled panel is the one thing
// that works. It proves that everything moves through it properly and that's the one that we also
// need to know when it breaks."
//
// That is a hole in the argument, not a preference. The encircled panel is the litmus test — the
// artifact we point at to say the pipeline ran correctly end to end. But its last two stages, the
// raster and the encode, were JavaScript. So the thing we trusted as proof that the Rust pipeline
// worked was, in its final step, NOT PRODUCED BY THE RUST PIPELINE. A baseline that is partly
// outside the system it certifies cannot certify it.
//
// ── WHY BYTE-IDENTITY IS ACHIEVABLE AND NOT A RESEARCH PROBLEM ────────────────────────────────
// The obvious objection to porting an encoder is that two deflate implementations produce different
// (equally valid) streams, so the bytes would drift and every Shape_Match_Hash would change. That
// objection is already answered by this crate: build.rs vendors nodejs/node v20.20.0 deps/zlib —
// Chromium's fork, the one node actually ships — precisely because stock zlib, miniz_oxide, zlib-ng
// and cloudflare-zlib each produced different streams (measured: 287/289 length mismatches). The
// parity proof in build.rs is 289/289 identical gzip lengths against node:zlib gzipSync.
//
// So this module reuses THAT zlib, at the settings the JS encoder uses, and the output is the same
// bytes rather than merely an equivalent PNG. Two differences from lens.rs's gzip helper, both
// forced by the PNG spec and by what annotate-regions.mjs actually calls:
//   · windowBits 15 (zlib wrapper) — NOT 15+16 (gzip wrapper). PNG IDAT is a zlib stream.
//   · level 9 — the JS is deflateSync(raw, { level: 9 }), not the gzip default (-1).
//
// ── THE PAYOFF: THE PANEL BECOMES ITS OWN REGRESSION DETECTOR ─────────────────────────────────
// "we also need to know when it breaks." Once the panel is produced entirely on the metal, its
// sha256 is a pure function of the commit, so Shape_Match_Hash stops being a label and becomes a
// tripwire: same inputs must give the same bytes, and any drift anywhere upstream — walk, sensor,
// classification, ring geometry — changes the hash. One number watches the whole chain.
//
// Ported verbatim from scripts/pmu/annotate-regions.mjs pngFromRgba/pngChunk/crc32. The JS stays
// until the differential guard is green over real panels; this is an addition, never a swap.
//
// @guard tests/pmu/png-byte-identical.test.mjs — encodes the same RGBA both ways, asserts equality.

use std::ffi::{c_char, c_int, c_ulong};

// The FFI lives in lens.rs — ONE declaration of the vendored Node/Chromium zlib for the crate.
// This module uses the same symbols at PNG's settings rather than restating them.
use crate::lens::{deflate, deflateBound, deflateEnd, deflateInit2_, ZStream};

const Z_DEFLATED: c_int = 8;
const Z_DEFAULT_STRATEGY: c_int = 0;
const Z_FINISH: c_int = 4;
const Z_OK: c_int = 0;
const Z_STREAM_END: c_int = 1;
const ZLIB_WINDOW_BITS: c_int = 15; // zlib wrapper — PNG IDAT, NOT the gzip 15+16
const MEM_LEVEL: c_int = 8; // node default
const LEVEL_9: c_int = 9; // JS: deflateSync(raw, { level: 9 })

/// Deflate with a zlib wrapper at level 9, byte-for-byte as node's deflateSync(buf, {level:9}).
pub fn node_zlib_deflate_level9(data: &[u8]) -> Vec<u8> {
    unsafe {
        let mut s: ZStream = std::mem::zeroed();
        let version = b"1.3.1\0";
        let rc = deflateInit2_(
            &mut s,
            LEVEL_9,
            Z_DEFLATED,
            ZLIB_WINDOW_BITS,
            MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            version.as_ptr() as *const c_char,
            std::mem::size_of::<ZStream>() as c_int,
        );
        assert_eq!(rc, Z_OK, "deflateInit2 failed ({})", rc);
        let cap = deflateBound(&mut s, data.len() as c_ulong) as usize + 32;
        let mut out = vec![0u8; cap];
        s.next_in = data.as_ptr() as *mut u8;
        s.avail_in = data.len() as u32;
        s.next_out = out.as_mut_ptr();
        s.avail_out = cap as u32;
        let rc = deflate(&mut s, Z_FINISH);
        assert_eq!(rc, Z_STREAM_END, "deflate(Z_FINISH) failed ({})", rc);
        let len = s.total_out as usize;
        deflateEnd(&mut s);
        out.truncate(len);
        out
    }
}

/// The JS crc32, transcribed. Bitwise-identical table-free form so the port is checkable by eye.
pub fn crc32(buf: &[u8]) -> u32 {
    let mut c: u32 = !0;
    for &b in buf {
        c ^= b as u32;
        for _ in 0..8 {
            // JS: c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
            let mask = 0u32.wrapping_sub(c & 1);
            c = (c >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !c
}

fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = Vec::with_capacity(4 + data.len());
    body.extend_from_slice(kind);
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
    out
}

/// RGBA8 → PNG, matching annotate-regions.mjs pngFromRgba exactly:
/// 8-bit depth, colour type 6 (RGBA), filter 0 on every scanline, one IDAT at level 9.
pub fn png_from_rgba(rgba: &[u8], w: usize, h: usize) -> Vec<u8> {
    assert_eq!(rgba.len(), w * h * 4, "rgba length must be w*h*4");
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(w as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(h as u32).to_be_bytes());
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type RGBA
    // ihdr[10..13] stay 0: deflate, adaptive filtering, no interlace — same as the JS Buffer.alloc.

    let stride = 1 + w * 4;
    let mut raw = vec![0u8; h * stride];
    for y in 0..h {
        raw[y * stride] = 0; // filter type 0
        raw[y * stride + 1..y * stride + stride]
            .copy_from_slice(&rgba[y * w * 4..(y + 1) * w * 4]);
    }

    let mut out = Vec::with_capacity(raw.len() / 2 + 128);
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
    out.extend_from_slice(&png_chunk(b"IHDR", &ihdr));
    out.extend_from_slice(&png_chunk(b"IDAT", &node_zlib_deflate_level9(&raw)));
    out.extend_from_slice(&png_chunk(b"IEND", &[]));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // The canonical PNG CRC test vector: crc32("IEND") over the chunk body with empty data.
    #[test]
    fn crc32_matches_known_vectors() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn png_has_the_right_skeleton() {
        let rgba = vec![7u8; 4 * 4 * 4];
        let png = png_from_rgba(&rgba, 4, 4);
        assert_eq!(&png[0..8], &[137, 80, 78, 71, 13, 10, 26, 10], "PNG signature");
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
        // IHDR width/height are big-endian at offsets 16 and 20.
        assert_eq!(u32::from_be_bytes([png[16], png[17], png[18], png[19]]), 4);
        assert_eq!(u32::from_be_bytes([png[20], png[21], png[22], png[23]]), 4);
        assert_eq!(png[24], 8, "bit depth");
        assert_eq!(png[25], 6, "colour type RGBA");
    }

    #[test]
    fn deflate_round_trips_and_is_a_zlib_stream() {
        let data = b"the encircled panel is the litmus test and it must be produced on the metal";
        let z = node_zlib_deflate_level9(data);
        // zlib wrapper, NOT gzip: first byte 0x78 (CM=8, CINFO=7), never 0x1f 0x8b.
        assert_eq!(z[0] & 0x0f, 8, "compression method must be deflate");
        assert_ne!(z[0], 0x1f, "must be a zlib stream, not a gzip stream");
        assert!(z.len() < data.len() + 16);
    }
}

// ── CLI · the differential seam ───────────────────────────────────────────────────────────────
// `pmu-onchip --encode-png --rgba <raw> --width W --height H --out <png>`
// Exists so the byte-identity guard can drive BOTH encoders over the same buffer and diff the
// output. It is deliberately dumb: raw RGBA in, PNG out, no walk, no rendering, no interpretation.
// Until the raster is ported this is the only Rust-produced half of the panel, and the guard is
// what earns it the right to become the whole thing.
pub fn run(args: &[String]) {
    let flag = |name: &str| -> Option<String> {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
    };
    let rgba_path = match flag("--rgba") { Some(p) => p, None => { eprintln!("--encode-png requires --rgba <path>"); std::process::exit(2); } };
    let out_path = match flag("--out") { Some(p) => p, None => { eprintln!("--encode-png requires --out <path>"); std::process::exit(2); } };
    let w: usize = flag("--width").and_then(|s| s.parse().ok()).unwrap_or(0);
    let h: usize = flag("--height").and_then(|s| s.parse().ok()).unwrap_or(0);
    if w == 0 || h == 0 { eprintln!("--encode-png requires --width and --height"); std::process::exit(2); }

    let rgba = match std::fs::read(&rgba_path) { Ok(b) => b, Err(e) => { eprintln!("cannot read {}: {}", rgba_path, e); std::process::exit(2); } };
    if rgba.len() != w * h * 4 {
        eprintln!("rgba is {} bytes, expected {} for {}x{}", rgba.len(), w * h * 4, w, h);
        std::process::exit(2);
    }
    let png = png_from_rgba(&rgba, w, h);
    if let Err(e) = std::fs::write(&out_path, &png) { eprintln!("cannot write {}: {}", out_path, e); std::process::exit(2); }
    println!("{{\"ok\":true,\"bytes\":{},\"width\":{},\"height\":{},\"out\":{:?}}}", png.len(), w, h, out_path);
}
