// packages/thetacog-mcp-vscode/media/chat.js — C167 💬 LOCAL IDEATION, the webview side of the sidebar chat.
//
// THE CONVERSATION LIVES HERE AND NOWHERE ELSE. `session` is an array in this page's memory (media/chat-core.js createSession): each
// turn posts the whole history to the host, which streams it to the local engine and keeps none of it; no vscode.setState, no
// localStorage, no file. 🧹 Clear empties the array and the log and posts NOTHING — the host never learns there was a conversation, so
// no spec tree or goal file can change. The only way text leaves this chat is a click: 📋 Copy (the clipboard), 📋→🌳 Fold to Tree
// (vna.clipIngest with that one answer), ⚡ Run as Goal (vna.ingestGoal with that one answer). Nothing auto-spills into a worker
// snowball (C167b). The engine is called only when the user presses Send — that press is the explicit ask.
(function () {
  'use strict';
  var C = (typeof window !== 'undefined' && window.ChatCore) || (typeof self !== 'undefined' && self.ChatCore);
  var vs = acquireVsCodeApi();
  var $ = function (id) { return document.getElementById(id); };
  var session = C.createSession();
  var probe = null, requested = null, sub = null, busy = null, seq = 0, current = null;
  // C298 (2) — the host-only words (the steer verbs and the help words) arrive FROM the host ('hostRules', vna-chat.ts, off
  // vna-chat-inline.ts STEER_VERBS and HELP_RE). This page keeps no copy of either list: before they arrive, only the slash
  // forms (/steer · /workers · /end) route without a model.
  var hostRules = null;
  function hostOnly(text) {
    if (/^\/(steer|workers|end)\b/i.test(text)) return true;
    if (!hostRules) return false;
    if ((hostRules.steerVerbs || []).indexOf(text.split(/\s+/)[0].toLowerCase()) >= 0) return true;
    try { return !!hostRules.help && new RegExp(hostRules.help.source, hostRules.help.flags).test(text); } catch (e) { return false; }
  }

  function post(m) { vs.postMessage(m); }
  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scroll() { var l = $('log'); l.scrollTop = l.scrollHeight; }
  function note(text, cls) { var n = node('div', 'note ' + (cls || ''), text); $('log').appendChild(n); scroll(); return n; }

  // C215 — ONE PROBE WAS THE WHOLE STORY: the view probed Ollama once on load and again only on a click, so a probe that timed
  // out while the machine was busy (a reload under load) painted 🔴 Unreachable and every tag "(not installed)" until touched.
  // Offline now re-asks on its own — 3 s, doubling to a 60 s ceiling — and stops the moment one answer comes back online.
  var reprobeTimer = null, reprobeMs = 3000;
  function reprobe() {
    if (reprobeTimer) { clearTimeout(reprobeTimer); reprobeTimer = null; }
    if (probe && probe.online) { reprobeMs = 3000; return; }
    reprobeTimer = setTimeout(function () { reprobeTimer = null; post({ type: 'probe' }); }, reprobeMs);
    reprobeMs = Math.min(reprobeMs * 2, 60000);
  }
  window.__reprobe = function () { return { pending: !!reprobeTimer, nextMs: reprobeMs }; };   // the guard's handle

  function paintStatus() {
    var s = $('status'); s.innerHTML = '';
    var on = !!(probe && probe.online);
    s.className = 'status ' + (on ? 'on' : 'off');
    // C250g (operator 2026-09-24: "the green online … is redundant, green text gemma green text qwen is enough") — online paints no
    // words of its own; the face is the two green model names with their stats (paintFace). Offline still says so, in red.
    if (!on) s.appendChild(node('span', 'face', C.OFFLINE_LINE));
    paintFace();
    if (on) { var r = C.resolveModel(requested, probe.models); if (!r.installed) s.appendChild(node('span', 'why', r.why)); }
    // C285 — each tag says whether it thinks, from sub.thinking (vna-chat.ts applies runner-resolver.mjs THINKING_RULES) — no table here
    var TH = (sub && sub.thinking) || {};
    var th = function (o) { return TH[o.value] ? o.label.replace(o.value, o.value + ' · ' + TH[o.value]) : o.label; };
    var sel = $('model'); sel.innerHTML = '';
    C.modelOptions(requested, probe ? probe.models : []).forEach(function (o) {
      var opt = node('option', null, on ? th(o) : th(o).replace(' (not installed)', ' (engine offline)')); opt.value = o.value; opt.selected = !!o.selected; if (!o.installed) opt.disabled = true; sel.appendChild(opt);
    });
    sel.disabled = !on;
    // C201 — the 🤖 /steer subagent dropdown, beside the chat one: the same installed tags, the resolver's subagent tag selected
    var ss = $('subModel'); ss.innerHTML = '';
    var subReq = (sub && (sub.model || sub.fallback)) || null;
    // C205 — claude -p sits in the SAME list as the local tags, and the list selects what the ENGINE is, not what tag is stored:
    // on the cloud preset claude -p is selected, so picking a local tag is a real change event (it was already "selected" before).
    var cloud = !!sub && sub.local !== true;
    // C205(a) — claude -p shows whether ITS key is held (fp8, never the key) or says where to add one; it stays
    // selectable either way — an unset key is a fact the picker states, never a reason to grey it out.
    var keyRow = sub && sub.keyRow;
    var claudeLabel = 'claude -p' + (keyRow ? (keyRow.held ? ' — key held (' + keyRow.fp8 + ')' : ' — no key — add it on ⚙️🔑 Engine & Keys') : '');
    // C215 — one option per Claude model, each pinning the worker's --model (the API row is where its cost is measured)
    var cms = (sub && sub.claudeModels) || ['sonnet', 'opus', 'haiku']; var cur = (sub && sub.claudeModel) || 'sonnet';
    cms.forEach(function (cm) { var co = node('option', null, claudeLabel.replace('claude -p', 'claude -p · ' + cm)); co.value = 'claude -p · ' + cm; co.selected = cloud && cm === cur; ss.appendChild(co); });
    C.modelOptions(subReq, probe ? probe.models : []).forEach(function (o) {
      var opt = node('option', null, on ? th(o) : th(o).replace(' (not installed)', ' (engine offline)')); opt.value = o.value; opt.selected = !cloud && !!o.selected; if (!o.installed) opt.disabled = true; ss.appendChild(opt);
    });
    ss.disabled = !sub;   // claude -p is pickable with Ollama offline
    // C298 (4) — the 🤖 tooltip names the REAL default tag, read off runner-resolver.mjs LOCAL_ROLES.subagent (sub.fallback, the probe)
    var sp = $('subPick'); if (sp && sp.title) sp.title = sp.title.replace(/default .*?LOCAL_ROLES\.subagent\)?/, 'default ' + ((sub && sub.fallback) || 'UNMEASURED — runner-resolver.mjs status did not answer') + ' (runner-resolver.mjs LOCAL_ROLES.subagent)');
    $('subNote').textContent = !sub ? '🤖 subagent model UNMEASURED — runner-resolver.mjs status did not answer' : (sub.local === true ? '🤖 workers run on ' + (sub.engine || 'a local engine') + ' (goose, tools on)' : '🤖 workers run on ' + (sub.engine || 'a cloud engine') + ' — pick a local tag above to hand them to goose');
    $('send').disabled = !!busy;   // C201: offline still sends /steer verbs; a model line says offline itself
  }

  // C250e — a line repeated back to back (the loop's "cycle 1 · QUEUED …" ×10) shows once with its count
  function squeeze(text) {
    var out = [], prev = null, n = 0;
    String(text == null ? '' : text).split('\n').forEach(function (l) { if (l === prev && l.trim()) { n++; return; } if (prev !== null) out.push(n > 1 ? prev + '  ×' + n : prev); prev = l; n = 1; });
    if (prev !== null) out.push(n > 1 ? prev + '  ×' + n : prev);
    return out.join('\n');
  }
  window.__squeeze = squeeze;   // the guard's handle

  // C250g — the face: each role's model name in green, the chat's reply time right after it, then its memory and context; idle when
  // not loaded (KEEP_ALIVE 2m); workers running as 🤖×n. Everything else is behind the +.
  var engines = null;
  function paintFace() {
    var f = $('engineFace'); if (!f) return; f.innerHTML = '';
    if (!probe || !probe.online) return;
    // before the first engines reading lands, the chat model's name and reply time come straight off the probe
    var roles = engines && engines.roles ? engines.roles : [{ role: 'chat', tag: C.resolveModel(requested, probe.models).model || requested, loaded: null }];
    roles.forEach(function (r) {
      if (!r.tag) return;
      var chip = node('span', 'mchip');
      chip.appendChild(node('span', 'mtag', r.tag));
      if (r.role === 'chat' && probe.ms != null) chip.appendChild(node('span', 'mms', probe.ms + ' ms'));
      if (r.loaded !== null) chip.appendChild(node('span', 'mst' + (r.loaded ? '' : ' idle'), r.loaded ? r.gb + ' GB' + (r.ctx_k != null ? ' · ' + r.ctx_k + 'k' : '') : 'idle'));
      chip.title = (r.role === 'chat' ? '💬 chat model' : '🤖 worker model') + ' — ' + (r.loaded ? r.gb + ' GB held, context ' + (r.ctx_k != null ? r.ctx_k * 1024 : '?') : 'not loaded; it loads on the next use and unloads 2 min after');
      f.appendChild(chip);
    });
    if (engines && engines.running) f.appendChild(node('span', 'mchip mrun', '🤖×' + engines.running + ' running'));
  }

  function bubble(role, text) {
    var b = node('div', 'msg ' + role);
    b.appendChild(node('div', 'who', role === 'user' ? 'you' : (C.resolveModel(requested, probe && probe.models).model || 'engine')));
    var body = node('div', 'body', squeeze(text)); b.appendChild(body); b.body = body;
    $('log').appendChild(b); scroll();
    return b;
  }

  // C250e — a + is universally "show me more": a reply's doors (Copy · Fold to Tree · Run as Goal) sit behind its own +
  function doors(b, text) {
    var fold = node('details', 'plus rdoors'); fold.appendChild(node('summary', null, '+'));
    var row = node('div', 'doors'); fold.appendChild(row);
    C.actionsFor(text).forEach(function (a) {
      var btn = node('button', 'door ' + a.id, a.label);
      btn.title = a.id === 'fold' ? 'fold this answer into the Merkle spec tree — vna.clipIngest, the same door ⤵ Ingest Clipboard opens; nothing else in this chat moves'
        : a.id === 'goal' ? 'hand this answer to 📥 Ingest Refined Goal — goal.mjs import --validate --install; the gate refuses a goal that names no basin'
        : 'copy this answer to the clipboard';
      btn.addEventListener('click', function () { post(a.post); if (a.id === 'copy') { btn.textContent = '✅ copied'; setTimeout(function () { btn.textContent = a.label; }, 1400); } });
      row.appendChild(btn);
    });
    b.appendChild(fold);
  }

  function send(text) {
    text = String(text == null ? '' : text).trim();
    if (!text || busy) return;
    if (/^\/clear$/i.test(text)) { $('input').value = ''; clear(); return; }   // C210: clear is a verb you type, never a button
    if (/^\/probe$/i.test(text)) { $('input').value = ''; post({ type: 'probe' }); return; }
    // C224: /workers · /end run on the host too — no model needed · C201: a bare steer verb runs steer.mjs on the host — no model needed.
    // C239b: the two halves of this `||` sat on one line with the comment BETWEEN them, so the second half was commented out and the
    // file was a SyntaxError (the whole chat view mounted dead). The comment sits above the expression now; guard c239b parses every media/*.js.
    var steer = hostOnly(text);   // C298 (2): the host's own list, never a second one here
    if (!steer && (!probe || !probe.online)) { note(C.OFFLINE_LINE, 'bad'); return; }
    var r = steer ? { model: 'steer', installed: true } : C.resolveModel(requested, probe.models);
    if (!r.installed) { note(r.why, 'bad'); return; }
    session.push('user', text); bubble('user', text);
    busy = ++seq; current = bubble('assistant', ''); current.classList.add('streaming');
    $('input').value = ''; $('stop').disabled = false; paintStatus();
    post({ type: 'send', id: busy, model: r.model, messages: session.messages() });
  }

  function finish(m) {
    if (!current || m.id !== busy) return;
    current.classList.remove('streaming');
    if (m.ok) {
      current.body.textContent = squeeze(m.text);
      session.push('assistant', m.text);
      current.appendChild(node('div', 'meta', (m.tokens != null ? m.tokens + ' tok · ' : '') + (m.tps != null ? m.tps + ' tok/s' : 'tok/s UNMEASURED')));
      doors(current, m.text);
    } else {
      current.appendChild(node('div', 'meta bad', m.error === 'stopped' ? '⏹ stopped' : '⚠ ' + (m.error || 'the engine did not answer') + (m.steer === 'refuse' ? '' : ' · ' + C.OFFLINE_LINE)));
      if (m.text) { session.push('assistant', m.text); doors(current, m.text); }
    }
    busy = null; current = null; $('stop').disabled = true; paintStatus(); scroll();
    readEngines();   // C250a: a reply may have loaded or swapped a model — the face total follows it
  }

  // C167h — clear now empties the shared file too (posts {type:'clear'}), so the inline form does not still show a
  // transcript this view just cleared; the original "posts nothing" contract widens on purpose, once, for this one message
  function clear() { session.clear(); $('log').innerHTML = ''; busy = null; current = null; $('stop').disabled = true; paintStatus(); post({ type: 'clear' }); }

  // C167h — restore the shared transcript on open/reload: the host reads .thetacog/chat/session.ndjson and answers with
  // every prior turn; rebuilt once, only when this view's own memory is empty (a mid-conversation probe must not duplicate)
  function restore(turns) {
    if (!turns || !turns.length || session.size() > 0) return;
    note('— earlier in this chat —', 'divider');   // C250e: one divider, not "(restored)" on every reply
    turns.forEach(function (t) {
      session.push(t.role, t.content);
      var b = bubble(t.role, t.content);
      if (t.role === 'assistant') { doors(b, t.content); }
    });
    scroll();
  }

  window.addEventListener('message', function (e) {
    var m = e.data || {};
    // C250 — the engines pill: the memory total on the face, one line per role behind the +, and the ⏹ End all answer
    if (m.type === 'engines') { engines = m; paintFace(); var el = $('engineLines'); el.innerHTML = ''; (m.lines || []).forEach(function (l) { el.appendChild(node('div', 'eline', l)); }); return; }
    if (m.type === 'keep') { $('keepRunning').checked = !!m.on; $('keepFace').textContent = m.face || '↻'; $('keepFace').title = m.alive ? 'the loop daemon is alive' : 'no loop daemon running'; }   // C277
    if (m.type === 'keepDone') { $('keepRunning').disabled = false; $('endOut').textContent = m.text || ''; }
    if (m.type === 'endAllDone') { $('endAll').disabled = false; $('endAll').textContent = '⏹ End all'; if (!$('engines').open) { $('engines').open = true; } $('endOut').textContent = m.text || (m.ok ? 'done' : 'nothing answered'); $('endOut').className = 'eout ' + (m.ok ? 'ok' : 'bad'); return; }
    if (m.type === 'hostRules') { hostRules = { steerVerbs: m.steerVerbs || [], help: m.help || null }; return; }   // C298 (2)
    if (m.type === 'probe') { probe = m.probe || null; requested = m.requested || requested; sub = m.sub || null; paintStatus(); reprobe(); return; }
    if (m.type === 'token' && current && m.id === busy) { current.body.textContent += m.t; scroll(); return; }
    if (m.type === 'done') { finish(m); return; }
    // C224 — the send is queued behind /steer workers: the numbered list and the /end line, inside the waiting bubble
    if (m.type === 'waiting' && current && m.id === busy) { current.appendChild(node('div', 'meta waiting', m.text)); scroll(); return; }
    if (m.type === 'chatHistory') { restore(m.turns); return; }
  });

  $('send').addEventListener('click', function () { send($('input').value); });
  // C250a — the reading refreshes itself: on each open of the +, every 15 s while it stays open, after each chat reply, and on ↻
  var enginesTimer = null;
  function readEngines() { post({ type: 'engines' }); }
  $('engines').addEventListener('toggle', function () {
    if (enginesTimer) { clearInterval(enginesTimer); enginesTimer = null; }
    var open = $('engines').open; $('enginePanel').hidden = !open; $('engines').querySelector('summary').textContent = open ? '−' : '+';   // C250b: the panel sits under the face, the + stays first
    if (open) { readEngines(); enginesTimer = setInterval(readEngines, 15000); }
  });
  $('engineRefresh').addEventListener('click', function () { $('engineLines').textContent = 'reading…'; readEngines(); });
  $('keepRunning').addEventListener('change', function () { $('keepRunning').disabled = true; post({ type: 'keepRunning', on: $('keepRunning').checked }); });   // C277
  $('endAll').addEventListener('click', function () { $('endAll').disabled = true; $('endAll').textContent = '⏹ ending…'; $('endOut').textContent = ''; post({ type: 'endAll' }); });
  $('input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('input').value); } });
  $('stop').addEventListener('click', function () { if (busy) post({ type: 'stop', id: busy }); });
  if ($('clear')) $('clear').addEventListener('click', clear);
  if ($('refresh')) $('refresh').addEventListener('click', function () { post({ type: 'probe' }); });
  // C205: the hands door turns the engine knob (claude -p ↔ goose-local + tag); the old subModel post only stored a tag, so the preset stayed claude
  $('subModel').addEventListener('change', function () { post({ type: 'subHands', value: $('subModel').value }); });
  $('model').addEventListener('change', function () { requested = $('model').value; post({ type: 'model', model: requested }); paintStatus(); });

  window.__chat = { session: session, send: send, clear: clear };   // the guard's handle — the same functions the buttons call
  $('stop').disabled = true;
  post({ type: 'ready' });
})();
