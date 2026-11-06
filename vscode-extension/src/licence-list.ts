// packages/thetacog-mcp-vscode/src/licence-list.ts — C182d: one paste, one or many licences.
//
// PURE — no vscode, no fs, no network — so tests/vna/c182d-*.test.mjs transpiles and runs THIS function, not a copy of it.
// A licence and a claim token are both compact JWS (three base64url segments). They arrive pasted from an email, a list, a
// return URI (`vscode://…/auth?entitlement=<jwt>`), quoted, comma- or newline-separated; the parser keeps every JWT-shaped
// run in the order it appears, drops repeats, and COUNTS the pieces that held none, so junk is reported, never silently eaten.
const JWS = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export function splitLicences(text: string): { tokens: string[]; junk: number } {
    const tokens: string[] = []; const seen = new Set<string>(); let junk = 0;
    for (const piece of String(text || '').split(/[\s,;]+/)) {
        if (!piece) { continue; }
        const found = piece.match(JWS);
        if (!found) { junk++; continue; }
        for (const t of found) { if (!seen.has(t)) { seen.add(t); tokens.push(t); } }
    }
    return { tokens, junk };
}

// C182 — MANY LICENCES LOCK TO ONE MACHINE. The server already sums every credits_ledger row under a fingerprint
// (balance(fp)); the client did not track it because the machine store holds one entitlement JWT (C182a, not built yet)
// — each successful claim (single paste or one of a pasted list) is retained here instead, never rewritten (AXIOM 1): a
// row per ACCOUNT this machine has claimed, newest wins for that account's own credits. `k` = distinct accounts claimed
// under this fingerprint, `sum` = the sum of their most-recently-seen credits — the same reading `ledger.balance(fp)`
// would give when every claimed licence's account never moves again. PURE — no vscode, no fs — the caller (auth-manager.ts)
// owns the file; steer-ui.mjs mirrors this exact shape (scripts/vna/licence-history.mjs) since it cannot import a .ts file.
export interface ClaimRecord { at: string; fp: string; account_id: string; credits: number }

export function claimRow(claims: { pubkey_fingerprint: string; account_id: string; credits: number }, at: string = new Date().toISOString()): ClaimRecord {
    return { at, fp: String(claims.pubkey_fingerprint), account_id: String(claims.account_id), credits: Number(claims.credits) || 0 };
}

/** k = distinct accounts claimed under this fp, sum = their credits, each account counted once (the newest row wins). */
export function summarizeClaims(records: ReadonlyArray<ClaimRecord>, fp: string): { k: number; sum: number } {
    const byAccount = new Map<string, ClaimRecord>();
    for (const r of records || []) { if (r && r.fp === fp) { byAccount.set(r.account_id, r); } }
    let sum = 0; for (const r of byAccount.values()) { sum += r.credits; }
    return { k: byAccount.size, sum };
}
