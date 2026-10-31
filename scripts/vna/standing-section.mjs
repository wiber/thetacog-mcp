// scripts/vna/standing-section.mjs — C921o THE TEN, RENDERED AS PART OF THE STEER PAGE (operator 2026-10-17, with four screenshots: "this
// is proving hard to do and think about … optimise, test and finish all forms of it --- this is better … but I said infinite width … and it
// crashes instantly"). The section used to arrive from OUTSIDE the page (the extension host prepended it and a script moved it into the 📝
// slot); every repaint morphs the page in place and dropped what the fresh page did not carry — the style first, then the boxes. Now
// steer-ui.mjs renders the section INTO the page: its style, its markup and its script ride every repaint like the rest of the page.
// One question per block: the trigger stem on its own small line (C921p, operator: "I asked for the text boxes to have very wide layout,
// if not infinitely long (wide)"), then [+] and one long single-row box (Enter saves) running the whole card width to its edge, the live reading drawn
// inside its right end. [+] turns the box into a paragraph and opens the question, the full ask, what the tape measures, the reading and
// the controls. Saves post { type: 'standingSave' } through the page's own API handle; the extension host writes the holder's json.
// Pure: (playbook, questions, readings) in, HTML out. Nothing here reads a file.
// @guard tests/site/c921-the-standing-answers.test.mjs

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STANDING_SECTION_CSS = `
#sa-wrap{display:block;box-sizing:border-box;width:100%;min-width:0;margin:2px 0 4px}
#sa-wrap *{box-sizing:border-box}
/* C1013d THE FRAME READS IN 15 SECONDS: the header above the readiness line, and the ceiling-and-halt line under step 1 —
   both visible without opening a single [+], before any preset row. */
#sa-wrap .sa-frame-head{font-size:15px;color:#fff;font-weight:700;margin:0 0 6px;white-space:normal}#sa-wrap .sa-frame-lead{font-size:12.5px;color:#c9d4e0;margin:0 0 8px;white-space:normal;max-width:60ch}
#sa-wrap .sa-step-line{font-size:12.5px;color:#ddd;margin:2px 0 6px 32px;white-space:normal}
#sa-wrap .sa-readiness{font-size:13px;color:#fff;font-weight:600;margin:0 0 4px;white-space:normal}
#sa-wrap .sa-due{font-size:11px;font-weight:700;color:var(--vscode-editorWarning-foreground,#d7ba7d);margin:0 0 4px;white-space:normal}
#sa-wrap .sa-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 6px;font-size:10.5px}
#sa-wrap .sa-tools button{width:auto;padding:2px 8px;font-size:10.5px;font-weight:600;border-radius:4px}
#sa-wrap .sa-q{padding:5px 0}
#sa-wrap button.sa-trial{background:#1e9150;color:#fff}
#sa-wrap .sa-trial-hint{font-size:12px;color:#ddd}
#sa-wrap .sa-q.sa-newpair{margin-top:6px;border-top:1px solid var(--vscode-panel-border,#333);padding-top:6px}
/* C921s (operator: "the scroll bar is the whole window NEVER on the label"): one line per question — the stem with its full
   question, then [+], then a long box — and the LIST of ten scrolls sideways as one, with one scrollbar under it. */
/* C921z (operator: "you put a bounding box around the questions that scroll, I explicitly said all these to be on the same canvas"):
   NO inner scroll box. The rows run out past the card onto the page, and the sidebar page itself scrolls sideways. */
#sa-wrap .sa-list{overflow:visible;padding-bottom:4px}
#sa-wrap .sa-list-in{width:max-content;min-width:100%}
/* C921t (operator: "two lines - one for quesiton, one for text box" · "larger and more legible" · "white on black not grey on black"):
   line 1 the question, line 2 [+] and the long box; the list scrolls sideways as one when a line is wider than the sidebar. */
#sa-wrap .sa-row{width:100%;display:grid;grid-template-columns:26px minmax(max-content,1fr);column-gap:6px;row-gap:3px;align-items:center;white-space:nowrap}
#sa-wrap .sa-row>.sa-stem{line-height:28px}
#sa-wrap .sa-row>.sa-box{grid-column:1 / -1}   /* operator: "+ can be on the text box or the title would be better actually" — [+] heads the question line */
#sa-wrap .sa-stem{font-size:13px;font-weight:400;white-space:nowrap;overflow:visible;color:#fff}
#sa-wrap .sa-stem b{font-weight:700;color:#fff}
#sa-wrap .sa-q.sa-done .sa-stem b{color:#7ee2c8}
#sa-wrap .sa-n{color:#bbb;font-weight:400}
#sa-wrap button.sa-tog{width:26px;height:28px;min-width:26px;padding:0;margin:0;font-size:15px;font-weight:700;line-height:26px;border-radius:4px}
/* C921x (operator: "still dont have the infintely long text bboxes when collapsed"): the box spans the whole scrolled list — as wide as
   the longest question line, never under 72ch — so a box always reaches the same far edge the questions do. */
#sa-wrap .sa-box{position:relative;width:100%;min-width:72ch}
#sa-wrap textarea.sa-line{position:static;left:auto;display:block;width:100%;min-width:0;margin:0;font:inherit;font-size:13px;line-height:18px;padding:4px 24px 4px 8px;resize:none;overflow:hidden;white-space:pre;height:28px;background:#000;color:#fff;border:1px solid #666;border-radius:3px}
#sa-wrap .sa-q:not(.sa-done) textarea.sa-line{border-color:var(--vscode-focusBorder,#0e639c)}
#sa-wrap .sa-chip{position:absolute;right:8px;top:5px;font-size:13px;line-height:18px;cursor:help;color:var(--vscode-descriptionForeground,#888);pointer-events:auto}
#sa-wrap .sa-chip[data-status=MEASURED]{color:var(--vscode-testing-iconPassed,#3fb950)}
#sa-wrap .sa-q.sa-open .sa-box{width:100%}
#sa-wrap .sa-q.sa-open textarea.sa-line{white-space:pre-wrap;overflow:auto;height:auto;min-height:6.5em;field-sizing:content;max-height:none}
#sa-wrap .sa-saved{display:none;font-size:10px;text-align:right;color:var(--vscode-testing-iconPassed,#3fb950)}
#sa-wrap .sa-saved.on{display:block}
#sa-wrap .sa-full{white-space:normal;max-width:min(100vw - 40px,92ch);margin:4px 0 4px 2px;padding-left:8px;border-left:2px solid var(--vscode-panel-border,#333);white-space:normal}
#sa-wrap .sa-full[hidden]{display:none}
#sa-wrap .sa-sub{font-size:13px;font-weight:600;color:#fff;margin:2px 0 3px}
#sa-wrap .sa-ask{font-size:13px;color:#fff;margin:4px 0}
#sa-wrap .sa-teach{font-size:12.5px;font-style:italic;color:#ddd;margin:4px 0}
#sa-wrap .sa-reading{font-size:12.5px;color:#ddd;margin:4px 0}
#sa-wrap .sa-reading[data-status=MEASURED]{color:var(--vscode-testing-iconPassed,#3fb950)}
#sa-wrap .sa-field{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10.5px;color:var(--vscode-descriptionForeground,#888)}
#sa-wrap .sa-field input,#sa-wrap .sa-field select{width:auto;font:inherit;font-size:11px;background:var(--vscode-input-background,#1e1e1e);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#3c3c3c));border-radius:3px;padding:2px 4px}
#sa-wrap .sa-field input[type=range]{padding:0;border:0;background:none}
#sa-wrap .sa-field input[type=number]{width:6em}
/* C1013c ONE-CLICK PRESETS: a row of pills ahead of the other controls — a click fills the box (and the choice/number
   fields the kind carries) and leaves every one of them the same editable control it was before the click. */
#sa-wrap .sa-presets{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}
#sa-wrap button.sa-preset{width:auto;padding:2px 8px;font-size:11px;font-weight:600;border-radius:4px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff);border:1px solid var(--vscode-panel-border,#555)}
/* C1013e THE TEN ARE DIRECTED TO AT THE RIGHT TIME: the line a hardening question carries once it is
   offered — what answering it adds to the record — reads the same place the guardrail's step line does. */
#sa-wrap .sa-unlock-line{font-size:12.5px;color:#9ad1c0;margin:2px 0 6px 32px;white-space:normal}
`;

// var, never let/const at the top level: a repaint can re-insert this script, and a second `let` would throw. State lives on window.
export const STANDING_SECTION_JS = `
function saApi(){ return (typeof window.__vs !== 'undefined' && window.__vs) || (typeof _vs !== 'undefined' ? _vs : null); }
function saPost(m){ var a = saApi(); if (a) a.postMessage(m); }
function saAnswered(a){ if(!a) return false; return !!(a.text && a.text.trim() && a.text.indexOf('___') < 0) || a.slider!=null || a.choice!=null || !!(a.numbers && Object.values(a.numbers).some(function(v){ return v!=null; })); }
function saState(){ var el = document.getElementById('sa-state'); try { return el ? JSON.parse(el.textContent) : { answers: {}, questions: [] }; } catch (e) { return { answers: {}, questions: [] }; } }
function saRecompute(){
  var st = window.SA_STATE || (window.SA_STATE = saState()); var answered = 0, ai = 0, you = 0;
  st.questions.forEach(function(q){ var ok = saAnswered(st.answers[q.id]); if (ok) answered++; else if (q.draft === 'ai') ai++; else you++;
    var row = document.querySelector('#sa-wrap .sa-q[data-question="' + q.id + '"]'); if (row) row.classList.toggle('sa-done', ok); });
  var line = document.getElementById('sa-readiness-line');
  if (line) line.textContent = 'Readiness: ' + answered + ' of ' + st.questions.length + ' answered · your AI can still draft: ' + ai + ' · only you: ' + you;
}
function saPatch(id, patch){ var st = window.SA_STATE || (window.SA_STATE = saState()); st.answers[id] = Object.assign({}, st.answers[id] || {}, patch); saRecompute(); saPost({ type: 'standingSave', id: id, patch: patch }); }
function saToggle(id){
  var row = document.querySelector('#sa-wrap .sa-q[data-question="' + id + '"]'), full = document.getElementById('sa-full-' + id), box = document.getElementById('sa-line-' + id);
  if (!row || !full || !box) return;
  var opening = !row.classList.contains('sa-open'); row.classList.toggle('sa-open', opening); full.hidden = !opening;
  var btn = row.querySelector('.sa-tog'); if (btn) btn.textContent = opening ? '\\u2212' : '+'; box.focus();
}
function saKey(e, id, el){ var open = el.closest('.sa-q').classList.contains('sa-open'); if (e.key === 'Enter' && (!open || e.metaKey || e.ctrlKey)) { e.preventDefault(); saSaveLine(id, el); } }
function saSaveLine(id, el){ saPatch(id, { text: el.value }); var t = document.getElementById('sa-saved-' + id); if (t) { t.textContent = '\\u2713 saved'; t.classList.add('on'); setTimeout(function(){ t.classList.remove('on'); }, 1600); } }
// C1013c ONE-CLICK PRESETS: fills the box (and the choice/number fields the kind carries) from the question's own
// preset list, read off window.SA_STATE (carried down with id+draft+presets, never hand-typed here). The box, the
// select and the number inputs it touches stay the same editable controls after — this writes a value, not a lock.
function saApplyPreset(id, idx){
  var st = window.SA_STATE || (window.SA_STATE = saState());
  var q = (st.questions || []).filter(function(x){ return x.id === id; })[0];
  var p = q && q.presets && q.presets[idx]; if (!p) return;
  var patch = {};
  if (typeof p.fill === 'string') patch.text = p.fill;
  if ('numbers' in p) patch.numbers = p.numbers;
  if ('choice' in p) patch.choice = p.choice;
  saPatch(id, patch);
  var row = document.querySelector('#sa-wrap .sa-q[data-question="' + id + '"]'); if (!row) return;
  var box = document.getElementById('sa-line-' + id); if (box && typeof p.fill === 'string') box.value = p.fill;
  if ('choice' in p) { var sel = row.querySelector('select'); if (sel) sel.value = p.choice || ''; }
  if ('numbers' in p && p.numbers) { Object.keys(p.numbers).forEach(function(nid){ var inp = row.querySelector('input[data-num="' + nid + '"]'); if (inp) inp.value = p.numbers[nid]; }); }
  var t = document.getElementById('sa-saved-' + id); if (t) { t.textContent = '\\u2713 saved'; t.classList.add('on'); setTimeout(function(){ t.classList.remove('on'); }, 1600); }
}
// C1009 ONE CLICK TO THE FIRST EMPTY BOX: the host posts {type:'focus-first-standing'}; the first unanswered question (all ten
// answered → the first) is opened through every collapsed <details> above it, scrolled to and focused.
function saFocusFirst(){ var st = window.SA_STATE || (window.SA_STATE = saState()); var qs = st.questions || []; var q = null;
  for (var i = 0; i < qs.length; i++) { if (!saAnswered(st.answers[qs[i].id])) { q = qs[i]; break; } } if (!q) q = qs[0]; if (!q) return null;
  var box = document.getElementById('sa-line-' + q.id); if (!box) return null;
  var d = box.closest('details'); while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest('details') : null; }
  if (box.scrollIntoView) box.scrollIntoView({ block: 'center' }); box.focus(); return q.id; }
window.addEventListener('message', function(e){ var m = e.data; if (m && m.type === 'focus-first-standing') saFocusFirst(); });
saRecompute();
`;

/**
 * The section's HTML, embedded in the steer page. `pb` is the holder's playbook (or null), `questions` the one source's QUESTIONS,
 * `readings` a map id → { status, why } (C930), `readiness(pb)` and `stopDue(pb)` the source's own functions, `readinessLine` and
 * `stopDueLine` its strings. The state rides in a JSON script tag so the page script reads it fresh after a repaint.
 */
export function renderStandingSection({ pb, questions, readings = {}, readiness, stopDue, readinessLine = '', stopDueLine = '', trialFloor = null, qualifyLine = null, qualifyIds = [], guardrailHeader = '', guardrailLead = '', repoName = '', hardeningLead = '', guardrailStepLine = '', hasRun = true, unlocked = true }) {
  const answers = (pb && pb.answers) || {};
  const r = readiness(pb || { answers: {} });
  const due = stopDue ? stopDue(pb || { answers: {} }) : { due: false };
  // C1013e THE TEN ARE DIRECTED TO AT THE RIGHT TIME: with no run on record, the three guardrails
  // stay off this paint entirely — C1012g's welcome carries the cold install instead. A run on
  // record shows the three guardrails alone until a licence is bought or the trial qualifies
  // (`unlocked`), which opens the seven hardening questions — each naming, beside its row, what
  // it adds to the holder's record, before its [+] ever opens.
  if (!hasRun) {
    return `<div id="sa-wrap" data-rendered="page" data-gate="no-run">`
      + `${guardrailHeader ? `<div class="sa-frame-head">${esc(guardrailHeader)}</div>` : ''}`
      + `${guardrailLead ? `<div class="sa-frame-lead">${esc(guardrailLead.replace('{repo}', repoName || 'this repo'))}</div>` : ''}`
      + `<div class="sa-step-line">Run the chip walk once — your agent's limits open on the first run on record.</div>`
      + `</div>`;
  }
  const shown = unlocked ? questions : questions.filter((q) => qualifyIds.includes(q.id));
  const row = (q, i) => {
    const a = answers[q.id] || {};
    const ci = q.short.indexOf(':');
    const stem = ci > 0 ? q.short.slice(0, ci) : q.title;
    const sub = ci > 0 ? q.short.slice(ci + 1).trim() : q.short;
    // C1013d: the three guardrails read as "step N of 3", not their question number, and step 1 carries the
    // ceiling-and-halt line right under its row — visible without opening a single [+].
    const stepIdx = qualifyIds.indexOf(q.id);
    const nLabel = stepIdx > -1 ? `step ${stepIdx + 1} of ${qualifyIds.length}` : String(q.n).padStart(2, '0');
    const stepLine = stepIdx === 0 && guardrailStepLine ? `<div class="sa-step-line">${esc(guardrailStepLine)}</div>` : '';
    // C1013e: a hardening question (anything outside QUALIFY_IDS) carries its own `unlocks` line the
    // moment it is shown — never inside the collapsed [+], the same visibility the step line gets.
    const unlockLine = stepIdx === -1 && q.unlocks ? `<div class="sa-unlock-line">${esc(q.unlocks)}</div>` : '';
    const rd = readings[q.id];
    const chip = !rd ? '' : rd.status === 'MEASURED' ? '✓' : '·';
    const chipTitle = !rd ? '' : rd.status === 'MEASURED' ? String(rd.why || '') : `UNMEASURED — ${rd.why || ''}`;
    const newPair = i > 0 && shown[i - 1].pair !== q.pair ? ' sa-newpair' : '';
    const slider = q.slider ? `<div class="sa-field"><label>${esc(q.slider.label)} (${esc(q.slider.unit)})</label><input type="range" min="${q.slider.min}" max="${q.slider.max}" step="${q.slider.step}" value="${a.slider ?? q.slider.min}" oninput="this.nextElementSibling.textContent=this.value" onchange="saPatch('${q.id}', { slider: Number(this.value) })"><span>${a.slider ?? q.slider.min}</span></div>` : '';
    const choice = q.choice ? `<div class="sa-field"><label>${esc(q.choice.label)}</label><select onchange="saPatch('${q.id}', { choice: this.value || null })">${['', ...q.choice.options].map((o) => `<option value="${esc(o)}"${a.choice === o ? ' selected' : ''}>${esc(o || '— choose —')}</option>`).join('')}</select></div>` : '';
    const numbers = q.numbers ? `<div class="sa-field">${q.numbers.map((n) => `<label>${esc(n.label)} (${esc(n.unit)}) <input type="number" data-num="${esc(n.id)}" value="${a.numbers?.[n.id] ?? ''}" onchange="saPatch('${q.id}', { numbers: Object.assign({}, ((window.SA_STATE||{}).answers||{})['${q.id}'] && (window.SA_STATE.answers['${q.id}'].numbers) || {}, { '${n.id}': this.value === '' ? null : Number(this.value) }) })"></label>`).join('')}</div>` : '';
    const presets = q.presets ? `<div class="sa-field sa-presets">${q.presets.map((p, idx) => `<button type="button" class="sa-preset" onclick="saApplyPreset('${q.id}', ${idx})">${esc(p.label)}</button>`).join('')}</div>` : '';
    const date = q.date ? `<div class="sa-field"><label>${esc(q.date.label)}</label><input type="date" value="${esc(a.date ?? '')}" onchange="saPatch('${q.id}', { date: this.value || null })"></div>` : '';
    const decision = q.decision ? `<div class="sa-field"><label>${esc(q.decision.label)}</label><select onchange="saPatch('${q.id}', { decision: this.value || null })">${['', ...q.decision.options].map((o) => `<option value="${esc(o)}"${a.decision === o ? ' selected' : ''}>${esc(o || '— not yet —')}</option>`).join('')}</select></div>` : '';
    const hardHead = hardeningLead && stepIdx === -1 && (i === 0 || qualifyIds.includes(shown[i - 1].id)) ? `<div class="sa-frame-lead sa-hard-lead">${esc(hardeningLead)}</div>` : '';
    return hardHead + `<div class="sa-q${a.text && a.text.trim() && !/___/.test(a.text) ? ' sa-done' : ''}${newPair}" data-question="${q.id}">`
      + `<div class="sa-row"><button class="sa-tog" title="the full question, what the tape measures, the controls, and a paragraph box" onclick="saToggle('${q.id}')">+</button>`
      + `<span class="sa-stem" title="${esc(q.short)}"><span class="sa-n">${esc(nLabel)}</span> <b>${esc(stem)}</b>${ci > 0 ? ': ' + esc(sub) : ''}</span>`
      + `<div class="sa-box"><textarea class="sa-line" id="sa-line-${q.id}" rows="1" onkeydown="saKey(event,'${q.id}',this)" onchange="saSaveLine('${q.id}',this)">${esc(a.text && String(a.text).trim() ? a.text : (q.fill || ''))}</textarea>`
      + `<span class="sa-chip" data-status="${rd ? esc(rd.status) : ''}" title="${esc(chipTitle)}">${esc(chip)}</span></div></div>`
      + stepLine + unlockLine
      + `<div class="sa-saved" id="sa-saved-${q.id}"></div>`
      + `<div class="sa-full" id="sa-full-${q.id}" hidden><div class="sa-sub">${esc(q.short)}</div><div class="sa-ask">${esc(q.ask)}</div><div class="sa-teach">${esc(q.teach)}</div>`
      + `${rd ? `<div class="sa-reading" data-status="${esc(rd.status)}">Tested against the tape: ${esc(chipTitle)}</div>` : ''}${presets}${slider}${choice}${numbers}${date}${decision}</div></div>`;
  };
  const state = JSON.stringify({ answers, questions: questions.map((q) => ({ id: q.id, draft: q.draft, presets: q.presets || null })) }).replace(/</g, '\\u003c');
  return `<div id="sa-wrap" data-rendered="page">`
    + `${guardrailHeader ? `<div class="sa-frame-head">${esc(guardrailHeader)}</div>` : ''}`
      + `${guardrailLead ? `<div class="sa-frame-lead">${esc(guardrailLead.replace('{repo}', repoName || 'this repo'))}</div>` : ''}`
    + `${due.due ? `<div class="sa-due">⏰ ${esc(stopDueLine)} (set for ${esc(String(due.date))}) — open 01 and record keep or stop</div>` : ''}`
    + `<div id="sa-readiness-line" class="sa-readiness">Readiness: ${r.answered} of ${r.of} answered · your AI can still draft: ${r.aiCanDraft.length} · only you: ${r.onlyYou.length}</div>`
    + `<div class="sa-tools" title="${esc(readinessLine)}"><button title="write rough comments in the boxes, then copy all ten (questions, what the tape measures, your answers) into Claude" onclick="saPost({ type: 'standingCopyAll' })">📋 Copy all ten</button><button title="paste Claude's ten numbered lines back into the boxes (or run /standing-answers in Claude Code)" onclick="saPost({ type: 'standingPasteBack' })">📥 Paste answers</button><button title="the demand door: buy licences for the hours your agent runs on its own, in your repo or as a cloud bot such as Grok Bot (Copy all ten asks your AI how many, with the pricing key)" onclick="saPost({ type: 'standingBuy' })">🛒 Buy licences</button>${trialFloor ? (r.qualified ? `<button class="sa-trial" title="the three guardrails are answered: join the warranty trial at its floor of ${trialFloor} licences — consulting hours prepaid, a multiple in kind if our act fails" onclick="saPost({ type: 'standingTrial', units: ${Number(trialFloor)} })">🛡️ Join the warranty trial</button>` : '') + `<span class="sa-trial-hint">${esc(qualifyLine ? qualifyLine(pb || { answers: {} }) : '')}</span>` : ''}<a href="#" onclick="saPost({ type: 'standingLifecycle' }); return false;">every step →</a></div>`
    + `<div class="sa-list"><div class="sa-list-in">${shown.map(row).join('')}</div></div>`
    + `<script type="application/json" id="sa-state">${state}</script>`
    + `</div>`;
}
