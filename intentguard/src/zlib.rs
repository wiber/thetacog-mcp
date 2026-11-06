// src/zlib.rs — the vendored-zlib FFI the shared modules reach as `crate::lens` (C490a).
//
// In IntentGuard this block lives inside src/lens.rs, and aperture.rs / png.rs call it as `crate::lens::…`. This
// monorepo crate carries the ten modules pmu-onchip and IntentGuard share, not the lens (each binary keeps its own
// lens.rs), so lib.rs mounts THIS file at `crate::lens` and the ten modules compile here unchanged, byte for byte what
// the carve copies into IntentGuard. The block below is pmu-onchip's lens.rs from its zlib banner through the end of
// node_gzip_len, verbatim; tests/ops/c462-intentguard-is-generated.test.mjs fails the day the two differ.
// build.rs compiles vendor/zlib once, here; pmu-onchip's lens.rs declares the same symbols and links these.

// ── the vendored Node/Chromium zlib (deflate side), linked by build.rs ──────────────────
// ONE declaration of the vendored-zlib FFI for the whole crate. png.rs deflates PNG IDAT with the
// same symbols at different settings (zlib wrapper, level 9); declaring them twice with two
// different ZStream types produced a clashing_extern_declarations warning — layout-identical and
// therefore harmless today, and exactly the kind of thing that stops being harmless quietly.
#[repr(C)]
pub struct ZStream {
    pub next_in: *mut u8,
    pub avail_in: u32,
    pub total_in: std::ffi::c_ulong,
    pub next_out: *mut u8,
    pub avail_out: u32,
    pub total_out: std::ffi::c_ulong,
    pub msg: *mut std::ffi::c_char,
    pub state: *mut std::ffi::c_void,
    pub zalloc: Option<extern "C" fn()>,
    pub zfree: Option<extern "C" fn()>,
    pub opaque: *mut std::ffi::c_void,
    pub data_type: i32,
    pub adler: std::ffi::c_ulong,
    pub reserved: std::ffi::c_ulong,
}

extern "C" {
    pub fn deflateInit2_(
        strm: *mut ZStream,
        level: i32,
        method: i32,
        window_bits: i32,
        mem_level: i32,
        strategy: i32,
        version: *const std::ffi::c_char,
        stream_size: i32,
    ) -> i32;
    pub fn deflate(strm: *mut ZStream, flush: i32) -> i32;
    pub fn deflateEnd(strm: *mut ZStream) -> i32;
    pub fn deflateBound(strm: *mut ZStream, source_len: std::ffi::c_ulong) -> std::ffi::c_ulong;
}

const Z_DEFAULT_COMPRESSION: i32 = -1; // node gzipSync default level
const Z_DEFLATED: i32 = 8;
const Z_DEFAULT_STRATEGY: i32 = 0;
const Z_FINISH: i32 = 4;
const Z_OK: i32 = 0;
const Z_STREAM_END: i32 = 1;
const GZIP_WINDOW_BITS: i32 = 15 + 16; // gzip wrapper, node default windowBits 15
const MEM_LEVEL: i32 = 8; // node default

/// gzip length EXACTLY as node's `gzipSync(Buffer.from(s,'utf8')).length` computes it.
pub fn node_gzip_len(data: &[u8]) -> usize {
    unsafe {
        let mut s: ZStream = std::mem::zeroed();
        let version = b"1.3.1\0";
        let rc = deflateInit2_(
            &mut s,
            Z_DEFAULT_COMPRESSION,
            Z_DEFLATED,
            GZIP_WINDOW_BITS,
            MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            version.as_ptr() as *const std::ffi::c_char,
            std::mem::size_of::<ZStream>() as i32,
        );
        assert_eq!(rc, Z_OK, "deflateInit2 failed ({})", rc);
        let cap = deflateBound(&mut s, data.len() as std::ffi::c_ulong) as usize + 32;
        let mut out = vec![0u8; cap];
        s.next_in = data.as_ptr() as *mut u8;
        s.avail_in = data.len() as u32;
        s.next_out = out.as_mut_ptr();
        s.avail_out = cap as u32;
        let rc = deflate(&mut s, Z_FINISH);
        assert_eq!(rc, Z_STREAM_END, "deflate(Z_FINISH) failed ({})", rc);
        let len = s.total_out as usize;
        deflateEnd(&mut s);
        len
    }
}
