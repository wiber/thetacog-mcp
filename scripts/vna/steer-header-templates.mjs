// scripts/vna/steer-header-templates.mjs — C647k: THE SIDEBAR'S TOP SECTION SPEAKS ONLY IN TEMPLATES.
//
// Operator 2026-10-05, verbatim: "lets make sure we use templates in the vsx right? all are vars from runs / sql /rust never just
// generated". Every figure the top of the steer page paints — the header's spec ratio and trial Δ, the installed build, the receipts
// count, the live line's ages, HEAD and the behind verdict, the clip daemon's pid, and the walk door's cost — is a SLOT in a fixed
// template here, and every slot names the receipt field that fills it. The template text itself carries no figure: a number typed
// into prose stands in for a measurement, and it does not move when the measurement does (the walk door said "≈2 s" while the
// receipt it advertises carries its own pipelineMs; the coalescer's own comment records the render growing from ≈200 ms to ≈28 s
// while the refresh door kept saying ≈200 ms).
//
// A slot whose source is absent never renders a default: the template renders `UNMEASURED — <the command that writes it>`.
// fill() is pure — no clock read, no file read, no model call; the caller hands it the values it read off the receipts and gets
// back the text plus the record of which slot supplied which value, so a guard can diff every figure on the rendered page against
// the slots that put it there (tests/vna/c647k-the-vsix-speaks-only-in-templates.test.mjs).
//
// @guard tests/vna/c647k-the-vsix-speaks-only-in-templates.test.mjs

const COCKPIT_CMD = 'node scripts/vna/cockpit.mjs';
const SPEC_CMD = 'node scripts/vna/spec-check.mjs';
const STEER_CMD = 'node scripts/vna/steer-ui.mjs';

// fmtAge's spelling, repeated here only as a formatter of a slot value (the page's own fmtAge stays the one painter of ages)
export const ageText = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};
export const secondsText = (ms) => `${(ms / 1000).toFixed(1)} s`;

// Each template: { text, slots: { name: { from, cmd, fmt? } } }. `from` is the receipt field (path:field, or the run that computed
// it); `cmd` is what writes it, printed when it is absent; `fmt` turns the raw receipt value into the painted one (pure).
export const TOP_TEMPLATES = Object.freeze({
  spec: { text: 'spec {done}/{total} ticked', slots: {
    done: { from: 'docs/specs/vna/SPEC-VNA-COCKPIT.md:count(- [x] rows)', cmd: SPEC_CMD },
    total: { from: 'docs/specs/vna/SPEC-VNA-COCKPIT.md:count(- [ ] and - [x] rows)', cmd: SPEC_CMD } } },
  trial: { text: 'Δ {offPct}% off-lane · {red} red', slots: {
    offPct: { from: 'data/vna/cockpit.json:panels[Δ].counts.offPct (the preview when newer — shownCock)', cmd: COCKPIT_CMD },
    red: { from: 'data/vna/cockpit.json:panels[Δ].counts.red (the preview when newer — shownCock)', cmd: COCKPIT_CMD } } },
  ext: { text: '{ext}', slots: {
    ext: { from: 'env VNA_EXT_VERSION — the host stamps its packageJSON.version on its own repaints', cmd: 'repaint from the extension (vna.refreshPage)' } } },
  count: { text: '{value} of {lines} lines are receipts · this page computes none of them', slots: {
    value: { from: 'panel-signal.mjs:panelSignal(page).value — run over this render', cmd: STEER_CMD },
    lines: { from: 'panel-signal.mjs:panelSignal(page).lines — run over this render', cmd: STEER_CMD } } },
  walkCost: { text: 'the last walk took {ms}', slots: {
    ms: { from: 'data/vna/cockpit.json:pipelineMs', cmd: COCKPIT_CMD, fmt: secondsText } } },
  head: { text: '{sha7}', slots: {
    sha7: { from: 'git rev-parse HEAD (heartbeatFacts)', cmd: 'git rev-parse HEAD', fmt: (s) => String(s).slice(0, 7) } } },
  walked: { text: '{sha7}', slots: {
    sha7: { from: '.thetacog/walk-tape.ndjson:last commit-reality row .ref', cmd: COCKPIT_CMD, fmt: (s) => String(s).slice(0, 7) } } },
  behind: { text: '{n}', slots: {
    n: { from: 'git rev-list --count <walked>..HEAD (heartbeatFacts)', cmd: COCKPIT_CMD } } },
  pid: { text: '{pid}', slots: {
    pid: { from: '.thetacog/vna-clip.pid — the clip-watch daemon lock (clipState)', cmd: 'node scripts/vna/clip-watch.mjs arm' } } },
  ingestAge: { text: '{age}', slots: {
    age: { from: '.thetacog/walk-tape.ndjson:last row .ts', cmd: COCKPIT_CMD, fmt: ageText } } },
  readAge: { text: '{age}', slots: {
    age: { from: '.thetacog/vna-steer-surfaced.ndjson:last row .at', cmd: 'node scripts/vna/steer-hook.mjs', fmt: ageText } } },
  treeAge: { text: '{age}', slots: {
    age: { from: 'data/vna/spec-tree.json:mtime (the last fold)', cmd: 'node scripts/vna/spec-tree.mjs', fmt: ageText } } },
  renderedAge: { text: '{age}', slots: {
    age: { from: 'this render\'s own start clock (RENDER_STARTED_AT)', cmd: STEER_CMD, fmt: ageText } } },
  newestAge: { text: '{age}', slots: {
    age: { from: 'the newest mtime on RECEIPT_PATHS (newestReceipt)', cmd: STEER_CMD, fmt: ageText } } },
});

const absent = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || v === '';

// fill(id, values) → { id, text, unmeasured, slots: [{ slot, from, value }] }. Pure. `values` holds the RAW receipt values;
// an absent one turns the whole template into `UNMEASURED — <cmd>` (the first absent slot's command), never a default.
export function fill(id, values = {}, { templates = TOP_TEMPLATES } = {}) {
  const t = templates[id];
  if (!t) throw new Error(`no template ${id}`);
  const missing = Object.keys(t.slots).find((k) => absent(values[k]));
  if (missing) return { id, text: `UNMEASURED — ${t.slots[missing].cmd}`, unmeasured: true, slots: [] };
  const slots = [];
  const text = t.text.replace(/\{(\w+)\}/g, (_, k) => {
    const s = t.slots[k]; const value = String(s.fmt ? s.fmt(values[k]) : values[k]);
    slots.push({ slot: `${id}.${k}`, from: s.from, value });
    return value;
  });
  return { id, text, unmeasured: false, slots };
}

// A collector: one per render, so a guard can ask which slots supplied the figures it sees. `take(id, values)` fills and records.
export function fillLog() {
  const log = [];
  return { log, take: (id, values, opts) => { const f = fill(id, values, opts); log.push(f); return f; } };
}
