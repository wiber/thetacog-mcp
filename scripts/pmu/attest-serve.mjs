#!/usr/bin/env node
// scripts/pmu/attest-serve.mjs — a tiny, LOCAL-ONLY static server for the attest-demo pages, run as a
// DETACHED child of attest-demo so the CLI can open the localhost page AND return immediately (no hang)
// while this keeps serving. Binds 127.0.0.1 only, path-traversal-guarded, auto-exits after 30 minutes.
//
//   node attest-serve.mjs <serveDir> <portFile> [port] [pidFile]
//
// Writes the bound port to <portFile> and its own pid to <pidFile> so the parent (attest-open) can (a) open
// http://localhost:<port>/… and (b) kill THIS exact process to replace it next run.

import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createReadStream, existsSync, writeFileSync, readFileSync, appendFile } from 'node:fs';
import { createHash, sign as cryptoSign } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// THE ONE VERDICT (2026-07-19): the server binds its /render verdict to the SAME canonical placement()
// the whole deterministic suite trusts — not a divergent inline re-derivation. See the verdict block below.
import { placement as canonicalPlacement } from './attest-hypotheses.mjs';

const serveDir = resolve(process.argv[2] || '.');
const portFile = process.argv[3];
// FIXED PORT + single-runner (operator 2026-07-15: "instead of fiddling with ports, open right away; if a
// prior version runs, replace it"). A STABLE port means the URL is known before the bind, so the opener can
// fire instantly. The parent kills any prior server by its RECORDED PID (never lsof-by-port — that returns
// client sockets too, a hard rule) before we bind; Node sets SO_REUSEADDR on POSIX so we re-grab the freed
// port immediately. Override with THETACOG_ATTEST_PORT. On EADDRINUSE we write ERR and exit (safety net).
const FIXED_PORT = Number(process.env.THETACOG_ATTEST_PORT || process.argv[4] || 7315);
const pidFile = process.argv[5];
const HERE = dirname(fileURLToPath(import.meta.url));
const CT = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf' };

// ── THE LOCAL RENDER ENDPOINT (operator 2026-07-15: "the page must run rust"). Air-gap = no INTERNET, not
// no Rust. When the served page hits Run/edit/perturb, it POSTs {intent,reality,negative} here and this
// runs the REAL pipeline (buildTriptychInputs → renderTriptych = the ballistic walk on chip) and returns
// the fresh per-panel PNGs. 127.0.0.1 only — nothing leaves the machine. This makes the walk panels a live
// function of the tape state (zero exceptions to page = f(tape)), not a static per-scenario pre-render.
const _IDS = ['raw-intent', 'raw-reality', 'raw-compare', 'intent', 'reality', 'delta', 'tolerance'];
const _KEY = { 'raw-intent': 'rawIntent', 'raw-reality': 'rawReality', 'raw-compare': 'rawCompare', intent: 'intent', reality: 'reality', delta: 'delta', tolerance: 'tolerance' };
const REPO_ROOT = resolve(HERE, '..', '..');   // scripts/pmu → repo (or bundled package) root, where the reef lives
async function _oneTriptych(intent, reality, label) {
  const { buildTriptychInputs } = await import(resolve(HERE, 'triptych-build.mjs'));
  const { renderTriptych } = await import(resolve(HERE, 'triptych-render.mjs'));
  const { detectRegions } = await import(resolve(HERE, 'regions-chip.mjs')).catch(() => ({}));
  const { encircleRegionsPng } = await import(resolve(HERE, 'annotate-regions.mjs')).catch(() => ({}));
  // MATCH genTriptych EXACTLY (object signature + repoRoot) — positional args were destructured to
  // undefined, so the walk ran on EMPTY corpora and returned near-blank panels (the empty-grid bug).
  const built = await buildTriptychInputs({ intentText: String(intent || ''), realityText: String(reality || ''), repoRoot: REPO_ROOT, killTolerancePct: 25, sigmaType: 'drift', impostors: 4, budgetMs: 1500 });
  const t = await renderTriptych({ ...built.renderArgs, killTolerancePct: 25, label, message: label, files: [] });
  const panels = {};
  for (const png of (t.pngs || [])) for (const id of _IDS) { const rest = png.name.startsWith(`trip-${id}`) ? png.name.slice(`trip-${id}`.length) : null; if (rest != null && /^[-.]/.test(rest) && !panels[_KEY[id]]) { panels[_KEY[id]] = `data:image/png;base64,${png.buf.toString('base64')}`; break; } }
  try { if (t.tol?.rgba && detectRegions && encircleRegionsPng) { const regions = detectRegions(t.tol.rgba) || []; panels.encircled = `data:image/png;base64,${encircleRegionsPng(t.tol.rgba, regions, { scale: 4 }).toString('base64')}`; panels.regionCount = regions.length; } } catch { /* optional */ }
  // STABLE CATASTROPHE (operator 2026-07-15: "must be stable"): intent vs a catastrophic negative produces
  // a UNIFORM delta — no localized region to circle → detectRegions returns 0 → an empty-looking encircled.
  // And a TIE (abstain) makes even the delta thin. So the catastrophe panel falls back down a CHAIN, taking
  // the first SUBSTANTIAL panel: encircled(if it has regions) → delta → tolerance → reality-walk → intent-
  // walk. The intent walk is always populated, so the panel is NEVER empty. Guarded by
  // tests/pmu-simulator/attest-catastrophe-nonempty.test.mjs.
  const SUB = 1000;
  if (!(panels.regionCount > 0) || (panels.encircled || '').length < SUB) {
    const chain = [panels.delta, panels.tolerance, panels.reality, panels.intent];
    const pick = chain.find((p) => p && p.length > SUB);
    if (pick) { panels.encircled = pick; panels.encircledFallback = true; }
  }
  // PERMANENTLY AVOID EMPTY PANELS (operator 2026-07-15): every panel carries its IO CONTEXT (which ingest
  // fed it + its fill), and a sparse WALK falls back to that SAME corpus's gzip-ingest panel (always denser)
  // — so no panel is ever blank, and the io tells you WHICH ingest to edit if it is thin.
  const io = {
    intentBytes: Buffer.byteLength(String(intent || ''), 'utf8'), realityBytes: Buffer.byteLength(String(reality || ''), 'utf8'),
    panels: {}, walkMode: built?.meta?.walkMode || null,
  };
  const fill = (walkKey, gzipKey) => { const w = panels[walkKey] || '', g = panels[gzipKey] || ''; const sparse = w.length < SUB; io.panels[walkKey] = { source: gzipKey === 'rawIntent' ? 'intent' : 'reality', walkBytes: w.length, gzipBytes: g.length, sparse, filled: sparse && g.length >= SUB }; if (sparse && g.length >= SUB) panels[walkKey] = g; };
  fill('intent', 'rawIntent'); fill('reality', 'rawReality');
  return { panels, io, walkMode: built?.meta?.walkMode || null, offPct: t.tol?.offPct ?? null };
}
export async function renderPanels(body) {
  // A = intent-vs-reality (the intent + reality rows); B = intent-vs-negative (the negative row) — the SAME
  // two comparators the commit email + attest-demo build, run live on the current tape inputs.
  const a = await _oneTriptych(body.intent, body.reality, 'live-render A');
  const b = body.negative ? await _oneTriptych(body.intent, body.negative, 'live-render B') : null;
  // STEP 1.3 — THE FULL METAL METRIC BLOCK under the CANONICAL contract keys, one on-chip pass. The chip
  // writes the OUT; the display mirrors it — the browser must NEVER compute these locally. Sourced from the
  // lens ballistic walk on the intent (coord · σ · plies · fill, LLM-free) + the triptych drift + the
  // continuous Chebyshev Δ (actual landing → ideal center). Optional: never blocks the panels.
  let live_response_metrics = null; let placement = null;
  try {
    const rd = await lensReadout({ prompt: body.intent, ideal: body.ideal }); const r = (rd && (rd.readout || rd)) || {};
    placement = { domain: r.domain ?? null, rules: rd.rules ?? null, playbook: rd.template ?? r.template ?? null };
    const idealCoord = body.ideal ? _reefCoord(String(body.ideal).trim()) : null;
    live_response_metrics = {
      pixel_coord: r.pixel ?? null,
      walk_plies: r.walkPlies ?? null,
      fill_pct: r.walkFillPct ?? null,
      trajectory_drift_sigma: r.sigma ?? null,
      continuous_chebyshev_delta: idealCoord ? _cheb(r.pixel, idealCoord) : null,
      off_pct: (a && a.offPct != null) ? a.offPct : null,
      gzip_ms: (rd && rd.timings && rd.timings.gzip_ms) ?? null,     // the ingest timing (measured, LLM-free)
      walk_ms: (rd && rd.timings && rd.timings.walk_ms) ?? null,     // the PMU walk timing
      selection_trace: (rd && rd.selection_trace) || [],            // the ranked picks + scores (the pick logic)
      telemetry: (rd && rd.telemetry) || null,                      // §7.3 six-key contract → tape walk blocks
      rule_hat_compare: (rd && rd.rule_hat_compare) || null,        // actual vs ideal rule/hat full text
      source: 'metal (pmu-onchip: lens walk + triptych, one pass)',
    };
  } catch { /* metrics optional — panels still return; a null block is honest, not a fake */ }
  // SERVER VERDICT (metal) — the step-function IN_LANE/OFF_DOMAIN computed server-side, mirroring the
  // position model driftPct = 100·dI/(dI+dN) (attest-demo-ux.mjs line 143). This migrates the verdict OFF
  // the browser ncd() — the display binds to this; the browser copy gets deleted under the M3 net.
  // THE ONE VERDICT — bind to the canonical placement() (attest-hypotheses.mjs), so the server's verdict,
  // threshold DEFAULT (THRESHOLD=45), tie rule (|dN−dI|<0.015), and mode rule (dN<dI → Mode B) are
  // BYTE-IDENTICAL to the deterministic placement the tape + the whole test suite trust. The old inline
  // block re-derived the verdict with a divergent |25| threshold default and a driftPct-based tie rule —
  // the split-brain (GAP 4) that made the faithful/"Compliant" scenario (driftPct 27) read OFF_DOMAIN on
  // the page while placement() correctly called it IN_LANE. chip(/render) ≡ tape(placement): one source.
  // Guarded by tests/pmu-simulator/render-verdict-matches-placement.test.mjs.
  let verdict = null;
  try {
    const thr = (body.threshold != null && body.threshold !== '') ? Number(body.threshold) : undefined; // undefined → canonical THRESHOLD
    const p = canonicalPlacement(String(body.intent || ''), String(body.reality || ''), String(body.negative || ''), thr);
    verdict = { tag: p.verdict, mode: p.mode, driftPct: p.driftPct, dI: p.dI, dN: p.dN, source: 'metal (canonical placement, gzip-NCD, LLM-free)' };
  } catch { /* verdict optional */ }
  return { a, b, walkMode: a.walkMode, live_response_metrics, placement, verdict };
}

// ── THE LENS READOUT (Lens Tester, B1) — the SAME real lens the commit gate consults, run on a prompt.
// LLM-FREE end to end (2026-07-09): buildStubSpec (prompt-as-intent) → boundaryFromStubSpec (the on-chip
// ballistic walk + gzip-NCD seed) → retrieveRules (SQLite fence) → assembleInjection (the lensed context).
// No model in the verdict/prompt cycle — the placement is keyword+anchor routing seeded by gzip-NCD and
// expanded by the Rust walk, byte-identical every run. Returns the full readout + the retrieved rules +
// the playbook template + (when `ideal` is given) the actual-vs-ideal domain match. Dynamic-import so the
// heavy reef/SQLite module load is paid only when /lens is actually hit (pure static serving stays light).
export async function lensReadout(body) {
  const prompt = String(body && body.prompt || '').slice(0, 800);
  const ideal = body && body.ideal ? String(body.ideal).trim() : null;
  if (!prompt) return { error: 'no prompt' };
  const { lensPrompt, pickWorkTemplate, assembleInjection, renderReceipt } = await import(resolve(HERE, 'prompt-lens.mjs'));
  const base = await lensPrompt(prompt);                    // { stub, boundary, retrieval, receipt, lensedContext, ms, timings }
  const b = base.boundary || {}, r = base.receipt || {}, ret = base.retrieval || {};
  const domain = r.domain || b.domain || base.stub?.domain || 'other';
  const wt = pickWorkTemplate(prompt);                      // the named work-shape template (the hat-switch)
  const readout = {
    pixel: b.center || r.coord || '∅',
    coord: r.coord || b.center || '∅',
    sigma: b.sigma ?? r.sigma ?? 0,
    sensor: r.sensor || b.sensor || 'gzip-fallback',
    inLane: !!r.inLane,
    domain,
    walkMs: b.walkMs ?? 0,
    walkMetalMs: b.walkMetalMs ?? 0,
    walkPlies: b.walkPlies ?? 0,
    walkFillPct: b.walkFillPct ?? 0,
    walkWalksPerSec: b.walkWalksPerSec ?? 0,
    walkSaturated: !!b.walkSaturated,
    seedGzipUs: b.seedGzipUs ?? 0,
    routeUs: b.routeUs ?? 0,
    totalMs: base.ms ?? 0,
    rulesReturned: r.rulesReturned ?? (ret.rules || []).length,
    coreAvailable: r.coreAvailable ?? ret.coreAvailable ?? null,
    reefRulesTotal: r.reefRulesTotal ?? null,
    core: r.core ?? null,
    perimeter: r.perimeter ?? null,
    rulesChars: r.rulesChars ?? null,
    reefTotalChars: r.reefTotalChars ?? null,
    templatesCount: r.templatesCount ?? null,
    templatesTotal: r.templatesTotal ?? null,
    templateName: r.templateName ?? (wt && wt.name) ?? null,
    sortQuality: r.sortQuality ?? null,
    encircledIn: (r.encircledIn || []).length,
    encircledOut: (r.encircledOut || []).length,
  };
  return {
    prompt,
    llm_free: true,                                        // no model in this verdict/prompt cycle (HARD RULE)
    readout,
    domain,
    rules: ret.rules || [],                                // the retrieved SQL rules (nearest-fence, sorted)
    template: {                                            // the playbook prompt-template (switches hats)
      workName: wt ? wt.name : null,
      workSkeleton: wt ? wt.skeleton : null,
      domainTemplate: b.template || null,
    },
    injection: base.lensedContext || assembleInjection(base.stub, b, ret),   // the assembled lensed context
    receiptText: (() => { try { return renderReceipt(base); } catch { return null; } })(),   // the LLM-free actuarial receipt block
    ideal,
    domain_match: ideal ? (String(domain) === ideal) : null,
    telemetry: base.telemetry || null,               // §7.3 — the six-key contract, same schema as the receipt
    speed: { loop_ms: base.ms ?? null, walk_ms: b.walkMs ?? null, note: 'input→injection, deterministic, NO LLM' },
    // the deterministic timings (already measured) + the SELECTION TRACE (ranked picks + scores) —
    // both LLM-free; forwarded so the tape/HUD can show the ingest/walk timing AND the pick logic.
    timings: { gzip_ms: (base.timings && base.timings.gzipSeedUs != null) ? +(base.timings.gzipSeedUs / 1000).toFixed(2) : null,
               walk_ms: (base.timings && base.timings.pmuMs != null) ? +base.timings.pmuMs.toFixed(1) : (b.walkMs ?? null),
               sort_us: (base.timings && base.timings.sortUs) ?? ret.sortUs ?? null },
    selection_trace: ret.selectionTrace || [],
    // ACTUAL vs IDEAL rule/hat TEXT (operator 2026-07-18 — "paint the actual and ideal rule/hat
    // texts, write them out, hats rule real ideal"): actual = what the reef picked for THIS prompt;
    // ideal = what the LLM-stated ideal domain's reef says should be picked. Both full text, so the
    // auditor sees the pick vs the target, not just a score. LLM-free lookup (deterministic reef read).
    rule_hat_compare: (() => {
      const idealDom = ideal ? _reefDomain(ideal) : null;
      return {
        actual_domain: domain, actual_hat: b.template || null, actual_rules: ret.rules || [],
        ideal_domain: ideal || null, ideal_hat: idealDom ? idealDom.template : null, ideal_rules: idealDom ? (idealDom.rules || []) : [],
      };
    })(),
  };
}

// THE LENS TAPE (Lens Tester, B1) — the battery + measured agreement, read from the engine's tape
// (data/grip/microscope.json — written by grip-microscope.mjs). Serves same-origin so the page's prompt
// picker + battery agreement % come from the ONE source of truth (never a copy). Read-only, best-effort.
// ShortLex ranks → continuous Chebyshev Δ (same math as grip-microscope) for the canonical
// live_response_metrics — the display never computes this; the chip does.
const _RANKS = ['A', 'B', 'C', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const _coordBlock = (c) => { const p = String(c || '').split(','); if (p.length !== 2) return null; const a = _RANKS.indexOf(p[0].trim()), b = _RANKS.indexOf(p[1].trim()); return (a < 0 || b < 0) ? null : [a, b]; };
const _cheb = (c1, c2) => { const a = _coordBlock(c1), b = _coordBlock(c2); return (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); };
const _reefDomain = (domain) => { try { const j = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/pmu/lens-reef.json'), 'utf8')); return (j.domains || []).find((x) => x.domain === domain) || null; } catch { return null; } };
const _reefCoord = (domain) => { const d = _reefDomain(domain); return d ? d.coord : null; };

export function readLensTape() {
  const cands = [resolve(REPO_ROOT, 'data/grip/microscope.json'), resolve(REPO_ROOT, '..', 'data/grip/microscope.json')];
  for (const p of cands) { try { if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')); } catch { /* next */ } }
  return { tape: [], agreement: null, structural_coherence: null, missing: true };
}

// only START the server when RUN as a script — importing this module (e.g. from a guard) must NOT bind a port
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!IS_MAIN) { /* imported for renderPanels — no server */ } else {
const server = createServer(async (req, res) => {
  try {
    // the local render endpoint — the page runs Rust through here (same-origin, 127.0.0.1)
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/render') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try { const out = await renderPanels(JSON.parse(raw || '{}')); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      });
      return;
    }
    // THE /ideal ENDPOINT (R5) — the HELD-OUT, LLM-generated ideal for a live-edited intent (same-origin,
    // 127.0.0.1 local qwen). Body {intent} → { ideal: {domain, hat, rules, source} }. This is DELIBERATELY
    // separate from /render: it is the ONLY endpoint on this server that invokes a model, and its output is
    // NEVER combined with the placement verdict or the seal — the page shows it in the audit's IDEAL box
    // only (a comparison signal). Keeps "THE RECEIPT IS LLM-FREE" intact: /render stays model-free, /ideal
    // is the separate LLM knock-on. Returns { ideal: null } (not a 500) when qwen is unavailable.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/ideal') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const body = JSON.parse(raw || '{}');
          const { generateIdeal } = await import(resolve(HERE, 'generate-ideal.mjs'));
          const ideal = await generateIdeal(body.intent || '');
          // If the caller passed the reef's ACTUAL selection, also compute the gzip-NCD scorecard here
          // (server-side, LLM-free, deterministic) so a live edit gets the SAME scorecard the baked demo
          // states carry — the browser never runs gzip. The scorecard rides on the ideal for the audit box.
          if (ideal && Array.isArray(body.actual_rules)) {
            try {
              const { scoreActualVsIdeal } = await import(resolve(HERE, 'compute-audit-scorecard.mjs'));
              ideal.scorecard = scoreActualVsIdeal(body.actual_rules, ideal.rules, body.actual_hat || null, ideal.hat || null);
            } catch { /* scorecard optional — the ideal still returns */ }
          }
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ideal }));
        } catch (e) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ideal: null, error: String(e && e.message || e) })); }
      });
      return;
    }
    // THE LENS ENDPOINT (Lens Tester, B1) — run a PROMPT through the real, LLM-free lens (same-origin,
    // 127.0.0.1). Body {prompt, ideal?} → the full readout + retrieved rules + playbook template + the
    // actual-vs-ideal domain match. Same Rust walk as /render; no model in the verdict/prompt cycle.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/lens') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try { const out = await lensReadout(JSON.parse(raw || '{}')); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      });
      return;
    }
    // INTERACTION → TAPE (Step 2): run the prompt through the lens AND append the interaction to the
    // append-only ledger — FIRE-AND-FORGET (respond first, write after) so disk I/O never eats τ. This
    // is how an editable field becomes an end-to-end run written to the tape, same as Claude's CLI.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/lens-run') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        let out; try { out = await lensReadout(JSON.parse(raw || '{}')); }
        catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(out));  // respond FIRST
        try { const rd = out.readout || out; const body = JSON.parse(raw || '{}');
          // unified inbound schema — one pipeline: intent_prompt · reality_context · anomaly_input
          appendFile(resolve(REPO_ROOT, 'data/grip/interactions.ndjson'),
            JSON.stringify({ ts: Date.now(), intent_prompt: body.prompt || '', reality_context: body.reality || null, anomaly_input: body.anomaly || null, ideal: body.ideal || null, domain: rd.domain, match: (out.domain_match ?? null) }) + '\n', () => {}); }
        catch { /* fire-and-forget: never block the response on disk */ }
      });
      return;
    }
    // recent interactions (append-only ledger tail) — the editable-field writes surface here
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/interactions') {
      try { const f = resolve(REPO_ROOT, 'data/grip/interactions.ndjson');
        const lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).slice(-20).map((l) => JSON.parse(l)) : [];
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ interactions: lines }));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    // PASSIVE VIEWPORT SWEEP (Step 6) — the controls (#threshold · #includeFailB · view) are a REFLECTION
    // of the tape, not independent DOM state. On change the page appends a CONFIG frame here FIRE-AND-FORGET
    // (respond first, write after) so the control never waits on disk; the 0.5s poll reads the tail (GET
    // below) and reconciles the controls passively under the yank guard. LLM-free — a pure config ledger.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/viewport-config') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let cfg = {}; try { cfg = JSON.parse(raw || '{}'); } catch { /* tolerate a malformed body — write nulls */ }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: true }));  // respond FIRST
        try { appendFile(resolve(REPO_ROOT, 'data/grip/viewport-config.ndjson'),
          JSON.stringify({ ts: Date.now(), kind: 'viewport_config',
            config: { threshold: cfg.threshold ?? null, include_fail_b: cfg.include_fail_b ?? null, view: cfg.view ?? null } }) + '\n', () => {}); }
        catch { /* fire-and-forget: never block the control on disk */ }
      });
      return;
    }
    // TAPE APPEND (2026-07-18 — "if it recomputes it should advance the tape"): a page-side
    // recompute is a NEW EVENT, not a replay — it must land on the shared tape exactly as a CLI
    // perturb does, same schema, same T-sequence. Replay reads; recompute appends. The page
    // POSTs here after an operator-edit render; the CLI keeps writing the file directly.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/tape-append') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 5e5) req.destroy(); });
      req.on('end', async () => {
        try {
          const b = JSON.parse(raw || '{}');
          // DUST FLOOR — same door-rule as the CLI: <120B corpora blank the panels (measured);
          // the shared tape refuses them unless allow_thin is explicit.
          const iB = Buffer.byteLength((b.inputs && b.inputs.intent) || ''), rB = Buffer.byteLength((b.inputs && b.inputs.reality) || '');
          if (!b.allow_thin && (iB < 40 || rB < 120)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: `dust refused: intent ${iB}B (floor 40) / reality ${rB}B (floor 120) — pass allow_thin for a deliberate negative control` }));
            return;
          }
          const tapeFile = resolve(REPO_ROOT, 'docs/pmu/attest-flight-tape.json');
          const tape = existsSync(tapeFile) ? JSON.parse(readFileSync(tapeFile, 'utf8'))
            : { kind: 'thetacog-attest-flight-tape', air_gapped: true, llm_in_path: false, network_calls: 0, timeline_events: [] };
          if (!Array.isArray(tape.timeline_events)) tape.timeline_events = [];
          const seq = tape.timeline_events.filter((e) => String(e.id).startsWith('T')).length + 1;
          const state = {
            id: 'T' + seq, parent_id: b.parent_id || null, ts: new Date().toISOString(),
            elapsed_ms: b.elapsed_ms ?? null, label: String(b.label || 'page edit') + ' (page)',
            scenarioKey: b.scenarioKey || null, threshold: b.threshold ?? null,
            inputs: b.inputs || {}, metrics: b.metrics || {},
            source: 'page-recompute',   // provenance: the operator edited on the page
          };
          // THE SEAL — same contract as the CLI: content hash always, ed25519-as-room when keys exist
          {
            const tHash = Date.now();
            const content_sha256 = createHash('sha256')
              .update(JSON.stringify({ parent_id: state.parent_id, threshold: state.threshold, inputs: state.inputs, metrics: state.metrics }))
              .digest('hex');
            const hash_ms = Date.now() - tHash;
            let signature = null, signer = null;
            try {
              const { roomIdentity } = await import(resolve(HERE, '../mesh/mesh-keys.mjs'));
              const id = roomIdentity('builder');
              signature = cryptoSign(null, Buffer.from(content_sha256, 'hex'), id.privateKey).toString('hex');
              signer = { room: 'builder', pubkey_hex: id.pubkey_hex, algo: 'ed25519' };
            } catch { /* hash-only */ }
            state.seal = { content_sha256, hash_ms, signature, signer, signed: !!signature };
          }
          tape.timeline_events.push(state);
          tape.generated_at = new Date().toISOString();
          writeFileSync(tapeFile, JSON.stringify(tape, null, 2));
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          // return the FULL seal (not just a prefix) so the page can paint the appended state from the
          // tape as a COMPLETE sealed record — verifySeal recomputes over the same canonical and matches
          // (R3: a live edit lands a complete sealed state, painted from the one source).
          res.end(JSON.stringify({ ok: true, id: state.id, seal: state.seal.content_sha256.slice(0, 12), signed: state.seal.signed, full_seal: state.seal, state }));
        } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      });
      return;
    }
    // PAGE VERSION (2026-07-18 — "running it should auto-refresh the page in .5s"): the mtime of
    // the served attest-demo-ux.html. The open page polls this every 0.5s; when it changes (a
    // regen), the page calls location.reload() — so `run → the tab refreshes itself`, no new tab.
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/page-version') {
      try { const f = resolve(serveDir, 'attest-demo-ux.html'); const { statSync } = await import('node:fs');
        const v = existsSync(f) ? statSync(f).mtimeMs : 0;
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ version: Math.round(v) }));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    // VELOCITY SCENARIOS (2026-07-18 — "runnable on the page"): the experimental design as a
    // GET the page can render. Returns each (prompt, reality-sweep, negative) scenario's
    // convergence chart (driftPct per step) + velocity. Deterministic, LLM-free, no body needed.
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/velocity-scenarios') {
      try {
        const { runAll } = await import(resolve(HERE, 'velocity-scenarios.mjs'));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(runAll()));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    // the latest viewport-config frame (append-only tail) — the 0.5s poll reflects this into the controls
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/viewport-config') {
      try { const f = resolve(REPO_ROOT, 'data/grip/viewport-config.ndjson'); let last = null;
        if (existsSync(f)) { const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean); if (lines.length) last = JSON.parse(lines[lines.length - 1]); }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ config: last ? last.config : null, ts: last ? last.ts : null }));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    // AGENT LEG (Stage 2 · Mode B): the LLM is the DRIVER, never the brake. /agent-run calls the LOCAL
    // model (qwen via ollama) to GENERATE the reality (work product) from the intent; the UI drops it into
    // the Reality box and runs the SAME gate. The model NEVER touches the verdict/metric path — LLM-free holds.
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/agent-run') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const b = JSON.parse(raw || '{}'); const intent = String(b.intent || '').slice(0, 2000);
          const model = b.model || 'qwen2.5:7b';
          const rr = await fetch('http://localhost:11434/api/generate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model, stream: false, prompt: `You are an autonomous AI agent executing this authorized task. Output ONLY your actual work product — what you did or produced — in 2-5 plain sentences, no preamble, no meta:\n\n${intent}` }),
            signal: AbortSignal.timeout(60000),
          });
          if (!rr.ok) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `agent model returned ${rr.status}` })); return; }
          const j = await rr.json();
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ reality: String(j.response || '').trim(), model, note: 'agent leg — the LLM DROVE the reality; the gate stays LLM-free' }));
        } catch (e) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), hint: 'local qwen (ollama :11434) unavailable — Mode A presets still work' })); }
      });
      return;
    }
    // the lens tape (battery + agreement) — same-origin GET for the Lens Tester picker
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/lens-tape') {
      try { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(readLensTape())); }
      catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    // ── AUTO-TICK CONTROL (2026-07-20 — operator: "we need a checkbox for the page to run the
    // auto tick"). The loop that decomposes the repo into the high-dimensional tesseract runs
    // OUTSIDE this server (scripts/pmu/reef-loop.sh). These endpoints touch only its two DESIGNED
    // control surfaces: the pause file (via the loop's own CLI, bounded) and the per-tick env file
    // (A/B arm — a file write IS the switch, re-read at the top of every tick). They never spawn a
    // loop and never block: a dead loop is reported, not resurrected — starting one is a terminal
    // act. 127.0.0.1-only like everything here; the file:// page stays air-gapped (checkbox
    // disables itself when these endpoints are unreachable).
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/loop-status') {
      try {
        const st = { running: false, pid: null, paused: false, ab: false, lastStages: '' };
        try {
          st.pid = parseInt(readFileSync(resolve(REPO_ROOT, '.thetacog/reef-loop.pid'), 'utf8').trim(), 10) || null;
          if (st.pid) { try { process.kill(st.pid, 0); st.running = true; } catch { st.running = false; } }
        } catch { /* no pid file */ }
        try {
          const until = parseInt(readFileSync(resolve(REPO_ROOT, '.thetacog/reef-loop.pause-until'), 'utf8').trim(), 10);
          st.paused = Number.isFinite(until) && until * 1000 > Date.now();
        } catch { /* not paused */ }
        try { st.ab = /^GRAMMATICAL_WALK_AB=1/m.test(readFileSync(resolve(REPO_ROOT, '.thetacog/reef-loop.env'), 'utf8')); } catch { /* no env */ }
        try {
          const log = readFileSync(resolve(REPO_ROOT, '.thetacog/reef-loop.log'), 'utf8');
          const m = log.slice(-8000).match(/stage-times:[^\n]*/g);
          st.lastStages = m ? m[m.length - 1] : '';
        } catch { /* no log */ }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(st));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/loop-control') {
      let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e4) req.destroy(); });
      req.on('end', async () => {
        try {
          const body = JSON.parse(raw || '{}');
          const action = String(body.action || '');
          const { execFileSync } = await import('node:child_process');
          const envPath = resolve(REPO_ROOT, '.thetacog/reef-loop.env');
          if (action === 'pause') {
            execFileSync('bash', [resolve(REPO_ROOT, 'scripts/pmu/reef-loop.sh'), 'pause', '24'], { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
          } else if (action === 'resume') {
            execFileSync('bash', [resolve(REPO_ROOT, 'scripts/pmu/reef-loop.sh'), 'resume'], { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
          } else if (action === 'ab-on' || action === 'ab-off') {
            let env = ''; try { env = readFileSync(envPath, 'utf8'); } catch { /* create */ }
            const want = action === 'ab-on' ? 'GRAMMATICAL_WALK_AB=1' : 'GRAMMATICAL_WALK_AB=0';
            env = /^GRAMMATICAL_WALK_AB=/m.test(env) ? env.replace(/^GRAMMATICAL_WALK_AB=[01]/m, want) : env + '\n' + want + '\n';
            writeFileSync(envPath, env);
          } else {
            res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown action' })); return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, action }));
        } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      });
      return;
    }
    // the FULL reef (all domains · rules · hats/templates) — same-origin GET for the preset dropdowns
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/reef') {
      try {
        const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'data/pmu/lens-reef.json'), 'utf8'));
        const domains = (raw.domains || []).map((d) => ({ domain: d.domain, coord: d.coord, rules: d.rules || [], template: d.template || null, anchors: d.anchors || [] }));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ domains }));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e) })); }
      return;
    }
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = resolve(serveDir, '.' + (url === '/' ? '/attest-demo-ux.html' : url));
    if (!safe.startsWith(serveDir) || !existsSync(safe)) { res.writeHead(404); res.end('not found'); return; }
    const ext = safe.slice(safe.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': CT[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(safe).pipe(res);
  } catch { res.writeHead(500); res.end('err'); }
});

server.on('error', (e) => { try { if (portFile) writeFileSync(portFile, 'ERR'); } catch { /* */ } console.error(`attest-serve: ${(e && e.code) || e}`); process.exit(1); });
server.listen(FIXED_PORT, '127.0.0.1', () => {
  const port = server.address().port;
  try { if (portFile) writeFileSync(portFile, String(port)); } catch { /* */ }
  try { if (pidFile) writeFileSync(pidFile, String(process.pid)); } catch { /* */ }
  // PRE-WARM the on-chip daemon so the FIRST user render is hot/full, not a cold sparse walk ("rust
  // populate all"). Two throwaway triptychs (A + B shape) prime the daemon + module cache before any edit.
  (async () => { try { await renderPanels({ intent: 'warmup intent corpus for the on-chip daemon priming pass here', reality: 'warmup reality corpus for the daemon priming pass here now', negative: 'warmup negative corpus offshore bypass sign-off here' }); } catch { /* */ } })();
});
// self-terminate after 30 minutes so a forgotten server never lingers
// TTL (operator 2026-07-20: "fix the mortality thing — if we want it to stay alive make it"):
// default stays 30 min for ad-hoc runs; THETACOG_ATTEST_TTL_MS=0 means IMMORTAL (overnight loop —
// the reef-loop watchdog owns the lifecycle then). Any other value overrides the TTL in ms.
const TTL_MS = process.env.THETACOG_ATTEST_TTL_MS != null ? parseInt(process.env.THETACOG_ATTEST_TTL_MS, 10) : 30 * 60 * 1000;
if (TTL_MS > 0) setTimeout(() => process.exit(0), TTL_MS);
}   // end IS_MAIN server block
