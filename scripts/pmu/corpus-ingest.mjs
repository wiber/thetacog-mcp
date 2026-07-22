import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ncd } from '../../src/app/pmu-simulator/cell-compress.mjs';

const CACHE_DIR_REL = 'data/pmu/pipeline/cache';
// ABSOLUTE cache location (2026-07-04): keyed to the MODULE, not the caller's CWD. A subprocess with a
// wrong CWD used to write the fixed-name cache (reality-corpus.json) under a relative `root`, scattering
// it into a stray `<sha>/data/pmu/...` dir and corrupting the shared read. The cache is ALWAYS this one
// absolute path regardless of the corpus `root` argument.
const CACHE_DIR_ABS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', CACHE_DIR_REL);
// Bump when claimify/salienceRank logic changes — folded into the cache key so a
// logic change busts the warm cache (it is keyed on file manifest, not on code).
// v3-denoise (2026-05-29): isSemantic() filter — salienceRank's NCD-distinctness
// was selecting semantically-EMPTY noise (SVG path data, box-drawing art, emoji
// JSX, hex colours) over meaning. Measured: built corpora were only ~31-33%
// signal, so the 144-anchor projection gripped mostly on decoration. The filter
// drops noise at the source so the representative set is meaning, not texture.
// v4-prose (2026-06-05): isSemantic only denoises DECORATION; ordinary CODE lines
// (`let KEY = process.env.X`, `return readdirSync(DIR)`) clear all four bars, so
// the reality corpus (src/ + scripts/) was ~81% code-as-claim — SimHash gripped
// identifier soup onto semantic anchors. classifyClaim (function-word density vs
// identifier-soup) is the prose-vs-code gate; chaining it into salienceRank means
// a tile only lights when a real CLAIM intersects it. On a densely-commented code
// reality this keeps the comments/docstrings (the "prose reality") and drops the
// raw source lines. Measured by scripts/pmu/projection-coverage.mjs.
// v5-codegate (2026-06-05): classifyClaim alone is BLIND to code — `if/for/const/
// of/in` are English function words, so `if (f.kind === 'cloud')` scores as prose
// and survived v4 (the projection-coverage junkPct=0 was tautological: the gate
// and the scorer were the same function). looksLikeCodeSyntax is the OBJECTIVE,
// scorer-independent rejector wired into claimify, so the reality corpus keeps
// only the PROSE inside code files (comments/docstrings), not executable lines.
// v6-codegate (2026-06-05): v5 caught statement-form code but leaked object-
// literal property lines (`fontSize: 8, color: …,`), string-array continuations
// (`'about','into',`) and shell `echo "…$VAR"` — all sharing a trailing `,`/`:`,
// a `$VAR`, or a command lead. Added those signals; measured 78.5%→ target >85%
// prose on the reality lattice by INSPECTION (junkPct is scorer-blind to code).
const INGEST_VERSION = 'atomic-claims-v6-codegate';

const INTENT_DIRS = ['docs', 'scripts/gdd/goals'];
const REALITY_DIRS = ['src', 'scripts', '.thetacog/pmu/src'];
const IGNORE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.zip', '.tar', '.gz', '.json', '.map', '.ico'];
const IGNORE_DIRS = [
  'node_modules', '.git', '.next', '.vercel', 'dist', 'build', 'coverage', '.cache', 'archive',
  'reports', '3d-models', 'transcripts', 'archive'
];
const MAX_FILE_SIZE = 100 * 1024;
const MAX_CORPUS_SIZE = 2 * 1024 * 1024; 

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry.toLowerCase())) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, files);
    } else {
      if (!IGNORE_EXTS.includes(extname(entry).toLowerCase()) && s.size < MAX_FILE_SIZE) {
        files.push(full);
      }
    }
  }
  return files;
}

// claimify — shatter a corpus into ATOMIC claims (one sentence or one code line)
// rather than whole paragraphs. The coarse paragraph split fed SimHash 2-4KB
// blocks, so every block matched many anchors at once → the per-anchor fragment
// assignment collapsed (witness_agree ~6/144, the "Dual Mass hover lies" bug).
// Atomic claims let SimHash match an anchor to a single surgical line, so the
// 3-panel hover shows the exact spec sentence / code line that embodies each
// ShortLex coordinate.
const MIN_CLAIM = 20;
const MAX_CLAIM = 400; // drop giant blocks — they re-introduce the degeneracy

// isSemantic — the denoise gate. salienceRank ranks by NCD-distinctness, which
// structurally PREFERS unusual byte sequences (SVG paths, Unicode box-drawing
// art, emoji JSX spans, hex colours) — i.e. exactly the decoration that carries
// no meaning. A claim must clear all four bars to count as content:
//   1. no box-drawing / block glyphs (ASCII-art separators from the HTML docs)
//   2. no SVG path data (<path>, d="M…")
//   3. ≥45% of chars are letters (rejects symbol/number/markup-dense lines)
//   4. ≥4 real words (rejects single-tag JSX deco and bare attribute fragments)
// Tuned against the live 2026-05-29 reality/intent caches: drops the measured
// ~67% noise while keeping prose AND meaningful multi-token code lines.
const BOXART = /[│┌┐└┘├┤┬┴┼─═╔╗╚╝╠╣╦╩╬╤╧╪▀▄█▌▐░▒▓╭╮╯╰▔▕▏◀▶➤]/u;
export function isSemantic(c) {
  if (!c) return false;
  if (BOXART.test(c)) return false;
  if (/<path[\s>]|<svg|\bd="M[\d.\- ]/.test(c)) return false;
  // Measure density/word-count on the TAG-STRIPPED payload so markup scaffolding
  // can't fake the bar: `<span className="text-2xl">🛠️</span>` strips to "🛠️"
  // (dropped), while `<p>Two witnesses must agree</p>` strips to its sentence
  // (kept). Code with `<`-as-less-than is untouched (the regex needs a closing >).
  const t = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters / t.length < 0.45) return false;
  const words = (t.match(/[A-Za-z][A-Za-z'-]{2,}/g) || []).length;
  if (words < 4) return false;
  return true;
}

// classifyClaim — the PROSE-vs-CODE gate, a sibling of isSemantic. isSemantic
// rejects decoration (SVG/box-art); classifyClaim rejects code/identifier soup
// that clears the decoration bar. A load-bearing CLAIM is dense with the
// connective tissue of a sentence (function words) and is not dominated by
// camelCase / kebab / CSS-utility identifiers. Used by salienceRank (the ingest
// gate) and by the diagnostic scripts (ingest-quality / projection-coverage /
// tile-coverage), which re-export it from ingest-quality.mjs.
const FUNCTION_WORDS = new Set((
  'the a an is are was were be been being to of in on for with that this it as by from ' +
  'must not no every each who which what when where why how and or but if so because ' +
  'we you they he she i our your their its has have had do does did can could will would ' +
  'at into onto than then there here more most less least only just over under between'
).split(' '));
const CSS_UTIL = /^(text|bg|flex|grid|gap|mb|mt|mx|my|ml|mr|px|py|pt|pb|pl|pr|p|m|w|h|items|justify|self|font|rounded|border|shadow|space|leading|tracking|max|min|top|left|right|bottom|z|opacity|hover|sm|md|lg|xl)-/;
const isCamel = w => /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(w);
const isKebab = w => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(w);
const claimTokens = s => (String(s).toLowerCase().match(/[a-z][a-z'-]*[a-z]|[a-z]/g) || []);

export function classifyClaim(c) {
  const toks = claimTokens(c);
  if (toks.length === 0) return { verdict: 'suspect', functionWordRatio: 0, soupRatio: 1 };
  const fw = toks.filter(t => FUNCTION_WORDS.has(t)).length / toks.length;
  // identifier soup measured on the ORIGINAL casing tokens (camelCase needs caps)
  const raw = String(c).match(/[A-Za-z][A-Za-z0-9'-]+/g) || [];
  const soup = raw.length ? raw.filter(w => isCamel(w) || isKebab(w) || CSS_UTIL.test(w.toLowerCase())).length / raw.length : 1;
  // A claim is load-bearing if it has the connective density of a sentence and is
  // not dominated by identifier/class tokens.
  const meaning = fw >= 0.12 && soup < 0.5;
  return { verdict: meaning ? 'meaning' : 'suspect', functionWordRatio: +fw.toFixed(3), soupRatio: +soup.toFixed(3) };
}

// looksLikeCodeSyntax — the OBJECTIVE code detector, independent of classifyClaim.
// classifyClaim's function-word heuristic is blind to code because `if/for/const/
// let/of/in` are English function words, so a line like `if (f.kind === 'cloud')`
// reads as prose (fw 0.2, soup 0). This rejects a line that carries unambiguous
// executable syntax, so the reality corpus (src/ + scripts/) keeps only its PROSE
// (comments / docstrings / sentence strings), not its source lines. Conservative
// by design: it fires on strong signals only, so it won't eat prose that merely
// starts with "If" or contains a colon.
const CODE_DECL_LEAD = /^\s*(?:export\s+|public\s+|private\s+|protected\s+|async\s+|pub\s+|static\s+)?(?:const|let|var|function|fn|impl|struct|enum|trait|class|def|func|interface|type|import|require|package|module|namespace)\b/;
const CODE_CTRL_LEAD = /^\s*(?:if|for|while|switch|catch|elif|fi|then|do|done|esac|case|else)\b\s*[({[]|^\s*(?:elif|fi|then|done|esac|fi)\b/;
// Shell / command leads — `echo "..."`, `printf`, `cat`, `grep`, piped utilities.
const CODE_CMD_LEAD = /^\s*(?:echo|printf|cat|grep|sed|awk|chmod|mkdir|jq|curl|node|npm|npx|git)\b/;
// Trailing `,` or `:` = an object-literal property / array continuation / label
// line (prose claims are sentence-split on .!? so they don't end this way);
// `$VAR` = a shell/template variable; quoted-string-comma = a string-array line.
const CODE_SIGNALS = /=>|===|!==|&&|\|\||;\s*$|[{}]\s*$|,\s*$|:\s*$|^\s*[}\])]|\$\{|\$\(|\$[A-Za-z_]\w*|>&|\bexit\s+\d|::|\bprocess\.env\b|\)\s*\{|\b\w+\s*=\s*[^=]|2>&1|(['"])[^'"]{0,40}\1\s*,|\bconsole\.(?:log|error|warn)\b|\b(?:readFileSync|writeFileSync|readdirSync|querySelector|addEventListener)\b/;
export function looksLikeCodeSyntax(c) {
  const s = String(c).trim();
  if (!s) return false;
  if (CODE_DECL_LEAD.test(s)) return true;
  if (CODE_CTRL_LEAD.test(s)) return true;
  if (CODE_CMD_LEAD.test(s)) return true;
  if (CODE_SIGNALS.test(s)) return true;
  // Punctuation density: source is dense with bracket/operator/terminator glyphs;
  // ordinary prose is not. 10% is conservative (a sentence with one colon and a
  // pair of parens stays well under it).
  const punct = (s.match(/[(){}\[\];=<>|&/\\]/g) || []).length;
  if (punct / s.length > 0.10) return true;
  return false;
}

export function claimify(text) {
  const blocks = String(text ?? '').split(/\n\s*\n/);
  const claims = [];
  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;
    // Code-ish blocks split per line; prose splits per sentence.
    const looksCode = /[{};=]|=>|^\s{2,}\S|^\s*(function|const|let|fn|impl|pub|class|import|export)\b/m.test(b);
    const parts = looksCode
      ? b.split('\n')
      : b.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z(`"#-])/);
    for (const part of parts) {
      const c = part.replace(/\s+/g, ' ').trim();
      if (c.length >= MIN_CLAIM && c.length <= MAX_CLAIM && isSemantic(c) && !looksLikeCodeSyntax(c)) claims.push(c);
    }
  }
  return claims;
}

// salienceRank — pick the most-distinct atomic claims as the corpus's compact
// representative set. The cap is now high enough (default 240) that 144 anchors
// can each land a distinct fragment; with atomic claims the SimHash/NCD work
// stays cheap on the Rust side.
export function salienceRank(claims, limit = 240) {
  // Defense-in-depth: drop noise here too, so a direct caller (or a future
  // claimify variant) can't reintroduce the NCD-prefers-decoration degeneracy.
  // isSemantic kills decoration; classifyClaim kills code/identifier soup that
  // clears the decoration bar — together they leave only meaning-bearing CLAIMS,
  // so the 144-anchor projection grips prose (incl. code comments/docstrings),
  // not raw source lines. This is the v4-prose fix for the 81%-junk reality.
  claims = claims.filter(c => isSemantic(c) && classifyClaim(c).verdict === 'meaning');
  // Dedupe exact repeats first — atomic claims repeat heavily (comment markers,
  // boilerplate code lines). This alone collapses thousands → hundreds.
  const seen = new Set();
  const uniq = [];
  for (const c of claims) { if (!seen.has(c)) { seen.add(c); uniq.push(c); } }
  if (uniq.length <= limit) return uniq;

  // Score every unique claim against ONE fixed reference sample (computed once)
  // — O(n) gzips, not the old O(n²) per-claim-sample rebuild that cost ~12s.
  // No striding: striding threw away the diversity that makes per-anchor
  // fragment assignment distinct. Only a pathological corpus (>6000 unique
  // atomic claims) falls back to a strided pool to bound the gzip count.
  let pool = uniq;
  const HARD_CAP = 6000;
  if (uniq.length > HARD_CAP) {
    const stride = uniq.length / HARD_CAP;
    pool = Array.from({ length: HARD_CAP }, (_, i) => uniq[Math.floor(i * stride)]);
  }
  const sample = pool.slice(0, 10).join(' '); // fixed reference, computed once
  const scored = pool.map(c => ({ c, salience: sample ? ncd(c, sample) : 1 }));
  scored.sort((a, b) => b.salience - a.salience);
  return scored.slice(0, limit).map(s => s.c);
}

// manifestHash — a content-fingerprint of a file set from (path, mtime, size)
// alone. No reads — pure stat. If the fingerprint is unchanged since the last
// build, the corpus is byte-identical, so we can skip the ~2.6s of disk reads +
// gzip salience-ranking entirely. This is the resolve-stage warm cache.
function manifestHash(files) {
  const h = createHash('sha256');
  h.update(`ingest:${INGEST_VERSION}\n`); // logic version → bump busts the cache
  // TOUCH-STABLE KEY (2026-07-04): path + SIZE only — NOT mtimeMs. mtime churns every time a background
  // job touches a file, which busted the cache on every render and forced a mtime-ordered rebuild →
  // a different corpus each time → non-deterministic lit → empty tolerance panels. Size+path is stable
  // across touches; a genuine content change almost always changes size, and INGEST_VERSION busts the
  // rest. Matches the ingestWide deterministic spec. Guard: tests/pmu-simulator/corpus-ingest-deterministic.test.mjs.
  for (const f of [...files].sort()) {
    const st = statSync(f);
    h.update(`${f}:${st.size}\n`);
  }
  return h.digest('hex');
}

// buildMass — assemble a salience-ranked corpus from `dirs`, memoised on the
// file-manifest hash. Returns { text, cached, files, ms } so the pipeline can
// show whether resolve hit the cache (the difference between a ~2.6s cold run
// and a sub-100ms warm one). On a real commit the manifest changes and we
// rebuild that side; partial reruns (walk-only, xor-only) skip resolve entirely.
function buildMass(root, dirs, cacheName, keep = () => true) {
  const t0 = performance.now();
  let files = [];
  for (const dir of dirs) files = walk(join(root, dir), files);
  files = files.filter(keep);

  const hash = manifestHash(files);
  const cacheDir = CACHE_DIR_ABS;                          // absolute — never scattered by a wrong CWD
  const cachePath = join(cacheDir, `${cacheName}.json`);

  if (existsSync(cachePath)) {
    try {
      const c = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (c.manifest_hash === hash) {
        return { text: c.corpus, cached: true, files: files.length, ms: Math.round(performance.now() - t0) };
      }
    } catch { /* corrupt cache → rebuild */ }
  }

  let allText = '';
  // DETERMINISTIC ORDER (2026-07-04): PATH order, not mtime. Same bytes ⇒ same corpus on any machine,
  // regardless of touch times (the ingestWide spec). mtime-order made the MAX_CORPUS_SIZE truncation
  // pick a different file set every render → the reality-corpus non-determinism / empty panels.
  const sorted = [...files].sort();
  for (const f of sorted) {
    if (allText.length > MAX_CORPUS_SIZE) break;
    try { allText += readFileSync(f, 'utf8') + '\n\n'; } catch { /* unreadable → skip */ }
  }
  const corpus = salienceRank(claimify(allText)).join('\n\n');

  // ATOMIC write (tmp + rename) so a concurrent reader never sees a half-written cache — the fixed-name
  // shared file is safe under concurrent renders once the swap is atomic. `built_at` is metadata only,
  // NOT in the cache key, so it never affects determinism.
  mkdirSync(cacheDir, { recursive: true });
  const tmp = join(cacheDir, `${cacheName}.${process.pid}.${createHash('sha1').update(hash).digest('hex').slice(0, 8)}.tmp`);
  writeFileSync(tmp, JSON.stringify({ manifest_hash: hash, corpus, files: files.length, built_at: new Date().toISOString() }));
  renameSync(tmp, cachePath);
  return { text: corpus, cached: false, files: files.length, ms: Math.round(performance.now() - t0) };
}

// ── WIDE CORPUS — corpus mode 'wide' (wide-v1, 2026-06-11) ─────────────────────
// The seed loop proved its ceiling on the 480-claim mass: redistribution of the EXISTING
// claims got the probe 4→5/12 with inversions down, and the double (8/12) was provably
// unreachable without NEW material (run logs data/pmu/reef-self-loop/2026-06-12*.json).
// The named bottleneck is corpus BREADTH (B3 territory = 24 claims; uniqFirst 12→144
// roadmap). ingestWide mines MORE of the repo deterministically into ONE salience-ranked
// claim mass with a larger cap:
//   · docs/** + scripts/gdd/goals (md/mdx/txt/html; html tag-stripped)
//   · root README-class *.md files
//   · books/tesseract/{chapters,appendices} chapter prose
//   · src/content/blog/*.mdx prose
//   · scripts/** comment payloads (commentProse — the cheap semantic-of-code: comments and
//     docstrings ARE the prose reality; raw source lines stay banned by looksLikeCodeSyntax)
// DETERMINISTIC: files read in PATH order (not mtime — same bytes ⇒ same corpus on any
// machine, regardless of touch times); the cache is keyed on a sha256 of the PROCESSED text
// (a content sha, not a stat manifest). The intent/reality caches are untouched — wide is a
// separate mass with its own cache file; the 480-claim pipeline corpus stays bit-identical.
export const WIDE_CLAIM_CAP = 2000;
export const WIDE_VERSION = 'wide-v1';
const WIDE_MAX_TEXT = 8 * 1024 * 1024;
const WIDE_DOC_DIRS = ['docs', 'scripts/gdd/goals', 'books/tesseract/chapters', 'books/tesseract/appendices', 'src/content/blog'];
const WIDE_CODE_DIRS = ['scripts'];
const WIDE_DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.html']);
const WIDE_CODE_EXTS = new Set(['.mjs', '.js', '.ts', '.tsx']);
const WIDE_SHELL_EXTS = new Set(['.sh', '.bash']);

const stripHtmlTags = (c) => String(c)
  .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');

// commentProse — the cheap "semantic of code": pull ONLY the comment payloads out of a source
// file (`//` lines + `/* */` blocks for the JS family; `#` lines for shell, shebang excluded).
// Consecutive comment lines stay one block (\n inside, \n\n between blocks) so claimify
// sentence-splits them as prose. Raw source lines never enter — looksLikeCodeSyntax stays the
// objective, scorer-independent rejector for anything code-shaped that leaks through.
export function commentProse(text, ext) {
  const out = [];
  const push = (block) => { const b = block.join('\n').trim(); if (b) out.push(b); };
  const src = String(text || '');
  if (WIDE_CODE_EXTS.has(ext)) {
    for (const m of src.match(/\/\*[\s\S]*?\*\//g) || []) {
      push(m.replace(/^\/\*+|\*+\/$/g, '').split('\n').map((l) => l.replace(/^\s*\*?\s?/, '')));
    }
    let block = [];
    for (const line of src.split('\n')) {
      const m = line.match(/^\s*\/\/\s?(.*)$/);
      if (m) block.push(m[1]);
      else if (block.length) { push(block); block = []; }
    }
    push(block);
  } else if (WIDE_SHELL_EXTS.has(ext)) {
    let block = [];
    for (const line of src.split('\n')) {
      const m = line.match(/^\s*#\s?(.*)$/);
      if (m && !m[1].startsWith('!')) block.push(m[1]);
      else if (block.length) { push(block); block = []; }
    }
    push(block);
  }
  return out.join('\n\n');
}

// ingestWide — the wide claim mass. Returns { claims, text, cached, files, contentSha, ms }.
// claims = salienceRank(claimify(processed text), WIDE_CLAIM_CAP) — same gates as the base
// corpus (isSemantic · classifyClaim · looksLikeCodeSyntax), just a larger cap over more repo.
export function ingestWide(root = '.') {
  const t0 = performance.now();
  let docFiles = [];
  for (const dir of WIDE_DOC_DIRS) docFiles = walk(join(root, dir), docFiles);
  let codeFiles = [];
  for (const dir of WIDE_CODE_DIRS) codeFiles = walk(join(root, dir), codeFiles);
  // root README-class *.md (top level only — CLAUDE.md, README.md, research notes)
  let rootDocs = [];
  try {
    rootDocs = readdirSync(root)
      .filter((f) => extname(f).toLowerCase() === '.md')
      .map((f) => join(root, f))
      .filter((f) => { try { return statSync(f).size < MAX_FILE_SIZE; } catch { return false; } });
  } catch { /* unreadable root → no root docs */ }

  const seen = new Set();
  const entries = [];
  const add = (f, kind) => { if (!seen.has(f)) { seen.add(f); entries.push({ f, kind }); } };
  for (const f of [...docFiles, ...rootDocs]) {
    const e = extname(f).toLowerCase();
    if (WIDE_DOC_EXTS.has(e)) add(f, e === '.html' ? 'html' : 'doc');
  }
  for (const f of codeFiles) {
    const e = extname(f).toLowerCase();
    if (WIDE_CODE_EXTS.has(e) || WIDE_SHELL_EXTS.has(e)) add(f, 'code');
  }
  entries.sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));   // PATH order — machine-stable

  let text = '';
  for (const e of entries) {
    if (text.length > WIDE_MAX_TEXT) break;
    let t;
    try { t = readFileSync(e.f, 'utf8'); } catch { continue; }
    if (e.kind === 'html') t = stripHtmlTags(t);
    else if (e.kind === 'code') t = commentProse(t, extname(e.f).toLowerCase());
    if (t && t.trim()) text += t + '\n\n';
  }

  const contentSha = createHash('sha256')
    .update(`${INGEST_VERSION}:${WIDE_VERSION}:${WIDE_CLAIM_CAP}\n`)
    .update(text)
    .digest('hex');
  const cacheDir = join(root, CACHE_DIR_REL);
  const cachePath = join(cacheDir, 'wide-corpus.json');
  if (existsSync(cachePath)) {
    try {
      const c = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (c.content_sha === contentSha) {
        return { claims: c.claims, text: c.claims.join('\n\n'), cached: true, files: entries.length, contentSha, ms: Math.round(performance.now() - t0) };
      }
    } catch { /* corrupt cache → rebuild */ }
  }
  const claims = salienceRank(claimify(text), WIDE_CLAIM_CAP);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ content_sha: contentSha, claims, files: entries.length, built_at: new Date().toISOString() }));
  return { claims, text: claims.join('\n\n'), cached: false, files: entries.length, contentSha, ms: Math.round(performance.now() - t0) };
}

// [INTENT: A,A.Strategy.Substrate] Secure the epistemic bedrock of the project's intent.
// [REALITY: ingestIntent] Crawls markdown and text docs to build the strategic promise mass.
// Returns { text, cached, files, ms } — see buildMass.
export function ingestIntent(root = '.') {
  return buildMass(root, INTENT_DIRS, 'intent-corpus');
}

// [INTENT: C1.Operations.Grid] Ground the system in the unmediated contact with implementation code.
// [REALITY: ingestReality] Recursively ingests source code (mjs, rs, etc.) as the physical implementation mass.
// Returns { text, cached, files, ms } — see buildMass.
export function ingestReality(root = '.') {
  return buildMass(root, REALITY_DIRS, 'reality-corpus', f => !f.includes('snippet-library'));
}
