#!/usr/bin/env node
// scripts/vna/steer-compile.mjs — C1221: THE STEER COMPILER. A raw dictation goes in; ONE txt comes out, the steer, expanded
// before any worker reads it, and bash-opened by default so the operator rewrites it on the spot.
// (operator 2026-10-22, verbatim: "whenever you write a steer, we should be combining this to do a retrosnowball ncd associative etc
// to maximise efficasy with the rules and hats of the /steer and bash open it as a txt file (by default) - if we do it correctly it
// should be eaasy to rewrite there on the spot" · "we should stop writing the /goal but perfect writing the steer / the /steer can
// have the simple goal (go untill all /steer asks are done or similaR)").
//
// LLM-FREE AND A PURE COMPOSER: every slot is filled by the door that already owns it, imported, never copied —
//   asks        steer.mjs splitAsks (the same split the dictation door uses, so the txt's rows are the rows /steer declares)
//   retro       retro-snowball.mjs retroGrow over the spec tree's walked contract rows, walked by snowball-refresh.mjs probeWalker
//               (a scratch tape, never the live walk tape). No walker → the gzip-nearest rows by spec-tree.mjs ncd, labelled so.
//   near        the gzip-nearest spec rows to the ask (spec-tree.mjs ncd over spec-clarity.mjs parseRows), open and ticked —
//               the associative read beside the retro one: what was already asked that this ask sits next to
//   hat         the snowball sidecar the UserPromptSubmit hook wrote for this prompt (steergoal.mjs readSidecar)
//   rules       rule-grab.mjs grab() — the rules as NEGATIVE constraints, with its own "unsupported guesses" note carried
//   vocabulary  behavior-promise.mjs findBannedPromises — a banned promise in the ask is NAMED, never silently rewritten
//   act         spec-clarity.mjs IRREVOCABLE_HEADLINE / OUTBOUND_HEADLINE — the operator's act is split from the worker's
//   basin       spec-clarity.mjs namedPaths on the ask, then citedPaths of the grown rows, kept only when onDisk
//   patterns    prompt-diagnose.mjs diagnose() — Prompt Master's patterns that read true on a raw ask (PM06 the whole thing, PM07 a
//               pointer). A pointer ask also carries its likely referent: the newest open dictated row (steer.mjs activeRow, the row a
//               short follow-up resolves to), labelled a candidate, never put in his mouth
//   guard       a proposed tests/vna/c<id>-<slug>.test.mjs off steer.mjs nextTopLevelId + slugify — the red witness comes first
// The head is a DRAFT (C1027 heads are written by plain-heads.mjs, a model call); the txt says so and the operator rewrites it.
//
// THE RATCHET: each ask has five slots that can come back empty — basin · retro · near · hat · rules. Every compile appends its fill to
// .thetacog/steer-compile.ndjson; `--check` reads the median fill of the last 20 against data/vna/steer-compile-floor.json, and
// `--raise` lifts the floor to that median. The floor only rises. A fall prints the slot that went empty, never a block.
//
//   node scripts/vna/steer-compile.mjs "<dictation>" [--no-open] [--json] [--no-walk]
//   node scripts/vna/steer-compile.mjs --check | --raise
// @guard tests/vna/c1221-the-steer-compiler.test.mjs
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitAsks, slugify, nextTopLevelId, activeRow } from './steer.mjs';
import { diagnose } from './prompt-diagnose.mjs';   // C1228: Prompt Master's patterns that read true on a raw ask
import { SPEC_MD, guardOf, namedPaths, citedPaths, onDisk, IRREVOCABLE_HEADLINE, OUTBOUND_HEADLINE } from './spec-clarity.mjs';
import { readSidecar } from './steergoal.mjs';
import { findBannedPromises } from '../voice/behavior-promise.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const OUT_DIR = process.env.VNA_STEER_COMPILE_DIR || resolve(REPO, '.thetacog/steers');
export const LEDGER = process.env.VNA_STEER_COMPILE_LEDGER || resolve(REPO, '.thetacog/steer-compile.ndjson');
export const FLOOR = process.env.VNA_STEER_COMPILE_FLOOR || resolve(REPO, 'data/vna/steer-compile-floor.json');
// C1221b — the record the board sheet reads (scripts/ops/board-steer.mjs): every compiled ask, newest compile wins per proposed id
export const RECORD = process.env.VNA_STEER_COMPILED || resolve(REPO, 'data/vna/steer-compiled.json');
export const RECORD_CAP = 80;
export const SLOTS = ['basin', 'retro', 'near', 'hat', 'rules'];
export const RATCHET_WINDOW = 20;
// THE ONE GOAL, one sentence, carried as the steer's last line (operator 2026-10-22: "the /steer can have the simple goal")
export const SIMPLE_GOAL = 'go until every ask in this steer is ticked by the commit that built it, or named STUCK / YOUR ACT with its reason';

// C1454 — A COMPILED ID IS RESERVED, NEVER HANDED OUT TWICE. nextTopLevelId reads only the spec, and a compiled steer's rows live
// in its txt and in RECORD until a room declares them, so two compiles before a declare minted the same ids: the 2026-10-29 tend
// rows C1433–C1437 (desks, F4 silicon, the ISN forecast) were shadowed by spec rows of the same numbers and never built, and on
// 2026-10-30 a second compile re-minted C1444–C1447. The first id is now past the highest id in the spec, in RECORD, and in every
// compiled steer file (OUT_DIR, local) and goals file (docs/specs/vna/goals, tracked). Guard: tests/vna/c1454-compiled-ids-are-reserved.test.mjs.
export const GOALS_DIR = process.env.VNA_STEER_GOALS_DIR || resolve(REPO, 'docs/specs/vna/goals');
import { reservedMax, readReserved as readReservedAt } from "./reserved-ids.mjs";   // C2159: one reader, shared with steer.mjs
export { reservedMax };
export function readReserved({ dirs = [OUT_DIR, GOALS_DIR], recordPath = RECORD } = {}) { return readReservedAt({ dirs, recordPath }); }

const shq = (s) => String(s).replace(/"/g, "'");

// C1332: a short plain head a reader can say aloud — sentence case (never ALL CAPS), cut at a word
// boundary, the id prefix counted inside the 80-character cap so the whole head line stays legible.
function cutAtWord(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = cut.lastIndexOf(' ');
  return i > 10 ? cut.slice(0, i) : cut;
}
export function headOf(id, ask, n = 80) {
  const prefix = `C${id} — `;
  const body = cutAtWord(String(ask).replace(/\s+/g, ' ').trim(), Math.max(10, n - prefix.length));
  return `${prefix}${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

// the verbatim span, wrapped at a word boundary so no line runs past `width`, quote marks only on
// the first and last wrapped line — the span reads as one sentence split across indented lines.
export function wrapQuoted(text, width, indent) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (!lines.length) return [`${indent}""`];
  return lines.map((l, i) => `${indent}${i === 0 ? '"' : ''}${l}${i === lines.length - 1 ? '"' : ''}`);
}

// name · percent · n/d · one plain-words meaning, column-aligned — the six percentages as a table
// a reader scans down, never a run-on line (steer-compile.mjs's old line 143 named in feedback_maximise-legibility-steer-files.md).
export function pctTable(grade) {
  const rows = PCTS.map((p) => { const g = grade[p.key]; return { name: p.name, pct: g.pct == null ? 'UNMEASURED' : `${g.pct}%`, nd: `${g.n}/${g.d}`, meaning: p.meaning }; });
  const w1 = Math.max(...rows.map((r) => r.name.length));
  const w2 = Math.max(...rows.map((r) => r.pct.length));
  const w3 = Math.max(...rows.map((r) => r.nd.length));
  return rows.map((r) => `  ${r.name.padEnd(w1)} · ${r.pct.padEnd(w2)} · ${r.nd.padEnd(w3)} · ${r.meaning}`);
}

// the act boundary: an ask whose uppercase reads as an irrevocable or outbound act is the operator's, the rest is the worker's
export function actOf(ask) {
  const U = String(ask).toUpperCase();
  if (IRREVOCABLE_HEADLINE.test(U)) return { cls: 'YOUR ACT', why: 'an irrevocable act (push · publish · migration · send) — the worker drafts, the operator arms' };
  // spec-clarity's IRREVOCABLE_HEADLINE reads row headlines (GIT PUSH, NPM PUBLISH …); a raw dictation says "ship" or "deploy"
  // (CLAUDE.md PUSH ≠ DEPLOY: production deploys only when the operator says ship or deploy), so those two verbs are named here
  if (/\b(SHIP|DEPLOY)\b/.test(U)) return { cls: 'YOUR ACT', why: 'a production deploy (npm run ship) — runs only when the operator says ship or deploy in the session' };
  if (OUTBOUND_HEADLINE.test(U)) return { cls: 'YOUR ACT', why: 'outbound to a person or the public — composed as a draft, armed by the operator' };
  return { cls: 'WORKER', why: 'code, tests, docs in this repo — the worker builds it until its guard is green' };
}

// the basin: paths the ask names, then the paths the grown rows cite as existing — only what resolves on disk
export function basinOf(ask, rowTexts, { exists = (p) => onDisk(p, REPO) } = {}) {
  const out = [];
  for (const p of [...namedPaths(ask), ...rowTexts.flatMap((t) => citedPaths(t))]) if (!out.includes(p) && exists(p)) out.push(p);
  return out.slice(0, 6);
}

// the snowball: retroGrow with a walker; without one (no binary, --no-walk), the gzip-nearest rows, labelled — never silently
export async function snowballOf(ask, { tree, walk = null, k = 3 } = {}) {
  const { rowsOf, retroGrow } = await import('./retro-snowball.mjs');
  const rows = rowsOf(tree);
  if (!rows.length) return { how: 'UNMEASURED — no walked contract rows in the spec tree (npx thetacog-mcp spec-tree)', rows: [] };
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  if (walk) {
    const g = await retroGrow(tree, ask, { walk, rows });
    if (g.set && g.set.length) return { how: `retro snowball · ${g.set.length} rows · stop ${g.stop ? g.stop.why : '—'} at overlap ${g.overlap}`, rows: g.set.map((id) => byId[id]).filter(Boolean) };
    var walkWhy = g.why || (g.steps && g.steps[0] && g.steps[0].err) || 'the walk grew no rows';
  }
  const { ncd } = await import('./spec-tree.mjs');
  const a = String(ask).toLowerCase();
  const near = rows.map((r) => ({ r, d: ncd(a, r.text.toLowerCase()) })).sort((x, y) => x.d - y.d).slice(0, k);
  return { how: `gzip-nearest ${k} (retro not run — ${walk ? walkWhy : 'no walker'})`, rows: near.map((x) => ({ ...x.r, ncd: +x.d.toFixed(3) })) };
}

// the associative read: the k spec rows nearest the ask, ticked or open — ranked by rule-grab.mjs grab() over the spec rows as its
// corpus (one sensor home: gzip-NCD at a matched eye, IDF overlap under the gzip floor, the lexical gate named). A bare ncd() over
// whole rows let the shortest rows (C0, C2, C4) win every ask: at an unmatched aperture NCD measures length, not meaning.
export async function nearOf(ask, specText, { k = 3 } = {}) {
  const { parseRows } = await import('./spec-clarity.mjs'); const { grab } = await import('../cog/rule-grab.mjs');
  const rows = parseRows(specText).filter((r) => r.text.length >= 80);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const corpus = rows.map((r) => ({ file: 'spec', line: r.line, title: r.id, text: r.text }));
  const g = grab(String(ask), { corpus, cap: k, repo: REPO });
  return (g.hits || []).map((h) => ({ id: h.title, ticked: byId[h.title] ? byId[h.title].ticked : false, text: byId[h.title] ? byId[h.title].text : h.span, ncd: h.ncd, sensor: g.sensor }));
}

async function rulesOf(ask) {
  try { const { grab } = await import('../cog/rule-grab.mjs'); const r = grab(ask, { cap: 3, repo: REPO }); return { hits: r.hits || [], note: r.lexicallySupported === false ? r.note : null }; }
  catch (e) { return { hits: [], note: `rule-grab unavailable — ${String(e.message || e).slice(0, 80)}` }; }
}

// one ask → its contract. Pure over what it is handed (tree, walk, sidecar, spec text); the caller does the reads.
export async function compileAsk(ask, { id, tree, walk, sidecar, exists, specText = '' } = {}) {
  const snow = await snowballOf(ask, { tree, walk });
  const near = await nearOf(ask, specText);
  const patterns = diagnose(ask);
  let pointer = null;
  if (patterns.some((x) => x.id === 'PM06' || x.id === 'PM07')) {
    const a = activeRow(specText); const line = a ? String(specText).split('\n')[a.i] : '';
    pointer = a ? { id: a.id, text: line.replace(/^\s*-\s*\[[ xX]\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160) } : { id: null, text: null };
  }
  const rules = await rulesOf(ask);
  const banned = findBannedPromises(String(ask));
  const basin = basinOf(ask, [...snow.rows, ...near].map((r) => r.text), exists ? { exists } : {});
  const slug = slugify(ask);
  const fill = { basin: basin.length > 0, retro: snow.rows.length > 0, near: near.length > 0, hat: !!(sidecar && sidecar.hat), rules: rules.hits.length > 0 };
  return { id: `C${id}`, ask, head: headOf(id, ask), slug, guard: `tests/vna/c${id}-${slug}.test.mjs`, act: actOf(ask), basin, snow, near, patterns, pointer, rules, banned, hat: sidecar && sidecar.hat ? sidecar : null, fill };
}

// THE SHAPE IS PROMPT MASTER'S TEMPLATE M ("Current Claude Task Brief", github.com/nidhinjs/prompt-master @49b3a72, MIT,
// references/templates.md), used as it ships: Objective · Context · Target State · Scope · Constraints · Acceptance Criteria ·
// Action Boundaries · Progress Evidence. Every field is filled from a door above, never by a model. Its one rule this repo does not
// take is "ask up to three clarifying questions": here an empty field prints UNMEASURED and the operator rewrites it in the txt.
export const TEMPLATE_M = 'Template M — Current Claude Task Brief (prompt-master @49b3a72, MIT)';
const neighbourGuards = (u) => u.near.filter((r) => r.ticked).map((r) => guardOf(r.text)).filter(Boolean);
export function renderSteer(units, { dictation, at, grade = null }) {
  const L = [];
  L.push(`/steer — compiled ${at} · ${units.length} ask${units.length === 1 ? '' : 's'} · rewrite anything below, then paste the STEER block after /steer`);
  L.push('', '═══ THE STEER ═══');
  for (const u of units) {
    L.push(u.head);
    L.push('  draft head — rewrite it');
    L.push('  verbatim:');
    for (const line of wrapQuoted(u.ask, 96, '    ')) L.push(line);
    L.push(`  act: ${u.act.cls}`);
    L.push(`  guard: \`${u.guard}\``);
    L.push('');
  }
  L.push(`GOAL: ${SIMPLE_GOAL}.`);
  if (grade) {
    L.push('', '═══ THE SIX PERCENTAGES (measured over this steer · the floor only rises: steer-compile.mjs --check) ═══');
    for (const line of pctTable(grade)) L.push(line);
  }
  for (const u of units) {
    const keep = neighbourGuards(u);
    L.push('', `─── ${u.id} · ${TEMPLATE_M} ───`);
    L.push('## Objective', `  ${u.head} — operator ${at}, verbatim: "${shq(u.ask)}"`);
    for (const x of u.patterns) {
      L.push(`  ✗ ${x.id} ${x.name} (Prompt Master #${x.p}) — ${x.rule} · fix: ${x.fix}`);
      if (x.jobs) x.jobs.forEach((j, i) => L.push(`    job ${i + 1}: ${j.slice(0, 140)}`));
    }
    if (u.pointer) L.push(u.pointer.id ? `  pointer: the ask names its object outside itself. Candidate referent, the newest open dictated row ${u.pointer.id}: ${u.pointer.text} — name it here, or a worker starts blind` : '  pointer: the ask names its object outside itself and no open dictated row is on the spec — name the object here');
    L.push('## Context (what exists now)');
    L.push(`  near — already asked, gzip-NCD via rule-grab:${u.near.length ? '' : ' UNMEASURED — no spec rows'}`);
    for (const r of u.near) L.push(`    ↳ ${r.ticked ? '[x]' : '[ ]'} ${r.id} (ncd ${r.ncd}): ${r.text.replace(/\s+/g, ' ').slice(0, 150)}`);
    L.push(`  snowball — ${u.snow.how}`);
    for (const r of u.snow.rows) L.push(`    ↳ ${r.id}${r.ncd != null ? ` (ncd ${r.ncd})` : ''}${r.pixel ? ` @ ${r.pixel}` : ''}: ${r.text.replace(/\s+/g, ' ').slice(0, 150)}`);
    L.push(`  hat — ${u.hat ? `${u.hat.hat}${u.hat.coord ? ` · ${u.hat.coord} ${u.hat.name || ''}` : ''}: "As ${u.hat.hat}: build ${u.id} until ${u.guard} is green; nothing else."` : 'UNMEASURED — no snowball sidecar for this prompt (the prompt hook writes it)'}`);
    L.push('## Target State', `  ${u.guard} exists, was seen red on the tree as it stood, and is green; ${u.id} is ticked by the commit that built it`);
    L.push('## Scope', `  - Work only in: ${u.basin.length ? u.basin.join(' · ') : 'UNMEASURED — the ask names no path on disk and the near rows cite none; name the file here'} · ${u.guard}`);
    L.push('  - Do NOT touch: a path another session holds (node scripts/ops/wip.mjs check <paths>) · generated artifacts (edit the generator)');
    L.push('## Constraints');
    for (const h of u.rules.hits) L.push(`  ✗ ${String(h.title || '').slice(0, 110)} — ${h.file}:${h.line}`);
    if (!u.rules.hits.length) L.push('  UNMEASURED — rule-grab found no rule for this ask');
    if (u.rules.note) L.push(`  (${u.rules.note.slice(0, 160)})`);
    L.push(`  vocabulary: ${u.banned.length ? u.banned.map((b) => `${b.label}: "${b.snippet}"`).join(' · ') + ' — the worker writes DETECTED · PLACED · PRICED · DISPATCHED' : 'clean against behavior-promise.mjs'}`);
    L.push('  Only make changes directly requested. One ask, one commit.');
    L.push('## Acceptance Criteria', `  - [ ] ${u.guard} fails before the change`, `  - [ ] ${u.guard} passes after it`);
    for (const g of keep) L.push(`  - [ ] ${g} stays green (the ticked neighbour)`);
    L.push(`  - [ ] node scripts/vna/steer.mjs verify ${u.id} --since <head-at-dispatch> ticks it`);
    L.push('## Action Boundaries', `  ${u.act.cls} — ${u.act.why}`, '  Stop and name it before: a push, a publish, a send, a migration, money, a deletion of work you did not write.');
    L.push('## Progress Evidence', '  The commit sha, the guard path, and the guard output. A claim with no tool result is not progress.');
    L.push(`  (empty slots: ${SLOTS.filter((s) => !u.fill[s]).join(' · ') || 'none'})`);
  }
  L.push('', '═══ DICTATION AS GIVEN ═══', String(dictation).trim(), '');
  return L.join('\n');
}

// THE SIX PERCENTAGES OF A STEER — the house order (six-percentages.mjs PCT_ORDER), each a construct a steer can carry, computed over
// the units with its numerator and denominator, or UNMEASURED on a zero denominator (never 100, never 0 — six-pct.mjs's rule).
export const PCTS = [
  { key: 'predictive', name: 'Predictive Power', construct: 'asks whose done-when is a named guard AND a basin on disk', meaning: 'a named guard tied to a file on disk', ok: (u) => !!u.guard && u.basin.length > 0 },
  { key: 'impact', name: 'Impact', construct: 'asks whose act is decided, that land on a file and name their own object (the worker can start without asking)', meaning: 'the worker can start without asking', ok: (u) => (u.act.cls === 'YOUR ACT' || u.basin.length > 0) && !u.pointer },
  { key: 'confidence', name: 'Confidence', construct: 'asks whose context came from a measured read (retro walked, or near rows lexically supported)', meaning: 'the context came from a measured read', ok: (u) => (u.snow.rows.length > 0 && /^retro snowball/.test(u.snow.how)) || (u.near.length > 0 && !u.rules.note) },
  { key: 'anti-regression', name: 'Anti-regression', construct: 'asks carrying a ticked neighbour\'s guard to keep green', meaning: 'keeps a ticked neighbour\'s guard green', ok: (u) => neighbourGuards(u).length > 0 },
  { key: 'anti-normalisation', name: 'Anti-normalisation', construct: 'asks with no banned promise reaching the worker and a hat at their coordinate (not the average voice)', meaning: 'no banned promise, a hat at its coordinate', ok: (u) => u.banned.length === 0 && !!u.hat },
  { key: 'sufficiency', name: 'Sufficiency', construct: 'slots filled across the asks (basin · retro · near · hat · rules)', meaning: 'slots filled across the asks', count: (us) => [us.reduce((a, u) => a + SLOTS.filter((s) => u.fill[s]).length, 0), us.length * SLOTS.length] },
];
// one ask's score: how many of the six it carries (sufficiency counts when no slot came back empty)
export function unitScore(u) { return PCTS.filter((p) => (p.count ? SLOTS.every((s) => u.fill[s]) : p.ok(u))).length; }
export function recordAsks(units, { at, path, recordPath = RECORD } = {}) {
  let j = { asks: [] }; try { j = JSON.parse(readFileSync(recordPath, 'utf8')); } catch {}
  const by = new Map((j.asks || []).map((x) => [x.id, x]));
  for (const u of units) by.set(u.id, { id: u.id, head: u.head, ask: u.ask, act: u.act.cls, guard: u.guard, basin: u.basin, near: u.near.map((r) => r.id), score: unitScore(u), patterns: u.patterns.map((x) => x.id), empty: SLOTS.filter((s) => !u.fill[s]), at, file: relative(REPO, path) });
  const asks = [...by.values()].sort((x, y) => String(y.at).localeCompare(String(x.at)) || (x.id < y.id ? -1 : 1)).slice(0, RECORD_CAP);
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ note: 'written by scripts/vna/steer-compile.mjs on every compile; read by scripts/ops/board-steer.mjs (the Steer · Compiled sheet)', asks }, null, 2) + '\n');
  return asks;
}
export function gradeSteer(units) {
  const g = {};
  for (const p of PCTS) {
    const [n, d] = p.count ? p.count(units) : [units.filter(p.ok).length, units.length];
    g[p.key] = { n, d, pct: d ? Math.round((100 * n) / d) : null };
  }
  return g;
}

export function openTxt(path) {
  if (process.env.VNA_STEER_COMPILE_NO_OPEN === '1') return { opened: false, why: 'VNA_STEER_COMPILE_NO_OPEN=1' };
  const cmd = process.env.VNA_STEER_COMPILE_OPENER || (process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null);
  if (!cmd) return { opened: false, why: `no opener on ${process.platform}` };
  try { execFileSync(cmd, [path], { stdio: 'ignore' }); return { opened: true, why: null }; } catch (e) { return { opened: false, why: `${cmd} failed: ${e.code || e.status || e.message}` }; }
}

const fillOf = (units) => units.length ? units.reduce((a, u) => a + SLOTS.filter((s) => u.fill[s]).length, 0) / (units.length * SLOTS.length) : 0;

export async function compile(dictation, { open = true, walk = undefined, tree = undefined, sidecar = undefined, specText = undefined, reserved = undefined, at = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }), exists } = {}) {
  const asks = splitAsks(dictation);
  if (!asks.length) return { path: null, units: [], why: 'empty dictation' };
  if (tree === undefined) { try { const { readTree, TREE } = await import('./spec-tree.mjs'); tree = readTree(TREE); } catch { tree = null; } }
  if (walk === undefined) { try { const { probeWalker } = await import('./snowball-refresh.mjs'); walk = probeWalker(); } catch { walk = null; } }
  if (sidecar === undefined) sidecar = readSidecar();
  const specInjected = specText !== undefined;
  if (specText === undefined) specText = existsSync(SPEC_MD) ? readFileSync(SPEC_MD, 'utf8') : '';
  // C1454: past every reserved id too; an injected spec (the guards' fixtures) keeps its own numbering unless reserved is passed
  const held = reserved !== undefined ? reserved : specInjected ? 0 : readReserved();
  const first = Math.max(nextTopLevelId(specText), held + 1);
  const units = [];
  for (let i = 0; i < asks.length; i++) units.push(await compileAsk(asks[i], { id: first + i, tree, walk, sidecar, exists, specText }));
  const grade = gradeSteer(units);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${at}-${slugify(asks[0])}.txt`);
  writeFileSync(path, renderSteer(units, { dictation, at, grade }));
  const fill = +fillOf(units).toFixed(3);
  const pcts = Object.fromEntries(PCTS.map((p) => [p.key, grade[p.key].pct]));
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), asks: units.length, fill, pcts, empty: units.flatMap((u) => SLOTS.filter((s) => !u.fill[s]).map((s) => `${u.id}:${s}`)), path: relative(REPO, path) }) + '\n');
  recordAsks(units, { at, path });
  const o = open ? openTxt(path) : { opened: false, why: '--no-open' };
  return { path, units, fill, grade, opened: o.opened, openWhy: o.why };
}

// the ratchet: per percentage, the median of the last RATCHET_WINDOW compiles against its floor; every floor only rises
export function readLedger(p = LEDGER) { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }
export function median(xs) { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
export function ratchet({ rows = readLedger(), floorPath = FLOOR, raise = false } = {}) {
  const win = rows.slice(-RATCHET_WINDOW);
  let F = {}; try { F = JSON.parse(readFileSync(floorPath, 'utf8')); } catch {}
  const floors = { fill: F.floor || 0, ...(F.pcts || {}) };
  const keys = ['fill', ...PCTS.map((p) => p.key)];
  const med = Object.fromEntries(keys.map((k) => [k, median(win.map((r) => (k === 'fill' ? r.fill : r.pcts ? r.pcts[k] : null)))]));
  if (med.fill == null) return { state: 'UNMEASURED', why: 'no compiles on the ledger', floor: floors.fill, floors };
  const below = keys.filter((k) => med[k] != null && floors[k] != null && med[k] < floors[k] - 1e-9);
  const empties = {}; for (const r of win) for (const e of r.empty || []) { const s = e.split(':')[1]; empties[s] = (empties[s] || 0) + 1; }
  if (raise) {
    for (const k of keys) if (med[k] != null && med[k] > (floors[k] || 0)) floors[k] = med[k];
    const { fill, ...pcts } = floors;
    mkdirSync(dirname(floorPath), { recursive: true });
    writeFileSync(floorPath, JSON.stringify({ floor: fill, pcts, at: new Date().toISOString(), n: win.length }, null, 2) + '\n');
  }
  return { state: below.length ? 'BELOW FLOOR' : 'AT OR ABOVE FLOOR', below, median: med.fill, medians: med, floor: floors.fill, floors, n: win.length, empties };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  if (a.includes('--check') || a.includes('--raise')) {
    const r = ratchet({ raise: a.includes('--raise') });
    console.log(`steer-compile ratchet: ${r.state}${r.median != null ? ` · over ${r.n} · ${Object.entries(r.medians).map(([k, v]) => `${k} ${v ?? "—"} (floor ${r.floors[k] ?? 0})`).join(" · ")}${r.below.length ? ` · below: ${r.below.join(" ")}` : ""}` : ` — ${r.why}`}${r.empties && Object.keys(r.empties).length ? ` · empty slots: ${Object.entries(r.empties).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''}`);
  } else {
    const text = a.filter((x) => !x.startsWith('--')).join(' ');
    if (!text.trim()) { console.error('usage: steer-compile.mjs "<dictation>" [--no-open] [--json] [--no-walk] · --check · --raise'); process.exit(2); }
    const r = await compile(text, { open: !a.includes('--no-open'), ...(a.includes('--no-walk') ? { walk: null } : {}) });
    if (a.includes('--json')) console.log(JSON.stringify({ path: r.path, fill: r.fill, opened: r.opened, units: r.units.map((u) => ({ id: u.id, act: u.act.cls, guard: u.guard, basin: u.basin, fill: u.fill })) }));
    else console.log(`steer compiled: ${relative(process.cwd(), r.path)} · ${r.units.length} asks (${r.units.map((u) => u.id).join(' ')}) · fill ${r.fill} · ${r.opened ? 'opened' : `not opened (${r.openWhy})`}`);
  }
}
