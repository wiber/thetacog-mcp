#!/usr/bin/env node
// ThetaCog undo — the one line that takes back what `npx thetacog-mcp` set up outside ~/.claude/skills (C2360 · C2361 · C2362).
// Copied to ~/.thetacog/hooks/thetacog-undo.mjs on install; node builtins only, so it still runs after the package is gone.
//   node ~/.thetacog/hooks/thetacog-undo.mjs            the settings hook and the MCP registration
//   node ~/.thetacog/hooks/thetacog-undo.mjs --hook     the /steer autorun hook in ~/.claude/settings.json (a backup is kept first)
//   node ~/.thetacog/hooks/thetacog-undo.mjs --mcp      claude mcp remove --scope user thetacog (only if this install registered it)
//   node ~/.thetacog/hooks/thetacog-undo.mjs --repo .   the receipt block in that repo's post-commit hook (the rest of the file stays)
// It removes only what carries our marker; everything else in each file is left as it was.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HOOK_MARK = '.thetacog/hooks/steer-autorun.mjs';
export const BLOCK_BEGIN = '# >>> ThetaCog receipt (C2361)';
export const BLOCK_END = '# <<< ThetaCog receipt (C2361)';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const readState = (home) => { try { return JSON.parse(readFileSync(join(home, '.thetacog', 'installed.json'), 'utf8')); } catch { return {}; } };
const writeState = (home, st) => { mkdirSync(join(home, '.thetacog'), { recursive: true }); writeFileSync(join(home, '.thetacog', 'installed.json'), JSON.stringify(st, null, 2) + '\n'); };

/** drop every UserPromptSubmit hook whose command names our file; an emptied group or event key goes too */
export function withoutOurHook(settings) {
  const s = JSON.parse(JSON.stringify(settings || {}));
  const ev = s.hooks && s.hooks.UserPromptSubmit;
  if (!Array.isArray(ev)) return { settings: s, removed: 0 };
  let removed = 0;
  const kept = [];
  for (const g of ev) {
    if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
    const hs = g.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(HOOK_MARK)));
    removed += g.hooks.length - hs.length;
    if (hs.length) kept.push({ ...g, hooks: hs });
  }
  if (kept.length) s.hooks.UserPromptSubmit = kept; else delete s.hooks.UserPromptSubmit;
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  return { settings: s, removed };
}

export function stripBlock(text) {
  const a = text.indexOf(BLOCK_BEGIN); const b = text.indexOf(BLOCK_END);
  if (a < 0 || b < a) return { text, removed: false };
  const out = (text.slice(0, a) + text.slice(b + BLOCK_END.length).replace(/^\n/, '')).replace(/\n{3,}/g, '\n\n');
  return { text: out, removed: true };
}

export function undoHook(home) {
  const p = join(home, '.claude', 'settings.json');
  if (!existsSync(p)) return `hook: no ${p} — nothing to undo`;
  const raw = readFileSync(p, 'utf8');
  let j; try { j = JSON.parse(raw); } catch (e) { return `hook: ${p} is not valid JSON (${e.message}) — left alone`; }
  const { settings, removed } = withoutOurHook(j);
  if (!removed) return `hook: none of ours in ${p}`;
  const bdir = join(home, '.thetacog', 'backups'); mkdirSync(bdir, { recursive: true });
  const backup = join(bdir, `settings.json.${stamp()}.before-undo`); copyFileSync(p, backup);
  const indent = (/\n([ \t]+)"/.exec(raw) || [, '  '])[1];
  writeFileSync(p, JSON.stringify(settings, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
  try { rmSync(join(home, HOOK_MARK)); } catch { /* already gone */ }
  const st = readState(home); delete st.hook; writeState(home, st);
  return `hook: removed ${removed} entr${removed === 1 ? 'y' : 'ies'} from ${p} (backup ${backup})`;
}

export function undoMcp(home, { claude = 'claude' } = {}) {
  const st = readState(home);
  if (!st.mcp || !st.mcp.registered) return 'mcp: this install never registered thetacog — nothing to undo';
  const r = spawnSync(claude, ['mcp', 'remove', '--scope', 'user', 'thetacog'], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) return `mcp: claude mcp remove failed (${(r.stderr || r.error?.message || '').trim().split('\n')[0]}) — run it by hand: claude mcp remove --scope user thetacog`;
  delete st.mcp; writeState(home, st);
  return 'mcp: removed the user-scope thetacog server (claude mcp remove --scope user thetacog)';
}

export function undoRepo(home, repo) {
  const top = resolve(repo);
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks/post-commit'], { cwd: top, encoding: 'utf8' });
  if (r.status !== 0) return `repo: ${top} is not a git repo`;
  const p = resolve(top, r.stdout.trim());
  const key = (spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: top, encoding: 'utf8' }).stdout || top).trim();   // the key the installer wrote
  if (!existsSync(p)) return `repo: no post-commit in ${top}`;
  const { text, removed } = stripBlock(readFileSync(p, 'utf8'));
  if (!removed) return `repo: no ThetaCog receipt block in ${p}`;
  if (!text.replace(/^#!.*\n?/, '').trim()) rmSync(p); else writeFileSync(p, text);
  const st = readState(home); if (st.repos) { delete st.repos[key]; writeState(home, st); }
  return `repo: removed the receipt block from ${p}${existsSync(p) ? ' (the rest of the hook stays)' : ' (the file held nothing else, so it is gone)'}`;
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };   // /var vs /private/var on macOS
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const home = process.env.HOME || homedir();
  const a = process.argv.slice(2);
  const ri = a.indexOf('--repo');
  const all = !a.length;
  if (all || a.includes('--hook')) console.log(undoHook(home));
  if (all || a.includes('--mcp')) console.log(undoMcp(home));
  if (ri >= 0) console.log(undoRepo(home, a[ri + 1] || '.'));
}
