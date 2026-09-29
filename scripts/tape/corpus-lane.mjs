#!/usr/bin/env node
// packages/thetacog-mcp/scripts/tape/corpus-lane.mjs — LANE C: aim the tape at the indexed corpus.
//
// THE GAP (2026-08-24). The tape had two ways in and neither reaches the material that matters most.
// Lane A (chunker) takes plain text files. Lane B (rust --ingest-transcript) harvests recent .jsonl.
// Meanwhile .thetacog/transcripts.db holds 416,115 turns across 14,982 sessions — claude 372k,
// gemini-cli 30k, gemini-web 13k, chatgpt-web 456 — already ingested, already FTS-indexed, already
// carrying mass buckets and a voice column. All of it invisible to the glass, so a tape session was
// stuck reading ONE scratchpad txt while the corpus it should be interrogating sat one query away.
//
// This lane adds no ingest. Everything here is already in sqlite; the lane is a QUERY that emits
// turns in the exact shape lanes A and B produce, so nothing downstream learns a new format.
//
// VOICE, NOT ROLE, decides the intent/reality split. `role` in this corpus carries 20+ transport
// values (attachment, last-prompt, queue-operation, mode…) that say how a line was carried, never
// who meant it. `voice` says who: operator | agent-prompt | assistant | tool-result | system.
// Intent is what the operator asked for; reality is what the machine did. Splitting on role would
// file an `attachment` as reality and an operator's dictated correction as neither.
//
//   node corpus-lane.mjs --q "sufficiency" --slug my-tape
//   node corpus-lane.mjs --q "insurable drift" --corpus claude --limit 400
//   node corpus-lane.mjs --session <session_id> --slug one-session
//   node corpus-lane.mjs --q "..." --dry --json     # inspect the manifest, write nothing
//
// Deterministic and LLM-free: same query + same db state -> same bytes.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const DB = process.env.TRANSCRIPTS_DB || resolve(REPO, '.thetacog/transcripts.db');
const SESSIONS = process.env.TAPE_SESSIONS_DIR || resolve(REPO, '.thetacog/tape-sessions');
const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

// sqlite3 CLI rather than a driver: no native build, and the repo already shells out to it. JSON
// mode keeps quoting out of our hands entirely.
function q(sql) {
  const out = execFileSync('sqlite3', ['-json', DB, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}
const esc = (s) => String(s).replace(/'/g, "''");

// Intent is what the operator asked for; reality is what the machine did. Anything that is neither
// (system scaffolding, tool output) is CARRIED but marked, never silently filed as one of the two —
// a corpus that quietly counts tool-results as reality inflates every coverage number downstream.
const SIDE = { operator: 'intent', 'agent-prompt': 'intent', assistant: 'reality', 'tool-result': 'reality' };

export function pull({ query = null, corpus = null, session = null, limit = 300, minChars = 80 }) {
  if (!existsSync(DB)) return { ok: false, reason: `no corpus at ${DB}`, turns: [] };
  const where = [];
  if (session) where.push(`t.session_id = '${esc(session)}'`);
  if (corpus) where.push(`t.corpus = '${esc(corpus)}'`);
  where.push(`t.chars >= ${Number(minChars) || 0}`);
  where.push(`t.voice IS NOT NULL`);
  where.push(`t.voice != 'system'`);

  const rows = query
    ? q(`SELECT t.session_id, t.seq, t.ts, t.voice, t.corpus, t.chars, t.text
         FROM turns_fts f JOIN turns t ON t.id = f.rowid
         WHERE turns_fts MATCH '${esc(query)}' AND ${where.join(' AND ')}
         ORDER BY t.ts DESC LIMIT ${Number(limit) || 300};`)
    : q(`SELECT t.session_id, t.seq, t.ts, t.voice, t.corpus, t.chars, t.text
         FROM turns t WHERE ${where.join(' AND ')}
         ORDER BY t.ts DESC LIMIT ${Number(limit) || 300};`);

  // Chronological for the tape: a walk over turns is a walk over a conversation, and a conversation
  // read newest-first is a different document. The DESC above is only to take the most recent N.
  rows.reverse();

  const turns = rows.map((r, i) => ({
    index: i,
    role: r.voice === 'operator' || r.voice === 'agent-prompt' ? 'operator' : 'assistant',
    side: SIDE[r.voice] || 'unclassified',
    text: r.text || '',
    source: `corpus:${r.corpus}/${r.session_id}#${r.seq}`,
    ts: r.ts || null,
    voice: r.voice,
    chars: r.chars || (r.text || '').length,
  }));
  return { ok: true, turns };
}

function main() {
  const query = arg('--q');
  const session = arg('--session');
  if (!query && !session && !arg('--corpus')) {
    process.stderr.write('need --q "<fts query>" or --session <id> or --corpus <name>\n');
    process.exit(2);
  }
  const res = pull({
    query, session, corpus: arg('--corpus'),
    limit: Number(arg('--limit', '300')), minChars: Number(arg('--min-chars', '80')),
  });
  if (!res.ok) { process.stderr.write(res.reason + '\n'); process.exit(1); }

  const bySide = res.turns.reduce((a, t) => { a[t.side] = (a[t.side] || 0) + 1; return a; }, {});
  const byCorpus = res.turns.reduce((a, t) => { const c = t.source.split(':')[1].split('/')[0]; a[c] = (a[c] || 0) + 1; return a; }, {});
  const manifest = {
    lane: 'C (corpus sqlite)', db: DB.replace(REPO + '/', ''),
    query: query || null, session: session || null, corpus: arg('--corpus') || null,
    turns: res.turns.length, bySide, byCorpus,
    chars: res.turns.reduce((a, t) => a + t.chars, 0),
  };

  if (has('--json')) { process.stdout.write(JSON.stringify({ manifest, turns: has('--dry') ? [] : res.turns }, null, 2) + '\n'); return; }

  const slug = arg('--slug');
  if (slug && !has('--dry')) {
    const dir = resolve(SESSIONS, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'turns.json'), JSON.stringify(res.turns, null, 2) + '\n');
    writeFileSync(resolve(dir, 'lane-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    manifest.wrote = resolve(dir, 'turns.json').replace(REPO + '/', '');
  }
  process.stderr.write(
    `  lane C · ${manifest.turns} turns · ${Math.round(manifest.chars / 1000)}k chars\n` +
    `  sides: ${Object.entries(bySide).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
    `  corpora: ${Object.entries(byCorpus).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
    (manifest.wrote ? `  wrote: ${manifest.wrote}\n` : '  (not written — pass --slug, or --dry to inspect)\n'));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
