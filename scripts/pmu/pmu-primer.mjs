// scripts/pmu/pmu-primer.mjs — the shared "on-run" primer.
//
// Every advertised run command opens this FIRST so the user reads "what you're about
// to see" while the run executes, then the command overwrites the same file with the
// real results HTML and the tab auto-refreshes into it — one tab, prep → proof, no
// terminal-staring. Keep the contract identical across commands so the experience is
// consistent. The primer carries a <meta refresh>; the results page must NOT (so it
// stops reloading once it lands).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Build the primer HTML. opts: { title, sub, lines: [string], note }
export function primerHtml({ title, sub, lines = [], note }) {
  const items = lines.map((l) => `<li>${l}</li>`).join('\n      ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>${esc(title)} — running…</title><style>
  body{margin:0;background:#070910;color:#e9edf5;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:42px 22px}
  h1{font-size:27px;letter-spacing:-.5px;margin:0 0 6px} .sub{color:#8a94a8;font-style:italic;margin-bottom:18px}
  .card{background:#0e131e;border:1px solid #1a2130;border-radius:12px;padding:18px 22px}
  ol{padding-left:20px} li{margin:9px 0} b{color:#e9edf5} .green{color:#46d369} .red{color:#ff5d52} .dim{color:#8a94a8}
  .spin{margin-top:16px;color:#46d369;font-family:ui-monospace,Menlo,monospace;font-size:13px}
</style></head><body><div class="wrap">
  <h1>${esc(title)} — running…</h1>
  <div class="sub">Are you out of your pixel? 🎯 &nbsp;${esc(sub)} This page becomes the signed results the moment the run finishes — it refreshes itself.</div>
  <div class="card">
    <p><b>What you're about to see</b>, top to bottom:</p>
    <ol>
      ${items}
    </ol>
    <div class="spin">● running now${note ? ' — ' + esc(note) : ''}… the results will replace this page automatically.</div>
  </div></div></body></html>`;
}

// Write the primer to reportPath and open it (unless suppressed). Returns true if opened.
export function openPrimer(reportPath, opts, { open = true } = {}) {
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, primerHtml(opts));
    if (open) spawnSync('open', [reportPath]);
    return open;
  } catch { return false; }
}
