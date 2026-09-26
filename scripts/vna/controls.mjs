#!/usr/bin/env node
// scripts/vna/controls.mjs — THE CONTROLS MANIFEST OF THE LEFT PANEL (C89a, operator 2026-09-18: "when you email me the
// rounds include a full-text dump of what buttons and controls are painted and what they stand for in the left panel —
// that's where a lot of this work is gonna come in; we're gonna have to reiterate on that to make sure we are saying
// exactly the right things"). DERIVED, NEVER TYPED: the manifest is parsed from the page steer-ui.mjs writes and the
// sidebar mounts byte-for-byte (docs/specs/vna/steer/latest.html), so the dump cannot disagree with the panel. A control
// is every click target — <button>, a <label> wrapping an input, the <summary> of a NAMED <details> (the persisted
// drawers; the spec tree's thousands of summaries are data, not controls), and each triptych panel (.tp) — with the tier
// and card from its enclosing container, its command, its label and its tooltip. An untitled control is MISSING TOOLTIP
// and counted, so the page at HEAD can be held to zero (C89 invariant 1). The README section is rendered from the same
// manifest between two markers (invariant 7: the documentation and the tooltips are one text). No DOM library: a small
// tag tokenizer with a container stack is enough for the page's own HTML and keeps this file dependency-free.
//   node scripts/vna/controls.mjs                 print the dump for latest.html
//   node scripts/vna/controls.mjs --write         also write docs/specs/vna/steer/CONTROLS.txt
//   node scripts/vna/controls.mjs --readme        also regenerate the README section between the markers
//   node scripts/vna/controls.mjs --page <html>   another page (a fixture, an older render)
// @guard tests/vna/c89-controls-manifest.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '..', '..');
export const PAGE = resolve(REPO, 'docs/specs/vna/steer/latest.html');
export const DUMP = resolve(REPO, 'docs/specs/vna/steer/CONTROLS.txt');
export const README = resolve(REPO, 'packages/thetacog-mcp-vscode/README.md');
export const README_MARKERS = ['<!-- controls:begin — rendered by node scripts/vna/controls.mjs --readme; do not edit by hand -->', '<!-- controls:end -->'];
export const MISSING = 'MISSING TOOLTIP';
// the tier of a container (C89: T1 the walk · T2 the four cards · T3 engine telemetry · T4 the host pill · T5 the rest)
const TIER_OF = [[/\btriptych\b/, 1], [/\bcard3\b/, 2], [/\btelemetry\b/, 3], [/\bhb\b|\bpill\b/, 4]];
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
const DATA = /\b(tree|rail|sn|lf|l2|l3)\b/;   // containers whose summaries are data rows, never controls

const attrsOf = (s) => { const o = {}; for (const m of s.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) o[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''; return o; };
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (s) => unesc(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const cmdOf = (a) => { const m = /go\(\s*'([^']+)'/.exec(a.onclick || a.onchange || '') || /go\(\s*this\.checked\s*\?\s*'([^']+)'/.exec(a.onchange || ''); return m ? m[1] : null; };

// The manifest: walk the tags once with a stack of open elements; a control is emitted when its closing tag arrives
// (so its label is the text between), with the tier/card/drawer read off the stack at that moment.
export function controlsManifest(html) {
  const out = []; const stack = []; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g; let m;
  const enclosing = () => {
    let tier = 5, card = null, drawer = null;
    for (const el of stack) {
      const cls = el.attrs.class || '';
      for (const [rx, t] of TIER_OF) if (rx.test(cls) && tier === 5) tier = t;
      if (/\bcard3\b/.test(cls) || /\btriptych\b/.test(cls) || /\bwb\b/.test(cls) || /\bwatched\b/.test(cls) || /\bingest\b/.test(cls)) card = el.card || card;
      if (el.tag === 'details' && el.attrs.id) drawer = el.attrs.id;
    }
    return { tier, card, drawer };
  };
  while ((m = re.exec(html))) {
    const [, close, tagRaw, attrStr] = m; const tag = tagRaw.toLowerCase();
    if (!close) {
      const attrs = attrsOf(attrStr); const el = { tag, attrs, start: re.lastIndex, card: null };
      if (tag === 'div' && /\b(card3|triptych|wb|watched|ingest)\b/.test(attrs.class || '')) {   // its name is the first <b> inside
        // C103d: the primary button closes before the name is painted (the name rides the spark line behind the +), so the name is
        // read AHEAD — the first <b> inside this container, before the next card — and set the moment the container opens
        el.pendingCard = true;
        const ahead = html.slice(re.lastIndex, re.lastIndex + 20000); const nextCard = ahead.search(/<div class="(?:card3|triptych|wb|watched|ingest)\b/); const scope = nextCard > 0 ? ahead.slice(0, nextCard) : ahead;
        const b = /<b(?:\s[^>]*)?>([\s\S]*?)<\/b>/.exec(scope); if (b) { el.card = text(b[1]); el.pendingCard = false; }   // <b> or <b class>, never <button>
      }
      if (tag === 'div' && /\btp\b/.test(attrs.class || '')) {   // a triptych panel: the control is the panel itself
        const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(html.slice(re.lastIndex, re.lastIndex + 400));
        const { tier, card, drawer } = enclosing();
        out.push({ tier, card, drawer, kind: 'canvas', cmd: null, label: h3 ? text(h3[1]) : '(panel)', title: attrs.title ? unesc(attrs.title) : MISSING, cls: attrs.class || '', ctx: false, metric: null });
      }
      if (attrStr.trim().endsWith('/') || VOID.has(tag)) continue;
      stack.push(el);
      // the fallback names the NEAREST container only — a nested card (NEXT → inside the triptych) never names its parent
      if (tag === 'b') { const parent = [...stack].reverse().find((p) => /\b(card3|triptych|wb|watched|ingest)\b/.test(p.attrs.class || '')); if (parent && parent.pendingCard) { const b = /^([\s\S]*?)<\/b>/.exec(html.slice(re.lastIndex)); if (b) { parent.card = text(b[1]); parent.pendingCard = false; } } }
      continue;
    }
    // closing tag: pop to the matching open (tolerate stray closes)
    let i = stack.length - 1; while (i >= 0 && stack[i].tag !== tag) i--;
    if (i < 0) continue;
    const el = stack[i]; const inner = html.slice(el.start, m.index); stack.length = i;
    // a <label> wrapping a DISABLED <input> is not a click target — the aperture's per-file rows (.aprow, C115z) are a display
    // list, checkbox "disabled" because unticking is not wired yet (C123g); their label carries the render's own bytes/percentages
    // and can never be pre-documented in the README, the same reason the tree's per-node summaries are excluded by DATA above
    const isControl = tag === 'button' || (tag === 'label' && /<input\b/.test(inner) && !/<input\b[^>]*\bdisabled\b/.test(inner)) || (tag === 'summary' && stack[i - 1 + 1] === undefined && (() => { const d = stack[stack.length - 1]; return d && d.tag === 'details' && !!d.attrs.id && !stack.some((p) => DATA.test(p.attrs.class || '')); })());
    if (!isControl) continue;
    const { tier, card, drawer } = enclosing();
    const details = tag === 'summary' ? stack[stack.length - 1] : null;
    // a control painted once PER DATA ROW (the tree's per-node 📋, a rail row's button) is ONE control painted N times:
    // collapsed onto its first occurrence with a count, so the dump lists kinds of control, never thousands of rows
    const perRow = stack.some((p) => DATA.test(p.attrs.class || ''));
    // C103d: a primary button carries its card's metric in <span class="measure"> — the label is the head before it (`<emoji> <Verb> <object>`,
    // the construct C102d's guard reads), the metric its own field, read off the receipt; a control without a measure is its whole text
    // C150d (operator 2026-09-21: the metric "cannot be on the action button"): a primary's metric is the button's NEXT SIBLING — `</button> · <span class="measure">…</span>` — so the sticky lead floats and the counts scroll under it; a secondary (.sb) may still carry its measure inside
    const mi = tag === 'button' ? inner.indexOf('<span class="measure">') : -1;
    const sib = tag === 'button' && mi < 0 ? /^ · <span class="measure">([\s\S]*?)<\/span>(?=<|$)/.exec(html.slice(m.index + m[0].length)) : null;
    const label = mi >= 0 ? text(inner.slice(0, mi)).replace(/\s*·\s*$/, '') : text(inner); const metric = mi >= 0 ? text(inner.slice(mi)) : sib ? text(sib[1]) : null; const title = el.attrs.title ? unesc(el.attrs.title) : MISSING;
    if (perRow) { const prev = out.find((c) => c.perRow && c.kind === (tag === 'label' ? 'label' : tag) && c.label === label && c.title === title); if (prev) { prev.count++; continue; } }
    // C102d: the class (the one primary .action per card) and whether the control sits behind ⋮ (details.ctx) — read off the stack, for the discipline guard
    const ctx = stack.some((p) => p.tag === 'details' && /\bctx\b/.test(p.attrs.class || ''));
    out.push({ perRow, count: 1, tier, card, metric, cls: el.attrs.class || '', ctx, drawer: tag === 'summary' ? (drawer === details.attrs.id ? null : drawer) : drawer, kind: tag === 'label' ? 'label' : tag, cmd: tag === 'summary' ? details.attrs.id : tag === 'label' ? cmdOf(attrsOf((/<input\b([^>]*)>/.exec(inner) || ['', ''])[1])) || cmdOf(el.attrs) : cmdOf(el.attrs), label, title });
  }
  return out;
}

const head = (c) => `[T${c.tier}${c.card ? ' · ' + c.card : ''}${c.drawer ? ' ▸ ' + c.drawer : ''}]${c.count > 1 ? ` ×${c.count} (one per row)` : ''}`;
const what = (c) => (c.kind === 'canvas' ? 'panel' : c.cmd || c.kind);
export function renderControlsText(manifest, { page = 'docs/specs/vna/steer/latest.html' } = {}) {
  const missing = manifest.filter((c) => c.title === MISSING).length;
  const lines = manifest.map((c) => `${head(c)} ${c.label}${c.metric ? ' · <metric>' : ''} — ${what(c)} — ${c.title === MISSING ? MISSING : JSON.stringify(c.title)}`);
  return [`THE LEFT PANEL — every control painted, what it stands for (derived from ${page}; never typed)`, `${manifest.length} controls · ${MISSING}: ${missing} of ${manifest.length}`, '', ...lines, ''].join('\n');
}

export function readmeSection(manifest) {
  const byCard = new Map();
  for (const c of manifest) { const k = `T${c.tier} · ${c.card || 'the page'}`; if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(c); }
  const body = [...byCard].map(([k, cs]) => `### ${k}\n\n${cs.map((c) => `- **${c.label}** (\`${what(c)}\`)${c.drawer ? ` · in ▸ ${c.drawer}` : ''} — ${c.title === MISSING ? MISSING : c.title}`).join('\n')}`).join('\n\n');
  return `${README_MARKERS[0]}\n## The left panel — every control, what it stands for, what next\n\nEvery button, drawer and panel in the ThetaCog sidebar, with the tooltip it carries. This section is rendered from the painted page (\`node scripts/vna/controls.mjs --readme\`), so it says exactly what the panel says. A tooltip names what the control does, where the result lands, and what to do next.\n\n${body}\n${README_MARKERS[1]}`;
}

// THE UNION OF STATES: a page render shows ONE state per stateful control (Run Headless OR Abort; the update pill only
// when the installed build lags; the lane actions only when PAUSED). The README documents every state, so the manifest
// for the README is the page's ∪ the state-dependent fragments rendered over fixtures through steer-ui's own pure
// functions — never a typed list of "the other buttons". Keyed by label|cmd; the page's title wins on a collision.
export async function unionManifest(html) {
  const ui = await import('./steer-ui.mjs');
  const frags = [];
  try { frags.push(ui.buildLag({ ext: '0.0.0', source: '0.0.1' }).html); } catch {}
  // C124 (b07ef9d2fa, 2026-09-20) gave buildLag a THIRD version (code) and two more states this fixture never exercised —
  // WINDOW-STALE (ext ≠ code) and INSTALL-STALE (code ≠ source, its own "⧉ copy the command" button) — so their controls
  // never reached the README's union. The two-arg LAG call above stays (a pre-C124 window carries no code at all).
  try { frags.push(ui.buildLag({ ext: '0.0.0', code: '0.0.1', source: '0.0.1' }).html); } catch {}
  try { frags.push(ui.buildLag({ ext: '0.0.0', code: '0.0.1', source: '0.0.2' }).html); } catch {}
  try { frags.push(`<div class="hb">${ui.heartbeat({ ingestAt: new Date().toISOString(), readAt: new Date().toISOString(), behind: 1, armed: true, daemonPid: 1 }).line}</div>`); } catch {}
  const runner = (state) => ({ state, line: state, at: new Date().toISOString() });
  for (const r of [runner('RUNNING'), runner('PAUSED'), runner('IDLE')]) { try { frags.push(ui.renderCards({ runner: r, clip: { armed: false }, entitlement: null, notary: { label: '⚪ · PRE-RELEASE' } })); } catch (e) { frags.push(''); } }
  try { frags.push(ui.renderCards({ runner: runner('IDLE'), clip: { armed: true, daemon: 1 }, entitlement: { credits: 3, exp: 0, pubkey_fingerprint: 'fixture' }, notary: { label: '🟢 Notarized', verified: 1, rows: 1 } })); } catch {}
  const seen = new Map(); const key = (c) => `${c.label}|${c.cmd || c.kind}`;
  for (const c of controlsManifest(html)) seen.set(key(c), c);
  for (const f of frags) for (const c of controlsManifest(f)) if (!seen.has(key(c))) seen.set(key(c), { ...c, tier: c.tier === 5 ? 4 : c.tier, state: 'alternate' });
  return [...seen.values()].sort((a, b) => a.tier - b.tier);
}

async function main() {
  const argv = process.argv.slice(2); const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const page = arg('--page') || PAGE; const html = readFileSync(page, 'utf8');
  const m = controlsManifest(html); const txt = renderControlsText(m, { page: page.replace(REPO + '/', '') });
  process.stdout.write(txt);
  if (argv.includes('--write')) { writeFileSync(DUMP, txt); console.log(`wrote ${DUMP}`); }
  if (argv.includes('--readme')) {
    const r = readFileSync(README, 'utf8'); const i = r.indexOf(README_MARKERS[0]); const j = r.indexOf(README_MARKERS[1]);
    const u = await unionManifest(html); const sec = readmeSection(u);
    const next = i >= 0 && j > i ? r.slice(0, i) + sec + r.slice(j + README_MARKERS[1].length) : r.replace(/\n## License/, `\n${sec}\n\n## License`);
    writeFileSync(README, next); console.log(`README section ${i >= 0 ? 'replaced' : 'inserted'} · ${u.length} controls (${u.length - m.length} from alternate states)`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
