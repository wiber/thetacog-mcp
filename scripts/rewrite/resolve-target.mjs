// scripts/rewrite/resolve-target.mjs
// ════════════════════════════════════════════════════════════════════════════
// NATURAL-LANGUAGE TARGET RESOLUTION — the thing that makes
// `/rewrite chapter 8 of the book` work without the writer typing a path.
//
// Deterministic and LLM-free on purpose. Resolving a file path is not a task
// that benefits from a model: it benefits from being instant, predictable, and
// identical every time. A model here would occasionally open chapter 9.
//
// Accepts, in order of specificity:
//   • an explicit path (absolute or repo-relative)
//   • "chapter 8", "ch8", "chapter 08 of the book", "8"
//   • "preface", "introduction", "conclusion", "jacket", "the ship", interludes
//   • a blog slug or post fragment ("countable-precedes-accountable")
//   • any fuzzy fragment of a filename, scored by token overlap
//
// The APERTURE ("start wherever chosen in the chapter") resolves separately:
// a line number, a paragraph index, a percentage, or a quoted phrase to seek to.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

// Directories to offer in the picker. Defaults suit a generic project; a host
// project points REWRITE_DIRS at its own prose homes. The tool edits FILES — it
// was never a book editor, and hardcoding one project's layout is what made it
// look like one.
const DIRS = (process.env.REWRITE_DIRS || 'docs,content,src/content,posts,chapters,books,.')
  .split(',').map((d) => d.trim()).filter(Boolean);
const BLOG_DIR = process.env.REWRITE_BLOG_DIR || 'content';
const SCRATCHPAD_DIR = process.env.REWRITE_SCRATCHPAD_DIR || 'docs';

// This package SHIPS a manuscript: the Tesseract Physics mirror emitted by the
// mother repo's exporter lands at books/tesseract/chapters. Recognizing our own
// cargo is not hardcoding a host project's layout — a fork that clones this
// repo gets "chapter 8" resolution with zero configuration, and REWRITE_CHAPTER_DIR
// still overrides for any other project.
function chapterDir(repoRoot) {
  if (process.env.REWRITE_CHAPTER_DIR) return process.env.REWRITE_CHAPTER_DIR;
  for (const d of ['chapters', 'books/tesseract/chapters']) {
    if (fs.existsSync(path.join(repoRoot, d))) return d;
  }
  return 'chapters';
}

/** Every file the console is willing to open. */
export function listTargets(repoRoot) {
  const chapters = [];
  const CHAPTER_DIR = chapterDir(repoRoot);
  const chDir = path.join(repoRoot, CHAPTER_DIR);
  if (fs.existsSync(chDir)) {
    for (const f of fs.readdirSync(chDir)) {
      if (!f.endsWith('.md')) continue;
      const m = /^chapter-(\d+)/.exec(f);
      chapters.push({
        kind: 'chapter',
        file: path.join(CHAPTER_DIR, f),
        name: f,
        number: m ? parseInt(m[1], 10) : null,
        label: prettyChapter(f, m ? parseInt(m[1], 10) : null),
      });
    }
    chapters.sort((a, b) => {
      if (a.number == null && b.number == null) return a.name.localeCompare(b.name);
      if (a.number == null) return 1;
      if (b.number == null) return -1;
      return a.number - b.number;
    });
  }

  const blog = [];
  const bDir = path.join(repoRoot, BLOG_DIR);
  if (fs.existsSync(bDir)) {
    const files = fs.readdirSync(bDir).filter((f) => f.endsWith('.mdx'));
    // Newest FIRST, and "newest" means the YYYY-MM-DD prefix, not the alphabet.
    // A plain sort().reverse() put all 123 undated legacy slugs ahead of every dated
    // post ('w' > '2'), and the candidate cap below then truncated the list before a
    // single dated post was reachable — so every blog target resolved to a legacy
    // file. Dated posts sort first, by date descending; undated ones follow.
    const dateOf = (f) => (/^(\d{4}-\d{2}-\d{2})-/.exec(f) || [])[1] || '';
    files.sort((a, b) => {
      const da = dateOf(a), db = dateOf(b);
      if (da && db) return db.localeCompare(da);
      if (da) return -1;
      if (db) return 1;
      return a.localeCompare(b);
    });
    for (const f of files.slice(0, 120)) {
      blog.push({ kind: 'blog', file: path.join(BLOG_DIR, f), name: f, label: f.replace(/\.mdx$/, '') });
    }
  }

  const scratch = [];
  const sDir = path.join(repoRoot, SCRATCHPAD_DIR);
  if (fs.existsSync(sDir)) {
    for (const f of fs.readdirSync(sDir)) {
      if (!/\.(md|mdx|txt)$/.test(f)) continue;
      scratch.push({ kind: 'scratchpad', file: path.join(SCRATCHPAD_DIR, f), name: f, label: f });
    }
  }

  // THE GENERIC SWEEP — every prose-bearing file under REWRITE_DIRS.
  //
  // The three lists above are a book project's shape: chapters, posts, scratchpad. A project
  // that has none of them got three empty lists and therefore an unusable picker, which made a
  // FILE editor look like a book editor to everyone who was not editing a book. This sweep is
  // what makes `thetacog-rewrite` work in a repo it has never seen.
  //
  // TSX and JSX are in scope deliberately: prose lives in components, and the chunker strips it
  // to JSX text nodes rather than parsing code as sentences.
  const seen = new Set([...chapters, ...blog, ...scratch].map((t) => t.file));
  const files = [];
  const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.thetacog|target)(\/|$)/;
  const walk = (dir, depth) => {
    if (depth > 4 || files.length > 800) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(repoRoot, abs);
      if (SKIP.test(rel) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (/\.(md|mdx|txt|tsx|jsx)$/.test(e.name) && !seen.has(rel)) {
        seen.add(rel);
        files.push({ kind: 'file', file: rel, name: e.name, label: rel });
      }
    }
  };
  for (const d of DIRS) {
    const abs = path.join(repoRoot, d);
    if (fs.existsSync(abs)) walk(abs, d === '.' ? 3 : 0);
  }
  files.sort((a, b) => a.file.localeCompare(b.file));

  return { chapters, blog, scratchpad: scratch, files };
}

function prettyChapter(filename, number) {
  const title = filename
    .replace(/^chapter-\d+-/, '')
    .replace(/^\d+-/, '')
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return number != null ? `Chapter ${number} — ${title}` : title;
}

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
};

/**
 * Resolve a target expression to an absolute file path.
 * @returns {{ok:true,file:string,label:string,kind:string}|{ok:false,error:string,suggestions:Array}}
 */
export function resolveTarget(expr, repoRoot) {
  const raw = String(expr || '').trim();
  if (!raw) return { ok: false, error: 'no target given', suggestions: quickList(repoRoot) };

  // 1. Explicit path wins outright.
  const asAbs = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
  if (fs.existsSync(asAbs) && fs.statSync(asAbs).isFile()) {
    return { ok: true, file: path.resolve(asAbs), label: path.basename(asAbs), kind: 'path' };
  }

  const targets = listTargets(repoRoot);
  // Fuzzy matching searches the generic sweep too, LAST — so a project's own chapters and posts
  // still win a tie, but a repo with neither is still resolvable by fragment.
  const all = [...targets.chapters, ...targets.blog, ...targets.scratchpad, ...(targets.files || [])];
  const q = raw.toLowerCase();

  // 2. Chapter by number — the common case.
  //    "chapter 8", "ch 8", "ch8", "chapter eight", or a bare number.
  let chapterNum = null;
  const numMatch = /(?:^|\b)(?:chapter|chap|ch\.?)\s*0*(\d{1,2})\b/.exec(q);
  if (numMatch) chapterNum = parseInt(numMatch[1], 10);
  if (chapterNum == null) {
    const wordMatch = /(?:^|\b)(?:chapter|chap|ch\.?)\s+([a-z]+)/.exec(q);
    if (wordMatch && wordMatch[1] in WORD_NUMBERS) chapterNum = WORD_NUMBERS[wordMatch[1]];
  }
  if (chapterNum == null && /^0*\d{1,2}$/.test(q)) chapterNum = parseInt(q, 10);

  if (chapterNum != null) {
    const hit = targets.chapters.find((c) => c.number === chapterNum);
    if (hit) return { ok: true, file: path.join(repoRoot, hit.file), label: hit.label, kind: 'chapter' };
    return {
      ok: false,
      error: `no chapter ${chapterNum} found`,
      suggestions: targets.chapters.map((c) => ({ label: c.label, target: `chapter ${c.number}` })),
    };
  }

  // 3. Named sections.
  const named = [
    [/\bpreface\b/, '00-preface.md'],
    [/\bjacket\b/, '00-jacket.md'],
    [/\bthe ship\b|\bship\b/, '00-the-ship.md'],
    [/\brazor'?s? edge\b/, 'chapter-00-the-razors-edge.md'],
    [/\bconclusion\b/, 'conclusion.md'],
    [/\bauthor\b/, '99-about-the-author.md'],
    [/\boffer\b/, '09-about-the-offer.md'],
    [/\bstraylight\b/, 'interlude-straylight-warning.md'],
    [/\bartisan\b|\btable at\b/, 'interlude-the-table-at-artisan.md'],
  ];
  for (const [re, fname] of named) {
    if (re.test(q)) {
      const p = path.join(repoRoot, chapterDir(repoRoot), fname);
      if (fs.existsSync(p)) return { ok: true, file: p, label: prettyChapter(fname, null), kind: 'chapter' };
    }
  }

  // 4. Fuzzy match on filename tokens.
  const stop = new Set(['the', 'of', 'a', 'in', 'to', 'book', 'chapter', 'post', 'blog', 'rewrite', 'and', 'for', 'my']);
  const qTokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !stop.has(t));
  if (qTokens.length) {
    const scored = all.map((t) => {
      const hay = `${t.name} ${t.label}`.toLowerCase();
      let score = 0;
      for (const tok of qTokens) if (hay.includes(tok)) score += tok.length;
      if (hay.includes(q)) score += 50;
      return { t, score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

    if (scored.length && scored[0].score >= 4) {
      const t = scored[0].t;
      return { ok: true, file: path.join(repoRoot, t.file), label: t.label, kind: t.kind };
    }
    if (scored.length) {
      return {
        ok: false,
        error: `"${raw}" is ambiguous`,
        suggestions: scored.slice(0, 8).map((s) => ({ label: s.t.label, target: s.t.file })),
      };
    }
  }

  return { ok: false, error: `could not resolve "${raw}"`, suggestions: quickList(repoRoot) };
}

/**
 * EXACT-BASENAME SEARCH — the OS file dialog's resolution path.
 *
 * `resolveTarget` is built for natural-language aliases ("chapter 8"), and its
 * fuzzy matcher only knows the curated target list. Handed a real filename from a
 * file dialog it does the wrong thing twice over: `page.tsx` fuzzy-matched to a
 * blog post called "the-page-that-paints-itself", and `COMPLETE-BOOK.txt` — which
 * genuinely exists — failed as "ambiguous" because it was not in the list at all.
 *
 * A filename is not an alias. It is an exact string, so match it exactly, over the
 * whole repo. Several files share a basename (`page.tsx` many times over), so
 * ambiguity is REPORTED with the candidates rather than resolved by guessing —
 * silently opening one of eleven `page.tsx` files is worse than asking.
 */
const SEARCH_SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo', 'coverage', '.thetacog']);
const SEARCH_EXT = /\.(md|mdx|txt|tsx|ts|jsx|js|html?|json)$/i;

export function findByFilename(name, repoRoot, { limit = 40 } = {}) {
  const want = path.basename(String(name || '').trim());
  if (!want) return { ok: false, error: 'no filename given', matches: [] };

  const matches = [];
  const walk = (dir, depth) => {
    if (depth > 8 || matches.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (matches.length >= limit) return;
      if (e.name.startsWith('.') && e.name !== '.claude') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SEARCH_SKIP.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.name === want && SEARCH_EXT.test(e.name)) {
        matches.push(full);
      }
    }
  };
  walk(repoRoot, 0);

  if (!matches.length) return { ok: false, error: `no file named "${want}" in this repo`, matches: [] };
  if (matches.length === 1) {
    return { ok: true, file: matches[0], label: path.relative(repoRoot, matches[0]), kind: 'file' };
  }
  // Prefer prose homes when a basename is genuinely common, but still report the rest.
  const ranked = matches.sort((a, b) => score(b) - score(a));
  return {
    ok: false,
    ambiguous: true,
    error: `${matches.length} files named "${want}" — pick one`,
    matches: ranked.map((m) => path.relative(repoRoot, m)),
  };

  function score(f) {
    const r = path.relative(repoRoot, f);
    let s = 0;
    if (r.startsWith('books/')) s += 5;
    if (r.startsWith('src/content/')) s += 4;
    if (r.startsWith('docs/')) s += 3;
    s -= r.split(path.sep).length * 0.1;   // shallower wins ties
    return s;
  }
}

function quickList(repoRoot) {
  const t = listTargets(repoRoot);
  return t.chapters.map((c) => ({ label: c.label, target: c.number != null ? `chapter ${c.number}` : c.file }));
}

/**
 * THE APERTURE — where in the file to start.
 * Accepts: {line:N} | {paragraph:N} | {percent:N} | {phrase:"..."} | "L120" | "45%" | "some phrase"
 * Returns a paragraph index, clamped in range. Unresolvable → 0 (the top),
 * because starting at the beginning is always a defensible default.
 */
export function apertureFor(paragraphs, startAt) {
  if (!paragraphs?.length || startAt == null) return 0;

  const clamp = (i) => Math.max(0, Math.min(paragraphs.length - 1, i));

  if (typeof startAt === 'number') return clamp(startAt);

  if (typeof startAt === 'object') {
    if (typeof startAt.paragraph === 'number') return clamp(startAt.paragraph);
    if (typeof startAt.line === 'number') return byLine(paragraphs, startAt.line);
    if (typeof startAt.percent === 'number') return clamp(Math.floor(paragraphs.length * startAt.percent / 100));
    if (startAt.phrase) return byPhrase(paragraphs, startAt.phrase);
    return 0;
  }

  const s = String(startAt).trim();
  if (!s) return 0;

  let m = /^L?(\d+)$/i.exec(s);
  if (m) return byLine(paragraphs, parseInt(m[1], 10));

  m = /^(?:line\s*)(\d+)$/i.exec(s);
  if (m) return byLine(paragraphs, parseInt(m[1], 10));

  m = /^(?:para(?:graph)?\s*)(\d+)$/i.exec(s);
  if (m) return clamp(parseInt(m[1], 10));

  m = /^(\d{1,3})\s*%$/.exec(s);
  if (m) return clamp(Math.floor(paragraphs.length * parseInt(m[1], 10) / 100));

  return byPhrase(paragraphs, s);
}

function byLine(paragraphs, line) {
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].endLine >= line) return i;
  }
  return paragraphs.length - 1;
}

function byPhrase(paragraphs, phrase) {
  const needle = String(phrase).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!needle) return 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].text.toLowerCase().replace(/\s+/g, ' ').includes(needle)) return i;
  }
  // Fall back to best token overlap so a half-remembered phrase still lands close.
  const toks = needle.split(' ').filter((t) => t.length > 3);
  if (!toks.length) return 0;
  let best = 0, bestScore = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const hay = paragraphs[i].text.toLowerCase();
    let score = 0;
    for (const t of toks) if (hay.includes(t)) score++;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore > 0 ? best : 0;
}
