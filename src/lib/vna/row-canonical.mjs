// src/lib/vna/row-canonical.mjs — THE ONE RULE for a flight-tape row's signed bytes (C50, C63, C90; lifted here for C97c).
// A row's signature and its row_sha are over canonical(row): the SIGNED_KEYS in this fixed order, an absent field as null,
// JSON with no whitespace. A verifier on foreign metal (npx thetacog-mcp verify <url>) rebuilds the same bytes from the row's
// fields with nothing else from this repo — so this module imports nothing. SIGNED_KEYS do not move: a row signed on
// 2026-09-17 verifies unchanged today; a new fact rides INSIDE proofs or delta (the C63 precedent), never as a new key here.
// scripts/vna/flight-tape.mjs re-exports these; every other reader imports from one of the two, never a third copy.
import { createHash } from 'node:crypto';

export const SIGNED_KEYS = ['seq', 'ts', 'kind', 'prev', 'sha', 'session', 'room', 'proofs', 'delta', 'seed', 'gauge'];
export const canonical = (row) => JSON.stringify(Object.fromEntries(SIGNED_KEYS.map((k) => [k, row[k] === undefined ? null : row[k]])));
export const rowSha = (row) => createHash('sha256').update(canonical(row), 'utf8').digest('hex');
