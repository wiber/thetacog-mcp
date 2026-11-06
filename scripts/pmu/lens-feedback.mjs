#!/usr/bin/env node
// scripts/pmu/lens-feedback.mjs — THE PERFORMANCE LOOP (operator 2026-06-30): record back into SQLite
// which rules/templates the sidecar injected and whether they HELD, so the reef self-optimizes.
// =============================================================================
// The discipline the operator mandated: "it's never a question, never adds cognitive load, but we add a
// COMMENT to the outcome — 'we could've gone this way, but the sidecar made us remember 1,2,3,4 and the
// template held this way' — so we can relatively improve this process."
//
//   recordApplication()  — AUTO, on every lens run: one row per injected rule + the template (held=NULL).
//   --annotate "<note>" --held "<a;b;c>"  — mark which injected items HELD for the latest application
//                                           (held=1 for the listed, 0 for the rest) + store the note.
//   --comment            — print the counterfactual comment for the latest application (the outcome note).
//   --report             — per-item HELD-RATE (the optimization signal: promote high, demote low).
//   --inspect-templates  — the domain templates, ranked by their held-rate (templates are searchable too).
// Table lens_performance(id, run_id, ts, prompt, domain, pixel, kind, item, injected, held, note).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.LENS_DB || resolve(REPO, '.thetacog/transcripts.db');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const q = (s) => String(s).replace(/'/g, "''");
const sql = (s) => { try { const o = execFileSync('sqlite3', ['-json', DB, s], { encoding: 'utf8' }).trim(); return o ? JSON.parse(o) : []; } catch { return []; } };
const exec = (s) => { try { execFileSync('sqlite3', [DB], { input: s, encoding: 'utf8' }); return true; } catch { return false; } };
const DDL = `CREATE TABLE IF NOT EXISTS lens_performance (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, ts TEXT, prompt TEXT, domain TEXT, pixel TEXT, kind TEXT, item TEXT, injected INT, held INT, note TEXT);`;

// AUTO — called by prompt-lens after each lens run: record the injected rules + template (held unknown).
export function recordApplication({ prompt = '', domain = '', pixel = '', rules = [], template = '', ts = '' }) {
  exec(DDL);
  const run_id = `lr-${(ts || '').replace(/[^0-9a-zA-Z]/g, '') || Math.abs((prompt + pixel).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}-${pixel}`;
  const rows = [];
  for (const r of rules) rows.push(`('${run_id}','${q(ts)}','${q(String(prompt).slice(0, 160))}','${q(domain)}','${q(pixel)}','rule','${q(String(r).slice(0, 200))}',1,NULL,NULL)`);
  if (template) rows.push(`('${run_id}','${q(ts)}','${q(String(prompt).slice(0, 160))}','${q(domain)}','${q(pixel)}','template','${q(String(template).slice(0, 300))}',1,NULL,NULL)`);
  if (rows.length) exec(`INSERT INTO lens_performance (run_id,ts,prompt,domain,pixel,kind,item,injected,held,note) VALUES ${rows.join(',')};`);
  return run_id;
}

function latestRun() { const r = sql(`SELECT run_id FROM lens_performance ORDER BY id DESC LIMIT 1;`); return r[0]?.run_id || null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  exec(DDL);
  if (process.argv.includes('--annotate')) {
    const note = arg('--annotate', '');
    const held = (arg('--held', '') || '').split(';').map((s) => s.trim()).filter(Boolean);
    const run = arg('--run', latestRun());
    if (!run) { console.log('no application to annotate yet'); process.exit(0); }
    // held=1 for items whose text contains any held-key; held=0 for the rest of that run.
    const rows = sql(`SELECT id, item FROM lens_performance WHERE run_id='${q(run)}';`);
    for (const r of rows) { const hit = held.some((h) => r.item.toLowerCase().includes(h.toLowerCase())); exec(`UPDATE lens_performance SET held=${hit ? 1 : 0}, note='${q(note)}' WHERE id=${r.id};`); }
    console.log(`annotated run ${run}: ${rows.length} items (${held.length} marked held). note recorded.`);
    process.exit(0);
  }
  if (process.argv.includes('--comment')) {
    const run = arg('--run', latestRun());
    const rows = run ? sql(`SELECT kind, item, domain, pixel FROM lens_performance WHERE run_id='${q(run)}' ORDER BY id;`) : [];
    if (!rows.length) { console.log('(no lens application recorded yet)'); process.exit(0); }
    const rules = rows.filter((r) => r.kind === 'rule').slice(0, 4).map((r) => r.item.replace(/`/g, '').slice(0, 60));
    const dom = rows[0].domain, px = rows[0].pixel;
    // the never-a-question outcome comment: how the sidecar changed the path.
    console.log(`⟦ sidecar note ⟧ this landed in the ${dom} lane (pixel ${px}); the lens made us remember: ${rules.map((r, i) => `(${i + 1}) ${r}`).join('  ')}${rows.some((r) => r.kind === 'template') ? ' — and the domain template held the shape.' : ''}`);
    process.exit(0);
  }
  if (process.argv.includes('--inspect-templates')) {
    let reef = []; try { reef = JSON.parse(readFileSync(resolve(REPO, 'data/pmu/lens-reef.json'), 'utf8')).domains || []; } catch {}
    const perf = sql(`SELECT domain, count(*) used, sum(CASE WHEN held=1 THEN 1 ELSE 0 END) held FROM lens_performance WHERE kind='template' GROUP BY domain;`);
    const pm = Object.fromEntries(perf.map((p) => [p.domain, p]));
    console.log('\n  TEMPLATES (ranked; PMU-searchable per domain) — used · held-rate · template');
    for (const d of reef) { const p = pm[d.domain] || { used: 0, held: 0 }; const rate = p.used ? `${Math.round(100 * p.held / p.used)}%` : '—'; console.log(`   ${d.domain.padEnd(16)} ${String(p.used).padStart(3)}× · ${rate.padStart(4)} · ${String(d.template).slice(0, 80)}`); }
    console.log('');
    process.exit(0);
  }
  if (process.argv.includes('--grade-commit')) {
    // MEASURE THE REALITY (close the loop): a commit is a cloud OUTPUT. Route the intent (msg+files) and
    // the reality (the diff) through the SAME PMU router; in-lane iff they land in the same domain pixel.
    // In-lane → held=1 for that domain's rules (reinforce). Drift → held=0 + the outcome comment.
    const sha = arg('--grade-commit', 'HEAD');
    const git = (a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }); } catch { return ''; } };
    const msg = git(['log', '-1', '--format=%s%n%b', sha]).trim();
    const files = git(['show', '--no-color', '--pretty=format:', '--name-only', sha]).split('\n').filter(Boolean).join(' ');
    const diff = git(['show', '--no-color', '--format=', sha]).slice(0, 8000);
    let routeToDomain; try { ({ routeToDomain } = await import('./prompt-lens.mjs')); } catch { console.log('prompt-lens unavailable'); process.exit(0); }
    const intent = routeToDomain(msg + ' ' + files);
    const reality = routeToDomain(diff || msg);
    const intendedD = intent?.domain || '(none)', landedD = reality?.domain || '(none)';
    const inLane = intent && reality && intendedD === landedD;
    exec(DDL);
    const run_id = `grade-${sha.slice(0, 9)}`;
    exec(`INSERT INTO lens_performance (run_id,ts,prompt,domain,pixel,kind,item,injected,held,note) VALUES ('${run_id}','${sha.slice(0,9)}','${q(msg.slice(0,120))}','${q(intendedD)}','${q(intent?.coord||'')}','grade','intent→reality',1,${inLane?1:0},'${q(inLane?'in-lane':'drift into '+landedD)}');`);
    // reinforce/penalize the intended domain's rules
    if (intent) for (const r of (intent.rules || [])) exec(`UPDATE lens_performance SET held=${inLane?1:0} WHERE kind='rule' AND domain='${q(intendedD)}' AND held IS NULL;`);
    console.log(inLane
      ? `✅ ${sha.slice(0,9)} IN-LANE — intent + reality both land in '${intendedD}'. Reinforced its rules (held=1).`
      : `⚠️  ${sha.slice(0,9)} DRIFT — intent '${intendedD}' but the code landed in '${landedD}'. ⟦ sidecar note ⟧ we drifted into ${landedD}; the ${intendedD} rules failed to hold the shape.`);
    process.exit(0);
  }
  if (process.argv.includes('--curate')) {
    // AUTO-OPTIMIZE: demote items whose held-rate falls below the threshold (proven not to hold) so the
    // next loop only uses what works. Demote = record a 'demoted' marker (the retriever can skip these).
    const thr = Number(arg('--threshold', '0.34'));
    const items = sql(`SELECT item, kind, count(*) used, sum(CASE WHEN held=1 THEN 1 ELSE 0 END) held, sum(CASE WHEN held IS NOT NULL THEN 1 ELSE 0 END) judged FROM lens_performance WHERE kind='rule' GROUP BY item HAVING judged >= 2;`);
    let demoted = 0;
    for (const r of items) { const rate = r.judged ? r.held / r.judged : 1; if (rate < thr) { exec(`INSERT INTO lens_performance (run_id,ts,kind,item,injected,held,note) VALUES ('curate','${new Date().toISOString().slice(0,10)}','demoted','${q(r.item)}',0,0,'held-rate ${(rate*100)|0}% < ${(thr*100)|0}% threshold');`); demoted++; } }
    console.log(`curate: reviewed ${items.length} judged rules · demoted ${demoted} below ${Math.round(thr*100)}% held-rate (the perimeter that doesn't hold).`);
    process.exit(0);
  }
  // default: --report (per-item held-rate, the optimization signal)
  const items = sql(`SELECT kind, item, count(*) used, sum(CASE WHEN held=1 THEN 1 ELSE 0 END) held, sum(CASE WHEN held IS NOT NULL THEN 1 ELSE 0 END) judged FROM lens_performance GROUP BY kind, item ORDER BY used DESC LIMIT 25;`);
  if (!items.length) { console.log('\n  no lens applications recorded yet — run prompt-lens, then annotate outcomes.\n'); process.exit(0); }
  console.log('\n  LENS PERFORMANCE — per-item held-rate (promote high, demote/curate low) ⟨used · judged · held%⟩');
  for (const r of items) { const rate = r.judged ? `${Math.round(100 * r.held / r.judged)}%` : 'unjudged'; console.log(`   [${r.kind}] ${rate.padStart(8)}  (${r.used}×, ${r.judged} judged)  ${r.item.replace(/`/g, '').slice(0, 64)}`); }
  console.log('');
}
