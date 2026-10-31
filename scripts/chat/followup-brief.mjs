#!/usr/bin/env node
/**
 * followup-brief — who is owed a reply, ranked by arithmetic, emailed once a day.
 *
 * ZERO LLM, AND THAT IS THE POINT, NOT A LIMITATION. Every line below is a fact about the spine:
 * they spoke at T_in, we spoke at T_out, T_in > T_out, that was N days ago. No classifier decides
 * whether a message "deserves" an answer, because that judgement is exactly the undecidable half
 * — and a ranker that guesses it produces a list you stop trusting after the third wrong call.
 * This produces a list you can argue with by looking at the same two timestamps.
 *
 * THE THREE STATES, and why the third is the honest one:
 *
 *   OWED     last_in > last_out. They spoke last and we never came back. This is a DEBT, so it
 *            ranks HIGHER as it ages, not lower — a 30-day unanswered message is worse than a
 *            2-day one, and every "recency" ranking gets this exactly backwards.
 *
 *   WAITING  last_out > last_in, and they have replied before. We are mid-exchange with the ball
 *            in their court. Nothing is owed until the follow-up window (7d) has passed.
 *
 *   COLD     no inbound record at all. Ranked under the node TTL protocol — 3 structured attempts,
 *            then logged dead for this cycle with zero emotional weight, and never the same
 *            (node, key, vector) triple twice.
 *
 * AND THE CAVEAT THAT OUTRANKS ALL THREE: COLD IS ONLY AS TRUE AS THE MIRROR CAN SEE. A channel
 * with no inbound feed reads 0-in/N-out whether they ignored us or replied warmly last Tuesday;
 * a stale mirror does the same thing for a shorter window. So the brief LEADS with its cutoffs,
 * and any channel that cannot see inbound is marked BLIND with its COLD rows called unprovable
 * rather than presented as silence. An absence in a stale mirror is a cutoff, not silence — and
 * a ranking that forgets this manufactures ghosts. Blindness is DERIVED per run (seesInbound),
 * so the label disappears by itself the day a feed starts arriving, and appears again if one dies.
 *
 *   node scripts/chat/followup-brief.mjs                # rank + print
 *   node scripts/chat/followup-brief.mjs --email        # rank + print + email the operator
 *   node scripts/chat/followup-brief.mjs --json --top 40
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSqlite } from '../lib/sqlite-lazy.mjs';
import { openDb, cutoffs, stats } from './messages-db.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CONTACTS = path.join(REPO, 'data/contacts/contacts.sqlite');
const DAY = 86400;

/**
 * Which channels can see inbound at all — DERIVED, never declared. A channel that cannot see
 * inbound can never prove a silence, so this flag decides whether a COLD row means "they ignored
 * us" or merely "we have no way of knowing". Email is blind until the Gmail connector is
 * authorised, and hardcoding either answer means the brief lies on exactly the day that changes:
 * blind-forever hides real replies once they arrive, sighted-always invents silences before they.
 * So: a channel sees inbound if the spine actually holds inbound rows for it.
 */
export function seesInbound(db) {
  const seen = { whatsapp: false, imessage: false, email: false };
  for (const r of db.prepare(
    `SELECT channel, COUNT(*) n FROM messages WHERE direction='in' GROUP BY channel`).all()) {
    seen[r.channel] = r.n > 0;
  }
  return seen;
}

const FOLLOWUP_WINDOW_D = 7;   // mid-exchange grace before "we are waiting" becomes "chase it"
const NODE_TTL = 3;            // structured attempts per node before it is dead this cycle

// ── identity ────────────────────────────────────────────────────────────────────────────────
/**
 * A phone number in a brief is useless. Resolve it to a human, or say we could not.
 *
 * Exported because contact-sweep.mjs needs the SAME resolution to collapse one human's several
 * threads into one row. Two copies of this would drift into two different ideas of who a person
 * is, and the two instruments would then disagree about a name while both looked correct.
 */
export function contactIndex() {
  if (!fs.existsSync(CONTACTS)) return new Map();
  const db = openSqlite(CONTACTS, { readonly: true });
  const m = new Map();
  const add = (k, v) => { if (k) m.set(String(k).toLowerCase().replace(/[^\d a-z@.+]/g, ''), v); };
  for (const r of db.prepare(`SELECT c.name, c.org, c.job_title, p.phone FROM contacts c
      JOIN contact_phones p ON p.contact_id = c.id`).all()) {
    add(String(r.phone).replace(/\D/g, '').slice(-10), r);
  }
  for (const r of db.prepare(`SELECT c.name, c.org, c.job_title, e.email FROM contacts c
      JOIN contact_emails e ON e.contact_id = c.id`).all()) add(r.email, r);
  db.close();
  return m;
}

export function resolveHandle(idx, handle) {
  if (!handle) return null;
  const s = String(handle).toLowerCase();
  if (s.includes('@')) return idx.get(s) || null;
  const d = s.replace(/\D/g, '');
  return d.length >= 10 ? idx.get(d.slice(-10)) || null : null;
}

// ── the ranking ─────────────────────────────────────────────────────────────────────────────
/**
 * Pure arithmetic over two timestamps and a count. Exported so the guard can assert the
 * orderings that matter rather than eyeballing a rendered list.
 */
export function scoreThread(t, now, { known = false } = {}) {
  const dIn = t.last_in_ts ? (now - t.last_in_ts) / DAY : null;
  const dOut = t.last_out_ts ? (now - t.last_out_ts) / DAY : null;

  let state, score, why;
  if (t.last_in_ts && (!t.last_out_ts || t.last_in_ts > t.last_out_ts)) {
    state = 'OWED';
    // A debt ages UPWARD. Capped at 45d so a two-year-old thread cannot outrank this week's.
    score = 120 + Math.min(dIn, 45);
    why = `they spoke ${fmtDays(dIn)} ago, we never came back`;
  } else if (t.n_in > 0) {
    state = 'WAITING';
    score = dOut >= FOLLOWUP_WINDOW_D ? 60 + Math.min(dOut, 45) / 2 : 0;
    why = dOut >= FOLLOWUP_WINDOW_D
      ? `we wrote ${fmtDays(dOut)} ago, no reply since`
      : `mid-exchange, ${fmtDays(FOLLOWUP_WINDOW_D - dOut)} of grace left`;
  } else {
    state = 'COLD';
    const attempts = t.n_out || 0;
    // Node TTL: three structured attempts, then dead for this cycle. Not a judgement — a budget.
    score = (attempts < NODE_TTL && dOut >= FOLLOWUP_WINDOW_D) ? 40 - attempts * 10 : 0;
    // "we have hit them 22 times with automation and never once by hand" is a finding, not noise.
    const blasts = t.n_out_auto ? `, ${t.n_out_auto} automated` : '';
    why = attempts >= NODE_TTL
      ? `${attempts} attempts${blasts}, no inbound record — dead this cycle, rotate key or vector`
      : attempts === 0
        ? `never written to by hand${blasts || ', no contact at all'}`
        : `${attempts} attempt${attempts === 1 ? '' : 's'}${blasts}, last ${fmtDays(dOut)} ago`;
  }

  if (t.is_group) score *= 0.35;          // groups are raised-hands' job, not a 1:1 follow-up

  // A ZERO IS A REFUSAL, NOT A LOW SCORE — and the bonus must not overturn it.
  // Every branch above spends a zero deliberately: the node's 3-attempt TTL is gone, or we are
  // inside the grace window on purpose. `rank()` drops score<=0 precisely to honour that. Adding
  // the known-contact bonus unconditionally put those rows back at 15 and straight past the
  // filter — measured 2026-09-07 on the live spine, 33 of 627 ranked rows scored exactly 15 and
  // ALL 33 were zeroed nodes, most carrying the words "dead this cycle, rotate key or vector" in
  // the very `why` string printed beside them. A row arguing with its own explanation is the
  // tell. The bonus says "this action is actionable", which cannot be true of an action we just
  // declined to take, so it applies only where an action survived.
  if (known && score > 0) score += 15;
  return { state, score: Math.round(score * 10) / 10, why, daysIn: dIn, daysOut: dOut };
}

const fmtDays = (d) => (d == null ? '—' : d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`);

export function rank(db, { now = Math.floor(Date.now() / 1000), top = 25 } = {}) {
  const idx = contactIndex();
  const sighted = seesInbound(db);
  const rows = db.prepare('SELECT * FROM threads').all();
  const scored = rows.map((t) => {
    const who = resolveHandle(idx, t.handle) || resolveHandle(idx, t.name);
    const s = scoreThread(t, now, { known: !!who });
    return {
      ...s,
      thread_id: t.id, channel: t.channel, is_group: !!t.is_group,
      name: who?.name || t.name || t.handle,
      org: who?.org || null, title: who?.job_title || null,
      handle: t.handle, n_in: t.n_in, n_out: t.n_out,
      blind: !sighted[t.channel],
    };
  }).filter((r) => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, top);
}

/** The last inbound line, so the brief shows WHAT is owed, not merely that something is. */
export function lastInbound(db, threadId) {
  return db.prepare(
    `SELECT body, ts, sender FROM messages WHERE thread_id=? AND direction='in' ORDER BY ts DESC LIMIT 1`
  ).get(threadId) || null;
}

// ── render ──────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const STATE_COLOR = { OWED: '#b91c1c', WAITING: '#b45309', COLD: '#475569' };

function renderHtml(items, cuts, st, db) {
  const blindChannels = Object.entries(seesInbound(db)).filter(([, v]) => !v).map(([k]) => k);
  const stale = cuts.filter((c) => !c.ok);

  const cutRows = cuts.map((c) => `<tr>
    <td>${c.ok ? '✓' : '✗'}</td><td><b>${esc(c.source)}</b></td>
    <td>${c.cutoff_ts ? new Date(c.cutoff_ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
    <td>${c.cutoffAgeMin == null ? '?' : c.cutoffAgeMin + 'm'} old</td>
    <td style="color:#64748b">${esc(c.note || '')}</td></tr>`).join('');

  const rows = items.map((r, i) => {
    const last = r.state === 'OWED' ? lastInbound(db, r.thread_id) : null;
    return `<tr>
      <td style="color:#94a3b8">${i + 1}</td>
      <td><b>${esc(r.name)}</b>${r.org ? `<br><span style="color:#64748b;font-size:12px">${esc(r.title ? r.title + ' · ' : '')}${esc(r.org)}</span>` : ''}</td>
      <td>${esc(r.channel)}${r.is_group ? ' <span style="color:#94a3b8">(group)</span>' : ''}</td>
      <td><b style="color:${STATE_COLOR[r.state]}">${r.state}</b>${r.blind ? ' <span style="color:#94a3b8" title="channel cannot see inbound">BLIND</span>' : ''}</td>
      <td>${esc(r.why)}</td>
      <td style="text-align:right;color:#475569">${r.score}</td>
    </tr>${last ? `<tr><td></td><td colspan="5" style="color:#334155;font-style:italic;padding-bottom:10px;border-bottom:1px solid #e2e8f0">“${esc(last.body.slice(0, 240))}”</td></tr>` : ''}`;
  }).join('');

  return `<!doctype html><meta charset="utf-8">
<div style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:820px;margin:0 auto;padding:24px">
<h1 style="font-size:22px;margin:0 0 4px">Follow-up brief</h1>
<p style="color:#64748b;margin:0 0 20px">${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${st.total.toLocaleString()} messages · ${st.threads.toLocaleString()} threads · ranked by arithmetic, no model in this path</p>

<div style="background:#fef2f2;border-left:3px solid #b91c1c;padding:12px 16px;margin:0 0 20px">
<b>What this list cannot see.</b> ${blindChannels.length ? `<b>${blindChannels.join(', ')}</b> ${blindChannels.length === 1 ? 'has' : 'have'} no inbound mirror — a thread there reads 0&nbsp;in&nbsp;/&nbsp;N&nbsp;out whether they ignored you or replied warmly last week. Those rows are marked BLIND and their silence is <i>unprovable</i>, not established. Fix: <code>node packages/thetacog-mcp/gmail-sync.js --auth</code>, once. ` : ''}${stale.length ? `<b>${stale.length} source${stale.length === 1 ? '' : 's'} stale or failed</b> — see the cutoff table; an absence inside a frozen window is a cutoff, not silence.` : ''}
</div>

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 24px">
<tr style="text-align:left;color:#64748b"><th></th><th>source</th><th>sees up to</th><th>age</th><th></th></tr>
${cutRows}</table>

<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="text-align:left;color:#64748b;border-bottom:2px solid #cbd5e1">
<th></th><th>who</th><th>channel</th><th>state</th><th>why</th><th style="text-align:right">score</th></tr>
${rows}</table>

<p style="color:#64748b;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">
OWED ranks <i>upward</i> with age — an unanswered message gets worse, not less relevant.
WAITING holds ${FOLLOWUP_WINDOW_D}d of grace mid-exchange. COLD spends a ${NODE_TTL}-attempt budget per node,
then logs dead for this cycle: rotate the key or the vector, never re-run the same triple.
Send with <code>scripts/chat/transport.mjs</code> — iMessage is a real transport, WhatsApp is verified GUI puppetry.
</p></div>`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const topArg = argv.indexOf('--top');
  const top = topArg > -1 ? Number(argv[topArg + 1]) : 25;

  const db = openDb();
  const items = rank(db, { top });
  const cuts = cutoffs(db);
  const st = stats(db);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), cutoffs: cuts, items }, null, 2));
  } else {
    console.log(`\n📋 follow-up brief · ${st.total.toLocaleString()} messages · ${st.threads.toLocaleString()} threads\n`);
    for (const c of cuts) {
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.source.padEnd(14)} sees to ${c.cutoff_ts ? new Date(c.cutoff_ts * 1000).toISOString().slice(0, 16) : '—'}${c.note ? '  — ' + c.note.slice(0, 70) : ''}`);
    }
    console.log('');
    items.forEach((r, i) => {
      console.log(`${String(i + 1).padStart(3)}. ${String(r.score).padStart(6)}  ${r.state.padEnd(8)} ${String(r.name).slice(0, 30).padEnd(31)} ${r.channel.padEnd(9)} ${r.why}${r.blind ? '  [BLIND]' : ''}`);
    });
  }

  if (argv.includes('--email')) {
    const out = path.join(REPO, '.thetacog/followup-brief.html');
    fs.writeFileSync(out, renderHtml(items, cuts, st, db));
    try {
      // --from-room, not the default work-product address. A self-send from hello@ is caught by
      // the operator's own Gmail filter and files itself out of the inbox — and a daily brief
      // nobody sees is a daily brief that does not exist. The room identity keeps it filterable
      // (one List-Id rule still catches it) while giving it its own sender to whitelist.
      execFileSync('node', [path.join(REPO, 'scripts/email-artifact.mjs'),
        '--html', out, '--to', 'elias@thetadriven.com', '--to', 'you@example.com',
        '--from', '☕ Network · ThetaDriven <network@thetadriven.com>',
        '--alert', 'followup-brief',
        '--preheader', `${new Date().toISOString().slice(0, 10)} · ${items.length} owed or overdue`,
        '--kind', 'followup-brief'], { cwd: REPO, stdio: 'inherit', timeout: 180_000 });
    } catch (e) { console.error(`⚠ email failed: ${String(e.message).slice(0, 200)}`); }
  }
  db.close();
}
