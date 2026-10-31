# The keyring: where the JSON files go, what orders them, and which half is public

A deployer does not hold one licence forever. You buy more agent-years, a key is lost and
replaced, an old licence lapses, a second entity in your org gets its own. So the key
directory is a **series**, not a slot — and an app that picks "the key file" out of a
directory of five is picking by `readdir` order, which is filesystem order, which is
nothing.

This is the convention. It is enforced by `tests/license/keyring.test.mjs` in the
thetadrivencoach repo, and read by `scripts/license/keyring.mjs`.

## Where the files go

```
~/.thetacog/pmu/licenses/                     ← THE KEYRING. Outside every repo. Never in git.
  thetadriven-licence-<license_id>.json       ← one per licence. PRIVATE. mode 0600.
  sample-receipt-<license_id>.json            ← optional signed artifacts for testing a verifier
  public-keyring.json                         ← the PUBLIC half, signed by the authority
```

Nothing is written inside a repository, ever. The issuer
(`npx tsx scripts/license/issue-key.mts --email you@example.com`) writes to the home
directory at mode 0600 for one reason: a stray `git add -A` must not be able to commit a
private key. Confirm it on your own machine rather than trusting this page:

```
ls -l ~/.thetacog/pmu/licenses/          # -rw------- on every licence file
git check-ignore -v .env.local           # .gitignore:55
```

## What one file contains

```json
{
  "_readme": "…the seed_hex field at the bottom is a PRIVATE key…",
  "format": "thetadriven-licence-key/v1",
  "license_id": "lic_4031928265674445b3f559e7ee150e95",
  "holder_email": "you@example.com",
  "agent_years": 1,
  "minted_at": "2026-08-25T16:55:07.167Z",
  "pubkey_hex": "87c215ae…",
  "purpose": "production licence issued at checkout",
  "agent_key_derivation": "HKDF-SHA256(seed = seed_hex, salt = \"thetadriven-agent-v1\", info = agent_id)",
  "seed_hex": "…THE SECRET…"
}
```

`seed_hex` is the **last** field on purpose: truncate the file and you truncate the secret,
rather than being left with a plausible-looking header and half a key.

Everything above `seed_hex` is public and safe to hand to a verifier. One module renders
this file — `src/lib/license/keyfile.ts` — and both the browser download at `/license/<id>`
and the CLI issuer go through it, so a key collected at checkout and a key issued by hand
are the same object.

`purpose` is load-bearing. A key issued off-tape says so in that field
(`"NOT recorded on the licence tape, so entitlement will not verify"`), because a key that
verifies and a licence that is entitled are two different claims.

## The order is `minted_at`, ascending

**Never mtime.** Copying a keyring to a new machine rewrites every mtime and would silently
reorder the series. `minted_at` is a fact about the licence; mtime is a fact about the copy.

Ties break on `license_id`, so the ordering is total and reproducible on any machine.

A file with **no** `minted_at` sorts **first** and is flagged. Undated is older than dated —
guessing "now" for it would make it the current licence, which is the dangerous default.

**The current licence is the last one in that order.** A new purchase appends; it does not
replace. If the newest has lapsed, that is reported as lapsed — the reader never falls back
to an older live one, because "your licence lapsed" and "use the one from two years ago"
are different answers.

**Nothing is ever deleted from a keyring.** A revoked licence stays, marked. A receipt
signed under it last March is still a receipt somebody may verify next year, and its public
key has to remain resolvable.

```
node scripts/license/keyring.mjs             # the series, in order, current marked
node scripts/license/keyring.mjs --json      # machine-readable, with the unreadable files named
node scripts/license/keyring.mjs --current   # just the active licence id, for scripts
```

A file that will not parse is **reported, never skipped**. A keyring that silently drops
what it cannot read loses a licence and tells you everything is fine.

## The public half, published and signed

```
node scripts/license/keyring.mjs --publish
```

writes the public projection — `license_id`, `pubkey_hex`, `minted_at`, `agent_years`, and
nothing else — to `~/.thetacog/pmu/licenses/public-keyring.json` and to
`public/.well-known/thetadriven-licence-keys.json`, served at:

```
https://thetadriven.com/.well-known/thetadriven-licence-keys.json
```

No `seed_hex`. No `holder_email`. The test asserts both, because a secret in a file served
from `/.well-known/` is unrecoverable — it is on a CDN before anyone notices.

**The signature on the manifest is the point.** An unsigned list of public keys served over
HTTPS proves only that whoever controls the domain today served it. This manifest is sealed
by the **authority key** — the same key that signs every licence tape event — so an auditor
who has already pinned that key can check the manifest offline, and a substituted manifest
fails verification rather than quietly redirecting trust:

```
# swap one pubkey_hex in the manifest and re-verify
→ {"ok":false,"reason":"sha256 mismatch — body altered"}
```

## Using them in order, in an app

The sequence matters because receipts are dated. To attribute a receipt, resolve the key
that was current **at the receipt's own timestamp**, not the key that is current now:

1. read the keyring in `minted_at` order,
2. take the last licence minted **at or before** the receipt's `ts`,
3. verify the receipt against that licence's `pubkey_hex` — or, for an agent receipt,
   against `HKDF-SHA256(licence seed, salt="thetadriven-agent-v1", info=agent_id)`.

The hosted verifier does this for you and reports it as four independent claims:

```
curl -s -X POST https://thetadriven.com/api/receipt/verify \
  -H 'content-type: application/json' \
  -d @sample-receipt-<license_id>.json
```

`INTEGRITY` (are these the bytes that were signed) · `IDENTITY` (whose key, and does it
match the licence claimed) · `ENTITLEMENT` (was that licence live at the receipt's
timestamp) · `RECOMPUTABILITY` (re-derivable, or only attested). There is no root-level
`ok` in the response. A relying party that wants one bit computes it themselves, and in
doing so chooses which claim it is staking money on.

## What a verified receipt does not prove

The authority can re-derive any licence key. So identity proves a receipt is attributable
to a licence this authority issued and has not altered. It does **not** prove that the
buyer, and only the buyer, produced it. This is a custodial v1, stated at the top of
`src/lib/license/signing.ts` and not softened here.

And whether the agent behaved well is undecidable (Rice). Where it landed is provable and
re-runnable; whether it was right is not a claim anyone can make.
