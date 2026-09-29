// packages/thetacog-mcp-vscode/src/engine-key-rows.ts — C179: the 🔑 API key sub-pill inside the ⚡ Runner card.
//
// PURE — no vscode, no fs, no network — so the guard transpiles and runs THIS file directly, the same discipline
// licence-list.ts set (C182d). Two small tables, never a third store: the operator's accepted assumption for this row is
// ONE key store (SecretStorage, C166) — this pill is a FACE of it, never a second one. "key held (fp8)" never prints the
// key: fp8 is sha256(value).slice(0, 8), a one-way, non-secret fingerprint of the SECRET'S BYTES — the same convention
// pubkey_fingerprint already uses for the device key (slice(0, 8) of a sha256), just applied to a different input.
import { createHash } from 'crypto';

export interface EngineKeyRowSpec { engine: string; secret: string | null; built: boolean }

// ONE row per engine the runner CAN dispatch (runner-resolver.mjs's PRESETS names them) — never a row vna-engines.ts's
// own SECRET_NAMES/PRESETS tables do not also carry, so the two never drift silently (the C166-style diff guard).
// `built` mirrors steer-ui.mjs's own SEAMS array (C167f): today only claude-code-headless actually dispatches — the
// others are a real preset selection with no driver seam yet (C168e/C168g), so a key held for them would be spent on
// nothing. OPENROUTER_API_KEY names no preset of its own yet; it still gets a row so a key set there is not invisible.
export const ENGINE_KEY_ROWS: ReadonlyArray<EngineKeyRowSpec> = Object.freeze([
  Object.freeze({ engine: 'claude/claude -p', secret: 'ANTHROPIC_API_KEY', built: true }),
  Object.freeze({ engine: 'openrouter', secret: 'OPENROUTER_API_KEY', built: false }),
  Object.freeze({ engine: 'goose/qwen2.5-coder:3b', secret: 'OLLAMA_HOST', built: false }),
  Object.freeze({ engine: 'ollama/qwen2.5-coder:3b', secret: 'OLLAMA_HOST', built: false }),
  Object.freeze({ engine: 'custom', secret: 'CUSTOM_BEARER_TOKEN', built: false }),
]);

/** sha256(value).slice(0, 8) — never the value; the same one-way convention a pubkey_fingerprint already uses. */
export function fp8(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

export interface EngineKeyRow { engine: string; built: boolean; held: boolean; fp8: string | null; line: string; setAt: string | null }   // C245: setAt from the C179a audit ledger, null when no row

/** the pure formatting rule C179 names verbatim: an engine that is not built reads UNMEASURED — never the key state. */
export function engineKeyLine(row: { built: boolean }, held: boolean, hash: string | null): string {
  if (!row.built) return 'UNMEASURED — not built';
  return held && hash ? `key held (${hash})` : 'no key';
}

/**
 * one row per ENGINE_KEY_ROWS entry, from a { name → value|undefined } map of what SecretStorage currently holds — the
 * caller (vna-engines.ts) is the only thing that ever reads a raw secret value; this function turns it into fp8 and
 * throws the value away in the same expression. A row with no `secret` (none today) reads `no key` and is never built.
 */
export function buildEngineKeyRows(held: Record<string, string | undefined>, setAt: Record<string, string | undefined> = {}): EngineKeyRow[] {
  return ENGINE_KEY_ROWS.map((row) => {
    const v = row.secret ? held[row.secret] : undefined;
    const hash = v ? fp8(v) : null;
    return { engine: row.engine, built: row.built, held: !!v, fp8: hash, line: engineKeyLine(row, !!v, hash), setAt: (row.secret && setAt[row.secret]) || null };
  });
}

/**
 * C245 — WHEN each key was set, read off the C179a audit ledger (.thetacog/engine-key-changes.ndjson: { at, engine (the secret's
 * name), action, fp8 }): the last `set` per secret wins, a `clear`/`reset` forgets it, a line that is not JSON is skipped. Pure —
 * the caller reads the file. Never a made-up time: a held key with no row reads null and the pill says "set — no record".
 */
export function lastSetAt(ndjson: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(ndjson || '').split('\n')) {
    if (!line.trim()) { continue; }
    let r: { at?: string; engine?: string; action?: string } | null = null;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || !r.engine) { continue; }
    if (r.action === 'set' && r.at) { out[r.engine] = r.at; } else if (r.action === 'clear' || r.action === 'reset') { delete out[r.engine]; }
  }
  return out;
}
