// scripts/vna/round-sidecar.mjs — the one home of a dispatched round's file names (C612a · C612g · C612i). LLM-FREE, no imports
// beyond node:path, so a per-write hook (C612i's return-reading.mjs) can name the round without loading the drift note's walk.
//
// Moved here from drift-note.mjs (C612i): drift-note.mjs re-exports roundSidecarPath unchanged, so every caller keeps its import;
// the move only takes the ~600 ms walk-library load off the path a per-write hook pays.
//
//   <dir>/<n>-<label>.round.ndjson      the round sidecar: C612a's door lines, C612g's re-read lines, C612i's returned readings
//   <dir>/<n>-<label>.round-named.json  the note's named paths for the round (the brief's targets ∪ the fast note's files),
//                                       written by the runner before the worker spawns, read by the C612i hook
//
// @guard tests/vna/c612i-the-reading-returns-to-the-actor.test.mjs
import { join } from 'node:path';

const stem = ({ label, n = null }) => `${n != null ? `${n}-` : ''}${label}`;
export const roundSidecarPath = ({ dir, label, n = null }) => join(dir, `${stem({ label, n })}.round.ndjson`);
export const roundNamedPath = ({ dir, label, n = null }) => join(dir, `${stem({ label, n })}.round-named.json`);
