// packages/thetacog-mcp-vscode/media/hud-core.js — C749 PAINTING ONLY. Every decision the HUD takes (the rolling window, the debounce,
// the fold, the colour, the transition queue, the archetype, the freeze gate, the health lines) lives in `pmu-onchip --hud-serve` and
// arrives as a server event; this module cuts a pill, turns a cell and a clock into an opacity, and applies a `grid` event to the DOM.
// Loaded two ways, one function: the webview as window.HudCore (a <script src>), and the guards via require(path).
// No vscode import, no timers, no clock of its own: every function takes nowMs from its caller. Every number it uses (pill_words,
// pill_chars, fade_in_ms, fade_out_ms) is read from the `config` event the page asked the server for, never held here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); } else { root.HudCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DOTS = { green: '🟢', amber: '🟡', red: '🔴', unmeasured: '⚪' };

  /** cut, never paraphrased: the first cfg.pill_words words, then the first cfg.pill_chars characters of that */
  function pill(text, cfg) {
    // a path is read by its last segment (2026-10-13: "/Users/thetacoa" told the eye nothing; the file name does), the whole path on hover
    var raw = String(text == null ? '' : text).trim();
    if (/^[^\s]*\/[^\s]+$/.test(raw)) { raw = raw.replace(/\/+$/, '').split('/').pop(); }
    var words = raw.split(/\s+/).filter(Boolean).slice(0, cfg.pill_words).join(' ');
    return words.length > cfg.pill_chars ? words.slice(0, cfg.pill_chars).replace(/\s+$/, '') : words;
  }
  /** the painted face of a cell the server sent: three pills and the dot of the colour the server named */
  function face(cell, cfg) {
    var known = Object.prototype.hasOwnProperty.call(DOTS, cell.colour);
    return { strategy: pill(cell.strategy, cfg), tactics: pill(cell.tactics, cfg), operations: pill(cell.operations, cfg),
      colour: known ? cell.colour : 'unmeasured', dot: DOTS[known ? cell.colour : 'unmeasured'] };
  }
  /** the fade of one cell at nowMs, in the same clock as cell.shownAt / cell.retireAt */
  function opacity(cell, nowMs, cfg) {
    if (!cell) return 0;
    if (cell.retireAt !== null && cell.retireAt !== undefined) return Math.max(0, 1 - (nowMs - cell.retireAt) / cfg.fade_out_ms);
    return Math.min(1, Math.max(0, (nowMs - cell.shownAt) / cfg.fade_in_ms));
  }
  /**
   * The server stamps shownAt/retireAt in ITS clock; the page has only its own. `seen` maps a cell's identity to the page-clock time the page
   * first painted it that way, so the same opacity() runs on page-clock times. Returns the next map (cells no longer sent are dropped).
   */
  function seenFor(prev, ev, nowMs) {
    var next = {};
    (ev && ev.slots || []).forEach(function (c, i) {
      if (!c) return;
      var k = i + ':' + c.shownAt + ':' + (c.retireAt === null || c.retireAt === undefined ? '' : c.retireAt);
      next[k] = prev && prev[k] !== undefined ? prev[k] : nowMs;
    });
    return next;
  }
  function viewCell(c, i, seen, nowMs) {
    var live = c.retireAt === null || c.retireAt === undefined;
    var at = seen[i + ':' + c.shownAt + ':' + (live ? '' : c.retireAt)];
    return { shownAt: at === undefined ? nowMs : at, retireAt: live ? null : (at === undefined ? nowMs : at) };
  }
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) { e.className = cls; } if (text != null) { e.textContent = text; } return e; }
  /** C779 the top word of a cell: the axis_label the server names for the row (C778) when the cell carries one, else its strategy */
  function topWord(cell) { return cell.axis_label != null && String(cell.axis_label).trim() !== '' ? cell.axis_label : cell.strategy; }
  /**
   * apply a `grid` event to the DOM: nine buttons, the opacity, the archetype line the server named, and the cell's drawn anatomy (C779):
   * data-slot carries the cell number (hud.css paints it small at the top-left), then in DOM order the `s` span (the axis_label or strategy,
   * 10px subdued on top), the `t` span (tactics, 14px bold in the centre), the `o` span (operations, 9px monospace at the bottom) and the
   * `dot` span (🟢🟡🔴) — which hud.css orders immediately before the tactics word as the centre row's fixation point.
   */
  function paintGrid(doc, gridEl, faceEl, ev, cfg, seen, nowMs, onClick) {
    gridEl.innerHTML = '';
    var slots = ev && ev.slots || [], n = cfg && cfg.slots ? cfg.slots : slots.length;
    // the signal bar: each cell's best word's signal against the strongest cell's, so the eye finds where the window points hardest
    var top = slots.map(function (s) { return s && s.words && s.words[0] && typeof s.words[0].signal === 'number' ? s.words[0].signal : null; });
    var peak = top.reduce(function (m, v) { return v !== null && v > m ? v : m; }, 0);
    for (var i = 0; i < n; i++) {
      var c = slots[i], b = el(doc, 'button', 'cell');
      b.dataset.slot = String(i + 1);
      if (c) {
        var f = face(c, cfg);
        b.className += ' ' + f.colour;
        // C759 H13: the server's worm fade for this slot (1 just confirmed by a landing worm, falling toward its floor; 0 = no worm has
        // landed here yet, painted grey, never hidden) multiplies the transition opacity. The page computes no fade of its own.
        var wo = ev && ev.worm && ev.worm[i], wf = wo && typeof wo.opacity === 'number' ? wo.opacity : 1;
        b.style.opacity = String(opacity(viewCell(c, i, seen, nowMs), nowMs, cfg) * (wf > 0 ? wf : 1));
        if (wf === 0) { b.className += ' unlanded'; }
        // 2026-10-13 (operator: "sizes of the letters in the cells can be relevant to ncd confidence of the triad"): each line carries its word's
        // weight from the server (hud fold: its signal against the strongest word on the grid); the stylesheet turns --w into size and colour.
        // The centre line is the best word (words[0]), the top the second, the bottom the third.
        var ws = c.words || [], wOf = function (k) { return ws[k] && typeof ws[k].weight === 'number' ? ws[k].weight : null; };
        [['s', f.strategy, 1], ['t', f.tactics, 0], ['o', f.operations, 2]].forEach(function (x) {
          var sp = el(doc, 'span', x[0], x[1]), w = wOf(x[2]);
          if (w !== null) { sp.dataset.w = String(w); if (sp.style && sp.style.setProperty) { sp.style.setProperty('--w', String(w)); } }
          b.appendChild(sp);
        });
        b.appendChild(el(doc, 'span', 'dot', f.dot));
        // the legend's half of the cell (operator 2026-10-13: "dont write it in the cells, write in the legend"): the tier pair and the
        // ranked words with their signal ride on hover, never painted in the cell
        b.title = String(c.why || '') + (c.words && c.words.length ? '\n' + c.words.map(function (w) { return w.word + '  ' + w.signal; }).join('\n') : '');
        var bar = el(doc, 'span', 'sig'); bar.style.width = (top[i] !== null && peak > 0 ? Math.max(0, top[i]) / peak * 100 : 0) + '%'; b.appendChild(bar);
      } else { b.className += ' empty'; b.textContent = '·'; b.title = 'slot ' + (i + 1) + ' (key ' + (i + 1) + ') — no words have landed here yet'; }   // 2026-10-13: a dim mark, never a big debug digit; the key stays on hover
      (function (slot) { b.addEventListener('click', function () { onClick(slot); }); })(i);
      gridEl.appendChild(b);
    }
    // H9 (operator 2026-10-12: "plumber? no that was a metaphor"): the face is the server's colour counts, never an archetype name
    var k = ev && ev.archetype && ev.archetype.counts; faceEl.textContent = k ? '🟢 ' + k.green + ' · 🟡 ' + k.amber + ' · 🔴 ' + k.red : '';
  }
  /** apply a `health` event: the server's lines, joined */
  function paintHealth(healthEl, ev) { healthEl.textContent = (ev && ev.lines || []).join('\n'); }
  /**
   * the health card's pictures, drawn off the server's numbers (ev.data) and the page's own ring of past walks; nothing here decides.
   * walk: a sparkline of the walk's ms per health event, the newest on the right · L1: the crossing ratio as a bar beside the control
   * band, the verdict and the receipt's age · snowballs: one tick per snowball on the ledger. A missing number draws UNMEASURED.
   */
  function sparkPath(vals, w, h) {
    var xs = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (xs.length < 2) { return ''; }
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs), span = hi - lo || 1;
    return xs.map(function (v, k) { return (k / (xs.length - 1) * w).toFixed(1) + ',' + (h - (v - lo) / span * h).toFixed(1); }).join(' ');
  }
  function healthViz(ev, ring, nowMs) {
    var d = ev && ev.data || {}, w = d.walk || {}, b = d.boundary || {}, s = d.snowballs && d.snowballs.rows || [];
    var ms = typeof w.ms === 'number' ? w.ms : null;
    var cr = typeof b.crossing_ratio === 'number' ? b.crossing_ratio : null, ctl = typeof b.control_ratio === 'number' ? b.control_ratio : null;
    var at = b.date ? Date.parse(b.date) : NaN;
    return {
      walk: { ms: ms, pixel: w.pixel || null, path: sparkPath(ring.concat(ms === null ? [] : [ms]), 100, 20), n: ring.length + (ms === null ? 0 : 1) },
      l1: { crossing: cr, control: ctl, admissible: b.admissible === true, ageDays: isFinite(at) ? Math.floor((nowMs - at) / 86400000) : null,
        barPct: cr !== null ? Math.min(100, cr / Math.max(cr, ctl || 0, 1) * 100) : 0, ctlPct: ctl !== null && cr !== null ? Math.min(100, ctl / Math.max(cr, ctl, 1) * 100) : 0 },
      snow: { n: s.length, last: s.length ? s[s.length - 1].at : null },
    };
  }

  return { DOTS: DOTS, pill: pill, face: face, topWord: topWord, opacity: opacity, seenFor: seenFor, paintGrid: paintGrid, paintHealth: paintHealth, healthViz: healthViz, sparkPath: sparkPath };
});
