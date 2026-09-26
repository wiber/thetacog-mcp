// scripts/vna/chat-context.mjs — C201 (3) THE CHAT IS WIRED TO THE TREE: the system context a 💬 Steer chat turn is composed with,
// and the tape row that turn writes. (operator 2026-09-23, verbatim: *"hook it uop with the spec / tree etc /steer"* · on gemma answering
// "please provide me with the /steer specification": *"still a no, still not hooked up is this not possible?"*)
//
// Before this the host was a relay: the model got a capability list and nothing else, so "what is the next /steer goal" was answered
// from the model's prior (the population average — W6's insufficient projection). Now every turn is composed with the RECORD:
//   · the snowball the prompt hook already rendered for the active leaf (.thetacog/vna-snowball-sidecar.json — read, never rebuilt:
//     the 55 MB tree parse stays off the chat path, snowball-refresh.mjs keeps the sidecar current)
//   · that leaf's full contract row, read off the spec markdown by label (the same read steer-runner.mjs snowballText does)
//   · the open rows of the spec, label + headline, so "what is next" has an answer on the page
//   · `steer.mjs status` — the goal, the runner, the envelope, exactly as the verb prints it
// and the turn itself goes onto the walk tape through the ONE door (lensWalk, source `chat`), carrying the leaf id and the sha of
// the context it was composed with — so the chat is a door onto /steer, placed like any row.
//
// Transport only: it decides nothing (the leaf is the record's, the placement is the Rust walk), so it stays node (MAXIMISE RUST).
//
//   printf '%s' "$PROMPT" | node scripts/vna/chat-context.mjs --model gemma2:2b [--no-status] [--no-tape]
//   → one JSON line on stdout: { ok, leaf, leafId, context_sha, context, row, why }
// @guard tests/vna/c201-the-chat-is-wired-to-the-tree.test.mjs
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { houseMenu, menuContextBlock } from './house-menu.mjs';   // C314: the derived menu of every skill and door

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const SOURCE = 'chat';
export const OPEN_ROWS_MAX = 12;
export const CONTEXT_CHARS_MAX = 9000;   // gemma2:2b's window is 8k tokens; the context stays well under half of it

const sidecarPath = (repo) => process.env.VNA_SNOWBALL_SIDECAR || resolve(repo, '.thetacog/vna-snowball-sidecar.json');
const specPath = (repo) => resolve(repo, 'docs/specs/vna/SPEC-FROM-TREE.md');

export function readSidecar(repo = REPO) {
  try { const s = JSON.parse(readFileSync(sidecarPath(repo), 'utf8')); return s && Array.isArray(s.lines) && s.leafLabel ? s : null; } catch { return null; }
}
/** the full row for one label, off the spec markdown — the same match steer-runner.mjs snowballText uses */
export function contractRow(md, label) {
  if (!md || !label) return '';
  return (md.split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '').trim();
}
/** open rows (`- [ ] Cn …`), label + the first clause, newest-declared last in file order kept */
export function openRows(md, max = OPEN_ROWS_MAX) {
  const out = [];
  for (const l of String(md || '').split('\n')) {
    const m = /^\s*- \[ \] (C\d+[a-z]?(?:\.\d+)?)\b(.*)$/.exec(l); if (!m) continue;
    const head = m[2].replace(/^\s*\((?:guard|declared|built)[^)]*\)\s*/g, '').replace(/^\s*\((?:guard|declared|built)[^)]*\)\s*/g, '').trim();
    out.push(`${m[1]} — ${head.slice(0, 140)}`);
  }
  return { total: out.length, rows: out.slice(-max) };
}
function steerStatus(repo) {
  const r = spawnSync(process.execPath, [resolve(repo, 'scripts/vna/steer.mjs'), 'status'], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return r.status === 0 ? out : `steer status did not answer (${r.error ? r.error.message : `exit ${r.status}`})${out ? `: ${out.slice(0, 300)}` : ''}`;
}

/** the system context for one chat turn — pure over its inputs, so the guard composes it against a fixture.
 *  `menu` defaults to the live houseMenu() (C314) — a caller wanting a fixed menu (a guard) passes its own array. */
export function composeContext({ sidecar, md, status, menu = houseMenu() }) {
  const label = sidecar ? sidecar.leafLabel : null;
  const row = contractRow(md, label);
  const open = openRows(md);
  const parts = [
    'THE STEER STATE, read off the record this turn (the spec tree, the goal, the runner). Answer questions about /steer, the goal, the spec or what is next FROM THIS — it is the repo\'s own record, not a guess. If the answer is not here, say which of these lines is missing it.',
    '',
    `ACTIVE LEAF: ${label || 'none — no snowball sidecar yet (the prompt hook writes it)'}${sidecar && sidecar.at ? ` · snowball built ${sidecar.at}` : ''}`,
    ...(row ? ['ITS CONTRACT (the spec row, verbatim):', row.slice(0, 2400)] : []),
    ...(sidecar ? ['SNOWBALL (the prompt hook\'s bundle for this leaf):', ...sidecar.lines.filter((l) => !/^contract: /.test(String(l))).map((l) => String(l).slice(0, 400))] : []),
    '',
    `OPEN ROWS (${open.total} unticked in docs/specs/vna/SPEC-FROM-TREE.md; the last ${open.rows.length}):`,
    ...open.rows.map((r) => ` · ${r}`),
    '',
    'STEER STATUS (`/steer status`, run just now):',
    status || '(not run)',
    '',
    menuContextBlock(menu),   // C314 — placed last: enrichment, capped on its own end, so a cut here never costs the record above
  ];
  const text = parts.join('\n');
  return text.length > CONTEXT_CHARS_MAX ? text.slice(0, CONTEXT_CHARS_MAX) + '\n[cut at the chat context cap]' : text;
}
export const contextSha = (text) => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12);

/** the turn's tape row, through the one door; never throws — a failed walk is returned as its own why */
export async function recordChatTurn({ prompt, model, leaf, leafId, context_sha }) {
  try {
    const { lensWalk } = await import('../../src/lib/pmu/walk-door.mjs');   // this checkout's door — VNA_REPO names the data, never the code
    const session = process.env.LENS_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
    const w = lensWalk(String(prompt || '').trim() || '(empty chat turn)', { source: SOURCE, ref: `chat ${leaf || 'no-leaf'}`, session, timeoutMs: 800, extra: { model: String(model || 'UNMEASURED'), leaf: leaf || null, leaf_id: leafId || null, context_sha } });
    const r = w && w.row ? w.row : {};
    return { ok: true, ts: r.ts || null, source: SOURCE, text_sha: r.text_sha || null, sensor: r.sensor || null, leaf: leaf || null, leaf_id: leafId || null, context_sha, why: r.err || null };
  } catch (e) { return { ok: false, source: SOURCE, leaf: leaf || null, context_sha, why: String(e && e.message || e).slice(0, 160) }; }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const i = process.argv.indexOf('--model'); const model = i >= 0 ? process.argv[i + 1] : 'UNMEASURED';
  let prompt = '';
  try { if (!process.stdin.isTTY) { const chunks = []; for await (const c of process.stdin) chunks.push(c); prompt = Buffer.concat(chunks).toString('utf8'); } } catch { prompt = ''; }
  const sidecar = readSidecar(REPO);
  const md = existsSync(specPath(REPO)) ? readFileSync(specPath(REPO), 'utf8') : '';
  const status = process.argv.includes('--no-status') ? '' : steerStatus(REPO);
  const context = composeContext({ sidecar, md, status });
  const context_sha = contextSha(context);
  const leaf = sidecar ? sidecar.leafLabel : null; const leafId = sidecar ? sidecar.leafId || null : null;
  const row = process.argv.includes('--no-tape') ? null : await recordChatTurn({ prompt, model, leaf, leafId, context_sha });
  process.stdout.write(JSON.stringify({ ok: true, leaf, leafId, context_sha, context, row, why: row && !row.ok ? row.why : null }) + '\n');
}
