/* wasm32-unknown-unknown has no libc: deflate.c includes assert.h; the vendored source is built without ZLIB_DEBUG. */
#ifndef WASM_LIBC_SHIM_ASSERT_H
#define WASM_LIBC_SHIM_ASSERT_H
#define assert(x) ((void)0)
#endif
