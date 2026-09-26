// scripts/vna/outward-dozen.mjs — C242b: /STEER READS THE DOZEN ON EVERY OUTWARD-PROSE COMMIT.
//
// Operator 2026-09-24 (C242, verbatim): "figure out how to bake in the dozen percentage guarsds into /steer that io1
// catastrophically mangled recently so we both save tokens, and save tokens having to fix regressed turns."
//
// THE NET, NEVER A GATE. Given a commit range (or one sha), every file it touches that is OUTWARD PROSE — docs/comms/**,
// src/content/blog/**/*.mdx, the invite / first-touch templates — is measured by the one measurer (scripts/lib/six-percentages.mjs:
// measure · judge · the floors in data/six-percentages-floors.json) at the commit AND at its parent, both read with `git show`
// off the immutable commit, never the working tree (AXIOM 1 W3). A check that is WORSE at the commit than at the parent is a
// DROP: it is DETECTED (a row on .thetacog/outward-dozen.ndjson, append-only) and DISPATCHED (steer-until.mjs hands the line to
// the one retry brief). Nothing here halts, blocks, or converts a verdict. The verbs are DETECTED · PLACED · PRICED · DISPATCHED.
//
// UNMEASURED IS NOT A PASS. A kind whose floors class does not exist in the floors file is not measured against post-shaped checks
// (that would be a proxy for a construct this file cannot compute — THE PROXY IS NOT THE THING); the row reads UNMEASURED with
// the reason. When C242a's invite / first-touch kind and its floors land, the same read picks them up: the class list below names
// the spellings it accepts, and the measurer's own exports (NEEDS_ORDER, an order construct's `detail`) are read when present.
//
// THE ORDER IS A CONSTRUCT (operator 2026-09-24, verbatim: "the six needs sequnce is not just priority, its the order the points
// need to land for any cta"). The brief states it as an instruction, not a list; a drop row's `detail` (from the measurer) names
// which need landed out of order or which call to action came early, and the retry line carries that detail verbatim.
//
// Zero LLM anywhere: regexes, gzip, git. Guard: tests/vna/c242b-steer-reads-the-dozen.test.mjs.
//
//   node scripts/vna/outward-dozen.mjs [<sha> | <a>..<b>] [--since "2 days ago"] [--json] [--status] [--floors <path>]
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as six from '../lib/six-percentages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const DOZEN_NDJSON = process.env.VNA_OUTWARD_DOZEN || resolve(REPO, '.thetacog/outward-dozen.ndjson');
export const FLOORS_PATH = process.env.SIX_FLOORS || resolve(REPO, 'data/six-percentages-floors.json');
const MEASURER_PATH = resolve(HERE, '..', 'lib', 'six-percentages.mjs');
// which measurer produced a row — the bytes of six-percentages.mjs, so a constructs change (C242a) re-measures and appends
// fresh rows beside the old ones instead of silently reading the old reading as current
export const MEASURER = (() => { try { return createHash('sha256').update(readFileSync(MEASURER_PATH)).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12); } catch { return 'unknown'; } })();

// the canonical six-needs order — docs/architecture/claude-rules/voice-and-pitch.md ("The six needs in order — Connection,
// Contribution, Growth, Uncertainty, Certainty, Significance"); the measurer's own export (C242a's NEED_ORDER, the order
// construct I4/I5 reads) wins when it carries one, so the brief and the check can never name two different orders
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const NEEDS_ORDER = (six.NEED_ORDER || six.NEEDS_ORDER || ['connection', 'contribution', 'growth', 'uncertainty', 'certainty', 'significance']).map(cap);
export const ORDER_INSTRUCTION = `land the six needs in this order — ${NEEDS_ORDER.join(', ')} — then exactly one call to action; nothing asks anything of the reader before the last need has landed.`;

// ── which paths are outward prose, and of what kind ────────────────────────────────────────────────────────────────
// the templates that EMIT an invite (src/lib/nominate/invite-email.ts, src/lib/bookclub/tester-invite-email.ts) — a fingerprint or a
// client-declared helper beside them is code, not prose (seen on the first two-day read: client-declared.ts read as an invite)
export const INVITE_TEMPLATE_RE = /^src\/lib\/(nominate|bookclub)\/[\w-]*invite[\w-]*\.ts$/;
export const KIND_CLASSES = { post: ['post'], newsletter: ['newsletter'], invite: ['invite', 'first-touch', 'first_touch', 'firsttouch'], comms: ['comms'] };
export function kindOf(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (/^src\/content\/blog\/.+\.mdx$/.test(p)) return 'post';
  if (INVITE_TEMPLATE_RE.test(p)) return 'invite';
  if (/^docs\/comms\//.test(p)) {
    if (!/\.(md|mdx|html|txt)$/.test(p) || /\.(predictions|grade)\.\w+$/.test(p)) return null;   // a predictions/grade sidecar is a record about the prose, not the prose
    if (/invite/i.test(basename(p))) return 'invite';
    if (/^docs\/comms\/newsletter\/.+\.html$/.test(p)) return 'newsletter';
    return 'comms';
  }
  return null;
}
export function floorsClassFor(kind, floorsAll) { for (const c of KIND_CLASSES[kind] || []) if (floorsAll && floorsAll[c]) return c; return null; }
export function loadFloors(path = FLOORS_PATH) { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; } catch { return {}; } }

// ── the prose a file emits ─────────────────────────────────────────────────────────────────────────────────────────
// A TypeScript template's prose is the string literals it emits — template literals with their `${…}` interpolations blanked,
// and quoted strings long enough to be a sentence. A small scanner, not a regex: nested templates inside `${…}` (li(`${site}/deck`,
// …)) would otherwise flip which side of a backtick is code.
export function tsProse(src) {
  const out = []; const stack = []; let i = 0; const n = src.length;
  while (i < n) {
    const ch = src[i]; const top = stack[stack.length - 1];
    if (top && top.type === 'tpl') {
      if (ch === '\\') { top.buf += src[i + 1] || ''; i += 2; continue; }
      if (ch === '`') { out.push(top.buf); stack.pop(); i++; continue; }
      if (ch === '$' && src[i + 1] === '{') { stack.push({ type: 'expr', depth: 0 }); top.buf += ' '; i += 2; continue; }
      top.buf += ch; i++; continue;
    }
    if (ch === '`') { stack.push({ type: 'tpl', buf: '' }); i++; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') { s += src[j + 1] || ''; j += 2; } else { s += src[j]; j++; } }
      if (s.length >= 40 && /\s/.test(s)) out.push(s);
      i = j + 1; continue;
    }
    if (ch === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
    if (ch === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (top && top.type === 'expr') { if (ch === '{') top.depth++; else if (ch === '}') { if (top.depth === 0) { stack.pop(); i++; continue; } top.depth--; } }
    i++;
  }
  return out.join('\n');
}
const stripFront = (s) => s.replace(/^---\n[\s\S]*?\n---\n/, '');
export function proseOf(src, kind, path = '') {
  const s = String(src || '');
  if (kind === 'post') return { text: six.TEXT(stripFront(s).replace(/^import .*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')), html: '' };
  if (kind === 'newsletter') return { text: six.TEXT(s), html: s };
  if (/\.ts$/.test(path)) return { text: six.TEXT(tsProse(s)), html: '' };
  if (/\.html$/.test(path)) return { text: six.TEXT(s), html: s };
  return { text: six.TEXT(stripFront(s)), html: '' };
}

// ── measure, compare, the lines ───────────────────────────────────────────────────────────────────────────────────
export function measureText({ text, html = '', kind, cls, floorsAll }) {
  const checks = six.measure(text, { html, kind: cls || kind });
  return six.judge(checks, (cls && floorsAll[cls]) || {}).rows;
}
const valuesOf = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.value]));
const worseThan = (c, a, b) => c.dir === 'min' ? a > b : c.dir === 'max' ? a < b : c.dir === 'exact' ? (b === c.ideal && a !== c.ideal) : false;
const betterThan = (c, a, b) => c.dir === 'min' ? a < b : c.dir === 'max' ? a > b : c.dir === 'exact' ? (a === c.ideal && b !== c.ideal) : false;
export const ratchetLine = (r) => `${r.id} ${r.dir} · ideal ${r.ideal}${r.unit ? ' ' + r.unit : ''} · floor ${r.floor === null || r.floor === undefined ? 'none (unratcheted)' : r.floor}${r.worse ? ' · BELOW THE FLOOR' : ''}`;
export function dropsBetween(before, after) {
  const out = [];
  for (const a of after) {
    if (a.dir === 'report') continue;
    const b = before.find((x) => x.id === a.id); if (!b) continue;
    if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
    if (worseThan(a, a.value, b.value)) out.push({ id: a.id, pct: a.pct, construct: a.name, dir: a.dir, unit: a.unit, before: b.value, after: a.value, detail: a.detail || '', floor: a.floor ?? null, belowFloor: !!a.worse, ratchet: ratchetLine(a) });
  }
  return out;
}
export const risesBetween = (before, after) => after.filter((a) => a.dir !== 'report' && before.some((b) => b.id === a.id && Number.isFinite(b.value) && Number.isFinite(a.value) && betterThan(a, a.value, b.value))).map((a) => a.id);
// the one retry line: "the dozen dropped: <pct> <before>→<after> — <construct>[: <detail>] — ratchet: <line>"; for the order
// construct the measurer's detail is what names the need that landed out of order or the call to action that came early
export const dropLine = (d) => `the dozen dropped: ${d.pct} ${d.before}→${d.after} — ${d.construct}${d.detail ? `: ${d.detail}` : ''} — ratchet: ${d.ratchet}`;

// ── git, immutable ────────────────────────────────────────────────────────────────────────────────────────────────
const git = (repo, ...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch { return null; } };
const showAt = (repo, sha, path) => git(repo, 'show', `${sha}:${path}`);
export function outwardCommits(repo, { range = null, since = null } = {}) {
  let shas;
  if (since) shas = (git(repo, 'rev-list', '--no-merges', '--reverse', `--since=${since}`, range || 'HEAD') || '').split('\n').filter(Boolean);
  else if (range && range.includes('..')) shas = (git(repo, 'rev-list', '--no-merges', '--reverse', range) || '').split('\n').filter(Boolean);
  else if (range) { const s = (git(repo, 'rev-parse', '--verify', `${range}^{commit}`) || '').trim(); shas = s ? [s] : []; }
  else { const s = (git(repo, 'rev-parse', 'HEAD') || '').trim(); shas = s ? [s] : []; }
  return shas.map((sha) => ({ sha, files: (git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha) || '').split('\n').filter(Boolean).filter((f) => kindOf(f)) })).filter((c) => c.files.length);
}

// ── the read: rows for a range, appended once per (sha, path, measurer) ───────────────────────────────────────────
const record = (path, row) => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(row) + '\n'); } catch {} };
export function readRows(ndjson = DOZEN_NDJSON) { try { return readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.sha && r.path); } catch { return []; } }
const keyOf = (r) => `${r.sha}\t${r.path}\t${r.measurer}`;
export function readDozen({ repo = REPO, range = null, since = null, ndjson = DOZEN_NDJSON, floorsPath = FLOORS_PATH, append = true } = {}) {
  const floorsAll = loadFloors(floorsPath);
  const seen = new Set(readRows(ndjson).map(keyOf));
  const rows = []; let appended = 0;
  for (const c of outwardCommits(repo, { range, since })) {
    const parent = (git(repo, 'rev-parse', '--verify', `${c.sha}^{commit}^`) || '').trim() || null;
    const committed = (git(repo, 'log', '-1', '--format=%cI', c.sha) || '').trim() || null;
    // "later" between two rows is read off the commit graph, never off a clock: same-second commits (a fixture, a fast session)
    // have equal %cI, and the measurement time says when the read ran, not when the prose changed
    const depth = Number((git(repo, 'rev-list', '--count', c.sha) || '').trim()) || null;
    for (const path of c.files) {
      const kind = kindOf(path); const cls = floorsClassFor(kind, floorsAll);
      const row = { at: new Date().toISOString(), sha: c.sha, parent, committed, depth, path, kind, cls, measurer: MEASURER, verdict: null, before: null, after: null, drops: [], rises: [], why: null };
      const afterSrc = showAt(repo, c.sha, path); const beforeSrc = parent ? showAt(repo, parent, path) : null;
      if (!cls) { row.verdict = 'UNMEASURED'; row.why = `no floors class for kind ${kind} in ${basename(floorsPath)} — not measured against post-shaped checks (a proxy), never a pass`; }
      else if (afterSrc === null) { row.verdict = 'REMOVED'; row.why = 'the file is not at this commit'; }
      else {
        const a = proseOf(afterSrc, kind, path);
        if (!a.text) { row.verdict = 'UNMEASURED'; row.why = 'no prose extracted at the commit'; }
        else {
          const after = measureText({ ...a, kind, cls, floorsAll }); row.after = valuesOf(after);
          if (beforeSrc === null) { row.verdict = 'NEW'; row.why = 'no previous committed version'; }
          else {
            const b = proseOf(beforeSrc, kind, path);
            const before = measureText({ ...b, kind, cls, floorsAll }); row.before = valuesOf(before);
            row.drops = dropsBetween(before, after); row.rises = risesBetween(before, after);
            row.verdict = row.drops.length ? 'DROP' : row.rises.length ? 'UP' : 'HELD';
          }
        }
      }
      rows.push(row);
      if (append && !seen.has(keyOf(row))) { record(ndjson, row); seen.add(keyOf(row)); appended++; }
    }
  }
  return { rows, appended, floorsPath, measurer: MEASURER };
}

// the runner's own JSON is the source of the range — never a sha scraped from prose (CLAUDE.md: "a dispatch learns what an agent
// committed by asking git for the range since HEAD at dispatch")
export function rangesOf(runnerResult) {
  const out = [];
  for (const d of (runnerResult && Array.isArray(runnerResult.dispatches) ? runnerResult.dispatches : [])) if (d && d.head0 && d.head1 && d.head0 !== d.head1) out.push(`${d.head0}..${d.head1}`);
  if (runnerResult && runnerResult.regraded && runnerResult.regraded.sha) out.push(runnerResult.regraded.sha);
  return [...new Set(out)];
}
export function dozenFor(runnerResult, { repo = REPO, ndjson = DOZEN_NDJSON, floorsPath = FLOORS_PATH, dozen = (o) => readDozen(o) } = {}) {
  const rows = []; for (const range of rangesOf(runnerResult)) rows.push(...dozen({ repo, range, ndjson, floorsPath }).rows);
  const dropped = rows.filter((r) => r.verdict === 'DROP');
  const lines = dropped.flatMap((r) => r.drops.map((d) => `${dropLine(d)} (${r.path} @ ${r.sha.slice(0, 10)})`));
  const unmeasured = rows.filter((r) => r.verdict === 'UNMEASURED').map((r) => `${r.path} UNMEASURED — ${r.why}`);
  return { read: rows.length, rows, drops: dropped.reduce((s, r) => s + r.drops.length, 0), lines, unmeasured };
}

// ── the brief block: floors up front, the order as an instruction ─────────────────────────────────────────────────
export function outwardKindsOf(text) {
  const t = String(text || ''); const k = new Set();
  for (const p of t.match(/(?:docs|src)\/[\w./-]+/g) || []) { const kk = kindOf(p); if (kk) k.add(kk); }
  if (/src\/content\/blog|\.mdx\b|\b(blog|street) post\b/i.test(t)) k.add('post');
  if (/\bnewsletter\b|docs\/comms\/newsletter|book[- ]club (note|email|send|passage)/i.test(t)) k.add('newsletter');
  if (/\binvit(e|ation)\b|\bnominat|first[- ]touch|tester[- ]licence|signup (email|invite)/i.test(t)) k.add('invite');
  if (/docs\/comms\//.test(t) && !k.size) k.add('comms');
  return [...k];
}
export function floorsBrief({ kinds = [], floorsPath = FLOORS_PATH, floorsAll = loadFloors(floorsPath) } = {}) {
  if (!kinds.length) return '';
  const lines = ['--- THE DOZEN — this row touches outward prose. Write to these floors: the loop measures every outward file at your commit against its previous committed version, and a drop rides the retry brief (detected, never a block). ---'];
  for (const kind of kinds) {
    const cls = floorsClassFor(kind, floorsAll);
    if (!cls) { lines.push(`kind ${kind}: UNMEASURED — no floors class in ${basename(floorsPath)}; the dozen cannot read this kind yet`); continue; }
    lines.push(`kind ${kind} (floors class ${cls}):`);
    for (const r of six.judge(six.measure('Sample.', { kind: cls }), floorsAll[cls]).rows) {
      if (r.dir === 'report') continue;
      const bound = r.floor === null || r.floor === undefined ? r.ideal : r.floor;
      lines.push(`  ${r.id} ${r.dir === 'min' ? '≤' : r.dir === 'max' ? '≥' : '='} ${bound}${r.unit ? ' ' + r.unit : ''} — ${r.name}${r.floor === null || r.floor === undefined ? ' (ideal; no floor yet)' : ''}`);
    }
  }
  lines.push(ORDER_INSTRUCTION);
  return lines.join('\n');
}
// the block for a spec row, or '' — the row line is read the way snowballText reads it; an unreadable spec is '' (never a throw)
export function dozenBriefFor({ specPath, label, floorsPath = FLOORS_PATH } = {}) {
  let rowText = ''; try { rowText = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || ''); } catch { return ''; }
  const kinds = outwardKindsOf(rowText); return kinds.length ? floorsBrief({ kinds, floorsPath }) : '';
}

// ── status: one line off the ndjson ───────────────────────────────────────────────────────────────────────────────
export function statusLine(ndjson = DOZEN_NDJSON) {
  const latest = new Map(); for (const r of readRows(ndjson)) latest.set(`${r.sha}\t${r.path}`, r);   // the last measurer's row per (sha, path)
  const rs = [...latest.values()];
  const commits = new Set(rs.map((r) => r.sha)).size;
  const drops = rs.flatMap((r) => (r.verdict === 'DROP' ? r.drops.map((d) => ({ ...d, path: r.path, depth: r.depth ?? -1, sha: r.sha })) : []));
  const noWorse = (d, v) => Number.isFinite(v) && (d.dir === 'min' ? v <= d.before : d.dir === 'max' ? v >= d.before : v === d.before);
  // repaired = a LATER commit (deeper on the graph) on the same path where the dropped check is back at, or past, its before value
  const repaired = drops.filter((d) => rs.some((r) => r.path === d.path && r.sha !== d.sha && r.after && (r.depth ?? -1) > d.depth && noWorse(d, r.after[d.id])));
  return `dozen: ${commits} outward commits read · ${drops.length} drops detected · ${repaired.length} repaired`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2); const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const floorsPath = arg('--floors') || FLOORS_PATH;
  if (argv.includes('--status')) { console.log(statusLine()); process.exit(0); }
  const range = argv.find((a) => !a.startsWith('--') && a !== arg('--since') && a !== arg('--floors')) || null;
  const r = readDozen({ range, since: arg('--since'), floorsPath });
  if (argv.includes('--json')) { console.log(JSON.stringify(r)); process.exit(0); }
  for (const row of r.rows) {
    const head = `${row.sha.slice(0, 10)} ${row.verdict.padEnd(10)} ${row.kind.padEnd(10)} ${row.path}`;
    console.log(row.verdict === 'DROP' ? `${head}\n${row.drops.map((d) => `    ${dropLine(d)}`).join('\n')}` : row.why ? `${head} — ${row.why}` : row.verdict === 'UP' ? `${head} — up: ${row.rises.join(' ')}` : head);
  }
  console.log(`${r.rows.length} rows · ${r.appended} appended · measurer ${r.measurer} · floors ${r.floorsPath}\n${statusLine()}`);
}
