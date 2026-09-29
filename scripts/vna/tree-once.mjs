// scripts/vna/tree-once.mjs — THE SPEC TREE IS PARSED ONCE PER RENDER. data/vna/spec-tree.json is ~54 MB; one steer-ui
// repaint read and JSON.parse'd it FIVE times (steer-ui load() twice, readTree for the cog card, babysit, legend) —
// measured 2026-09-23 with a readFileSync wrapper: 5 reads, peak RSS 917 MB, repainted in two IDE hosts at once while a
// session re-rendered every ~15 s (operator: "the left panel keeps refreshing"). One memo, keyed on path + mtime + size,
// so a fold that rewrites the file is re-read and a second reader in the same process is served the parse it already paid.
// The returned object is SHARED — callers read it, never mutate it (every current caller only reads .nodes/.reef/.walk/…).
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const memo = new Map();   // abs path → { key, value }
export function readTreeJson(path) {
  const p = resolve(path);
  const s = statSync(p);   // throws on a missing file, exactly as readFileSync did — callers keep their own try/catch
  const key = `${s.mtimeMs}:${s.size}`;
  const hit = memo.get(p);
  if (hit && hit.key === key) return hit.value;
  const value = JSON.parse(readFileSync(p, 'utf8'));
  memo.set(p, { key, value });
  return value;
}
export function clearTreeMemo() { memo.clear(); }
