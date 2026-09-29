#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/prior-art.mjs
//
// DID THE OPERATOR ALREADY ANSWER THIS? — the corpus as NEGATIVE evidence for question minting.
//
// THE DESIGN DECISION, stated because it was the open one. The obvious use of 416,113 archived
// conversation turns is "more context for the model", and that is the wrong use: the minter already
// has the locked coordinates and the recent turns, and a bigger haystack does not mint a better
// question. The use no other part of this system can cover is the OPPOSITE — a question about
// something the operator already settled out loud, months ago, in a chat nobody will reopen, is the
// worst kind of formality, and it is the one kind a human cannot check. next-question.mjs kills
// questions whose answers land in the same cell; this kills questions already answered aloud.
//
// ── THE SUFFICIENCY CONTRACT ──────────────────────────────────────────────────────────────────
//   SUFFICIENT FOR: "has this been discussed before, and where" — dated, quoted, real turns.
//   NOT SUFFICIENT FOR: "was it decided" — and this is MEASURED, not merely disclaimed. Four probe
//                   questions, two known settled in the corpus and two known open:
//                       SETTLED  0.5417  receipt LLM-free
//                       SETTLED  0.5122  delegation never branches
//                       OPEN     0.5326  cockpit private or product
//                       OPEN     0.4583  subagent dropdown kinds
//                   The ranges do not merely overlap, they INVERT — the most "similar" hit in the
//                   set belongs to an open question. So the number RANKS retrieval and CANNOT
//                   classify. Two attempts were made to fix that before accepting it: excluding
//                   machine-injected turns (which was a real bug and is kept) and matched-aperture
//                   NCD per META-BULK (kept, it is correct practice, and it did not separate).
//                   The tool therefore NEVER auto-kills a candidate; it attaches evidence and the
//                   operator reads it. A silent kill on a score that cannot classify would be the
//                   exact overreach the rest of this pipeline refuses.
//
// LLM-FREE. FTS narrows (12ms over 416k turns — speed is the correctness signal), gzip-NCD reranks
// (the canonical sensor, never SimHash). No model anywhere in the path.
//
// @guard tests/tape/prior-art.test.mjs
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ncd } from './question-quality.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
export const CORPUS = process.env.THETACOG_CORPUS || resolve(REPO, '.thetacog/transcripts.db');

// A field delimiter transcript text will not contain. Control characters are unusable here: they
// are invisible in a shell approval dialog, which is a real constraint in this harness.
const SEP = '~@|@~';

// Words carrying no retrieval signal. Deliberately short — over-filtering is how a search stops
// finding the thing you asked for.
const STOP = new Set(['the','and','that','this','with','from','your','their','what','when','which',
  'into','than','they','them','then','been','were','have','has','how','why','who','not','but','for',
  'are','you','our','its','one','does','should','must','will','can','it','is','of','to','in','on',
  'or','a','an','at','by','as','be','if','ever','still','same','other','more','most','some']);

/** Terms worth searching on — content words, longest first (longer = rarer = better anchor). */
export function searchTerms(question, max = 6) {
  return [...new Set(String(question).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])]
    .filter((w) => !STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, max);
}

// ROLE='USER' IS NOT "THE OPERATOR SAID THIS", and the first run of this file proved it: every top
// hit was a <task-notification> block. Harnesses inject tool results, hook feedback, system
// reminders and slash-command echoes as user turns, so 1,371 of the 82,820 user rows are machine
// text wearing the operator's role. They are long, technical, and full of the exact vocabulary a
// question about this repo uses — which makes them the WORST possible false positives here.
// Excluded by shape rather than by a model, because their shapes are fixed and known.
const MACHINE_NOISE = [
  "AND t.text NOT LIKE '<task-notification>%'",
  "AND t.text NOT LIKE '<system-reminder>%'",
  "AND t.text NOT LIKE '<command-name>%'",
  "AND t.text NOT LIKE 'Stop hook feedback%'",
  "AND t.text NOT LIKE '%<tool_use_error>%'",
  "AND t.text NOT LIKE '%UserPromptSubmit hook%'",
  "AND t.text NOT LIKE '%<function_results>%'",
  "AND t.text NOT LIKE '%Base directory for this skill%'",
].join(' ');

function sql(db, query) {
  return execFileSync('sqlite3', ['-separator', SEP, db, query], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 20000,
  });
}

// ── CUT THE EYE — matched-aperture NCD (CLAUDE.md, META-BULK) ────────────────────────────────
// MEASURED FAILURE THAT FORCED THIS. Comparing the question against a whole 600-char excerpt gave
// 0.5417 for a question KNOWN to have been settled in the corpus and 0.5326 for one known NOT to
// have been — no separation at all, so nothing could be gated on it.
//
// The cause is the rule this repo already wrote down: "gzip-NCD only measures MEANING when the two
// texts are the same size-order (the aperture). Naked-rule matching violates that... one-sided
// fattening re-violates it. Symmetric bulk + matched-eye is the only size-matched form." A ~90-char
// question against a 600-char excerpt is precisely the asymmetry the rule forbids — most of what
// the compressor sees is length difference, not meaning.
//
// So the eye is cut to the question's own size and slid across the excerpt, taking the best window.
// A prior utterance that answers this question answers it in a SENTENCE somewhere inside itself;
// the rest of the turn is other business and should not dilute the reading.
export function matchedNcd(question, text) {
  const q = String(question);
  const t = String(text);
  const w = Math.max(60, Math.round(q.length * 1.4));   // the aperture, sized by the query
  if (t.length <= w) return { ncd: +ncd(q, t).toFixed(4), window: t };
  const step = Math.max(20, Math.round(w / 3));          // overlapping, so a match cannot fall in a seam
  let best = { ncd: 1, window: '' };
  for (let i = 0; i + 1 <= t.length; i += step) {
    const win = t.slice(i, i + w);
    if (win.length < w * 0.6) break;                     // a starved tail window is length noise
    const d = ncd(q, win);
    if (d < best.ncd) best = { ncd: +d.toFixed(4), window: win };
  }
  return best;
}

/**
 * Turns that may already answer this question.
 * @returns {{ok:boolean, reason?:string, hits:Array<object>, searched:string[]}}
 */
export function priorArt(question, { db = CORPUS, limit = 5, scan = 60 } = {}) {
  if (!existsSync(db)) {
    return { ok: false, reason: `no corpus at ${db} — run /scrape to build it`, hits: [], searched: [] };
  }
  const terms = searchTerms(question);
  if (terms.length < 2) {
    return { ok: true, hits: [], searched: terms, reason: 'too few content words to search on' };
  }

  // OR, not AND. AND over six terms returns nothing on a corpus this varied, and a question that
  // was answered in DIFFERENT WORDS is exactly the case worth catching.
  const match = terms.map((t) => `"${t}"`).join(' OR ');
  let rows;
  try {
    rows = sql(db, `SELECT t.ts, t.role, t.corpus, replace(substr(t.text,1,600), char(10), ' ')
                    FROM turns_fts f JOIN turns t ON t.id = f.rowid
                    WHERE turns_fts MATCH '${match.replace(/'/g, "''")}'
                      AND t.role = 'user' AND length(t.text) BETWEEN 40 AND 4000
                      ${MACHINE_NOISE}
                    LIMIT ${scan};`);
  } catch (e) {
    return { ok: false, reason: `corpus query failed: ${String(e.message).slice(0, 120)}`, hits: [], searched: terms };
  }

  // FTS ranks by term overlap; gzip-NCD compares meaning. Rerank — never trust the first stage.
  const hits = rows.trim().split('\n').filter(Boolean).map((line) => {
    const [ts, role, corpus, excerpt] = line.split(SEP);
    const text = (excerpt || '').trim();
    const m = matchedNcd(question, text);
    return { ts, role, corpus, excerpt: text, ncd: m.ncd, window: m.window };
  }).sort((a, b) => a.ncd - b.ncd).slice(0, limit);

  return { ok: true, hits, searched: terms };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!q) { process.stderr.write('usage: prior-art.mjs "<question>"\n'); process.exit(2); }
  const t0 = Date.now();
  const r = priorArt(q);
  if (!r.ok) { process.stderr.write(r.reason + '\n'); process.exit(2); }
  process.stdout.write(`searched: ${r.searched.join(', ')}  (${Date.now() - t0}ms)\n\n`);
  if (!r.hits.length) process.stdout.write('no prior discussion found — this looks genuinely open.\n');
  for (const h of r.hits) {
    process.stdout.write(`  ncd ${h.ncd}  ${(h.ts || '').slice(0, 16)}  [${h.corpus || '?'}]\n    ${h.excerpt.slice(0, 200)}\n\n`);
  }
  process.stdout.write('EVIDENCE, NOT A VERDICT: whether any of this settles the question is yours to read.\n');
}
