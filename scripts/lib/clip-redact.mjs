// scripts/lib/clip-redact.mjs — THE CLIPBOARD LOGGER NEVER WRITES A SECRET INTO A TRACKED FILE (C473).
//
// Incident (2026-09-29): `vercel env add INTENTGUARD_SIGNING_SEED production`, then — 20s and 30s
// later — the bare 64-hex seed itself, landed by scripts/vna/clip-watch.mjs into the tracked steer
// file and propagated into docs/specs/vna/amendments.ndjson and data/vna/spec-tree.txt. Caught and
// redacted by hand before any commit. clip-watch.mjs's existing SECRET_RE (sk/ghp/xox[bp]/AKIA/PEM
// prefixes) never fires on a BARE hex/base64 blob — the blob carries no prefix of its own; only the
// PRECEDING clip named what it was.
//
// ONE PURE FUNCTION — redactClip(clipText, recentClips, now) — over (this clip, the clips seen in
// the last 10 minutes). Nothing here reads a file, the clock (except via its `now` argument), or the
// network; the caller (clip-watch.mjs) supplies the clock and the recent-clip window, and is the only
// place this module's output is written anywhere.
//
// TWO GATES, in order:
//   1. KNOWN CREDENTIAL SHAPE — the clip itself carries a recognisable secret prefix/wrapper
//      (Stripe sk_live_/sk_test_/rk_, GitHub ghp_/gho_/github_pat_, Resend re_, Slack xox[bpa]-, a
//      three-part eyJ… JWT, an AWS AKIA… access key id, a PEM "-----BEGIN … PRIVATE KEY-----" block).
//   2. A BARE HEX/BASE64 BLOB WITH CONTEXT — the clip, trimmed, is ONLY a 32–128 char hex or base64
//      run (no prose, no whitespace) AND a clip seen within the last 10 minutes NAMES a secret-shaped
//      variable (an identifier with a SEED/SECRET/KEY/TOKEN/PASSWORD/PRIVATE component, env-var
//      style — `INTENTGUARD_SIGNING_SEED`, never a bare word like "key" in a sentence).
//
// A bare 40- or 64-hex clip with NO such context is a commit sha or a card sha256 and passes
// BYTE-IDENTICAL — false positives are the failure mode this module exists not to cause.
//
// The return value never carries the matched secret text: on a hit, `text` is the fixed marker
// `[REDACTED: <shape>]`; the caller logs `{shape, at}`, never the value.

const CREDENTIAL_SHAPES = [
  { shape: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { shape: 'github-token', re: /\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{16,}\b/ },
  { shape: 'resend-key', re: /\bre_[A-Za-z0-9]{16,}\b/ },
  { shape: 'slack-token', re: /\bxox[bpa]-[A-Za-z0-9-]{10,}\b/ },
  { shape: 'jwt', re: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { shape: 'aws-access-key', re: /\bAKIA[A-Z0-9]{12,}\b/ },
  { shape: 'pem-private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/ },
];

/** The known-shape gate: the first family whose regex fires, or null. */
export function credentialShape(text) {
  const t = String(text ?? '');
  for (const { shape, re } of CREDENTIAL_SHAPES) if (re.test(t)) return shape;
  return null;
}

// A bare hex or base64 blob: the WHOLE trimmed clip, no whitespace, 32-128 chars. Hex is a subset of
// the base64 alphabet, so one length-bounded alternation covers both; a trailing base64 '=' pad is
// allowed. A clip with any internal whitespace, punctuation prose, or a URL/path separator is not a
// blob — it is text that happens to contain something hex-shaped, which is not what the incident was.
const HEX_RE = /^[0-9a-fA-F]{32,128}$/;
const BASE64_RE = /^[A-Za-z0-9+/]{32,128}={0,2}$/;
export function isBareHexOrBase64Blob(text) {
  const t = String(text ?? '').trim();
  if (!t || /\s/.test(t)) return false;
  return HEX_RE.test(t) || BASE64_RE.test(t);
}

// SECRET-SHAPED VARIABLE NAMES: an env-var-style identifier (`FOO_BAR_SEED`) whose underscore-
// delimited components include one of these words WHOLE — never a substring match, so "MONKEY" or
// "SAFEKEEPING" (which merely CONTAIN "KEY") do not fire. This is the CLAUDE.md "kill inside skill"
// class applied to variable names.
const SECRET_WORDS = new Set(['SEED', 'SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'PRIVATE']);
const IDENT_RE = /\b[A-Z][A-Z0-9_]{2,}\b/g;
export function namesSecretVariable(text) {
  const s = String(text ?? '');
  let m;
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(s))) {
    const parts = m[0].split('_').filter(Boolean);
    if (parts.some((p) => SECRET_WORDS.has(p))) return true;
  }
  return false;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const toMs = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * The one decision. `recentClips` is an array of `{ text, at }` — clips seen before this one, in any
 * order; only entries within 10 minutes BEFORE `now` and naming a secret-shaped variable count as
 * context. Returns `{ redacted, shape, text }`: on a hit, `text` is `[REDACTED: <shape>]` and never
 * the matched value; otherwise `text` is the input, byte-identical.
 */
export function redactClip(clipText, recentClips = [], now = new Date()) {
  const text = String(clipText ?? '');
  const shape = credentialShape(text);
  if (shape) return { redacted: true, shape, text: `[REDACTED: ${shape}]` };

  const trimmed = text.trim();
  if (isBareHexOrBase64Blob(trimmed)) {
    const nowMs = toMs(now);
    const hasContext = (recentClips || []).some((c) => {
      if (!c || c.text == null) return false;
      const at = toMs(c.at);
      if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
      const age = nowMs - at;
      if (age < 0 || age > TEN_MINUTES_MS) return false;
      return namesSecretVariable(c.text);
    });
    if (hasContext) return { redacted: true, shape: 'seed-after-named-variable', text: '[REDACTED: seed-after-named-variable]' };
  }
  return { redacted: false, shape: null, text };
}
