// src/lib/intentguard/addon.mjs — C465 THE ONE PLACE THE .node ADDON IS RESOLVED. loadAddon() never throws on
// absence — a missing or unloadable addon is a fact the caller (door.mjs) turns into 503 UNMEASURED, never a
// JS fallback that reimplements the walk. Search order:
//   1. INTENTGUARD_ADDON        an explicit path to the .node file (set this on Vercel once vendored)
//   2. <process.cwd()>/vendor/intentguard/intentguard.<platform>-<arch>.node   C488a: WHERE THE FUNCTION RUNS.
//      On Vercel cwd is /var/task, and next.config.js outputFileTracingIncludes['/api/intentguard'] =
//      ['./vendor/intentguard/*.node'] puts the file there. import.meta.url cannot find it: the bundler bakes
//      it in as the BUILD path (/vercel/path0/…), which does not exist at runtime (measured 2026-09-30 01:46Z:
//      the build VENDORED the addon, the POST still answered 503 "checked: /vercel/path0/…").
//   3. <root of import.meta.url>/vendor/intentguard/…   the file scripts/vercel-install.sh vendors in when
//      INTENTGUARD_BUILD=1 (gitignored — a built artifact, never committed); right for local node runs
//   4. ../IntentGuard/napi/intentguard.<platform>-<arch>.node  LOCAL DEV ONLY: the sibling repo's own build
// Every argument is optional and injectable (moduleUrl, cwd, env, load) so the resolution is testable without
// loading a real .node (tests/api/c488a-addon-resolves-at-runtime.test.mjs).
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require_ = createRequire(import.meta.url);

function addonFileName() {
  return `intentguard.${process.platform}-${process.arch}.node`;
}

/** The ordered candidate list. Pure: a function of (moduleUrl, cwd, env), no disk reads. */
export function candidates({ moduleUrl = import.meta.url, cwd = process.cwd(), env = process.env } = {}) {
  const name = addonFileName();
  const buildRoot = resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..');   // src/lib/intentguard → repo
  const list = [];
  if (env.INTENTGUARD_ADDON) list.push({ path: env.INTENTGUARD_ADDON, label: 'INTENTGUARD_ADDON env' });
  const runtime = resolve(cwd, 'vendor', 'intentguard', name);
  list.push({ path: runtime, label: 'vendor/intentguard under process.cwd() (the function root at runtime)' });
  const built = resolve(buildRoot, 'vendor', 'intentguard', name);
  if (built !== runtime) list.push({ path: built, label: 'vendor/intentguard under import.meta.url (the build path)' });
  list.push({ path: resolve(buildRoot, '..', 'IntentGuard', 'napi', name), label: '../IntentGuard/napi (local dev only)' });
  return list;
}

/** Resolves and requires the napi addon for this host. Returns {addon, path} or {addon:null, reason}. */
export function loadAddon({ moduleUrl, cwd, env, load = require_ } = {}) {
  const tried = [];
  for (const c of candidates({ moduleUrl, cwd, env })) {
    if (!existsSync(c.path)) { tried.push(`${c.path} (${c.label}: not present)`); continue; }
    try {
      const addon = load(c.path);
      return { addon, path: c.path };
    } catch (e) {
      return { addon: null, reason: `${c.path} (${c.label}) failed to load: ${e && e.message ? e.message : e}; checked before it: ${tried.join('; ') || 'none'}` };
    }
  }
  return { addon: null, reason: `no IntentGuard addon on this host — checked: ${tried.join('; ')}` };
}
