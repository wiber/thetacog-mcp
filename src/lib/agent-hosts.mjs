// src/lib/agent-hosts.mjs (shipped as packages/thetacog-mcp/src/lib/agent-hosts.mjs by bundle-pmu crossTree) — THE SKILLS LAND WHERE EACH AGENT LOOKS (operator 2026-10-22: "How do we guarantee that
// the skill gets registered in Claude Code when you install the VSX and run the package we should have some kind of a setup script that
// verifies that that's accurate. This is probably some wrapper we can create for other LLMs as well").
//
// ONE SOURCE: the package's own skills/<name>/SKILL.md. Each host is an ADAPTER that renders that one file into the place the host reads:
//   claude-code  .claude/skills/<name>/SKILL.md      the file itself, byte for byte                       REQUIRED — a miss is a FAIL
//   cursor       .cursor/commands/<name>.md          the body (frontmatter dropped), typed as /<name>     optional — a miss is UNMEASURED
//   gemini       .gemini/commands/<name>.toml        description + prompt = the body                       optional — a miss is UNMEASURED
// Codex has no adapter yet: its custom prompts live in the user's home (~/.codex/prompts), outside the repo this writes into — named,
// never guessed (C1220b).
//
// AXIOM 1: a file this adapter did not write is never evicted. The state of each slot is one of
//   current   — byte-identical to what the adapter would write
//   missing   — no file; `fix` writes it
//   ours-old  — an earlier render of OUR skill (same frontmatter name); `fix` RETAINS it under .thetacog/doctor/replaced/ first, then writes
//   foreign   — someone else's file at that path; never overwritten, the path is named
// LLM-FREE. @guard tests/vna/c1220-skills-land-where-each-agent-looks.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const front = (src) => { const m = /^---\n([\s\S]*?)\n---\n?/.exec(src); return m ? { head: m[1], body: src.slice(m[0].length) } : { head: '', body: src }; };
// a frontmatter value: a double-quoted YAML scalar is unescaped (\" and \\) so the adapter re-escapes the text, never the escapes
const field = (head, k) => {
  const m = new RegExp(`^${k}:\\s*(.*?)\\s*$`, 'm').exec(head); if (!m) return null;
  const v = m[1]; return /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v;
};
const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tomlBlock = (s) => `"""\n${String(s).replace(/\\/g, '\\\\').replace(/"""/g, '""\\"')}\n"""`;   // a basic multi-line string: \ and """ escaped

export const HOSTS = Object.freeze([
  { id: 'claude-code', required: true, path: (n) => join('.claude', 'skills', n, 'SKILL.md'), render: (src) => src },
  { id: 'cursor', required: false, path: (n) => join('.cursor', 'commands', `${n}.md`), render: (src) => front(src).body.replace(/^\n+/, '') },
  { id: 'gemini', required: false, path: (n) => join('.gemini', 'commands', `${n}.toml`),
    render: (src) => { const f = front(src); return `description = ${tomlStr(field(f.head, 'description') || '')}\nprompt = ${tomlBlock(f.body.trim())}\n`; } },
]);

/** the bundled skills: [{ name, src }] from <pkg>/skills/<name>/SKILL.md */
export function bundledSkills(pkgDir) {
  const dir = join(pkgDir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, 'SKILL.md'))).sort().map((name) => ({ name, src: readFileSync(join(dir, name, 'SKILL.md'), 'utf8') }));
}

/** an earlier render of OUR skill: the frontmatter name (or, for a body-only host, the first heading) matches the bundled one */
function oursOld(host, existing, src) {
  const f = front(src); const name = field(f.head, 'name'); const h1 = (/^#\s.*$/m.exec(f.body) || [''])[0];
  if (host.id === 'claude-code') return !!name && field(front(existing).head, 'name') === name;
  return !!h1 && existing.includes(h1);
}

/** every (host, skill) slot in `repo`, read only */
export function readSlots(repo, skills) {
  const out = [];
  for (const host of HOSTS) for (const { name, src } of skills) {
    const rel = host.path(name); const abs = join(repo, rel); const want = host.render(src);
    let have = null; try { have = readFileSync(abs, 'utf8'); } catch { have = null; }
    const state = have === null ? 'missing' : have === want ? 'current' : oursOld(host, have, src) ? 'ours-old' : 'foreign';
    out.push({ host: host.id, required: host.required, skill: name, path: rel, state });
  }
  return out;
}

/** write every missing or ours-old slot; ours-old is retained under .thetacog/doctor/replaced/ first; foreign is never touched */
export function fixSlots(repo, skills, { hosts = HOSTS.map((h) => h.id), now = new Date() } = {}) {
  const done = [];
  for (const s of readSlots(repo, skills)) {
    if (!hosts.includes(s.host) || (s.state !== 'missing' && s.state !== 'ours-old')) continue;
    const host = HOSTS.find((h) => h.id === s.host); const abs = join(repo, s.path);
    if (s.state === 'ours-old') {
      const keep = join(repo, '.thetacog', 'doctor', 'replaced', `${now.toISOString().replace(/[:.]/g, '-')}-${s.path.replace(/[\\/]/g, '__')}`);
      mkdirSync(dirname(keep), { recursive: true }); writeFileSync(keep, readFileSync(abs));
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, host.render(skills.find((k) => k.name === s.skill).src));
    done.push({ ...s, wrote: true });
  }
  return done;
}

/** one doctor check per host: PASS when every slot is current; a required host with a non-current slot FAILS, an optional one is UNMEASURED */
export function hostChecks(slots) {
  return HOSTS.map((h) => {
    const mine = slots.filter((s) => s.host === h.id);
    const off = mine.filter((s) => s.state !== 'current');
    if (!off.length) return { id: `skills:${h.id}`, status: 'PASS', detail: `${mine.map((s) => s.path).join(', ')} current` };
    const foreign = off.filter((s) => s.state === 'foreign');
    const fixable = off.filter((s) => s.state !== 'foreign');
    return {
      id: `skills:${h.id}`, status: h.required ? 'FAIL' : 'UNMEASURED',
      detail: off.map((s) => `${s.path} ${s.state}`).join(' · '),
      fix: [fixable.length ? `npx thetacog-mcp doctor --fix${h.required ? '' : ` --hosts ${h.id}`} writes ${fixable.map((s) => s.path).join(', ')}` : '', foreign.length ? `${foreign.map((s) => s.path).join(', ')} is someone else's file — rename it to let ours land` : ''].filter(Boolean).join('; '),
    };
  });
}

/** Claude Code's MCP registration for this repo: .mcp.json at the repo root, or the project entry in ~/.claude.json */
export function claudeMcp(repo, home) {
  const j = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const ours = (servers) => Object.entries(servers || {}).find(([k, v]) => /thetacog/i.test(k) || /thetacog-mcp/.test(JSON.stringify(v || {})));
  const local = ours(j(join(repo, '.mcp.json'))?.mcpServers);
  if (local) return { id: 'mcp:claude-code', status: 'PASS', detail: `.mcp.json registers "${local[0]}"` };
  const user = j(join(home, '.claude.json')); const proj = user?.projects?.[repo]?.mcpServers; const g = ours(proj) || ours(user?.mcpServers);
  if (g) return { id: 'mcp:claude-code', status: 'PASS', detail: `~/.claude.json registers "${g[0]}"` };
  return { id: 'mcp:claude-code', status: 'FAIL', detail: 'no thetacog MCP server in .mcp.json or ~/.claude.json for this repo', fix: 'claude mcp add thetacog -- npx -y thetacog-mcp' };
}
