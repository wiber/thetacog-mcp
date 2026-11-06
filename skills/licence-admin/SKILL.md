---
name: licence-admin
description: "The operator's licence desk from the Claude Code CLI: grant licence credits after a meeting, mint a claim link, move a grant to someone's personal email, revoke it, issue or revoke a licence key on the tape, list the keyring, see every claim link's status, and read the licence funnel and the paid funnel (who bought, who claimed, where they stop). Every command is `npx thetacog-mcp <door>`, dry run first. Triggers: '/licence-admin', '/license-admin', 'grant licences', 'grant licenses', 'mint credits', 'mint licences', 'mint a claim link', 'move a licence', 'move the licences to their personal email', 'revoke a licence', 'take the licences back', 'issue a key', 'revoke a key', 'the keyring', 'claim links', 'licence funnel', 'paid funnel', 'who bought', 'unit economics'."
---

# /licence-admin: the operator's licence desk

The install and the measurement are free and open-source (MIT); only the financialization/attestation layer is licensed. /licence is the buyer's side of that layer. This is the issuer's side: the credits ledger, the licence tape, the keyring and the funnels, run with the same code the operator runs at home. Every command is a door of the published package, `npx thetacog-mcp <door>`. If a door fails with "unknown command", the installed package is older than this skill: run `npx -y thetacog-mcp@latest skills` and try again.

**These doors need the operator's own keys.** Each one reads them from `.env.local` in the current folder, or from the environment. Without them a door prints one line naming what is missing, for example `grant: needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment) — operator-only`, and exits 2 having read and written nothing. Say that line back as it is. Never ask for a key in chat, and never put one on a command line.

## The rule for every door: dry first, live on his word

1. **Run it dry.** Every write door prints what it would do (`DRY-RUN (add --live)`) and writes nothing. Read that line back in one sentence: who, how many credits, which ref.
2. **Run it live only after the operator says so in this session**, for this action. A dry run he approved yesterday is not today's yes.
3. **Writing the production ledger or the tape, and sending email, are the operator's act.** The door does the write when he says go; the skill never arms one on its own, never retries a live write that failed, and never says "done" before the live output shows the row appended.
4. Every live grant action appends one row to `data/meetings/grant-actions.ndjson` in this folder and commits that row by itself. The output prints the commit sha. If there is no sha, the action did not happen.

## The doors

| what you want | door |
|---|---|
| who held a meeting, who has an address | `npx thetacog-mcp grant status` |
| mint licence credits to an email (default $100 = 5 licences) | `npx thetacog-mcp grant mint --account <email> [--usd <N>]` |
| one street licence for a reply (one per address, capped) | `npx thetacog-mcp grant mint --street --account <email>` |
| a claim link for someone known only by name | `npx thetacog-mcp grant link --who "<name>" [--usd <N>]` |
| move an unclaimed grant to another address | `npx thetacog-mcp grant move --from <email> --to <email> [--ref <grant ref>]` |
| take a grant back | `npx thetacog-mcp grant revoke --account <email> [--ref <grant ref>]` |
| an in-thread note through the send pipeline | `npx thetacog-mcp grant note --to <email> --subject "<thread subject>" --note "…"` |
| receipt a message already sent by Gmail | `npx thetacog-mcp grant sent --to <email> --id <message id> --what "…"` |
| put every meeting attendee on the book club | `npx thetacog-mcp grant enroll` |
| every claim link, latest first, with live status | `npx thetacog-mcp claim-links --no-open` |
| issue a licence key (local key file; `--tape` also records it) | `npx thetacog-mcp issue-key --email <email> [--company "<name>"] [--tape]` |
| is a licence minted or revoked on the tape | `npx thetacog-mcp revoke-key --license lic_<id> --status` |
| revoke a licence on the tape | `npx thetacog-mcp revoke-key --license lic_<id> --reason "…" [--replaced-by lic_<id>]` |
| the keyring, ordered by mint time | `npx thetacog-mcp keyring` |
| sign and write the public half of the keyring | `npx thetacog-mcp keyring --publish` |
| the licence funnel in one line (installs, fetches, bought, not ours) | `npx thetacog-mcp licence-funnel` |
| the paid funnel by stage, and the biggest drop | `npx thetacog-mcp paid-funnel --no-write` |
| what one $20 licence costs to serve | `npx thetacog-mcp licence-economics` |
| the whole licence flow end to end on a local database | `npx thetacog-mcp licence-e2e` |

The write doors take `--live` (grant) or write by design (issue-key, revoke-key without `--status`, keyring `--publish`). Those run only after his yes, as in the rule above.

## How to run it

1. **After a meeting, start with status.** `grant status` lists every held meeting and whether its row carries an address. The address is an operator fact from the calendar invite. If a row has none, ask for it in one line; never guess one.
2. **Mint.** `grant mint --account <email>` prints the dry run: credits, licences, and the ref `grant:operator:<date>:usd<N>:<licences>x10000:<email>`. $20 is one licence, 10,000 credits, and `--usd` must be whole licences. A grant carries no Stripe session, so it never reads as a sale, and the ref makes a re-run a no-op. `ALREADY ON RECORD` means the same ref landed earlier: the balance is right and nothing doubled.
3. **Name-only people get a link.** `grant link --who "<name>"` dry prints the amount. Live, it prints the URL once and keeps the token in the folder's gitignored `.thetacog/claim-links.local.ndjson`; the committed receipt keeps only its sha256. The first email to sign in on the link takes the grant.
4. **Move or revoke.** Both read the ledger even when dry, so the dry run already shows exactly what they would take. A move works on an unclaimed grant only. A revoke touches grant refs only, never a purchase, and after a claim it claws back at most what the key still holds.
5. **Notes go through the pipeline, never the Gmail connector.** `grant note` runs the personal-followup gates dry; `--live` sends, receipts and commits. A message already sent by the connector gets its receipt late with `grant sent`. Both need the thetadrivencoach checkout as the current folder, because the send pipeline does not ship in the package.
6. **Keys.** `issue-key` writes a key file at mode 0600 into the keyring (`.thetacog/pmu/licenses` in the folder, else `~/.thetacog/pmu/licenses`) and prints only the public half. Without `--tape` the file says it is NOT recorded on the tape, and the licence will not verify as entitled. `revoke-key --status` reads the tape; a revoke appends one signed `LICENSE_REVOKED` row, and every verifier refuses that licence from then on. Both run the checkout's own TypeScript signer under its `tsx`, so they need the thetadrivencoach checkout as the current folder.
7. **Who bought.** `licence-funnel` prints one line: installs, npm fetches (not people), licences bought, bought by a key not this host's, bought by someone not us, the door arrivals. Every reading is MEASURED or UNMEASURED with its reason, never a zero standing in for no data. `paid-funnel --no-write` breaks it into stages (signups, replies, granted, claimed, stamped, paid) and names the biggest drop and who owns that stage.

## What this is sufficient for, and what it is not

It answers what the ledger and the tape hold, what one action would write before it writes it, and where people stop on the way to a paid licence, all read off the record each stage writes. It does not say why any one person stopped (that is a conversation, not a row), it does not judge whether the work under a licence was good (undecidable, Rice 1953), and it never moves money: a grant is a comp on the ledger, and payment is the buyer's own act, on the site.
