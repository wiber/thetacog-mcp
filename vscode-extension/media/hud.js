// packages/thetacog-mcp-vscode/media/hud.js — C749 🎯 STEER HUD, the webview side: it POSTS user events and PAINTS server events.
// The host spawns `pmu-onchip --hud-serve` once and relays every stdout line as {type:'serve', event}; the page asks the server for its
// `config` once and reads every constant it uses from that event. It keeps no grid state beyond the last event it painted: the window, the
// fold, the colours, the queue, the archetype, the freeze gate and the health lines are the server's (C748).
// Keys 1-9 and a click post `select` with by 'key'|'click'; a red cell the server says is being defended opens the sentence box and Enter
// posts `defend`; Enter posts `freeze` by 'key'. The gate is the server's: a voice-shaped origin is refused there, not here.
(function () {
  'use strict';
  var H = window.HudCore || self.HudCore;
  var vs = acquireVsCodeApi();
  var $ = function (id) { return document.getElementById(id); };
  var cfg = null, lastGrid = null, seen = {}, defendingShown = false;
  var paintedAt = null, paintedFrom = '';   // C770 the clock reading of the last grid event painted, and that event's own `at`: a select's latency is read off these two
  var REPAINT_MS = 250;   // the page's own paint clock; no server constant
  function post(m) { vs.postMessage(m); }
  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (text != null) { e.textContent = text; } return e; }
  function earcon(hz) {
    try { var A = window.AudioContext || window.webkitAudioContext; if (!A) { return; } var a = new A(), o = a.createOscillator(); o.frequency.value = hz; o.connect(a.destination); o.start(); setTimeout(function () { o.stop(); a.close(); }, 40); } catch (e) { /* no audio: silent */ }
  }
  // C751 A MALFORMED EVENT PAINTS UNMEASURED AND NEVER THROWS: a field the page needs that the event lacks is named in the note ("UNMEASURED — <field> absent").
  function absent(field) { $('note').textContent = 'UNMEASURED — ' + field + ' absent'; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  var pinned = true;
  // C740 THE REGISTER: for the 📋 paste source the dump pane is an editable textarea holding the steer file's tail, with a thin rule
  // "— processed above —" at the watcher's byte offset (the host posts processedBytes and tailStart). Absent: UNMEASURED, said with its why.
  var RULE = '— processed above —', UNMEASURED = 'watermark UNMEASURED — the watcher has not run', shown = '';
  function registerText(m) {
    var lines = Array.isArray(m.lines) ? m.lines.map(String) : [], out = [], at = typeof m.tailStart === 'number' ? m.tailStart : 0, placed = typeof m.processedBytes !== 'number';
    lines.forEach(function (l) {
      if (!placed && at >= m.processedBytes) { out.push(RULE); placed = true; }
      out.push(l); at += utf8Len(l) + 1;
    });
    if (!placed) { out.push(RULE); }
    return out.join('\n');
  }
  function utf8Len(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0x80) { n += 1; } else if (c < 0x800) { n += 2; } else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; } else { n += 3; } } return n; }
  function paintRegister(m) {
    if (Array.isArray(m.lines)) { var tail = m.lines.join('\n'); if (lastPasteTail !== null && tail !== lastPasteTail) { var addP = tail.indexOf(lastPasteTail) === 0 ? tail.slice(lastPasteTail.length) : (m.lines.slice(-1)[0] || ''); feedWords(addP, '📋'); } lastPasteTail = tail; }
    var r = $('register'), isPaste = m.source === 'paste';
    r.hidden = !isPaste; $('dump').hidden = isPaste; $('regbar').hidden = !isPaste;
    if (!isPaste) { return; }
    shown = registerText(m); r.value = shown;
    $('wm').textContent = typeof m.processedBytes === 'number' ? 'processed through byte ' + m.processedBytes : UNMEASURED;
    sum('sum-paste', (Array.isArray(m.lines) ? m.lines.length : 0) + ' lines' + (typeof m.processedBytes === 'number' ? ' · processed through byte ' + m.processedBytes : ''));
    follow(r);   // the register snaps to the newest transcription unless the reader scrolled up to read
  }
  // the typed line is what follows the shown tail; failing that, the last line. The host appends it through vna.clipIngest, never here.
  function typedLine() {
    var v = $('register').value, t = v.indexOf(shown) === 0 ? v.slice(shown.length) : v.slice(v.lastIndexOf('\n') + 1);
    return t.replace(/^\n+/, '').replace(/\s+$/, '');
  }
  function appendTyped() {
    var t = typedLine(); if (!t) { return; }
    post({ type: 'append', text: t }); $('register').value = shown;
  }
  $('register').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { if (e.preventDefault) { e.preventDefault(); } if (e.stopPropagation) { e.stopPropagation(); } appendTyped(); } });
  $('append').addEventListener('click', appendTyped);
  $('clear').addEventListener('click', function () { post({ type: 'clearProcessed', by: 'click' }); });   // only the click clears; nothing heard does
  function paintLines(m) {
    var d = $('dump'); d.innerHTML = '';
    paintRegister(m);
    if (!Array.isArray(m.lines)) { absent('lines'); } else {
      m.lines.forEach(function (l) { d.appendChild(node('div', 'line', String(l))); });
      $('note').textContent = m.note || '';
    }
    if (pinned) { d.scrollTop = d.scrollHeight; }
  }

  // ---- painting a server `grid` event ----
  // C1014b THE MODEL WORDS: a reading painted OVER the measured words while the 🧠 box is ticked — marked, never the cell colour, never posted back
  var st0 = (vs.getState && vs.getState()) || {}; var modelOn = !!st0.modelWords; var model = null;
  function gridSig(g) { return (g && g.slots || []).map(function (c) { return c ? [c.strategy, c.tactics, c.operations].join('|') : ''; }).join('/'); }
  function askReword() {
    if (!modelOn || !lastGrid || !Array.isArray(lastGrid.slots)) { return; }
    var cells = []; lastGrid.slots.forEach(function (c, i) { if (c && c.strategy) { cells.push({ slot: i + 1, pair: String(c.why || '').split(' · ')[0], words: [c.strategy, c.tactics, c.operations].filter(Boolean) }); } });
    if (cells.length) { post({ type: 'reword', sig: gridSig(lastGrid), cells: cells }); }
  }
  function overlayModel(gridEl) {
    if (!modelOn || !model || model.sig !== gridSig(lastGrid)) { return; }
    var by = {}; (model.cells || []).forEach(function (c) { by[c.slot] = c.words; });
    var bs = gridEl.querySelectorAll ? gridEl.querySelectorAll('button.cell') : [];
    for (var i = 0; i < bs.length; i++) {
      var w = by[i + 1]; if (!w) { continue; }
      var b = bs[i], sp = { s: b.querySelector('.s'), t: b.querySelector('.t'), o: b.querySelector('.o') };
      var was = [sp.s, sp.t, sp.o].map(function (x) { return x ? x.textContent : ''; }).join(' · ');
      if (sp.s) { sp.s.textContent = w[0]; } if (sp.t) { sp.t.textContent = w[1]; } if (sp.o) { sp.o.textContent = w[2]; }
      b.className += ' model'; b.title = '🧠 model reading (haiku) — a question to answer, never the receipt\nmeasured: ' + was + '\n' + b.title;
    }
  }
  function paintNow() {
    if (!cfg) { return; }
    var gridEl = $('grid');
    if (!lastGrid) { gridEl.innerHTML = ''; $('face').textContent = ''; return; }
    H.paintGrid(document, gridEl, $('face'), lastGrid, cfg, seen, Date.now(), selectCell);
    overlayModel(gridEl);
  }
  // C770 THE SELECT-LATENCY LOGGER: a select, a defence or a freeze by key or click posts the span (just before the action, so the action stays the last post) since the last grid event was painted. The host
  // hands the row to hud-readings.mjs append, the one writer. A reading of a clock, nothing decided: a voice-shaped origin never posts one.
  function logLatency(by) {
    if (paintedAt === null || (by !== 'key' && by !== 'click')) { return; }
    post({ type: 'readings', select_latency_ms: Date.now() - paintedAt, from_event: paintedFrom, by: by });
  }
  // a click selects the cell AND collapses the dictation into a steer from its intersection (the collapse is the click's anatomy, 2026-10-13)
  function selectCell(slot) { logLatency('click'); post({ type: 'select', n: slot, by: 'click' }); post({ type: 'collapse', n: slot, draft: $('draft') ? $('draft').value : '', engine: engine() }); }
  var collapsing = null;
  function snowlog(line) {
    var el = $('snowlog'); if (!el) { return; }
    var rows = String(el.textContent || '').split('\n').filter(Boolean); var stamp = typeof Date === 'function' ? new Date(Date.now()).toISOString().slice(11, 19) + '  ' : '';   // the page clock; a clock-free vm stamps nothing
    rows.push(stamp + line);
    el.textContent = rows.slice(-30).join('\n'); follow(el);
  }
  function onGrid(ev) {
    if (typeof ev.draft === 'string') { paintDraft(ev.draft); }
    rdGrid = ev; paintReadout(); paintTickers(ev.tickers);
    if (Array.isArray(ev.tickers)) { var lastT = ev.tickers.map(function (r) { var e = r.entries || []; return e.length ? String(e[e.length - 1]).slice(0, 8) : ''; }).sort().pop(); sum('sum-tickers', ev.tickers.length + ' process' + (ev.tickers.length === 1 ? '' : 'es') + (lastT ? ' · last landing ' + lastT : '')); }
    if (Array.isArray(ev.readout) && ev.readout.length) { sum('sum-readout', String(ev.readout[0])); }
    seen = H.seenFor(seen, ev, Date.now()); lastGrid = ev; lastGridMs = Date.now(); paintedAt = lastGridMs; paintedFrom = String(ev.at || '');   // C770: the select latency reads from the event just painted
    if (!Array.isArray(ev.slots)) { absent('slots'); lastGrid = null; paintNow(); return; }
    if (isObj(ev.result) && typeof ev.result.ok === 'boolean') { earcon(ev.result.ok ? 880 : 330); }
    var box = $('defence'), d = ev.defending;
    if (d !== null && d !== undefined) { box.hidden = false; box.dataset.n = String(d); if (box.focus) { box.focus(); } defendingShown = true; }
    else if (defendingShown) { box.hidden = true; box.value = ''; defendingShown = false; }
    paintNow(); askReword();
  }
  function defend() {
    var i = $('defence');
    logLatency('key'); post({ type: 'defend', n: Number(i.dataset.n), sentence: i.value });
  }
  // C742 the LLM door: the sentence box or the 🤖 button posts {type:'ask', text}; the host adds the server's last ask_line. The reply only
  // ever lands in #reply: a model's words are text on the page, never a cell colour or a reading.
  // C1015a SHOW IT WORKING (operator 2026-10-19: "the text would have been enough if there were spinning emojis … and faster response time"):
  // every model call in flight spins a moon on the draft line with its seconds counting, and the feed gets the time it took when it lands
  var SPIN = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'], busyT = null, busyAt = 0, busyLabel = '';
  function busyStart(label) {
    busyStop(); busyLabel = label; busyAt = Date.now(); var k = 0;
    var tick = function () { var el = $('draftstate'); if (el) { el.textContent = SPIN[k++ % SPIN.length] + ' ' + busyLabel + ' · ' + Math.floor((Date.now() - busyAt) / 1000) + ' s'; } };
    tick(); busyT = typeof setInterval === 'function' ? setInterval(tick, 200) : null;   // the test vm carries no timers
    ['write', 'refine', 'askgrid'].forEach(function (id) { var b = $(id); if (b) { b.disabled = true; b.classList && b.classList.add('busy'); } });
  }
  function busyStop() {
    if (busyT && typeof clearInterval === 'function') { clearInterval(busyT); } busyT = null;
    ['write', 'refine', 'askgrid'].forEach(function (id) { var b = $(id); if (b) { b.disabled = false; b.classList && b.classList.remove('busy'); } });
    var took = busyAt ? Math.round((Date.now() - busyAt) / 100) / 10 : null; busyAt = 0; return took;
  }
  function ask(text) {
    var t = String(text || '').trim(); if (!t) { return; }
    $('reply').textContent = '';
    post({ type: 'ask', text: t, engine: engine() });
    if (!collapsing) { busyStart('asking ' + engine()); }
  }
  // C743 the realtime snowball: the host writes the ledger row from the server's `frozen` event and answers {type:'snowball', row}.
  // 🚀 Dispatch (click) and Ctrl+Enter (key) post {type:'dispatch', text_sha, by}; the page never posts one for anything it merely heard.
  var lastSha = '';
  // H15: the page's own clock on the server's lines — the age of the last health event and grid event, ticking, so a stuck server
  // reads as a number that keeps growing. The page holds no threshold of its own (the HUD's numbers are the config event's).
  var lastHealthMs = 0, lastGridMs = 0;
  function ago(ms, now) { return Math.max(0, Math.round((now - ms) / 1000)) + ' s'; }
  function paintAge() {
    var a = $('hage'); if (!a) { return; }
    var now = Date.now(); if (!lastHealthMs) { a.textContent = 'waiting for the server'; return; }
    a.textContent = 'health ' + ago(lastHealthMs, now) + ' ago' + (lastGridMs ? ' · grid ' + ago(lastGridMs, now) + ' ago' : '');
  }
  // the health pictures: the page keeps its own ring of past walk times (the server sends one per event) and draws what healthViz returns
  var walkRing = [], RING = 40;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  function paintViz(ev) {
    var v = H.healthViz(ev, walkRing, Date.now());
    if (v.walk.ms !== null) { walkRing.push(v.walk.ms); if (walkRing.length > RING) { walkRing.shift(); } }
    var walkTxt = v.walk.ms === null ? 'walk UNMEASURED' : 'walk ' + v.walk.ms.toFixed(1) + ' ms · pixel ' + (v.walk.pixel || '—') + ' · ' + v.walk.n + ' walks';
    var l1Txt = v.l1.crossing === null ? 'L1 UNMEASURED' : 'L1 crossing ' + v.l1.crossing.toFixed(2) + '× · control ' + (v.l1.control === null ? '—' : v.l1.control.toFixed(3)) + ' · ' + (v.l1.admissible ? 'ADMISSIBLE' : 'NOT ADMISSIBLE') + (v.l1.ageDays === null ? '' : ' · measured ' + v.l1.ageDays + ' d ago');
    var snowTxt = v.snow.n + ' snowball' + (v.snow.n === 1 ? '' : 's') + ' on the ledger';
    $('hvizline').textContent = walkTxt + '\n' + l1Txt + '\n' + snowTxt;
    $('hviz').innerHTML =
      '<div class="vrow"><span class="vk">walk</span><svg class="spark" viewBox="0 -1 100 22" preserveAspectRatio="none"><polyline points="' + esc(v.walk.path) + '"/></svg><span class="vv">' + esc(v.walk.ms === null ? 'UNMEASURED' : v.walk.ms.toFixed(1) + ' ms') + '</span></div>'
      + '<div class="vrow"><span class="vk">L1</span><span class="track"><span class="ctl" style="width:' + v.l1.ctlPct.toFixed(1) + '%"></span><span class="bar' + (v.l1.admissible ? ' ok' : ' no') + '" style="width:' + v.l1.barPct.toFixed(1) + '%"></span></span><span class="vv">' + esc(v.l1.crossing === null ? 'UNMEASURED' : v.l1.crossing.toFixed(2) + '×' + (v.l1.ageDays === null ? '' : ' · ' + v.l1.ageDays + ' d')) + '</span></div>'
      + '<div class="vrow"><span class="vk">snow</span><span class="ticks">' + new Array(Math.min(v.snow.n, RING) + 1).join('<i></i>') + '</span><span class="vv">' + v.snow.n + '</span></div>';
  }
  // 2026-10-13 THE DRAFT: the server composes the next /steer on every grid event (hud_grid draft_steer); the page shows it and copies it.
  // An edit the operator makes holds until they copy or resync, so the live draft never types over their hands.
  // 2026-10-13 THE FOLLOW RULE (operator: "auto snapped to the cursor (self scrolling) that is a design principle everywhere here, seeing it
  // move is the health sign"): every live box keeps to its newest line, unless the reader scrolled up to read — then it holds still until
  // they scroll back down to the end
  function follow(el) { if (!el || el.dataset.free === '1') { return; } el.scrollTop = el.scrollHeight; }
  function followable(id) {
    var el = $(id); if (!el || !el.addEventListener) { return; }
    el.addEventListener('scroll', function () { el.dataset.free = (el.scrollHeight - el.scrollTop - el.clientHeight) > 8 ? '1' : ''; });
  }
  ['register', 'snowlog', 'reply', 'health', 'readout', 'dump', 'speech', 'latest'].forEach(followable);
  // the steer engine (2026-10-13: "claude -p is best"): remembered per viewer, sent with every steer call; the host routes it
  function engine() { var e = $('engine'); var v = e && e.value; return v === 'local' || v === 'haiku' ? v : 'claude'; }
  try { var savedEngine = window.localStorage && window.localStorage.getItem('hud.engine'); if (savedEngine && $('engine')) { $('engine').value = savedEngine; } } catch (e) { /* no storage: the default holds */ }
  if ($('engine') && $('engine').addEventListener) { $('engine').addEventListener('change', function () { try { window.localStorage.setItem('hud.engine', engine()); } catch (e) { /* no storage */ } }); }
  function sum(id, text) { var s = $(id); if (s) { s.textContent = text || ''; } }
  // the speech register: what was heard, its live edge marked by the blinking cursor, following unless the reader scrolled up
  // the speech register's health: the audio door's own reading, and the age of the last write on the page clock — a dead daemon reads dead
  var speechMtime = null, audio = null;
  var MINUTE_MS = 6e4, HOUR_MS = 36e5;   // a clock's units, not a HUD number
  function ageOf(ms) { var d = Math.max(0, Date.now() - ms); return d < 2 * MINUTE_MS ? Math.round(d / 1000) + ' s' : d < 2 * HOUR_MS ? Math.round(d / MINUTE_MS) + ' min' : Math.round(d / HOUR_MS) + ' h'; }
  function paintAudioHealth() {
    var el = $('audiohealth'); if (!el) { return; }
    var wrote = speechMtime === null ? 'no write yet' : 'last write ' + ageOf(speechMtime) + ' ago';
    var line, dead = false;
    if (!audio) { line = '⚪ audio health not read yet · ' + wrote; }
    else if (!audio.ok) { line = '⚪ audio health UNMEASURED — ' + String(audio.why || ''); }
    else if (audio.alive) { line = '🟢 mic live · pid ' + audio.pid + ' · ' + (audio.wordsPerMin === null ? '—' : audio.wordsPerMin) + ' words/min · ' + wrote; }
    else if (audio.armed) { dead = true; line = '🔴 armed but the daemon is NOT running · ' + wrote + (audio.error ? ' · ' + audio.error : ''); }
    else { line = '⚪ the mic is off · ' + wrote; }
    el.textContent = line; el.className = 'audiohealth' + (dead ? ' dead' : '');
    if ($('rearm')) { $('rearm').hidden = !dead; }
    if ($('restartmic')) { $('restartmic').hidden = !(audio && audio.ok && audio.armed); }   // C1014a: armed, live or dead
    sum('sum-speech', line);
  }
  function paintSpeech(m) {
    if (lastSpeechText !== null && String(m.text || '') !== lastSpeechText && $('plus-huddraft') && $('plus-huddraft').open) { post({ type: 'rankAssoc', steer: $('draft') ? String($('draft').value || '') : '' }); }
    var nowText = String(m.text || '');
    if (lastSpeechText !== null && nowText !== lastSpeechText) { var add = nowText.indexOf(lastSpeechText) === 0 ? nowText.slice(lastSpeechText.length) : nowText.split('\n').filter(Boolean).slice(-1)[0] || ''; feedWords(add, '🎙️'); }
    lastSpeechText = nowText;
    var t = String(m.text || ''); $('speechtext').textContent = t || String(m.note || '');
    var n = t ? t.split('\n').filter(Boolean).length : 0;
    follow($('speech'));
    if (typeof m.mtime === 'number') { speechMtime = m.mtime; }
    paintAudioHealth();
  }
  // the tickers: the server's rows (hud_grid TickerBoard), each one line, its newest landing scrolled into view at the right edge
  function paintTickers(rows) {
    var box = $('tickers'); if (!box || !Array.isArray(rows)) { return; }
    rows.forEach(function (r, i) {
      var row = box.children[i];
      if (!row) { row = node('div', 'trow'); row.appendChild(node('span', 'tlabel', '')); row.appendChild(node('span', 'tline', '')); box.appendChild(row); }
      var text = (r.entries || []).join('   ›   ');
      var line = row.children[1];
      if (line.textContent !== text) { if (line.textContent) { var last = (r.entries || []).slice(-1)[0]; if (last && String(r.label) !== 'walk') { feed('🐛 ' + r.label + ' ' + String(last).slice(9), 'e'); } } line.textContent = text; row.className = 'trow moved'; } else { row.className = 'trow'; }
      row.children[0].textContent = String(r.label || '');
      line.scrollLeft = line.scrollWidth;
    });
    while (box.children.length > rows.length && box.lastChild && box.removeChild) { box.removeChild(box.lastChild); }
  }
  // THE FEED — the live line under the grid. Words arrive one at a time (a short stagger so a burst reads as speech, not a block); an action
  // is one emoji item. The page reports the events it already receives and computes nothing; the newest item sits at the right edge.
  var FEED_KEEP = 240, WORD_STAGGER_MS = 90, lastSpeechText = null, lastPasteTail = null, lastWalkAt = null, lastAudioAlive = null;
  // every item lands at once, in order; a burst of words is staggered by the stylesheet (animation-delay), never by a timer, so the feed's order
  // is the events' order and the eye still sees the words arrive one by one
  function feed(text, kind, k) {
    var f = $('feed'); if (!f) { return; }
    var it = node('span', 'fi ' + (kind || 'w'), String(text));
    if (k && it.style) { it.style.animationDelay = (k * WORD_STAGGER_MS) + 'ms'; }
    f.appendChild(it);
    while (f.children.length > FEED_KEEP && f.removeChild && f.firstChild) { f.removeChild(f.firstChild); }
    if (f.dataset.free !== '1') { f.scrollLeft = f.scrollWidth; }
  }
  // the feed scrolls sideways (2026-10-13); scrolled back from the right edge it holds still, back at the edge it follows again
  if ($('feed') && $('feed').addEventListener) { $('feed').addEventListener('scroll', function () { var f = $('feed'); f.dataset.free = (f.scrollWidth - f.scrollLeft - f.clientWidth) > 8 ? '1' : ''; }); }
  function feedWords(text, mark) {
    var lines = String(text).split('\n').map(function (l) { return l.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^🎙️\s*\d\d:\d\d:\d\d\s*/, '').trim(); }).filter(Boolean);
    var k = 0; lines.forEach(function (l) { feed(mark, 'e', k++); l.split(/\s+/).forEach(function (w) { feed(w, 'w', k++); }); });
  }
  var draftEdited = false, lastDraft = '';
  // the readout under the grid: the latest reading, health and grid events, painted as they are (every number is the server's)
  var rdReading = null, rdHealth = null, rdGrid = null, rdContext = null;
  // 2026-10-15 (operator: "make sure this runs on all context we have available, transcripts too"): the pool the cell words draw on, as
  // the server read it — its sha, its size and the chars each source gave; a source that gave none reads 0, never hidden
  function contextLine(c) {
    if (!isObj(c)) { return '🧠 pool: not read yet — the cells draw on the window alone'; }
    var src = Array.isArray(c.sources) ? c.sources.map(function (x) { return String(x.name) + ' ' + Number(x.chars || 0); }).join(' · ') : 'sources UNMEASURED';
    return '🧠 pool ' + String(c.sha || '').slice(0, 8) + ' · ' + Number(c.chars || 0) + ' chars · ' + src;
  }
  function paintReadout() {
    var el = $('readout'); if (!el) { return; }
    var lines = rdGrid && Array.isArray(rdGrid.readout) ? rdGrid.readout.slice() : [];
    var hl = rdHealth && Array.isArray(rdHealth.lines) ? rdHealth.lines : [];
    hl.forEach(function (l) { if (/^(L1 BOUNDARY|SNOWBALLS)/.test(String(l))) { lines.splice(2, 0, '⚡ ' + String(l)); } });
    lines.push(contextLine(rdContext || (rdReading && rdReading.context)));
    el.textContent = lines.join('\n'); follow(el);
  }

  // 2026-10-13 (operator: "steers cannot be ncd written"): the server's NCD draft is the HINT line under the box — what the 3×3 heard you lean
  // on — and never the steer; the box holds what the model wrote (✍️) or what you typed
  function paintDraft(text) {
    lastDraft = String(text || '');
    var h = $('heard'); if (h) { var lean = lastDraft.split('\n').filter(function (l) { return /×/.test(l); }).join(' · '); h.textContent = lean ? 'the 3×3 hears you lean on: ' + lean : ''; }
    var d = $('draft'); if (!d) { return; }
    sum('sum-draft', d.value && d.value.trim() ? (draftEdited ? 'yours' : 'written') + ' · ' + d.value.length + ' chars' : '✍️ write it');
  }
  function snowLine(sha, what) { $('snowline').textContent = String(sha).slice(0, 8) + ' · ' + what; }
  function dispatch(by) {
    if (by !== 'click' && by !== 'key') { return; }
    if (!lastSha) { $('note').textContent = 'dispatch: no frozen snowball yet — press Enter to freeze one'; return; }
    post({ type: 'dispatch', text_sha: lastSha, by: by });
  }
  $('dispatch').addEventListener('click', function () { dispatch('click'); });
  $('draft').addEventListener('input', function () { draftEdited = true; $('draftstate').textContent = '· yours — ✍️ writes a fresh one'; });
  $('copydraft').addEventListener('click', function () { var v = $('draft').value; if (v && v.trim()) { post({ type: 'copyDraft', text: v }); } });
  $('write').addEventListener('click', function () { post({ type: 'writeSteer', engine: engine() }); });
  // 🔗 the ranking preview (2026-10-13: "Show me the ranking in the expanded pill before I copy"): asked for when the steer changes, when the
  // drawer opens, on ↻ and on new speech while the drawer is open; the host ranks, the page paints the rows it gets and decides nothing
  function rerank() { post({ type: 'rankAssoc', steer: $('draft') ? String($('draft').value || '') : '' }); }
  if ($('rerank') && $('rerank').addEventListener) { $('rerank').addEventListener('click', rerank); }
  $('draft').addEventListener('change', rerank);
  var drawer = $('plus-huddraft'); if (drawer && drawer.addEventListener) { drawer.addEventListener('toggle', function () { if (drawer.open) { rerank(); } }); }
  var MARK = { kept: '✓', carried: '·', ambient: '✗', over: '–' };
  function paintAssoc(m) {
    var box = $('assoc'); if (!box) { return; }
    box.innerHTML = '';
    var rows = Array.isArray(m.rows) ? m.rows : [];
    if (!rows.length) { box.appendChild(node('li', 'dim', String(m.why || 'nothing to rank yet'))); return; }
    rows.forEach(function (r) { box.appendChild(node('li', 'as ' + String(r.verdict), MARK[r.verdict] + ' ' + (r.rank ? '#' + r.rank + ' ' : '') + String(r.x) + '  · overlap ' + r.o + ' · novelty ' + r.n)); });
    var kept = rows.filter(function (r) { return r.verdict === 'kept'; }).length;
    sum('sum-draft', ($('draft').value && $('draft').value.trim() ? $('draft').value.length + ' chars' : '✍️ write it') + ' · +' + kept + ' on copy');
  }
  // 🧲 the scratch: the host fills it (snapped dictation); your edit is saved when you leave the box; 🧹 empties it
  var scratchFocus = false;
  if ($('scratch') && $('scratch').addEventListener) {
    $('scratch').addEventListener('focus', function () { scratchFocus = true; });
    $('scratch').addEventListener('blur', function () { scratchFocus = false; });
    $('scratch').addEventListener('change', function () { post({ type: 'scratchSave', text: $('scratch').value }); });
  }
  if ($('scratchclear') && $('scratchclear').addEventListener) { $('scratchclear').addEventListener('click', function () { $('scratch').value = ''; post({ type: 'scratchSave', text: '' }); feed('🧹 scratch', 'e'); }); }
  function paintScratch(text) { var s = $('scratch'); if (!s || scratchFocus) { return; } s.value = String(text || ''); s.scrollTop = s.scrollHeight; sum('sum-scratch', ''); }
  // C1015: refine goes through the refine door (the files the draft names + the dictation that bears on it), except on the local engine
  $('refine').addEventListener('click', function () { var v = $('draft').value; if (!v || !v.trim()) { return; } if (engine() === 'local') { ask('Refine this /steer before I send it. Keep my words and my order; sharpen the ask; name anything missing or ambiguous; end with the refined /steer on its own:\n\n' + v); return; } post({ type: 'refine', draft: v }); });
  function freeze() { logLatency('key'); post({ type: 'freeze', by: 'key' }); }
  // 🤖 Ask sends the box's sentence (or the grid alone when the box is empty); Shift+Enter in the box asks, plain Enter still defends
  $('ask').addEventListener('click', function () { var i = $('defence'); var q = i.value && i.value.trim() ? i.value : 'What does this grid say, and what would you check first?'; ask(q); });
  $('source').addEventListener('change', function () { post({ type: 'source', source: $('source').value }); });
  // H5/H6: the pills below the grid — a checkbox runs its arm/disarm command (the host allowlists it), a ↗ opens the file it feeds
  ['clip', 'audio', 'build'].forEach(function (id) {
    var cb = $('cb-' + id), op = $('op-' + id);
    var cmds = { clip: ['vna.clipArm', 'vna.clipDisarm'], audio: ['vna.audioArm', 'vna.audioDisarm'], build: ['vna.audioAutobuildOn', 'vna.audioAutobuildOff'] }[id];
    if (cb) { cb.addEventListener('change', function () { post({ type: 'pill', cmd: cb.checked ? cmds[0] : cmds[1] }); }); }
    if (op) { op.addEventListener('click', function () { post({ type: 'open', id: id }); }); }
  });
  function paintPills(state) {
    ['clip', 'audio', 'build'].forEach(function (id) {
      var cb = $('cb-' + id), s = state && state[id]; if (!cb || !s) { return; }
      cb.checked = !!s.on; if (cb.parentNode && cb.parentNode.classList) { cb.parentNode.classList.toggle('on', !!s.on); }
    });
  }
  $('defence').addEventListener('keydown', function (e) { if (e.key === 'Enter') { if (e.stopPropagation) { e.stopPropagation(); } if (e.shiftKey) { var q = $('defence').value; $('defence').value = ''; ask(q); } else { defend(); } } });
  $('dump').addEventListener('scroll', function () { var d = $('dump'); pinned = d.scrollTop + d.clientHeight >= d.scrollHeight - 4; });
  window.addEventListener('keydown', function (e) {
    if (e.target && (e.target.id === 'defence' || e.target.id === 'register')) { return; }
    if (e.key === 'Enter' && e.ctrlKey) { dispatch('key'); return; }
    if (e.key === 'Enter') { freeze(); return; }
    if (/^[1-9]$/.test(e.key)) { logLatency('key'); post({ type: 'select', n: Number(e.key) - 1, by: 'key' }); }
  });

  // ---- every server event, painted into its pane ----
  function onServe(ev) {
    if (!isObj(ev) || typeof ev.kind !== 'string') { absent('kind'); return; }
    if (ev.kind === 'config') { cfg = ev; if (typeof ev.slots !== 'number') { absent('slots'); } paintNow(); }
    else if (ev.kind === 'grid') { onGrid(ev); }
    else if (ev.kind === 'reading') {
      if (isObj(ev.walk)) { rdReading = ev; paintReadout(); if (ev.walk.ok && ev.at !== lastWalkAt) { lastWalkAt = ev.at; feed('🚶 ' + String(ev.walk.pixel || (ev.result && ev.result.pixel) || '—') + ' ' + (typeof ev.walk.ms === 'number' ? Math.round(ev.walk.ms) + ' ms' : ''), 'e'); } }
      if (!isObj(ev.walk)) { absent('walk'); }
      else if (!ev.walk.ok) { $('note').textContent = ev.walk.why ? String(ev.walk.why) : 'UNMEASURED — walk.why absent'; }
      else if (isObj(ev.capped)) { $('note').textContent = 'capped — ' + String(ev.capped.why || 'the text event was cut to max_chars'); }
    }
    else if (ev.kind === 'context') { rdContext = ev.context; paintReadout(); }
    else if (ev.kind === 'health') { if (!Array.isArray(ev.lines)) { absent('lines'); } H.paintHealth($('health'), ev); follow($('health')); lastHealthMs = Date.now(); paintAge(); paintViz(ev); rdHealth = ev; paintReadout(); }
    else if (ev.kind === 'frozen') { if (!isObj(ev.row)) { absent('row'); } else { $('note').textContent = 'frozen · ' + String(ev.row.text_sha || '').slice(0, 8); snowLine(ev.row.text_sha || '', 'frozen'); snowlog('❄ snowball frozen · ' + String(ev.row.text_sha || '').slice(0, 8)); feed('❄ snowball ' + String(ev.row.text_sha || '').slice(0, 8), 'e'); } }
    else if (ev.kind === 'refused') { $('note').textContent = ev.why || 'refused'; earcon(220); }
    else if (ev.kind === 'error') { $('note').textContent = 'server: ' + (ev.why || 'error'); }
  }
  function onMessage(ev) {
    var m = ev && isObj(ev.data) ? ev.data : {};
    if (m.type === 'serve') { onServe(m.event); }
    else if (m.type === 'lines') { paintLines(m); }
    else if (m.type === 'snowball') { if (m.row && m.row.text_sha) { lastSha = m.row.text_sha; $('note').textContent = 'snowball ' + String(m.row.text_sha).slice(0, 8) + ' written to the ledger'; snowLine(m.row.text_sha, m.row.dispatched ? 'dispatched' : 'on the ledger, not dispatched'); snowlog((m.row.dispatched ? '🚀 dispatched · ' : '📒 on the ledger · ') + String(m.row.text_sha).slice(0, 8)); if (m.row.dispatched) { feed('🚀 sent ' + String(m.row.text_sha).slice(0, 8), 'e'); } } }
    else if (m.type === 'snowStatus') { $('note').textContent = String(m.text || ''); }
    else if (m.type === 'serverExit') { $('note').textContent = 'hud server exited (code ' + m.code + ')' + (m.restarted === true ? ' · restarted' : m.restarted === false ? ' · NOT restarted' : '') + (m.why ? ' — ' + String(m.why) : ''); }
    else if (m.type === 'askToken') { $('reply').textContent += String(m.t || ''); follow($('reply')); }
    else if (m.type === 'collapseStart') { collapsing = String(m.pair || 'the cell'); busyStart('reading ' + collapsing); $('reply').textContent = ''; snowlog('⤵ collapse · ' + collapsing + ' · ' + (m.words || []).join(' · ')); feed('⤵ ' + collapsing, 'e'); }
    else if (m.type === 'askDone' && collapsing) {
      var tookS = busyStop();
      // the model's steer lands in the draft box (held as an edit, so the live draft does not type over it); the full reply stays below
      var full = String(m.text || ''); var at = full.lastIndexOf('/steer'); var steer = at >= 0 ? full.slice(at).trim() : full.trim();
      if (m.ok && steer) { $('draft').value = steer; draftEdited = true; $('draftstate').textContent = '✅ written from ' + collapsing + ' in ' + tookS + ' s — 📋 copy, or ↺ resync'; snowlog('✓ steer from ' + collapsing + ' · ' + steer.length + ' chars · ' + tookS + ' s'); feed('✓ steer · ' + tookS + ' s', 'e'); }
      else { $('draftstate').textContent = '❌ no reply from the model after ' + tookS + ' s' + (m.why ? ' — ' + String(m.why).slice(0, 120) : ''); snowlog('✗ collapse from ' + collapsing + ' · no reply'); }
      $('reply').textContent = full; collapsing = null;
    }
    else if (m.type === 'askDone') { var t2 = busyStop(); if (t2 !== null) { $('draftstate').textContent = (m.ok ? '✅ answered in ' : '❌ no answer after ') + t2 + ' s'; } if (m.text) { $('reply').textContent = String(m.text); } if (!m.ok) { $('note').textContent = 'ask: no reply from the model server'; } }
    else if (m.type === 'registerStatus') { $('regstatus').textContent = String(m.text || ''); }
    else if (m.type === 'pills') { paintPills(m.state); }
    else if (m.type === 'speech') { paintSpeech(m); }
    else if (m.type === 'scratch') { paintScratch(m.text); }
    else if (m.type === 'assocRank') { paintAssoc(m); }
    else if (m.type === 'snapped') { (m.lines || []).forEach(function (l) { feed('🧲', 'e'); snowlog('🧲 ' + String(l).slice(0, 120)); }); }
    else if (m.type === 'reworded') { if (m.ok) { model = m; paintNow(); } else { feed('🧠 model words UNMEASURED — ' + String(m.why || ''), 'e'); } }
    else if (m.type === 'audioRestarted') { feed((m.ok ? '🟢 ' : '🔴 ') + String(m.line || 'restart'), 'e'); }
    else if (m.type === 'audioHealth') { audio = m; paintAudioHealth(); if (m.ok && lastAudioAlive !== null && !!m.alive !== lastAudioAlive) { feed(m.alive ? '🟢 mic live' : '🔴 mic stopped', 'e'); } if (m.ok) { lastAudioAlive = !!m.alive; } }
    else if (m.type === 'latestSteer') { $('latest').textContent = String(m.text || m.note || ''); sum('sum-latest', m.text ? String(m.text).replace(/\s+/g, ' ').slice(0, 72) + '…' : String(m.note || 'none on the tape')); follow($('latest')); }
    else if (m.type === 'copied') { draftEdited = false; $('draftstate').textContent = '· copied' + (m.note ? ' · ' + String(m.note) : ''); }
    // anything else, a voice-shaped message included, paints nothing and posts nothing
  }
  window.addEventListener('message', function (ev) {
    try { onMessage(ev); } catch (e) { try { $('note').textContent = 'UNMEASURED — the event could not be painted (' + String(e && e.message || e).slice(0, 80) + ')'; } catch (e2) { /* the page stays up */ } }
  });
  setInterval(function () { paintNow(); paintAge(); paintAudioHealth(); }, REPAINT_MS);
  if ($('modelwords')) { $('modelwords').checked = modelOn; if ($('modelwords').addEventListener) { $('modelwords').addEventListener('change', function () { modelOn = !!$('modelwords').checked; try { vs.setState(Object.assign({}, (vs.getState && vs.getState()) || {}, { modelWords: modelOn })); } catch (e) { /* no state */ } if (modelOn) { askReword(); } paintNow(); }); } }
  if ($('restartmic') && $('restartmic').addEventListener) { $('restartmic').addEventListener('click', function () { feed('↻ restarting the transcribe…', 'e'); post({ type: 'audioRestart' }); }); }
  if ($('rearm') && $('rearm').addEventListener) { $('rearm').addEventListener('click', function () { post({ type: 'pill', cmd: 'vna.audioArm' }); }); }
  post({ type: 'ready' });
  post({ type: 'config' });
})();
