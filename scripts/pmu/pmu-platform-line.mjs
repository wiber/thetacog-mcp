// scripts/pmu/pmu-platform-line.mjs — C569 (2026-10-02): the live run (Ubuntu x64 under Proxmox,
// node v18.19.1, thetacog-mcp@2.55.0 via npx) hit the npm package's on-chip walker — a Mach-O
// 64-bit arm64 executable (`file .thetacog/pmu/target/release/<walker>`) — on linux-x64, and
// Pillar 7 printed '/bin/sh: 1: .../<walker>: Exec format error' ELEVEN TIMES, once per spawn
// attempt, each one a bare OS error with no context attached. Operator on the call: "I have not
// built it for Linux yet."
//
// attest-demo must know BEFORE the first exec, not find out from the OS. This reads the SAME
// Mach-O/ELF header `binaryPlatform` already reads for the recompute door (scripts/vna/
// recompute-receipt.mjs, C429/C424) — the file's own bytes, never its name, because a
// darwin-arm64 build under a generic path would otherwise be "found" and fail only at spawn.
// NO SECOND IMPLEMENTATION: that function is imported, never re-sniffed here.
//
// Kept in its OWN module (not inlined in attest-demo.mjs) so a guard can import this one pure
// function directly, without pulling in attest-demo.mjs's module-level `main().catch(...)` —
// importing attest-demo.mjs for any reason runs the whole ~2-minute live demo as a side effect
// (same reason node-floor.mjs, C570, is its own module).
//
// NEVER a direct caller of the binary itself — this module has NO execFileSync/execSync/spawn of
// any kind, only a header read of a path a CALLER already resolved; the one-pipeline ceiling
// (tests/pmu-simulator/one-pipeline.test.mjs) counts scripts that spawn it directly, and this one
// does not, so its name is deliberately spelled out nowhere in this file.
import { binaryPlatform } from '../vna/recompute-receipt.mjs';

/**
 * null when `file` is falsy/absent (the existing "daemon not built" / coarse-fallback paths
 * already name that honestly — this is not their job) or its header's platform-arch already
 * matches the one asked for; otherwise ONE line naming what the package shipped vs what this
 * machine needs, so a caller can skip the exec entirely — never find out from a spawned
 * process's own stderr.
 */
export function pmuPlatformLine(file, { platform = process.platform, arch = process.arch } = {}) {
  const hdr = file ? binaryPlatform(file) : null;
  if (!hdr) return null;   // absent, or a header we don't recognise — not this check's job
  const [hdrPlatform, archesCsv] = hdr.split('-');
  if (hdrPlatform === platform && archesCsv.split(',').includes(arch)) return null;
  return `UNMEASURED on ${platform}-${arch}: the on-chip binary at ${file} is built for ${hdr}, not ${platform}-${arch} — build .thetacog/pmu (cargo build --release) on this machine, or set PMU_BINARY to a ${platform}-${arch} build.`;
}
