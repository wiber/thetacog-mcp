// scripts/bookclub/internal-addresses.mjs — RE-EXPORT SHIM. The definition moved to
// src/lib/internal-addresses.mjs (2026-09-01) so the live /api/ticker route can bundle it;
// this shim keeps every scripts/bookclub consumer working without a churn commit. ONE RULE
// ONE PLACE: edit the src/lib file, never re-grow patterns here.
export * from '../../src/lib/internal-addresses.mjs';
