#!/usr/bin/env node
// scripts/ops/today-tops.mjs — TODAY'S BUILD: THE TOP OF EVERY LIST, FORMULATED TOWARD THE HORIZONS.
// Operator 2026-10-22, verbatim: "a lot of progress comes from just getting the top of each relevant list into context and
// formulating the parts" · "we should really have a sheet for this in addition to the txt file- and integrate it into the flow
// chart - with references and rules to build the spec from all the pieces" · "write the /steer to 1) plan it out with horizon as
// the target - and 2) research what quantum leaps we can do.. bash open the txt".
//
// One read, two surfaces. Each list gives its top few items; each item becomes one PART: what it is, the file it came from (REF),
// the horizon it serves, who acts (agents tonight, or you), the rule that binds that kind of act, and the next command or act.
// Agent work is priced in hours, so only your acts carry a calendar. The flow is drawn in docs/specs/vna/plan-flow.txt.
//   node scripts/ops/today-tops.mjs --print     the parts to stdout
//   node scripts/ops/today-tops.mjs             write docs/specs/vna/goals/<date>-today-build-steer.txt and open it
//   node scripts/ops/board-requirements.mjs --spec today    write the Today sheet (the same parts, cell by cell)
// LLM-free: same record, same day → same parts. Port row: C1214 (it ranks, so it moves to the crate once the shape holds).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOP = 3;
const read = (p) => readFileSync(resolve(REPO, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const clip = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// The rule that binds each kind of act — quoted by name, never re-stated (CLAUDE.md is the one home).
export const RULES = {
  horizon: 'R1 · an aim moves only on your word (Horizons H-00)',
  code: 'CODE DEFINITION-OF-DONE · the guard ships in the same commit',
  outbound: 'THE AUTONOMY LEVEL · outbound stays a draft; arming is your act',
  release: 'PUSH ≠ DEPLOY · ship only on your word in this session',
  talk: '/take · graded LLM-free against src/app/ri/slides.tsx',
  measure: 'MEASURE, DON\'T ASSERT · a count off the record or UNMEASURED',
};
export const HEAD = ['ID', 'LIST', 'THE TOP ITEM', 'SERVES', 'WHO', 'NEXT — COMMAND OR ACT', 'RULE', 'REF', 'YOUR COMMENT (fill)'];

const horizonOf = (text) => (String(text).match(/→ (H-\d\d)\b/) || [])[1] || '—';

// C1243: the same clarity scale the Horizons rows already carry (board-requirements.mjs's compose() sorts its
// sheets by this field, clearest first) is the one ranking rule every list here floats its lines by. A Horizons
// row always leads (tier +1000: no other part, however clear the horizon it serves, outranks the Horizons row
// naming that horizon), and inside each tier the clearest line — the horizon with the higher clarity — floats up.
export function horizonClarityMap() { return Object.fromEntries(json('docs/specs/vna/horizons.json').rows.map((r) => [r.id, r.clarity])); }
export function clarityOf(part, horizonClarity = {}) {
  const base = horizonClarity[part.serves] ?? -1;
  return part.list === 'Horizons' ? 1000 + base : base;
}

function horizonParts() {
  const rows = json('docs/specs/vna/horizons.json').rows.filter((r) => /^H-0[1-3]$/.test(r.id));
  return rows.map((r) => ({ list: 'Horizons', item: `${r.hz} · ${clip(r.step, 220)}`, serves: r.id, who: 'you + agents', next: `KNOW: ${clip(r.knowCheck || r.know, 140)}`, rule: RULES.horizon, ref: `docs/specs/vna/horizons.json#${r.id}` }));
}

function specParts(ctx) {
  const spec = read('docs/specs/vna/SPEC-VNA-COCKPIT.md'); const out = [];
  for (const m of spec.matchAll(/^- \[ \] (C\d+[a-z]?)\b(.*)$/gm)) out.push({ id: m[1], text: m[2] });
  // Horizons are the target: only rows tagged to H-01→H-03 compete; within them, the one priority (board-priority.mjs).
  const near = out.filter((r) => /^H-0[1-3]$/.test(horizonOf(r.text)));
  let ranked = near.map((r) => ({ ...r, p: 0 }));
  if (ctx) ranked = near.map((r) => ({ ...r, p: ctx.specPriority({ ID: r.id }, ctx.c).p }));
  ranked.sort((a, b) => b.p - a.p || (b.id.localeCompare(a.id, undefined, { numeric: true })));
  return ranked.slice(0, TOP).map((r) => ({ list: 'Open rows serving H-01→H-03', item: `${r.id} · ${clip(r.text.replace(/\(guard: `[^`]*`\)\s*/, ''), 200)}`, serves: horizonOf(r.text), who: 'agents tonight', next: `node scripts/vna/steer.mjs until --scope ${r.id} --ceiling 30`, rule: RULES.code, ref: `docs/specs/vna/SPEC-VNA-COCKPIT.md#${r.id}`, id: r.id }));
}

function goalParts() {
  let out = '';
  try { out = execFileSync('node', ['scripts/vna/goal.mjs', 'status'], { cwd: REPO, encoding: 'utf8', timeout: 20000 }); } catch (e) { out = String(e.stdout || ''); }
  const open = [...out.matchAll(/\[ \] \d+\. (C\d+[a-z]?)/g)].map((m) => m[1]);
  if (!open.length) return [{ list: 'The goal in force', item: 'UNMEASURED — goal.mjs status named no open unit', serves: '—', who: '—', next: 'node scripts/vna/goal.mjs status', rule: RULES.measure, ref: 'scripts/vna/goal.mjs' }];
  return open.slice(0, TOP).map((id) => ({ list: 'The goal in force', item: `${id} · open unit (${open.length} left)`, serves: '—', who: 'agents tonight', next: `node scripts/vna/steer.mjs until --scope ${id} --ceiling 30`, rule: RULES.code, ref: `docs/specs/vna/SPEC-VNA-COCKPIT.md#${id}`, id }));
}

function draftParts() {
  const found = [];
  for (const ch of readdirSync(resolve(REPO, 'docs/comms'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = `docs/comms/${ch.name}/drafts`; if (!existsSync(resolve(REPO, dir))) continue;
    for (const f of readdirSync(resolve(REPO, dir)).filter((x) => x.endsWith('.grade.json'))) {
      try { const g = json(`${dir}/${f}`); const md = `${dir}/${f.replace(/\.grade\.json$/, '.md')}`;
        if (Number(g.lowest) >= 95 && existsSync(resolve(REPO, md))) found.push({ md, at: g.graded_at || '' }); } catch { /* an unreadable grade is not a ready draft */ }
    }
  }
  found.sort((a, b) => b.at.localeCompare(a.at));
  return found.slice(0, TOP).map((d) => ({ list: 'Drafts graded ≥95, not armed', item: d.md.split('/').pop(), serves: '—', who: 'you', next: 'say send (move to approved/ + commit arms it)', rule: RULES.outbound, ref: d.md }));
}

function talkPart() {
  const p = '.thetacog/talk-energy.ndjson';
  if (!existsSync(resolve(REPO, p))) return [{ list: 'The RI talk', item: 'UNMEASURED — no graded take on the record', serves: 'H-03', who: 'you', next: '/take <recording>', rule: RULES.talk, ref: 'src/app/ri/slides.tsx' }];
  const last = read(p).trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).pop();
  const days = Math.floor((Date.now() - Date.parse(last.at)) / 864e5);
  return [{ list: 'The RI talk', item: `last graded take ${last.at.slice(0, 10)} (${days} d ago): fidelity ${last.fidelity} · ${Math.round(last.duration)} s · ${last.wpm} wpm`, serves: 'H-03', who: 'you', next: 'record one take, then /take it', rule: RULES.talk, ref: p }];
}

function fundingPart() {
  try { const f = json('data/vna/licence-funnel.json'); const b = f.bought || {};
    return [{ list: 'The ledger', item: b.status === 'MEASURED' ? `bought ${b.purchases} (first ${String(b.first).slice(0, 10)}) · installs ${f.installs?.n ?? 'UNMEASURED'}` : 'bought UNMEASURED', serves: 'H-02', who: 'agents tonight', next: 'write the customer case in one line off this count', rule: RULES.measure, ref: 'data/vna/licence-funnel.json' }];
  } catch { return []; }
}

export async function parts() {
  let ctx = null;
  try { const m = await import('./board-priority.mjs'); ctx = { specPriority: m.specPriority, c: m.loadContext() }; } catch { /* unranked: newest first */ }
  const all = [...horizonParts(), ...talkPart(), ...fundingPart(), ...draftParts(), ...goalParts(), ...specParts(ctx)];
  const horizonClarity = horizonClarityMap();
  all.sort((a, b) => clarityOf(b, horizonClarity) - clarityOf(a, horizonClarity));   // C1243: clearest line floats to the top
  return all.map((x, i) => ({ ...x, n: `T-${String(i + 1).padStart(2, '0')}` }));
}

// A part is usable only if it names where it came from, who acts, and the rule that binds it (seen red in tests/ops/today-tops.test.mjs).
export function partBreaks(x) {
  const out = [];
  if (!x.ref) out.push('no REF'); else if (!existsSync(resolve(REPO, x.ref.split('#')[0]))) out.push(`REF does not resolve: ${x.ref}`);
  if (!x.who || x.who === '—') { if (!/^UNMEASURED/.test(x.item)) out.push('no WHO'); }
  if (!Object.values(RULES).includes(x.rule)) out.push('RULE is not one of RULES');
  return out;
}

export async function compose() {
  const ps = await parts();
  return [HEAD, ...ps.map((x) => [x.n, x.list, x.item, x.serves, x.who, x.next, x.rule, x.ref, ''])];
}

export function steerText(ps, date = new Date().toISOString().slice(0, 10)) {
  const flow = read('docs/specs/vna/plan-flow.txt').split('\n').filter((l) => /^ {2}[│┌└├▼ ]/.test(l) || /^ {2}\S/.test(l)).slice(0, 40).join('\n');
  const ids = [...new Set(ps.filter((x) => x.id && x.who === 'agents tonight').map((x) => x.id))];
  const research = ['H-01', 'H-02', 'H-03'].map((h) => `  claude -p --max-turns 12 "Read docs/specs/vna/horizons.json row ${h} and docs/specs/vna/goals/${date}-today-build-steer.txt. Name the ONE build that collapses ${h}'s calendar by 10x if agents do the work tonight: what it is, which open spec row or new row it is, the file it lands in, the guard that proves it, and what stays the operator's act. Every fact cites a repo path or reads UNMEASURED. Write it to docs/specs/vna/research/${date}-quantum-leaps/${h}.md" &`).join('\n');
  const best = ps[0];
  return `/steer TODAY'S BUILD ${date} — the top of every list, formulated toward the Horizons. Preamble, not a row.

TODAY OPENS ON THE SINGLE BEST ONE (C1243, the clarity score the Horizons rows already carry): ${best.n} [${best.list}] ${best.item}
       serves ${best.serves} · ${best.who} · next: ${best.next}

THE EFFECT: put the top of every relevant list in one context, write each as a part (what · where it came from · the horizon it
serves · who acts · the rule that binds it · the next command), then plan against H-01→H-03. Agent work is priced in hours; only
your acts carry a calendar. The Today sheet carries the same parts: node scripts/ops/board-requirements.mjs --spec today

THE FLOW (docs/specs/vna/plan-flow.txt):
${flow}

THE PARTS (${ps.length}):
${ps.map((x) => `  ${x.n} [${x.list}] ${x.item}\n       serves ${x.serves} · ${x.who} · next: ${x.next}\n       rule: ${x.rule} · ref: ${x.ref}`).join('\n')}

STEP 1 — PLAN IT, HORIZONS AS THE TARGET. Read the parts above against H-01→H-03. Every agent part runs tonight; every "you" part
goes on the Today sheet as one act with its date. Run the agent rows:
  node scripts/vna/steer.mjs until --scope ${ids.join(',') || 'C1088'} --ceiling 30

STEP 2 — RESEARCH THE QUANTUM LEAPS, IN PARALLEL (one turn-capped worker per near horizon, never a sequential loop):
${research}
  wait
Then read the three files, and declare each leap that holds as a spec row (node scripts/vna/spec-check.mjs declare …) before
building it. A leap that needs the operator's act names that act; it never becomes a row an agent ships.

NOT SUFFICIENT FOR: whether these are the right horizons — that is your call. It shows the top of each list, where each came
from, and that every part names who acts and the rule that binds it.
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ps = await parts();
  const bad = ps.map((x) => [x.n, partBreaks(x)]).filter(([, b]) => b.length);
  if (process.argv.includes('--print')) { for (const x of ps) console.log(`${x.n} │ ${x.list} │ ${clip(x.item, 90)} │ ${x.serves} │ ${x.who} │ ${x.ref}`); }
  else {
    const date = new Date().toISOString().slice(0, 10); const out = `docs/specs/vna/goals/${date}-today-build-steer.txt`;
    writeFileSync(resolve(REPO, out), steerText(ps, date)); console.log(`✓ ${out} · ${ps.length} parts`);
    if (!process.argv.includes('--no-open')) { try { execFileSync('open', [resolve(REPO, out)]); } catch { console.log(`  NOT opened — open ${out}`); } }
  }
  if (bad.length) { console.log(`✗ ${bad.length} part(s) break: ${bad.map(([n, b]) => `${n} ${b.join('; ')}`).join(' · ')}`); process.exit(1); }
}
