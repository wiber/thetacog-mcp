// packages/thetacog-mcp-vscode/src/engine-key-audit.ts — C179a: the /steer worker key is a RESETTABLE DEFAULT.
//
// PURE row-shape + fs append — no vscode import, so the guard drives it directly (the licence-list.ts / engine-key-rows.ts
// discipline). SecretStorage stays the ONE key store (C166 · C179's accepted assumption): this file never holds a key, only
// the AUDIT of a change to one — engine · fp8 of the key (never the key) · at — so which key paid for which worker is
// recomputable without ever reading a secret back. Never written to the repo (the file lives under .thetacog/, this repo's
// own convention for a receipt, not a secret) — the key itself never reaches this file, argv or a log line.
import { createHash } from 'crypto';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/** typing/pasting the literal word `reset` (either case, trimmed) clears the slot instead of storing "reset" as a key —
 * the one door both the ✕ button and a pasted "reset" walk through. */
export function isReset(value: string): boolean {
  return String(value || '').trim().toLowerCase() === 'reset';
}

export function fp8(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

export interface EngineKeyAuditRow { at: string; engine: string; action: 'set' | 'clear' | 'reset'; fp8: string | null }

/** engine · fp8 of the key (null on clear/reset) · at — never the value itself, so the row is safe wherever a receipt lives. */
export function auditRow(engine: string, value: string | null, action: 'set' | 'clear' | 'reset' = value == null ? 'clear' : 'set', at: string = new Date().toISOString()): EngineKeyAuditRow {
  return { at, engine, action, fp8: value ? fp8(value) : null };
}

export const AUDIT_FILE = '.thetacog/engine-key-changes.ndjson';   // relative to the workspace root — the caller resolves it

export function appendAuditRow(row: EngineKeyAuditRow, file: string): void {
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(row) + '\n'); } catch { /* the audit is a receipt, never a gate */ }
}
