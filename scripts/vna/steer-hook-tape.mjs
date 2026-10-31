// scripts/vna/steer-hook-tape.mjs — the hook's ONE read of the walk tape, bounded from the tail.
//
// The tape is append-only and grows ~1 MB/min under a fold storm (396 MB on 2026-09-20). The hook needs one
// row from it — the last `commit-reality` row with a lattice pixel — and used to readFileSync + split the
// whole file for it, on every PostToolUse of every session. Now: read backwards in TAPE_TAIL_CHUNK slices,
// stopping at the first hit; a line torn at a chunk boundary is carried into the next slice, never parsed
// half. `stats` (optional) counts bytes and chunks so the guard can prove the bound.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

export const TAPE_TAIL_CHUNK = 1 << 20;   // 1 MiB — a recent commit is found in one read
const SL = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const onLattice = (p) => { const [r, c] = String(p || '').split(','); return SL.indexOf(r) >= 0 && SL.indexOf(c) >= 0; };

// the backward scan, shared: the first row (from the tail) whose line contains `needle` and passes `pred`; `maxBytes` bounds
// the read so a sha that never landed costs a bounded tail, never the whole 800 MB tape
export function scanTail(tape, { needle, pred, stats = null, maxBytes = Infinity } = {}) {
  let fd = null;
  try {
    fd = openSync(tape, 'r');
    const size = fstatSync(fd).size;
    let end = size, carry = '';
    while (end > 0 && size - end < maxBytes) {
      const start = Math.max(0, end - TAPE_TAIL_CHUNK);
      const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start);
      if (stats) { stats.bytesRead += buf.length; stats.chunks += 1; }
      const lines = (buf.toString('utf8') + carry).split('\n');
      carry = start > 0 ? lines.shift() : '';   // the first piece may be a torn line — it completes in the next slice
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i]; if (!l || l.indexOf(needle) < 0) continue;
        try { const r = JSON.parse(l); if (pred(r)) return r; } catch {}
      }
      end = start;
    }
    return null;
  } catch { return null; } finally { if (fd !== null) { try { closeSync(fd); } catch {} } }
}
export function lastCommitRow(tape, stats = null) {
  return scanTail(tape, { needle: '"commit-reality"', pred: (r) => r.source === 'commit-reality' && onLattice(r.pixel), stats });
}
// C176 layer 2: the placement the one Rust walk gave ONE commit — the newest commit-reality row whose ref names the sha. A row
// that exists but carries no lattice pixel (deferred, refused) comes back as { row, placed: false } so the caller can say why.
export const COMMIT_ROW_MAX_BYTES = 64 << 20;
export function commitRowFor(tape, sha, { stats = null, maxBytes = COMMIT_ROW_MAX_BYTES } = {}) {
  const s = String(sha || ''); if (s.length < 7) return null;
  const names = (r) => r.source === 'commit-reality' && r.ref && (s.startsWith(String(r.ref)) || String(r.ref).startsWith(s));
  const placed = scanTail(tape, { needle: '"commit-reality"', pred: (r) => names(r) && onLattice(r.pixel), stats, maxBytes });
  if (placed) return { row: placed, placed: true };
  const any = scanTail(tape, { needle: '"commit-reality"', pred: names, maxBytes });
  return any ? { row: any, placed: false } : null;
}
