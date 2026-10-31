/* wasm32-unknown-unknown has no libc: zconf.h includes this only to spell z_off_t. */
#ifndef WASM_LIBC_SHIM_SYS_TYPES_H
#define WASM_LIBC_SHIM_SYS_TYPES_H
#include <stddef.h>
typedef long off_t;
typedef long ssize_t;
#endif
