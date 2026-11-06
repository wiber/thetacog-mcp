---
name: licence
description: "Manage your ThetaCog licence from the Claude Code CLI, the same doors the extension's 🔑 pills open: connect this machine and buy credits (login and payment happen on thetadriven.com), paste a licence key, see which licence this machine holds, sign a commit under it, back up the tape for countersigning, and disconnect. Every command is `npx thetacog-mcp <door>`. Triggers: '/licence', '/license', 'licence', 'license', 'buy credits', 'connect my licence', 'paste my licence key', 'which licence do I have', 'am I licensed', 'sign this commit', 'countersign', 'back up the tape', 'disconnect the licence'."
---

# /licence — your licence, from the CLI

The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed. This skill runs that licensed layer from a terminal, with the same doors the ThetaCog extension's 🔑 pills open. Every command is a door of the published package, `npx thetacog-mcp <door>`, so it works in any folder. If a door below fails with "unknown command", the installed package is older than this skill: run `npx -y thetacog-mcp@latest skills` and try again.

**Login, payment and the licence itself happen on thetadriven.com, never in this terminal.** This skill opens the page, waits for the site, and checks what comes back. `auth-flow connect` and `auth-flow notarise` contact thetadriven.com and wait up to 10 minutes for the site to answer; every other door here runs on this machine alone. It never asks for a card, a password or a key in chat.

**The device key is this machine's own signing key, kept in the keychain; it is the key a licence is bound to.** `whoami` below only reads it — it never creates one, so asking for your identity never touches the keychain. Only a door that connects, buys, pastes a key or signs something mints a device key if this machine does not already hold one.

## The doors

| what you want | door |
|---|---|
| which licence this machine holds (credits, account, expiry) | `npx thetacog-mcp auth-flow entitlement` |
| this machine's identity (the key the licence binds to) | `npx thetacog-mcp auth-flow whoami` |
| connect this machine / buy credits (opens the site, then waits) | `npx thetacog-mcp auth-flow connect` |
| fund a notarisation of the tape (the 💳) | `npx thetacog-mcp auth-flow notarise` |
| paste a licence key by hand (the key rides stdin, never argv) | `pbpaste \| npx thetacog-mcp auth-flow verify --jwt -` |
| sign a commit under the licence | `npx thetacog-mcp auth-flow sign --sha HEAD` |
| check a signed row's licence stamp | `npx thetacog-mcp auth-flow verify-licence --row - < row.json` |
| back up the tape for countersigning (bundle, then the /backup URL) | `npx thetacog-mcp backup` |
| check a licence tape offline (signatures, hash chain, one signer; refuses a revoked licence) | `npx thetacog-mcp verify-license --tape tape.json [--license lic_<id>]` |
| countersign a receipt as deployer or insurer, then check the circle | `npx thetacog-mcp attest-countersign sign --receipt r.json --role deployer --as "<name>"` · `npx thetacog-mcp attest-countersign circle --receipt r.json` |
| disconnect this machine | `npx thetacog-mcp auth-flow entitlement --clear` |
| are the skills installed, which versions (the debug page) | `npx thetacog-mcp skills --debug` |

Add `--json` to any `auth-flow` door for a machine-readable answer.

## How to run it

1. **Start with status.** Run `auth-flow entitlement` and say what it printed in one line: the credits, the account, the expiry, or "no licence on this machine". Most asks end here.
2. **Connect or buy.** Run `auth-flow connect`. It prints `open <url>` and opens the browser; tell the person the page is open and that login and payment happen there. The command contacts thetadriven.com and waits up to 10 minutes for the site; it stores the licence on this machine when it arrives, and stops with a plain line if ten minutes pass first. `auth-flow notarise` contacts the site and waits the same way. Then run step 1 again and report the new line.
3. **A key they already have.** If they paste a key in chat, do not echo it back and do not put it on a command line. Have them copy it, then run `pbpaste | npx thetacog-mcp auth-flow verify --jwt -` (on Linux, `xclip -o`; on Windows, `powershell Get-Clipboard`). A `refused — <reason>` line is the answer; say the reason plainly.
4. **Sign or countersign.** `auth-flow sign --sha <commit>` signs a commit with this machine's key and stamps the licence into the row. Without a licence the row is still signed, and the output says it is UNLICENSED. `backup` bundles the tape into one archive named by its own sha256 and prints the thetadriven.com/backup URL. Uploading happens on that page, never from here. `verify-license --tape <file>` checks a licence tape on this machine with no network call: every signature, the hash chain, and that one authority signed it all. With `--license` it also checks that licence was minted, and it fails, saying so, if the tape carries a `LICENSE_REVOKED` row for it. `attest-countersign sign` adds the deployer's or the insurer's endorsement to a receipt file, and `attest-countersign circle` says whether the circle is closed.
5. **Disconnect** only when they ask for it, with `auth-flow entitlement --clear`, and say that the licence left this machine's store.

## What this is sufficient for, and what it is not

It answers which licence this machine holds, whether a key verifies against the site's own public key, and whether a row carries a valid licence stamp: signature, fingerprint, claims and expiry, all checked locally. It does not judge whether the work under the licence was good (undecidable, Rice 1953), and it never moves money: payment is the person's own act, on the site.
