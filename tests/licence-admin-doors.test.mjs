// packages/thetacog-mcp/tests/licence-admin-doors.test.mjs — C2305: the OPERATOR's licence tooling as `npx thetacog-mcp <door>` doors
// plus the /licence-admin skill (operator 2026-11-05: "make sure that the license handling infrastructure is packaged as skills as
// well, all of them" · "It has to be something that can be run as an npm package").
//
// What is asserted, each by running the real door (server.js, the same dispatch npx runs), never by reading a string that usually
// accompanies it:
//   1. every licence-admin door, run from an EMPTY folder with HOME an empty folder and an env carrying no secret ({HOME, PATH}),
//      exits non-zero with ONE line naming exactly what is missing — no stack trace, no stdout — and writes nothing in either folder
//      (and never reaches the keychain: the refusal comes before any script is spawned);
//   2. the read-only dry paths that need no secret run green and still write nothing (grant status · grant mint dry · grant link dry ·
//      keyring list · verify-license --help);
//   3. every door a bundled script backs is a bundle-pmu.mjs root and its import closure resolves with nothing missing (the same
//      closure rule the bundler copies by), so the package copy is the monorepo file, one source each;
//   4. skills/licence-admin/SKILL.md exists, is the synced copy of its source, is registered for install, and every
//      `npx thetacog-mcp <door>` in it and in /licence is a door server.js dispatches.
// Seen red 2026-11-05: run before the doors were registered, every door in (1) fell through to the MCP server start (no refusal line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..', '..');
const SERVER = join(PKG, 'server.js');

// door → the invocation that needs the operator's secret (or checkout), and what the refusal must name
const DOORS = [
  { door: 'grant', args: ['mint', '--account', 'someone@example.com', '--usd', '20', '--live'], names: /SUPABASE_SERVICE_ROLE_KEY/ },
  { door: 'issue-key', args: ['--email', 'someone@example.com'], names: /LICENSE_SIGNING_SEED/ },
  { door: 'revoke-key', args: ['--license', 'lic_' + '0'.repeat(32), '--status'], names: /CENTRAL_DB_SERVICE_ROLE_KEY/ },
  { door: 'keyring', args: ['--publish'], names: /LICENSE_SIGNING_SEED/ },
  { door: 'claim-links', args: ['--no-open'], names: /SUPABASE_SERVICE_ROLE_KEY/ },
  { door: 'licence-funnel', args: [], names: /SUPABASE_SERVICE_ROLE_KEY/ },
  { door: 'paid-funnel', args: ['--no-write'], names: /SUPABASE_SERVICE_ROLE_KEY/ },
  { door: 'licence-economics', args: [], names: /src\/app\/pricing\/page\.tsx/ },
  { door: 'licence-e2e', args: [], names: /scripts\/db\/e2e-license-flow\.mjs/ },
];
// the doors whose script ships in the package (the rest run the checkout's own copy, or refuse with the line above)
const BUNDLED = { grant: 'scripts/meetings/grant.mjs', keyring: 'scripts/license/keyring.mjs', 'claim-links': 'scripts/comms/claim-links.mjs',
  'licence-funnel': 'scripts/vna/licence-funnel.mjs', 'paid-funnel': 'scripts/vna/paid-funnel.mjs', 'licence-economics': 'scripts/economics/license-unit-economics.mjs' };

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)).map((x) => join(e.name, x)) : [e.name]));
function run(door, args) {
  const cwd = mkdtempSync(join(tmpdir(), `c2305-${door}-`)); const home = mkdtempSync(join(tmpdir(), `c2305-home-`));
  // no secret rides in: HOME and PATH only (THETACOG_NO_SKILLS keeps the skill installer out of the empty HOME — it is not a secret)
  const r = spawnSync(process.execPath, [SERVER, door, ...args], { cwd, env: { HOME: home, PATH: process.env.PATH, THETACOG_NO_SKILLS: '1' }, encoding: 'utf8', timeout: 60000, input: '' });
  const wrote = [...walk(cwd), ...walk(home)];
  rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true });
  return { ...r, wrote };
}
function dispatchTable() {
  const src = readFileSync(SERVER, 'utf8'); const out = {};
  for (const m of src.matchAll(/\[\s*'([a-z0-9-]+)'\s*,\s*'((?:scripts|bin)\/[\w./-]+\.(?:mjs|mts|sh))'\s*\]/g)) out[m[1]] = m[2];
  return out;
}

for (const { door, args, names } of DOORS) {
  test(`C2305 ${door}: with no secret it refuses in one line, exit non-zero, and writes nothing`, () => {
    const r = run(door, args);
    assert.notEqual(r.status, 0, `${door} exits non-zero (got ${r.status}; stdout ${r.stdout.slice(0, 200)} stderr ${r.stderr.slice(0, 300)})`);
    const lines = r.stderr.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `${door}: one line on stderr, got:\n${r.stderr}`);
    assert.match(lines[0], new RegExp(`^${door}: needs `), `${door}: the line opens with the door and "needs"`);
    assert.match(lines[0], names, `${door}: the line names what is missing`);
    assert.match(lines[0], /operator-only/, `${door}: the line says whose act it is`);
    assert.doesNotMatch(r.stderr, /\n\s+at |Error:/, `${door}: never a stack trace`);
    assert.equal(r.stdout.trim(), '', `${door}: nothing on stdout`);
    assert.deepEqual(r.wrote, [], `${door}: wrote nothing in the folder or HOME`);
  });
}

test('C2305 the read-only dry paths run with no secret and write nothing', () => {
  const st = run('grant', ['status']);
  assert.equal(st.status, 0, `grant status: ${st.stderr}`); assert.deepEqual(st.wrote, []);
  const mint = run('grant', ['mint', '--account', 'someone@example.com', '--usd', '20']);
  assert.equal(mint.status, 0, `grant mint dry: ${mint.stderr}`);
  assert.match(mint.stdout, /^DRY-RUN \(add --live\) · 10,000 credits \(1 licences\) → someone@example\.com/m);
  assert.match(mint.stdout, /ref grant:operator:\d{4}-\d{2}-\d{2}:usd20:1x10000:someone@example\.com/); assert.deepEqual(mint.wrote, []);
  const link = run('grant', ['link', '--who', 'Someone']);
  assert.equal(link.status, 0, `grant link dry: ${link.stderr}`); assert.match(link.stdout, /DRY-RUN .*the token is issued only with --live/); assert.deepEqual(link.wrote, []);
  const ring = run('keyring', []);
  assert.equal(ring.status, 0, `keyring list: ${ring.stderr}`); assert.match(ring.stdout, /does not exist yet/); assert.deepEqual(ring.wrote, []);
  const vl = run('verify-license', ['--help']);
  assert.equal(vl.status, 0, `verify-license --help: ${vl.stderr}`); assert.match(vl.stdout, /OFFLINE|offline/); assert.deepEqual(vl.wrote, []);
});

test('C2305 every licence door is in the dispatch table; each bundled one is a bundler root whose closure resolves', async () => {
  const table = dispatchTable();
  for (const { door } of DOORS) assert.ok(table[door], `server.js VNA_DOORS dispatches ${door}`);
  assert.equal(table['verify-license'], 'bin/verify-license.mjs'); assert.equal(table['attest-countersign'], 'scripts/pmu/attest-countersign.mjs');
  const bundler = readFileSync(join(PKG, 'scripts/bundle-pmu.mjs'), 'utf8');
  const { runtimeClosure } = await import(join(PKG, 'scripts/closure.mjs'));
  for (const [door, script] of Object.entries(BUNDLED)) {
    assert.equal(table[door], script, `${door} → ${script}`);
    assert.ok(bundler.includes(`'${script}'`), `bundle-pmu.mjs VNA_DOOR_SCRIPTS names ${script}, so prepack copies it (one source, the monorepo file)`);
    // one known non-edge is set aside by its shape: scripts/ops/board-now.mjs spawns `node -e "import('./scripts/ops/board.mjs')…"`, an
    // import that resolves against the CHILD's cwd, which the file-relative closure rule reads as scripts/ops/scripts/ops/board.mjs. A
    // path that repeats its own two leading segments names no file in this tree by construction, so nothing real hides behind it.
    const c = runtimeClosure(REPO, [script]);
    const missing = c.missing.filter((m) => !/^([\w-]+\/[\w-]+)\/\1\//.test(m));
    assert.deepEqual(missing, [], `${script}: every import resolves in the closure the bundler copies`);
  }
  assert.ok(existsSync(join(PKG, 'bin/verify-license.mjs')) && bundler.includes("'attest-countersign.mjs'"), 'the two buyer doors ship');
});

test('C2305 /licence-admin is a shipped, synced, installed skill and every door it names dispatches', async () => {
  const src = join(REPO, 'packages/thetacog-mcp-vscode/skills/licence-admin/SKILL.md'); const shipped = join(PKG, 'skills/licence-admin/SKILL.md');
  assert.ok(existsSync(src), 'the skill source exists'); assert.ok(existsSync(shipped), 'the package ships skills/licence-admin/SKILL.md');
  assert.equal(readFileSync(shipped, 'utf8'), readFileSync(src, 'utf8'), 'the shipped copy is the synced source (scripts/sync-skills.mjs)');
  const { SKILL_SOURCES, SKILL_NAMES } = await import(join(PKG, 'lib/install-skills.mjs'));
  assert.equal(SKILL_SOURCES['licence-admin'], 'packages/thetacog-mcp-vscode/skills/licence-admin/SKILL.md'); assert.ok(SKILL_NAMES.includes('licence-admin'));
  const text = readFileSync(shipped, 'utf8');
  assert.match(text, /^---\nname: licence-admin\n/, 'frontmatter name');
  const table = dispatchTable();
  const known = new Set([...Object.keys(table), 'skills']);
  for (const file of [shipped, join(PKG, 'skills/licence/SKILL.md')]) {
    const named = [...readFileSync(file, 'utf8').matchAll(/npx (?:-y )?thetacog-mcp(?:@latest)? ([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
    assert.ok(named.length > 0, `${file} names doors`);
    for (const d of named) assert.ok(known.has(d), `${file.replace(PKG + '/', '')} names \`npx thetacog-mcp ${d}\` — a door server.js dispatches`);
  }
  for (const d of Object.keys(BUNDLED).concat(['issue-key', 'revoke-key', 'licence-e2e'])) assert.match(text, new RegExp(`npx thetacog-mcp ${d}\\b`), `the skill names the ${d} door`);
  assert.match(readFileSync(join(PKG, 'skills/licence/SKILL.md'), 'utf8'), /npx thetacog-mcp verify-license[\s\S]*npx thetacog-mcp attest-countersign/, '/licence names its two new buyer doors');
});
