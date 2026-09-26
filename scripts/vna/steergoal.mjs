#!/usr/bin/env node
// scripts/vna/steergoal.mjs — C294 /steergoal: REASON ABOUT THE RIGHT GOAL BEFORE RUNNING IT. NOT A RUNNER.
// (operator 2026-09-25, verbatim: "its not a new runner, it bash opens a txt with the /steer text you run after the /goal spec
// you run in two different txt files" · "I cant help you if the tesseract/goal is misconfigured, so obviously we need to market a
// way to reason about the right goal before we do it, half the hats are meant to be prompt templates - so this should be a
// target.. for optimisation" · "goal is greedy, steer defaults to the spec / tesseract").
//
// A PURE, LLM-FREE HARVESTER + COMPOSER. It reads the record and writes two txt files; it dispatches nothing, sets nothing, and
// runs neither file — the operator runs them (the /steergoal skill is the writer/reasoner that rewrites them first).
//
// HARVEST (each from the door that already owns it — nothing re-derived, nothing re-walked):
//   open spec rows        spec-clarity.mjs classifySpec — CLEAR / NEEDS-OPERATOR / YOUR-ACT, the guard, the missing piece;
//                         each guard's state off asks-ledger.mjs guardState (not written / on disk / in HEAD — never "green":
//                         running a guard is not this composer's job); withdrawn rows read off spec-clarity's own WITHDRAWN
//   the goal in force     goal.mjs goalStatus({ write: false }) — its open units are carried FIRST, never dropped
//   pending asks          the `## PENDING` section of the tree's render (VNA_SPEC_RENDER — spec-tree.mjs's own name)
//   regressed ticks       steer-until.mjs regressedTicks — asked-vs-built's receipt, never a second guard run
//   today's asks ledgers  VNA_ASKS_DIR/<date>-*.txt — row ids they name, and every QUESTIONS / UNCLEAR line
//   the hat + rules       the snowball sidecar (VNA_SNOWBALL_SIDECAR — the UserPromptSubmit hook's producer walked the prompt
//                         that invoked /steergoal; this file never walks) · each unit's reef off the spec tree
//                         (n_spec_<id>.reef, written at fold time by spec-tree.mjs coordinateMass) · rule-grab.mjs grab() on
//                         the intent (content-keyed, LLM-free) for the negative constraints
//
// COMPOSE:
//   <goals>/<date>-<slug>-goal.txt   the /goal — greedy: every harvested ask is a UNIT or under ASKS NOT FOLDED with why;
//                                    ends with the exact `goal.mjs set --text … --unit … --turns a-b --source <this file>` line
//   <goals>/<date>-<slug>-steer.txt  the /steer to run after — spec-anchored order, per unit: row · guard · basin · the hat as
//                                    prompt template · the rules as negative constraints · the commands
//   A same-day rerun with the same slug writes -2, -3, … — never overwrites (AXIOM 1: evict or retain).
//   EVERY command emitted passes commandResolves(): the script exists and every --flag and the subcommand appear as literals
//   in that script's own code. One that does not resolve is REFUSED (dropped and named in the file), never emitted.
//
// UNITS (the greedy rule, stated so one word can veto it): the goal in force's open units first · then CLEAR rows asked today
// (dated today, or named by today's ledgers) · then the remaining CLEAR rows in walk order, nearest first · up to --max-units
// (default 24). A CLEAR row past the cap, a NEEDS-OPERATOR row, a YOUR-ACT row, a withdrawn row, a pending ask, a regressed
// tick and a ledger question are NOT FOLDED — each named, each with why and the door that would fold it.
// C301: the IN-PLAY ones (past the cap · regressed · pending · named by the goal) stay one per line; the NOT-IN-PLAY classes
// (your acts · withdrawn · parked · needs you · ledger questions — HELD_CLASSES) are ONE `HELD — <class> (n): ids — why` line each.
//
//   node scripts/vna/steergoal.mjs "<intent>" [--open|--no-open] [--json] [--max-units N] [--date YYYY-MM-DD]
//
// @guard tests/vna/c294-steergoal-writes-two-txt-files.test.mjs
// @guard tests/vna/c301-steergoal-holds-are-one-line-per-class.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpec, parseRows, orderByWalk, WITHDRAWN, PARKED, CLEAR, NEEDS, ACT } from './spec-clarity.mjs';
import { goalStatus } from './goal.mjs';
import { guardState } from './asks-ledger.mjs';
import { regressedTicks } from './steer-until.mjs';
import { parsePending } from './goal-accounting.mjs';   // C295: one reader of ## PENDING, shared with the /steer close line
import { orderByNeed } from '../../src/lib/brand/buyer-rpm.mjs';   // C310a: the weakest need goes first
export { parsePending, orderByNeed };

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = resolve(HERE, '..', '..');   // where the CLIs live — commandResolves reads them here, whatever VNA_REPO says
export const REPO = process.env.VNA_REPO || CODE_ROOT;
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');
export const GOAL = process.env.VNA_GOAL || resolve(REPO, 'data/vna/goal.json');
export const SPEC_RENDER = process.env.VNA_SPEC_RENDER || resolve(REPO, 'docs/specs/vna/SPEC-FROM-TREE.md');
export const ASKS_DIR = process.env.VNA_ASKS_DIR || resolve(REPO, 'docs/specs/vna/asks');
export const SIDECAR = process.env.VNA_SNOWBALL_SIDECAR || resolve(REPO, '.thetacog/vna-snowball-sidecar.json');
export const TREE = process.env.VNA_SPEC_TREE || resolve(REPO, 'data/vna/spec-tree.json');
export const GOALS_DIR = process.env.VNA_GOALS_DIR || resolve(REPO, 'docs/specs/vna/goals');
export const DEFAULT_MAX_UNITS = 24;

// ── commandResolves: a command is emitted only when the CLI it names would accept it ──────────────────────────────
// CONSTRUCT, stated as an ASSUMPTION: a CLI "accepts" a --flag or a subcommand when that exact string appears as a quoted
// literal ('x' "x" `x`) in the script's CODE — full-line comments are stripped first, so a flag only a comment mentions does not
// count. Every CLI here parses by literal comparison (argv.indexOf('--x'), argv[0] === 'run', ['status','next'].includes…), so
// a literal that is absent is a flag the parser cannot match. Tokens inside "…" are free text (an intent, a title), never
// checked; a bare token right after a --flag is that flag's value; the first bare lowercase word after the script is the
// subcommand; a bare label (C294, P9.1) is a value.
export function tokenize(cmd) {
  const out = []; const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(String(cmd)))) out.push(m[3] != null ? { t: m[3], quoted: false } : { t: m[1] != null ? m[1] : m[2], quoted: true });
  return out;
}
const codeOf = (() => { const cache = new Map(); return (p) => { if (!cache.has(p)) cache.set(p, readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')); return cache.get(p); }; })();
const hasLiteral = (code, s) => [`'${s}'`, `"${s}"`, `\`${s}\``].some((q) => code.includes(q));
export function commandResolves(cmd, { root = CODE_ROOT } = {}) {
  const tk = tokenize(cmd);
  if (!tk.length || tk[0].t !== 'node' || !tk[1]) return { ok: false, why: 'not a `node <script>` command' };
  const script = tk[1].t;
  if (!/^scripts\/[\w./-]+\.mjs$/.test(script)) return { ok: false, why: `${script} is not a scripts/…mjs path` };
  const abs = resolve(root, script);
  if (!existsSync(abs)) return { ok: false, why: `${script} does not exist` };
  const code = codeOf(abs);
  let sub = null;
  for (let i = 2; i < tk.length; i++) {
    const { t, quoted } = tk[i];
    if (quoted) continue;
    if (t.startsWith('--')) { const flag = t.split('=')[0]; if (!hasLiteral(code, flag)) return { ok: false, why: `${script} never parses ${flag}` }; continue; }
    const prev = tk[i - 1];
    if (prev && !prev.quoted && prev.t.startsWith('--')) continue;   // the flag's value
    if (sub == null && i === 2 && /^[a-z][a-z-]*$/.test(t)) { sub = t; if (!hasLiteral(code, t)) return { ok: false, why: `${script} has no subcommand '${t}'` }; }
  }
  return { ok: true, why: null, script, sub };
}

// ── harvest ─────────────────────────────────────────────────────────────────────────────────────────────────────
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
export function parseLedgers(dir, date) {
  let files = []; try { files = readdirSync(dir).filter((f) => f.startsWith(`${date}-`) && f.endsWith('.txt')).sort(); } catch {}
  const ids = new Map(); const questions = [];
  for (const f of files) {
    const txt = readText(resolve(dir, f)) || ''; let sec = '';
    for (const L of txt.split('\n')) {
      const h = /^═+\s*(.+?)\s*═*$/.exec(L.trim()); if (h) { sec = h[1]; continue; }
      for (const m of L.matchAll(/\b(C\d+[a-z]?\d*)\b/g)) { if (!ids.has(m[1])) ids.set(m[1], f); }
      if (/QUESTIONS|UNCLEAR/.test(sec)) { const q = L.trim().replace(/^(Q\d+\.|\d+\.|•|-)\s*/, ''); if (q && q !== '(none)') questions.push({ file: f, text: q.slice(0, 240) }); }
    }
  }
  return { files, ids, questions };
}
export function readSidecar(p = SIDECAR) {
  let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  const hatLine = (j.lines || []).find((l) => /^hat /.test(l)) || null;
  const m = hatLine && /^hat (\S+)(?:\s+\[[^\]]*\])?(?:\s+·\s+(\S+)\s+(.*))?$/.exec(hatLine);
  return { at: j.at || null, leaf: j.leafLabel || null, anchor: j.anchor || null, hat: m ? m[1] : null, coord: m ? m[2] || null : null, name: m ? (m[3] || '').trim() || null : null, line: hatLine };
}
function loadTree(p = TREE) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
async function grabRules(intent) {
  if (process.env.VNA_STEERGOAL_NO_GRAB === '1') return { hits: [], note: 'rule-grab skipped (VNA_STEERGOAL_NO_GRAB=1)' };
  try {
    const { grab } = await import('../cog/rule-grab.mjs');
    const g = grab(intent, { cap: 4, repo: CODE_ROOT });
    return g.lexicallySupported ? { hits: g.hits.map((h) => ({ title: h.title, at: `${h.file}:${h.line}` })), note: g.note } : { hits: [], note: 'no rule shares a content word with the intent — none claimed' };
  } catch (e) { return { hits: [], note: `rule-grab unavailable — ${String(e.message || e).slice(0, 80)}` }; }
}

export async function harvest({ intent, date = new Date().toISOString().slice(0, 10), maxUnits = DEFAULT_MAX_UNITS } = {}) {
  const md = readText(SPEC_MD) || '';
  const c = classifySpec(md);
  const all = parseRows(md);
  const withdrawn = all.filter((r) => !r.ticked && WITHDRAWN.test(r.text)).map((r) => ({ id: r.id, headline: r.text.replace(/^(\s*\([^)]*\)\s*)*/, '').slice(0, 90) }));
  const goal = goalStatus({ path: GOAL, md, write: false });
  const pending = parsePending(readText(SPEC_RENDER));
  const reg = regressedTicks({ file: process.env.VNA_ASKED_VS_BUILT || undefined, md });
  const ledgers = parseLedgers(ASKS_DIR, date);
  const sidecar = readSidecar();
  const tree = loadTree();
  const rules = await grabRules(intent);
  const byId = new Map(c.rows.map((r) => [r.id, r]));
  const clear = c.rows.filter((r) => r.class === CLEAR);
  const ord = orderByWalk(clear, { tree: tree || null });
  const reef = (id) => { const n = tree && tree.nodes && tree.nodes[`n_spec_${id}`]; return n ? { pixel: n.pixel || null, hat: n.reef ? n.reef.hat : null, canonical: n.reef ? n.reef.canonical : null, rules: n.reef && Array.isArray(n.reef.rules) ? n.reef.rules : [], rules_from: n.reef ? n.reef.rules_from : null } : null; };
  // the greedy fold
  const units = []; const why = new Map();
  const add = (id, because) => { if (!units.includes(id)) { units.push(id); why.set(id, because); } };
  const goalOpen = goal ? goal.units.filter((u) => !u.done).flatMap((u) => u.open.concat(u.unknown)) : [];
  for (const id of goalOpen) if (byId.get(id) && byId.get(id).class === CLEAR) add(id, `the goal in force names it (unit ${goal.units.find((u) => u.labels.includes(id)).n})`);
  const today = (r) => new RegExp(`\\b${date}\\b`).test(md.split('\n')[r.line - 1] || '') || ledgers.ids.has(r.id);
  for (const r of ord.rows) if (today(r)) add(r.id, ledgers.ids.has(r.id) ? `asked today — ${ledgers.ids.get(r.id)}` : 'asked today (dated on the row)');
  for (const r of ord.rows) add(r.id, `CLEAR · walk order${r.d != null ? ` d ${r.d}` : ''}`);
  const kept = units.slice(0, maxUnits); const over = units.slice(maxUnits);
  const notFolded = [];
  for (const id of over) notFolded.push({ id, cls: 'cap', why: `CLEAR, past the unit cap (${maxUnits}) — the next /steergoal proposes it; --max-units widens the cap`, headline: byId.get(id).headline });
  for (const r of c.rows.filter((x) => x.class === NEEDS)) notFolded.push({ id: r.id, cls: r.missing.some((m) => /^PARKED/.test(m)) || PARKED.test(r.headline || '') ? 'parked' : 'needs', short: r.missing[0] || '', why: `NEEDS-OPERATOR — ${r.missing.join('; ')}`, headline: r.headline });
  for (const r of c.rows.filter((x) => x.class === ACT)) notFolded.push({ id: r.id, cls: 'act', short: r.missing[0] || '', why: `YOUR-ACT (irrevocable — yours, never dispatched) — ${r.missing.join('; ')}`, headline: r.headline });
  for (const g of goalOpen) if (!byId.has(g) && !withdrawn.some((w) => w.id === g)) notFolded.push({ id: g, cls: 'goal', why: 'named by the goal in force but not an open row in the spec — ticked since, or never declared; goal.mjs status reads it' });
  for (const w of withdrawn) notFolded.push({ id: w.id, cls: 'withdrawn', why: 'withdrawn on its own line and still unticked — tick it or re-scope it; never dispatched', headline: w.headline });
  for (const r of reg.rows) notFolded.push({ id: r.id, cls: 'regressed', why: `regressed — ticked, but its guard was red on asked-vs-built's receipt${r.guard ? ` (${r.guard})` : ''}; goal.mjs reads a ticked label as done, so it cannot be a unit until the guard is fixed or the tick is withdrawn` });
  for (const p of pending) notFolded.push({ id: p.id, cls: 'pending', why: `pending — a released ask, not a row: declare it (${p.basin ? `--as ${p.basin}` : 'name a basin'}) or dismiss it with a reason`, headline: p.headline, basin: p.basin });
  ledgers.questions.forEach((q, i) => notFolded.push({ id: `Q${i + 1}`, cls: 'question', file: q.file, why: `a question in ${q.file} — an answer, not a row; answer it or declare it`, headline: q.text }));
  const rowOf = (id) => { const r = byId.get(id); return { id, headline: r ? r.headline : '', guard: r ? r.guard : null, guardState: r ? guardState(r.guard, { repo: REPO }) : null, section: r ? r.section : null, because: why.get(id), reef: reef(id) }; };
  // C310a: the buyer-RPM's weakest need goes first — a unit on no need keeps its walk order after every need-unit.
  const unitsOrdered = orderByNeed(kept.map(rowOf));
  return { intent, date, counts: c.counts, withdrawn, goal, pending, regressed: reg, ledgers: { files: ledgers.files, questions: ledgers.questions.length }, sidecar, rules, order: ord.reason, units: unitsOrdered, notFolded, maxUnits };
}

// ── compose ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function slugOf(s, maxWords = 6) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join('-') || 'goal'; }
const shq = (s) => String(s).replace(/["`$\\]/g, '').replace(/\s+/g, ' ').trim();
export function pathsFor({ dir = GOALS_DIR, date, slug }) {
  for (let n = 1; ; n++) {
    const stem = `${date}-${slug}${n === 1 ? '' : `-${n}`}`;
    const goal = resolve(dir, `${stem}-goal.txt`), steer = resolve(dir, `${stem}-steer.txt`);
    if (!existsSync(goal) && !existsSync(steer)) return { goal, steer, stem };
  }
}
const rel = (p) => relative(REPO, p).startsWith('..') ? p : relative(REPO, p);
// every command goes through here: resolved, or refused and named — never emitted unresolved
function emitter() {
  const refused = [];
  const cmd = (c) => { const v = commandResolves(c); if (v.ok) return `  ${c}`; refused.push({ c, why: v.why }); return null; };
  return { cmd, refused };
}
// C301 (U21e) — the NOT-IN-PLAY classes. /steergoal never dispatches any of them, so each is ONE line naming every id (the
// operator reads what is held at a glance; the goal reads as the goal). In play — past the cap, regressed, pending, named by the
// goal, and the reasoner's off-the-intent demotions — stays one ask per line, each with its why.
export const HELD_CLASSES = Object.freeze([
  { cls: 'act', label: 'your acts', tail: 'yours (irrevocable: push · send · publish · money · migration); /steergoal never dispatches them' },
  { cls: 'withdrawn', label: 'withdrawn', tail: 'withdrawn on their own line and still unticked; tick or re-scope each, never dispatched' },
  { cls: 'parked', label: 'parked', tail: 'PARKED UNTIL ASKED; the operator unparks each' },
  { cls: 'needs', label: 'needs you', tail: 'NEEDS-OPERATOR; one sentence from you (the missing piece in brackets) makes each CLEAR' },
  { cls: 'question', label: 'ledger questions', tail: "answers, not rows; answer each or declare it" },
]);
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export function heldLines(notFolded) {
  const out = [];
  for (const C of HELD_CLASSES) {
    const xs = notFolded.filter((x) => x.cls === C.cls); if (!xs.length) continue;
    const ids = xs.map((x) => C.cls === 'question' ? `${x.id} "${clip(x.headline, 90)}"` : C.cls === 'needs' ? `${x.id} [${clip(x.short, 48)}]` : x.id).join(C.cls === 'question' || C.cls === 'needs' ? ' · ' : ' ');
    const files = C.cls === 'question' ? ` (${[...new Set(xs.map((x) => x.file))].join(', ')})` : '';
    out.push(`HELD — ${C.label} (${xs.length}): ${ids} — ${C.tail}${files}`);
  }
  return out;
}
export function composeGoal(h, { goalPath }) {
  const E = emitter(); const L = [];
  const n = h.units.length; const turns = `${Math.max(1, n)}-${Math.max(2, n * 2)}`;
  const text = shq(`${h.intent} — greedy: close every unit below (each is a spec row; done = its guard green and the row ticked by a commit), carry every ask under ASKS NOT FOLDED to a row or an answer, drop none`);
  L.push(`/goal — ${h.intent}`, `/steergoal ${h.date} · written ${new Date().toISOString()} · LLM-free harvest; the /steergoal skill rewrites this file before you run it`, '');
  L.push('THE GOAL (greedy — open-ended enough that no ask slips, every unit a guarded row):', `  ${text}`, '');
  L.push(`HARVEST: ${h.counts.open} open rows (clear ${h.counts.clear} · needs-you ${h.counts.needs} · your acts ${h.counts.act}) · ${h.withdrawn.length} withdrawn · goal in force: ${h.goal ? `"${h.goal.text.slice(0, 80)}" ${h.goal.done} done · ${h.goal.left} left` : 'none'} · ${h.pending.length} pending asks · regressed ${h.regressed.state === 'read' ? h.regressed.rows.length : 'not run'} · today's ledgers ${h.ledgers.files.length} (${h.ledgers.questions} questions) · order: ${h.order}`, '');
  L.push(`UNITS (${n}) — one per row; "done" means that row's guard is green and the row is ticked by the commit that built it:`);
  h.units.forEach((u, i) => L.push(`  ${i + 1}. ${u.id}${u.need ? ` [${u.need}]` : ''} — ${u.headline.slice(0, 100)}`, `     done when: ${u.guard || '(no guard)'} green (${u.guardState}) · ${u.because}`));
  L.push('');
  const held = h.notFolded.filter((x) => HELD_CLASSES.some((c) => c.cls === x.cls)); const inPlay = h.notFolded.filter((x) => !held.includes(x));
  L.push(`ASKS NOT FOLDED (${h.notFolded.length}) — in play one per line (${inPlay.length}); not in play held one line per class, every id named (${held.length}); none dropped:`);
  if (!h.notFolded.length) L.push('  (none — every harvested ask is a unit)');
  for (const x of inPlay) L.push(`  · ${x.id} — ${x.why}${x.headline ? ` · "${x.headline.slice(0, 90)}"` : ''}`);
  for (const line of heldLines(held)) L.push(line);
  L.push('', 'RUN THIS (the goal on the record — survives /clear; --source names this file so /steer can say what it ran from):');
  const units = h.units.map((u) => `--unit "${shq(`${u.id}::${u.headline.slice(0, 60)}`)}"`).join(' ');
  const set = E.cmd(`node scripts/vna/goal.mjs set --text "${text}" ${units} --turns ${turns} --source "${rel(goalPath)}"`);
  if (set) L.push(set); else L.push('  (the goal.mjs set line did not resolve — see REFUSED)');
  const st = E.cmd('node scripts/vna/goal.mjs copy'); if (st) L.push(st);
  if (E.refused.length) { L.push('', 'REFUSED (a command that would not resolve against its CLI — never emitted):'); for (const r of E.refused) L.push(`  ✗ ${r.c.slice(0, 160)} — ${r.why}`); }
  L.push('', 'CHANGED BY THE REASONER: (none yet — the /steergoal skill notes its rewrites here)');
  return L.join('\n') + '\n';
}
export function composeSteer(h, { goalPath }) {
  const E = emitter(); const L = [];
  const sc = h.sidecar;
  L.push(`/steer — run AFTER ${rel(goalPath)} (the goal is greedy; the steer defaults to the spec / tesseract)`, `/steergoal ${h.date} · intent: ${h.intent}`, '');
  L.push(`THE HAT AT THE INTENT'S COORDINATE: ${sc && sc.hat ? `${sc.hat}${sc.coord ? ` · ${sc.coord} ${sc.name || ''}` : ''} (snowball sidecar ${sc.at}, anchor ${sc.anchor}, leaf ${sc.leaf})` : 'UNMEASURED — no snowball sidecar on the record; the hook writes it on the prompt turn'}`);
  L.push(`  prompt template: "As ${sc && sc.hat ? sc.hat : '<hat>'}, steer by the spec: take the goal's first open unit, build only that row until its guard is green, tick it, commit, then the next."`);
  L.push('NEGATIVE CONSTRAINTS (rules resolved in the corpus, content-keyed on the intent — do not break them):');
  if (h.rules.hits.length) for (const r of h.rules.hits) L.push(`  ✗ never break: ${r.title} (${r.at})`); else L.push(`  (${h.rules.note})`);
  L.push('  ✗ never drop an ask: an open ask no unit covers is folded into the goal as a new unit (goal.mjs set), or named — never skipped', '');
  L.push(`ORDER — spec-anchored (${h.order}); one unit per cycle, a unit closes only when its row is ticked by a commit with its guard green:`);
  h.units.forEach((u, i) => {
    const R = u.reef;
    L.push(`  ${i + 1}. ${u.id} · guard ${u.guard || '(none)'} (${u.guardState}) · basin ${R && R.pixel ? `${R.pixel}${R.canonical ? ` ${R.canonical}` : ''}` : 'unplaced'}`);
    L.push(`     hat as prompt template: "As ${R && R.hat ? R.hat : (sc && sc.hat) || '<hat>'}${R && R.pixel ? ` at ${R.pixel}` : ''}: build ${u.id} — ${shq(u.headline.slice(0, 80))} — until ${u.guard || 'its guard'} is green; nothing else."`);
    if (R && R.rules.length) for (const r of R.rules.slice(0, 3)) L.push(`     ✗ ${r.name || 'rule'}: ${String(r.text || '').slice(0, 140)}`);
    else L.push(`     ✗ rules at the basin: ${R && R.rules_from ? R.rules_from : 'none indexed (no tree reading)'}`);
  });
  L.push('', 'COMMANDS — in order; each resolves against its CLI\'s own argument parsing:');
  const ids = h.units.map((u) => u.id).join(',');
  const cmds = ['node scripts/vna/goal.mjs copy', ...(ids ? [`node scripts/vna/steer.mjs plan --scope ${ids}`, 'node scripts/vna/steer.mjs run', `node scripts/vna/steer.mjs until --scope ${ids}`] : []), 'node scripts/vna/steer.mjs close'];
  for (const c of cmds) { const l = E.cmd(c); if (l) L.push(l); }
  const regressed = h.notFolded.filter((x) => /^regressed/.test(x.why));
  const pend = h.notFolded.filter((x) => /^pending/.test(x.why));
  if (regressed.length) { L.push('', 'BEFORE THE BACKLOG — a regressed tick is a broken promise and outranks a new row:'); for (const c of ['node scripts/vna/asked-vs-built.mjs --run', `node scripts/vna/bisect-regressed.mjs ${regressed.map((x) => x.id).join(' ')}`]) { const l = E.cmd(c); if (l) L.push(l); } }
  if (pend.length) { L.push('', 'PENDING ASKS — each line is a PROPOSAL at the nearest basin the fold computed: declare it, or swap it for spec-check.mjs dismiss <id> --why "…"; never leave one silent:'); for (const p of pend.slice(0, 40)) { const l = E.cmd(p.basin ? `node scripts/vna/spec-check.mjs declare ${p.id} --as ${p.basin}` : `node scripts/vna/spec-check.mjs dismiss ${p.id} --why "no basin named"`); if (l) L.push(l); } if (pend.length > 40) L.push(`  (+${pend.length - 40} more under ASKS NOT FOLDED in the goal file)`); }
  L.push('', 'EACH CYCLE\'S CLOSE LINE names: the goal units closed · the open asks no unit covers (fold them in: goal.mjs set, never drop) · the /steergoal files it ran from (C295).');
  if (E.refused.length) { L.push('', 'REFUSED (a command that would not resolve against its CLI — never emitted):'); for (const r of E.refused) L.push(`  ✗ ${r.c.slice(0, 160)} — ${r.why}`); }
  L.push('', 'CHANGED BY THE REASONER: (none yet — the /steergoal skill notes its rewrites here)');
  return L.join('\n') + '\n';
}

export async function steergoal({ intent, date, maxUnits = DEFAULT_MAX_UNITS, open = false } = {}) {
  const d = date || new Date().toISOString().slice(0, 10);
  const h = await harvest({ intent, date: d, maxUnits });
  const P = pathsFor({ date: d, slug: slugOf(intent) });
  mkdirSync(dirname(P.goal), { recursive: true });
  writeFileSync(P.goal, composeGoal(h, { goalPath: P.goal }));
  writeFileSync(P.steer, composeSteer(h, { goalPath: P.goal }));
  let opened = false;
  if (open && process.platform === 'darwin' && process.env.VNA_STEERGOAL_NO_OPEN !== '1') { try { execFileSync('open', [P.goal, P.steer]); opened = true; } catch {} }
  return { goal: P.goal, steer: P.steer, opened, units: h.units.map((u) => u.id), notFolded: h.notFolded.map((x) => x.id), harvest: { open: h.counts.open, clear: h.counts.clear, needs: h.counts.needs, acts: h.counts.act, withdrawn: h.withdrawn.length, pending: h.pending.length, regressed: h.regressed.state === 'read' ? h.regressed.rows.length : null, ledgers: h.ledgers.files, questions: h.ledgers.questions, goalInForce: h.goal ? h.goal.text : null, hat: h.sidecar ? h.sidecar.hat : null, rules: h.rules.hits.length } };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const USAGE = 'usage: node scripts/vna/steergoal.mjs "<intent>" [--open|--no-open] [--json] [--max-units N] [--date YYYY-MM-DD]';
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const KNOWN = ['--open', '--no-open', '--json', '--max-units', '--date'];
  const bad = argv.filter((x) => x.startsWith('--') && !KNOWN.includes(x)); if (bad.length) { console.error(`unknown flag ${bad.join(' ')}\n${USAGE}`); process.exit(2); }
  const valued = new Set([arg('--max-units'), arg('--date')].filter(Boolean));
  const intent = argv.find((x) => !x.startsWith('--') && !valued.has(x));
  if (!intent) { console.error(USAGE); process.exit(2); }
  const r = await steergoal({ intent, date: arg('--date'), maxUnits: arg('--max-units') ? Number(arg('--max-units')) : DEFAULT_MAX_UNITS, open: !argv.includes('--no-open') });
  if (argv.includes('--json')) console.log(JSON.stringify(r));
  else console.log(`steergoal · ${r.units.length} units · ${r.notFolded.length} not folded · open ${r.harvest.open} (clear ${r.harvest.clear}) · pending ${r.harvest.pending} · regressed ${r.harvest.regressed ?? 'not run'}\n  goal:  ${r.goal}\n  steer: ${r.steer}${r.opened ? '\n  opened both' : ''}`);
  process.exit(0);
}
