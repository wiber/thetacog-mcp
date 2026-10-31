#!/usr/bin/env node
// scripts/blog/notebook-index.mjs — THE NOTEBOOK INDEX: every NotebookLM audio/video overview in docs/notebooklm-media (audio/ + videos/, gitignored),
// its transcript, its duplicates, and the errata it carries, ranked so the next errata /mdx-cook knows where to start.
//
// WHY. NotebookLM retells the record in its own words, and its words drift exactly where our canon has hard rules
// (NEVER GUARANTEE BEHAVIOR · AXIOM 0's forbidden "hardware because metal" register · the determinism word ·
// the canonical constants). Each overview is a free read of how the record LANDS on a fluent outside reader; the
// errata are the places the record let it land wrong. The index says which overview carries the most, and which
// spec rows each erratum sits nearest (gzip-NCD, the canonical sensor), so the correction goes to the source.
//
// SUFFICIENT FOR: which overviews state a banned register, and how often · which spec rows sit nearest by gzip-NCD.
// NOT SUFFICIENT FOR: whether a flagged line is false in context (a hit is a candidate erratum, read by a human),
// or whether an unflagged line is true. Transcripts are whisper output; a mis-heard word is a transcription error,
// never an erratum of ours.
//
// The detectors are the repo's own, imported (ONE RULE LIVES IN ONE PLACE): findBannedPromises
// (scripts/voice/behavior-promise.mjs) and countDeterminismUse (scripts/lib/grip-word.mjs). The two families below
// exist because both of those, correctly for OUR prose, skip negated forms and non-"we" subjects — and a retelling
// says "an AI that cannot break promises" and "silicon fixes hallucinations", which is the same promise in a
// subject the house detector does not cover. Port row: none (orchestration + reporting; the sensor is ncd()).
//
// CLI: node scripts/blog/notebook-index.mjs [--dir docs/notebooklm-media] [--tdir docs/notebooklm-transcripts/audio] [--out docs/10-scratchpad/notebooklm-index-<date>.txt] [--only <list>]
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { findBannedPromises } from '../voice/behavior-promise.mjs';
import { countDeterminismUse } from '../lib/grip-word.mjs';
import { ncd } from '../vna/read-set.mjs';

export const EXTRA_FAMILIES = [
  { key: 'negated-guarantee', label: 'behaviour guarantee in the negated form (an AI that cannot break / lie / drift)',
    re: /\b(?:AI|agents?|models?|systems?|machines?)\b[^.!?\n]{0,40}\b(?:cannot|can'?t|can never|will never|is unable to|impossible (?:for it )?to)\s+(?:break (?:its |a |their )?promises?|lie|hallucinate|drift|deviate|go off|misbehave|fail)\b/i },
  { key: 'hardware-fixes', label: 'AXIOM 0 overreach — hardware/silicon/physics sold as FIXING or STOPPING the model',
    re: /\b(?:hardware|silicon|the chip|physics|geometry|circuit breakers?|kill switch(?:es)?)\b[^.!?\n]{0,40}\b(?:fix(?:es)?|stops?|eliminat\w+|prevents?|cures?|ends?|solves?)\b[^.!?\n]{0,30}\b(?:hallucinat\w+|drift|misbehaviou?r|lying|lies)\b/i },
  { key: 'prevents-as-ours', label: 'containment/prevention sold as the machine\'s act (an engine that physically prevents …) — we DETECT · PLACE · PRICE · DISPATCH',
    re: /\b(?:physically|structurally|mathematically|automatically)\s+(?:prevent\w*|stop\w*|block\w*|forbid\w*|enforc\w+)\b|\bzero[- ]drift\b|\b(?:eliminat\w+|end\w*|cure\w*|solv\w+)\s+(?:AI\s+)?(?:hallucinations?|drift)\b/i },
  { key: 'software-cannot', label: 'the "software cannot" register (never "below the ALU" / "software cannot fix AI" — argue from grounding, not from software\'s impotence)',
    re: /\bsoftware (?:can(?:no|')t|can never|is unable to) (?:fix|solve|stop|catch|govern|police)\b/i },
  { key: 'constants', label: 'canonical constant restated wrong (231 is boundary crossings, never days)',
    re: /\b231\s+(?:days?|hours?|weeks?)\b|half[- ]life of (?:about |roughly )?\d+\s+days?/i },
];

// one transcript → the errata it carries, line-addressed
export function scanTranscript(text) {
  const body = text.split('\n').slice(4).join('\n');            // the header is ours, never scanned
  const hits = findBannedPromises(body).map((h) => ({ line: h.line + 4, family: 'house:' + h.label, snippet: h.snippet }));
  body.split('\n').forEach((ln, i) => {
    for (const f of EXTRA_FAMILIES) { const m = ln.match(f.re); if (m) hits.push({ line: i + 5, family: f.key, snippet: m[0].slice(0, 110) }); }
  });
  const title = (text.split('\n')[0] || '').replace(/^source: /, '').replace(/[_]+/g, ' ').replace(/\.\w+$/, '');
  for (const f of EXTRA_FAMILIES) { const m = title.match(f.re); if (m) hits.push({ line: 1, family: f.key + ' (title)', snippet: m[0] }); }
  for (const h of findBannedPromises(title)) hits.push({ line: 1, family: 'house:' + h.label + ' (title)', snippet: h.snippet });
  return { hits: hits.sort((a, b) => a.line - b.line), determinism: countDeterminismUse(body), loops: repetitionLoops(body) };
}

// whisper's known failure: a phrase repeated back-to-back. Count runs where the same ≥3-word phrase occurs 3+ times
// in a row — a transcript with loops has lines the speakers never said, so its errata are read with that caveat.
export function repetitionLoops(body) {
  const m = body.match(/\b((?:\w+[ ,.']+){3,8}?)(?:\1){2,}/g);
  return m ? m.length : 0;
}

export function parseHeader(text) {
  const [src, md5, meta] = text.split('\n');
  const dur = /duration: (\d+)m(\d+)s/.exec(meta || '');
  return { source: (src || '').replace(/^source: /, ''), md5: (md5 || '').replace(/^md5: /, ''),
    downloaded: (/downloaded: ([\d-]+ [\d:]+)/.exec(meta || '') || [])[1] || null, seconds: dur ? +dur[1] * 60 + +dur[2] : null };
}

// the spec rows, one line each, as the NCD bank
export function specRows(specPath) {
  return readFileSync(specPath, 'utf8').split('\n')
    .map((l) => /^\s*- \[[ x]\] (C\d+[a-z]*)\b(.*)$/.exec(l)).filter(Boolean).map((m) => ({ id: m[1], text: m[2].slice(0, 1200) }));
}
// the book's sections, one per ## heading, as the second NCD bank. The spec rows are a poor bank for SPOKEN retellings:
// measured 2026-10-02, the rows that won were the ones dictated in a spoken register (C313 "I just scanned a sticker…",
// C167) — register, not topic. The overviews retell the book and the dumps, so the book is where a correction lands.
export function bookSections(dir = 'books/tesseract/chapters') {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const parts = readFileSync(join(dir, f), 'utf8').split(/\n(?=## )/);
    for (const part of parts) {
      const head = (/^## (.+)/.exec(part) || [])[1];
      const slug = head ? head.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) : 'top';
      const text = part.replace(/^## .+\n/, '').replace(/[#*_>`|-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length >= 300) out.push({ id: `${f.replace(/\.md$/, '')}#${slug}`, text: text.slice(0, 1200) });
    }
  }
  return out;
}

// EVERY query set gets its own baseline: the mean is taken over queries of the same kind (whole transcripts, or
// erratum lines) — measured 2026-10-02, erratum lines scored against the transcript mean all landed on the two
// shortest book sections (09-about-the-offer#contact / #what-we-don-t-promise) and spec rows C0–C2.
// raw nearest by gzip-NCD. A query longer than the row costs C(q|r)/C(q), so the row that shares the most GENERIC
// vocabulary with every spoken transcript sits nearest to all of them (measured 2026-10-02: C372/C109/C103 topped every
// one of 109 transcripts at 0.90–0.95). relNearest subtracts each row's MEAN distance over the whole query set — the
// row's own absorbency — so a row wins only where it is nearer to THIS query than it is to the corpus at large.
export function distances(text, rows) { const q = text.slice(0, 4000); return rows.map((r) => ncd(q, r.text)); }
export function nearest(text, rows, k = 3) {
  const d = distances(text, rows);
  return rows.map((r, i) => ({ id: r.id, d: d[i] })).sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1)).slice(0, k);
}
export function relNearest(dist, rows, rowMean, k = 3) {
  return rows.map((r, i) => ({ id: r.id, d: dist[i], rel: dist[i] - rowMean[i] })).sort((a, b) => a.rel - b.rel || (a.id < b.id ? -1 : 1)).slice(0, k);
}

// each bank row's absorbency = its mean distance over queries of the same kind; a row wins only where it is nearer to
// THIS query than to that kind of query at large. entries carry dist/bdist (whole transcript) and hitDist[] (lines).
export function associate(entries, rows, book) {
  const mean = (qs, key, n) => Array.from({ length: n }, (_, i) => qs.reduce((a, q) => a + q[key][i], 0) / Math.max(1, qs.length));
  const rowMean = mean(entries, 'dist', rows.length), bookMean = mean(entries, 'bdist', book.length);
  const allHits = entries.flatMap((e) => e.hitDist);
  const hitRowMean = mean(allHits, 'dist', rows.length), hitBookMean = mean(allHits, 'bdist', book.length);
  for (const e of entries) {
    e.near = relNearest(e.dist, rows, rowMean); e.bnear = relNearest(e.bdist, book, bookMean);
    e.hitNear = e.hitDist.map((x) => ({ ...x, near: relNearest(x.dist, rows, hitRowMean, 1), bnear: relNearest(x.bdist, book, hitBookMean, 1) }));
    delete e.dist; delete e.bdist; delete e.hitDist;
  }
  return entries;
}

function main() {
  const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  // media moved out of ~/Downloads 2026-10-03: the bytes stay gitignored under docs/notebooklm-media, the transcripts are committed
  const dir = arg('--dir', 'docs/notebooklm-media'); const tdir = arg('--tdir', 'docs/notebooklm-transcripts/audio');
  const date = new Date().toISOString().slice(0, 10);
  const out = arg('--out', `docs/10-scratchpad/notebooklm-index-${date}.txt`);
  const rows = specRows('docs/specs/vna/SPEC-VNA-COCKPIT.md');
  const book = bookSections();
  const media = ['audio', 'videos'].flatMap((d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)) : [])).filter((f) => /\.(m4a|mp4|mp3)$/i.test(f));
  // --only <file>: index exactly the transcripts named there, one per line (a catalogue snapshot while a sweep still runs)
  const only = arg('--only', null) ? new Set(readFileSync(arg('--only'), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)) : null;
  const txs = (existsSync(tdir) ? readdirSync(tdir).filter((f) => f.endsWith('.txt') && !f.startsWith('_')) : []).filter((f) => !only || only.has(f));
  const byStem = new Map(txs.map((t) => [basename(t, '.txt'), t]));
  const byMd5 = new Map();
  const entries = [];
  for (const t of txs) {
    const text = readFileSync(join(tdir, t), 'utf8'); const h = parseHeader(text);
    if (byMd5.has(h.md5)) { byMd5.get(h.md5).dups.push(t); continue; }
    const { hits, determinism, loops } = scanTranscript(text);
    const words = text.split(/\s+/).length;
    const e = { transcript: t, ...h, words, hits, determinism, loops, dups: [], dist: distances(text.split('\n').slice(4).join(' '), rows), bdist: distances(text.split('\n').slice(4).join(' '), book),
      hitDist: hits.slice(0, 6).map((x) => { const ls = text.split('\n'); const q = ls.slice(Math.max(4, x.line - 2), x.line + 1).join(' ').slice(0, 900); return { ...x, dist: distances(q, rows), bdist: distances(q, book) }; }) };
    e.density = +(((hits.length + determinism) / Math.max(1, words)) * 1000).toFixed(2);
    byMd5.set(h.md5, e); entries.push(e);
  }
  associate(entries, rows, book);
  // a media file whose bytes match one already transcribed is covered: the sweep logs it as "dup <stem> ← <transcript>"
  const dupOf = new Map();
  try { for (const l of readFileSync(join(tdir, '_progress.log'), 'utf8').split('\n')) { const m = /^dup\s+(.+?) ← (.+)$/.exec(l); if (m) dupOf.set(m[1].trim(), m[2].trim()); } } catch {}
  const untx = media.filter((f) => { const st = basename(f, extname(f)); return !byStem.has(st) && !(dupOf.has(st) && existsSync(join(tdir, dupOf.get(st)))); });
  const dupMedia = media.filter((f) => { const st = basename(f, extname(f)); return !byStem.has(st) && dupOf.has(st) && existsSync(join(tdir, dupOf.get(st))); });
  entries.sort((a, b) => b.density - a.density || b.hits.length - a.hits.length || (a.transcript < b.transcript ? -1 : 1));
  const L = [];
  L.push(`NOTEBOOKLM INDEX · ${date} · generated by scripts/blog/notebook-index.mjs (LLM-free; re-run to refresh)`);
  L.push(`media in ${dir}: ${media.length} · transcribed (distinct audio): ${entries.length} · duplicate transcripts folded: ${txs.length - entries.length} · byte-identical media folded: ${dupMedia.length} · NOT YET TRANSCRIBED: ${untx.length}`);
  L.push(`sufficient for: which overviews state a banned register and how often · nearest spec rows by gzip-NCD`);
  L.push(`not sufficient for: whether a flagged line is false in context (a hit is a CANDIDATE erratum) · transcripts are whisper output`);
  L.push(`spec-row association = gzip-NCD minus that row's mean NCD over every transcript (a generic-vocabulary row sits near every transcript; raw nearest would name it for all)`);
  L.push(`banks: book sections (books/tesseract/chapters, one per ## heading) — the source the overviews retell · spec rows — register-confounded for speech (dictated rows win on register, not topic)`);
  L.push(`density = (errata hits + determinism uses) per 1000 words · ranked highest first = write the errata /mdx-cook here first`);
  L.push('');
  const fams = {}; for (const e of entries) for (const h of e.hits) fams[h.family] = (fams[h.family] || 0) + 1;
  L.push('ERRATA BY FAMILY (all transcripts):');
  for (const [f, n] of Object.entries(fams).sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(4)}  ${f}`);
  L.push(`  ${String(entries.reduce((s, e) => s + e.determinism, 0)).padStart(4)}  determinism register (the word names the chaos; we are grip)`);
  L.push('');
  L.push('═'.repeat(100));
  entries.forEach((e, i) => {
    L.push(`${String(i + 1).padStart(3)}. ${e.source}`);
    L.push(`     ${e.downloaded || '?'} · ${e.seconds != null ? Math.round(e.seconds / 60) + ' min' : '?'} · ${e.words} words · errata ${e.hits.length} · determinism ${e.determinism} · density ${e.density}${e.loops ? ` · ⚠ ${e.loops} whisper repetition loop(s) — re-transcribe before quoting` : ''}`);
    L.push(`     transcript: ${join(tdir, e.transcript)}${e.dups.length ? ' · same audio as: ' + e.dups.join(' · ') : ''}`);
    L.push(`     nearest book sections: ${e.bnear.map((n) => `${n.id} ${n.rel.toFixed(3)}`).join(' · ')}`);
    L.push(`     nearest spec rows (register-confounded, see header): ${e.near.map((n) => `${n.id} ${n.rel.toFixed(3)}`).join(' · ')}`);
    for (const h of e.hitNear) L.push(`       L${h.line} [${h.family.replace(/^house:/, '')}] "${h.snippet}" → book ${h.bnear[0].id} · spec ${h.near[0].id}`);
    if (e.hits.length > e.hitNear.length) L.push(`       … +${e.hits.length - e.hitNear.length} more`);
  });
  if (untx.length) { L.push(''); L.push('NOT YET TRANSCRIBED:'); for (const f of untx) L.push(`  ${f}`); }
  writeFileSync(out, L.join('\n') + '\n');
  console.log(`wrote ${out} · ${entries.length} distinct · ${untx.length} untranscribed · top: ${entries.slice(0, 3).map((e) => e.transcript).join(' | ')}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
