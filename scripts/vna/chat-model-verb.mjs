// scripts/vna/chat-model-verb.mjs — C207 THE CONTROL MODEL CALLS /steer ITSELF, AND ANSWERS FOR IT: the tape row a
// model-issued verb writes BEFORE the host runs it. (operator 2026-09-23, verbatim: "the air control loop from first
// controller from Gemma whatever through the extension needs to be able to call the terminal command so actually execute
// the sub agents as well. They need to be responsible.")
//
// RESPONSIBLE = on the record. The extension host (CJS, vna-chat-inline.ts) cannot import the ESM walk door, so it spawns
// this relay through the same node door every steer verb takes and hands it the reply on stdin. The row goes through
// lensWalk — the ONE door onto .thetacog/walk-tape.ndjson — with source `chat-model`, so it is walked, signed and placed
// like any other row, never a hand-typed ndjson line. What the row carries beyond the walk: the model tag, the verb and
// its args, and the sha + head of the reply that proposed it. This file DECIDES nothing (the parse is modelVerbOf in the
// host; the placement is the Rust walk) — transport only, so it stays node (MAXIMISE RUST: what decides or holds mass ports).
//
//   printf '%s' "$REPLY" | node scripts/vna/chat-model-verb.mjs --model gemma2:2b --verb status [--args '["--json"]']
//   → one JSON line on stdout: { ok, tape, ts, source, ref, text_sha, model, verb, args, reply_sha, sensor, why }
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lensWalk, WALK_TAPE } from '../../src/lib/pmu/walk-door.mjs';

export const SOURCE = 'chat-model';
export const REPLY_HEAD_CHARS = 240;

function arg(name, dflt = null) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : dflt; }

/** the row fields for a model-issued verb — pure, so the guard can read them without a walk */
export function modelVerbRowFields({ model, verb, args = [], reply = '' }) {
  const reply_sha = createHash('sha256').update(String(reply || '')).digest('hex').slice(0, 12);
  return { model: String(model || 'UNMEASURED'), verb: String(verb), args: Array.isArray(args) ? args.map(String) : [], reply_sha, reply_head: String(reply || '').slice(0, REPLY_HEAD_CHARS) };
}

/** walk the reply through the one door and append the chat-model row; never throws — a failed walk is still a row (sensor unmeasured) */
export function recordModelVerb({ model, verb, args = [], reply = '', tape = WALK_TAPE, session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null } = {}) {
  const extra = modelVerbRowFields({ model, verb, args, reply });
  const text = reply && String(reply).trim() ? String(reply) : `/steer ${verb} ${extra.args.join(' ')}`.trim();
  try {
    const w = lensWalk(text, { source: SOURCE, ref: `steer ${verb}`, tape, session, timeoutMs: 800, extra });
    const row = w && w.row ? w.row : {};
    return { ok: true, tape, ts: row.ts || null, source: SOURCE, ref: row.ref || `steer ${verb}`, text_sha: row.text_sha || null, sensor: row.sensor || null, ...extra, why: row.err || null };
  } catch (e) {
    return { ok: false, tape, ts: null, source: SOURCE, ref: `steer ${verb}`, text_sha: null, sensor: null, ...extra, why: String(e && e.message || e).slice(0, 160) };
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const model = arg('--model', 'UNMEASURED'); const verb = arg('--verb');
  if (!verb) { process.stdout.write(JSON.stringify({ ok: false, why: 'no --verb' }) + '\n'); process.exit(2); }
  let args = []; try { args = JSON.parse(arg('--args', '[]')); } catch { args = []; }
  let reply = '';
  try { if (!process.stdin.isTTY) { const chunks = []; for await (const c of process.stdin) chunks.push(c); reply = Buffer.concat(chunks).toString('utf8'); } } catch { reply = ''; }
  const out = recordModelVerb({ model, verb, args, reply });
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(out.ok ? 0 : 1);
}
