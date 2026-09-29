// src/lib/pmu/thread-aperture.mjs — THE THREAD APERTURE, a thin caller of the one binary (operator 2026-09-14:
// "write it in rust and insist on only using the one same rust for all"). The thread — this prompt plus the
// session's prior prompts, newest first, until the mass floor clears — is built by `pmu-onchip --thread`
// (lens.rs thread_intent, floor = aperture.rs MIN_GZIP_BYTES). Nothing here reads a receipt or gzips a byte for
// the reading; the per-turn door (walk-door.mjs) does not even call this — lens.rs builds the thread inside the
// same --lens run. This wrapper exists for the per-prompt PNG path and the tests. MASS_FLOOR is the JS-side
// mirror of the Rust floor (physics.mjs MIN_GZIP_BYTES); the guard pins the two equal.
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePmuBinary } from './pmu-binary.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MAX_THREAD_PROMPTS = 12, MAX_THREAD_CHARS = 8000, RECEIPT_SCAN = 600;   // documented mirrors of lens.rs THREAD_*; the binary owns them
export const DEFAULT_RECEIPTS = resolve(REPO, '.thetacog/lens-receipts');
export const MASS_FLOOR = await (async () => { try { const P = await import(resolve(REPO, 'packages/thetacog-mcp/scripts/tape/physics.mjs')); return P.__internals__?.MIN_GZIP_BYTES ?? null; } catch { return null; } })();
export const gzipMass = (t) => { try { return gzipSync(Buffer.from(String(t), 'utf8')).length; } catch { return 0; } };   // a measurement helper for tests and replays, never a placement

// The thread, from the binary. `before` (ISO ts) makes a replay never read the future. Binary absent → the line alone, marked.
export function threadIntent(prompt, session, { receiptsDir = DEFAULT_RECEIPTS, before = null, repoRoot = REPO } = {}) {
  const bin = resolvePmuBinary(repoRoot);
  const line = String(prompt);
  if (!session || process.env.PMU_BINARY === 'absent' || !bin) return { text: line, span: { prompts: 1, chars: line.length, gzip: gzipMass(line), floor: MASS_FLOOR, session: session || null, thread: false, unmeasured: session ? 'binary absent' : undefined } };
  try {
    const args = ['--thread', '--prompt', line, '--session', String(session), '--receipts-dir', receiptsDir, ...(before ? ['--before', String(before)] : [])];
    const j = JSON.parse(execFileSync(bin, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 }));
    return { text: j.text, span: { ...j.span, session: session || null } };
  } catch (e) { return { text: line, span: { prompts: 1, chars: line.length, gzip: gzipMass(line), floor: MASS_FLOOR, session: session || null, thread: false, unmeasured: String(e && e.message || e).slice(0, 80) } }; }
}
