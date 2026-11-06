/* wasm32-unknown-unknown has no libc: zutil.c's zcalloc/zcfree reach these; src/wasm_libc.rs provides them. */
#ifndef WASM_LIBC_SHIM_STDLIB_H
#define WASM_LIBC_SHIM_STDLIB_H
#include <stddef.h>
void *malloc(size_t n);
void *calloc(size_t items, size_t size);
void free(void *p);
#endif
