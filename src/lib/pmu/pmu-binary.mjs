// src/lib/pmu/pmu-binary.mjs — THE ONE canonical pmu-onchip resolver (operator 2026-07-16).
// =============================================================================
// "one rust pipeline called in different situations." The walk is spawned from several places —
// the commit gate (spec-deliver-walk), the chat/lens path (prompt-lens → unified-drift), the blog
// panel renderer, grip-microscope, attest-demo — and each used to resolve the binary relative to
// its own repo root. So a pipeline invoked from a different cwd, from the published package, or
// right after a rebuild would silently miss the binary and degrade to the gzip fallback (the sparse
// panel / the wrong placement). This resolver ends that: every caller resolves through here, and it
// searches the same canonical set of locations no matter who called it.
//
// The PMU_BINARY env override is still absolute — it wins even when it points at a nonexistent path,
// because a guard uses exactly that to FORCE the fallback (tests/…). Only when PMU_BINARY is unset do
// we search. First existing wins; if none exist we return the primary path so the caller's own
// existsSync check trips the honest, marked gzip-fallback rather than crashing.
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// ── which platform a binary runs on, read off its own Mach-O / ELF header (never its file name) ──
// Lives here, in the leaf every spawn site already imports; scripts/vna/recompute-receipt.mjs re-exports it.
const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64' };
/** "<platform>-<arch>[,<arch>…]" from the executable header, or null when the file is absent or no header we know */
export function binaryPlatform(file) {
  let b;
  try { const fd = openSync(file, 'r'); try { const buf = Buffer.alloc(4096); b = buf.subarray(0, readSync(fd, buf, 0, 4096, 0)); } finally { closeSync(fd); } } catch { return null; }
  if (b.length < 20) return null;
  if (b.readUInt32LE(0) === 0xfeedfacf) { const a = MACHO_CPU[b.readUInt32LE(4)]; return a ? `darwin-${a}` : null; }
  if (b.readUInt32BE(0) === 0xcafebabe) {   // universal (fat) Mach-O: big-endian arch count, 20-byte entries from offset 8
    const n = b.readUInt32BE(4), archs = [];
    for (let i = 0; i < n && 8 + i * 20 + 4 <= b.length; i++) { const a = MACHO_CPU[b.readUInt32BE(8 + i * 20)]; if (a) archs.push(a); }
    return archs.length ? `darwin-${archs.join(',')}` : null;
  }
  if (b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF' && b[5] === 1) { const a = ELF_MACHINE[b.readUInt16LE(18)]; return a ? `linux-${a}` : null; }
  return null;
}
export const runsHere = (hdr, platform = process.platform, arch = process.arch) => { if (!hdr) return false; const [p, as] = hdr.split('-'); return p === platform && as.split(',').includes(arch); };

// The per-platform builds scripts/pmu/build-onchip-all.sh writes and the package + vsix ship (all four), so a stranger on an
// Intel Mac or Linux runs the walk with no cargo: the vsix never runs postinstall, so a build-from-source fallback never fires.
export const ONCHIP_DIST_REL = '.thetacog/pmu/target/dist';
export const platformChipRel = (platform = process.platform, arch = process.arch) => `${ONCHIP_DIST_REL}/pmu-onchip.${platform}-${arch}`;

let _cached = null;

export function resolvePmuBinary(repoRoot, { platform = process.platform, arch = process.arch } = {}) {
  if (process.env.PMU_BINARY) return process.env.PMU_BINARY;   // explicit override / force-absent guard
  const host = platform === process.platform && arch === process.arch;
  if (host && _cached && existsSync(_cached)) return _cached;
  const REL = '.thetacog/pmu/target/release/pmu-onchip';
  const HOME = homedir();
  const candidates = [
    repoRoot ? resolve(repoRoot, REL) : null,                 // the caller's own repo (primary)
    repoRoot ? resolve(repoRoot, platformChipRel(platform, arch)) : null,   // the package's build for THIS platform
    resolve(HOME, REL),                                       // the shared per-user build
    resolve(HOME, 'GitHub/thetacog-mcp/pmu-rust/target/release/pmu-onchip'),
    resolve(HOME, 'GitHub/thetacog-mcp', REL),
    resolve(HOME, 'github/thetacog-mcp/pmu-rust/target/release/pmu-onchip'),
    resolve(HOME, 'GitHub/thetadrivencoach', REL),
  ].filter(Boolean);
  const existing = candidates.filter((c) => { try { return existsSync(c); } catch { return false; } });
  // First one whose header runs here; then one with no header we know (a test stub); only then one built for another
  // platform, so guardBinary still names the mismatch instead of the caller reading "absent".
  const pick = existing.find((c) => runsHere(binaryPlatform(c), platform, arch))
    || existing.find((c) => binaryPlatform(c) === null)
    || existing[0];
  if (pick) { if (host) _cached = pick; return pick; }
  return candidates[0];   // absent everywhere → return primary so the caller trips its honest fallback
}

// ── THE DEADLINE — the postman fix (2026-09-16) ───────────────────────────────
// Measured incident: 11 pmu-onchip processes alive 1–5 DAYS at 0% CPU, each paired with the node
// parent that spawned it — both sleeping, child holding fds 0/1/2 as unix sockets to the parent.
// Neither side hung up. The delivery was made and nobody signed for it: `execFileSync(BIN, args,
// { input, maxBuffer })` with NO `timeout`, so when the child's stdout fills the OS socket buffer
// while the parent is still writing stdin, both block forever. Load average reached 118 on 10 cores.
//
// The split is exactly diagnostic: every walker spawn carrying a `timeout:` had zero survivors;
// every one without it leaked. So the deadline is not a tuning knob, it is the hang-up.
//
// THE WALK IS ~14ms (lens-convergence-sweep.mjs:157 — "COMPUTE is ~14ms; the rest is PROCESS
// SPAWN"). 120s is ~8,500× that budget, which is the point: a firing deadline is ALWAYS a real
// deadlock, never a slow machine. SIGKILL because a wedged child blocked on a full socket does not
// reliably reap on SIGTERM.
export const PMU_SPAWN_TIMEOUT_MS = Number(process.env.PMU_SPAWN_TIMEOUT_MS || 120_000);
export const PMU_SPAWN_DEADLINE = { timeout: PMU_SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' };
