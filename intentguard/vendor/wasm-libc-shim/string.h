/* wasm32-unknown-unknown has no libc: zutil.h maps zmemcpy/zmemzero onto these; Rust's compiler-builtins provides them. */
#ifndef WASM_LIBC_SHIM_STRING_H
#define WASM_LIBC_SHIM_STRING_H
#include <stddef.h>
void *memcpy(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
#endif
