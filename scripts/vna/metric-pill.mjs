// scripts/vna/metric-pill.mjs — C647d THE EXPANDABLE PILL, ONE COMPONENT FOR TWO HOSTS (operator 2026-10-04: "ship expandable
// pills so we dont bury the user in jargon but show the + button metrics AND the graphs at a glance, hit the + on the bacup
// page the same way to read the mitigations and how to read the graphs etc").
//
// One pure function returns an HTML string; both hosts paint that string and nothing else:
//   • the site — src/components/receipt/MetricPill.tsx mounts the string through KeepOpenHtml (C647m: morph in place, the open
//     state kept per pill id in sessionStorage) on /backup and inside the vega graph (/backup, /backup/curve);
//   • the VS Code sidebar — scripts/vna/steer-ui.mjs paints pillRow(pills, { css: true }) into the page the webview shows
//     (C647e mounts it there); the webview keeps the open state by the same stable id (mp-<id>).
// One stylesheet (PILL_CSS) rides with the pills, so both hosts show the same design: sizes, colours, the + affordance.
//
// CLOSED: one number, its unit, n, and a sparkline of the SAME series (the number is the series' last point). No jargon token
// in the closed face — metricPill REFUSES to emit (throws) rather than paint one, so a pill that would bury a stranger never
// renders. OPEN (the +): HOW TO READ IT · WHAT IT IS NOT SUFFICIENT FOR · THE MITIGATION, each split LEFT BANK (deployer:
// what my agents did, what it cost, what I can show) and RIGHT BANK (underwriter: the tail, the limit declared before the
// work, the recompute). A head missing either bank is a refusal too.
// SUFFICIENT FOR: painting a number someone else measured, with its n and its own series. NOT SUFFICIENT FOR: measuring
// anything — it computes no metric; a null value paints UNMEASURED, never a zero.
// Port row: none — formatting only; no placement, threshold or verdict is decided here.
// @guard tests/vna/c647d-expandable-pills.test.mjs

export const PILL_HEADS = Object.freeze(['HOW TO READ IT', 'WHAT IT IS NOT SUFFICIENT FOR', 'THE MITIGATION']);
const HEAD_KEYS = Object.freeze(['read', 'notFor', 'mitigation']);
export const BANKS = Object.freeze([
  { key: 'left', label: 'LEFT BANK', who: 'deployer' },
  { key: 'right', label: 'RIGHT BANK', who: 'underwriter' },
]);
// tokens a stranger meets as noise on first sight — allowed behind the +, never on the closed face
export const CLOSED_JARGON = Object.freeze(['ShortLex', 'lattice', 'aperture', 'rung', 'basin', 'ballistic', 'tesseract', 'Merkle', 'PMU', 'sigma', 'σ']);
const JARGON_RE = new RegExp(`(^|[^\\p{L}])(${CLOSED_JARGON.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}])`, 'iu');
export const jargonIn = (text) => { const m = String(text || '').match(JARGON_RE); return m ? m[2] : null; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (v) => (Number.isInteger(v) ? v.toLocaleString('en-US') : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** an inline SVG sparkline of `series` (finite numbers only), or a dashed rule labelled "no series" — never invented points */
export function sparkline(series, { w = 96, h = 26, label = '' } = {}) {
  const ys = (Array.isArray(series) ? series : []).map(Number).filter(Number.isFinite);
  const aria = esc(`${label ? `${label}: ` : ''}${ys.length ? `${ys.length} point${ys.length === 1 ? '' : 's'}, last ${fmtNum(ys[ys.length - 1])}` : 'no series'}`);
  if (!ys.length) return `<svg class="mp-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${aria}"><line x1="2" y1="${h / 2}" x2="${w - 2}" y2="${h / 2}" stroke="currentColor" stroke-dasharray="3 3" opacity=".45"/></svg>`;
  const lo = Math.min(...ys); const hi = Math.max(...ys); const pad = 3;
  const x = (i) => (ys.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (ys.length - 1));
  const y = (v) => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo));
  const pts = ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = ys.length - 1;
  const line = ys.length > 1 ? `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  return `<svg class="mp-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${aria}">${line}<circle cx="${x(last).toFixed(1)}" cy="${y(ys[last]).toFixed(1)}" r="2.6" fill="currentColor"/></svg>`;
}

/**
 * metricPill({ id, label, value, unit, n, series, why?, field?, read:{left,right}, notFor:{left,right}, mitigation:{left,right} }) → HTML.
 * `field` names the value for a reader (data-field on the number), e.g. 'vega'.
 * Throws when the closed face carries a jargon token, or when any of the three heads lacks a LEFT or RIGHT bank line.
 * Bank lines are trusted HTML (callers write them; links allowed) — label/unit/why are escaped.
 */
export function metricPill(p) {
  const id = String(p && p.id || '').replace(/[^a-z0-9-]/gi, '');
  if (!id) throw new Error('metricPill: an id is required (the open state survives a repaint by it)');
  for (let i = 0; i < HEAD_KEYS.length; i++) {
    const h = p[HEAD_KEYS[i]] || {};
    for (const b of BANKS) if (!String(h[b.key] || '').trim()) throw new Error(`metricPill ${id}: ${PILL_HEADS[i]} has no ${b.label} (${b.who}) line`);
  }
  const has = p.value != null && Number.isFinite(Number(p.value));
  const n = Number.isFinite(Number(p.n)) ? Number(p.n) : (Array.isArray(p.series) ? p.series.length : 0);
  const valueTxt = has ? fmtNum(Number(p.value)) : 'UNMEASURED';
  const closedText = [p.label, valueTxt, has ? p.unit : p.why, `n=${n}`].filter(Boolean).join(' ');
  const bad = jargonIn(closedText);
  if (bad) throw new Error(`metricPill ${id}: the closed pill carries the jargon token "${bad}" — move it behind the +`);
  const heads = HEAD_KEYS.map((k, i) => `<div class="mp-head" data-head="${esc(PILL_HEADS[i])}"><div class="mp-h">${esc(PILL_HEADS[i])}</div><div class="mp-banks">${BANKS.map((b) => `<div class="mp-bank" data-bank="${b.key}"><div class="mp-bl">${b.label} <span>· ${b.who}</span></div><div class="mp-bt">${p[k][b.key]}</div></div>`).join('')}</div></div>`).join('');
  return `<details class="mpill" id="mp-${id}" data-pill="${id}"><summary class="mp-face" title="${esc(`${p.label} — press + for how to read it, what it is not sufficient for, and the mitigation`)}">`
    + `<span class="mp-plus" aria-hidden="true">+</span>`
    + `<span class="mp-label">${esc(p.label)}</span>`
    + `<span class="mp-num"><b class="mp-value${has ? '' : ' mp-un'}"${p.field ? ` data-field="${esc(p.field)}"` : ''}>${esc(valueTxt)}</b>${has && p.unit ? ` <span class="mp-unit">${esc(p.unit)}</span>` : ''}${!has && p.why ? ` <span class="mp-unit">${esc(p.why)}</span>` : ''}</span>`
    + `<span class="mp-n">n=${fmtNum(n)}</span>`
    + `${sparkline(has ? p.series : [], { label: p.label })}</summary>`
    + `<div class="mp-body">${heads}</div></details>`;
}

/**
 * C650a THE NOTE PILL — the same component closed over prose instead of a number (operator 2026-10-05: "with + pills online to
 * exapnd all the text if wanted, show all the graphs on the online one without having to + though"). Same <details class="mpill">,
 * same face, same +, same stylesheet and the same host (KeepOpenHtml, open state kept by id): the face is a short label (no jargon,
 * refused like metricPill's), the body is trusted HTML the caller writes — the caption, the formula, the long reading a graph used
 * to print above itself. `head` (optional) is one short plain line shown on the face beside the label.
 * notePill({ id, label, head?, body, field? }) → HTML; `field` names the pill for a reader (data-field on the <details>). @guard tests/vna/c650a-graphs-at-a-glance-text-behind-plus.test.mjs
 */
export function notePill(p) {
  const id = String(p && p.id || '').replace(/[^a-z0-9-]/gi, '');
  if (!id) throw new Error('notePill: an id is required (the open state survives a repaint by it)');
  if (!String(p.body || '').trim()) throw new Error(`notePill ${id}: a pill with nothing behind its + is not a pill`);
  const bad = jargonIn(`${p.label} ${p.head || ''}`);
  if (bad) throw new Error(`notePill ${id}: the closed pill carries the jargon token "${bad}" — move it behind the +`);
  return `<details class="mpill mp-note" id="mp-${id}" data-pill="${id}"${p.field ? ` data-field="${esc(p.field)}"` : ''}><summary class="mp-face">`
    // the face is <b>/<i>, never <span>: a page may promise its first <span> sits below its opening line (C535) while a note pill
    // rides in the header above it
    + `<b class="mp-plus" aria-hidden="true">+</b><b class="mp-label">${esc(p.label)}</b>${p.head ? `<i class="mp-head-line">${esc(p.head)}</i>` : ''}</summary>`
    + `<div class="mp-body"><div class="mp-prose">${p.body}</div></div></details>`;
}

/**
 * C667a THE CARD PILL — every titled card on the site is the extension's row (operator 2026-10-05, verbatim: "you reversed the
 * design, instead of reusing the design we worked so hard for in the extension, you put the + on the right side - and no indent
 * for the pills hierarchy … we wanted to show the '+ button metrics' with graph under by default, expand for wording" · "a lot of
 * this needs to be + pill expandables — we worked hard for it on the extension, improve it for tighter backup page").
 * The extension's row (scripts/vna/steer-ui.mjs pillBox): the + at the far LEFT, a bold label chip, "· metric" inline on the same
 * line, the graph UNDER the face while closed, children indented one step under their parent. On the site a card's words and its
 * graph are React, so the card is three slots around this face: <div class="mp-card"> [cardFace] [.mp-words — shown only while
 * the + is open, CSS :has] [.mp-under — the graph, always shown] </div>; the host is src/components/receipt/MetricPill.tsx PillCard.
 * cardFace({ id, label, head?, field? }) → the same <details class="mpill mp-note">, its .mp-body an empty marker (the words sit
 * in .mp-words beside it). Same refusal as notePill: no jargon on the face. @guard tests/vna/c667a-the-extension-pill-design-on-the-site.test.mjs
 */
export const PILL_CARD = Object.freeze({ wrap: 'mp-card', words: 'mp-words', under: 'mp-under' });
export function cardFace(p) {
  const id = String(p && p.id || '').replace(/[^a-z0-9-]/gi, '');
  if (!id) throw new Error('cardFace: an id is required (the open state survives a repaint by it)');
  if (!String(p.label || '').trim()) throw new Error(`cardFace ${id}: a card pill needs its label`);
  const bad = jargonIn(`${p.label} ${p.head || ''}`);
  if (bad) throw new Error(`cardFace ${id}: the closed pill carries the jargon token "${bad}" — move it behind the +`);
  return `<details class="mpill mp-note mp-cardface" id="mp-${id}" data-pill="${id}"${p.field ? ` data-field="${esc(p.field)}"` : ''}><summary class="mp-face">`
    + `<b class="mp-plus" aria-hidden="true">+</b><b class="mp-label">${esc(p.label)}</b>${p.head ? `<i class="mp-head-line">${esc(p.head)}</i>` : ''}</summary>`
    + '<div class="mp-body" data-words="beside"></div></details>';
}

/** a row of pills; `css: true` carries PILL_CSS ahead of them — both hosts pass it, so the design is one */
export function pillRow(pills, { css = false } = {}) {
  return `${css ? `<style>${PILL_CSS}</style>` : ''}<div class="mp-row">${(pills || []).map(metricPill).join('')}</div>`;
}

// One stylesheet for both hosts: colour is inherited (currentColor + translucent rules), so it reads on the site's dark page
// and on any VS Code theme. The face wraps (flex-wrap) — at 420 px the sparkline drops under the number, never over it; the
// banks auto-fit two columns where there is room and stack on a phone. Nothing is wider than its container.
export const PILL_CSS = [
  '.mp-row{display:flex;flex-direction:column;gap:10px;margin:12px 0;min-width:0}',
  '.mpill{border:1px solid rgba(127,127,127,.35);border-radius:10px;background:rgba(127,127,127,.06);min-width:0;max-width:100%;overflow-wrap:anywhere}',
  '.mpill>summary{list-style:none;cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:12px 14px 12px 46px;min-width:0;position:relative}',
  '.mpill>summary::-webkit-details-marker{display:none}',
  // C667a: the extension's face — a square + at the far left (− when open, never a rotated ×), then a bold label chip, then the metric
  ':root{--mp-indent:30px}',
  '.mp-label{flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;letter-spacing:.02em;padding:3px 9px;border:1px solid #2a3a4f;border-radius:4px;background:#16324f;color:#fff}',
  '.mp-num{flex:0 1 auto;min-width:0;white-space:nowrap}.mp-value{font-size:22px;font-variant-numeric:tabular-nums}.mp-value.mp-un{font-size:15px;letter-spacing:.06em}',
  '.mp-unit{font-size:13px;opacity:.75;white-space:normal}.mp-n{font-size:12px;opacity:.65;font-variant-numeric:tabular-nums}',
  '.mp-spark{flex:0 0 auto;display:block;color:#4ec9b0}',
  // the + holds the far-left column (the extension's sticky + column): a wrapped label or number starts right of it, never under it
  '.mp-plus{position:absolute;left:14px;top:17px;flex:0 0 auto;box-sizing:border-box;width:22px;height:22px;border:1px solid #2a3442;border-radius:4px;background:#121821;color:#8fa3bf;display:inline-flex;align-items:center;justify-content:center;font:700 13px/1 ui-monospace,Menlo,monospace}',
  '.mpill[open]>summary .mp-plus{font-size:0;color:#c9d4e3;border-color:#4a5a70}.mpill[open]>summary .mp-plus::after{content:"\\2212";font-size:13px}',
  '.mp-body{padding:0 14px 12px;display:flex;flex-direction:column;gap:12px}',
  '.mp-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#4ec9b0;margin:4px 0 6px}',
  '.mp-banks{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}',
  '.mp-bank{border-left:2px solid rgba(127,127,127,.4);padding:2px 0 2px 10px;min-width:0;font-size:14px;line-height:1.5}',
  '.mp-bank[data-bank="right"]{border-left-color:#ffb000}.mp-bank[data-bank="left"]{border-left-color:#4ec9b0}',
  '.mp-bl{font-size:10.5px;letter-spacing:.1em;opacity:.7;margin-bottom:2px}.mp-bl span{letter-spacing:normal;text-transform:none}',
  '.mp-bt a{color:#7cc4ff}',
  // C650a: the note pill — a slimmer face (label + one short line + the +) and a prose body
  '.mp-note{margin:8px 0}.mp-note>summary{padding:7px 12px 7px 44px;gap:4px 12px}.mp-note>summary>.mp-plus{left:12px;top:10px}.mp-note .mp-label{flex:0 1 auto;font-size:13px}',
  '.mp-head-line{flex:1 1 200px;min-width:0;font-size:13px;opacity:.78;font-style:normal}.mp-head-line::before{content:"· "}',
  '.mp-note .mp-plus{font-weight:700}',
  '.mp-prose{font-size:14px;line-height:1.55;min-width:0;overflow-wrap:anywhere}.mp-prose p{margin:6px 0}.mp-prose ul,.mp-prose ol{margin:4px 0;padding-left:18px}',
  '.mp-prose .d{opacity:.72}.mp-prose code,.mp-prose .m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;font-size:12.5px}',
  '.mp-prose pre{white-space:pre-wrap;font-size:12px;font-family:ui-monospace,Menlo,monospace}.mp-prose a{color:#7cc4ff}',
  // C667a: the card pill — the face, then the words (only while the + is open), then the graph (always); a child card one indent in
  '.mp-card{border:1px solid rgba(127,127,127,.35);border-radius:10px;background:rgba(127,127,127,.06);margin:12px 0;min-width:0;max-width:100%;display:flex;flex-direction:column}',
  '.mp-card .mp-cardface{border:0;background:none;margin:0;border-radius:10px}',
  '.mp-card>.mp-words{padding:0 14px 10px;font-size:14px;line-height:1.55;min-width:0;overflow-wrap:anywhere}.mp-card>.mp-under{padding:0 14px 12px;min-width:0}',
  '.mp-card:not(:has(>[data-card]>.mp-cardface[open])):not(:has(>.mp-cardface[open]))>.mp-words{display:none}',
  '.mp-card>.mp-under:empty{display:none}.mp-card .mp-card{margin:8px 0 8px var(--mp-indent)}',
  '.mp-prose table{width:100%;border-collapse:collapse;font-size:13px}.mp-prose td,.mp-prose th{text-align:left;padding:4px 8px;border-bottom:1px solid rgba(127,127,127,.25);vertical-align:top}',
].join('\n');
