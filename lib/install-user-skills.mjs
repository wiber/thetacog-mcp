#!/usr/bin/env node
// C2305 (operator 2026-11-05): "Default install all skills if it's available. Don't ask people who … are not comfortable with coding to
// use flags. They should just be installed by default if there is Claude Code present. Install all the skills." · "The flags should only
// be used for debugging … with flags, print a long story about whether it was installed or not, and open a specific HTML page with what
// versions were present".
//
// Every bundled skill goes to ~/.claude/skills/<name>/SKILL.md — the personal slot the Claude Code CLI reads in every folder — whenever
// Claude Code is on the machine (~/.claude exists or `claude` is on PATH). It runs on postinstall AND on every `npx thetacog-mcp <cmd>`,
// because a cached npx never re-runs postinstall. The default is less, never silent: a write names each skill and opens the manual
// once, nothing new is one line. `--debug` prints the whole story and opens the HTML page of every version found, every time. The writes go through fixSlots, so an earlier copy of OUR skill is kept before it is replaced and
// someone else's SKILL.md is never touched (AXIOM 1).
//
// Not written on the engine's own machine (~/.thetacog/engine-home exists): a personal skill outranks a project skill in Claude Code, so
// a stranger-safe /steer in ~/.claude/skills would shadow the monorepo's own .claude/skills/steer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundledSkills, fixSlots, readSlots } from '../src/lib/agent-hosts.mjs';
import { installUserHooks } from './install-user-hooks.mjs';   // C2360 · C2361 · C2362: what lands beside the skills, outside ~/.claude/skills

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_HOME_MARKER = path.join('.thetacog', 'engine-home');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const field = (src, k) => ((/^---\n([\s\S]*?)\n---/.exec(src) || [, ''])[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [, ''])[1].replace(/^["']|["']$/g, '').trim();

/** C2321: the plain-language half of the report — what a skill IS, what it SETS UP on disk, and its
 * first command — read off the skill's own frontmatter description, never hand-typed beside it. */
export function skillBlurb(src) {
  const desc = field(src, 'description');
  const about = desc.replace(/\s*Triggers:[\s\S]*$/, '').trim();
  const writes = [...about.matchAll(/\bWrites\s+([^\s,;]+(?:\.[a-zA-Z0-9]+)?)/g)].map((m) => m[1]);
  const setsUp = writes.length ? writes.join(', ') : 'nothing new on disk';
  const triggerText = (/Triggers:\s*([\s\S]*)$/.exec(desc) || [, ''])[1];
  const firstCommand = (/'(\/[A-Za-z0-9_-]+)'/.exec(triggerText) || [, null])[1];
  return { about, setsUp, firstCommand };
}

/** C2321: a real count, read from the person's own ~/.claude session transcripts — never guessed. Bounded to the
 * `maxFiles` most recently touched transcripts so a 7+ GB history does not stall a command that runs this on
 * every upgrade; the bound is named in the result so a reader never mistakes it for an exhaustive count. */
export function sessionOpenCounts(home, skills, { maxFiles = 400 } = {}) {
  const dir = path.join(home, '.claude', 'projects');
  const counts = {}; for (const s of skills) counts[s.name] = 0;
  if (!fs.existsSync(dir)) return { available: false, scanned: 0, totalFiles: 0, maxFiles, counts };
  const files = [];
  const walk = (d) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p); } };
  walk(dir);
  const withMtime = files.map((f) => { let m = 0; try { m = fs.statSync(f).mtimeMs; } catch { /* vanished mid-walk */ } return [f, m]; });
  withMtime.sort((a, b) => b[1] - a[1]);
  const take = withMtime.slice(0, maxFiles);
  // C2368: three shapes count as an opening, each read off the record, never guessed — (a) a slash command the CLI recorded as
  // <command-name>/<skill></command-name> (its FIRST line is <command-message>, which is why a first-line-only read counted zero),
  // (b) a prompt whose first line STARTS with /<skill>, (c) an assistant Skill tool call whose input.skill is <skill> or <plugin>:<skill>.
  // A mention mid-sentence is not an opening, and /steer-every is never /steer.
  const names = new Set(skills.map((s) => s.name));
  const bump = (n) => { if (names.has(n)) counts[n]++; };
  const textOf = (msg) => { const c = msg && msg.content; if (typeof c === 'string') return c; if (!Array.isArray(c)) return ''; return c.filter((b) => b && (b.type === 'text' || typeof b.text === 'string')).map((b) => b.text || '').join('\n'); };
  for (const [f] of take) {
    let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line || !(line.includes('"type":"user"') || line.includes('"Skill"'))) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const msg = rec && rec.message;
      if (!msg) continue;
      if (rec.type === 'user' && msg.role === 'user') {
        const text = textOf(msg);
        const cmd = /<command-name>\/([A-Za-z0-9_:-]+)<\/command-name>/.exec(text);
        if (cmd) { bump(cmd[1].split(':').pop()); continue; }
        const first = /^\s*\/([A-Za-z0-9_:-]+)(?=\s|$)/.exec(text.trim().split('\n')[0] || '');
        if (first) bump(first[1].split(':').pop());
      } else if (rec.type === 'assistant' && Array.isArray(msg.content)) {
        for (const b of msg.content) if (b && b.type === 'tool_use' && b.name === 'Skill' && b.input && typeof b.input.skill === 'string') bump(b.input.skill.replace(/^\//, '').split(':').pop());
      }
    }
  }
  return { available: true, scanned: take.length, totalFiles: withMtime.length, maxFiles, counts };
}

/** C2368: the counting rule, said once wherever the count is shown */
export const HOW_COUNTED = 'an opening is a /<skill> slash command, a prompt that starts with /<skill>, or a Skill tool call naming it';

/** C2321: the other HTML pages this install wrote or copied under ~/.thetacog, besides this one. */
export function otherPages(home, { exclude = 'skills-install.html' } = {}) {
  const dir = path.join(home, '.thetacog');
  let names = []; try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f !== exclude); } catch { /* nothing written yet */ }
  return names.sort().map((f) => path.join(dir, f));
}

/** where Claude Code shows itself: ~/.claude (made on first run) or the `claude` binary on PATH */
export function claudeCodePresent(home = os.homedir()) {
  if (fs.existsSync(path.join(home, '.claude'))) return { present: true, why: `${path.join(home, '.claude')} exists` };
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? ['claude'] : ['-c', 'command -v claude'], { encoding: 'utf8' });
  const bin = (r.stdout || '').trim().split('\n')[0];
  return bin ? { present: true, why: `claude on PATH at ${bin}` } : { present: false, why: `no ${path.join(home, '.claude')} and no claude on PATH` };
}

/** C2361 · C2362: which door this process is — `npx thetacog-mcp <door>` (argv[2]), 'postinstall' for the npm install, undefined when the
 * process IS the MCP server (no subcommand). Read here so server.js needs no edit: the receipt hook rides the steer doors, and the MCP
 * registration never runs from inside the server it registers. */
export function defaultDoor(argv = process.argv) {
  if (path.basename(argv[1] || '') === 'postinstall.js') return 'postinstall';
  if (/install-user-skills\.mjs$/.test(argv[1] || '')) return 'skills';
  return argv[2];
}

/** install every bundled skill into <home>/.claude/skills; returns the full story, never throws */
export function installUserSkills({ home = os.homedir(), packageDir = PKG_DIR, door = defaultDoor(), cwd = process.cwd(), env = process.env, bin } = {}) {
  const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
  const story = { at: new Date().toISOString(), version, home, target: path.join(home, '.claude', 'skills'), skills: [], wrote: [], refused: [] };
  if (process.env.THETACOG_NO_SKILLS === '1') return { ...story, skipped: 'THETACOG_NO_SKILLS=1' };
  const cc = claudeCodePresent(home); story.claudeCode = cc;
  if (!cc.present) return { ...story, skipped: `Claude Code not found (${cc.why})` };
  if (fs.existsSync(path.join(home, ENGINE_HOME_MARKER))) return { ...story, skipped: `engine home (${path.join(home, ENGINE_HOME_MARKER)}): the monorepo's own skills stay in force` };
  const skills = bundledSkills(packageDir);
  if (!skills.length) return { ...story, skipped: `no bundled skills under ${path.join(packageDir, 'skills')}` };
  const before = readSlots(home, skills).filter((s) => s.host === 'claude-code');
  const prior = Object.fromEntries(before.map((s) => {
    let have = null; try { have = fs.readFileSync(path.join(home, s.path), 'utf8'); } catch { /* missing */ }
    return [s.skill, have === null ? null : { sha: sha(have), version: field(have, 'version') || null }];
  }));
  const written = fixSlots(home, skills, { hosts: ['claude-code'] });
  const after = readSlots(home, skills).filter((s) => s.host === 'claude-code');
  for (const { name, src } of skills) {
    const b = before.find((s) => s.skill === name); const a = after.find((s) => s.skill === name);
    story.skills.push({ name, path: path.join(home, a.path), bundled: sha(src), before: b.state, priorSha: prior[name]?.sha || null, after: a.state, wrote: written.some((w) => w.skill === name), ...skillBlurb(src) });
  }
  story.wrote = story.skills.filter((s) => s.wrote).map((s) => s.name);
  story.refused = story.skills.filter((s) => s.after === 'foreign').map((s) => s.path);
  // C2360 · C2361 · C2362: the hook, the receipt block and the MCP registration, after the same skips the skills took
  story.setup = installUserHooks({ home, packageDir, version, door, cwd, env, serverJs: path.join(packageDir, 'server.js'), ...(bin !== undefined ? { bin } : {}) });
  return story;
}

/** the default: less, never silent (operator 2026-11-05: "not silent just less" · "show and tell both"). A write tells which skills
 * landed where and opens the manual once (the report page waits for --debug); nothing new is one line; a skip says why and where the details are. The opt-out is
 * quiet: whoever set THETACOG_NO_SKILLS=1 asked for nothing. */
export const ANNOUNCED = path.join('.thetacog', 'skills-announced.json');
// The manual (operator 2026-11-05: "make sure it bash opens the manual on install - I want to send it to people who dont do vscode"):
// manual/steer-in-the-app.html is copied to ~/.thetacog/steer-manual.html and opened ONCE per version, from postinstall or the first
// command, whichever comes first, so a hidden postinstall and a cached npx each end with one open. CI and THETACOG_NO_OPEN=1 never open it.
export const MANUAL_REL = path.join('.thetacog', 'steer-manual.html');
export const MANUAL_OPENED = path.join('.thetacog', 'manual-opened.json');
const systemOpen = (file) => spawnSync(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [file], { stdio: 'ignore' });
/** the skill cards (operator 2026-11-05: "the documented /steer and other skills in a full html showing how it works"): one card per
 * bundled skill, every word read off its own SKILL.md — what it is, how to call it, the doors it runs, and the whole skill text —
 * so the manual can never describe a skill the install did not give you. */
export function skillCardsHtml(skills) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const order = (n) => (n === 'steer' ? 0 : n === 'steer-every' ? 1 : 2);
  return [...skills].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name)).map(({ name, src }) => {
    const desc = field(src, 'description');
    const about = desc.replace(/\s*Triggers:[\s\S]*$/, '').trim();
    const triggers = [...((/Triggers:\s*([\s\S]*)$/.exec(desc) || [, ''])[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]).slice(0, 6);
    const doors = [...new Set([...src.matchAll(/npx thetacog-mcp ([a-z][a-z0-9-]*)/g)].map((m) => m[1]))];
    const body = src.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    return `<div class="card" id="skill-${esc(name)}"><h3>/${esc(name)}</h3><p>${esc(about)}</p>`
      + (triggers.length ? `<p class="doors">Say it as: ${triggers.map((t) => `<code>${esc(t)}</code>`).join(' · ')}</p>` : '')
      + (doors.length ? `<p class="doors">Doors it runs: ${doors.map((d) => `<code>npx thetacog-mcp ${esc(d)}</code>`).join(' · ')}</p>` : '')
      + `<details><summary>Read the whole /${esc(name)} skill</summary><pre>${esc(body)}</pre></details></div>`;
  }).join('\n');
}
export function manualHtml(packageDir = PKG_DIR) {
  const page = fs.readFileSync(path.join(packageDir, 'manual', 'steer-in-the-app.html'), 'utf8');
  const cards = skillCardsHtml(bundledSkills(packageDir));
  return page.replace(/<!-- SKILLS:BEGIN -->[\s\S]*?<!-- SKILLS:END -->/, () => `<!-- SKILLS:BEGIN -->\n${cards}\n<!-- SKILLS:END -->`);
}
export function openManual(story, { env = process.env, packageDir = PKG_DIR, opener = systemOpen } = {}) {
  const src = path.join(packageDir, 'manual', 'steer-in-the-app.html');
  if (!fs.existsSync(src)) return { state: 'missing', why: `no ${src}` };
  const file = path.join(story.home, MANUAL_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, manualHtml(packageDir));
  const marker = path.join(story.home, MANUAL_OPENED);
  let seen = null; try { seen = JSON.parse(fs.readFileSync(marker, 'utf8')).version; } catch { /* never opened */ }
  if (seen === story.version) return { state: 'current', file };
  if (env.THETACOG_NO_OPEN === '1' || env.CI) return { state: 'not-opened', file, why: env.CI ? 'CI' : 'THETACOG_NO_OPEN=1' };
  opener(file);
  fs.writeFileSync(marker, JSON.stringify({ version: story.version, at: story.at }) + '\n');
  return { state: 'opened', file };
}
/** what a person sees from a bare `npx thetacog-mcp` or `npx thetacog-mcp skills`: the skills they now have, one line each, read off
 * each skill's own description (never retyped), what to type, the manual, and the other doors. A skip says why and what to do. */
export function welcomeText(story) {
  const s = story || {};
  const L = [`ThetaCog ${s.version || ''} — /steer for Claude Code. The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed.`, ''];
  if (!s.skills || s.skipped) {
    L.push(`Skills not installed: ${s.skipped || 'the install did not run'}.`);
    if (s.claudeCode && !s.claudeCode.present) L.push('Install Claude Code (the app or the CLI), open it once, then run this line again: npx thetacog-mcp');
  } else {
    const have = s.skills.filter((k) => k.after === 'current');
    L.push(`Your Claude Code skills (${have.length}, in ${s.target}):`);
    for (const k of have) { const first = (k.about || '').split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' '); L.push(`  /${k.name.padEnd(14)} ${first.length > 110 ? first.slice(0, 107) + '…' : first}`); }
    for (const p of s.refused || []) L.push(`  left alone (someone else's file): ${p}`);
    L.push('', 'Use them: start a new Claude Code session (the app or the terminal) in your project and type', '  /steer <your ask, in your own words>');
  }
  if (s.home) L.push('', `Manual: ${path.join(s.home, MANUAL_REL)}${s.manual && s.manual.state === 'opened' ? ' (opened in your browser)' : ''}`);
  L.push('', 'Other doors: npx thetacog-mcp attest-demo (the two-node proof) · prove (self-proof, ~15 s) · steer "<ask>" (no editor) · skills --debug');
  return L.join('\n');
}
function announcedVersion(home) { try { return JSON.parse(fs.readFileSync(path.join(home, ANNOUNCED), 'utf8')).version; } catch { return null; } }
export function summaryText(story, { fresh = false } = {}) {
  if (story.skipped) return story.skipped.startsWith('engine home') || story.skipped.startsWith('THETACOG_NO_SKILLS') ? null : `thetacog-mcp ${story.version}: Claude Code skills not installed — ${story.skipped} (details: npx thetacog-mcp skills --debug)`;
  const current = story.skills.filter((k) => k.after === 'current');
  const told = story.wrote.length ? story.skills.filter((k) => k.wrote) : fresh ? current : [];
  const setup = setupLines(story.setup, { fresh });
  const one = `thetacog-mcp ${story.version}: Claude Code skills current — ${current.map((k) => '/' + k.name).join(' ')}${story.refused.length ? ` · left alone (someone else's file): ${story.refused.join(', ')}` : ''}`;
  if (!told.length) return setup.length ? [one, ...setup].join('\n') : one;
  const L = [`🧰 thetacog-mcp ${story.version}: installed ${told.length} Claude Code skill${told.length === 1 ? '' : 's'} into ${story.target}`];
  for (const k of told) L.push(`   /${k.name}${k.before === 'ours-old' ? ' (updated; the old copy is kept)' : ''}`);
  for (const p of story.refused) L.push(`   left alone (someone else's file): ${p}`);
  L.push(...setup);
  L.push('   open a new claude session and type / to use them · manual: ' + path.join(story.home, MANUAL_REL) + ' · report: ' + path.join(story.home, '.thetacog', 'skills-install.html'));
  return L.join('\n');
}
/** C2360 · C2361 · C2362: one line per write (with its undo), one per thing left alone; a fresh announce also names what is in place.
 * A skip is quiet here (the --debug story and the page carry it) — the default is less, never silent about a write. */
export function setupLines(setup, { fresh = false } = {}) {
  const L = [];
  for (const r of setup || []) {
    if (r.state === 'wrote' || r.state === 'updated' || (fresh && r.state === 'current')) L.push(`   ${r.state === 'current' ? 'in place' : r.state === 'updated' ? 'updated' : 'wrote'}: ${r.what} → ${r.path} · undo: ${r.undo}`);
    else if (r.state === 'refused') L.push(`   left alone: ${r.what} — ${r.why}`);
  }
  return L;
}

/** tell and show. npm and npx run postinstall with its output hidden, so postinstall passes { announce: false }: the first command a
 * person runs afterwards is the one that tells them what landed (fresh = this version was never announced) and opens the page once. */
export function tellAndShow(story, { announce = true } = {}) {
  const fresh = announce && !story.skipped && announcedVersion(story.home) !== story.version;
  const text = summaryText(story, { fresh });
  if (!story.skipped) {
    // the manual is what opens on install, the report page only under --debug: one page, written for someone who never opened a terminal
    try { story.manual = openManual(story); } catch { /* the manual is a courtesy; the skills already landed */ }
    try { debugReport(story, { open: false }); } catch { /* the page is a courtesy; the tell already went */ }
    if (announce) { try { fs.mkdirSync(path.join(story.home, '.thetacog'), { recursive: true }); fs.writeFileSync(path.join(story.home, ANNOUNCED), JSON.stringify({ version: story.version, at: story.at, skills: story.skills.filter((k) => k.after === 'current').map((k) => k.name) }) + '\n'); } catch { /* telling again next time is the safe failure */ } }
  }
  return text;
}

/** C2321: "has this skill been opened yet" rendered as one line per skill, in bundled order. */
function openedLines(opens, skills) {
  if (!opens) return [];
  if (!opens.available) return ['  (no ~/.claude/projects on this machine yet — nothing to count)'];
  const L = [`  counted across the ${opens.scanned} most recently touched session${opens.scanned === 1 ? '' : 's'} of ${opens.totalFiles} on this machine (capped at ${opens.maxFiles}) · ${HOW_COUNTED}`];
  for (const sk of skills) { const n = opens.counts[sk.name] || 0; L.push(`  /${sk.name}: ${n ? `opened ${n} time${n === 1 ? '' : 's'}` : 'not opened yet'}`); }
  return L;
}

/** the --debug story: every check, every skill, before and after */
export function storyText(s) {
  const L = [`thetacog-mcp ${s.version} · skill install · ${s.at}`, `home: ${s.home}`, `target: ${s.target}`];
  if (s.claudeCode) L.push(`Claude Code: ${s.claudeCode.present ? 'present' : 'absent'} — ${s.claudeCode.why}`);
  if (s.skipped) { L.push(`NOT INSTALLED: ${s.skipped}`); return L.join('\n'); }
  L.push('', 'what each skill is:');
  for (const k of s.skills) L.push(`  /${k.name}: ${k.about}`, `    sets up: ${k.setsUp}`, `    first command: ${k.firstCommand || '/' + k.name}`);
  L.push('', 'install status:');
  for (const k of s.skills) L.push(`  /${k.name}: ${k.before}${k.priorSha ? ` (sha ${k.priorSha})` : ''} → ${k.after} (bundled sha ${k.bundled})${k.wrote ? ' · WROTE' : ''}${k.after === 'foreign' ? " · someone else's file, left alone — rename it and run again" : ''}  ${k.path}`);
  L.push(s.wrote.length ? `wrote ${s.wrote.length}: ${s.wrote.join(', ')}` : 'wrote nothing: every skill was already current or not ours');
  L.push('every skill above is listed in a new `claude` session (type / to see them)');
  L.push('', 'set up beside the skills (outside ~/.claude/skills):', ...((s.setup || []).length ? s.setup.map((r) => `  ${r.what}: ${r.state}${r.path ? ` · ${r.path}` : ''}${r.why ? ` · ${r.why}` : ''}${r.undo ? ` · undo: ${r.undo}` : ''}${r.backup ? ` · backup: ${r.backup}` : ''}`) : ['  nothing']));
  L.push('', 'opened in a Claude Code session yet:', ...openedLines(s.sessionOpens, s.skills));
  L.push('', 'other pages this install opened:');
  L.push(...((s.otherPages || []).length ? s.otherPages.map((p) => `  ${p}`) : ['  none']));
  return L.join('\n');
}

export function storyHtml(s) {
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (s.skills || []).map((k) => `<tr><td>/${esc(k.name)}</td><td>${esc(k.before)}${k.priorSha ? ` <code>${esc(k.priorSha)}</code>` : ''}</td><td>${esc(k.after)}</td><td><code>${esc(k.bundled)}</code></td><td>${k.wrote ? 'wrote' : '—'}</td><td><code>${esc(k.path)}</code></td></tr>`).join('');
  const blurbs = (s.skills || []).map((k) => `<tr><td>/${esc(k.name)}</td><td>${esc(k.about)}</td><td>${esc(k.setsUp)}</td><td><code>${esc(k.firstCommand || '/' + k.name)}</code></td></tr>`).join('');
  const opens = s.sessionOpens;
  const openRows = !opens || !opens.available ? '<p class="k">no ~/.claude/projects on this machine yet — nothing to count</p>' : `<p class="k">counted across the ${opens.scanned} most recently touched session${opens.scanned === 1 ? '' : 's'} of ${opens.totalFiles} on this machine (capped at ${opens.maxFiles}) · ${HOW_COUNTED}</p><table><tr><th>skill</th><th>opened</th></tr>${(s.skills || []).map((k) => `<tr><td>/${esc(k.name)}</td><td>${opens.counts[k.name] ? `opened ${opens.counts[k.name]} time${opens.counts[k.name] === 1 ? '' : 's'}` : 'not opened yet'}</td></tr>`).join('')}</table>`;
  const otherRows = (s.otherPages || []).length ? `<ul>${s.otherPages.map((p) => `<li><code>${esc(p)}</code></li>`).join('')}</ul>` : '<p class="k">none</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill Install Report</title>
<style>:root{--bg:#fbfaf7;--ink:#1d1d1b;--mute:#6b6a64;--line:#e2dfd6;--accent:#b8501f}@media (prefers-color-scheme:dark){:root{--bg:#151513;--ink:#ecebe6;--mute:#a09f98;--line:#33322d;--accent:#e9844f}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px}table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}code{font:12px ui-monospace,Menlo,monospace}.k{color:var(--mute)}h1{font-size:22px}h2{font-size:16px;margin-top:28px}.v{color:var(--accent);font-weight:600}</style></head>
<body><main><h1>Claude Code skills · thetacog-mcp <span class="v">${esc(s.version)}</span></h1>
<p class="k">${esc(s.at)} · home <code>${esc(s.home)}</code> · target <code>${esc(s.target)}</code></p>
<p>Claude Code: <b>${s.claudeCode ? (s.claudeCode.present ? 'present' : 'absent') : 'not checked'}</b> ${esc(s.claudeCode?.why)}</p>
${startHereHtml(s)}
${s.skipped ? `<p><b>Not installed:</b> ${esc(s.skipped)}</p>` : `
<h2>what each skill is</h2>
<table><tr><th>skill</th><th>what it is</th><th>sets up</th><th>first command</th></tr>${blurbs}</table>
<h2>install status</h2>
<table><tr><th>skill</th><th>before</th><th>after</th><th>bundled sha</th><th>this run</th><th>path</th></tr>${rows}</table>
<h2>set up beside the skills</h2>
${(s.setup || []).length ? `<table><tr><th>what</th><th>this run</th><th>where</th><th>undo</th></tr>${s.setup.map((r) => `<tr><td>${esc(r.what)}</td><td>${esc(r.state)}${r.why ? ` — ${esc(r.why)}` : ''}${r.backup ? `<br><span class="k">backup <code>${esc(r.backup)}</code></span>` : ''}</td><td><code>${esc(r.path || '')}</code></td><td><code>${esc(r.undo || '')}</code></td></tr>`).join('')}</table>` : '<p class="k">nothing</p>'}
<h2>opened in a Claude Code session yet</h2>
${openRows}
<h2>other pages this install opened</h2>
${otherRows}`}
<pre>${esc(storyText(s))}</pre></main></body></html>`;
}

/** start here (operator 2026-11-05: "the bash open happened, but its empty.. it should have all you need to get started with the
 * package - including the dump your convo into /steer and see it build the spec and execute it"): every report page, a skip
 * included, opens on the steps that get a person going, then links the full manual. A page that only says why it did nothing is
 * a refusal painted as a page. */
export function startHereHtml(s, packageDir = PKG_DIR) {
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const manual = s.home ? path.join(s.home, MANUAL_REL) : null;
  const skip = s.skipped ? `<p class="k">The personal install was skipped on this machine (reason below). In any project where <code>npm i thetacog-mcp</code> ran, the skills sit in that project's <code>.claude/skills</code>, so the steps below work there.</p>` : '';
  return `<h2>start here</h2>${skip}
<ol>
<li><b>Install, once.</b> In the Claude Code app (or a terminal) in your project: <code>npx thetacog-mcp</code></li>
<li><b>Start a new session.</b> Skills load when a session starts. Type <code>/</code> to see /steer and the rest.</li>
<li><b>Give it an ask.</b> <code>/steer add a refunds endpoint that never refunds more than the charge</code>. Your words become row C1 in <code>docs/specs/vna/SPEC-VNA-COCKPIT.md</code>.</li>
<li><b>Dump the conversation into /steer.</b> In a session you have been talking in for an hour: <code>/steer everything we decided in this conversation</code>, or paste a conversation after <code>/steer</code>. It splits into one row per job, you read the rows, then a worker takes them one commit per row, each placed against the row that ordered it.</li>
<li><b>Read the receipt.</b> One line per commit: where the work landed against what you declared, re-runnable from the commit. Whether the code is bug-free is not claimed.</li>
</ol>
${manual ? `<p>The full manual, every skill with its own text: <a href="file://${esc(manual)}"><code>${esc(manual)}</code></a></p>` : ''}
<h2>every skill this package carries</h2>
${skillCardsHtml(bundledSkills(packageDir))}`;
}

/** --debug: the story to stderr, the page written to ~/.thetacog/skills-install.html and opened */
export function debugReport(story, { open = true } = {}) {
  try { openManual(story, { opener: () => {}, env: { ...process.env, THETACOG_NO_OPEN: '1' } }); } catch { /* the link may dangle; the steps are on the page */ }
  const file = path.join(story.home, '.thetacog', 'skills-install.html');
  const full = story.skipped ? story : { ...story, sessionOpens: sessionOpenCounts(story.home, story.skills), otherPages: otherPages(story.home) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, storyHtml(full));
  if (open && process.env.THETACOG_NO_OPEN !== '1') spawnSync(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [file], { stdio: 'ignore' });
  return { file, text: storyText(full) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = installUserSkills();
  if (process.argv.includes('--debug')) { const r = debugReport(s); console.error(r.text); console.error(`report: ${r.file}`); }
  else { const line = tellAndShow(s); if (line) console.error(line); }
}
