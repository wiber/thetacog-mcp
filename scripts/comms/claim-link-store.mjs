// The claim-link TOKEN store — its own module so grant.mjs (which mints) and claim-links.mjs (which reads the ledger
// through grant.mjs) never import each other. Gitignored, 0600: a token is a bearer grant. Guard: tests/comms/claim-links.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkId } from '../../src/lib/notary/grant-link.mjs';

// C2305: the caller's repo when run as `npx thetacog-mcp claim-links` (VNA_REPO = its cwd), never the npx cache the code sits in
const REPO = process.env.VNA_REPO ? path.resolve(process.env.VNA_REPO) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STORE = path.join(REPO, '.thetacog/claim-links.local.ndjson');
export const readNd = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Keep a freshly minted token so the link can be maintained. Refuses a token whose hash is not the link id. */
export function keepToken({ who, usd, token, link_id }, file = STORE) {
  if (process.env.NODE_TEST_CONTEXT && file === STORE) return false;   // tests never write the operator's real store
  if (linkId(token) !== link_id) throw new Error(`token does not hash to link ${link_id}`);
  if (readNd(file).some((r) => r.link_id === link_id)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), who, usd: Number(usd), link_id, token }) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return true;
}

