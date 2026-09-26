#!/usr/bin/env node
// scripts/vsix-to-desktop.mjs — after every `npm run package`, the freshly built .vsix lands on the
// Desktop, where the operator installs it from (operator 2026-09-22: "always copy the vsx to desktop").
//
// It is wired into the `package` script rather than kept as a habit, because a habit is not a
// mechanism: the copy must happen when ANYONE packages, not only when the session remembers to.
// COPY, never move — tests/vna/c161…test.mjs (C161.3) reads the .vsix in this directory to prove it
// is not older than the manifest it claims, and a move would break that guard.
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// C209 EVERY EDITOR ON THE MACHINE GETS THE BUILD (operator 2026-09-23, verbatim: "it keeps swapping back and forth between 334 and
// 337" · "reload brings back 3.34 - prevent that issue going forward"). The package step installed into VS Code only; Cursor had
// 0.3.34 in its own registry (~/.cursor/extensions) and nothing ever replaced it, so a Cursor reload brought 0.3.34 back and its host
// repainted the shared steer page with the old build's command set. Now every editor CLI found here gets --install-extension --force.
// VSIX_NO_INSTALL=1 skips it (CI, a guard). Guard: tests/vna/c209-the-build-reaches-every-editor.test.mjs.
export const EDITOR_CLIS = [
    { name: 'VS Code', cli: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
    { name: 'Cursor', cli: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor' },
    { name: 'Windsurf', cli: '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf' },
    { name: 'VSCodium', cli: '/Applications/VSCodium.app/Contents/Resources/app/bin/codium' },
];
/** install one .vsix into every editor whose CLI exists; returns one row per editor found — never throws */
export function installEverywhere(vsixPath, { clis = EDITOR_CLIS, exists = existsSync, run = (cli, args) => spawnSync(cli, args, { encoding: 'utf8', timeout: 120000 }) } = {}) {
    return clis.filter((e) => exists(e.cli)).map((e) => {
        const r = run(e.cli, ['--install-extension', vsixPath, '--force']);
        return { editor: e.name, ok: r.status === 0, why: r.status === 0 ? null : String(r.stderr || r.error || `exit ${r.status}`).trim().slice(0, 200) };
    });
}

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const vsix = join(HERE, `${name}-${version}.vsix`);

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
function main() {
if (!existsSync(vsix)) { console.error(`✗ no package at ${name}-${version}.vsix — run vsce package first`); process.exit(1); }
const desktop = join(homedir(), 'Desktop');
// No Desktop (CI, a server, a different OS layout) is not a failure — the package itself is fine.
if (!existsSync(desktop)) { console.log('· no Desktop on this machine — copy skipped, the .vsix is built'); return; }
// C298 (3) — a COPY, as the header says: the .vsix stays in the package dir for C161.3 to read in place. Until C298 this
// renameSync'ed it away and printed "moved", the opposite of its own header.
const dest = join(desktop, `${name}-${version}.vsix`);
copyFileSync(vsix, dest);
console.log(`→ ~/Desktop/${name}-${version}.vsix (copied — the package dir keeps its own)`);
if (process.env.VSIX_NO_INSTALL === '1') { console.log('· VSIX_NO_INSTALL=1 — not installed into any editor'); return; }
for (const r of installEverywhere(dest)) console.log(r.ok ? `✓ installed into ${r.editor} — reload that window to run ${version}` : `✗ ${r.editor} install failed: ${r.why}`);
}
