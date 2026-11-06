#!/usr/bin/env node
// scripts/vna/post-run-drift.mjs — C2348: CHAIR DECOMPOSITION OF C2330 — AFTER EACH WORKER STEP THE TESSERACT SENSOR NAMES
// THE RULES AND FILES THE WORK DRIFTED FROM AND PUTS THEM BACK INTO THE NEXT TURN'S BRIEF. LLM-FREE.
//
// drift-note.mjs's driftNote() walks a row's declaration against the files it names, BEFORE the worker wakes (C610g) — the
// PRE-RUN half. This module runs the SAME engine the other way round, AFTER the commit lands: intent = the row's own
// declaration (read at the new HEAD, outside the actor's failure domain — AXIOM 1's W3), reality = the files the commit
// ACTUALLY touched (`git diff --name-only head0 head1`, each read at head1 with `git show`, never the working tree). A
// worker that drifted onto paths the row never named, or away from ones it did, shows up as the same red cells the pre-run
// door already draws. The note's rows/rules/files are information for the NEXT dispatch's brief (withPostRunNote) —
// never this one's, because the work this note reads about already happened and cannot be undone by reading it.
//
// SUFFICIENT FOR: which rules and files the committed work and its own declaration already disagree on, once the commit
// exists.
// NOT SUFFICIENT FOR: whether the disagreement is a problem, or whether the work was good (Rice).
//
// Rust port row: none — this module decides nothing of its own (driftNote's door, localiser and snowball decide; this file
// only picks the file set a finished commit touched) and holds no mass; orchestration stays node under MAXIMISE RUST.
//
// @guard tests/vna/c2348-chair-decomposition-of-the-operator-s.test.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driftNote, LABEL as PRE_RUN_LABEL } from './drift-note.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = process.env.VNA_REPO || resolve(HERE, '..', '..');
export const LABEL = 'POST-RUN DRIFT';
export const SUFFICIENT_FOR = 'which rules and files the committed work and its own declaration already disagree on, once the commit exists';
export const NOT_SUFFICIENT_FOR = 'whether the disagreement is a problem, or whether the work was good (Rice)';

const tryGit = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** The files one commit range actually touched — named at the NEW head, never the old tree and never a diff's own text (W3). */
export function touchedFiles(repo, head0, head1) {
  if (!head0 || !head1 || head0 === head1) return [];
  const out = tryGit(repo, ['diff', '--name-only', head0, head1]);
  return out ? out.split('\n').filter(Boolean) : [];
}

const unmeasured = (label, head1, why) => ({ v: 1, label, head: head1, admissible: false, why, zones: [], rows: [], rules: [], files: [],
  sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR, text: `${LABEL} — UNMEASURED for ${label}: ${why}.` });

/**
 * postRunDriftNote — the post-run note for one dispatched step. intent = the row's declaration (read at specPath, which the
 * caller already re-reads post-commit — W3); reality = the files this commit's own range touched, read at head1 with `git
 * show` (never the working tree, never head0's copy). Runs driftNote() unchanged (the one door, the one localiser, the one
 * snowball) and relabels its text from CURRENT DRIFT to POST-RUN DRIFT — one engine, two mouths, never two walks.
 */
export async function postRunDriftNote({ repo = REPO, specPath, label, head0, head1, panelFn = null, walk = null, retroGrowFn = undefined, tree = null, rows = null, apertureVersion = null, lib = undefined } = {}) {
  const paths = touchedFiles(repo, head0, head1);
  if (!paths.length) return unmeasured(label, head1, `the commit between ${String(head0 || '?').slice(0, 10)} and ${String(head1 || '?').slice(0, 10)} names no file git can diff by name`);
  const row = (readFileSync(specPath, 'utf8').split('\n').find((l) => new RegExp(`^\\s*- \\[[ x]\\] ${label}\\b`).test(l)) || '').trim();
  const intent = row.replace(/^\s*-\s*\[[ xX]\]\s*/, '');
  const files = [];
  for (const p of paths) {
    try { files.push({ path: p, text: execFileSync('git', ['show', `${head1}:${p}`], { cwd: repo, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') }); }
    catch { /* deleted by this commit — nothing left to read at the new head; the surviving touched files still carry the note */ }
  }
  if (!files.length) return unmeasured(label, head1, 'every file this commit touched was deleted — nothing survives to read at the new head');
  const note = await driftNote({ label, intent, files, tree, rows, panelFn, walk, ...(retroGrowFn !== undefined ? { retroGrowFn } : {}), apertureVersion, head: head1, lib });
  return { ...note, label, sufficient_for: SUFFICIENT_FOR, not_sufficient_for: NOT_SUFFICIENT_FOR, touched: paths,
    text: note.text ? note.text.split(PRE_RUN_LABEL).join(LABEL) : note.text };
}

/** The NEXT brief, with the note appended ONLY when admissible — otherwise the same bytes (C610g's own rule, restated here). */
export function withPostRunNote(brief, note) {
  if (!note || note.admissible !== true || !note.text) return brief;
  return `${brief}\n\n${note.text}`;
}

export function postRunNotePath({ dir, label, n = null }) { return join(dir, `${n != null ? `${n}-` : ''}${label}.post-run-note.txt`); }
/** The sidecar beside the dispatch log — always written, admissible or not, so a quiet UNMEASURED is still on the record. */
export function writePostRunNote(note, { dir, label = note && note.label, n = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const p = postRunNotePath({ dir, label, n });
  const { text, detail, ...rest } = note || {};
  writeFileSync(p, `${text || `${LABEL} — UNMEASURED for ${label}: no note was produced`}\n\n--- receipt ---\n${JSON.stringify(rest, null, 2)}\n`);
  return p;
}
