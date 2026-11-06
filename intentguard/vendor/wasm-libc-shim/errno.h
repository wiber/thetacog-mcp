/* wasm32-unknown-unknown has no libc: zutil.h includes errno.h; the deflate side never reads errno (gz* is not compiled). */
#ifndef WASM_LIBC_SHIM_ERRNO_H
#define WASM_LIBC_SHIM_ERRNO_H
extern int errno;
#endif
