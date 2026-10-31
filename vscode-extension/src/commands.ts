// packages/thetacog-mcp-vscode/src/commands.ts — THE COMMAND TABLE, in one place (C94b: THE EXTENSION LEAVES HOME).
//
// Every child process this extension spawns is resolved HERE. At HOME — the workspace is the thetadrivencoach repo,
// DETECTED by scripts/vna/steer-ui.mjs on disk AND package.json's name agreeing, never a hardcoded path — a door is
// `node scripts/vna/<x>.mjs`, the running code, relative to the workspace. Anywhere else it is `npx thetacog-mcp <door>`:
// the published package dispatches the same door (packages/thetacog-mcp/server.js, the caller's cwd preserved and
// VNA_REPO set to it), bundled at prepack (scripts/bundle-pmu.mjs). A script that is not a door has NO command away
// from home and says so — `not run — <script> has no npx door yet` — because a path that exists only in this tree is
// not a command a stranger can run, and a card that names one is a zero wearing a label (§15).
//
// THE SAME PAIRS sit in three places and a guard diffs them (tests/vna/c94-foreign-repo-bootstrap.test.mjs): this
// table (what the extension spawns), server.js's dispatch table (what the package answers to), scripts/vna/door-cmd.mjs
// (what the page's own not-run lines print). One rule, one address per runtime, one guard between them.
//
// No vscode import: the module is pure so the guard can compile and run it, and so the mjs twin can mirror it.
// LLM-FREE: nothing here calls a model.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import * as path from 'path';

export const PACKAGE = 'thetacog-mcp';

// THE VSIX CARRIES ITS ENGINE (operator 2026-10-20: "package the npm package inside the vsx … test that you dont need to install
// anything extra"). A stranger's clean install painted ten "not run" lines: every door was `npx thetacog-mcp <door>`, npm held a
// three-week-old engine, and their Claude had to vet and globally install it by hand. scripts/bundle-engine.mjs now packs the
// engine into <extension>/engine/ at vscode:prepublish, and away from home a door runs THAT engine on the editor's own runtime:
// a `node` shim that execs process.execPath (VS Code's Electron) as plain Node, first on the engine's PATH so the engine's own
// `spawn('node', …)` children find it too. No node, no npx, no npm on the stranger's machine. Windows: UNMEASURED (the shim is a
// sh script; a Windows host falls back to npx). @guard tests/vna/vsix-carries-its-engine.test.mjs
type Engine = { server: string; node: string };
let ENGINE: Engine | null = null;
export function bundledEngine(): Engine | null { return ENGINE; }
export function useBundledEngine(extensionRoot: string, execPath: string, shimDir: string, platform: string = process.platform): Engine | null {
    const server = path.join(extensionRoot, 'engine', 'server.js');
    if (!existsSync(server) || platform === 'win32') { ENGINE = null; return null; }
    mkdirSync(shimDir, { recursive: true });
    const node = path.join(shimDir, 'node');
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    writeFileSync(node, `#!/bin/sh\n# ThetaCog Steer: the editor's runtime as Node, for the bundled engine\nexport ELECTRON_RUN_AS_NODE=1\nexport PATH=${q(shimDir)}:"$PATH"\nexec ${q(execPath)} "$@"\n`);
    chmodSync(node, 0o755);
    ENGINE = { server, node };
    return ENGINE;
}
/** the name in this repo's package.json — the second signal; the marker script alone is never home */
export const HOME_NAME = 'thetadrivencoach';
export const HOME_MARKER = path.join('scripts', 'vna', 'steer-ui.mjs');

/** door → the repo-relative script the door runs. Keys are the subcommands `npx thetacog-mcp <door>` dispatches. */
export const DOORS: Readonly<Record<string, string>> = Object.freeze({
    'steer-ui': 'scripts/vna/steer-ui.mjs',            // the map and the spec on one page — what the sidebar renders
    cockpit: 'scripts/vna/cockpit.mjs',                // the ballistic walk on the chip (rust) — the three panels
    'aperture-receipt': 'scripts/vna/aperture-receipt.mjs',   // C115: S_in · F_in · κ · ω composed off the cockpit receipt + git at the commit
    'recompute-receipt': 'scripts/vna/recompute-receipt.mjs', // C241: the recompute door — a stranger re-derives a receipt from the immutable commit; match / MISMATCH / UNMEASURED + one pasteable line
    story: 'scripts/vna/story.mjs',                    // the shape, its movement, its meaning
    'alignment-map': 'scripts/vna/alignment-map.mjs',  // nine rooms vs declared poles
    'competence-pixel': 'scripts/vna/competence-pixel.mjs',
    'steer-ab-tokens': 'scripts/vna/steer-ab-tokens.mjs',   // C510: STEER vs PLAIN tokens per unit by complexity decile — writes the receipt the stats page reads
    'parametric-trigger': 'scripts/vna/parametric-trigger.mjs',
    envelope: 'scripts/vna/envelope.mjs',              // both arms
    mesh: 'scripts/vna/mesh.mjs',                      // the net — strands, holes and mesh size
    'spec-tree': 'scripts/vna/spec-tree.mjs',          // the Merkle tree over the amendments
    goal: 'scripts/vna/goal.mjs',                      // status · copy · import
    'runner-reading': 'scripts/vna/runner-reading.mjs',
    'straight-path': 'scripts/vna/straight-path.mjs',
    'clip-ingest': 'scripts/vna/clip-ingest.mjs',      // the one-shot clipboard door (C98e)
    'clip-watch': 'scripts/vna/clip-watch.mjs',        // arm · disarm
    'underwriter-line': 'scripts/vna/underwriter-line.mjs',
    'auth-flow': 'scripts/vna/auth-flow.mjs',          // whoami · verify · connect — the $20 key from a stranger's repo (C84)
    walk: 'scripts/pmu/walk.mjs',                      // C92d — the one-minute door on the caller's HEAD
    replay: 'scripts/pmu/replay.mjs',                  // C99d — the door over a range
    // C297 THE CHAT'S OWN DOORS RUN IN A FOREIGN REPO — every script the 💬 Steer Chat and its pill spawn (C296's doc found none
    // of them had a door, so outside this repo /steer, /workers, /end, ↻, End all and the 🤖 dropdown printed `not run`)
    steer: 'scripts/vna/steer.mjs',                    // /steer <verb> · /steer <text> — the one loop door (C110)
    workers: 'scripts/vna/workers.mjs',                // /workers · /end · End all · the engines pill (C224, C250, C293)
    'keep-running': 'scripts/vna/keep-running.mjs',    // the ↻ box (C277)
    'chat-context': 'scripts/vna/chat-context.mjs',    // the steer state a chat turn is handed (C201)
    'chat-model-verb': 'scripts/vna/chat-model-verb.mjs', // the tape row a model-issued verb writes first (C207)
    'steer-runner': 'scripts/vna/steer-runner.mjs',    // ⚡ Run Headless — the runner steer.mjs dispatches through (C66)
    'runner-resolver': 'scripts/vna/runner-resolver.mjs', // the 🤖 dropdown and the capabilities line (C166)
    'local-models': 'scripts/vna/local-models.mjs',    // the thinking labels and the CLI writer beside the dropdown (C285)
    'sidebar-tail': 'scripts/vna/sidebar-tail.mjs',    // C647e: YOUR CLAUDE CODE TOKENS · LIVE — loss-run kept warm over ~/.claude/projects, --watch rewrites its receipt on an append
    'steer-compile': 'scripts/vna/steer-compile.mjs', // C1221: the steer compiler — the shipped /steer skill names this door
    'steer-every': 'scripts/vna/steer-every.mjs',     // one steer file round after round, a settle between (2026-10-28)
    'project-sheet': 'scripts/ops/board-project.mjs', // C2170c: the project sheets — done over next, GTM · Code (📋 Write the Project Sheets)
    'tree-sheet': 'scripts/ops/board-tree.mjs',       // C2170a: the Merkle tree as a sheet
    mem: 'scripts/ops/mem.mjs',                        // the 🧠 reap button and the settle door — spawned with no door until 2026-10-28 (C297.1)
    'self-improve': 'scripts/vna/memory-pill.mjs',     // C1201: the 🧠 Memory pill's on/off door — vna-clip.ts's memDoor fell to "no npx door yet" away from home
    // C1389: io1's strong-claims audit (item 3) found the snowball mechanism real in this sidebar and invisible to npx — these
    // two doors are the ones a stranger can run; retro-snowball.mjs/snowball-knob.mjs/snowball-refresh.mjs stay sidebar-only
    // (library modules with no CLI of their own — see packages/thetacog-mcp/README.md's "Snowball doors" block)
    'snowball-pick-ab': 'scripts/vna/snowball-pick-ab.mjs',   // C610d: ensemble-vs-greedy snowball pick, scored against the caller's own runner tape
    'hud-snowball': 'scripts/vna/hud-snowball.mjs',           // C743/C751: the realtime snowball ledger the 🎯 STEER HUD writes — `list`/`freeze`/`sync` away from home
});

// C297 — THE SCRIPTS THE EXTENSION SPAWNS THAT HAVE NO DOOR, EACH WITH ITS WHY. Never a silent gap: doorCommand prints the why on
// the not-run line, and tests/vna/c297-the-chat-runs-in-a-foreign-repo.test.mjs fails for a spawned script in neither table.
const SELF_ROOTED = 'resolves its repo from its own file and ignores VNA_REPO, so bundled it would read the package directory, not your repo';
export const HOME_ONLY: Readonly<Record<string, string>> = Object.freeze({
    'scripts/vna/amend-ledger.mjs': SELF_ROOTED,
    'scripts/vna/spec-check.mjs': `${SELF_ROOTED}; it ticks this repo's own spec checklist`,
    'scripts/vna/steer-file.mjs': SELF_ROOTED,
    'scripts/vna/txt-tail-watch.mjs': SELF_ROOTED,
    'scripts/vna/run-summary.mjs': SELF_ROOTED,
    'scripts/vna/backup.mjs': 'not a chat door, and not built as one yet: it honours VNA_REPO, but its door needs the licence flow proved away from home first',
    'scripts/vna/notary-drain.mjs': 'not a chat door, and not built as one yet: it honours VNA_REPO, but the hosted drain (C97f) and this audit-link reading (C99b) are dormant behind notarize: hosted, so a stranger\'s repo has nothing queued or uploaded to read yet',
    'scripts/vna/goal-write.mjs': 'not a chat door, and not built as one yet: it honours VNA_REPO, and the goal door (goal.mjs) already covers status, copy and import away from home',
    'scripts/vna/lane-actions.mjs': 'not a chat door, and not built as one yet: it amends the spec basin of a paused runner, which needs a spec file in your repo first',
    'scripts/vna/research-bundle.mjs': 'not a chat door, and not built as one yet: it bundles this repo\'s snowball sidecar and drift zones, which a new repo does not have',
    'scripts/vna/tape-sync.mjs': 'not a chat door, and not built as one yet: it ships the flight tape to the notary, which needs a signed tape in your repo first',
    // C233's 🎙️ audio pill (vna-clip.ts) started spawning this the day it landed but never got an entry here — the gap C297.1
    // caught. It honours VNA_REPO, so SELF_ROOTED does not apply; the reason it stays home-only is the resident local processes
    // it drives, not the path it reads from.
    'scripts/vna/audio-basin.mjs': 'not a chat door, and not built as one yet: it drives this machine\'s resident ffmpeg mic segmenter and whisper-server, neither of which a stranger\'s npx install has running',
    // C749: the 🎯 Steer HUD host no longer spawns a script for its readings: it spawns `pmu-onchip --hud-serve` through the one binary resolver
    // (src/lib/pmu/pmu-binary.mjs), so scripts/vna/hud-read.mjs (now `--once` sugar over that server, reached by the C741 napi door's node engine) is not a
    // spawned script and has no row here.
});

// ── C103f THE CARD IS A LINK — the document each card opens in the IDE. The SAME table as scripts/vna/door-cmd.mjs DOCS (the
// guard diffs them): the command the panel posts, the repo-relative paths (a text document opens as the file, editable; the
// page with a rendered HTML receipt opens in the webview), and the `not run — <command>` line when the receipt is not rendered.
export type Doc = { cmd: string; label: string; paths: string[]; page: string | null; notRun: string | null };
export const DOCS: Readonly<Record<string, Doc>> = Object.freeze({
    walk: { cmd: 'vna.openWalk', label: '↗ Open the walk', paths: ['docs/specs/vna/turns/latest.html', '.thetacog/walk-tape.ndjson'], page: 'docs/specs/vna/turns/latest.html', notRun: 'node scripts/vna/cockpit.mjs' },
    contract: { cmd: 'vna.viewUnit', label: '📄 View Unit Contract', paths: ['docs/specs/vna/SPEC-VNA-COCKPIT.md'], page: null, notRun: null },
    cog: { cmd: 'vna.openCog', label: '↗ Open the cog ledger', paths: ['data/vna/cog.ndjson', 'data/vna/cog-peg.json'], page: null, notRun: 'node scripts/vna/cog.mjs --since <sha>' },
    run: { cmd: 'vna.openRunLog', label: '↗ Open the runner log', paths: ['.thetacog/runner.ndjson'], page: null, notRun: 'run one goal' },
    reader: { cmd: 'vna.openTape', label: '↗ Open the tape', paths: ['data/vna/flight-tape.ndjson'], page: null, notRun: 'no tape yet' },
    bridge: { cmd: 'vna.openBridge', label: '↗ Open the steer file', paths: ['.thetacog/vna-steer-file.json', 'docs/specs/vna/RESEARCH-BUNDLE.txt'], page: null, notRun: 'node scripts/vna/clip-ingest.mjs --clip' },
    spec: { cmd: 'vna.openSpec', label: '↗ Open the spec', paths: ['docs/specs/vna/SPEC-VNA-COCKPIT.md'], page: null, notRun: null },
    tree: { cmd: 'vna.openTree', label: '↗ Open the tree', paths: ['data/vna/spec-tree.txt'], page: null, notRun: 'node scripts/vna/spec-tree.mjs' },
});
/** the doc a command opens, or null — the panel posts the command, the handler looks it up here and nowhere else */
export const docOf = (cmd: string): Doc | null => Object.values(DOCS).find((d) => d.cmd === cmd) ?? null;

const doorOf = (script: string): string | null => {
    const rel = script.replace(/\\/g, '/');
    for (const [door, s] of Object.entries(DOORS)) { if (s === rel) { return door; } }
    return null;
};

/** HOME = the marker script on disk under the workspace AND its package.json names this repo. Both, never one. */
export function isHome(root: string | undefined): boolean {
    if (!root) { return false; }
    try {
        if (!existsSync(path.join(root, HOME_MARKER))) { return false; }
        const pj = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string };
        return pj.name === HOME_NAME;
    } catch { return false; }
}

export type Command = {
    file: string;          // what to spawn: 'node' at home, 'npx' (npx.cmd on Windows) away
    args: string[];        // its argv
    display: string;       // the one line a card prints when the sensor has not run: `node scripts/vna/<script> …` | `npx thetacog-mcp <door> …` | `not run — <reason>`
    home: boolean;
    door: string | null;
    runnable: boolean;     // false = there is no command a stranger can run for this script; the caller reports display and spawns nothing
    why?: string;
};

/**
 * The one resolution. `script` is repo-relative (`scripts/vna/cockpit.mjs`); `args` ride along unchanged.
 * At home: node <script> <args>, cwd = the workspace. Away: npx thetacog-mcp <door> <args> — or not runnable when the
 * script has no door, with the reason on `display`.
 */
export function doorCommand(root: string | undefined, script: string, args: string[] = []): Command {
    const rel = script.replace(/\\/g, '/');
    const door = doorOf(rel);
    const home = isHome(root);
    if (home) {
        return { file: 'node', args: [rel, ...args], display: ['node', rel, ...args].join(' '), home, door, runnable: true };
    }
    if (!door) {
        const why = `${path.basename(rel)} has no npx door yet${HOME_ONLY[rel] ? ` — ${HOME_ONLY[rel]}` : ''}`;
        return { file: '', args: [], display: `not run — ${why}`, home, door, runnable: false, why };
    }
    if (ENGINE) {
        return { file: ENGINE.node, args: [ENGINE.server, door, ...args], display: ['npx', PACKAGE, door, ...args].join(' '), home, door, runnable: true };
    }
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return { file: npx, args: [PACKAGE, door, ...args], display: ['npx', PACKAGE, door, ...args].join(' '), home, door, runnable: true };
}
