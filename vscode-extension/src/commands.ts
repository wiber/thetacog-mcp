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
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

export const PACKAGE = 'thetacog-mcp';
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
    'scripts/vna/goal-write.mjs': 'not a chat door, and not built as one yet: it honours VNA_REPO, and the goal door (goal.mjs) already covers status, copy and import away from home',
    'scripts/vna/lane-actions.mjs': 'not a chat door, and not built as one yet: it amends the spec basin of a paused runner, which needs a spec file in your repo first',
    'scripts/vna/research-bundle.mjs': 'not a chat door, and not built as one yet: it bundles this repo\'s snowball sidecar and drift zones, which a new repo does not have',
    'scripts/vna/tape-sync.mjs': 'not a chat door, and not built as one yet: it ships the flight tape to the notary, which needs a signed tape in your repo first',
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
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return { file: npx, args: [PACKAGE, door, ...args], display: ['npx', PACKAGE, door, ...args].join(' '), home, door, runnable: true };
}
