// scripts/vna/spec-worklist.mjs — C204 THE OPEN SPEC IS A CLICKABLE WORK LIST WITH AGGREGATE STATS (operator 2026-09-23, verbatim:
// "Expandable with aggregate stats" · "it's basically the open spec but after it is a list of stats for the upcoming working progress
// that you can click from there or see the emojis showing what state they're in and when you expand them, you get this overview of
// next steps that also proves that the snowballs and everything else has somewhere is the grip").
//
// A READING, NEVER A SECOND COUNT. Every number and every order here is another module's:
//   · the aggregate — open · clear · needs-you · your-act are spec-clarity.mjs classifySpec's counts, untouched; stuck is the /steer
//     loop's own receipt (.thetacog/steer-loop.json `stuck`, C186a) — no receipt → stuck UNMEASURED, never 0
//   · the order — the loop's (C186): CLEAR rows through spec-clarity's orderByWalk (nearest the last commit's block first), then the
//     rows that need you, then your acts, each in spec order — the loop never dispatches those, so they sit after what it will
//   · the state, one emoji per row, first match wins: 🟢 ticked · ⏳ in the loop's running set now · 🔒 a LIVE WIP claim (wip.mjs) on a
//     path the row names, with the claimant's id · 🔴 its guard is committed at HEAD and the row is open (the red witness is on the
//     record, the work is owed) · ⚪ its guard is not in HEAD, or none is named (not written / UNMEASURED). ASSUMPTION, stated: "red in
//     HEAD" is read as "the witness is committed and the row is not ticked" — nothing here RUNS a guard at render time (a render never
//     spawns a test suite), so a committed guard that already passes on an unticked row also reads 🔴 until the tick lands
//   · expanded — the next step (by state and class), the snowball leaf (n_spec_<id> · hash8, the node the hook's SNOWBALL line bundles),
//     its pixel, and its grip: the walk's own verdict on the node (gain · z · needs z_required · admitted | UNMEASURED) — the same
//     receipt the hook serves ("walk gain … z … (needs …)"), read off data/vna/spec-tree.json, never re-walked
// Every collaborator is injectable so the guard runs it over a fixture spec. Zero LLM. Rust port row: none — this composes receipts
// other modules decide (classifySpec, orderByWalk, the loop, the walk) into a list; it decides nothing new.
// @guard tests/vna/c204-the-open-spec-is-a-clickable-work-list.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listClaims, pidLooksLikeSession } from '../ops/wip.mjs';
import { classifySpec, orderByWalk, lastCommitPlacement, treeFresh, onDisk, CLEAR, NEEDS, ACT, REPO, SPEC_MD } from './spec-clarity.mjs';

export const LOOP_JSON = process.env.VNA_STEER_LOOP_JSON || resolve(REPO, '.thetacog/steer-loop.json');
export const WORKLIST_CAP = 12;
export const STATES = { ticked: '🟢', running: '⏳', locked: '🔒', red: '🔴', unwritten: '⚪' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// a loop receipt whose pid is gone is not "running now" — its running set is history
const pidAlive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function readLoop(path = LOOP_JSON, { alive = pidAlive } = {}) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return { ...j, live: !!(j.live && alive(j.pid)) }; } catch { return null; }
}

export function rowState(row, { claims = [], loop = null, tracked = () => false } = {}) {
  if (row.ticked) return { state: 'ticked', emoji: STATES.ticked, why: 'ticked' };
  if (loop && loop.live && (loop.running || []).includes(row.id)) return { state: 'running', emoji: STATES.running, why: `dispatched now — the /steer loop (pid ${loop.pid}) holds it` };
  const held = claims.find((c) => c.live && (row.paths || []).includes(c.path));
  if (held) return { state: 'locked', emoji: STATES.locked, why: `WIP claim on ${held.path} by ${String(held.session).slice(0, 8)}${held.note ? ` — ${held.note}` : ''}` };
  if (row.guard && tracked(row.guard)) return { state: 'red', emoji: STATES.red, why: `guard ${row.guard} is in HEAD, the row is open` };
  return { state: 'unwritten', emoji: STATES.unwritten, why: row.guard ? `guard ${row.guard} is not in HEAD — not written / UNMEASURED` : 'no guard named — UNMEASURED' };
}

export function nextStep(r) {
  if (r.state === 'running') return 'the worker is on it — its verdict lands in .thetacog/runner.ndjson';
  if (r.state === 'locked') return `wait for the claimant or message it — ${r.why}`;
  if (r.class === ACT) return `your act — ${(r.missing || [])[0] || 'the row hands it to you'}`;
  if (r.class === NEEDS) return `needs you — ${(r.missing || []).join('; ')}`;
  if (r.state === 'red') return `make ${r.guard} green, then tick ${r.id}`;
  return `write ${r.guard || 'its guard'} and see it red, then build ${r.id}`;
}

export function gripOf(node) {
  const w = node && node.walk;
  if (!w || w.gain == null) return 'grip UNMEASURED — the tree has not walked this row';
  return `gain ${w.gain} · z ${w.z ?? '—'} · needs ${w.z_required ?? '—'} · ${w.admissible ? 'admitted' : 'UNMEASURED (not admitted)'}`;
}

/** the list: spec-clarity's rows, the loop's order, one state each, the tree's receipts attached — pure over what it is handed */
export function workList({ md, tree, origin, claims = [], loop = null, tracked = () => false, exists = (p) => onDisk(p), cap = WORKLIST_CAP } = {}) {
  const c = classifySpec(md, { exists });
  const ordered = orderByWalk(c.rows.filter((r) => r.class === CLEAR), { tree, from: origin });
  const rest = c.rows.filter((r) => r.class === NEEDS).concat(c.rows.filter((r) => r.class === ACT));
  const nodes = (tree && tree.nodes) || {};
  const all = [...ordered.rows, ...rest].map((r) => {
    const n = nodes[`n_spec_${r.id}`] || null;
    const s = rowState({ id: r.id, ticked: !!c.ticked[r.id], guard: r.guard, paths: r.paths }, { claims, loop, tracked });
    const row = { id: r.id, line: r.line, class: r.class, headline: r.headline, guard: r.guard, missing: r.missing, d: r.d ?? null, ...s,
      leaf: n ? `${n.id} · ${String(n.hash || '').slice(0, 8)}` : `n_spec_${r.id} · not in the tree yet`, pixel: (n && n.pixel) || 'UNMEASURED', grip: gripOf(n) };
    return { ...row, next: nextStep(row) };
  });
  return { counts: { ...c.counts, stuck: loop && Number.isFinite(Number(loop.stuck)) ? Number(loop.stuck) : null }, order: ordered.reason, rows: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

export const aggregateLine = (w) => `open ${w.counts.open} · clear ${w.counts.clear} · stuck ${w.counts.stuck ?? 'UNMEASURED'} · needs-you ${w.counts.needs} · your-act ${w.counts.act}`;

/** the live reading — the spec on disk, the tree, the last commit's pixel, the claims on the listed rows' paths, the loop receipt */
export function readWorkList({ tracked, specPath = SPEC_MD, tree = undefined } = {}) {
  if (!existsSync(specPath)) return null;
  try {
    const md = readFileSync(specPath, 'utf8'); const named = new Set(classifySpec(md).rows.flatMap((r) => r.paths));
    // liveness is one `ps` per claim — asked only for the claims on a path some open row names, never all of them
    const claims = listClaims({ psRead: () => '' }).filter((c) => named.has(c.path)).map((c) => ({ ...c, live: pidLooksLikeSession(c.pid) }));
    return workList({ md, tree: tree === undefined ? treeFresh() : tree, origin: lastCommitPlacement(), claims, loop: readLoop(), tracked });
  } catch { return null; }
}

// NO NESTED <details>: the list rides the 📄 pill's ▸ more drawer, and a <details> inside a <details> breaks every guard that strips a fold
// by its class (c95a · c98d · c100a · steer-ui-cards read the drawer to its first </details>). A row expands by a click on its line — a
// class toggle (.wl-row.open shows .wl-x, PAGE_CSS) — and its id is the <a> door, which stops the click from toggling
export function renderWorkList(w) {
  if (!w) return '';
  const rows = w.rows.map((r) => `<div class="c3l wl-row" id="wl-${esc(r.id)}"><div class="wl-h" onclick="this.parentNode.classList.toggle('open')" title="${esc(r.why)} — click to expand the next step and the proof"><span class="wl-st">${r.emoji}</span> <a class="bd ref wl-id" data-line="${r.line}" onclick="event.preventDefault();event.stopPropagation();go('vna.viewUnit','${esc(r.id)}')" title="open docs/specs/vna/SPEC-VNA-COCKPIT.md at line ${r.line} (vna.viewUnit)">${esc(r.id)}</a> <span class="dim">d ${r.d ?? '—'}</span> <span class="ttl2">${esc(r.headline)}</span></div>`
    + `<div class="wl-x dim">next: ${esc(r.next)}<br>snowball leaf ${esc(r.leaf)} · pixel ${esc(r.pixel)} · grip ${esc(r.grip)}</div></div>`).join('');
  return `<div class="wlist" id="wlist"><div class="c3l wl-agg" title="the open spec as a work list — the counts are spec-clarity.mjs's, stuck is the /steer loop's receipt; the rows in the loop's own order (${esc(w.order)}); click a row to expand it, click its id to open its line">📋 ${esc(aggregateLine(w))}</div>${rows}${w.more ? `<div class="c3l dim">+${w.more} more — node scripts/vna/spec-clarity.mjs</div>` : ''}</div>`;
}
