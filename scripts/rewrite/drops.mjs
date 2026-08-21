// scripts/rewrite/drops.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE DROP BOX — real reader reactions, persisted and fed back into the loop.
//
// The whole system runs on ONE simulated reader's monologue. That reader is a
// model, and a model's guess about where a human stumbles is exactly the thing
// this tool cannot verify by itself. A drop is the antidote: paste what an actual
// reviewer said — an email, a Slack quote, a beta reader's margin note, another
// model's read — and it becomes evidence with the same standing as the generated
// monologue.
//
// Two things happen to a drop, and both matter:
//   1. IT IS SAVED, verbatim, append-only, to docs/05-content/monologues/<slug>.json.
//      Reader reactions are expensive to obtain and trivially lost in a chat log.
//   2. A SUBAGENT ANCHORS IT — a headless claude pass locates which sentences the
//      reaction is actually about and extracts a per-sentence monologue. That is
//      what lets a paragraph of prose feedback ("the middle drags, and I never
//      understood what you meant by weightlessness") turn into cards.
//
// Anchored drops outrank generated monologues when both point at the same
// sentence: a real human's confusion is not a hypothesis.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { cloud, local, extractJson } from './llm.mjs';

const DROPS_DIR = process.env.REWRITE_DROPS_DIR
  || path.join(process.cwd(), '.thetacog', 'rewrite', 'monologues');

function slugFor(file) {
  return path.basename(String(file)).replace(/[^\w.-]+/g, '-') || 'unknown';
}
function dropsPath(file) {
  return path.join(DROPS_DIR, `${slugFor(file)}.json`);
}

export function readDrops(file) {
  try { return JSON.parse(fs.readFileSync(dropsPath(file), 'utf8')); }
  catch { return { file: String(file), drops: [] }; }
}

function writeDrops(file, data) {
  fs.mkdirSync(DROPS_DIR, { recursive: true });
  const p = dropsPath(file);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
  return p;
}

/**
 * Ask a model WHICH sentences the reaction is about, and what the reader was
 * thinking at each. Deliberately conservative: a drop that cannot be anchored to
 * a specific sentence is kept as a document-level note rather than being smeared
 * across the text, because a wrong anchor generates a card for prose nobody
 * complained about.
 */
async function anchorDrop({ text, source, sentences }) {
  const numbered = sentences
    .map((s, i) => `[${i}] ${s.text}`)
    .join('\n')
    .slice(0, 22000);

  const prompt = `A real reader gave feedback on a document. Your job is to locate WHICH sentences
the feedback is about, and write out the reader's implied internal monologue at each one.

── THE FEEDBACK (verbatim, from ${source || 'a reader'}) ──
${text}

── THE DOCUMENT'S SENTENCES ──
${numbered}

RULES:
- Only anchor to a sentence when the feedback is clearly about THAT sentence or the
  passage it sits in. Vague praise or general remarks anchor to nothing.
- Do NOT invent complaints. If the reader said one thing, produce one anchor.
- The monologue must be in the reader's voice, first person, as a thought they had.
- score = how well they followed it, 0-100. If they were confused or bored, score low.
- If the feedback is entirely general, return an empty anchors array and put it in "general".

Return ONLY valid JSON:
{"anchors":[{"i":<sentence index>,"monologue":"<first-person thought>","score":<0-100>,"defect":"<none|undefined-term|reread|non-sequitur|slop|ambiguous>"}],"general":"<anything not anchorable, or empty>"}`;

  let res = await cloud(prompt);
  if (!res.ok) res = await local(prompt, { json: true, temperature: 0.3 });
  if (!res.ok) return { ok: false, error: res.error, anchors: [], general: '' };

  const parsed = extractJson(res.text);
  const anchors = Array.isArray(parsed?.anchors) ? parsed.anchors : [];
  const out = [];
  for (const a of anchors) {
    const i = Number(a?.i);
    const s = sentences[i];
    if (!s) continue;
    let score = Number(a?.score);
    if (!Number.isFinite(score)) score = 50;
    out.push({
      sentenceText: s.text,
      paragraphIndex: s.paragraphIndex,
      sentenceIndex: s.sentenceIndex,
      monologue: String(a?.monologue || '').trim(),
      score: Math.max(0, Math.min(100, score)),
      defect: String(a?.defect || 'none'),
    });
  }
  return { ok: true, anchors: out, general: String(parsed?.general || '').trim(), engine: res.model };
}

/**
 * Save a drop and anchor it. Returns the stored record.
 * `sentences` is the flattened document (text + paragraphIndex + sentenceIndex).
 */
export async function addDrop({ file, text, source = '', kind = 'review', sentences = [] }) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: 'empty drop' };

  const store = readDrops(file);
  const id = `d${Date.now().toString(36)}`;
  const record = {
    id,
    ts: new Date().toISOString(),
    kind,                       // review | monologue | note
    source,                     // who said it
    text: body,                 // VERBATIM — never rewritten
    anchors: [],
    general: '',
    anchored: false,
  };

  // Persist BEFORE anchoring: the raw reaction is the valuable artifact, and an
  // anchoring failure must never lose it.
  store.file = String(file);
  store.drops = [...(store.drops || []), record];
  const p = writeDrops(file, store);

  if (sentences.length) {
    const a = await anchorDrop({ text: body, source, sentences });
    if (a.ok) {
      record.anchors = a.anchors;
      record.general = a.general;
      record.anchored = true;
      record.anchoredBy = a.engine || null;
    } else {
      record.anchorError = a.error;
    }
    const again = readDrops(file);
    again.drops = (again.drops || []).map((d) => (d.id === id ? record : d));
    writeDrops(file, again);
  }

  return { ok: true, path: p, drop: record };
}

/**
 * Findings contributed by real readers, in the same shape the diagnostic emits so
 * the engine can queue them without a special case. `source: 'drop'` marks them so
 * the UI can say a human said this, not a model.
 */
export function dropFindings(file, paragraphs) {
  const store = readDrops(file);
  const out = [];
  for (const d of store.drops || []) {
    for (const a of d.anchors || []) {
      const p = paragraphs[a.paragraphIndex];
      const s = p?.sentences?.[a.sentenceIndex];
      // Re-anchor by TEXT, not index — the document may have been edited since.
      let target = s && s.text === a.sentenceText ? s : null;
      let pi = a.paragraphIndex, si = a.sentenceIndex;
      if (!target) {
        for (const pp of paragraphs) {
          const idx = pp.sentences.findIndex((x) => x.text === a.sentenceText);
          if (idx >= 0) { target = pp.sentences[idx]; pi = pp.index; si = idx; break; }
        }
      }
      if (!target) continue;
      out.push({
        paragraphIndex: pi,
        sentenceIndex: si,
        text: target.text,
        start: target.start,
        end: target.end,
        monologue: a.monologue,
        score: a.score,
        defect: a.defect,
        source: 'drop',
        dropId: d.id,
        dropSource: d.source,
        // A real reader outranks a simulated one at the same score.
        rank: (100 - a.score) * 3 + 40,
      });
    }
  }
  return out;
}

export function dropSummary(file) {
  const store = readDrops(file);
  const drops = store.drops || [];
  return {
    count: drops.length,
    anchored: drops.filter((d) => d.anchored).length,
    anchors: drops.reduce((a, d) => a + (d.anchors?.length || 0), 0),
    path: dropsPath(file),
    recent: drops.slice(-8).reverse().map((d) => ({
      id: d.id, ts: d.ts, kind: d.kind, source: d.source,
      preview: d.text.slice(0, 140), anchors: d.anchors?.length || 0,
      anchored: d.anchored, error: d.anchorError || null,
    })),
  };
}

export { DROPS_DIR, dropsPath };
