// auth-manager.ts — C75 DEVICE AUTHORIZATION AND LICENCE ACTIVATION (goal 4 unit 3, 2026-09-18).
//
// The device key IS the room identity the flight tape already signs with (sig_pubkey on every row) — this module
// never makes a keypair; it asks scripts/vna/auth-flow.mjs `whoami` for the fingerprint and shows it. [ Connect / Buy
// credits ] runs `auth-flow.mjs connect --no-open --json`: the script POSTs the device-code request (pubkey +
// fingerprint), prints the checkout URL, and this host opens it in the browser through vscode.env.openExternal —
// LOGIN, PAYMENT AND THE LICENCE HAPPEN ON THE SITE, NEVER HERE (deny-first: money and secrets). The script polls the
// token endpoint, verifies the JWT against the site's key, and prints the entitlement ONCE on stdout; this host puts
// it in context.secrets and nowhere else — no file, no globalState, no argv (argv is visible to every process on the
// host), no log line. The RUN row reads `🔑 <fingerprint> · <credits> credits` from the CLAIMS (account_id ·
// pubkey_fingerprint · credits · exp — not a secret), which ride VNA_ENTITLEMENT_CLAIMS into every steer-ui.mjs repaint;
// the JWT itself never leaves the secret store except as NOTARY_BEARER for the sync (C74), also by environment.
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describeFailure } from './status';
import { readDeviceDoor, SECRET_KEY as DOOR_SECRET_KEY } from './device-door';   // C102a: the one reader of connect|notarise --json, pure, guarded in-process
import { doorCommand } from './commands';   // C94b: THE ONE COMMAND TABLE — the auth flow is a door (`npx thetacog-mcp auth-flow`) so the key can be bought from a stranger's repo
import { splitLicences, claimRow } from './licence-list';   // C182: one paste, one or many — the same pure parser C182d's page uses

const SECRET_KEY = DOOR_SECRET_KEY;   // 'vna.entitlement' — one key, named once (device-door.ts)
const FLOW = 'scripts/vna/auth-flow.mjs';

export interface EntitlementClaims { account_id: string; pubkey_fingerprint: string; credits: number; exp: number }

let ctx: vscode.ExtensionContext | undefined;
let claimsCache: EntitlementClaims | null = null;
let fingerprintCache: string | null = null;
let jwtCache: string | null = null;   // C173d: the machine store's licence, held in this host's memory for NOTARY_BEARER — never written by this module

function root(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }

// C173c — THE ONE CLAIMS SNAPSHOT. SecretStorage is per-app, so VS Code and Cursor on one machine see different stores and
// took turns painting the key box (measured 2026-09-22). The host that holds the JWT writes the NON-SECRET claims
// (account_id · pubkey_fingerprint · credits · exp) to <repo>/.thetacog/entitlement-claims.json (gitignored); steer-ui.mjs
// reads env || snapshot. The JWT itself never touches the file. A host with no claim never erases another host's snapshot.
export function writeClaimsSnapshot(claims: EntitlementClaims | null, dir: string | undefined = root()): void {
    if (!dir) { return; }
    const file = path.join(dir, '.thetacog', 'entitlement-claims.json');
    try {
        if (!claims) { return; }
        const { account_id, pubkey_fingerprint, credits, exp } = claims;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ account_id, pubkey_fingerprint, credits, exp }));
    } catch { /* the snapshot is a convenience for other writers; the secret store stays the record */ }
}
function clearClaimsSnapshot(fingerprint: string | undefined, dir: string | undefined = root()): void {
    if (!dir || !fingerprint) { return; }
    const file = path.join(dir, '.thetacog', 'entitlement-claims.json');
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pubkey_fingerprint === fingerprint) { fs.unlinkSync(file); } } catch { /* absent or foreign */ }
}

// the claims are the payload segment of the JWT — decoded here for display only; VERIFICATION happened in the script
// against the site's key before the token was ever handed over, and the secret store is this host's own record
function decodeClaims(jwt: string | undefined): EntitlementClaims | null {
    if (!jwt) { return null; }
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) { return null; }   // expired: the row says not connected
        return payload as EntitlementClaims;
    } catch { return null; }
}

// C173d — THE DEVICE IS THE MACHINE, NOT THE APP. SecretStorage is per-app: VS Code held the licence, Cursor on the same Mac did not,
// and painted the claim box forever. The licence now lives in ONE per-machine store (scripts/vna/machine-store.mjs: the keychain
// item service=thetacog), which `auth-flow.mjs verify|connect|notarise` write on a verified token. On load this host asks that
// store through `auth-flow.mjs entitlement --legacy -`, handing its own SecretStorage copy on STDIN as the read-only migration
// source: an empty machine store takes it byte-for-byte; a machine store that holds a different one wins and logs the
// disagreement. SecretStorage stays this app's mirror, never the record. No door (a stranger's repo with no auth-flow) → the
// app's own copy, decoded for display, exactly as before.
function machineEntitlement(legacy: string | undefined): Promise<{ entitlement: string | null; claims: EntitlementClaims | null } | null> {
    const cwd = root();
    return new Promise((res) => {
        const c = doorCommand(cwd, FLOW, ['entitlement', '--legacy', '-', '--json']);
        if (!c.runnable) { res(null); return; }
        const child = spawn(c.file, c.args, { cwd, env: process.env });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (code) => {
            if (code !== 0) { res(null); return; }
            try { const m = JSON.parse(out.trim().split('\n').pop() || 'null'); res(m ? { entitlement: m.entitlement || null, claims: m.claims || null } : null); } catch { res(null); }
        });
        child.on('error', () => res(null));
        child.stdin.write(legacy || '');
        child.stdin.end();
    });
}

export async function loadEntitlement(context: vscode.ExtensionContext): Promise<EntitlementClaims | null> {
    ctx = context;
    const legacy = await context.secrets.get(SECRET_KEY);   // the migration source only — decodeClaims below is the no-door fallback
    const machine = await machineEntitlement(legacy);
    if (machine) { jwtCache = machine.entitlement; claimsCache = machine.entitlement ? decodeClaims(machine.entitlement) : null; }
    else { jwtCache = legacy || null; claimsCache = decodeClaims(legacy); }
    writeClaimsSnapshot(claimsCache);   // C173c
    return claimsCache;
}

// THE DOOR EVERY REPAINT USES: the claims for steer-ui.mjs (VNA_ENTITLEMENT_CLAIMS) and the bearer for tape-sync.mjs
// (NOTARY_BEARER) ride the environment of the child — never argv, never a file. Synchronous, from the cache the last
// load/connect filled, so run() in vna-steer.ts can merge it without awaiting the secret store on every spawn.
let extVersion: string | null = null;      // the WINDOW's manifest version (context.extension.packageJSON) — stale after an install until Reload Window
let codeVersion: string | null = null;     // the package.json beside the out/ the host actually loaded — C124
export function setExtensionVersion(v: string | undefined, code?: string | undefined): void { extVersion = v || null; codeVersion = code || null; }   // extension.ts, once
export function entitlementEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (extVersion) { env.VNA_EXT_VERSION = extVersion; }   // the WINDOW's build, so the strip can say LAG against the source (2026-09-18: 0.3.8 ran under 0.3.11 for a day)
    if (codeVersion) { env.VNA_EXT_CODE_VERSION = codeVersion; }   // C124: the loaded code's build — window ≠ code is WINDOW-STALE (Reload Window), code ≠ source is INSTALL-STALE (reinstall)
    if (claimsCache) { env.VNA_ENTITLEMENT_CLAIMS = JSON.stringify(claimsCache); }
    if (fingerprintCache) { env.VNA_DEVICE_FINGERPRINT = fingerprintCache; }   // shown in the sidebar even before a connect
    return env;
}

export async function bearerEnv(): Promise<Record<string, string>> {
    const jwt = jwtCache || (ctx ? await ctx.secrets.get(SECRET_KEY) : undefined);   // C173d: the machine's licence first — NOTARY_BEARER (child env) only
    return jwt ? { NOTARY_BEARER: jwt } : {};
}

// C83b — THE RETURN DOOR: a licence comes back by URI (`vscode://…/auth?entitlement=<jwt>`) or by hand (an input box).
// `parseAuthReturn` is the pure half — no vscode import, no side effect — so it is testable directly: a query string in,
// `{ jwt }` or `{ error }` out, never a throw.
export function parseAuthReturn(query: string | undefined): { jwt: string } | { error: string } {
    if (!query) { return { error: 'the return URI carried no query string' }; }
    let params: URLSearchParams;
    try { params = new URLSearchParams(query); } catch { return { error: 'malformed query string' }; }
    const jwt = params.get('entitlement');
    if (!jwt) { return { error: 'the query string named no entitlement' }; }
    return { jwt };
}

// C182 — the claim history: a row per ACCOUNT this machine has claimed (AXIOM 1: retained, never rewritten), non-secret
// (fp · account_id · credits · at — the same class as entitlement-claims.json's snapshot above), written on every VERIFIED
// claim whether it arrived alone or as one of a pasted list. scripts/vna/licence-history.mjs mirrors this exact row shape
// so steer-ui.mjs's 🔑 sub-pill can read `<k> licences · <fp8> · <sum> cr` once this fingerprint has claimed more than one.
function appendClaimHistory(claims: EntitlementClaims, dir: string | undefined = root()): void {
    if (!dir) { return; }
    const file = path.join(dir, '.thetacog', 'claimed-licences.ndjson');
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(claimRow({ pubkey_fingerprint: claims.pubkey_fingerprint, account_id: claims.account_id, credits: claims.credits })) + '\n');
    } catch { /* the history is a receipt, never a gate */ }
}

// THE ONE PATH EVERY DOOR TAKES for a SINGLE token. Spawns `auth-flow.mjs verify --jwt -` and writes the token to the
// child's STDIN — never argv, which is visible to every process on the host. Stores in context.secrets ONLY on a verified
// token; a refusal shows the reason and stores nothing (AXIOM: the credential is verified before it is trusted, C83's
// invariant 3). Never exported — ingestEntitlement below is the one door callers use, single token or a pasted list alike.
function verifyOneEntitlement(context: vscode.ExtensionContext, jwt: string, source: 'uri' | 'manual'): Promise<{ verified: boolean; claims?: EntitlementClaims; reason?: string }> {
    ctx = context;
    const cwd = root();
    return new Promise((resolve) => {
        const args = ['verify', '--jwt', '-', '--json'];
        const base = vscode.workspace.getConfiguration('vna').get<string>('authBase');
        if (base) { args.push('--base', base); }
        const c = doorCommand(cwd, FLOW, args);
        if (!c.runnable) { resolve({ verified: false, reason: c.display }); return; }
        const child = spawn(c.file, c.args, { cwd, env: process.env });
        let out = ''; let err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', async (code) => {
            let msg: { verified?: boolean; claims?: EntitlementClaims; reason?: string; entitlement?: string; claimed?: boolean } | null = null;
            try { msg = JSON.parse(out.trim().split('\n').pop() || 'null'); } catch { msg = null; }
            if (code === 0 && msg?.verified && msg.claims) {
                // C161: a pasted CLAIM TOKEN comes back as { claimed: true, entitlement } — the entitlement is what is stored, never the token
                await context.secrets.store(SECRET_KEY, msg.entitlement || jwt);   // this app's mirror — the script already wrote the machine store (C173d)
                jwtCache = msg.entitlement || jwt; claimsCache = msg.claims; fingerprintCache = msg.claims.pubkey_fingerprint; writeClaimsSnapshot(claimsCache);
                appendClaimHistory(msg.claims);   // C182: a row for THIS account under THIS fingerprint, retained forever
                vscode.window.showInformationMessage(`Steer: ${msg.claimed ? 'licence claimed to this device' : 'licence accepted'} (${source === 'uri' ? 'return URI' : 'entered by hand'}) — 🔑 ${msg.claims.pubkey_fingerprint} · ${msg.claims.credits} credits`);
                await vscode.commands.executeCommand('vna.run.spec');   // the same repaint connect triggers
                resolve({ verified: true, claims: msg.claims });
                return;
            }
            const reason = msg?.reason || describeFailure(err, code) || 'the entitlement did not verify';
            vscode.window.showWarningMessage(`Steer: licence refused — ${reason}`);
            resolve({ verified: false, reason });
        });
        child.on('error', (e) => { vscode.window.showWarningMessage(`Steer: licence refused — ${e.message}`); resolve({ verified: false, reason: e.message }); });
        child.stdin.write(jwt);
        child.stdin.end();
    });
}

// C182 — MANY LICENCES LOCK TO ONE MACHINE, AND PASTING A LIST LOCKS THEM ALL. The 🔑 sub-pill's box (C173a) already hands
// whatever was pasted to this one function — a single key, a single claim token, or a whole list from the purchase email —
// so the list case is handled HERE, once, rather than by teaching every caller to pre-split. splitLicences (licence-list.ts,
// C182d) finds every JWT-shaped token; a single token takes the EXACT path this function always took (byte-identical
// wire behaviour — c173a.1 pins the caller's line). More than one runs SERIALLY through verifyOneEntitlement (parallel
// claims would race the machine store, C173d) with one toast per token and a summary toast at the end.
export async function ingestEntitlement(context: vscode.ExtensionContext, jwt: string, source: 'uri' | 'manual'): Promise<{ verified: boolean; claims?: EntitlementClaims; reason?: string }> {
    const { tokens } = splitLicences(jwt);
    if (tokens.length <= 1) { return verifyOneEntitlement(context, jwt, source); }
    const results: { verified: boolean; claims?: EntitlementClaims; reason?: string }[] = [];
    for (const t of tokens) { results.push(await verifyOneEntitlement(context, t, source)); }
    const ok = results.filter((r) => r.verified);
    vscode.window.showInformationMessage(`Steer: ${ok.length} of ${tokens.length} licences claimed to this device`);
    const last = ok[ok.length - 1];
    return ok.length ? { verified: true, claims: last.claims } : { verified: false, reason: `0 of ${tokens.length} licences verified` };
}

// Fallback for when the OS blocks the vscode:// scheme: the same verified-before-stored path, entered by hand.
async function enterByHand(context: vscode.ExtensionContext, pasted?: unknown): Promise<void> {
    // C161: the sidebar's box at the top posts its text as the argument; the input box is the fallback for the command palette
    if (typeof pasted === 'string' && pasted.trim()) { await ingestEntitlement(context, pasted.trim(), 'manual'); return; }
    const jwt = await vscode.window.showInputBox({
        password: true,
        ignoreFocusOut: true,
        prompt: 'Steer: paste the licence key — or the claim token from the purchase email (it binds the licences to this device)',
        placeHolder: 'the JWT from the site after checkout',
    });
    if (!jwt) { return; }
    await ingestEntitlement(context, jwt, 'manual');
}

// whoami: the tape's own fingerprint for the sidebar, from the script (the one place the identity is derived)
export function whoami(cwd: string): Promise<{ room: string; pubkey: string; fingerprint: string } | null> {
    return new Promise((res) => {
        let out = '';
        const c = doorCommand(cwd, FLOW, ['whoami', '--json']);
        if (!c.runnable) { res(null); return; }
        const child = spawn(c.file, c.args, { cwd, env: process.env });
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (code) => {
            if (code !== 0) { res(null); return; }
            try { const id = JSON.parse(out.trim().split('\n').pop() || 'null'); fingerprintCache = id?.fingerprint ?? null; res(id); } catch { res(null); }
        });
        child.on('error', () => res(null));
    });
}

// THE DEVICE DOOR — one spawn of the script, one reader (device-door.ts): the first JSON line names the URL to open, the last
// carries the entitlement. The JWT is read from the pipe and stored — it is never echoed, never written, never logged.
//   connect  → /device?user_code=…            [ 🔌 Connect ] (C75)
//   notarise → /notarise?fp=…&h=…&code=…      [ 💳 Fund Autonomy Ledger ] (C102a) — the keys land here, never pasted
async function deviceDoor(context: vscode.ExtensionContext, sub: 'connect' | 'notarise', title: string): Promise<void> {
    const cwd = root(); if (!cwd) { vscode.window.showErrorMessage('Steer: no workspace folder open.'); return; }
    ctx = context;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true },
        async (_p, cancel) => {
            const args = [sub, '--no-open', '--json'];
            const base = vscode.workspace.getConfiguration('vna').get<string>('authBase');
            if (base) { args.push('--base', base); }
            const c = doorCommand(cwd, FLOW, args);
            if (!c.runnable) { vscode.window.showWarningMessage(`Steer ${sub}: ${c.display}`); return; }
            const child = spawn(c.file, c.args, { cwd, env: process.env });
            cancel.onCancellationRequested(() => child.kill());
            const r = await readDeviceDoor(child, {
                openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
                store: context.secrets,   // this app's mirror — auth-flow.mjs connect|notarise already wrote the machine store (C173d)
                onEntitlement: async (claims, line) => {
                    jwtCache = null; claimsCache = claims;   // C173d: bearerEnv falls back to the mirror the reader just stored fingerprintCache = claims.pubkey_fingerprint; writeClaimsSnapshot(claimsCache);
                    vscode.window.showInformationMessage(`Steer: ${sub === 'notarise' ? 'keys landed' : 'connected'} — ${line ?? `${claims.credits} credits`}`);   // the script's runRowLabel, the one rule
                    await vscode.commands.executeCommand('vna.run.spec');   // repaint THE SECOND READER from the new claims — the card flips on the next render
                },
            });
            if (r.error) { vscode.window.showWarningMessage(`Steer ${sub}: ${r.error}`); return; }
            if (r.code !== 0 && !cancel.isCancellationRequested) { vscode.window.showWarningMessage(`Steer ${sub}: ${describeFailure(r.stderr, r.code)}`); }
        });
}
const connect = (context: vscode.ExtensionContext) => deviceDoor(context, 'connect', 'Steer: connecting this device — approve the user code on thetadriven.com…');
// 💳 Fund Autonomy Ledger (C102a): the device flow starts HERE; the browser opens /notarise for THIS tape; the entitlement arrives by
// the poll into SecretStorage with no user action after paying. vna.enterEntitlement (a paste) is the fallback under ⋮ only.
const notariseTape = (context: vscode.ExtensionContext) => deviceDoor(context, 'notarise', 'Steer: buying keys for this tape — sign in and pay on thetadriven.com/notarise; the key lands here by itself…');

async function disconnect(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(SECRET_KEY); clearClaimsSnapshot(claimsCache?.pubkey_fingerprint); claimsCache = null; jwtCache = null;
    const c = doorCommand(root(), FLOW, ['entitlement', '--clear', '--json']);   // C173d: the licence is the machine's — disconnect clears it for every IDE on it
    if (c.runnable) { await new Promise<void>((res) => { const ch = spawn(c.file, c.args, { cwd: root(), env: process.env }); ch.on('close', () => res()); ch.on('error', () => res()); }); }
    vscode.window.setStatusBarMessage('🔑 entitlement removed from the secret store', 5000);
    await vscode.commands.executeCommand('vna.run.spec');
}

export function registerAuthManager(context: vscode.ExtensionContext): void {
    ctx = context;
    const cwd = root();
    void loadEntitlement(context).then(() => { if (cwd) { void whoami(cwd); } });
    context.subscriptions.push(
        vscode.commands.registerCommand('vna.connect', () => connect(context)),
        vscode.commands.registerCommand('vna.notariseTape', () => notariseTape(context)),   // C102a — the 💳 runs THIS, never the upload (C105 DOOR_SEMANTICS)
        vscode.commands.registerCommand('vna.disconnect', () => disconnect(context)),
        // C83b — the fallback: manifest title pending (packages/thetacog-mcp-vscode/package.json is held by a live WIP
        // claim, see tests/vna/c83-return-door.test.mjs); the command is real and reachable from the Command Palette
        // by typing it today, and gets its "VNA: 🔑 Enter licence by hand (if the vscode:// return did not open)" title
        // the moment that claim releases.
        vscode.commands.registerCommand('vna.enterEntitlement', (text?: unknown) => enterByHand(context, text)),
        context.secrets.onDidChange((e) => { if (e.key === SECRET_KEY) { void loadEntitlement(context); } }),
    );
}
