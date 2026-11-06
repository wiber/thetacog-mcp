// scripts/rewrite/chunker.mjs
// ════════════════════════════════════════════════════════════════════════════
// PROSE EXTRACTION WITH EXACT SOURCE OFFSETS.
//
// The Ghost-Read Matrix rewrites sentences IN PLACE in the real file and fires
// one git commit per change. That makes offset fidelity the whole ballgame: a
// paragraph is useless to us unless we can point at the exact byte range it
// came from. So this module never "cleans" text into a detached string — every
// paragraph and every sentence carries {start,end} character offsets into the
// ORIGINAL raw source, plus the 1-based line range for the right-margin heatmap.
//
// Write-back is therefore a pure splice: raw.slice(0,s) + newText + raw.slice(e).
// No re-serialization, no formatter, nothing that could touch an untargeted line.
//
// Skipped (not prose the reader reads): frontmatter, imports/exports, code
// fences, JSX/HTML blocks, headings, list scaffolding, tables, blockquote
// markers, MDX component calls, and horizontal rules.
// ════════════════════════════════════════════════════════════════════════════

/** Build a line-index so any char offset → 1-based line number in O(log n). */
function lineIndex(raw) {
  const starts = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/**
 * Regions of the raw source that are NOT prose. Returns sorted [start,end) pairs.
 * We mask rather than delete so offsets stay true to the original.
 */
function maskedRegions(raw) {
  const out = [];
  const push = (s, e) => { if (e > s) out.push([s, e]); };

  // YAML frontmatter (only when it opens the file)
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (fm && fm.index === 0) push(0, fm[0].length);

  // Fenced code blocks ``` or ~~~ (including unterminated trailing fence)
  for (const m of raw.matchAll(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[^\n]*(?:\n|$)|$)/gm)) {
    push(m.index, m.index + m[0].length);
  }

  // Indented code blocks (4+ spaces) — only when the whole line is code-ish
  for (const m of raw.matchAll(/^(?: {4}|\t)[^\n]*(?:\n(?: {4}|\t)[^\n]*)*/gm)) {
    push(m.index, m.index + m[0].length);
  }

  // import / export statements (MDX + TSX)
  for (const m of raw.matchAll(/^[ \t]*(?:import|export)\s[^\n]*(?:\n[ \t]+[^\n]*)*/gm)) {
    push(m.index, m.index + m[0].length);
  }

  // ATX headings
  for (const m of raw.matchAll(/^[ \t]*#{1,6}[ \t][^\n]*/gm)) push(m.index, m.index + m[0].length);

  // Setext heading underlines and horizontal rules
  for (const m of raw.matchAll(/^[ \t]*(?:={3,}|-{3,}|\*{3,}|_{3,})[ \t]*$/gm)) {
    push(m.index, m.index + m[0].length);
  }

  // HTML/JSX comments
  for (const m of raw.matchAll(/<!--[\s\S]*?-->/g)) push(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/\{\/\*[\s\S]*?\*\/\}/g)) push(m.index, m.index + m[0].length);

  // JSX/HTML blocks that START a line — a component call or tag island.
  // Balanced-ish: consume until the matching close tag or a blank line for
  // self-closing / single-tag islands.
  for (const m of raw.matchAll(/^[ \t]*<([A-Za-z][\w.-]*)((?:[^\n>"']|"[^"]*"|'[^']*')*)(\/?)>/gm)) {
    // Self-closing is read off the matched TEXT, not off group 3. The attribute class
    // `[^\n>"']` contains `/`, so the greedy attr capture swallows the closing slash of
    // `<MCPHeraldicCrest size={48} variant="coaching" />` and group 3 matches empty —
    // the tag then reads as a block open, no `</MCPHeraldicCrest>` ever appears, and the
    // mask runs to end of file. On a cook post that ate every course body: 45 prose
    // paragraphs parsed as 3. Guard: tests/rewrite/chunker-selfclosing-jsx.test.mjs.
    const tag = m[1], selfClose = /\/\s*>$/.test(m[0]);
    const startsLine = m.index;
    if (selfClose) { push(startsLine, m.index + m[0].length); continue; }
    // Block-level HTML/MDX component: swallow through its closing tag.
    const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`, 'g');
    closeRe.lastIndex = m.index + m[0].length;
    const close = closeRe.exec(raw);
    // Uppercase = MDX component (mask wholly). Lowercase inline tags like <p>/<em>
    // inside a paragraph are handled by the inline stripper instead.
    const isComponent = /^[A-Z]/.test(tag);
    const blockish = /^(?:div|section|figure|table|ul|ol|pre|blockquote|aside|nav|header|footer|details|script|style|iframe)$/i.test(tag);
    if (isComponent || blockish) push(startsLine, close ? close.index + close[0].length : raw.length);
  }

  // JSX expression islands on their own line: {someExpr}
  for (const m of raw.matchAll(/^[ \t]*\{[^\n]*\}[ \t]*$/gm)) push(m.index, m.index + m[0].length);

  // Markdown tables
  for (const m of raw.matchAll(/^[ \t]*\|[^\n]*(?:\n[ \t]*\|[^\n]*)*/gm)) push(m.index, m.index + m[0].length);

  // MULTI-LINE BLOCKQUOTES — epigraphs and pulled quotes. The single-line case is
  // handled by stripping the `>` leader, but a quote spanning lines put the marker
  // INSIDE the sentence span (`…survival.*\n> *But cortex…`), so a rewrite would
  // have eaten the blockquote structure. These are quoted material anyway: not the
  // author's prose to fix.
  for (const m of raw.matchAll(/^[ \t]*>[^\n]*(?:\n[ \t]*>[^\n]*)+/gm)) push(m.index, m.index + m[0].length);

  // METAVECTOR NOTATION — this book appends coordinate annotations to prose:
  //   … 🚀G1🔄 Wrapper Pattern [← 🟠F1💰 Trust Debt ($8.5T), 🟣E4🧠 Consciousness Proof]
  // It is authoring scaffolding, not sentences a reader parses. Left unmasked it
  // gets flagged as incomprehensible (it is), and a rewrite would destroy the
  // coordinates. Mask the bracket group and any emoji-coded tag before it.
  for (const m of raw.matchAll(/\[[←→][^\]\n]*\]/gu)) push(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/\p{Extended_Pictographic}[A-Z]\d\p{Extended_Pictographic}/gu)) {
    push(m.index, m.index + m[0].length);
  }

  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // merge overlaps
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function isMasked(regions, s, e) {
  // true when [s,e) overlaps any masked region
  for (const [rs, re] of regions) {
    if (rs >= e) break;
    if (s < re && rs < e) return true;
  }
  return false;
}

// Sentence terminators, avoiding the usual abbreviation traps.
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'fig', 'no', 'al', 'inc', 'ltd', 'co', 'approx', 'ca', 'cf', 'ibid', 'vol',
]);

/**
 * Split a paragraph into sentences, returning offsets RELATIVE to paraStart.
 * Conservative: never splits inside (), [], "", '', or after a known abbrev,
 * and never emits a fragment shorter than `minLen` as its own sentence.
 */
export function splitSentences(text, paraStart = 0, minLen = 12) {
  const spans = [];
  let depthParen = 0, depthBrack = 0;
  let inDq = false, inSq = false;
  let sentStart = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depthParen++;
    else if (c === ')') depthParen = Math.max(0, depthParen - 1);
    else if (c === '[') depthBrack++;
    else if (c === ']') depthBrack = Math.max(0, depthBrack - 1);
    else if (c === '"' || c === '“' || c === '”') inDq = !inDq;
    else if (c === '‘' || c === '’') inSq = !inSq;

    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    if (depthParen > 0 || depthBrack > 0 || inDq || inSq) continue;

    // Consume a run of terminators, then any closing quotes/brackets, then any
    // closing markdown emphasis. Without the emphasis class a bolded sentence
    // never terminated: after `fact.` came `*`, which is not whitespace, so the
    // split was rejected and the whole paragraph came back as one sentence.
    let j = i;
    while (j + 1 < text.length && /[.!?…]/.test(text[j + 1])) j++;
    while (j + 1 < text.length && /["'”’)\]*_~`]/.test(text[j + 1])) j++;

    const after = text.slice(j + 1);
    // Must be followed by end-of-text or whitespace then something.
    if (after.length && !/^\s/.test(after)) continue;
    // Decimal number: 3.14
    if (c === '.' && /\d$/.test(text.slice(0, i)) && /^\s*\d/.test(after)) continue;
    // Known abbreviation
    const wordBefore = (/([A-Za-z.]+)$/.exec(text.slice(0, i)) || [, ''])[1].toLowerCase();
    if (c === '.' && ABBREV.has(wordBefore)) continue;
    // Single initial: "J. Smith"
    if (c === '.' && /(?:^|\s)[A-Za-z]$/.test(text.slice(0, i))) continue;
    // Next non-space must look like a sentence start (capital, quote, digit, dash).
    if (after.length && !/^\s+["'“‘(\[]?[A-Z0-9—–]/.test(after)) continue;

    const end = j + 1;
    if (end - sentStart >= minLen) {
      spans.push([sentStart, end]);
      sentStart = end + (/^\s+/.exec(after) || [''])[0].length;
      i = sentStart - 1;
    }
  }
  if (text.length - sentStart >= 1) {
    const tail = text.slice(sentStart).trimEnd();
    if (tail.length) spans.push([sentStart, sentStart + tail.length]);
  }

  return spans
    .map(([s, e]) => {
      // trim leading whitespace into the offset so `text` is exact
      let ss = s;
      while (ss < e && /\s/.test(text[ss])) ss++;
      let ee = e;
      while (ee > ss && /\s/.test(text[ee - 1])) ee--;

      // ── KEEP MARKUP OUT OF THE SPAN ──────────────────────────────────
      // A sentence that begins a bold run captured its `**`, so the model was
      // asked to rewrite `**This is why every "grounding" technique…` and its
      // replacement either dropped the markers (killing the bold) or doubled
      // them. The markers are formatting, not prose: pull the span inside them
      // so the splice replaces the words and leaves the markup exactly where the
      // author put it. Only balanced, sentence-flanking markers are trimmed —
      // emphasis *inside* a sentence is part of the prose and stays.
      let guard = 0;
      for (;;) {
        if (guard++ > 8) break;
        const before = ss;
        for (const m of ['***', '**', '*', '__', '_', '`', '~~']) {
          if (text.startsWith(m, ss) && text.endsWith(m, ee) && ee - ss > 2 * m.length) {
            ss += m.length; ee -= m.length;
            break;
          }
        }
        // Leading-only marker (the sentence opens a bold run that closes later).
        for (const m of ['***', '**', '*', '__', '_']) {
          if (text.startsWith(m, ss) && !text.startsWith(m, ss + m.length)) {
            const rest = text.slice(ss + m.length, ee);
            if (!rest.includes(m)) { ss += m.length; break; }
          }
        }
        // Trailing-only marker (the sentence closes a run opened earlier).
        for (const m of ['***', '**', '*', '__', '_']) {
          if (text.endsWith(m, ee)) {
            const body = text.slice(ss, ee - m.length);
            if (!body.includes(m)) { ee -= m.length; break; }
          }
        }
        if (ss === before) break;
      }
      while (ss < ee && /\s/.test(text[ss])) ss++;
      while (ee > ss && /\s/.test(text[ee - 1])) ee--;

      return { text: text.slice(ss, ee), start: paraStart + ss, end: paraStart + ee };
    })
    .filter((s) => s.text.length > 0);
}

/**
 * JSX/TSX PROSE — the text a reader actually sees on the rendered page.
 *
 * A .tsx file is mostly code, and the markdown paragraph walker reads it as prose:
 * pointed at a real page component it returned `// Short code mappings`, an object
 * literal, and a function body as three "paragraphs". Flagging those as
 * hard-to-read and offering to rewrite them would corrupt working code.
 *
 * So code files take a different path entirely: pull only the JSX TEXT NODES —
 * the characters between `>` and `<` that are not inside braces — plus string
 * literals passed to obviously prose-bearing props. Everything else (imports,
 * types, hooks, handlers, class names, comments) is code and is never offered.
 *
 * Offsets remain exact against the original file, so the write path is unchanged:
 * a rewrite splices the text node and leaves every surrounding token alone.
 */
function extractJsxProse(raw, { minChars = 40 } = {}) {
  const starts = lineIndex(raw);
  const out = [];

  // Mask the regions where a `>`…`<` run is definitely not page text.
  const masked = [];
  const push = (s, e) => { if (e > s) masked.push([s, e]); };
  for (const m of raw.matchAll(/\/\*[\s\S]*?\*\//g)) push(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/^[ \t]*\/\/[^\n]*/gm)) push(m.index, m.index + m[0].length);
  for (const m of raw.matchAll(/`(?:[^`\\]|\\[\s\S])*`/g)) push(m.index, m.index + m[0].length);
  masked.sort((a, b) => a[0] - b[0]);
  const inMasked = (i) => masked.some(([s, e]) => i >= s && i < e);

  // JSX text nodes: `>` … `<` with no intervening brace or angle bracket.
  for (const m of raw.matchAll(/>([^<>{}]+)</g)) {
    const inner = m[1];
    const s = m.index + 1;
    const e = s + inner.length;
    if (inMasked(s)) continue;

    // Trim surrounding whitespace into the offsets so the span is exact.
    let ss = s, ee = e;
    while (ss < ee && /\s/.test(raw[ss])) ss++;
    while (ee > ss && /\s/.test(raw[ee - 1])) ee--;
    if (ee - ss < minChars) continue;

    const text = raw.slice(ss, ee);
    if (!/[a-z]{3}/.test(text)) continue;                 // needs real words
    if (!/\s/.test(text)) continue;                        // a single token is a label
    if (/^[A-Z0-9_\-\s]+$/.test(text)) continue;           // SCREAMING LABEL
    if (/[{}=;]|=>/.test(text)) continue;                  // leaked code
    if (!/[.!?]/.test(text) && text.split(/\s+/).length < 8) continue; // short UI label

    out.push({ text, start: ss, end: ee });
  }

  // Prose-bearing string props — the other place page copy hides.
  for (const m of raw.matchAll(/\b(?:title|description|subtitle|label|placeholder|alt|caption|summary|body|text|heading|blurb)\s*=\s*(?:\{\s*)?["'`]([^"'`]{40,})["'`]/g)) {
    const lit = m[1];
    const s = raw.indexOf(lit, m.index);
    if (s < 0 || inMasked(s)) continue;
    if (!/\s/.test(lit) || !/[a-z]{3}/.test(lit)) continue;
    out.push({ text: lit, start: s, end: s + lit.length });
  }

  out.sort((a, b) => a.start - b.start);

  // Each text node becomes its own "paragraph" so the sentence walker can run.
  const paragraphs = [];
  for (const node of out) {
    const sentences = splitSentences(node.text, node.start);
    if (!sentences.length) continue;
    paragraphs.push({
      index: paragraphs.length,
      text: node.text,
      start: node.start,
      end: node.end,
      startLine: lineAt(starts, node.start),
      endLine: lineAt(starts, node.end - 1),
      sentences,
    });
  }
  return { raw, paragraphs, totalLines: starts.length, kind: 'jsx' };
}

const CODE_EXT = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;

/**
 * Extract prose paragraphs from raw source.
 *
 * `filename` selects the strategy: code files get the JSX text-node walker, and
 * everything else (md, mdx, txt, html) gets the markdown paragraph walker. MDX is
 * deliberately NOT treated as code — it is prose with components in it, and its
 * JSX islands are already masked by maskedRegions().
 *
 * @returns {{raw:string, paragraphs:Array, totalLines:number}}
 *   paragraph = {index, text, start, end, startLine, endLine, sentences[]}
 */
export function extractProse(raw, { minParagraphChars = 40, filename = '' } = {}) {
  if (filename && CODE_EXT.test(filename)) {
    return extractJsxProse(raw, { minChars: minParagraphChars });
  }
  const regions = maskedRegions(raw);
  const starts = lineIndex(raw);
  const paragraphs = [];

  // Blank-line separated blocks over the RAW text (offsets stay true).
  const blockRe = /[^\n][\s\S]*?(?=\n[ \t]*\n|\n[ \t]*$|$)/g;
  let m;
  while ((m = blockRe.exec(raw)) !== null) {
    let s = m.index;
    let e = s + m[0].length;
    if (e <= s) { blockRe.lastIndex = s + 1; continue; }

    // Trim trailing whitespace out of the span
    while (e > s && /\s/.test(raw[e - 1])) e--;
    if (e <= s) continue;

    if (isMasked(regions, s, e)) continue;

    let text = raw.slice(s, e);

    // Strip list / blockquote leaders but keep the offset aligned by advancing s.
    const leader = /^[ \t]*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.exec(text);
    if (leader) { s += leader[0].length; text = raw.slice(s, e); }

    // Reject non-prose leftovers
    if (text.length < minParagraphChars) continue;
    if (!/[a-z]{3}/.test(text)) continue;          // needs real words
    if (/^[A-Za-z][\w.-]*\s*=/.test(text)) continue; // assignment
    // Mostly-markup line
    const markupChars = (text.match(/[<>{}]/g) || []).length;
    if (markupChars > text.length * 0.06) continue;

    const sentences = splitSentences(text, s);
    if (!sentences.length) continue;

    paragraphs.push({
      index: paragraphs.length,
      text,
      start: s,
      end: e,
      startLine: lineAt(starts, s),
      endLine: lineAt(starts, e - 1),
      sentences,
    });
  }

  return { raw, paragraphs, totalLines: starts.length };
}

/**
 * Sliding context window: target paragraph + `before` preceding + `after` succeeding.
 * The diagnostic model READS all of it but is instructed to SCORE only the target —
 * that is what keeps the monologue continuous without generalizing it away.
 */
export function contextWindow(paragraphs, targetIndex, before = 1, after = 1) {
  const lo = Math.max(0, targetIndex - before);
  const hi = Math.min(paragraphs.length - 1, targetIndex + after);
  return {
    target: paragraphs[targetIndex],
    before: paragraphs.slice(lo, targetIndex),
    after: paragraphs.slice(targetIndex + 1, hi + 1),
    all: paragraphs.slice(lo, hi + 1),
  };
}

/**
 * THE EDIT WINDOW — five sentences either side of the flagged one.
 *
 * This is what the writer actually sees and edits, and it is deliberately counted
 * in SENTENCES, not paragraphs. A paragraph window is the wrong unit twice over:
 * a one-sentence paragraph gives almost no context, and a long one buries the
 * flagged line in text the writer has to scan past. Five either side is a
 * consistent amount of runway regardless of how the author happened to break
 * their paragraphs, and it naturally spills across paragraph boundaries — which
 * is exactly where a fix often belongs.
 *
 * The span is taken from raw between the first and last sentence INCLUDING every
 * separator in between, so blank lines, list markers and markdown structure
 * survive the round trip untouched. Write-back replaces this exact span.
 */
export function sentenceWindow(paragraphs, paragraphIndex, sentenceIndex, opts = {}) {
  const {
    radius = 5,        // five either side — the baseline the writer asked for
    minChars = 700,    // APERTURE TO FIT: grow until the window carries real mass
    maxRadius = 14,    // but never so far that the writer is reading a chapter
    maxChars = 2600,
  } = opts;

  // Flatten to document order once; sentences carry their absolute offsets.
  const flat = [];
  for (const p of paragraphs) {
    for (let i = 0; i < p.sentences.length; i++) {
      flat.push({ ...p.sentences[i], paragraphIndex: p.index, sentenceIndex: i });
    }
  }
  const at = flat.findIndex((s) => s.paragraphIndex === paragraphIndex && s.sentenceIndex === sentenceIndex);
  if (at < 0) return null;

  // ── APERTURE TO FIT ──────────────────────────────────────────────────
  // Five sentences of terse prose can be under 200 characters, which is below
  // the gzip mass Tesseract needs to place a passage at all (MIN_GZIP_BYTES ≈
  // 220) — the exact reason the drift measurement could not discriminate quality
  // at sentence scale. So the aperture opens past the baseline radius until the
  // window carries enough mass to be measurable, then stops. Wider is not better:
  // past maxChars the writer is proof-reading instead of fixing one thing.
  let lo = Math.max(0, at - radius);
  let hi = Math.min(flat.length - 1, at + radius);
  const span = () => flat[hi].end - flat[lo].start;

  let r = radius;
  while (span() < minChars && r < maxRadius && (lo > 0 || hi < flat.length - 1)) {
    r++;
    const nlo = Math.max(0, at - r);
    const nhi = Math.min(flat.length - 1, at + r);
    if (nlo === lo && nhi === hi) break;       // hit both document edges
    lo = nlo; hi = nhi;
    if (span() > maxChars) break;
  }

  return {
    start: flat[lo].start,
    end: flat[hi].end,
    target: flat[at],
    before: flat.slice(lo, at),
    after: flat.slice(at + 1, hi + 1),
    radius: r,
    fitted: r > radius,
    // Offsets of the flagged sentence RELATIVE to the window, for highlighting
    // and for splicing a chosen candidate in place.
    targetInWindow: { start: flat[at].start - flat[lo].start, end: flat[at].end - flat[lo].start },
  };
}

/**
 * Splice a replacement into raw at [start,end). Pure string surgery — the only
 * mutation path in the whole system, so nothing outside the target can drift.
 */
export function spliceRange(raw, start, end, replacement) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > raw.length || end < start) {
    throw new Error(`spliceRange: bad range ${start}-${end} for length ${raw.length}`);
  }
  return raw.slice(0, start) + replacement + raw.slice(end);
}

export { lineIndex, lineAt, maskedRegions };
