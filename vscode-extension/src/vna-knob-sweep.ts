// packages/thetacog-mcp-vscode/src/vna-knob-sweep.ts — C709c: THE SWEEP, DRAWN BESIDE THE RATCHET PANELS.
//
// Pure, no 'vscode', no 'fs' — the same split render-coalesce.ts and page-state-shim.ts already use so a
// guard can load this module in plain node (ts.transpileModule) without the extension host. vna-view.ts
// is the ONLY reader of the two source files (.thetacog/walk-knob-sweep.ndjson, data/vna/walk-knob-floor.json);
// everything here takes rows and a floor as ARGUMENTS and computes nothing C709b did not already score —
// grouping a row under its axis and placing a dot on a line is layout, not a second measurement.
//
// THE RIGHT DATA SOURCE (C711, 2026-10-10 — the fat-tail lesson, again): a walk knob cannot move admissibility
// (the seed's null test decides it before the walk), so a chart of "admissible vs null" per walk knob draws the
// wrong question. The sweep's target is hamming_z — the walked mask's separation of each commit's TRUE
// intent→reality pair from shuffled pairings, already a z against that null — so the chart draws ONE line, z,
// against the z = 0 line that IS the shuffled null. Only rows whose target is hamming_z, from the floor's own
// frozen corpus (sha_hash), are drawn; a row scored on another target or another corpus is never pooled in.
// Admissibility rides beside the chart as the CONTROL the sweep says it is: one line of text, never a point.
//
// A CELL BELOW n 20 (scoreCell's own MIN_N, scripts/pmu/walk-knob-sweep.mjs) READS UNMEASURED: no circle,
// no line segment through it — the gap IS the honest reading, never a zero standing in for "not run".

export type KnobRow = {
    ts?: string; n?: number; admissible?: number; admissible_n?: number; null?: number; z?: number;
    status?: string; knobs?: Record<string, number>; sha_hash?: string; unit?: string; target?: string;
    hamming_z?: number; hamming_null_mean?: number;   // a later scoreCell shape names its target differently; read either, compute neither
};
export type KnobFloor = {
    best?: number | null; knobs?: Record<string, number>; n?: number; at?: string;
    what?: string | null; not_sufficient_for?: string | null; sha_hash?: string | null;
} | null;

// THE ONE WALK-KNOB HOME (src/lib/pmu/walk-knobs.mjs WALK_KNOBS) — the baseline every sweep cell varies
// ONE axis away from. Restated here, never re-derived, because this module may not import the .mjs home
// (a .ts pure module stays import-free of the extension host AND of the node-only pipeline it describes).
export const KNOB_HOME: Record<string, number> = { maxDepth: 8, topK: 2, budget: 220, decay: 0.5, floor: 0.3 };
export const TARGET = 'hamming_z';
export const Z_SEPARATES = 2;   // |z| under 2 reads AT the shuffled null; the caption says which, off the row's own z
export const MIN_N = 20;   // scoreCell's own floor below which a cell is UNMEASURED, never a number

// Which axis a cell moved, and by how much — the one-axis-at-a-time grid (walk-knob-sweep.mjs GRID) means
// at most one key differs from the home; 'home' names the baseline cell itself (plotted on no axis chart).
export function knobAxis(knobs: Record<string, number> = {}): { axis: string; value: number } {
    for (const k of Object.keys(KNOB_HOME)) {
        const v = knobs[k] ?? KNOB_HOME[k];
        if (v !== KNOB_HOME[k]) { return { axis: k, value: v }; }
    }
    return { axis: 'home', value: KNOB_HOME.decay };
}

const isMeasured = (r: KnobRow): boolean => r.status === 'measured' && typeof r.n === 'number' && r.n >= MIN_N && typeof r.hamming_z === 'number';
const zOf = (r: KnobRow): number => r.hamming_z as number;

// The rows this chart may draw: the sweep's own target, and — when the floor names one — the floor's own corpus.
export function onTarget(rows: KnobRow[], floor: KnobFloor): KnobRow[] {
    const corpus = floor && floor.sha_hash ? floor.sha_hash : null;
    return (rows || []).filter((r) => r.target === TARGET && (!corpus || r.sha_hash === corpus));
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// ONE SVG LINE CHART PER AXIS: hamming_z (solid) against the knob value on that axis, the z = 0 line (the
// shuffled null) drawn on every chart, n stamped over every plotted point, the floor's best z as one dashed
// reference line that reads the same on every chart because it is one measured number.
export function renderKnobSweep(allRows: KnobRow[], floor: KnobFloor): string {
    const rows = onTarget(allRows, floor);
    const groups = new Map<string, Array<{ value: number; row: KnobRow; measured: boolean }>>();
    for (const row of rows) {
        const { axis, value } = knobAxis(row.knobs);
        if (axis === 'home') {
            // the baseline cell backs every axis chart at once, plotted at each axis's home value, never recomputed
            for (const k of Object.keys(KNOB_HOME)) {
                const list = groups.get(k) || [];
                list.push({ value: KNOB_HOME[k], row, measured: isMeasured(row) });
                groups.set(k, list);
            }
            continue;
        }
        const list = groups.get(axis) || [];
        list.push({ value, row, measured: isMeasured(row) });
        groups.set(axis, list);
    }
    // a chart needs a moved axis: the home row alone backs every chart but moves none
    for (const [k, pts] of groups) { if (pts.every((p) => p.value === KNOB_HOME[k])) { groups.delete(k); } }
    const vals: number[] = [];
    for (const g of groups.values()) { for (const p of g) { if (p.measured) { vals.push(zOf(p.row)); } } }
    if (floor && floor.best != null) { vals.push(floor.best); }
    const lo = Math.min(0, ...vals, -0.25), hi = Math.max(0, ...vals, 0.25);
    const W = 220, H = 70, PAD = 18;
    const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - PAD * 2);
    const floorY = floor && floor.best != null ? y(floor.best) : null;
    const gray = 'var(--vscode-descriptionForeground)';

    const charts = [...groups.entries()].map(([axis, pts]) => {
        const sorted = pts.slice().sort((a, b) => a.value - b.value);
        const n = sorted.length;
        const x = (i: number) => PAD + (n > 1 ? (i / (n - 1)) * (W - PAD * 2) : (W - PAD * 2) / 2);
        let zPath = '', open = false;
        const marks: string[] = []; const ticks: string[] = [];
        // the story quotes the SAME row its highest drawn point came from — no third number is computed
        let top: { value: number; row: KnobRow } | null = null;
        sorted.forEach((p, i) => {
            ticks.push(`<text x="${x(i)}" y="${H - 3}" font-size="6" text-anchor="middle" fill="${gray}">${esc(p.value)}</text>`);
            if (!p.measured) { open = false; return; }   // UNMEASURED: no mark, and the line breaks rather than jump across it
            const zy = y(zOf(p.row));
            zPath += `${open ? 'L' : 'M'}${x(i)},${zy} `;
            open = true;
            marks.push(`<circle class="knob-pt knob-z" cx="${x(i)}" cy="${zy}" r="2" fill="var(--vscode-textLink-foreground)"/>`);
            marks.push(`<text x="${x(i)}" y="${zy - 4}" font-size="6" text-anchor="middle" fill="${gray}">n${p.row.n}</text>`);
            if (!top || zOf(p.row) > zOf(top.row)) { top = { value: p.value, row: p.row }; }
        });
        const t = top as { value: number; row: KnobRow } | null;
        const story = t
            ? `${esc(axis)}=${esc(t.value)}: z ${esc(zOf(t.row).toFixed(3))} over n${esc(t.row.n)} — ${Math.abs(zOf(t.row)) >= Z_SEPARATES ? 'separates the true pairs from the shuffled null' : 'sits at the shuffled null (|z| under ' + Z_SEPARATES + ')'}.`
            : `${esc(axis)}: every cell UNMEASURED — no point clears n ${MIN_N}.`;
        return `<div class="knobchart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<line class="knob-null" x1="${PAD}" y1="${y(0)}" x2="${W - PAD}" y2="${y(0)}" stroke="${gray}" stroke-dasharray="2,2" stroke-width="1"/>
${floorY != null ? `<line class="knob-floor" x1="${PAD}" y1="${floorY}" x2="${W - PAD}" y2="${floorY}" stroke="var(--vscode-editorWarning-foreground)" stroke-dasharray="3,2" stroke-width="1"/>` : ''}
<path d="${zPath.trim()}" fill="none" stroke="var(--vscode-textLink-foreground)" stroke-width="1.2"/>
${marks.join('')}${ticks.join('')}
</svg><figcaption>${esc(axis)}</figcaption><p class="knob-story">${story}</p></div>`;
    });
    if (!charts.length) { return '<div class="k dim">no axis moved yet — every row read is the home cell</div>'; }
    const adm = [...new Set(rows.map((r) => r.admissible_n).filter((v) => v != null))];
    return `${declareSource(rows, floor)}
<div class="knobgrid">${charts.join('')}</div>
<div class="k dim">floor z ${floor && floor.best != null ? esc(floor.best) : 'UNMEASURED'} (hamming z, only rises) · solid = hamming z · dashed grey = the shuffled null (z = 0) · a gap is a cell below n ${MIN_N}, never drawn as a point</div>
<div class="k dim knob-control">control — admissible placements per cell: ${adm.length ? esc(adm.join(', ')) : 'UNMEASURED'} (decided by the seed before the walk; ${adm.length <= 1 ? 'the same in every cell, as it must be' : 'MOVED across cells — a walk knob reached the seed'})</div>`;
}

// THE DECLARATION EVERY GRAPH CARRIES ON ITS FACE (C711) — read ONLY from the row the sweep already wrote
// (rows[0].unit, rows[0].sha_hash) and the floor file (floor.sha_hash, floor.n, floor.what,
// floor.not_sufficient_for). Never a second computation, never a hand-typed restatement of what the sweep
// measures — if the receipt's own words change, this block changes with it because it quotes the receipt.
export function declareSource(rows: KnobRow[], floor: KnobFloor): string {
    const unit = rows && rows[0] && rows[0].unit ? rows[0].unit : 'UNMEASURED';
    const sha = (floor && floor.sha_hash) || (rows && rows[0] && rows[0].sha_hash) || 'UNMEASURED';
    const n = floor && floor.n != null ? floor.n : 'UNMEASURED';
    const sufficientFor = (floor && floor.what) || 'UNMEASURED';
    const notSufficientFor = (floor && floor.not_sufficient_for) || 'UNMEASURED';
    return `<div class="k dim knob-source">unit of observation: ${esc(unit)} · source receipt sha ${esc(sha)} n ${esc(n)}<br/>sufficient for: ${esc(sufficientFor)}<br/>not sufficient for: ${esc(notSufficientFor)}</div>`;
}
