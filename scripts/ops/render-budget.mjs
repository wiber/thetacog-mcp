// C820 — THE RENDER BUDGET: one commit is rendered at most MAX times per WINDOW, whatever asks for it.
// 2026-10-13: a leaked env pin made every publish commit re-render its parent, and 0fa5a189d8 was rendered and
// republished 161 times in 2.5 h (each render ~1.6 GB footprint, each publish a 2-byte PNG diff, fseventsd at
// 140 % CPU). The leak is fixed (C819), but the next loop of that class will have a different cause. This counts
// the effect instead of guessing the cause: a sha past its budget is refused in milliseconds, loudly, and the
// refusal is a row on the same ledger. RENDER_BUDGET_FORCE=1 overrides for a deliberate re-render.
import { appendFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const MAX = Number(process.env.RENDER_BUDGET_MAX) || 3;
export const WINDOW_MS = (Number(process.env.RENDER_BUDGET_WINDOW_H) || 6) * 3600 * 1000;
export const ledgerPath = (repo) => process.env.RENDER_BUDGET_LEDGER || resolve(repo, '.thetacog/render-budget.ndjson');

function tail(path, bytes = 512 * 1024) {
  let fd; try { fd = openSync(path, 'r'); } catch { return ''; }
  try { const { size } = fstatSync(fd); const n = Math.min(size, bytes); const b = Buffer.alloc(n); readSync(fd, b, 0, n, size - n); return b.toString('utf8'); }
  finally { closeSync(fd); }
}

/** Admit or refuse one render of `sha`. The full sha is resolved first, so HEAD, a short sha and the full sha count as one. */
export function admitRender({ sha, repo, ledger = ledgerPath(repo), now = Date.now(), max = MAX, windowMs = WINDOW_MS, force = process.env.RENDER_BUDGET_FORCE === '1', caller = '' } = {}) {
  let full = sha;
  try { full = execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* an unresolvable sha is counted as given */ }
  const since = now - windowMs;
  let n = 0;
  for (const l of tail(ledger).split('\n')) {
    if (!l.includes(full)) continue;
    try { const r = JSON.parse(l); if (r.sha === full && r.kind === 'render' && Date.parse(r.at) >= since) n++; } catch { /* a torn first line of the tail */ }
  }
  const admit = force || n < max;
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, JSON.stringify({ at: new Date(now).toISOString(), kind: admit ? 'render' : 'refused', sha: full, n_in_window: n, max, window_h: windowMs / 3600000, force: force || undefined, caller: caller || undefined }) + '\n');
  return { admit, n, full };
}
