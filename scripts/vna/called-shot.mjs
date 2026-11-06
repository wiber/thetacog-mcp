// scripts/vna/called-shot.mjs — C2347 (with C2373's scoring rule): EACH WORKER MAKES A CALLED SHOT BEFORE IT STARTS — THE
// PROBABILITY ITS GUARD GOES GREEN AND THE FILES IT WILL TOUCH — AND THE RUNNER SCORES IT AFTER, ONTO THE LEDGER ROW.
//
//   guard outcome → Brier score (p − o)², o = 1 when the dispatch reached a verdict-ok row, else 0. C2373: a hit rate cannot
//                   tell a 55 % call from a 95 % call; Brier can. Lower is better; 0.25 is the score of always saying 50 %.
//   files         → Jaccard |P ∩ A| ÷ |P ∪ A|, P the predicted paths, A the paths the dispatch's commits touched
//                   (git diff --name-only head0..head1, read off the immutable commits, never the working tree).
//
// The block is parsed off the worker's own stream (mission-command.mjs workerTexts), the FIRST one it wrote, and only when
// it came before the first Edit/Write — a shot called after the edits is recorded as `late` and never scored, because a
// prediction written after the fact is a description. No block → `no called shot`, never a failed run.
// The C2347 lane half (shortrank assigning every open todo a disjoint lane) is NOT built here — filed on the asks ledger.
// @guard tests/vna/c2347-chair-decomposition-of-the-operator-s.test.mjs
import { workerTexts } from './mission-command.mjs';

export const SHOT_OPEN = '=== CALLED SHOT ===';
export const SHOT_CLOSE = '=== END CALLED SHOT ===';
export const SHOT_BLOCK = [
  'CALLED SHOT (C2347) — before your first Edit or Write, right after the backbrief, call your shot; the runner scores it after the run:',
  SHOT_OPEN,
  'p(guard green): <0 to 1 — how likely the row\'s guard is green on your commit>',
  'files: <comma-separated paths you will touch>',
  SHOT_CLOSE,
].join('\n');

export function parseShot(text) {
  const s = String(text || ''); const i = s.indexOf(SHOT_OPEN); if (i < 0) return null;
  const j = s.indexOf(SHOT_CLOSE, i); const body = s.slice(i + SHOT_OPEN.length, j < 0 ? undefined : j);
  let p = null; let files = null;
  for (const raw of body.split('\n')) {
    const l = raw.trim().replace(/^[-*]\s*/, '');
    const mp = l.match(/^p\s*\(\s*guard green\s*\)\s*:\s*([0-9.]+)\s*(%?)/i);
    if (mp && p == null) { let v = Number(mp[1]); if (mp[2] === '%' || v > 1) v /= 100; if (Number.isFinite(v) && v >= 0 && v <= 1) p = v; }
    const mf = l.match(/^files\s*:\s*(.+)$/i);
    if (mf && files == null) files = mf[1].split(/[,\s]+/).map((x) => x.replace(/^`|`$/g, '').trim()).filter(Boolean);
  }
  return { p, files };
}

/** the prediction off a worker's stdout: { state: 'called' | 'late' | 'no called shot', p, files } */
export function calledShot(stdout) {
  for (const t of workerTexts(stdout)) { const s = parseShot(t.text); if (s) return { state: t.beforeFirstEdit ? 'called' : 'late', p: s.p, files: s.files }; }
  return { state: 'no called shot', p: null, files: null };
}

export const brier = (p, outcome) => (p == null ? null : (p - (outcome ? 1 : 0)) ** 2);
export function jaccard(a, b) {
  if (!a || !b) return null; const A = new Set(a), B = new Set(b); const union = new Set([...A, ...B]);
  if (!union.size) return null; let inter = 0; for (const x of A) if (B.has(x)) inter++; return inter / union.size;
}

/** the scored shot for the ledger row: only a shot called before the edits is scored */
export function scoreShot(shot, { landed, touched = null } = {}) {
  const s = shot || { state: 'no called shot', p: null, files: null };
  const scored = s.state === 'called';
  return { ...s, outcome: landed ? 1 : 0, touched: touched || null, brier: scored ? brier(s.p, landed) : null, jaccard: scored ? jaccard(s.files, touched) : null };
}
