// scripts/vna/door-cmd.mjs — THE PAGE'S OWN COMMAND LINES, AWAY FROM HOME (C94b: THE EXTENSION LEAVES HOME).
//
// Every card on the steer page prints `not run — <command>` where a receipt is absent (§15) — and the command it has
// always printed is `node scripts/vna/<x>.mjs`, which exists only in the thetadrivencoach tree. In a stranger's repo that
// line is a path they do not have: a zero wearing a label. This module is the mjs twin of the extension's one command
// table (packages/thetacog-mcp-vscode/src/commands.ts): the same door → script pairs, the same home detection (the
// marker script on disk AND package.json's name), and ONE rewrite applied at the page's write boundary — every
// `node scripts/<dir>/<x>.mjs …` becomes `npx thetacog-mcp <door> …` when the script is a door, or
// `not run — <x>.mjs has no npx door yet` when it is not. At home nothing is rewritten: the running code is the command.
//
// Pure over the strings it is handed; the only I/O is the home test. tests/vna/c94-foreign-repo-bootstrap.test.mjs diffs
// this table against the extension's and server.js's, and renders the page in an empty repo to see the rewrite land.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'thetacog-mcp';
export const HOME_NAME = 'thetadrivencoach';
export const HOME_MARKER = 'scripts/vna/steer-ui.mjs';

/** door → repo-relative script. The SAME pairs as commands.ts (extension) and server.js VNA_DOORS + walk/replay (package). */
export const DOORS = Object.freeze({
  'steer-ui': 'scripts/vna/steer-ui.mjs',
  cockpit: 'scripts/vna/cockpit.mjs',
  'aperture-receipt': 'scripts/vna/aperture-receipt.mjs',   // C115
  'recompute-receipt': 'scripts/vna/recompute-receipt.mjs', // C241
  story: 'scripts/vna/story.mjs',
  'alignment-map': 'scripts/vna/alignment-map.mjs',
  'competence-pixel': 'scripts/vna/competence-pixel.mjs',
  'parametric-trigger': 'scripts/vna/parametric-trigger.mjs',
  envelope: 'scripts/vna/envelope.mjs',
  mesh: 'scripts/vna/mesh.mjs',
  'spec-tree': 'scripts/vna/spec-tree.mjs',
  goal: 'scripts/vna/goal.mjs',
  'runner-reading': 'scripts/vna/runner-reading.mjs',
  'straight-path': 'scripts/vna/straight-path.mjs',
  'clip-ingest': 'scripts/vna/clip-ingest.mjs',
  'clip-watch': 'scripts/vna/clip-watch.mjs',
  'underwriter-line': 'scripts/vna/underwriter-line.mjs',
  'auth-flow': 'scripts/vna/auth-flow.mjs',
  walk: 'scripts/pmu/walk.mjs',
  replay: 'scripts/pmu/replay.mjs',
  steer: 'scripts/vna/steer.mjs',                         // C297 — the 💬 Steer Chat's own doors
  workers: 'scripts/vna/workers.mjs',
  'keep-running': 'scripts/vna/keep-running.mjs',
  'chat-context': 'scripts/vna/chat-context.mjs',
  'chat-model-verb': 'scripts/vna/chat-model-verb.mjs',
  'steer-runner': 'scripts/vna/steer-runner.mjs',
  'runner-resolver': 'scripts/vna/runner-resolver.mjs',
  'local-models': 'scripts/vna/local-models.mjs',
});
const DOOR_OF = new Map(Object.entries(DOORS).map(([d, s]) => [s, d]));

/** HOME = the marker script under `repo` AND its package.json names this repo. Both, never one; never a hardcoded path. */
export function isHome(repo) {
  if (!repo) return false;
  try {
    if (!existsSync(resolve(repo, HOME_MARKER))) return false;
    return JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).name === HOME_NAME;
  } catch { return false; }
}

/** the repo a vna script is reading: VNA_REPO (server.js sets it to the caller's cwd for every door) else the script's own tree */
export const targetRepo = () => process.env.VNA_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** one command line, resolved: `node scripts/vna/x.mjs args` at home · `npx thetacog-mcp <door> args` away · `not run — x.mjs has no npx door yet` */
export function doorCmd(script, args = [], { home = isHome(targetRepo()) } = {}) {
  const rel = String(script).replace(/\\/g, '/');
  const tail = args.length ? ' ' + args.join(' ') : '';
  if (home) return `node ${rel}${tail}`;
  const door = DOOR_OF.get(rel);
  if (!door) return `not run — ${rel.split('/').pop()} has no npx door yet`;
  return `npx ${PACKAGE} ${door}${tail}`;
}

// `node scripts/<dir>/<x>.mjs` and whatever flags follow on the same line up to a closing tag, quote, backtick or line end
const CMD_RE = /node scripts\/(vna|pmu)\/([\w-]+\.mjs)((?:[ \t]+--?[\w-]+(?:[ \t]+[\w.:/-]+)?)*)/g;

/** the one rewrite, at the write boundary: every `node scripts/<dir>/<x>.mjs …` in `text` → its away-from-home line. Identity at home. */
export function awayCommands(text, { home = isHome(targetRepo()) } = {}) {
  if (home) return text;
  return String(text).replace(CMD_RE, (_m, dir, file, flags) => {
    const rel = `scripts/${dir}/${file}`;
    const args = flags.trim() ? flags.trim().split(/\s+/) : [];
    const line = doorCmd(rel, args, { home: false });
    // a script with no door: the whole `node …` command becomes the reason (the caller's own "not run — " prefix, if any, is
    // left standing — "not run — not run — x" never prints because doorCmd's reason is substituted into the code span only)
    return line.startsWith('not run — ') ? line.slice('not run — '.length) : line;
  });
}

// ── C103f THE CARD IS A LINK — THE PANEL POINTS AT THE DOCUMENT, NEVER WRITES IT OUT (operator 2026-09-20: "really what they
// are is links — to the spec, for example, or the Merkle tree — that are opened in the IDE itself … when you click it, you open
// the document"). One table, mirrored in the extension's commands.ts (the guard diffs them): each card's document — the
// repo-relative paths the command opens (a text document opens as the file, editable; a page with a rendered HTML receipt opens
// in the webview), the command the panel posts, the `not run — <command>` line when the receipt has not been rendered yet.
// The contract's document is the spec at the unit's row line — vna.viewUnit, already built (C98d); the tree line and the spec
// line under TASKS point at their files the same way.
export const DOCS = Object.freeze({
  walk: { cmd: 'vna.openWalk', label: '↗ Open the walk', paths: ['docs/specs/vna/turns/latest.html', '.thetacog/walk-tape.ndjson'], page: 'docs/specs/vna/turns/latest.html', notRun: 'node scripts/vna/cockpit.mjs' },
  contract: { cmd: 'vna.viewUnit', label: '📄 View Unit Contract', paths: ['docs/specs/vna/SPEC-VNA-COCKPIT.md'], page: null, notRun: null },
  cog: { cmd: 'vna.openCog', label: '↗ Open the cog ledger', paths: ['data/vna/cog.ndjson', 'data/vna/cog-peg.json'], page: null, notRun: 'node scripts/vna/cog.mjs --since <sha>' },
  run: { cmd: 'vna.openRunLog', label: '↗ Open the runner log', paths: ['.thetacog/runner.ndjson'], page: null, notRun: 'run one goal' },
  reader: { cmd: 'vna.openTape', label: '↗ Open the tape', paths: ['data/vna/flight-tape.ndjson'], page: null, notRun: 'no tape yet' },
  bridge: { cmd: 'vna.openBridge', label: '↗ Open the steer file', paths: ['.thetacog/vna-steer-file.json', 'docs/specs/vna/RESEARCH-BUNDLE.txt'], page: null, notRun: 'node scripts/vna/clip-ingest.mjs --clip' },
  spec: { cmd: 'vna.openSpec', label: '↗ Open the spec', paths: ['docs/specs/vna/SPEC-VNA-COCKPIT.md'], page: null, notRun: null },
  tree: { cmd: 'vna.openTree', label: '↗ Open the tree', paths: ['data/vna/spec-tree.txt'], page: null, notRun: 'node scripts/vna/spec-tree.mjs' },
});
/** the document control's tooltip: the paths it opens (exists on disk, or `not run — <command>` for a receipt not rendered yet) */
export function docTooltip(kind, { repo = targetRepo(), home = isHome(repo) } = {}) {
  const d = DOCS[kind]; if (!d) return null;
  const there = d.paths.filter((p) => existsSync(resolve(repo, p)));
  const missing = d.paths.filter((p) => !existsSync(resolve(repo, p)));
  const opens = there.length ? `opens ${there.join(' · ')} in the editor${d.page && there.includes(d.page) ? ' (the rendered page in a webview)' : ''}` : '';
  const absent = missing.length ? `${d.notRun ? `not run — ${awayCommands(d.notRun, { home })}` : 'not on disk'} (${missing.join(' · ')})` : '';
  return `${[opens, absent].filter(Boolean).join(' · ')}; next: read it, or edit the file — the fold reads the hand-edited spec on the next turn`;
}
