// scripts/pmu/attest-recompute.mjs — C828: the RECOMPUTE receipt line attest-demo prints, and what a guard reads back.
//
// The operator's ask (2026-10-14, the measurement inversion): "Confirm that output hashes and 144×144 grid coordinates match
// across multiple runs without network access." The attestation receipt attest.mjs signs carries three kinds of field, and only
// one of them is the thing a stranger recomputes:
//   · the RECOMPUTABLE record — reef commitment, payload sha, authorized cells, verdict, lane, gzip σ, threshold, oracle;
//   · the PER-RUN envelope — inner_receipt_id (a uuid), host_attestation.gate_ms (a clock), the keys and the signature
//     (attest keygen mints a pair per run), the receipt's own sha256 (which covers the envelope).
// Hashing the whole file therefore differs on every run BY DESIGN, and a guard that compared it would be red forever while
// the placement was identical. The recompute hash here is taken over the record alone, with the envelope named as outside
// it — AXIOM 1 W2: a receipt is recomputed over the retained record, never over the log of the run that produced it.
//
// Pure, no I/O. The demo composes ONE key=value line (RECOMPUTE …) so a guard parses the construct and never a prose fragment.
// The word "deterministic" never appears in the composed line: it names the chaos (CLAUDE.md AXIOM 0), and our side is
// re-runnable from the bytes. attest-demo.mjs (the composer) and tests/vna/c828-build-the-recompute-guard-for-the.test.mjs
// (the reader) are the two callers.
import { createHash } from 'node:crypto';

/** the receipt fields a stranger recomputes, in a fixed key order (the hash input) */
export const RECOMPUTE_FIELDS = ['artifact', 'receipt_kind', 'reef_commitment', 'payload_sha256', 'authorized_cells', 'verdict', 'inner_verdict', 'authoritative_cell', 'gzip_witness', 'threshold', 'oracle'];
/** the per-run envelope, named so the line can say what the hash leaves OUT */
export const ENVELOPE_FIELDS = ['job_id', 'inner_receipt_id', 'host_attestation', 'submitter_pubkey', 'addressed_to', 'pubkey_hex', 'sig_hex', 'sha256'];

export function recomputeRecord(receipt) {
  const out = {};
  for (const k of RECOMPUTE_FIELDS) if (receipt && receipt[k] !== undefined) out[k] = receipt[k];
  return out;
}

/** sha256 over the recomputable record only — identical whenever the same bytes placed at the same address */
export function recomputeSha256(receipt) {
  return createHash('sha256').update(JSON.stringify(recomputeRecord(receipt))).digest('hex');
}

/** the engine the walk ran on, read from door-crate's own counters (never from the env alone): rust when the crate answered
 *  every walk request, node when any walk fell back or the crate was off, none when no walk ran at all */
export function walkEngine(stats = {}) {
  const crate = Number(stats?.requests?.walks || 0), fell = Number(stats?.fallbacks?.walks || 0);
  if (stats?.enabled === false) return 'node';   // PMU_DOOR_CRATE=0: every walk ran leafWalk in node, the crate was never asked
  if (fell > 0) return 'node';                   // the crate was asked and handed at least one walk back
  if (crate > 0) return 'rust';
  return 'none';
}

const esc = (v) => String(v ?? 'UNMEASURED').replace(/\s+/g, '_');

/** ONE line, key=value pairs separated by single spaces, starting with the token RECOMPUTE. A guard parses this; the prose
 *  around it is for the reader. cell/coord are UNMEASURED (with the why in `why`) when the triptych did not render. */
export function composeRecomputeLine({ recomputeSha, fullSha, cell, coord, lane, sigma, engine, walksCrate = 0, walksFallback = 0, outboundSockets, proxy, why = null }) {
  const parts = [
    'RECOMPUTE',
    `recompute_sha256=${esc(recomputeSha)}`,
    `full_sha256=${esc(fullSha)}`,
    `cell=${esc(cell)}`,
    `coord=${esc(coord)}`,
    `lane=${esc(lane)}`,
    `sigma=${sigma == null ? 'UNMEASURED' : Number(sigma).toFixed(6)}`,
    `engine=${esc(engine)}`,
    `walks_crate=${Number(walksCrate) || 0}`,
    `walks_fallback=${Number(walksFallback) || 0}`,
    `outbound_sockets=${outboundSockets == null ? 'UNMEASURED' : Number(outboundSockets)}`,
    `proxy=${esc(proxy || 'none')}`,
    'rerunnable_from=the_bytes',
  ];
  if (why) parts.push(`why=${esc(why)}`);
  return parts.join(' ');
}

/** parse the RECOMPUTE line out of a demo transcript → {key: value}, or null when the demo printed none */
export function parseRecomputeLine(text) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('RECOMPUTE '));
  if (!line) return null;
  const out = {};
  for (const kv of line.slice('RECOMPUTE '.length).split(/\s+/)) { const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); }
  return out;
}

/** the network receipt: count every socket this process opens to a non-loopback host. Sufficient for "did THIS process reach
 *  out"; NOT sufficient for a child process (children inherit the denial env, and are not counted here — the line says so). */
export function installOutboundSocketCounter(net) {
  const tally = { sockets: 0, hosts: [] };
  const LOOPBACK = /^(localhost|127\.(\d+\.){2}\d+|::1|\[::1\]|0\.0\.0\.0|::)$/i;
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) {
    let host = null;
    const first = Array.isArray(a[0]) ? a[0][0] : a[0];
    if (first && typeof first === 'object') host = first.path ? null : (first.host || 'localhost');
    else if (typeof first === 'number' || /^\d+$/.test(String(first))) host = typeof a[1] === 'string' ? a[1] : 'localhost';
    // a string that is not a port is a unix socket path — local by construction
    if (host && !LOOPBACK.test(host)) { tally.sockets++; if (tally.hosts.length < 5 && !tally.hosts.includes(host)) tally.hosts.push(host); }
    return orig.apply(this, a);
  };
  return tally;
}

/** the denial the run declares — read from the env the demo was given, never asserted */
export function proxyStamp(env = process.env) {
  const h = env.HTTPS_PROXY || env.https_proxy || '', p = env.HTTP_PROXY || env.http_proxy || '';
  if (!h && !p) return 'none';
  return `${h || '-'}|${p || '-'}|NO_PROXY=${JSON.stringify(env.NO_PROXY ?? env.no_proxy ?? null)}`;
}
