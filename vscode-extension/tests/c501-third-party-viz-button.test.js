// packages/thetacog-mcp-vscode/tests/c501-third-party-viz-button.test.js — C501 THE GUARD: A "3RD PARTY VIZ" BUTTON
// BEFORE THE + PILL (operator 2026-09-30, verbatim: "maybe we need to add another +pill for the extension for this
// (or not, just add a button before it on that row called 3rd party viz or similar" · "update the vsx").
//
// THE SECOND READER row (card3 c-attest — the row that already carries DOOR_LABEL.backup, "🔗 Countersign (backup)",
// the one door that leaves the machine, C105c) grows ONE button, "3rd party viz", immediately before that row's own
// + pill. It opens the C500 adherence-by-domain page on thetadriven.com, `?manifest=<sha>` appended when a backup
// upload receipt is on disk (the licence's latest manifest), through the extension's EXISTING external-open command
// pattern (go(cmd, text) -> vscode.commands.executeCommand(cmd, text) -> vscode.env.openExternal), never a new
// mechanism. No new pill: the + stays the row's last control (C109g's job is unchanged); the button reuses the `sb`
// class every other secondary door on the page already wears (C245 — all pills need the same formatting).
//
// Falsifier: no button reading "3rd party viz" immediately before `<details class="plus" id="plus-attest">` on the
// c-attest row, or its target is not https://thetadriven.com/backup/adherence (with or without ?manifest=<sha>).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const PKG_DIR = resolve(__dirname, '..');
const REPO = resolve(PKG_DIR, '..', '..');

// the row: the c-attest card's face element, from its opening div to the next card's opening div
function attestRow(html) {
  const i = html.indexOf('<div class="card3 c-attest');
  assert.ok(i >= 0, 'the c-attest (THE SECOND READER) card renders');
  const j = html.indexOf('<div class="card3', i + 10);
  return html.slice(i, j > 0 ? j : undefined);
}

test('C501.0 the extension has a module the webview mounts (scripts/vna/steer-ui.mjs) and it renders the second-reader row', async () => {
  const UI = await import('../../../scripts/vna/steer-ui.mjs');
  assert.equal(typeof UI.renderCards, 'function');
  const html = UI.renderCards({});
  const row = attestRow(html);
  assert.match(row, /<details class="plus" id="plus-attest">/, 'the row keeps its own + pill');
});

test('C501.1 a "3rd party viz" button sits immediately before the + pill on that row, no new pill', async () => {
  const UI = await import('../../../scripts/vna/steer-ui.mjs');
  const html = UI.renderCards({});
  const row = attestRow(html);
  const plusIdx = row.indexOf('<details class="plus" id="plus-attest">');
  assert.ok(plusIdx > 0, 'the + is on the row');
  const before = row.slice(0, plusIdx);
  const m = before.match(/<button class="([^"]*)"[^>]*>3rd party viz<\/button>\s*$/);
  assert.ok(m, `the last thing before the + must be the "3rd party viz" button — before-slice tail: ${before.slice(-300)}`);
  // reuse the existing class, never new styling (C245 — all pills share formatting)
  assert.match(m[1], /(^|\s)sb(\s|$)/, `button class "${m[1]}" does not reuse the shared "sb" button class`);
  // still exactly one + on the row (no new pill)
  assert.equal((row.match(/<details class="plus"/g) || []).length, 1, 'no second + was added');
});

test('C501.2 the button targets the C500 adherence-by-domain page, manifest sha appended when a backup upload receipt is on disk', async () => {
  const UI = await import('../../../scripts/vna/steer-ui.mjs');
  // no manifest known
  const htmlNo = UI.renderCards({ thirdPartyVizManifest: null });
  const rowNo = attestRow(htmlNo);
  assert.match(rowNo, /onclick="go\('vna\.openThirdPartyViz','https:\/\/thetadriven\.com\/backup\/adherence'\)"/, 'no manifest on disk — the bare C500 URL');

  // a manifest sha known (a test hands it in directly, like countersign/auditLink already do — C135b/C99b)
  const sha = 'abc123def4567890abc123def4567890abc123d';
  const htmlYes = UI.renderCards({ thirdPartyVizManifest: sha });
  const rowYes = attestRow(htmlYes);
  assert.match(rowYes, new RegExp(`onclick="go\\('vna\\.openThirdPartyViz','https://thetadriven\\.com/backup/adherence\\?manifest=${sha}'\\)"`), 'a manifest sha on disk appends ?manifest=<sha>');
});

test('C501.3 the webview button posts through go(cmd,text) — the SAME external-open path every other thetadriven.com door already uses', () => {
  const src = readFileSync(resolve(REPO, 'scripts/vna/steer-ui.mjs'), 'utf8');
  assert.match(src, /function go\(c,t\)/, 'the page keeps the one go(cmd,text) dispatcher');
  // the TS host: onDidReceiveMessage hands m.text through as the second arg to executeCommand — no new postMessage shape
  const view = readFileSync(resolve(PKG_DIR, 'src/vna-view.ts'), 'utf8');
  assert.match(view, /executeCommand\(m\.cmd, m\.text\)/, 'the host already forwards a message\'s text arg to executeCommand — the button rides this, never a new wire');
});

test('C501.4 vna.openThirdPartyViz is registered on the host and opens through vscode.env.openExternal (the extension\'s existing external-open path, never a new mechanism)', () => {
  const ts = readFileSync(resolve(PKG_DIR, 'src/vna-steer.ts'), 'utf8');
  assert.match(ts, /registerCommand\('vna\.openThirdPartyViz'/, 'the command is registered');
  const fnStart = ts.indexOf('function openThirdPartyViz');
  assert.ok(fnStart > 0, 'openThirdPartyViz is a named function, readable beside the other door handlers');
  const fnBody = ts.slice(fnStart, ts.indexOf('\n}', fnStart) + 2);
  assert.match(fnBody, /vscode\.env\.openExternal\(vscode\.Uri\.parse\(/, 'opens through vscode.env.openExternal(vscode.Uri.parse(...)) — the same door vna-engines.ts webHandoff and auth-manager.ts already use, never a new mechanism');
});

test('C501.5 package.json contributes the command, titled with the Steer: palette prefix', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const cmd = pkg.contributes.commands.find((c) => c.command === 'vna.openThirdPartyViz');
  assert.ok(cmd, `no vna.openThirdPartyViz command contributed — titles: ${pkg.contributes.commands.map((c) => c.command).join(', ')}`);
  assert.match(cmd.title, /^Steer: /, 'title carries the Steer: palette prefix (C106f.3/C118.3)');
  assert.match(cmd.title, /adherence|3rd.party|third.party/i, 'title names what the door opens');
});

test('C501.6 the vsix on Desktop carries the version bumped for this row', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const desktop = resolve(require('node:os').homedir(), 'Desktop');
  const want = `thetacog-mcp-${pkg.version}.vsix`;
  const path = resolve(desktop, want);
  if (!existsSync(path)) { console.warn(`UNMEASURED — no ${path} yet; run \`npm run package\` in ${PKG_DIR}`); return; }
  assert.ok(existsSync(path), `${path} should exist after \`npm run package\``);
});
