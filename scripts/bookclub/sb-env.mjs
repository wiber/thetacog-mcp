// scripts/bookclub/sb-env.mjs — ONE place that resolves the Central Supabase endpoint
// from .env.local/.env plus a paginating fetcher. Extracted on first duplication
// (traffic-uplift-rank.mjs and rank-readers-t3.mjs both needed it — ONE RULE ONE PLACE).
// PostgREST silently caps a response at max-rows (measured: exactly 1000 rows on every
// dense query, no error) — fetchAllRows pages until a short page.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function sbEnv() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    try {
      for (const l of readFileSync(resolve(REPO, f), 'utf8').split('\n')) {
        const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
      }
    } catch {}
  }
  const SB = env.CENTRAL_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = env.CENTRAL_DB_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !KEY) return null;   // caller decides how loudly to refuse
  return { SB, headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } };
}

export async function fetchAllRows(base, headers) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${base}&limit=1000&offset=${off}`, { headers });
    if (!r.ok) throw new Error(`${base.slice(0, 80)} HTTP ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
