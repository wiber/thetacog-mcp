// What `npx thetacog-mcp` sets up OUTSIDE ~/.claude/skills, beside the skills (chair decomposition 2026-11-05 of the operator's words
// "build and ratchet the implied ones too"):
//   C2360  the /steer autorun UserPromptSubmit hook in ~/.claude/settings.json, so a /steer in any folder compiles and runs as it does
//          in the engine's own repo
//   C2362  the thetacog MCP server registered with Claude Code (user scope), when the `claude` binary is on PATH
//   C2361  the post-commit receipt block in a repo's git hook — only when the door is /steer (steer or steer-compile), in that repo
// The rules for every write here (the person's files, not ours): MERGE, never overwrite — settings.json is parsed, our one entry is
// added once, every other key keeps its value and the file keeps its indent; a backup goes to ~/.thetacog/backups/ first; a file we
// cannot parse or a hook someone else wrote is left alone and named. Each write is named with its undo line, and the undo is one
// self-contained script copied to ~/.thetacog/hooks/thetacog-undo.mjs. installUserSkills() calls this after its own skips (no Claude
// Code · THETACOG_NO_SKILLS=1 · the engine-home marker), so those skip everything here too; THETACOG_NO_HOOKS=1 skips the two hooks,
// THETACOG_NO_MCP=1 the registration.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const HOOK_REL = path.join('.thetacog', 'hooks', 'steer-autorun.mjs');
export const UNDO_REL = path.join('.thetacog', 'hooks', 'thetacog-undo.mjs');
export const STATE_REL = path.join('.thetacog', 'installed.json');
export const HOOK_MARK = '.thetacog/hooks/steer-autorun.mjs';
export const BLOCK_BEGIN = '# >>> ThetaCog receipt (C2361)';
export const BLOCK_END = '# <<< ThetaCog receipt (C2361)';
export const STEER_DOORS = new Set(['steer', 'steer-compile']);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const undoLine = (home, flag) => `node ${path.join(home, UNDO_REL)} ${flag}`;
export function readState(home) { try { return JSON.parse(fs.readFileSync(path.join(home, STATE_REL), 'utf8')); } catch { return {}; } }
function writeState(home, st) { fs.mkdirSync(path.join(home, '.thetacog'), { recursive: true }); fs.writeFileSync(path.join(home, STATE_REL), JSON.stringify(st, null, 2) + '\n'); }

/** copy one of our own files into ~/.thetacog/hooks; returns 'wrote' | 'current' */
function ownCopy(src, dest, mode = 0o755) {
  const want = fs.readFileSync(src, 'utf8');
  let have = null; try { have = fs.readFileSync(dest, 'utf8'); } catch { /* missing */ }
  if (have === want) return 'current';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, want); fs.chmodSync(dest, mode);
  return 'wrote';
}

export function hookCommand(home) { return `node "${path.join(home, HOOK_REL)}"`; }

/** pure: add our UserPromptSubmit entry once; everything else is carried as it was */
export function withOurHook(settings, command) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? JSON.parse(JSON.stringify(settings)) : {};
  const has = (s.hooks?.UserPromptSubmit || []).some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARK)));
  if (has) return { settings: s, added: false };
  s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  s.hooks.UserPromptSubmit = Array.isArray(s.hooks.UserPromptSubmit) ? s.hooks.UserPromptSubmit : [];
  s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  return { settings: s, added: true };
}

/** C2360: the /steer autorun hook in ~/.claude/settings.json */
export function installSettingsHook({ home, packageDir }) {
  const p = path.join(home, '.claude', 'settings.json');
  const undo = undoLine(home, '--hook');
  let raw = null; try { raw = fs.readFileSync(p, 'utf8'); } catch { /* none yet */ }
  let j = {};
  if (raw !== null && raw.trim()) { try { j = JSON.parse(raw); } catch (e) { return { state: 'refused', what: '/steer autorun hook', path: p, why: `${p} is not valid JSON (${e.message.split('\n')[0]}) — left alone; fix it and run any npx thetacog-mcp command again` }; } }
  const file = ownCopy(path.join(packageDir, 'hooks', 'steer-autorun-user.mjs'), path.join(home, HOOK_REL));
  const { settings, added } = withOurHook(j, hookCommand(home));
  if (!added) return { state: file === 'wrote' ? 'updated' : 'current', what: '/steer autorun hook', path: p, undo };
  let backup = null;
  if (raw !== null) { const bdir = path.join(home, '.thetacog', 'backups'); fs.mkdirSync(bdir, { recursive: true }); backup = path.join(bdir, `settings.json.${stamp()}`); fs.copyFileSync(p, backup); }
  const indent = raw ? (/\n([ \t]+)"/.exec(raw) || [, '  '])[1] : '  ';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, indent) + (raw === null || raw.endsWith('\n') ? '\n' : ''));
  return { state: 'wrote', what: '/steer autorun hook (UserPromptSubmit)', path: p, undo, backup };
}

/** where `claude` is, or null — the same PATH the person's shell gives this process */
export function claudeBin() {
  const r = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8', timeout: 3000 });
  return (r.stdout || '').trim().split('\n')[0] || null;
}

export function mcpRegistered(home) {
  try { const j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')); return !!(j.mcpServers && j.mcpServers.thetacog); } catch { return false; }
}

/** C2362: `claude mcp add --scope user thetacog -- npx -y thetacog-mcp`, once; the same entry the CLI itself would write */
export function registerMcp({ home, version, door, bin = claudeBin() }) {
  const undo = 'claude mcp remove --scope user thetacog';
  const p = path.join(home, '.claude.json');
  if (mcpRegistered(home)) return { state: 'current', what: 'thetacog MCP server (user scope)', path: p, undo };
  if (door === undefined) return { state: 'skipped', what: 'thetacog MCP server', why: 'running as the MCP server itself: the registration rides with the next npx thetacog-mcp <command>' };
  const st = readState(home);
  if (st.mcp && st.mcp.failedVersion === version) return { state: 'skipped', what: 'thetacog MCP server', why: `claude mcp add failed once for ${version} (${st.mcp.why}); not retried until the next version — by hand: claude mcp add --scope user thetacog -- npx -y thetacog-mcp` };
  if (!bin) return { state: 'skipped', what: 'thetacog MCP server', why: 'no claude binary on PATH — by hand once it is: claude mcp add --scope user thetacog -- npx -y thetacog-mcp' };
  const r = spawnSync(bin, ['mcp', 'add', '--scope', 'user', 'thetacog', '--', 'npx', '-y', 'thetacog-mcp'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: home } });
  const said = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0 || /already exists/i.test(said)) {
    writeState(home, { ...st, mcp: { registered: r.status === 0, at: new Date().toISOString(), version, bin } });
    return { state: r.status === 0 ? 'wrote' : 'current', what: 'thetacog MCP server (claude mcp add --scope user)', path: p, undo };
  }
  const why = (r.error ? r.error.message : said.trim().split('\n')[0]) || `exit ${r.status}`;
  writeState(home, { ...st, mcp: { registered: false, failedVersion: version, why } });
  return { state: 'refused', what: 'thetacog MCP server', path: p, why: `claude mcp add failed: ${why} — by hand: claude mcp add --scope user thetacog -- npx -y thetacog-mcp` };
}

/** C2361: the receipt block in <repo>'s post-commit, on the first /steer there */
export function installReceiptHook({ home, packageDir, cwd }) {
  const what = 'post-commit receipt hook';
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 5000 });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0) return { state: 'skipped', what, why: `${cwd} is not a git repo` };
  const repo = top.stdout.trim();
  const hp = git('rev-parse', '--git-path', 'hooks/post-commit');
  const p = path.resolve(cwd, hp.stdout.trim());
  const undo = `node ${path.join(home, UNDO_REL)} --repo ${repo}`;
  const gitDir = path.resolve(cwd, git('rev-parse', '--git-common-dir').stdout.trim());
  if (!p.startsWith(gitDir + path.sep)) return { state: 'refused', what, path: p, why: `core.hooksPath points at ${path.dirname(p)}, a folder you manage — left alone; add the block from ${path.join(packageDir, 'hooks', 'receipt-post-commit.example')} by hand` };
  const block = fs.readFileSync(path.join(packageDir, 'hooks', 'receipt-post-commit.example'), 'utf8')
    .split('__THETACOG_NODE__').join(process.execPath).split('__THETACOG_SERVER__').join(path.join(packageDir, 'server.js'));
  let have = null; try { have = fs.readFileSync(p, 'utf8'); } catch { /* none */ }
  // an earlier block of ours (npx -y, or a package path that moved) is replaced in place, between its own markers, after a backup
  if (have !== null && have.includes(BLOCK_BEGIN) && have.includes(BLOCK_END)) {
    const i = have.indexOf(BLOCK_BEGIN), j = have.indexOf(BLOCK_END) + BLOCK_END.length;
    const old = have.slice(i, j); const fresh = block.trimEnd();
    if (old === fresh) return { state: 'current', what, path: p, undo };
    const bdir = path.join(home, '.thetacog', 'backups'); fs.mkdirSync(bdir, { recursive: true }); const backup = path.join(bdir, `post-commit.${path.basename(repo)}.${stamp()}`); fs.copyFileSync(p, backup);
    fs.writeFileSync(p, have.slice(0, i) + fresh + have.slice(j)); fs.chmodSync(p, 0o755);
    return { state: 'wrote', what: `${what} (updated our earlier block)`, path: p, undo, backup };
  }
  if (have !== null && have.includes('intervene --sha')) return { state: 'current', what: `${what} (the ThetaCog intervention fire already places it)`, path: p, undo: `remove the intervene line from ${p}` };
  if (have !== null && !/ThetaCog/.test(have)) return { state: 'refused', what, path: p, why: `a post-commit someone else wrote is already at ${p} — left alone; add the block from ${path.join(packageDir, 'hooks', 'receipt-post-commit.example')} to it by hand` };
  let backup = null;
  if (have !== null) { const bdir = path.join(home, '.thetacog', 'backups'); fs.mkdirSync(bdir, { recursive: true }); backup = path.join(bdir, `post-commit.${path.basename(repo)}.${stamp()}`); fs.copyFileSync(p, backup); }
  const text = have === null ? `#!/bin/bash\n${block}` : `${have.replace(/\n?exit 0\s*$/, '\n')}${have.endsWith('\n') ? '' : '\n'}${block}`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text); fs.chmodSync(p, 0o755);
  const st = readState(home); writeState(home, { ...st, repos: { ...(st.repos || {}), [repo]: { at: new Date().toISOString(), hook: p, chained: have !== null } } });
  return { state: 'wrote', what: have === null ? what : `${what} (chained onto the ThetaCog post-commit already there)`, path: p, undo, backup };
}

/** the whole set; never throws — a failure becomes a refused row naming it */
export function installUserHooks({ home, packageDir, version, door = undefined, cwd = process.cwd(), env = process.env, serverJs = null, bin } = {}) {
  const rows = [];
  const guard = (fn) => { try { rows.push(fn()); } catch (e) { rows.push({ state: 'refused', what: fn.name || 'setup', why: String(e.message).split('\n')[0] }); } };
  try { ownCopy(path.join(packageDir, 'hooks', 'thetacog-undo.mjs'), path.join(home, UNDO_REL)); } catch { /* the undo line still names the plain commands */ }
  if (serverJs) { try { const st = readState(home); if (st.serverJs !== serverJs) writeState(home, { ...st, serverJs }); } catch { /* the hook falls back to npx */ } }
  if (env.THETACOG_NO_HOOKS === '1') rows.push({ state: 'skipped', what: '/steer autorun hook + post-commit receipt hook', why: 'THETACOG_NO_HOOKS=1' });
  else {
    guard(function steerAutorunHook() { return installSettingsHook({ home, packageDir }); });
    if (STEER_DOORS.has(door)) guard(function receiptHook() { return installReceiptHook({ home, packageDir, cwd }); });
  }
  if (env.THETACOG_NO_MCP === '1') rows.push({ state: 'skipped', what: 'thetacog MCP server', why: 'THETACOG_NO_MCP=1' });
  else guard(function mcpServer() { return registerMcp({ home, version, door, ...(bin !== undefined ? { bin } : {}) }); });
  return rows;
}
