// scripts/lib/sqlite-lazy.mjs — better-sqlite3 loaded on first open, never at import time.
// better-sqlite3 is an optionalDependency of thetacog-mcp, and the vsix engine installs with --omit=optional, so a static
// `import Database from 'better-sqlite3'` crashes every module that merely imports the file (the sidebar doors included).
// Loading it here, at the moment a database is opened, keeps those modules importable and fails only the call that needs it,
// with a reason instead of ERR_MODULE_NOT_FOUND.
// @guard tests/vna/vsix-carries-its-engine.test.mjs (V3)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let Database = null;

export function openSqlite(file, opts) {
  if (!Database) {
    try { Database = require('better-sqlite3'); }
    catch (e) { throw new Error(`better-sqlite3 is not installed (an optional dependency): ${e.code || e.message}`); }
  }
  return new Database(file, opts);
}
