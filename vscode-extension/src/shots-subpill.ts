// packages/thetacog-mcp-vscode/src/shots-subpill.ts — THE SHOTS SUBPILL, rendered for the IDE (C1343).
//
// PURE. This file imports nothing from vscode and computes nothing: every number on the page arrived
// in one of the two files the measure scripts write, data/recognize/floors.json and
// data/research/called-shot-measure.json. A file that is absent or unreadable renders as
// "not run — <command>" naming the command that writes it, never as an empty chart. The graphs are
// inline SVG, so the page needs no script and no network. It ships in the internal .vsix only.

export const FLOORS_COMMAND = 'node scripts/comms/recognize.mjs round';
export const MEASURE_COMMAND = 'node scripts/research/called-shot-measure.mjs';

export interface Pt { x: string; y: number }
export interface Series { name: string; pts: Pt[] }
export interface ShotsInput { floors: unknown | null; measure: unknown | null }

const esc = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

export const notRun = (what: string, command: string): string => `<p class="notrun">${esc(what)}: not run — ${esc(command)}</p>`;

// floors over nights, one series per room; a round row without a room belongs to the room "all"
export function floorSeries(floors: unknown): Series[] {
    const f = rec(floors); if (!f) { return []; }
    const out: Series[] = [];
    const rooms = rec(f.rooms);
    if (rooms) {
        for (const [name, rows] of Object.entries(rooms)) {
            const pts = (Array.isArray(rows) ? rows : []).filter((r) => rec(r) && isNum((r as any).floor)).map((r: any) => ({ x: String(r.night ?? r.at ?? '').slice(0, 10), y: r.floor as number }));
            if (pts.length) { out.push({ name, pts }); }
        }
    }
    if (Array.isArray(f.rounds)) {
        const by = new Map<string, Pt[]>();
        for (const r of f.rounds as any[]) {
            const y = isNum(r?.green_rate) ? r.green_rate : isNum(r?.floor) ? r.floor : null; if (y === null) { continue; }
            const k = String(r.room ?? 'all'); const a = by.get(k) ?? []; a.push({ x: String(r.night ?? r.at ?? '').slice(0, 10), y }); by.set(k, a);
        }
        for (const [name, pts] of by) { out.push({ name, pts }); }
    }
    return out;
}

// hit rate per room per day, as the measure file wrote it: hit_rate: { room: { day: rate } }
export function hitSeries(measure: unknown): Series[] {
    const m = rec(measure); const h = rec(m?.hit_rate); if (!h) { return []; }
    const out: Series[] = [];
    for (const [name, days] of Object.entries(h)) {
        const d = rec(days); if (!d) { continue; }
        const pts = Object.entries(d).filter(([, v]) => isNum(v)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([x, y]) => ({ x, y: y as number }));
        if (pts.length) { out.push({ name, pts }); }
    }
    return out;
}

const COLORS = ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#ff7b72', '#e3b341'];

export function lineChart(title: string, series: Series[]): string {
    const W = 260, H = 90, P = 6;
    const ys = series.flatMap((s) => s.pts.map((p) => p.y));
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const lines = series.map((s, i) => {
        const n = s.pts.length;
        const xy = s.pts.map((p, j) => `${(P + (n === 1 ? (W - 2 * P) / 2 : (j / (n - 1)) * (W - 2 * P))).toFixed(1)},${(H - P - ((p.y - lo) / span) * (H - 2 * P)).toFixed(1)}`);
        const c = COLORS[i % COLORS.length];
        return n === 1 ? `<circle cx="${xy[0].split(',')[0]}" cy="${xy[0].split(',')[1]}" r="3" fill="${c}"/>` : `<polyline fill="none" stroke="${c}" stroke-width="1.5" points="${xy.join(' ')}"/>`;
    }).join('');
    const legend = series.map((s, i) => `<span style="color:${COLORS[i % COLORS.length]}">■ ${esc(s.name)} (${s.pts.length}) last ${esc(s.pts[s.pts.length - 1].y)}</span>`).join(' · ');
    return `<section class="chart"><h3>${esc(title)}</h3><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">${lines}</svg><div class="legend">${legend}</div><div class="range">min ${esc(lo)} · max ${esc(hi)}</div></section>`;
}

export function renderShotsHtml(input: ShotsInput): string {
    const parts: string[] = [];
    const fs = floorSeries(input.floors);
    parts.push(input.floors === null ? notRun('the floors', FLOORS_COMMAND) : fs.length ? lineChart('The floors over nights, per room', fs) : notRun('the floors (no rows in the file)', FLOORS_COMMAND));
    const m = rec(input.measure);
    const hs = hitSeries(input.measure);
    parts.push(input.measure === null ? notRun('the hit rate per room per day', MEASURE_COMMAND) : hs.length ? lineChart('Hit rate per room per day (call · act · shot · gate)', hs) : notRun('the hit rate (no rows in the file)', MEASURE_COMMAND));
    const gap = rec(m?.gap);
    parts.push(gap && (isNum(gap.teacher) || isNum(gap.student))
        ? `<section class="chart"><h3>Teacher–student gap</h3><p>teacher ${esc(gap.teacher ?? 'n/a')} · student ${esc(gap.student ?? 'n/a')}${isNum(gap.teacher) && isNum(gap.student) ? ` · gap ${esc(gap.gap ?? 'n/a')}` : ''}</p></section>`
        : notRun('the teacher–student gap', MEASURE_COMMAND));
    const ap = rec(m?.aperture);
    parts.push(ap && isNum(ap.z) ? `<section class="chart"><h3>Aperture floor z</h3><p>z ${esc(ap.z)}</p></section>` : notRun('the aperture floor z', MEASURE_COMMAND));
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px system-ui;color:#c9d1d9;background:#0b0f14;padding:8px}h3{margin:8px 0 2px;font-size:12px}.notrun{color:#8b949e;font-style:italic}.legend,.range{color:#8b949e}svg{background:#10161d}</style></head><body><h2>Shots</h2>${parts.join('')}</body></html>`;
}
