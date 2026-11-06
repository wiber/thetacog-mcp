// packages/thetacog-mcp/lib/door-needs.mjs — C2305: THE OPERATOR DOORS' PREFLIGHT (`npx thetacog-mcp grant|issue-key|…`).
//
// The licence-admin doors (the /licence-admin skill) run the operator's own licence tooling from the npm package: mint, move and
// revoke grants on the credits ledger, issue and revoke licence keys on the tape, list the keyring, read the funnels. Every one of
// them needs something only the operator holds — a service-role key, the licence signing seed, or the thetadrivencoach checkout
// itself. This file is the one place that says what each door needs for the invocation in front of it, checked BEFORE the door's
// script is located or spawned, so a stranger (or the operator in the wrong folder) gets ONE plain line naming exactly what is
// missing and exit 2: never a stack trace, never a partial write, never a network call.
//
// Where a need is read from: the caller's environment, then <cwd>/.env.local (the file every one of these scripts already reads at
// home). When the door may run, `env` is that merged environment, handed to the child, so a script that reads process.env sees the
// same keys it would at home. A secret is never printed: the line names the variable, never its value.
//
// SUFFICIENT FOR: "does this invocation have what it needs to run". NOT SUFFICIENT FOR: "is the key valid" — that is the door's
// own first network read, and its refusal is its own line.
// Guard: packages/thetacog-mcp/tests/licence-admin-doors.test.mjs
import fs from 'node:fs';
import path from 'node:path';

/** KEY=VALUE lines of an env file (quotes stripped); {} when the file is absent */
export function readEnvFile(file) {
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const SB_URL = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'];
const set = (env, k) => String(env[k] ?? '').trim() !== '';
// requirement builders: an env var, one of several env vars, a file under the caller's cwd
const E = (name) => ({ kind: 'env', names: [name] });
const ANY = (...names) => ({ kind: 'env', names });
const F = (rel, why = null) => ({ kind: 'file', rel, why });
const LEDGER = [ANY(...SB_URL), E('SUPABASE_SERVICE_ROLE_KEY')];          // grant.mjs supabaseLedger / straight-path openLedger / paid-funnel
const TAPE = [E('NEXT_PUBLIC_SUPABASE_URL'), E('CENTRAL_DB_SERVICE_ROLE_KEY')];   // issue-key.mts / revoke-key.mts (Central's license_tape)
const SIGNER = [F('src/lib/license/signing.ts'), F('node_modules/.bin/tsx')];   // the TypeScript signer runs under the checkout's own tsx

/** what one door needs for these args: { reqs, exec? } — exec replaces `node <script>` (the .mts doors run under the checkout's tsx) */
export const DOOR_NEEDS = Object.freeze({
  grant(args) {
    const [sub] = args; const live = args.includes('--live');
    if (!sub || sub === 'status') return { reqs: [] };                                   // reads data/pitch-meetings.ndjson, writes nothing
    if (sub === 'mint') return { reqs: (args.includes('--street') || live) ? LEDGER : [] };   // a street mint reads the ledger even dry
    if (sub === 'link') return { reqs: live ? LEDGER : [] };
    if (sub === 'move' || sub === 'revoke') return { reqs: LEDGER };                    // the dry run reads the ledger to plan
    if (sub === 'note') return { reqs: [F('scripts/bookclub/personal-followup.sh', 'the send pipeline')] };
    if (sub === 'enroll') return { reqs: [F('scripts/bookclub/enroll-one.mjs', 'the book-club enroller')] };
    if (sub === 'sent') return { reqs: [F('data/meetings/grant-actions.ndjson', 'the operator\'s action ledger')] };
    return { reqs: [] };                                                                // usage line, exit 2, from the script itself
  },
  'issue-key'(args) {
    return { reqs: [E('LICENSE_SIGNING_SEED'), ...(args.includes('--tape') ? TAPE : []), F('scripts/license/issue-key.mts'), F('src/lib/license/keyfile.ts'), ...SIGNER],
      exec: (cwd) => ({ file: path.join(cwd, 'node_modules/.bin/tsx'), args: [path.join(cwd, 'scripts/license/issue-key.mts')] }) };
  },
  'revoke-key'(args) {
    return { reqs: [...TAPE, ...(args.includes('--status') ? [] : [E('LICENSE_SIGNING_SEED')]), F('scripts/license/revoke-key.mts'), ...SIGNER],
      exec: (cwd) => ({ file: path.join(cwd, 'node_modules/.bin/tsx'), args: [path.join(cwd, 'scripts/license/revoke-key.mts')] }) };
  },
  keyring(args) { return { reqs: args.includes('--publish') ? [E('LICENSE_SIGNING_SEED'), ...SIGNER] : [] }; },   // the list is local and read-only
  'claim-links'(args) { return { reqs: args[0] === 'backfill' ? [F('data/meetings/grant-actions.ndjson', 'the operator\'s action ledger')] : LEDGER }; },
  'licence-funnel'(args, env) { return { reqs: set(env, 'VNA_CREDITS_LEDGER') ? [] : LEDGER }; },
  'paid-funnel'() { return { reqs: LEDGER }; },
  'licence-economics'() { return { reqs: [F('src/app/pricing/page.tsx', 'the live price page')] }; },
  'licence-e2e'() {
    return { reqs: [F('scripts/db/e2e-license-flow.mjs'), F('src/lib/license/signing.ts'), F('docs/crm/license-keys-tape-setup.sql'),
      F('node_modules/@electric-sql/pglite/package.json'), F('node_modules/esbuild/package.json')] };
  },
});

const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * preflight(door, args, { cwd, env }) → { ok: true, env, exec? } | { ok: false, line }
 * A door with no entry in DOOR_NEEDS passes untouched (ok, env unchanged). The line is the whole refusal: one sentence, no newline.
 */
export function preflight(door, args = [], { cwd = process.cwd(), env = process.env } = {}) {
  const spec = DOOR_NEEDS[door];
  if (!spec) return { ok: true, env };
  const merged = { ...readEnvFile(path.join(cwd, '.env.local')), ...env };   // the environment wins, as in every script that reads the file
  const { reqs, exec } = spec(args, merged);
  const missEnv = reqs.filter((r) => r.kind === 'env' && !r.names.some((n) => set(merged, n))).map((r) => r.names.join(' (or ') + (r.names.length > 1 ? ')' : ''));
  const missFile = reqs.filter((r) => r.kind === 'file' && !fs.existsSync(path.join(cwd, r.rel))).map((r) => r.rel);
  if (missEnv.length) return { ok: false, line: `${door}: needs ${list(missEnv)} (in .env.local or the environment) — operator-only` };
  if (missFile.length) return { ok: false, line: `${door}: needs ${list(missFile)} in this folder — run it from the thetadrivencoach checkout (operator-only; it does not ship in the npm package)` };
  return { ok: true, env: merged, ...(exec ? { exec: exec(cwd) } : {}) };
}
