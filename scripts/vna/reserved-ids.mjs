// scripts/vna/reserved-ids.mjs — the ids already spoken for, read in ONE place (C2159). steer-compile.mjs reserves the heads it
// prints (C1454); steer.mjs declareRows mints past them. Both import from here; steer.mjs cannot import steer-compile.mjs (the
// compiler imports steer.mjs), which is why this lives on its own.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESERVED_DIRS = () => [process.env.VNA_STEER_COMPILE_DIR || resolve(REPO, '.thetacog/steers'), process.env.VNA_STEER_GOALS_DIR || resolve(REPO, 'docs/specs/vna/goals')];
export const RESERVED_RECORD = () => process.env.VNA_STEER_COMPILED || resolve(REPO, 'data/vna/steer-compiled.json');

export function reservedMax({ texts = [], record = null } = {}) {
  let max = 0;
  for (const t of texts) for (const m of String(t || '').matchAll(/^C(\d+) — /gm)) max = Math.max(max, Number(m[1]));
  for (const a of (record && record.asks) || []) { const m = /^C(\d+)$/.exec(String(a.id || '')); if (m) max = Math.max(max, Number(m[1])); }
  return max;
}
export function readReserved({ dirs = RESERVED_DIRS(), recordPath = RESERVED_RECORD() } = {}) {
  const texts = [];
  for (const d of dirs) { try { for (const f of readdirSync(d)) if (f.endsWith('.txt')) texts.push(readFileSync(resolve(d, f), 'utf8')); } catch { /* absent dir: nothing reserved there */ } }
  let record = null; try { record = JSON.parse(readFileSync(recordPath, 'utf8')); } catch { record = null; }
  return reservedMax({ texts, record });
}
