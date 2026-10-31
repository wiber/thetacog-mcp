#!/usr/bin/env node
// scripts/vna/llm-tape.mjs — C517 THE ONE LLM-TAPE PLACEMENT, SHARED BY EVERY WRAPPER WORKLOAD.
// C504 put the first wrapper workload (steer-runner's `claude -p` calls) on its own signed tape, llm-steer-runner.ndjson,
// by calling straight into intentguard/llm's placeLLM from inside steer-runner.mjs. Operator 2026-09-30, verbatim: "seeing
// both your llm wrapper workloads visualised as tapes … you know where your money went" — but only ONE wrapper workload
// ever wrote a row (measured 2026-10-01: llm-steer-runner.ndjson holds 1 row ever); the local-model door (the ollama calls
// triage, bench, companion and the mutator go through) wrote nothing, because the placement lived inside steer-runner.mjs
// where no local caller could reach it. This file is that placement, pulled out so a SECOND caller signs through the SAME
// chain-and-sign path, never a second copy of it (the house rule: a rule stated once lives in one place).
// TAPE, NOT BRAKE: placeLLM() never throws and never blocks the call it is placing — it runs AFTER the call returned, and a
// placement that fails writes an UNMEASURED row of the same shape rather than touching the caller's own result.
// SUFFICIENT FOR: "every call placed through here was signed, in order, against the spec declared before it ran, on ITS
// tape". NOT SUFFICIENT FOR: whether the call's answer was right (Rice), or a call this module never saw.
// Port row: none — transport (a require, a file append); the placement and chain live in the crate already (C504's note).
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { loadAddon } from '../../src/lib/intentguard/addon.mjs';   // C504: the host addon — the one resolution
import { witnessConfig as fleetWitness, tapeDir as fleetTapeDir } from '../intentguard/fleet-harness.mjs';   // C504: the fleet tape dir and witness switch — one rule, never a copy

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');

// C517: the second wrapper workload's own tape — every local (ollama) call's row, never $0, always 'local-unpriced'
export const LOCAL_TAPE_NAME = 'llm-local.ndjson';

/** The tape under the RUN's repo (a fixture repo's run never writes the live tape); INTENTGUARD_FLEET_TAPE_DIR overrides, as for the fleet. */
export const llmTapePath = (name, repo = REPO, env = process.env) => (env.INTENTGUARD_FLEET_TAPE_DIR ? resolve(fleetTapeDir(env), name) : resolve(repo, '.thetacog/fleet-tape', name));

let IG_LLM = null, IG_ADDON = null;
const igLlm = () => IG_LLM || (IG_LLM = createRequire(import.meta.url)(resolve(HERE, '..', '..', 'packages/intentguard/own/llm.js')));
const igAddon = () => { if (IG_ADDON) return IG_ADDON; try { const { addon, reason } = loadAddon(); IG_ADDON = addon && typeof addon.openSpec === 'function' ? { addon } : { addon: null, addonReason: reason || 'the host addon has no openSpec' }; } catch (e) { IG_ADDON = { addon: null, addonReason: String(e && e.message || e) }; } return IG_ADDON; };

// C515 — THE SLICE A NAMED ROW PLACES AGAINST: its own bullet line (the row text, its guard inline) plus every other
// row under the same heading (its basin's siblings) — the same grouping the snowball's bundle() walks off the tree for,
// read straight off the markdown here so a placement never has to open the JSON tree to find it. openSpec() on the host
// addon walks whatever text it is handed; handing it a 1.4 MB file (the whole spec) was the 50-456 ms the asks ledger
// found — a few KB section is what the call actually concerns. Returns null when the label names no row in this text
// (the caller falls back to the whole spec, never to UNMEASURED, when a label was given but is not itself a spec row —
// e.g. triage's label is a halt class, not a C-row).
export function rowSlice(md, label) {
  if (!label) return null;
  const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp(`^\\s*- \\[( |x)\\] ${esc}\\b`);
  const headingRe = /^#{1,6}\s/;
  const lines = String(md || '').split('\n');
  let rowIdx = -1;
  for (let i = 0; i < lines.length; i++) { if (rowRe.test(lines[i])) { rowIdx = i; break; } }
  if (rowIdx < 0) return null;
  let headIdx = -1;
  for (let i = rowIdx; i >= 0; i--) { if (headingRe.test(lines[i])) { headIdx = i; break; } }
  let endIdx = lines.length;
  if (headIdx >= 0) { for (let i = headIdx + 1; i < lines.length; i++) { if (headingRe.test(lines[i])) { endIdx = i; break; } } }
  const section = headIdx >= 0 ? lines.slice(headIdx, endIdx) : [lines[rowIdx]];
  const heading = headIdx >= 0 ? lines[headIdx] : null;
  const siblings = section.filter((l) => /^\s*- \[( |x)\]/.test(l));
  const text = [heading, ...siblings].filter((l) => l != null).join('\n');
  return { label: String(label), heading, siblings: siblings.length, text, sha: createHash('sha256').update(text).digest('hex') };
}

// C521 THE COMMIT THE WRAPPER RAN AT — a wrapper call has no commit of its own, so its encircled Δ panel is the panel of the code it
// ran (HEAD at call time). Stamped on the row's job as `commit`; null when the repo has no git (the page then reads UNMEASURED).
export function headCommit(repo = REPO) {
  // read .git directly (a file read, under a millisecond — C515's 50 ms placement budget has no room for a git spawn); `git` only as the fallback
  try {
    let gd = resolve(repo, '.git'); try { const f = readFileSync(gd, 'utf8'); const m = /^gitdir:\s*(.+)$/m.exec(f); if (m) gd = resolve(repo, m[1].trim()); } catch { /* .git is a directory */ }
    const h = readFileSync(resolve(gd, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(h)) return h;
    const ref = /^ref:\s*(\S+)$/.exec(h); if (ref) {
      const common = (() => { try { return resolve(gd, readFileSync(resolve(gd, 'commondir'), 'utf8').trim()); } catch { return gd; } })();
      for (const base of [gd, common]) { try { const v = readFileSync(resolve(base, ref[1]), 'utf8').trim(); if (/^[0-9a-f]{40}$/.test(v)) return v; } catch { /* packed */ } }
      try { const line = readFileSync(resolve(common, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref[1])); if (line && /^[0-9a-f]{40}/.test(line)) return line.slice(0, 40); } catch { /* none */ }
    }
  } catch { /* no .git here */ }
  try { const s = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim(); return /^[0-9a-f]{40}$/.test(s) ? s : null; } catch { return null; }
}

export function tapeUnmeasured(tapePath, meta, why) {
  mkdirSync(dirname(tapePath), { recursive: true });
  appendFileSync(tapePath, JSON.stringify({ job: { ...meta }, seq: null, action: null, receipt: null, ts: new Date().toISOString(), spec_sha256: null, witnessed: false, unmeasured: why }) + '\n');
}

// one job slot per tape name: the harness holds `job` BY REFERENCE for the chain it keeps per (spec sha, tape) — so the
// per-call metadata is written by mutating the same object in place, never by handing it a fresh one each call (the
// C504 note: "LLM_JOB is ONE object rewritten before each place"). Each tape gets its own slot so two doors never share one.
const JOB_SLOTS = new Map();
function jobSlot(tapeName) { let j = JOB_SLOTS.get(tapeName); if (!j) { j = {}; JOB_SLOTS.set(tapeName, j); } return j; }

/** C504/C517 — place one returned LLM call (a claude -p worker OR a local-model door) on ITS tape, chained and signed
 *  through intentguard/llm's placeLLM. Never throws; never reads or writes anything belonging to the caller's own result. */
export function placeLLM({ tapeName, job, prompt = '', completion = '', model = null, specPath, repo = REPO, env = process.env, tape = null, keyHome = null, witness = undefined, placer = null, addon = undefined } = {}) {
  const t0 = performance.now();
  let tapePath = null, meta = null;
  try {
    tapePath = tape || llmTapePath(tapeName, repo, env);
    const slot = jobSlot(tapeName);
    for (const k of Object.keys(slot)) delete slot[k];
    Object.assign(slot, job, model != null ? { model } : {});
    if (slot.commit == null) { const c = headCommit(repo); if (c) slot.commit = c; }   // C521: the commit this call ran at — its panel's key
    meta = slot;
    // C515: a named row places against ITS OWN slice (its line + its basin's siblings), never the 1.4 MB file — a
    // label that names no row in this text (a triage halt class, say) falls back to the whole spec, same as before
    // this row; a call that names NO row at all (no label) reads UNMEASURED and never opens the spec file.
    let spec = '', sliceSha = null;
    if (meta.label) {
      let md = null; try { md = readFileSync(specPath, 'utf8'); } catch { /* no spec file: placeLLM names it UNMEASURED */ }
      if (md != null) { const sl = rowSlice(md, meta.label); if (sl) { spec = sl.text; sliceSha = sl.sha; } else spec = md; }
    }
    const wc = witness !== undefined ? witness : (() => { const x = fleetWitness(env); return x.witnessUrl ? { url: x.witnessUrl, licence: x.licence } : null; })();
    const a = addon !== undefined ? { addon } : igAddon();
    const opts = { spec, prompt, completion, model: meta.model, tape: tapePath, job: meta,
      keyHome: keyHome || env.INTENTGUARD_HOME || resolve(homedir(), '.intentguard'), ...(wc ? { witness: wc } : {}), ...a };
    const out = (placer || igLlm().placeLLM)(opts) || {};
    if (!Number.isInteger(out.seq)) tapeUnmeasured(tapePath, meta, out.unmeasured || 'UNMEASURED: the placer returned no row');
    return { ...out, job: meta, tape: tapePath, slice_sha256: sliceSha, ms: +(performance.now() - t0).toFixed(2) };
  } catch (e) {
    const why = `UNMEASURED: placement failed — ${String(e && e.message || e).slice(0, 300)}`;
    try { tapeUnmeasured(tapePath || llmTapePath(tapeName, repo, env), meta || { ...job }, why); } catch { /* the tape is not a brake either */ }
    return { receipt: null, seq: null, unmeasured: why, job: meta, tape: tapePath, ms: +(performance.now() - t0).toFixed(2) };
  }
}
