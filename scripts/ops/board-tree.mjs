#!/usr/bin/env node
// scripts/ops/board-tree.mjs — C2170a THE MERKLE TREE AS A SHEET (operator 2026-10-30, verbatim: "we need the full miracle free to be a
// spreadsheet as well and have them interact with each other").
// Every node of data/vna/spec-tree.json, depth first from the root (children in the tree's own order, never re-sorted): ID · YOUR NOTE
// (fill) · CUE · TYPE · the node indented by depth · PARENT · LEAF (10-hex, the same the project sheets print) · STATE (a contract's
// tick off the spec) · HELD BY (the project sheet that carries the row, board-project.mjs holderIndex) · TEXT. The root sits on the
// first data row. LLM-free; transport over the tree — stays node (MAXIMISE RUST: the tree itself is the crate's to build).
//   node scripts/ops/board-tree.mjs --print     the first rows to stdout
//   node scripts/ops/board-tree.mjs             write the sheet "Spec · Tree" (created on first run), cell by cell after that
// @guard tests/ops/c2170a-tree-sheet.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SHEET = 'Spec · Tree';
export const TITLE = '04 · SPEC · TREE — every node of the Merkle tree, root first, depth first; a LEAF here is the LEAF on the project sheets';
export const HEAD = ['ID', 'YOUR NOTE (fill)', 'CUE', 'TYPE', 'NODE', 'PARENT', 'LEAF', 'STATE', 'HELD BY', 'TEXT'];
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1) + '…'; };
export const leafOf = (n) => String((n && n.hash) || '').slice(0, 10);

// tree: the spec-tree.json object · ticks: Map(cue → bool) · held: Map(cue → sheet name)
export function composeTree(tree, { ticks = new Map(), held = new Map() } = {}) {
  const list = Array.isArray(tree.nodes) ? tree.nodes : Object.values(tree.nodes || {});
  const byId = new Map(list.map((n) => [n.id, n]));
  const root = list.find((n) => n.type === 'root') || list.find((n) => !n.parent);
  const out = [HEAD]; const seen = new Set();
  const stack = root ? [[root, 0]] : [];
  while (stack.length) {
    const [n, d] = stack.pop(); if (seen.has(n.id)) continue; seen.add(n.id);
    const t = (n.content && (n.content.headline || n.content.text)) || '';
    const state = n.cue && ticks.has(n.cue) ? (ticks.get(n.cue) ? '✓ ticked' : '☐ open') : '';
    out.push([n.id, '', n.cue || '', n.type || '', `${'  '.repeat(Math.min(d, 8))}${d ? '└ ' : ''}${n.cue || n.id}`, n.parent || '', leafOf(n), state, (n.cue && held.get(n.cue)) || '', clip(t, 140)]);
    const kids = (Array.isArray(n.children) ? n.children : []).map((c) => byId.get(c)).filter(Boolean);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
  }
  // nodes the walk from the root never reached are still nodes: listed after, so no node is dropped from the sheet
  for (const n of list) if (!seen.has(n.id)) out.push([n.id, '', n.cue || '', n.type || '', `⚠ unreached ${n.cue || n.id}`, n.parent || '', leafOf(n), '', (n.cue && held.get(n.cue)) || '', clip((n.content && n.content.text) || '', 140)]);
  return out;
}

export async function compose() {
  const tree = JSON.parse(readFileSync(resolve(REPO, 'data/vna/spec-tree.json'), 'utf8'));
  const P = await import('./board-project.mjs');
  const rows = P.specRows(readFileSync(resolve(REPO, P.SPEC_MD), 'utf8'));
  const ticks = new Map([...rows].map(([id, r]) => [id, r.done]));
  const grid = composeTree(tree, { ticks, held: await P.holderIndex() });
  return [[TITLE, `root ${String(tree.root || '').slice(0, 10)} · ${grid.length - 1} nodes · built ${String(tree.at || '').slice(0, 16)}`], ...grid];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const grid = await compose();
  if (grid.length <= 2) { console.log('✗ refused — no tree nodes read; an empty Tree sheet would claim the tree is empty'); process.exit(1); }
  if (process.argv.includes('--print')) { for (const r of grid.slice(0, 30)) console.log([r[0], r[3], r[4], r[6], r[7], r[8]].map((c) => clip(c, 40)).join(' │ ')); console.log(`… ${grid.length - 2} nodes`); process.exit(0); }
  const { rcloneToken } = await import('./board-comments.mjs'); const { writeSheet } = await import('./board-sheets-write.mjs');
  const t = rcloneToken(); if (!t.token) { console.log(`UNMEASURED — ${t.why}`); process.exit(2); }
  const f = resolve(REPO, 'data/vna/board-drive.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  let id = j.sheets[SHEET];
  if (!id) {
    const r = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: TITLE, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [j.folder.id] }) })).json();
    if (!r.id) { console.log(`✗ create failed: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
    id = r.id; j.sheets = { [SHEET]: id, ...j.sheets }; writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const r = await writeSheet(t.token, id, grid, { name: SHEET });
  console.log(r.refused ? `✗ refused — ${r.why}` : `✓ ${SHEET}: ${r.mode === 'cells' ? `${r.applied} cell(s) written · ${r.appended} appended` : `${r.newRows} rows`} · https://docs.google.com/spreadsheets/d/${id}/edit`);
  process.exit(r.refused ? 1 : 0);
}
