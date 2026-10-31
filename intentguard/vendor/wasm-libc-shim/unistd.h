/* wasm32-unknown-unknown has no libc: zconf.h includes unistd.h only for off_t and SEEK_*; nothing else is reached. */
#ifndef WASM_LIBC_SHIM_UNISTD_H
#define WASM_LIBC_SHIM_UNISTD_H
#include <sys/types.h>
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#endif
