#!/usr/bin/env node
// scripts/vna/backup-trials.mjs — the backup pages' usability trials (operator 2026-10-14, /goal: "run the trials for the employer
// side for the regulation insurance side … accurately serving landing pages that represent us well to both … send one version to
// email for each one of the dozen trials … simulate a walk-through by usability trial for that person").
//
// Each trial is one person on one journey. The journey's pages are captured as a VISITOR sees them: Playwright at 390 px, the
// rendered innerText (a closed + stays closed, so explanations behind a pill are not read), and a screenshot of each page's first
// screen. Two cold Sonnet readers then read the journey AS that person through scripts/comms/cold-read.mjs (no repo, no tools,
// weaker than the writer), and the trial is mailed to the operator: who, the journey, the readers' verdicts, the screenshots and
// the page text as .txt. One subject for the whole run (the one-conversation rule); the trial rides in the preheader.
//
//   node scripts/vna/backup-trials.mjs [--base https://thetadriven.com] [--only T01,T06] [--n 2] [--conc 4] [--no-mail]
//   → .thetacog/backup-trials/<run>/<id>/{journey.txt, context.txt, journey.txt.coldread.json, p<k>.png, mail.html}
//   → .thetacog/backup-trials/<run>/summary.json
//
// Orchestration only (transport, spawning, mail): node, never a decision the page makes. LLM-free in every number it prints:
// the verdicts are the readers' own JSON, quoted, never re-scored here.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://thetadriven.com');
const N = Number(arg('--n', 2));
const CONC = Number(arg('--conc', 4));
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean);
const MAIL = !process.argv.includes('--no-mail');
const PUB = '/risk/3f0bc417daa3';

const SELLING = 'What ThetaDriven sells: the install and the measurement are free and open-source (MIT); only the attestation and underwriting layer is licensed. The promise is "this invoice comes with a steering wheel": the health check is your grip on that wheel — a record of where your agents\' work landed against a scope declared before it ran, read by something the agents did not write, that anyone can recompute. It never claims the work was good (that is undecidable) and never claims to stop or contain an agent.';
const READ = 'You are reading the web pages below in the order you clicked through them, on your phone, as the person described. Only the text a visitor sees is shown (sections behind a + are closed). In "missing", name where you got stuck, what you could not find, and what you would click next or whether you would leave.';

// the dozen — the deployer/employer side, the insurance/regulation side, and the doors between them
export const TRIALS = [
  { id: 'T01', who: 'Deployer, fresh from the IDE', side: 'deployer', path: ['/backup', '/backup/adherence?tab=deployer'],
    person: 'A senior engineer who just pressed "Countersign (backup)" in the ThetaCog VS Code extension after a week of agent-assisted coding. Anxious: did it work, did my code leave the machine, what does it say about me.', job: 'See your grip: where your agents\' work landed and the one lever that tightens it.' },
  { id: 'T02', who: 'Deployer sharing with the carrier', side: 'deployer', path: [PUB],
    person: 'The same engineer, now deciding whether to send this link to the company\'s insurance broker. Worried it makes the team look bad.', job: 'Know what the broker will see, and feel safe sending it.' },
  { id: 'T03', who: 'Developer installing it locally', side: 'deployer', path: ['/backup', '/backup/how'],
    person: 'A developer who saw the extension on the VS Code Marketplace and wants to run it locally before telling anyone. Wants the exact first command and what stays on the machine.', job: 'Install and take a first backup without help.' },
  { id: 'T04', who: 'Engineering lead, cold', side: 'deployer', path: ['/backup'],
    person: 'A VP of engineering who clicked a link in a talk. Has seen ten "AI governance dashboards". Skims for 30 seconds.', job: 'Recognise the problem and pick where to go next.' },
  { id: 'T05', who: 'Employer who signs for the agents (CFO)', side: 'deployer', path: ['/backup', '/pricing'],
    person: 'The CFO of a 300-person company that deploys AI agents; signs the insurance renewal and the vendor budget. Not technical.', job: 'Understand what the record lets the company show its insurer and what it costs.' },
  { id: 'T06', who: 'Underwriter handed a link', side: 'insurance', path: [PUB],
    person: 'A cyber underwriter at a specialty carrier. An insured sent this link with "this is our AI development record". Must decide whether the AI exposure can be priced or must be excluded (ISO CG 40 47 is already in the forms).', job: 'Decide whether this tail can be priced against a limit declared before the work ran, and what to ask for.' },
  { id: 'T07', who: 'Carrier innovation lead, cold email', side: 'insurance', path: ['/curve'],
    person: 'Head of innovation at a large carrier, opened a cold email that said "the default curve for pricing AI agent work". Zero context, suspects a staging prototype.', job: 'Decide if this is a real exposure base worth a reply about the pool.' },
  { id: 'T08', who: 'Wholesale broker', side: 'insurance', path: [PUB, '/backup/how'],
    person: 'A wholesale broker placing a tech E&O risk with an AI exclusion problem. Needs something to put in front of markets.', job: 'Know what to request from the insured and how to present it to carriers.' },
  { id: 'T09', who: 'Actuary doing diligence', side: 'insurance', path: ['/backup/adherence?tab=insurer'],
    person: 'A pricing actuary asked whether this data could support a rate. Looks for sample sizes, nulls, selection effects and sleight of hand.', job: 'Check whether every number is recomputable and honestly bounded.' },
  { id: 'T10', who: 'General counsel', side: 'regulation', path: ['/backup/how'],
    person: 'General counsel at a company deploying agents, asked to sign off on an attestation vendor. Cares what is proven, what is not, who holds keys, retention.', job: 'Know exactly what this record proves and refuses to prove, and who holds the keys.' },
  { id: 'T11', who: 'Regulator / compliance officer', side: 'regulation', path: ['/backup', '/backup/how'],
    person: 'A compliance officer preparing for EU AI Act and state AI rules, checking whether a vendor\'s claims are defensible or overclaim control of AI.', job: 'Judge whether the claims are defensible and what evidence they would hand an auditor.' },
  { id: 'T12', who: 'Allocator / investor diligence', side: 'regulation', path: ['/backup', '/backup/how'],
    person: 'An analyst at a fund doing diligence on ThetaDriven. Asks: is there a business, what is stored where, what fails how.', job: 'Decide whether the product and its custody story hold up.' },
];

async function capture(trial, dir, browser) {
  const out = [];
  for (const [k, p] of trial.path.entries()) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    try {
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(1500);
      const text = await page.evaluate(() => { const m = document.querySelector('main') || document.body; return m.innerText; });
      await page.screenshot({ path: join(dir, `p${k + 1}.png`) });
      out.push({ url: BASE + p, text: text.replace(/\n{3,}/g, '\n\n').trim() });
    } catch (e) { out.push({ url: BASE + p, text: `PAGE DID NOT LOAD: ${e.message.split('\n')[0]}` }); }
    await page.close();
  }
  return out;
}

const run1 = (cmd, args) => new Promise((ok) => { const c = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => ok({ code, out: o })); });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mailHtml(trial, pages, receipt, runId) {
  const reads = receipt?.rounds?.[0]?.reads || [];
  const rows = reads.map((r, i) => { const j = r.json || r.read || r; return `<h3>Reader ${i + 1} — ${esc(j.verdict)} · confidence ${esc(j.confidence)}</h3><p><b>What landed:</b> ${esc(j.lands)}</p><p><b>What they had to hear:</b> ${esc(j.needToHear)}</p><p><b>Missing / stuck:</b></p><ul>${(j.missing || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p><b>Read as template:</b> ${esc((j.generic || []).join(' · '))}</p>`; }).join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:680px"><p style="color:#666">${esc(runId)} · ${esc(trial.id)} · ${esc(trial.side)} side</p><h2>${esc(trial.id)} — ${esc(trial.who)}</h2><p><b>Who:</b> ${esc(trial.person)}</p><p><b>The job the pages must do for them:</b> ${esc(trial.job)}</p><p><b>Journey (390 px, as served):</b> ${trial.path.map((p) => `<a href="${esc(BASE + p)}">${esc(p)}</a>`).join(' → ')}</p>${rows || '<p>No reader verdict came back (see the receipt).</p>'}<p style="color:#666">Attached: each page's first screen (p1.png …), the page text the readers saw (journey.txt) and the receipt (.coldread.json, also as .txt).</p></div>`;
}

async function main() {
  const runId = `backup-trials-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const root = join(REPO, '.thetacog/backup-trials', runId); mkdirSync(root, { recursive: true });
  const trials = TRIALS.filter((t) => !ONLY.length || ONLY.includes(t.id));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const caps = {};
  for (const t of trials) { const d = join(root, t.id); mkdirSync(d, { recursive: true }); caps[t.id] = await capture(t, d, browser); }
  await browser.close();
  // readers: bounded concurrency across trials, never a sequential await over model calls
  const queue = [...trials]; const results = {};
  const worker = async () => { while (queue.length) { const t = queue.shift(); const d = join(root, t.id);
    writeFileSync(join(d, 'journey.txt'), caps[t.id].map((p, i) => `===== PAGE ${i + 1}: ${p.url} =====\n${p.text}`).join('\n\n') + '\n');
    writeFileSync(join(d, 'context.txt'), `${t.person}\n\nWhat you came to do: ${t.job}\n\nFor reference, what the company says it sells (you have NOT been told this; judge whether the pages convey it): ${SELLING}\n\n${READ}\n`);
    const r = await run1('node', ['scripts/comms/cold-read.mjs', '--draft', join(d, 'journey.txt'), '--context', join(d, 'context.txt'), '--n', String(N), '--max-turns', '2', '--timeout-ms', '240000']);
    const rp = join(d, 'journey.txt.coldread.json'); results[t.id] = { code: r.code, tail: r.out.trim().split('\n').pop(), receipt: existsSync(rp) ? JSON.parse(readFileSync(rp, 'utf8')) : null };
    console.log(`${t.id} ${t.who}: ${results[t.id].tail}`); } };
  await Promise.all(Array.from({ length: Math.min(CONC, trials.length) }, worker));
  const subject = `Backup page trials — ${new Date().toISOString().slice(0, 10)}`;
  const summary = [];
  for (const t of trials) { const d = join(root, t.id); const rec = results[t.id].receipt; const reads = rec?.rounds?.[0]?.reads || [];
    const vs = reads.map((r) => (r.json || r.read || r)); summary.push({ id: t.id, who: t.who, side: t.side, path: t.path, verdicts: vs.map((v) => v.verdict), confidence: vs.map((v) => v.confidence) });
    const html = mailHtml(t, caps[t.id], rec, runId); writeFileSync(join(d, 'mail.html'), html);
    if (rec) writeFileSync(join(d, 'coldread.txt'), JSON.stringify(rec, null, 2));
    if (!MAIL) continue;
    const attach = [...t.path.map((_, k) => join(d, `p${k + 1}.png`)).filter(existsSync), join(d, 'journey.txt'), ...(rec ? [join(d, 'coldread.txt')] : [])].flatMap((p) => ['--attach', p]);
    const m = await run1('node', ['scripts/email-artifact.mjs', '--html', join(d, 'mail.html'), '--to', 'elias@thetadriven.com', '--subject', subject, '--preheader', `${t.id} · ${t.who} · ${vs.map((v) => v.verdict).join('/') || 'no verdict'}`, '--class', 'auto', ...attach]);
    console.log(`${t.id} mail: ${m.code === 0 ? 'sent' : 'FAILED ' + m.out.trim().split('\n').pop()}`); }
  writeFileSync(join(root, 'summary.json'), JSON.stringify({ runId, base: BASE, summary }, null, 2) + '\n');
  console.log(`summary → ${join(root, 'summary.json')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
