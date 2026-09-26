// packages/intentguard-vscode/src/vna-envelope-render.ts — THE ENVELOPE CARD, rendered for the IDE.
//
// PURE. This file imports nothing from vscode and computes nothing about the lattice. It takes the
// one JSON object `scripts/vna/envelope.mjs --json` prints and turns it into HTML. Every number,
// every coordinate and every name on the page arrived in that object; if a field is absent the page
// says so rather than filling it in. That is what lets the guard in tests/vna/ load this module in
// plain node and drive it with the emitter's real output.
//
// THE DIRECTION OF THE THING (operator, 2026-09-08): "instead of the water wanting to go through
// the holes in the net, the water sticks to the net. You do whatever it's going to do, and then you
// check if you can use the tesseract as a signal to redirect afterwards ... and run that operation
// continuously as many times as you can. That's what a cockpit does." So this page never gates
// anything. It shows where the work landed, offers the two restoring arms, and records which one
// the operator took — then the cycle runs again. Drift is the INPUT to this page, never its failure.
//
// BOTH ARMS ALWAYS RENDER, EMPTY OR NOT. "Nothing declared-but-unworked" is information; a page
// that showed one recommendation would be the foreclosed alternative named in envelope.test.mjs.

export interface Placed { id?: string; text?: string; coord: string; name?: string; margin?: number; sha?: string }
export interface MoveWork { target: Placed; distanceFromWork: number; alsoUnworked: number; closesPct: number | null }
export interface MoveDecl { coord: string; name?: string; commits: string[]; n: number; totalUndeclared: number; repeated: boolean }
export interface EnvelopeCycle {
    decl: Placed[]; confident: Placed[]; abstained: Placed[];
    work: Placed[]; unworked: Placed[]; undeclared: Placed[];
    pull: number | null; fence: number; limit: number; floor: number;
    moveWork: MoveWork | null; moveDecl: MoveDecl | null;
    names: Record<string, string>; card: string;
    // the emitter's identity for THIS cycle — handed back on a pick so a choice made against a
    // state that has since moved records as stale rather than passing as a real one
    cycleId?: string;
    ledger: { path: string; count: number };
    pick?: { at: string; arm: string; note: string; cycleId?: string; shownId?: string | null; stale?: boolean | null } | null;
}
export interface EnvelopeView {
    cycle: EnvelopeCycle;
    cycleCount: number;        // cycles run in this panel's lifetime — the "as many times as you can"
    pulls: (number | null)[];  // PULL per cycle, oldest first; a falling series IS the water sticking
    lastPick?: { arm: string; at: string } | null;
}

export const esc = (s: unknown): string =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// A coordinate is never shown bare. The name comes from the emitter (`name` on the item, or the
// `names` map); if the emitter did not send one, the page prints "(unnamed by emitter)" beside the
// coordinate rather than expanding it here — expansion is the emitter's job, and a second expander
// is a second answer.
export function coordLabel(c: EnvelopeCycle, coord: string, name?: string): string {
    const n = name || c.names?.[coord];
    return `<span class="coord">${esc(coord)}</span> <span class="name">${n ? esc(n) : '(unnamed by emitter)'}</span>`;
}

function pullSeries(pulls: (number | null)[]): string {
    if (!pulls.length) { return '<span class="dim">no cycles yet</span>'; }
    const nums = pulls.filter((p): p is number => typeof p === 'number');
    const first = nums[0], last = nums[nums.length - 1];
    let verdict = '<span class="dim">pull unmeasured this cycle</span>';
    if (nums.length >= 2 && typeof first === 'number' && typeof last === 'number') {
        verdict = last < first ? `<span class="good">falling ${first} → ${last} — the water is sticking</span>`
            : last > first ? `<span class="warn">rising ${first} → ${last} — the work is moving away from the declaration</span>`
            : `<span class="dim">flat at ${last}</span>`;
    } else if (nums.length === 1) { verdict = `<span class="dim">${first} — one reading, no direction yet</span>`; }
    const series = pulls.map((p) => `<span class="tick">${p == null ? '—' : esc(p)}</span>`).join('');
    return `${series}<div class="verdict">${verdict}</div>`;
}

export function renderEnvelopeHtml(v: EnvelopeView): string {
    const c = v.cycle;
    const mw = c.moveWork, md = c.moveDecl;

    const arm1 = mw
        ? `<p>aim the next commit at <b>${esc(mw.target.id)}</b> — ${coordLabel(c, mw.target.coord, mw.target.name)}</p>
           <p class="quote">“${esc((mw.target.text || '').slice(0, 120))}”</p>
           <p>${esc(mw.distanceFromWork)} blocks from where the work already is${mw.closesPct != null ? ` · closes ~${esc(mw.closesPct)}% of the pull` : ''}</p>
           ${mw.alsoUnworked ? `<p class="dim">${esc(mw.alsoUnworked)} other declared item(s) also unworked</p>` : ''}`
        : `<p class="empty">nothing declared-but-unworked — the work is covering the declaration</p>`;

    const arm2 = md
        ? `<p>the work keeps landing at ${coordLabel(c, md.coord, md.name)} and the spec never named it</p>
           <p>${esc(md.n)} commit(s): <code>${md.commits.map(esc).join(', ')}</code> ${md.repeated ? '<span class="good">← repeated, so a signal not noise</span>' : '<span class="dim">← single landing, may be noise</span>'}</p>
           <p>amend the checklist to declare it, or decide the drift was wrong${md.totalUndeclared > md.n ? ` <span class="dim">(${esc(md.totalUndeclared)} undeclared landings in total)</span>` : ''}</p>`
        : `<p class="empty">nothing worked-but-undeclared — the declaration covers the work</p>`;

    // Abstained items get their own list and NO button. They are not targets and not failures: the
    // placer refused to aim at something it could not place above the calibrated floor.
    const abstained = c.abstained.length
        ? `<ul>${c.abstained.map((a) => `<li><b>${esc(a.id)}</b> ${esc((a.text || '').slice(0, 90))} <span class="dim">margin ${esc(typeof a.margin === 'number' ? a.margin.toFixed(5) : '?')}</span></li>`).join('')}</ul>`
        : `<p class="empty">none — every declared item placed above the floor</p>`;

    const pickLine = v.lastPick
        ? `last pick: <b>${esc(v.lastPick.arm)}</b> at ${esc(v.lastPick.at)}`
        : `no pick recorded in this session`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>Steer Envelope</title>
<style>
:root{--bg:#0b0e13;--fg:#d7dde6;--dim:#7d8794;--acc:#5ee3a6;--warn:#f0b35e;--line:#1e242e;--card:#0e1218}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13.5px/1.55 ui-monospace,Menlo,monospace;padding:14px}
h1{font-size:15px;margin:0 0 4px}h2{font-size:13px;margin:0 0 8px;letter-spacing:.04em}
.sub{color:var(--dim);font-size:12px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:12px;margin-bottom:12px}
.arm{border-color:#2a3442}.arm p{margin:4px 0}
.coord{color:var(--acc);font-weight:700}.name{color:var(--fg)}
.dim{color:var(--dim)}.good{color:var(--acc)}.warn{color:var(--warn)}.empty{color:var(--dim);font-style:italic}
.quote{color:#b9c2cf}
ul{list-style:none;padding:0;margin:0}li{padding:3px 0;border-bottom:1px solid #151a22;font-size:12.5px}
button{background:var(--acc);color:#04140f;border:0;border-radius:5px;padding:9px;font:inherit;font-weight:700;cursor:pointer;width:100%;margin-top:8px}
button.alt{background:#232b36;color:var(--fg)}
.meter{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.tick{display:inline-block;padding:2px 7px;margin-right:4px;border:1px solid var(--line);border-radius:4px}
.verdict{margin-top:6px}
code{color:#b9c2cf}
</style></head><body>
<h1>STEER ENVELOPE — the net, not the box.</h1>
<div class="sub">Drift is the input. The work landed where it landed; these are the two restoring arms. Pick one and the cycle runs again. Detected · placed · priced · dispatched — nothing here gates a commit.</div>

<div class="card">
  <div class="meter">
    <div><b>cycle ${esc(v.cycleCount)}</b> <span class="dim">this panel</span></div>
    <div>declared <b>${esc(c.decl.length)}</b> · placed <b>${esc(c.confident.length)}</b> · abstained <b>${esc(c.abstained.length)}</b> · recent work <b>${esc(c.work.length)}</b></div>
    <div>PULL <b>${c.pull == null ? '—' : esc(c.pull)}</b> <span class="dim">blocks from the nearest declaration</span></div>
    <div class="dim">ledger: ${esc(c.ledger.count)} pick(s) in ${esc(c.ledger.path)} · ${pickLine}</div>
  </div>
  <div style="margin-top:8px">pull across cycles: ${pullSeries(v.pulls)}</div>
</div>

<div class="grid">
  <div class="card arm" id="arm-work">
    <h2>ARM 1 · MOVE THE WORK</h2>
    ${arm1}
    <button onclick="pick('work')">pick: move the work → record + re-run</button>
  </div>
  <div class="card arm" id="arm-decl">
    <h2>ARM 2 · MOVE THE DECLARATION</h2>
    ${arm2}
    <button onclick="pick('declaration')">pick: move the declaration → record + re-run</button>
  </div>
</div>

<div class="card" id="abstained">
  <h2>ABSTAINED <span class="dim">(margin below ${esc(c.floor)} — not placed rather than placed wrongly; not targets, not failures)</span></h2>
  ${abstained}
</div>

<div class="card">
  <button class="alt" onclick="cycle()">↻ run the cycle again</button>
  <button class="alt" onclick="copyCard(this)">📋 copy this card — paste into the chat on the right</button>
  <textarea id="card" hidden>${esc(cardText(v))}</textarea>
</div>

<script>
const _vs = acquireVsCodeApi();
function pick(arm) { _vs.postMessage({ type: 'pick', arm }); }
function cycle() { _vs.postMessage({ type: 'cycle' }); }
function copyCard(btn) {
  const el = document.getElementById('card');
  _vs.postMessage({ type: 'copy', text: el ? el.value : '' });
  if (btn) { const l = btn.textContent; btn.textContent = '✅ copied'; setTimeout(() => btn.textContent = l, 1400); }
}
</script>
</body></html>`;
}

// The clipboard card is the emitter's own words (`cycle.card`), with the panel's loop state on top.
// The page composes no second card of its own.
export function cardText(v: EnvelopeView): string {
    const pulls = v.pulls.map((p) => (p == null ? '—' : String(p))).join(' → ');
    return `cycle ${v.cycleCount} · pull across cycles: ${pulls || 'none'}\n` +
        `ledger: ${v.cycle.ledger.count} pick(s) in ${v.cycle.ledger.path}\n\n` + v.cycle.card;
}
