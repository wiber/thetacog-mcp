#!/usr/bin/env node
// scripts/ops/thread-name.mjs — THE INTERPRETATION LAYER for the room overview.
//
// WHY (operator 2026-08-24): "I asked not for quotes but summaries labeled named descriptions
// of what is going on — the format is nice, but there is no interpretation." The overview was
// pure extraction: it sliced the first 170 characters off a raw prompt and printed them. A
// slice of a sentence is a QUOTE, and a quote is not a reading. This module turns each strand
// of work into a NAME (what to call it) + a WHAT (one sentence saying where it stands) so the
// operator can tell what is going on without reading the raw text.
//
// WHERE THIS SITS RELATIVE TO THE LLM-FREE RULE. The receipt — the commit triptych, σ, the
// placement, the panel — stays LLM-FREE and is untouched by this file. The digest is the STORY
// half (CLAUDE.md: "THE STORY — the LLM narrative over the drift signals, a separate later
// send"), which is exactly where a model belongs. The digest fires from launchd, never on the
// interactive path, so qwen is the sanctioned lane (model-route.mjs: read/sense/narrate → qwen).
//
// NEVER A SEQUENTIAL AWAIT-LOOP (CLAUDE.md, 2026-07-28): items fan out through a bounded worker
// pool, under a whole-process budget, behind a content-addressed cache — so a re-run of the same
// strands costs nothing and a wedged ollama costs the digest nothing but its interpretation.
//
// HONEST DEGRADATION: when the model is unavailable, out of budget, or returns something that
// does not parse, the item comes back source:'template' with an extractive NAME and an EMPTY
// why — and the renderer then falls back to showing the raw ask. An invented reading is worse
// than a quote; a quote is worse than a reading. Never fabricate the middle one.
//
// Guard: tests/ops/thread-name.test.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const MODEL = process.env.THREAD_NAME_MODEL || 'qwen2.5:7b';
export const OLLAMA = process.env.OLLAMA_URL || process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';
const CALL_TIMEOUT_MS = Number(process.env.THREAD_NAME_TIMEOUT_MS) || 30000;
const TOTAL_BUDGET_MS = Number(process.env.THREAD_NAME_BUDGET_MS) || 240000;
const CONCURRENCY = Math.max(1, Number(process.env.THREAD_NAME_CONCURRENCY) || 3);
export const CACHE_PATH = process.env.THREAD_NAME_CACHE
  || join(REPO, '.thetacog', 'cache', 'thread-names.json');
const CACHE_TTL_MS = 30 * 864e5;

// ── the prompt. Two worked examples lock the SHAPE (a name, then one prose sentence); the rule
// block locks the CONSTRAINTS. Measured on qwen2.5:7b: without the examples the model answers
// WHAT in title-case fragments ("Checking Two Live Sessions, One Bug Fix") — a label, not a
// reading. With them it returns sentences that carry the strand's own vocabulary.
export function buildPrompt(notes) {
  return `You label one strand of ongoing engineering work so a busy operator can tell at a glance WHAT IS GOING ON, without reading the raw text.

EXAMPLE 1
notes:
[asked] the panel keeps rendering blank on thin commits, find out why before we ship the email
[replied] The reality corpus cache is a fixed-name file two renders clobber. Making it commit-scoped.
answer:
NAME: Blank Tolerance Panel
WHAT: Blank panels on thin commits were traced to a shared render cache that concurrent renders clobber, and the cache is being scoped per commit so the receipt stops coming out empty.

EXAMPLE 2
notes:
[asked] approve the outreach draft and send it to the three brokers, cc me
answer:
NAME: Broker Outreach Send
WHAT: An outreach draft is being moved from drafts to approved so the post-commit dispatch fires it to three brokers, with a copy back to the sender.

NOW DO THE SAME FOR THESE NOTES (most recent first):
---
${String(notes || '').slice(0, 4000)}
---

NAME rules: 2-6 words, title case, the notes' own vocabulary, no quotes, no period.
WHAT rules: ONE sentence of 18-35 words ending in a period. Ordinary sentence case, not title case. Say what is being worked on, why, and where it stands. Never quote the notes, never give advice, never say "the user", "the operator", "Claude", "the assistant", or "the notes".
Output exactly two lines — NAME: then WHAT: — and nothing else.`;
}

// Phrases that mean the model narrated the CONVERSATION instead of the WORK. A reading that
// says "the user asked Claude to…" has described the transcript, not the strand — reject it and
// fall back rather than ship a paraphrase of the frame.
const BANNED = /\b(the user|the operator|the assistant|claude|chatgpt|the notes|this strand|as an ai)\b/i;

// ── parseNaming: pull the two CONSTRUCTS out of the reply — an anchored NAME: line and an
// anchored WHAT: line — and validate them. Deliberately not indexOf('NAME') (CLAUDE.md, THE
// PROXY IS NOT THE THING): the token appears inside the echoed rule block too, and matching the
// token instead of the line construct is exactly the failure that rule names. Returns null when
// the reply does not actually carry both fields in usable form.
export function parseNaming(raw) {
  const text = String(raw || '');
  const nameLine = text.match(/^[^\S\n]*NAME:[^\S\n]*(\S.*)$/mi);
  const whyLine = text.match(/^[^\S\n]*WHAT:[^\S\n]*(\S.*)$/mi);
  if (!nameLine || !whyLine) return null;
  const name = nameLine[1].trim().replace(/^["'`]|["'`.]+$/g, '').replace(/\s+/g, ' ').trim();
  let why = whyLine[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 80 || name.split(' ').length > 9) return null;
  if (BANNED.test(name) || BANNED.test(why)) return null;
  // a WHAT that is a fragment (a handful of words, no verb-bearing sentence) is a label wearing
  // a sentence's clothes — the exact regression the two examples exist to stop.
  if (why.split(/\s+/).length < 8) return null;
  if (why.length > 400) why = why.slice(0, 397).replace(/\s+\S*$/, '') + '…';
  if (!/[.!?…]$/.test(why)) why += '.';
  return { name, why };
}

// ── templateName: the honest fallback NAME. Extractive, deterministic, never a claim about
// what the work MEANS — just the strand's own heaviest words, so a card without a model reading
// still has something to call it. The empty `why` is what tells the renderer to show the quote.
const STOP = new Set(('the a an and or but of to in on for with from at by is are was were be been being this that these those ' +
  'it its as if then than so we you i they he she them us our your my me do does did done can could should would will ' +
  'not no yes just now here there what which who whom whose when where why how all any some each every more most other ' +
  'into over under about after before again very too also only own same such nope yeah okay ok lets let make made get got ' +
  'need needs want wants please thanks').split(' '));
export function templateName(text) {
  const words = String(text || '')
    .replace(/\[(asked|replied)\]/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^A-Za-z0-9._/-]+/)
    .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()));
  const picked = [];
  const seen = new Set();
  for (const w of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(/[._/-]/.test(w) ? w : w[0].toUpperCase() + w.slice(1));
    if (picked.length >= 4) break;
  }
  return picked.join(' ') || 'Untitled Strand';
}

// ── cache: content-addressed, so the same strand keeps the SAME name across digests (a name
// that changes every six hours is not a name). Pruned by age on write.
export function cacheKey(notes) {
  return createHash('sha1').update(String(notes || ''), 'utf8').digest('hex').slice(0, 20);
}
export function loadCache(path = CACHE_PATH) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}
export function saveCache(cache, path = CACHE_PATH, now = Date.now()) {
  const keep = {};
  for (const [k, v] of Object.entries(cache)) {
    if (!v || !v.at || (now - Date.parse(v.at)) < CACHE_TTL_MS) keep[k] = v;
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(keep, null, 1));
  } catch { /* cache is an optimisation, never a dependency */ }
  return keep;
}

async function callModel(notes, { model = MODEL, ollama = OLLAMA } = {}) {
  try {
    const r = await fetch(`${ollama}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, prompt: buildPrompt(notes), stream: false,
        options: { temperature: 0.2, num_predict: 140 },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return parseNaming(j.response || '');
  } catch { return null; }
}

// ── pool: bounded-concurrency fan-out. NOT a sequential await-loop (CLAUDE.md 2026-07-28) and
// not an unbounded Promise.all either — one local ollama serialises past a small width anyway,
// and an unbounded fan-out is how the 10-deep pile-up happened.
export async function pool(items, width, worker) {
  const out = new Array(items.length);
  let i = 0;
  const lane = async () => {
    while (i < items.length) { const k = i++; out[k] = await worker(items[k], k); }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return out;
}

// ── nameItems: [{id, notes}] → Map id → {name, why, source}. `why` is '' whenever no model
// reading was obtained; the caller must then show the raw text rather than invent one.
export async function nameItems(items, opts = {}) {
  const {
    useLLM = process.env.THREAD_NAME_LLM !== '0',
    budgetMs = TOTAL_BUDGET_MS,
    concurrency = CONCURRENCY,
    cachePath = CACHE_PATH,
    now = Date.now(),
  } = opts;
  const out = new Map();
  const cache = loadCache(cachePath);
  const t0 = Date.now();
  const byKey = new Map();          // content key → { notes, ids[] }

  for (const it of items) {
    if (!it || !it.id) continue;
    const notes = String(it.notes || '').trim();
    if (!notes) { out.set(it.id, { name: 'Untitled Strand', why: '', source: 'template' }); continue; }
    const key = cacheKey(notes);
    const hit = cache[key];
    if (hit && hit.why) { out.set(it.id, { name: hit.name, why: hit.why, source: 'cache' }); continue; }
    if (!byKey.has(key)) byKey.set(key, { key, notes, ids: [] });
    byKey.get(key).ids.push(it.id);
  }

  const pending = [...byKey.values()];
  if (useLLM && pending.length) {
    await pool(pending, concurrency, async (job) => {
      if (Date.now() - t0 >= budgetMs) return;                 // budget gone → template, never a hang
      const got = await callModel(job.notes, opts);
      if (got) {
        cache[job.key] = { ...got, at: new Date(now).toISOString() };
        for (const id of job.ids) out.set(id, { ...got, source: 'qwen' });
      }
    });
    saveCache(cache, cachePath, now);
  }

  for (const job of pending) {
    const name = templateName(job.notes);
    for (const id of job.ids) if (!out.has(id)) out.set(id, { name, why: '', source: 'template' });
  }
  return out;
}

// ── namingSummary: the honest provenance line for the footer. Never claims a reading the run
// did not obtain.
export function namingSummary(map, { model = MODEL } = {}) {
  const vals = [...map.values()];
  const read = vals.filter(v => v.why).length;
  if (!vals.length) return { read: 0, total: 0, line: 'no strands to name' };
  if (!read) return { read: 0, total: vals.length, line: `naming unavailable — showing raw asks (${model} did not answer)` };
  return {
    read, total: vals.length,
    line: `${read}/${vals.length} strands named + read by ${model} (local, off the receipt path); counts, bars and extraction stay LLM-free`,
  };
}
