// packages/thetacog-mcp-vscode/src/landing-address.ts — C663 THE LINK YOU SHARE, named once.
//
// Operator 2026-10-05, verbatim: "Just make sure that we bump the VSX link to it as well. Maybe it's a redirect … Maybe it's the
// page that we share with people that needs to look right that's the landing page". A cold reader playing Paul read
// "thetadriven.com/backup/curve" as a staging link, so the address a person is handed is the short one, /curve, and the site
// redirects it (src/app/curve/route.ts) to the page that renders it. The site and the extension both import THIS file — the site
// by relative path (Next compiles TS anywhere under the project root), the extension as its own module — so the two can never
// name different landing addresses. Pure: no import, no vscode, nothing that runs.
//
// VERIFY WITHOUT RUNNING ANYTHING (forwarded review, verbatim: "Asking insurance carriers, actuaries, or enterprise risk people to run
// a blind npx command from an email is a massive cybersecurity red flag … view the cryptographically signed output of the exact same
// run"): HOSTED_RUN is a GitHub Actions workflow in the PUBLIC meter repo (wiber/thetacog-mcp, .github/workflows/recompute-the-curve.yml)
// that, on a schedule, downloads the published dataset and its reference script from this site, recomputes the figure, and attaches
// the log, the sha256 of every input, and a signed build-provenance attestation. The npx line stays, second, as "or run it yourself".
// @guard tests/vna/c663-the-link-you-share.test.mjs
export const LANDING_ORIGIN = 'https://thetadriven.com';
export const CURVE_PATH = '/curve';                 // the short address a person is handed
export const CURVE_TARGET = '/backup/curve';        // the page that renders it (one page, one renderer)
export const HOLDER_PATH = '/backup';               // a holder's own landing (C651), behind sign-in
export const SHARE_PREFIX = '/risk/';               // a holder's read-only share link: /risk/<pseudonym> (the existing route)
export const CURVE_LANDING = `${LANDING_ORIGIN}${CURVE_PATH}`;
export const HOLDER_LANDING = `${LANDING_ORIGIN}${HOLDER_PATH}`;
export const shareLink = (pseudonym: string): string => `${LANDING_ORIGIN}${SHARE_PREFIX}${encodeURIComponent(pseudonym)}`;

export const HOSTED_RUN_REPO = 'wiber/thetacog-mcp';
export const HOSTED_RUN_WORKFLOW = '.github/workflows/recompute-the-curve.yml';
export const HOSTED_RUN_URL = `https://github.com/${HOSTED_RUN_REPO}/actions/workflows/recompute-the-curve.yml`;
export const RUN_IT_YOURSELF = 'npx -y thetacog-mcp@latest loss-run';   // the drafts: the same measurement over the reader's OWN agent logs
// The page: the very recompute the hosted run does, over the published dataset (the /backup/curve guard bans the loss-run CLI on that
// page — tests/vna/c646 — so the page's run-it-yourself line is this one).
export const RECOMPUTE_YOURSELF = 'python3 actuarial-dataset.py actuarial-dataset.csv';
// The two-way sentence every draft that shows the npx line carries, word for word, before that line; in a draft "view the run" is the
// link to HOSTED_RUN_URL (C663.5 checks the href beside the words).
export const TWO_WAY = "You don't have to run anything: view the run, a third party's scheduled recompute of this figure with its log and sha256 attached. Or run it yourself:";
