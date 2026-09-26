#!/usr/bin/env node
// scripts/vna/spec-clarity.mjs — C186 (b)+(c): every OPEN `- [ ] C…` row of the spec, CLASSIFIED by the compiling-spec ratchet
// (CLAUDE.md "THE AUTONOMY LEVEL IS THE RATCHET") and ORDERED by the walk distance from where the last commit landed.
//
//   CLEAR          the row compiles: a guard path is named · every existing-code path it cites resolves on disk · a verbatim
//                  operator span is present (or inherited from its parent row) · it is not marked PARKED UNTIL / UNSET / UNTIL ASKED
//   NEEDS-OPERATOR the row does not compile, and `missing` names the piece (no guard · a cited path does not resolve · no operator
//                  span · parked · target UNSET · superseded)
//   YOUR-ACT       the row IS, or waits on, an irrevocable act — push, migration, send, pull, install, money, publish — or says so
//                  itself ("the operator's act", "HIS CLICK", "the push is the human's"). Never dispatched; listed.
//
// CONSTRUCT, NOT TOKEN (CLAUDE.md "THE PROXY IS NOT THE THING"): the spec's own meta-rows (C185, C186) NAME every marker in a
// list — "marked PARKED / UNSET / 'the operator's act'" — and one row says "BUT PARKED THE PILL" of history. So a marker is read in
// the shape that DECLARES it about this row: `PARKED UNTIL`, `UNTIL ASKED`, `UNSET` not followed by a list slash, "the operator's
// act" not wrapped in quotes, and an irrevocable deliverable only in the row's own uppercase HEADLINE ("… AND THE PUSH") or an
// explicit hand-off ("HIS CLICK", "— HIS:"). Each pattern has a firing fixture in the guard.
//
// "PATHS THAT SHOULD ALREADY EXIST" — a row cites code it will EDIT and files it will CREATE, and prose cannot tell them apart by
// token. Measured on the live spec 2026-09-23: every bare path that did not resolve (day-one.mjs, snowball-assembler.mjs,
// steer-plan.mjs) was one its row CREATES. So the construct is an EXISTENCE CLAIM — a line citation (`file.mjs:153`) or a
// "today" framing within 64 chars before it. The rule taken (an ASSUMPTION, printed on --json as `pathRule`): such a path counts when it sits under a code/doc root
// (scripts/ src/ packages/ crates/ docs/ .claude/ hooks/ supabase/), is not a test (tests are what the row writes), carries a file
// extension, and is not preceded in the 48 chars before it by a creation verb (new · create · write · emit · add · becomes · moves
// to · sidecar · render). What is left is what the row claims is already there; one that does not resolve is named.
//
// ORDER (c): the row's basin pixel is the ONE walk's (data/vna/spec-tree.json n_spec_<id>.pixel — spec-tree.mjs, lensWalk); the
// last landed commit's pixel is envelope.mjs worked() (src/data/commit-greeks-index.json); the distance is envelope.mjs's own
// Chebyshev on the 12×12 block grid (blockOf · cheb, exported, never re-derived). A row the tree has not placed sorts AFTER every
// placed row, in spec order, and says `d —`. No pixel for the last commit → spec order, and the reason is returned.
//
//   node scripts/vna/spec-clarity.mjs [--json] [--scope <C1,C2|section words>]
//
// Zero LLM: every verdict is a regex over the spec text plus existsSync. @guard tests/vna/c186-steer-runs-until-the-spec-is-satisfied.test.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEmptyAsk, EMPTY_ROW } from './steer-rules.mjs';   // C267
import { blockOf, cheb, worked, loadTree } from './envelope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SPEC_MD = process.env.VNA_SPEC_MD || resolve(REPO, 'docs/specs/vna/SPEC-VNA-COCKPIT.md');

export const CLEAR = 'CLEAR', NEEDS = 'NEEDS-OPERATOR', ACT = 'YOUR-ACT';
export const PATH_ROOTS = ['scripts/', 'src/', 'packages/', 'crates/', 'docs/', '.claude/', 'hooks/', 'supabase/'];
export const CREATION_VERB = /\b(new|creat\w*|writ\w*|emit\w*|add\w*|becomes?|moves? to|sidecar|render\w*|generat\w*|declar\w*)\b/i;
export const pathRule = 'a cited path under ' + PATH_ROOTS.join(' ') + ' with an extension, cited with a :line or after "today", not under tests/, not preceded within 48 chars by a creation verb, must resolve';

// ── the markers, each in the shape that DECLARES it about this row ──────────────────────────────────────────────
// a paste the operator made (a Bridge/Gemini paste quoted on the row) is his span too — he chose to paste it: ASSUMPTION, printed
export const OPERATOR_SPAN = [/\(operator,?\s+(?:[^)]{0,40}?)\d{4}-\d{2}-\d{2}/i, /\boperator\b[^.*]{0,80}?verbatim/i, /\bverbatim:?\s*\*?["“]/i, /\(operator[^)]{0,40}?:\s*\*?["“]/i, /\bpaste\b[^*]{0,90}?\d{4}-\d{2}-\d{2}[^*]{0,40}\*["“]/i];
// a row that DECLARES itself withdrawn (its text, past any leading parentheticals, opens on WITHDRAWN) is kept so the id is never
// reissued, and is not open work; a row that only MENTIONS withdrawal mid-sentence (C106j) stays open (C186.12)
export const WITHDRAWN = /^(?:\s*\([^)]*\)\s*)*WITHDRAWN\b/;
export const PARKED = /\bPARKED UNTIL\b|^\(?PARKED\b/;
export const UNTIL_ASKED = /(?<![\'‘"])\buntil asked\b(?![\'’"])/i;
export const UNSET = /\bUNSET\b(?!\s*\/)/;
export const SUPERSEDED = /\(superseded by (C\d+[a-z]?)/i;
// a hand-off of an act to the operator, in the row's own voice — never the quoted name of the marker in a list
export const HANDOFF = /(?<!['‘"])\bthe operator's act\b(?!['’"])|(?<![\w'‘"])is the operator's act\b|\bHIS CLICK\b|— HIS:|\bthe push is the human's\b/i;
// an irrevocable deliverable in the uppercase HEADLINE, or a row that waits UNTIL a migration is applied/pushed
export const IRREVOCABLE_HEADLINE = /\b(AND THE PUSH|GIT PUSH|NPM PUBLISH|VSCE PUBLISH|OVSX PUBLISH|APPLY THE MIGRATION|RUN THE MIGRATION|SEND THE (?:EMAIL|MAIL|NEWSLETTER)|OLLAMA PULL|CHARGE THE)\b/;
export const WAITS_ON_MIGRATION = /\bUNTIL\s+`?supabase\/migrations\/\S+`?\s+IS\s+(?:APPLIED|PUSHED|RUN)\b/i;

// ── rows: every `- [ ]`/`- [x]` C-row, its indent (a sub-row's parent is the nearest shallower row above it), its section ──
export function parseRows(md) {
  const out = []; let section = '';
  const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const h = /^#{1,4}\s+(.*)$/.exec(L); if (h) { section = h[1].trim(); continue; }
    const m = /^(\s*)-\s*\[([ xX])\]\s*(C\d+[a-z]?\d*)\b\s*(.*)$/.exec(L);
    if (!m) continue;
    out.push({ id: m[3], indent: m[1].length, ticked: m[2] !== ' ', text: m[4], line: i + 1, section });
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i - 1; j >= 0; j--) if (out[j].indent < out[i].indent) { out[i].parent = out[j].id; break; }
  }
  return out;
}

export function guardOf(text) {
  const m = /\(guard:\s*`([^`]+)`/.exec(text) || /\bguard:\s*`([^`]+)`/.exec(text);
  return m ? m[1] : null;
}
// the row's uppercase HEADLINE: the text after the leading parenthetical(s), up to the first span of lowercase prose
export function headlineOf(text) {
  const t = String(text).replace(/^(\s*\([^)]*\)\s*)+/, '');
  const m = /\s[a-z]{2,}\s[a-z]{2,}\s/.exec(t); return (m ? t.slice(0, m.index) : t).replace(/\s*\($/, '').trim();
}
export function citedPaths(text) {
  const out = []; const re = /`?((?:\.claude|[a-z][\w-]*)\/[\w./@-]+\.[a-z]{1,5})(:\d+(?:-\d+)?)?`?/g; let m;
  const guard = guardOf(text);
  // a BARE file name with a line citation (`steer-ui.mjs:796`) is an existence claim too — resolved against BARE_DIRS
  const bare = /(?<![\w./-])([\w-]+\.(?:mjs|js|ts|rs|sh|json|sql)):\d+/g; let b;
  while ((b = bare.exec(text))) if (!out.includes(b[1])) out.push(b[1]);
  while ((m = re.exec(text))) {
    const p = m[1];
    if (!PATH_ROOTS.some((r) => p.startsWith(r))) continue;
    if (p.startsWith('tests/') || p === guard || /[*<>]/.test(p)) continue;
    const before = text.slice(Math.max(0, m.index - 48), m.index);
    if (CREATION_VERB.test(before)) continue;
    // an EXISTENCE CLAIM, not a mention: a line citation (path:153 — no one cites line 153 of an unwritten file) or "today" framing
    if (!m[2] && !/\btoday\b/i.test(text.slice(Math.max(0, m.index - 64), m.index))) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

// every file path the row NAMES (created or existing, tests included) — what C188's planner reads to keep two workers off one path
export function namedPaths(text) {
  const out = []; const re = /(?:\.claude|[a-z][\w-]*)\/[\w./@-]+\.[a-z]{1,5}\b/g; let m;
  while ((m = re.exec(String(text)))) if (!/[*<>]/.test(m[0]) && !out.includes(m[0])) out.push(m[0]);
  return out;
}

// ── the classifier: pure — `exists` is injected so a fixture never touches the disk ─────────────────────────────
export const BARE_DIRS = ['', 'scripts/vna', 'scripts', 'scripts/lib', 'scripts/cog', 'scripts/ops', 'packages/thetacog-mcp-vscode', 'packages/thetacog-mcp-vscode/src', 'packages/thetacog-mcp', 'src/lib'];
export const onDisk = (p, repo = REPO) => p.includes('/') ? existsSync(resolve(repo, p)) : BARE_DIRS.some((d) => existsSync(resolve(repo, d, p)));
export function classifyRow(row, { parentText = null, exists = (p) => onDisk(p) } = {}) {
  const t = row.text; const missing = []; const acts = [];
  const head = headlineOf(t);
  if (IRREVOCABLE_HEADLINE.test(head)) acts.push(`the row's deliverable is irrevocable: "${IRREVOCABLE_HEADLINE.exec(head)[1].toLowerCase()}"`);
  const ho = HANDOFF.exec(t); if (ho) acts.push(`the row hands an act to the operator: "${ho[0]}"`);
  const wm = WAITS_ON_MIGRATION.exec(t); if (wm) acts.push(`the row waits on a migration being applied: "${wm[0].slice(0, 90)}"`);
  if (acts.length) return { id: row.id, class: ACT, missing: acts, guard: guardOf(t) };

  if (PARKED.test(t)) missing.push('PARKED UNTIL ASKED — the operator unparks it');
  else if (UNTIL_ASKED.test(t)) missing.push('UNTIL ASKED — the operator asks for it');
  if (UNSET.test(t)) missing.push('a target reads UNSET — the operator sets the number');
  const sup = SUPERSEDED.exec(t); if (sup) missing.push(`superseded by ${sup[1]} — tick, withdraw or re-scope it`);
  if (isEmptyAsk(head.replace(/\s*\(operator\b[\s\S]*$/i, ''))) missing.push(EMPTY_ROW);   // the span is provenance, not content   // C267: a row with no content never reaches a worker
  const guard = guardOf(t);
  if (!guard) missing.push('no guard path named — `(guard: tests/…)`');
  const hasSpan = OPERATOR_SPAN.some((re) => re.test(t)) || (parentText != null && OPERATOR_SPAN.some((re) => re.test(parentText)));
  if (!hasSpan) missing.push('no verbatim operator span, on the row or its parent');
  const unresolved = citedPaths(t).filter((p) => !exists(p));
  if (unresolved.length) missing.push(`cited path${unresolved.length > 1 ? 's' : ''} not on disk: ${unresolved.slice(0, 3).join(' ')}${unresolved.length > 3 ? ` +${unresolved.length - 3}` : ''}`);
  return { id: row.id, class: missing.length ? NEEDS : CLEAR, missing, guard };
}

export function scopeFilter(rows, scope) {
  if (!scope) return rows;
  const ids = String(scope).split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.every((s) => /^C\d+[a-z]?\d*$/.test(s))) return rows.filter((r) => ids.includes(r.id) || (r.parent && ids.includes(r.parent)));
  const q = String(scope).toLowerCase(); return rows.filter((r) => r.section.toLowerCase().includes(q));
}

export function classifySpec(md, { scope = null, exists } = {}) {
  const all = parseRows(md); const byId = new Map(all.map((r) => [r.id, r]));
  const inScope = scopeFilter(all, scope).filter((r) => !r.ticked);
  const open = inScope.filter((r) => !WITHDRAWN.test(r.text));
  const rows = open.map((r) => {
    let pt = null; let p = r.parent ? byId.get(r.parent) : null; const chain = [];
    while (p) { chain.push(p.text); p = p.parent ? byId.get(p.parent) : null; }
    if (chain.length) pt = chain.join('\n');
    return { ...classifyRow(r, { parentText: pt, exists }), line: r.line, section: r.section, parent: r.parent || null, headline: headlineOf(r.text).slice(0, 90), paths: namedPaths(r.text) };
  });
  const counts = { open: rows.length, clear: rows.filter((r) => r.class === CLEAR).length, needs: rows.filter((r) => r.class === NEEDS).length, act: rows.filter((r) => r.class === ACT).length };
  return { rows, counts, withdrawn: inScope.length - open.length, ticked: Object.fromEntries(all.map((r) => [r.id, r.ticked])) };
}

// ── the order: nearest to the last landed commit's placement first (envelope's Chebyshev on the block grid) ───────
export function lastCommitPlacement({ work = null } = {}) {
  const w = work || worked({ limit: 1 });
  return w && w[0] && blockOf(w[0].coord) ? { sha: w[0].sha, coord: w[0].coord, block: blockOf(w[0].coord) } : null;
}
// the tree is 50 MB — re-parsed only when its mtime moves (a fold that placed a new row mid-run is still picked up)
let _tree = null, _treeMtime = -1;
export function treeFresh(path = resolve(REPO, 'data/vna/spec-tree.json')) {
  let m = -1; try { m = statSync(path).mtimeMs; } catch { return null; }
  if (m !== _treeMtime) { _tree = loadTree(path); _treeMtime = m; }
  return _tree;
}
export function orderByWalk(rows, { tree = undefined, from = undefined } = {}) {
  const T = tree === undefined ? treeFresh() : tree; const origin = from === undefined ? lastCommitPlacement() : from;
  const withD = rows.map((r, i) => {
    const n = T && T.nodes ? T.nodes[`n_spec_${r.id}`] : null;
    const pixel = n && n.pixel && blockOf(n.pixel) ? n.pixel : null;
    const d = origin && pixel ? cheb(origin.block, blockOf(pixel)) : null;
    return { ...r, pixel, d, i };
  });
  withD.sort((a, b) => (a.d == null) - (b.d == null) || (a.d ?? 0) - (b.d ?? 0) || a.i - b.i);
  const reason = !origin ? 'spec order — the last commit carries no pixel (commit-greeks-index)' : !T ? 'spec order — no spec tree on disk' : `walk order from ${origin.coord} (${origin.sha})`;
  return { rows: withD.map(({ i, ...r }) => r), origin, reason };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const c = classifySpec(readFileSync(SPEC_MD, 'utf8'), { scope: arg('--scope') });
  const ord = orderByWalk(c.rows.filter((r) => r.class === CLEAR));
  if (argv.includes('--json')) { console.log(JSON.stringify({ counts: c.counts, order: ord.reason, pathRule, rows: c.rows, clearOrder: ord.rows.map((r) => ({ id: r.id, pixel: r.pixel, d: r.d })) })); process.exit(0); }
  console.log(`spec-clarity · open ${c.counts.open} · clear ${c.counts.clear} · needs-operator ${c.counts.needs} · your-act ${c.counts.act} · ${ord.reason}`);
  for (const r of ord.rows) console.log(`  CLEAR    ${r.id.padEnd(6)} d ${r.d ?? '—'}  ${r.headline}`);
  for (const r of c.rows.filter((x) => x.class !== CLEAR)) console.log(`  ${r.class === ACT ? 'YOUR-ACT' : 'NEEDS   '} ${r.id.padEnd(6)} ${r.missing.join(' · ')}`);
}
