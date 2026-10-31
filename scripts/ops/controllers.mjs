// C831 — THE CONTROLLERS LINE in /mem: each control that keeps a measured slowdown from coming back, read from its own
// ledger or switch, never from memory. A control that is missing reads MISSING, so a regression shows on the next /mem.
//   render budget (C820)   .thetacog/render-budget.ndjson     refused rows in 24 h (a refusal = a loop was caught)
//   temp sweep (C825)      .thetacog/tmp-sweep.ndjson         folders removed in 24 h
//   cache fold (C826c)     .thetacog/cache-fold.ndjson        per-run cache files folded onto tapes in 24 h
//   file census (C826f)    .thetacog/file-census.ndjson       folders past 500 births/24 h, read at most 3 h old
//   runaway watch (C829)   launchd com.thetacog.runaway-watch loaded? + git grep reaps in 24 h (mem-reaps.ndjson)
//   scraper off (C828)     data/scraper-disabled.json         present?
//   no per-turn npx (C830) .claude/settings.json hooks        any npx / npm exec?
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rows = (p) => { try { return readFileSync(p, 'utf8').trim().split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return null; } };
const at = (r) => Date.parse(r.at || r.ts || 0);

export function controllers({ repo = REPO, now = Date.now(), launchctl = () => spawnSync('launchctl', ['list'], { encoding: 'utf8', timeout: 5000 }).stdout || '' } = {}) {
  const day = now - 86400e3, out = {};
  const rb = rows(resolve(repo, '.thetacog/render-budget.ndjson'));
  out.render_budget = rb === null ? { ok: true, refused: 0, note: 'no renders yet' } : { ok: true, refused: rb.filter((r) => r.kind === 'refused' && at(r) >= day).length };
  const ts = rows(resolve(repo, '.thetacog/tmp-sweep.ndjson'));
  out.tmp_sweep = { ok: ts !== null, removed: (ts || []).filter((r) => at(r) >= day).reduce((a, r) => a + (r.removed || 0), 0), last_entries: ts && ts.length ? ts[ts.length - 1].entries : null };
  const cf = rows(resolve(repo, '.thetacog/cache-fold.ndjson'));
  out.cache_fold = { ok: cf !== null, folded: (cf || []).filter((r) => at(r) >= day).reduce((a, r) => a + (r.folded || 0), 0) };
  const fc = rows(resolve(repo, '.thetacog/file-census.ndjson')); const fcl = fc && fc.length ? fc[fc.length - 1] : null;
  out.file_census = { ok: !!fcl && now - at(fcl) < 3 * 3600e3, flagged: fcl ? fcl.flagged || [] : [], born: fcl ? fcl.born : null };
  const reaps = rows(resolve(repo, '.thetacog/mem-reaps.ndjson')) || [];
  out.runaway_watch = { ok: /\bcom\.thetacog\.runaway-watch\b/.test(launchctl()), grep_reaps: reaps.filter((r) => /git grep/.test(r.why || '') && at(r) >= day).length };
  out.scraper_off = { ok: existsSync(resolve(repo, 'data/scraper-disabled.json')) };
  let npx = 0; try { const s = JSON.parse(readFileSync(resolve(repo, '.claude/settings.json'), 'utf8')); for (const gs of Object.values(s.hooks || {})) for (const g of gs) for (const h of g.hooks || []) if (/\b(npx|npm\s+exec|pnpm\s+dlx|bunx)\b/.test(h.command || '')) npx++; } catch {}
  out.no_turn_npx = { ok: npx === 0, npx_hooks: npx };
  return out;
}

export function controllersLine(c) {
  const f = (ok, s) => `${ok ? '✓' : '✗ MISSING'} ${s}`;
  return 'CONTROL ' + [
    f(c.render_budget.ok, `render budget ${c.render_budget.refused} refused/24h`),
    f(c.tmp_sweep.ok, `temp sweep ${c.tmp_sweep.removed} removed/24h`),
    f(c.cache_fold.ok, `cache fold ${c.cache_fold.folded} folded/24h`),
    f(c.file_census.ok, c.file_census.flagged.length ? `file census ⚠ ${c.file_census.flagged.length} folders past 500 births/24h (${c.file_census.flagged.slice(0, 2).map((x) => `${x.dir} ${x.n}`).join(', ')})` : `file census ${c.file_census.born ?? '?'} born/24h, no spawner`),
    f(c.runaway_watch.ok, `runaway watch ${c.runaway_watch.grep_reaps} git grep reaped/24h`),
    f(c.scraper_off.ok, 'scraper off'),
    f(c.no_turn_npx.ok, `per-turn npx ${c.no_turn_npx.npx_hooks}`),
  ].join(' · ');
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) console.log(controllersLine(controllers()));
