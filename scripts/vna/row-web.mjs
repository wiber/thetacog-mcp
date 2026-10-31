#!/usr/bin/env node
// C1011 THE ROW WEB — EVERY SPEC ROW KNOWS ITS FILES, LLM-FREE. Operator 2026-10-18: "create the spiderweb … the links to the
// files … where you walk from the spec row through the file where the thing was instantiated to the files where it's built …
// cached somewhere … as text files and associated with that spec row … the tokens taken to read the repo versus to write …
// should be reduced because you can use non-LLM to find the indexes of work."
//
// The web is read off git, never guessed: a commit belongs to a row when its subject or body cites the row id EXACTLY (the
// ROW_ID shape steerone reads: C31 is never read out of C317). Per row it keeps:
//   name     the spoken name — the headline's first clause, lower case, at most SPOKEN_WORDS words (C1011a: every id said
//            aloud carries it, so "C317" is heard as "C317, sell licences")
//   born     the first commit that cites the row and the files it touched (where the row was instantiated)
//   built    every file the citing commits touched, ranked by how many of them touched it (where it was built)
//   guard    the row's guard and the repo files that guard imports at HEAD (what holds it)
// Noise paths (receipts, panels, ledgers) are dropped: a file every commit touches carries no address.
//
// Cache: .thetacog/cache/row-web/<id>.txt (one plain text file per row, the thing an agent reads instead of the repo) +
// index.json (the row → web map and the last sha scanned). Incremental: only `<last>..HEAD` is scanned after the first build.
//
// SUFFICIENT FOR: which files a row's own commits touched, and which its guard imports. NOT SUFFICIENT FOR: files a row
// needs that no citing commit touched yet (an unbuilt row has an empty web — UNMEASURED, never a guess), or whether the
// files are right (Rice).
//
// MAXIMISE RUST: this HOLDS MASS (the whole history), so its port row is C1011r — the scan and the rank move into the crate
// beside path_predict.rs once the cache is in use.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = process.env.VNA_ROW_WEB_DIR || resolve(REPO, '.thetacog/cache/row-web');
export const SPOKEN_WORDS = 8, TOP_BUILT = 12, BORN_MAX_CITED = 3;   // born = the first commit whose subject LEADS with the row id and cites at most 3 rows (its own work), else the first citing commit
export const ROW_ID = /\bC\d+[a-z]?\d*\b/g;
export const NOISE = /^(?:\.thetacog\/|docs\/pmu\/commit-panels\/|public\/commit\/|data\/pmu\/|data\/vna\/[^/]+\.ndjson$|docs\/specs\/vna\/goals\/|\.claude\/projects\/)/;
const SPEC_FILES = /^docs\/specs\/vna\/SPEC-[A-Z-]+\.md$/;

// the spoken name: the words before the first colon, dash or full stop of the headline, lower case, capped
// leading parentheticals (guard, declared, built, RE-OPENED …) nest, so they are stripped by depth, never by a [^)] class
export function stripLeadingParens(t) {
  let s = String(t || '').trimStart();
  while (s.startsWith('(')) { let d = 0, i = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; } if (d !== 0) return s; s = s.slice(i + 1).trimStart(); }
  return s;
}
export function spokenName(text) {
  const t = stripLeadingParens(String(text || '').replace(/^\s*-?\s*\[[ x]\]\s*/, '').replace(/^C\d+[a-z]?\d*\s*/, ''));
  const head = t.split(/:|\s[—–-]\s|\.\s|\(/)[0].replace(/[`*_"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const w = head.split(' ').filter(Boolean);
  return w.length ? w.slice(0, SPOKEN_WORDS).join(' ') + (w.length > SPOKEN_WORDS ? ' …' : '') : null;
}
export const say = (id, names) => (names && names.get(id) ? `${id} (${names.get(id)})` : id);

// parse `git log --format=%x1e%h%x1f%s%x1f%b%x1d --name-only` output (\x1d closes the body, the file list follows), oldest first
export function parseLog(raw) {
  const out = [];
  for (const rec of String(raw).split('\x1e')) {
    if (!rec.trim()) continue;
    const [head, tail = ''] = rec.split('\x1d');
    const [sha, subject = '', body = ''] = head.split('\x1f');
    out.push({ sha: sha.trim(), subject, body, files: tail.split('\n').map((l) => l.trim()).filter(Boolean) });
  }
  return out.reverse();
}

// a commit is the row's OWN when its subject leads with the id right after the conventional prefix ("spec(vna): C317 — …");
// a post that names the row in passing ("blog: a post that mentions C20") is a citation, never the birth
export const ownSubject = (subject, id) => new RegExp(`^[a-z]+(?:\\([^)]*\\))?!?:\\s*(?:declare\\s+)?${id}(?![a-z0-9])`).test(String(subject));

// fold commits into the web: row id → {born, commits, built: Map(file → n)}
export function fold(commits, ids, web = new Map()) {
  for (const c of commits) {
    const cited = new Set((`${c.subject}\n${c.body}`.match(ROW_ID) || []).filter((x) => ids.has(x)));
    const files = c.files.filter((f) => !NOISE.test(f) && !SPEC_FILES.test(f));
    // specificity: a commit citing k rows lends each row 1/k of each file — a bulk spec sweep never outweighs the row's own build
    const k = cited.size;
    for (const id of cited) {
      const w = web.get(id) || { born: null, commits: [], built: {} };
      const own = k <= BORN_MAX_CITED && ownSubject(c.subject, id);
      if (!w.born || (!w.born.own && own)) w.born = { sha: c.sha, subject: c.subject.slice(0, 120), files: files.slice(0, TOP_BUILT), own };
      w.commits.push({ sha: c.sha, subject: c.subject.slice(0, 120) });
      for (const f of files) w.built[f] = +((w.built[f] || 0) + 1 / k).toFixed(3);
      web.set(id, w);
    }
  }
  return web;
}

// the files a guard imports (relative imports resolved against the guard's own directory), read at HEAD — never the tree
export function guardImports(guard, { show = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  if (!guard) return [];
  let src = ''; try { src = show(guard); } catch { return []; }
  const out = new Set();
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) out.add(posix.normalize(posix.join(posix.dirname(guard), m[1])));
  return [...out].filter((p) => !p.endsWith('_hermetic.mjs'));
}

export function rowText(id, w, { name, guard, imports }) {
  const built = Object.entries(w ? w.built : {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_BUILT);
  const L = [`${id} — ${name || 'no spoken name (headline has no clause)'}`];
  L.push(`guard: ${guard || 'none named'}`);
  if (imports.length) L.push(`guard imports: ${imports.join(' · ')}`);
  if (!w) { L.push('born: UNMEASURED — no commit cites this row yet'); return L.join('\n') + '\n'; }
  L.push(`born: ${w.born.sha} ${w.born.subject}${w.born.own ? '' : ' (the first commit to cite it; no commit subject leads with it among ≤' + BORN_MAX_CITED + ' rows)'}`);
  if (w.born.files.length) L.push(`born files: ${w.born.files.join(' · ')}`);
  L.push(`built (${w.commits.length} commit${w.commits.length === 1 ? '' : 's'} cite it; file · weight, a commit citing k rows lends 1/k):`);
  for (const [f, n] of built) L.push(`  ${f} · ${n}`);
  L.push(`commits: ${w.commits.slice(-8).map((c) => `${c.sha} ${c.subject}`).join('\n         ')}`);
  return L.join('\n') + '\n';
}

function gitLog(range) {
  const args = ['log', '--format=%x1e%h%x1f%s%x1f%b%x1d', '--name-only', '--no-renames'];
  if (range) args.push(range);
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 30 });
}

export function build({ md, full = false } = {}) {
  const { parseRows, guardOf } = md.__clarity;
  const rows = parseRows(md.text); const ids = new Set(rows.map((r) => r.id));
  mkdirSync(OUT_DIR, { recursive: true });
  const idxPath = resolve(OUT_DIR, 'index.json');
  let idx = null; if (!full && existsSync(idxPath)) { try { idx = JSON.parse(readFileSync(idxPath, 'utf8')); } catch { idx = null; } }
  const head = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const t0 = Date.now();
  const web = new Map(Object.entries(idx ? idx.web : {}));
  const range = idx && idx.head ? `${idx.head}..HEAD` : null;
  fold(parseLog(gitLog(range)), ids, web);
  const names = {}; let withWeb = 0;
  for (const r of rows) {
    const name = spokenName(r.text); names[r.id] = name;
    const guard = guardOf(r.text); const w = web.get(r.id) || null; if (w) withWeb++;
    writeFileSync(resolve(OUT_DIR, `${r.id}.txt`), rowText(r.id, w, { name, guard, imports: guardImports(guard) }));
  }
  const doc = { at: new Date().toISOString(), head, scanned: range || 'full history', ms: Date.now() - t0, rows: rows.length, with_web: withWeb, names, web: Object.fromEntries(web) };
  writeFileSync(idxPath, JSON.stringify(doc));
  return doc;
}

// read side: the spoken names and one row's web, off the cache — never a rebuild
export function loadNames(dir = OUT_DIR) { try { return new Map(Object.entries(JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')).names || {})); } catch { return new Map(); } }
export function webPath(id, dir = OUT_DIR) { const p = resolve(dir, `${id}.txt`); return existsSync(p) ? p : null; }

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const clarity = await import('./spec-clarity.mjs');
  const text = readFileSync(process.env.VNA_SPEC_MD || clarity.SPEC_MD, 'utf8');
  const argv = process.argv.slice(2);
  const show = argv.find((a) => /^C\d+/.test(a));
  if (show && !argv.includes('--build')) { const p = webPath(show); process.stdout.write(p ? readFileSync(p, 'utf8') : `${show}: no web cached — run node scripts/vna/row-web.mjs --build\n`); process.exit(0); }
  const d = build({ md: { text, __clarity: clarity }, full: argv.includes('--full') });
  console.log(`row-web · ${d.rows} rows · ${d.with_web} with a web (${(100 * d.with_web / d.rows).toFixed(0)} %) · scanned ${d.scanned} · ${d.ms} ms · head ${d.head} · ${OUT_DIR.replace(REPO + '/', '')}/`);
}
