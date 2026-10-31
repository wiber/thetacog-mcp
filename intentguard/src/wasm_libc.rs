// src/wasm_libc.rs — the libc the vendored zlib links on wasm32-unknown-unknown, and the C-ABI door a host calls
// (C79, milestone #79: the walker builds for wasm32, so it runs where no Rust toolchain is installed).
//
// wasm32-unknown-unknown ships no libc. vendor/zlib's deflate side needs exactly malloc/calloc/free (zutil.c's
// zcalloc/zcfree) and memcpy/memset (zutil.h's zmemcpy/zmemzero); the mem* family comes from Rust's compiler-builtins
// on this target, the allocator comes from here. Each block is Rust's global allocator behind a 16-byte header that
// remembers the size, so free() can rebuild the Layout. lib.rs mounts this module ONLY on wasm32-unknown-unknown: on
// a target with a libc these symbols would collide with it, which is the whole reason the cfg names the OS too.
//
// What this is sufficient for: the same bytes reach the same deflate code the native binary links, inside a .wasm a
// host runs with no toolchain. NOT sufficient for: byte parity with arm64-macOS Node — wasm compiles the CPU_NO_SIMD
// path (no CRC32 insert_string), so a gzip length here is Node-on-a-no-SIMD-platform's length; the guard measures the
// gap against node:zlib instead of assuming it is zero. Guard: tests/ops/wasm-walker-builds.test.mjs

use std::alloc::{alloc, dealloc, Layout};

const HEADER: usize = 16; // keeps the payload 16-byte aligned, the widest alignment zlib's structs ask for

#[no_mangle]
pub unsafe extern "C" fn malloc(n: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(n + HEADER, HEADER) else { return std::ptr::null_mut() };
    let base = alloc(layout);
    if base.is_null() {
        return base;
    }
    (base as *mut usize).write(n);
    base.add(HEADER)
}

#[no_mangle]
pub unsafe extern "C" fn calloc(items: usize, size: usize) -> *mut u8 {
    let Some(n) = items.checked_mul(size) else { return std::ptr::null_mut() };
    let p = malloc(n);
    if !p.is_null() {
        std::ptr::write_bytes(p, 0, n);
    }
    p
}

#[no_mangle]
pub unsafe extern "C" fn free(p: *mut u8) {
    if p.is_null() {
        return;
    }
    let base = p.sub(HEADER);
    let n = (base as *const usize).read();
    dealloc(base, Layout::from_size_align_unchecked(n + HEADER, HEADER));
}

/// The host's door: gzip length of `len` bytes at `ptr` (bytes the host wrote into a `malloc` block), EXACTLY as
/// `crate::lens::node_gzip_len` computes it natively. A host that wants the walk itself follows the same shape:
/// malloc → write → call → free. No wasm-bindgen, no JS glue: `WebAssembly.instantiate` and these exports.
#[no_mangle]
pub unsafe extern "C" fn intentguard_node_gzip_len(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() {
        return 0;
    }
    crate::lens::node_gzip_len(std::slice::from_raw_parts(ptr, len))
}
