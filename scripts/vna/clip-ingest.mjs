#!/usr/bin/env node
// scripts/vna/clip-ingest.mjs — THE BRIDGE CARD'S ONE-SHOT DOOR (C98e, the eighth paste, 2026-09-19).
//
// ⤵ Ingest Clipboard, one click: clipboard → the steer file under the daemon's own clip stamp (landClip — one append, one
// place) → the tail read (txt-tail-watch.mjs --follow) → the ledger row (amend-ledger.mjs append) → the fold (spec-tree.mjs
// run) — and the fold's OWN return value printed as the receipt: `N new · M attached · R RELEASED`, each released ask named
// by its headline (its first line, cut, never paraphrased) · basin · d. run() already counted added / attached / released;
// this door exposes them instead of dropping them on the floor (the eighth paste: 9 of 12 asks RELEASED, invisible).
//
// THE SAME DECISION AS THE DAEMON: shouldAppend() with the click as consent — a secret never lands and is never logged,
// our own export never comes back in, a path or a word is not a paste, a clip already on the file is refused. The daemon
// (clip-watch.mjs --daemon) keeps polling as it did; a clip this door landed is "already in the file" to it.
//
// The fold dispatch amend-ledger would spawn (C55) is held (VNA_NO_FOLD_DISPATCH) because the fold runs INLINE here and
// its return is the whole point. LLM-FREE: nothing here calls a model.
//
//   node scripts/vna/clip-ingest.mjs --clip            read the clipboard (pbpaste, or VNA_CLIP_CMD) and ingest
//   node scripts/vna/clip-ingest.mjs --file <p>        ingest a file's text (a fixture, a saved paste)
//   node scripts/vna/clip-ingest.mjs --stdin           ingest stdin
//   --no-walk   fold without the Rust walk (tests)   --json   the receipt as one JSON line last   --by <who>
// Exit 0 ingested · 1 refused (the why on the line) · 2 not admissible (no steer file).
// Receipt: .thetacog/vna-clip-ingest.ndjson (VNA_CLIP_INGEST) — one row per ingest; the card reads the last.
// @guard tests/vna/c98e-clip-ingest-door.test.mjs
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { shouldAppend, landClip, steerFile, readClip, MIN_CHARS, outboundShas, pageText, ownRecordText, isSecret, rtfToText } from './clip-watch.mjs';
import { run as fold } from './spec-tree.mjs';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // C94b: the repo being read — the caller's, when `npx thetacog-mcp <door>` runs elsewhere
export const INGEST_RECEIPT = process.env.VNA_CLIP_INGEST || resolve(REPO, '.thetacog/vna-clip-ingest.ndjson');
export const HEADLINE_CHARS = 96;
export const INGEST_CMD = 'node scripts/vna/clip-ingest.mjs --clip';
/** the ask's own first line, cut — never a paraphrase */
export const headline = (text) => String(text || '').trim().split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, HEADLINE_CHARS);

// THE READING OF THE FOLD'S RETURN — pure. attachedIds carries one entry per attached snippet (a basin repeats when it took
// several), and the fold sorts a basin's revisions by `at`, so this run's snippets on a basin are its newest k, k = the
// basin's count in attachedIds. A released one carries `released` on the revision; d is its ncd against the basin.
export function ingestSummary(res) {
  const added = res.added | 0, attached = res.attached | 0, released = res.released | 0;
  const N = (res.tree && res.tree.nodes) || {};
  const per = new Map(); for (const id of res.attachedIds || []) per.set(id, (per.get(id) || 0) + 1);
  const releasedAsks = [];
  for (const [id, k] of per) {
    const n = N[id]; if (!n) continue;
    const snips = (n.revisions || []).filter((r) => r.kind === 'snippet' && !r.retracted);
    for (const r of snips.slice(-k)) if (r.released) releasedAsks.push({ headline: headline(r.text), basin: (n.meta && n.meta.label) || id, pixel: n.pixel || null, d: typeof r.ncd === 'number' ? r.ncd : null });
  }
  return { added, attached, released, line: `${added} new · ${attached} attached · ${released} RELEASED`, releasedAsks };
}

export function readClipIngest(path = INGEST_RECEIPT) {
  try { const t = readFileSync(path, 'utf8').trim().split('\n'); for (let i = t.length - 1; i >= 0; i--) { try { return JSON.parse(t[i]); } catch {} } } catch {}
  return null;
}

const node = (script, args, { input, env } = {}) => spawnSync(process.execPath, [resolve(REPO, 'scripts/vna', script), ...args], { cwd: REPO, encoding: 'utf8', input, env: { ...process.env, ...(env || {}) }, maxBuffer: 1 << 26, timeout: 120000 });

// THE DOOR — returns the receipt row (ok) or the refusal (ok:false, why); the caller decides the exit code.
export async function ingestClip(text, { walk = true, by = 'cli', at = new Date().toISOString() } = {}) {
  const file = steerFile();
  if (!file) return { ok: false, admissible: false, why: 'no steer file — the pointer is absent or empty; open a .txt in the IDE or `node scripts/vna/steer-file.mjs set <path>`' };
  let fileText = ''; try { fileText = readFileSync(file, 'utf8'); } catch { return { ok: false, admissible: false, why: `the steer file ${file} does not exist — an absent file is not an empty one` }; }
  const conv = rtfToText(text); text = conv.text;   // C107a: --file / --stdin may carry RTF — plain text before the decision, so the dedupe and the sha read plain text
  const d = shouldAppend({ text, lastSha: null, fileText, minChars: MIN_CHARS, armed: true, outbound: outboundShas(), page: pageText(), record: ownRecordText() });
  if (!d.append) return { ok: false, admissible: true, why: d.why, bytes: isSecret(text) ? undefined : Buffer.byteLength(text) };
  const landed = landClip(text, { file, at, by, rtf: conv.rtf ? conv.via : null });
  // the tail read, then the ledger row — the same two scripts the IDE's ⤓ tail runs, the fold dispatch held (it runs inline next)
  const tail = node('txt-tail-watch.mjs', ['--follow', '--json']);
  const tailJson = tail.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() || '';
  if (tail.status !== 10 || !tailJson) return { ok: false, admissible: true, landed, why: `the tail read did not see the append (exit ${tail.status}) — ${(tail.stderr || tail.stdout).trim().slice(0, 160)}` };
  const led = node('amend-ledger.mjs', ['append'], { input: tailJson, env: { VNA_NO_FOLD_DISPATCH: '1' } });
  if (led.status !== 0) return { ok: false, admissible: true, landed, why: `the ledger refused the row (exit ${led.status}) — ${(led.stderr || led.stdout).trim().slice(0, 160)}` };
  const res = await fold({ walk, by });
  if (!res.ok) return { ok: false, admissible: true, landed, why: `the fold refused — ${res.why}` };
  const s = ingestSummary(res);
  const row = { at, by, sha8: landed.sha8, bytes: landed.bytes, file: landed.file, root: res.tree.root, rootChanged: !!res.rootChanged, ...s };
  try { mkdirSync(dirname(INGEST_RECEIPT), { recursive: true }); appendFileSync(INGEST_RECEIPT, JSON.stringify(row) + '\n'); } catch {}
  return { ok: true, ...row };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await (async () => {
  const argv = process.argv.slice(2); const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const asJson = argv.includes('--json'); const walk = !argv.includes('--no-walk'); const by = arg('--by') || 'cli';
  let text = null;
  if (argv.includes('--clip')) text = readClip();
  else if (arg('--file')) { try { text = readFileSync(resolve(arg('--file')), 'utf8'); } catch (e) { console.error(`cannot read ${arg('--file')}: ${e.message}`); process.exit(2); } }
  else if (argv.includes('--stdin')) { const chunks = []; for await (const c of process.stdin) chunks.push(c); text = Buffer.concat(chunks).toString('utf8'); }
  else { console.error('usage: clip-ingest.mjs --clip | --file <p> | --stdin [--no-walk] [--json] [--by <who>]'); process.exit(2); }
  if (text == null) { const r = { ok: false, admissible: false, why: 'the clipboard holds no text (an image, or pbpaste unavailable)' }; console.log(asJson ? JSON.stringify(r) : `NOT ADMISSIBLE: ${r.why}`); process.exit(2); }
  const r = await ingestClip(text, { walk, by });
  if (asJson) console.log(JSON.stringify(r));
  else if (r.ok) { console.log(`ingested ${r.bytes}B sha ${r.sha8} → ${r.file}\n${r.line} · root ${String(r.root).slice(0, 12)}${r.rootChanged ? ' (CHANGED)' : ' (unchanged)'}`); for (const a of r.releasedAsks) console.log(`  RELEASED → ${a.basin} (${a.pixel || '—'}) d ${a.d ?? '—'} · ${a.headline}`); }
  else console.log(`${r.admissible === false ? 'NOT ADMISSIBLE' : 'REFUSED'}: ${r.why}`);
  process.exit(r.ok ? 0 : r.admissible === false ? 2 : 1);
})();
