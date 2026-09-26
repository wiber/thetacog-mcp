#!/usr/bin/env node
// scripts/vna/run-summary.mjs — 📋 COPY RUN SUMMARY (C89b, the seventh dictation's "team Slack receipt"). One line a developer
// pastes where "what did the agent do" gets asked, every term read from a receipt: the newest verdict row of
// .thetacog/runner.ndjson (the unit, ok, the gates, the worker's own usage), the token meter (C82e: input tokens a clear
// stopped re-sending), the cockpit's Δ (off-lane %, red rings, the files the commit touched). Never typed, never a dollar
// (KR40), UNMEASURED for a missing term — never 0. LLM-free.   node scripts/vna/run-summary.mjs [--json]
// @guard tests/vna/c89-run-summary.test.mjs
//
// C133 — THE COPY RUN SUMMARY LINE IS THE VIRAL LOOP (operator 2026-09-21, verbatim: "Verified by ThetaCog: 17% off-lane
// (Δ 13) · 3 files walked (73.1 kB) · Time on Target secured. … Include the exact hash, the Δ drift, and a permanent link
// back to the manifesto"). The LAST stdout line — the one 📋 copies — is composeLine(): self-explaining pasted into GitHub
// or Slack, every slot off a receipt: off-lane % and the Δ panel's rings off the cockpit's walk (data/vna/cockpit.json), the
// files and bytes off the aperture receipt's reality rows (data/vna/aperture-receipt.json, F_in — the bytes the aperture
// actually looked at, and only when that receipt is the walked commit's), the exact hash off the walked commit, Time on
// Target off the walked commit's row on the flight tape (verifyRow: signed AND verifies → secured; unsigned, forged or
// absent → UNSIGNED and the 💳 door), the link the manifesto route. An absent receipt prints UNMEASURED for ITS slot.
// The run line above it (runSummary, C89b) still prints first — the verdict, the worker's tokens, the tokens not re-sent.
// @guard tests/vna/c133-copy-run-summary-verified-line.test.mjs
import { readFileSync } from 'node:fs';
import { verifyRow, licenceOf } from './flight-tape.mjs';
import { CHECKOUT_URL } from './public-surface-register.mjs';   // C138: the checkout door, one string, on the unlicensed states
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '..', '..');
const k = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const num = (v) => (Number.isFinite(v) ? v : null);

export function runSummary({ verdict = null, meter = null, cock = null } = {}) {
  let head;
  if (!verdict) head = 'ThetaCog run · no verdict on runner.ndjson yet · gates UNMEASURED';
  else {
    const g = verdict.gates || {}; const keys = Object.keys(g); const ok = keys.filter((x) => g[x]).length; const failed = keys.filter((x) => !g[x]);
    const tok = verdict.usage ? (num(verdict.usage.input_tokens) || 0) + (num(verdict.usage.cache_creation_input_tokens) || 0) + (num(verdict.usage.cache_read_input_tokens) || 0) + (num(verdict.usage.output_tokens) || 0) : null;
    head = `ThetaCog run · ${verdict.label || '—'} ${verdict.ok ? '✅' : '❌'} ${ok}/${keys.length} gates${verdict.ok ? (g.redWitness ? ' (red witness verified)' : '') : ` — ${failed.join(', ')}`} · worker ${tok != null ? k(tok) + ' tokens' : 'tokens UNMEASURED'}`;
  }
  const saved = meter && meter.saved && num(meter.saved.tokens) != null ? `${k(meter.saved.tokens)} input tokens not re-sent` : 'tokens not re-sent UNMEASURED';
  const d = cock && cock.delta; const files = cock && Array.isArray(cock.files) ? cock.files.length : null;
  const delta = d && num(d.offPct) != null ? `Δ ${d.offPct}% off-lane · ${num(d.red) ?? '—'} red${files != null ? ` · ${files} file${files === 1 ? '' : 's'}` : ''}` : 'Δ UNMEASURED';
  return `${head} · ${saved} · ${delta}`;
}
// C133: the operator's "permanent link back to the manifesto" — src/app/manifesto/page.tsx is the route that exists
// (there is no src/app/ledger; the guard checks the route on disk, so a rename here fails red rather than shipping a 404).
export const LEDGER_URL = 'https://thetadriven.com/manifesto';
const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const isSha = (s) => /^[0-9a-f]{40}$/.test(String(s || ''));
// C133 — pure over the receipts: { cock: cockpit.json, aperture: aperture-receipt.json, tapeRows: flight-tape rows }.
// verify is injectable so the guard can hand a fixture row; the default is the tape's own verifier.
// C133c (operator's steer.txt 2026-09-21, Gap 2: "It must explicitly show the token savings and the Time on Target status"): the tokens
// slot reads tokenMeter's saved.tokens (the input tokens a clear stopped re-sending, C98c) — handed in as a value, never computed here;
// absent or zero → UNMEASURED, never a typed number. The line is one markdown-safe row: no `|`, no leading `#`, plain URLs.
const kTok = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
export function composeLine({ cock = null, aperture = null, tapeRows = null, meter = null } = {}, { verify = verifyRow } = {}) {
  const sha = cock && isSha(cock.commitFull) ? String(cock.commitFull) : null;
  const d = cock && cock.delta && !cock.delta.refused ? cock.delta : null;
  const off = d && num(d.offPct) != null ? `${d.offPct}% off-lane` : 'UNMEASURED off-lane';
  const dp = cock && Array.isArray(cock.panels) ? cock.panels.find((p) => /^\s*Δ/.test(String(p && p.title))) : null;
  const rings = dp && num(dp.rings) != null ? String(dp.rings) : 'UNMEASURED';
  // the files and bytes the aperture looked at — only the walked commit's own receipt, never another walk's
  const rows = sha && aperture && aperture.commit === sha && aperture.reality && Array.isArray(aperture.reality.rows) ? aperture.reality.rows : null;
  const files = rows ? `${rows.length} file${rows.length === 1 ? '' : 's'} walked (${kB(rows.reduce((a, r) => a + (num(r.used_bytes) ?? num(r.bytes) ?? 0), 0))})` : 'UNMEASURED files walked';
  let tot;
  if (!sha || !Array.isArray(tapeRows)) tot = 'Time on Target UNMEASURED';
  else {
    const row = tapeRows.filter((r) => r && r.kind === 'commit' && r.sha === sha).pop() || null;
    let v = null; try { v = row ? verify(row) : null; } catch { v = null; }
    // C133b — "secured" means COUNTERSIGNED UNDER LICENCE (licenceOf → LICENSED), never merely signed under the room key: the README
    // says the clock starts when the ledger is funded and the empty state says unsigned work is not retained, so a room-key row with
    // proofs.licence null is signed · unlicensed and the line says so. Three states, never conflated: secured · signed unlicensed · UNSIGNED.
    const lic = v && v.ok && v.signed ? licenceOf(row) : null;
    tot = lic && lic.status === 'LICENSED' ? 'Time on Target secured'
      // C138 (operator 2026-09-21: "never miss an opportunity to link to checkout licenses"): the two unlicensed states end with the
      // checkout door itself, so the pasted line markets the licence wherever it lands — the URL from the register, never a retype
      : lic ? `Time on Target signed · unlicensed — 💳 ${CHECKOUT_URL}`
        : `Time on Target UNSIGNED — 💳 ${CHECKOUT_URL}`;
  }
  const saved = meter && meter.saved && Number.isFinite(meter.saved.tokens) && meter.saved.tokens > 0 ? `${kTok(meter.saved.tokens)} tokens not re-sent` : 'tokens not re-sent UNMEASURED';
  return `Verified by ThetaCog: ${off} (Δ ${rings}) · ${files} · ${saved} · ${sha ? sha.slice(0, 12) : 'UNMEASURED'} · ${tot} · ${LEDGER_URL}`;
}
export function runSummaryLive({ runner = resolve(REPO, '.thetacog/runner.ndjson'), cockpit = resolve(REPO, 'data/vna/cockpit.json'), apertureReceipt = resolve(REPO, 'data/vna/aperture-receipt.json'), tape = resolve(REPO, 'data/vna/flight-tape.ndjson') } = {}) {
  let verdict = null; try { verdict = readFileSync(runner, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'verdict').pop() || null; } catch {}
  let meter = null; try { meter = (await0(() => import('./clear-gauge.mjs'))) ; } catch {}
  let cock = null; try { cock = JSON.parse(readFileSync(cockpit, 'utf8')); } catch {}
  let aperture = null; try { aperture = JSON.parse(readFileSync(apertureReceipt, 'utf8')); } catch {}
  let tapeRows = null; try { tapeRows = readFileSync(tape, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  return { verdict, meter, cock, aperture, tapeRows };
}
function await0() { return null; }   // the meter is read asynchronously in main(); the pure function above takes it as a value
async function main() {
  const { tokenMeter } = await import('./clear-gauge.mjs');
  const live = runSummaryLive(); let meter = null; try { meter = tokenMeter(); } catch {}
  const s = runSummary({ ...live, meter }); const verified = composeLine({ ...live, meter });
  if (process.argv.includes('--json')) console.log(JSON.stringify({ summary: s, verified, line: verified })); else console.log(`${s}\n${verified}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
