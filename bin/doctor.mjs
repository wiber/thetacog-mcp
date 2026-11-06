#!/usr/bin/env node
// packages/thetacog-mcp/bin/doctor.mjs — `npx thetacog-mcp doctor`: does everything this install needs actually run HERE?
// (operator 2026-10-22: "a button … that uses your local LM to run a diagnostic and make sure everything works properly … when
// you run it you should have something to drop into Claude Code or Codex or Grok … to wire up the remaining parts".)
//
// Two halves, kept apart on purpose (THE RECEIPT IS LLM-FREE):
//   1. the CHECKS — decidable, no model in the path: runtime, the IntentGuard addon, the walk binary for this platform, the
//      demo twice (same input → same digest), the MCP server's tool list, git, the optional native deps.
//   2. the HANDOFF — .thetacog/doctor/handoff.md in the caller's repo: the check results, the package map, and the instructions
//      a coding agent needs to wire whatever is left. A local model (Ollama or LM Studio), when one answers, adds a short
//      plain-language note under its own heading; it never changes a check result. --no-llm skips it.
//
//   npx thetacog-mcp doctor [--json] [--print] [--no-llm] [--out <file>] [--skills-only] [--fix [--hosts claude-code,cursor,gemini]]
// Exit 0 when no check FAILED (UNMEASURED is not a failure), 1 otherwise.
// @guard tests/vna/doctor-door.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CWD = process.cwd();
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const HERE = `${process.platform}-${process.arch}`;
const SERVER = join(PKG, 'server.js');
const NODE = process.execPath;   // the runtime running us: plain node, or the editor's Electron as node inside the vsix

const checks = [];
const add = (id, status, detail, fix = '') => { checks.push({ id, status, detail, fix }); };
const run = (cmdArgs, { input, timeout = 60000, cwd = CWD } = {}) =>
  spawnSync(NODE, cmdArgs, { cwd, input, timeout, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });

// C1220 — the skills land where each agent looks, and Claude Code has the MCP server (src/lib/agent-hosts.mjs). `--fix` writes the
// missing and earlier-ours slots (never a foreign file); `--hosts claude-code,cursor,gemini` narrows what --fix writes.
async function skillChecks() {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: CWD, encoding: 'utf8' });
  const ROOT = top.status === 0 ? top.stdout.trim() : CWD;
  const AH = await import(pathToFileURL(join(PKG, 'src/lib/agent-hosts.mjs')).href);
  const skills = AH.bundledSkills(PKG);
  if (!skills.length) add('skills', 'FAIL', `no bundled skills under ${join(PKG, 'skills')}`, 'the package ships skills/<name>/SKILL.md; a missing folder means an incomplete install');
  else {
    const home = existsSync(join(ROOT, 'packages', 'thetacog-mcp', 'package.json'));   // the engine's own repo: its skills are the source
    if (flag('--fix') && home) add('skills:fix', 'UNMEASURED', `${ROOT} is the engine's own repo — its .claude/skills are what the package copies, never overwritten from it`);
    else if (flag('--fix')) {
      const wrote = AH.fixSlots(ROOT, skills, opt('--hosts') ? { hosts: opt('--hosts').split(',') } : { hosts: ['claude-code'] });
      if (wrote.length) add('skills:fix', 'PASS', `wrote ${wrote.map((w) => `${w.path}${w.state === 'ours-old' ? ' (old copy kept in .thetacog/doctor/replaced/)' : ''}`).join(', ')}`);
    }
    for (const c of AH.hostChecks(AH.readSlots(ROOT, skills))) add(c.id, c.status, c.detail, c.fix || '');
  }
  const m = AH.claudeMcp(ROOT, process.env.HOME || '');
  add(m.id, m.status, m.detail, m.fix || '');
}

const pkgJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
let bundled = null; try { bundled = JSON.parse(readFileSync(join(PKG, '.bundled.json'), 'utf8')); } catch { /* not inside a vsix */ }
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (flag('--skills-only')) {   // C1220: the fast pass the extension runs on activation and npm run package runs after install
  await skillChecks();
  for (const c of checks) process.stdout.write(`${c.status.padEnd(10)} ${c.id} — ${c.detail}${c.fix && c.status !== 'PASS' ? `\n  fix: ${c.fix}` : ''}\n`);
  process.exit(checks.some((c) => c.status === 'FAIL') ? 1 : 0);
}

// 1 · runtime
add('runtime', nodeMajor >= 18 ? 'PASS' : 'FAIL',
  `node ${process.versions.node} on ${HERE}${process.versions.electron ? ` (the editor's Electron ${process.versions.electron})` : ''} · thetacog-mcp ${pkgJson.version}${bundled ? ` bundled into the vsix ${bundled.bundledAt}` : ''}`,
  'Node 18 or newer');
if (process.platform === 'win32') add('platform', 'UNMEASURED', 'Windows: the vsix shim is a sh script and no walk binary ships for win32', 'run inside WSL2 (linux-x64 or linux-arm64 ships)');

// 2 · the IntentGuard addon (the Rust card, in-process through napi)
try {
  const ig = createRequire(join(PKG, 'server.js'))('intentguard');
  const loaded = typeof ig.load === 'function' ? ig.load() : null;
  if (ig.unavailable) add('intentguard-addon', 'FAIL', `intentguard loaded but the addon is unavailable: ${ig.unavailable}`, 'the npm package ships darwin-arm64, darwin-x64, linux-arm64, linux-x64 — any other platform reads unavailable');
  else add('intentguard-addon', 'PASS', `${String(ig.addonPath || loaded?.path || '').split(/[\\/]/).pop() || 'addon'} loads`);
} catch (e) { add('intentguard-addon', 'FAIL', `require('intentguard') failed: ${e.code || e.message}`, 'the dependency ships inside the package; a missing one means an incomplete install — reinstall thetacog-mcp'); }

// 3 · the walk binary for THIS platform, run once on a tiny input
let walkBin = null;
try {
  const pb = await import(pathToFileURL(join(PKG, 'src/lib/pmu/pmu-binary.mjs')).href);
  walkBin = pb.resolvePmuBinary(PKG);
  const hdr = existsSync(walkBin) ? pb.binaryPlatform(walkBin) : null;
  if (!existsSync(walkBin)) add('walk-binary', 'FAIL', `no pmu-onchip at ${walkBin}`, `the package ships .thetacog/pmu/target/dist/pmu-onchip.${HERE}; reinstall, or build .thetacog/pmu with cargo`);
  else if (!pb.runsHere(hdr)) add('walk-binary', 'FAIL', `${relative(PKG, walkBin)} is built for ${hdr || 'an unknown platform'}, this host is ${HERE}`, `ship or build pmu-onchip.${HERE}`);
  else {
    const r = spawnSync(walkBin, ['--sense'], { input: JSON.stringify({ claims: ['doctor check'], targets: ['doctor check', 'something else'], target_lens: [20, 20], simhash_only: false }), timeout: 30000, killSignal: 'SIGKILL', encoding: 'utf8' });
    let ok = false; try { ok = Array.isArray(JSON.parse(r.stdout).scores); } catch { /* */ }
    add('walk-binary', ok ? 'PASS' : 'FAIL', ok ? `${relative(PKG, walkBin)} (${hdr}) answers --sense` : `${relative(PKG, walkBin)} ran but gave no scores (exit ${r.status}${r.signal ? `, ${r.signal}` : ''}): ${String(r.stderr || '').slice(0, 200)}`, ok ? '' : 'a deadline kill (SIGKILL) means a wedged pipe; anything else, read stderr above');
  }
} catch (e) { add('walk-binary', 'FAIL', `the resolver did not load: ${e.message}`, 'src/lib/pmu/pmu-binary.mjs ships in the package; a missing one means an incomplete install'); }

// 4 · the demo, twice: same input must give the same digest
const digests = [];
for (let i = 0; i < 2; i++) {
  const r = run([SERVER, 'attest-demo'], { timeout: 120000 });
  const m = String(r.stdout || '').match(/digest ([0-9a-f]{8,})/);
  digests.push(m ? m[1] : null);
  if (!m) { add('attest-demo', 'FAIL', `run ${i + 1} printed no digest (exit ${r.status}${r.signal ? `, ${r.signal} after the deadline` : ''}): ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`, 'run `npx thetacog-mcp attest-demo` by hand and read its last lines'); break; }
}
if (digests.length === 2 && digests.every(Boolean)) {
  add('attest-demo', digests[0] === digests[1] ? 'PASS' : 'FAIL', digests[0] === digests[1] ? `digest ${digests[0]} on both runs (same bytes, same hash)` : `two runs, two digests: ${digests.join(' vs ')}`, digests[0] === digests[1] ? '' : 'the placement must be byte-identical on identical input — this is a defect, report it with both digests');
}

// 5 · the MCP server answers initialize + tools/list
{
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'thetacog-doctor', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = run([SERVER], { input: msgs, timeout: 20000 });
  let tools = null;
  for (const line of String(r.stdout || '').split('\n')) { try { const j = JSON.parse(line); if (j.id === 2) tools = j.result?.tools || []; } catch { /* not json */ } }
  add('mcp-server', tools?.length ? 'PASS' : 'FAIL', tools ? `${tools.length} tools: ${tools.slice(0, 6).map((t) => t.name).join(', ')}${tools.length > 6 ? ', …' : ''}` : `no tools/list answer (exit ${r.status}${r.signal ? `, ${r.signal}` : ''})`, tools?.length ? '' : `register it in your agent as: { "command": "node", "args": ["${SERVER}"] }`);
}

// 6 · the repo the receipts read
{
  const g = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: CWD, encoding: 'utf8' });
  if (g.error) add('git', 'FAIL', 'git is not on PATH', 'install git — every receipt is recomputed from an immutable commit');
  else if (g.status !== 0) add('git', 'UNMEASURED', `${CWD} is not inside a git repo`, 'open the repo you want placed; the walk reads commits, never the working tree');
  else add('git', 'PASS', `repo ${g.stdout.trim()}`);
}

// 6b · C1220 — the agent skill slots and Claude Code's MCP registration
await skillChecks();

// 7 · optional native deps (only the doors that open a database need them)
try { createRequire(join(PKG, 'server.js')).resolve('better-sqlite3'); add('better-sqlite3', 'PASS', 'present (the chat/bookclub database doors can open)'); }
catch { add('better-sqlite3', 'UNMEASURED', 'optional, not installed: the doors that open a local database report it at the call and nothing else needs it', 'npm i better-sqlite3 inside the package, only if you use those doors'); }

// ── the local model (optional, never part of a check) ───────────────────────────────────────────────────────────
async function localModel() {
  if (flag('--no-llm')) return { skipped: '--no-llm' };
  const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const ollama = await get('http://127.0.0.1:11434/api/tags');
  if (ollama?.models?.length) return { kind: 'ollama', model: process.env.THETACOG_DOCTOR_MODEL || ollama.models[0].name };
  const lms = await get('http://127.0.0.1:1234/v1/models');
  if (lms?.data?.length) return { kind: 'openai', base: 'http://127.0.0.1:1234/v1', model: process.env.THETACOG_DOCTOR_MODEL || lms.data[0].id };
  return { skipped: 'no local model answered on 127.0.0.1:11434 (Ollama) or :1234 (LM Studio)' };
}
async function modelNote(lm, report) {
  const prompt = `You are reading a diagnostic of a developer tool install. In at most 8 short lines: say what works, what does not, and the next command to run for each failure. Use only the facts below; do not invent commands that are not named in them.\n\n${report}`;
  try {
    if (lm.kind === 'ollama') {
      const r = await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: lm.model, prompt, stream: false, options: { temperature: 0 } }), signal: AbortSignal.timeout(90000) });
      return (await r.json()).response?.trim() || null;
    }
    const r = await fetch(`${lm.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: lm.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(90000) });
    return (await r.json()).choices?.[0]?.message?.content?.trim() || null;
  } catch (e) { return null; }
}

const failed = checks.filter((c) => c.status === 'FAIL');
const lines = checks.map((c) => `- ${c.status.padEnd(10)} ${c.id} — ${c.detail}${c.fix && c.status !== 'PASS' ? `\n  fix: ${c.fix}` : ''}`);
const report = lines.join('\n');
const lm = await localModel();
const note = lm.model ? await modelNote(lm, report) : null;

const handoff = `# ThetaCog install — doctor handoff

Paste this whole file into Claude Code, Codex, Grok or any coding agent working in this repo. It carries what was checked,
what failed, where everything lives, and what is left to wire.

## What this is
thetacog-mcp places each unit of work (a commit, a prompt, a reply) against the spec it was declared under, with a Rust walk
(pmu-onchip) and the IntentGuard card (a napi addon). The placement is recomputable: same bytes, same hash. The install and the
measurement are free and open-source (MIT); only the attestation layer is licensed.

## Checks (no model in this list — each is a program that ran on this machine)
Host: ${HERE} · cwd: ${CWD} · package: ${PKG} · thetacog-mcp ${pkgJson.version} · ${new Date().toISOString()}

${report}

Result: ${failed.length ? `${failed.length} FAILED — ${failed.map((c) => c.id).join(', ')}` : 'nothing failed'}${checks.some((c) => c.status === 'UNMEASURED') ? ' · UNMEASURED is not a failure: the check could not run here, and the line names why' : ''}

## Local model note (${lm.model ? `${lm.kind}: ${lm.model}` : 'none'})
${note ? note : lm.skipped ? `Skipped — ${lm.skipped}.` : 'The local model answered the probe but returned no note.'}
(This note is model output. It never changes a check above.)

## Where things live
- ${SERVER} — the MCP server (stdio) and every door: \`node ${SERVER} <door>\` (\`npx thetacog-mcp <door>\` is the same).
- ${join(PKG, 'bin/pmu-rust.sh')} — runs the walk binary for this platform: ${join(PKG, '.thetacog/pmu/target/dist')}/pmu-onchip.<platform>-<arch>.
- ${join(PKG, 'node_modules/intentguard')} — the IntentGuard addon (napi/dist/intentguard.<platform>-<arch>.node).
- ${join(PKG, 'README.md')} — the doors, in the package's own words.
- ${join(CWD, '.thetacog')} — what the doors write in this repo (receipts, tape, this file).

## Your job (the agent reading this)
1. Fix every FAIL above. Each line names its fix; read the named file before changing anything.
2. Wire the MCP server into this agent if it is not already: command \`node\`, args \`["${SERVER}"]\`.
3. Run \`node ${SERVER} attest-demo\` once and show the human the three placements and the digest.
4. Re-run \`node ${join(PKG, 'bin/doctor.mjs')} --no-llm\` until nothing FAILS, then report which lines changed.
Do not edit files under ${PKG}: it is the shipped engine, and an edit there is overwritten by the next update. Configure from this repo instead.
`;

const out = opt('--out') || join(CWD, '.thetacog', 'doctor', 'handoff.md');
try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, handoff); } catch (e) { process.stderr.write(`could not write ${out}: ${e.message}\n`); }

if (flag('--json')) process.stdout.write(JSON.stringify({ host: HERE, version: pkgJson.version, checks, failed: failed.map((c) => c.id), localModel: lm.model ? { kind: lm.kind, model: lm.model, note } : { skipped: lm.skipped }, handoff: out }, null, 2) + '\n');
else if (flag('--print')) process.stdout.write(handoff);
else process.stdout.write(`thetacog doctor · ${HERE}\n${report}\n\n${failed.length ? `${failed.length} FAILED` : 'nothing failed'} · handoff for your coding agent: ${out}\n`);
process.exit(failed.length ? 1 : 0);
