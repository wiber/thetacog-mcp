// packages/thetacog-mcp-vscode/media/chat-core.js — C167 💬 LOCAL IDEATION: the one core the sidebar chat, the extension host relay,
// the steer page's pill and the guards all load (unit 2 of docs/specs/vna/SPEC-MULTI-ENGINE.md).
//
// ONE PLACE. The webview (media/chat.js, a <script src>), the extension host (src/vna-chat.ts, require()), scripts/vna/chat-bridge.mjs
// (createRequire) and tests/vna/c167-*.test.mjs all read these functions — so the face the steer page paints and the face the chat view
// paints are the same function over the same probe, and a guard that runs this file runs what ships.
//
// WHAT THIS FILE NEVER DOES: it holds no transcript anywhere but the in-memory session object a caller creates; it touches no disk, no
// localStorage, no vscode.setState; it never calls a model on its own — streamChat runs only when a caller hands it a message the user
// sent (the explicit ask; memory rule: no local inference during an active session otherwise). The probe reads GET /api/tags, which
// lists installed tags and loads no model.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); } else { root.ChatCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULT_HOST = 'http://localhost:11434';
  // C198 (operator 2026-09-23: "use gemma for control chat and qwen for subagents if needed by default"): the control chat asks
  // for gemma; qwen is the SUBAGENT's tag (runner-resolver.mjs LOCAL_ROLES, the convention's one home — the c198 guard diffs this
  // line against it). Picked otherwise on ⚙️ Engine & Keys, which writes the same globalState key the chat's own selector does.
  var FALLBACK_MODEL = 'gemma2:2b';
  var PROBE_MS = 1500;                        // "when nothing answers within 1,500 ms"
  var OFFLINE_FACE = '🔴 Engine Offline';
  var OFFLINE_LINE = '🔴 Engine Unreachable · Check: ollama serve / goose session';
  var PILL_LABEL = '💬 Steer chat';   // C201a: the name is the function, never the vendor — engines change under it
  // C167e/C167g (operator 2026-09-23, measured: the pill read "🟢 Online (11434) · qwen2.5-coder:3b not installed" — the
  // requested tag is a PRESET's default, not what is actually on this machine's disk): ONE ordered preference list, never a
  // second hardcoded fallback anywhere else. resolveModel() falls back to the first of these that IS installed.
  var PREFERRED_MODELS = ['gemma2:2b', 'qwen3:8b', 'qwen2.5:7b', 'gpt-oss:20b', 'llama3.2:1b'];   // C198: gemma first — the chat's convention
  var EMBED_RE = /embed/i;   // ollama's own naming convention for embedding-only models (nomic-embed-text, mxbai-embed-large, all-minilm, …) — never a chat model

  function portOf(host) {
    try { var u = new URL(host); return u.port || (u.protocol === 'https:' ? '443' : '80'); } catch (e) { return String(host || ''); }
  }
  function base(host) { return String(host || DEFAULT_HOST).replace(/\/+$/, ''); }
  // "qwen3" and "qwen3:latest" are the same tag to ollama; nothing else is normalised — a near name is NOT a match
  function norm(tag) { var t = String(tag || '').trim(); return t && t.indexOf(':') < 0 ? t + ':latest' : t; }
  function isEmbedModel(tag) { return EMBED_RE.test(String(tag || '')); }
  /** the installed tags a human (or a chat/dispatch) could actually pick — embedding-only tags filtered out */
  function chatModels(models) { return (models || []).filter(function (m) { return !isEmbedModel(m); }); }

  /** GET /api/tags with a hard 1,500 ms ceiling — any refusal, timeout or bad body is offline, never a throw */
  function probe(opts) {
    opts = opts || {};
    var host = base(opts.host), ms = opts.ms || PROBE_MS, f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var t0 = Date.now(), at = new Date(t0).toISOString();
    var out = { at: at, host: host, port: portOf(host), online: false, models: [], ms: null, error: null };
    if (!f) { out.error = 'no fetch in this runtime'; return Promise.resolve(out); }
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null, timedOut = false;
    var timeout = new Promise(function (res) { timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); res('timeout'); }, ms); });
    var req = f(host + '/api/tags', ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (timedOut) return 'late';   // an answer after the ceiling is still offline
      out.online = true;
      out.models = ((j && j.models) || []).map(function (m) { return m && (m.name || m.model); }).filter(Boolean);
      return 'ok';
    }, function (e) { if (timedOut) return 'late'; out.error = String((e && e.message) || e).slice(0, 160); return 'err'; });
    return Promise.race([req, timeout]).then(function (w) {
      clearTimeout(timer);
      if (timedOut) { out.online = false; out.models = []; out.error = 'no answer in ' + ms + ' ms'; }
      out.ms = Date.now() - t0;
      return out;
    });
  }

  /** the requested tag against what /api/tags listed (embedding-only tags excluded) — an exact tag (x ≡ x:latest) match; else
   * the first INSTALLED, non-embedding tag off PREFERRED_MODELS (usedFallback: true, never a silent substitute — the caller
   * always gets told which); else null with the reason and every installed tag named. C167e/C167g. */
  function resolveModel(requested, models) {
    var req = String(requested || '').trim() || FALLBACK_MODEL;
    var list = chatModels(models);
    for (var i = 0; i < list.length; i++) { if (norm(list[i]) === norm(req)) return { model: list[i], requested: req, installed: true, usedFallback: false, why: null }; }
    for (var j = 0; j < PREFERRED_MODELS.length; j++) {
      for (var k = 0; k < list.length; k++) {
        if (norm(list[k]) === norm(PREFERRED_MODELS[j])) return { model: list[k], requested: req, installed: true, usedFallback: true, why: req + ' is not installed — using ' + list[k] };
      }
    }
    return { model: null, requested: req, installed: false, usedFallback: false,
      why: req + ' is not installed' + (list.length ? ' — installed: ' + list.join(', ') + ' (pick one)' : ' — ollama pull ' + req) };
  }

  /** the selector's options: every installed, non-embedding tag, and the requested one marked when nothing resolved it */
  function modelOptions(requested, models) {
    var list = chatModels(models);
    var r = resolveModel(requested, list);
    var opts = list.map(function (m) { return { value: m, label: m, selected: r.model === m, installed: true }; });
    if (!r.installed) opts.unshift({ value: r.requested, label: r.requested + ' (not installed)', selected: true, installed: false });
    return opts;
  }

  /** the pill's face — 🟢 Online (<port>) · <tag>, or the requested tag's absence, or 🔴 Engine Offline */
  function face(p, requested) {
    if (!p || !p.online) return OFFLINE_FACE;
    var r = resolveModel(requested, p.models);
    if (r.installed && r.usedFallback) return '🟢 Online (' + p.port + ') · using ' + r.model + ' — requested ' + r.requested + ' not installed';
    return '🟢 Online (' + p.port + ') · ' + (r.installed ? r.model : r.requested + ' not installed');
  }

  /** the receipt the steer page reads: the probe and the requested tag — never a message, never a transcript */
  var RECEIPT_KEYS = ['at', 'host', 'port', 'online', 'models', 'ms', 'error', 'requested', 'model', 'face'];
  function probeReceipt(p, requested) {
    var r = resolveModel(requested, p && p.models);
    var full = Object.assign({}, p, { requested: r.requested, model: r.model, face: face(p, requested) });
    var out = {}; RECEIPT_KEYS.forEach(function (k) { out[k] = full[k] === undefined ? null : full[k]; });
    return out;
  }

  /** split an NDJSON buffer into complete JSON rows and the unfinished tail */
  function parseLines(buf) {
    var parts = buf.split('\n'), rest = parts.pop(), rows = [];
    for (var i = 0; i < parts.length; i++) { var l = parts[i].trim(); if (!l) continue; try { rows.push(JSON.parse(l)); } catch (e) { /* a torn line is dropped, never thrown */ } }
    return { rows: rows, rest: rest };
  }

  /**
   * POST /api/chat {model, messages, stream:true} and hand every token to onToken as it arrives. Resolves (never rejects) with
   * {ok, text, tokens, tps, ms, error}. tps is ollama's own eval_count / eval_duration when the final row carries them, else
   * streamed chunks ÷ wall seconds. `messages` is the caller's history, sent as-is and kept nowhere here.
   */
  function streamChat(opts) {
    var host = base(opts.host), f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null), onToken = opts.onToken || function () {};
    // C246 — the model's chain of thought is kept apart from the answer: ollama's message.thinking field (think:true), or a
    // <think>…</think> block a thinking model inlines into content; the answer is what is left, so the CoT never pollutes it
    var t0 = Date.now(), text = '', thinking = '', chunks = 0, final = null, inThink = false, onThinking = opts.onThinking || function () {};
    var done = function (ok, error) {
      var secs = (Date.now() - t0) / 1000;
      var tokens = final && final.eval_count ? final.eval_count : chunks;
      var tps = final && final.eval_count && final.eval_duration ? final.eval_count / (final.eval_duration / 1e9) : (secs > 0 ? chunks / secs : null);
      return { ok: ok, text: text, thinking: thinking, tokens: tokens, tps: tps == null ? null : Math.round(tps * 10) / 10, ms: Date.now() - t0, error: error || null };
    };
    if (!f) return Promise.resolve(done(false, 'no fetch in this runtime'));
    if (!opts.model) return Promise.resolve(done(false, 'no model — pick an installed tag'));
    var req = { model: opts.model, messages: opts.messages || [], stream: true };
    if (opts.think != null) req.think = !!opts.think;
    if (opts.options) req.options = opts.options;   // e.g. {temperature: 0, seed: 7} — a re-runnable worker, never a picker
    var body = JSON.stringify(req);
    return f(host + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, signal: opts.signal }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { return done(false, 'HTTP ' + r.status + (t ? ' — ' + t.slice(0, 160) : '')); });
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      var take = function (rows) {
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row.error) throw new Error(String(row.error));
          var th = row.message && row.message.thinking;
          if (th) { thinking += th; onThinking(th); }
          var t = row.message && row.message.content;
          while (t) {
            if (inThink) { var e = t.indexOf('</think>'); if (e < 0) { thinking += t; onThinking(t); t = ''; } else { thinking += t.slice(0, e); onThinking(t.slice(0, e)); inThink = false; t = t.slice(e + 8); } continue; }
            var b = t.indexOf('<think>'); if (b >= 0) { var pre = t.slice(0, b); if (pre) { text += pre; chunks++; onToken(pre); } inThink = true; t = t.slice(b + 7); continue; }
            text += t; chunks++; onToken(t); t = '';
          }
          if (row.done) final = row;
        }
      };
      var pump = function () {
        return reader.read().then(function (x) {
          if (x.done) { var p = parseLines(buf + '\n'); take(p.rows); return done(true); }
          var q = parseLines(buf + dec.decode(x.value, { stream: true })); buf = q.rest; take(q.rows);
          return pump();
        });
      };
      return pump();
    }).catch(function (e) {
      var aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      return done(false, aborted ? 'stopped' : String((e && e.message) || e).slice(0, 200));
    });
  }

  // C263 (U0, operator D4 2026-09-25: "Cap the context sent to Gemma's chat window to ensure it never breaches its hard 8,192-token
  // architectural ceiling"). gemma2:2b was sent 9,829 tokens; ollama cut the MIDDLE silently and the request 500'd after 14.5 s.
  // The window is READ, never typed: /api/show's model_info '<arch>.context_length', clamped to the server's own default context
  // (OLLAMA_CONTEXT_LENGTH, 16,384 in the plist) so a 40k-context model never asks the server for 40k of KV cache. Tokens are
  // ESTIMATED at CHARS_PER_TOKEN (3 — below the ~4 English averages, so the estimate over-counts and the fit errs short, never long),
  // and REPLY_RESERVE tokens are held back for the answer. The trim cuts the system message's MIDDLE and keeps its head (the
  // capabilities, the instructions) and its tail (the newest steer state); older history turns go before the system message is cut.
  var SERVER_CTX = 16384, CHARS_PER_TOKEN = 3, REPLY_RESERVE = 1024;
  var estTokens = function (s) { return Math.ceil(String(s || '').length / CHARS_PER_TOKEN); };
  function contextLength(opts) {
    var host = base(opts.host), f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f || !opts.model) return Promise.resolve(null);
    return f(host + '/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: opts.model }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var mi = (j && j.model_info) || {}, n = null;
        Object.keys(mi).forEach(function (k) { if (/\.context_length$/.test(k) && typeof mi[k] === 'number') n = mi[k]; });
        return n;
      }).catch(function () { return null; });
  }
  /** fit messages into ctx tokens: {messages, num_ctx, before, after, trimmed} — a pure function, the guard runs it without a server */
  function fitMessages(messages, modelCtx, serverCtx) {
    var ctx = Math.min(modelCtx || SERVER_CTX, serverCtx || SERVER_CTX), budget = ctx - REPLY_RESERVE;
    var msgs = (messages || []).map(function (m) { return { role: m.role, content: String(m.content || '') }; });
    var total = function () { return msgs.reduce(function (a, m) { return a + estTokens(m.content) + 4; }, 0); };
    var before = total();
    // 1. drop the oldest non-system turns, never the last user turn
    while (total() > budget) {
      var i = -1; for (var k = 0; k < msgs.length - 1; k++) { if (msgs[k].role !== 'system') { i = k; break; } }
      if (i < 0) break; msgs.splice(i, 1);
    }
    // 2. cut the system message's middle
    var si = -1; for (var q = 0; q < msgs.length; q++) { if (msgs[q].role === 'system') { si = q; break; } }
    if (total() > budget && si >= 0) {
      var over = total() - budget, s = msgs[si].content, keep = Math.max(0, s.length - (over + 16) * CHARS_PER_TOKEN - 64);
      var head = Math.floor(keep * 0.4), tail = keep - head;
      msgs[si].content = s.slice(0, head) + '\n…[' + (s.length - keep) + ' chars of steer state cut to fit ' + ctx + ' tokens]…\n' + (tail > 0 ? s.slice(s.length - tail) : '');
    }
    var after = total();
    return { messages: msgs, num_ctx: ctx, before: before, after: after, trimmed: after < before };
  }
  /** the status line the chat prints when it trimmed — the number is the estimate, and says so */
  function fitNote(fit, model) {
    return fit && fit.trimmed ? 'trimmed ~' + fit.before.toLocaleString('en-US') + ' → ~' + fit.after.toLocaleString('en-US') + ' tokens (' + model + ' ctx ' + fit.num_ctx.toLocaleString('en-US') + ')' : '';
  }

  /** the three doors every assistant message carries — the fold is the ONLY path text takes out of this chat, into vna.clipIngest */
  function actionsFor(text) {
    return [
      { id: 'copy', label: '📋 Copy', post: { type: 'copy', text: text } },
      { id: 'fold', label: '📋→🌳 Fold to Tree', post: { cmd: 'vna.clipIngest', text: text } },
      { id: 'goal', label: '⚡ Run as Goal', post: { cmd: 'vna.ingestGoal', text: text } },
    ];
  }

  /** the conversation — an array in memory; clear() frees it and writes nowhere */
  function createSession() {
    var history = [];
    return {
      push: function (role, content) { history.push({ role: role, content: String(content) }); return history.length; },
      messages: function () { return history.map(function (m) { return { role: m.role, content: m.content }; }); },
      size: function () { return history.length; },
      clear: function () { history.length = 0; },
    };
  }

  return { DEFAULT_HOST: DEFAULT_HOST, FALLBACK_MODEL: FALLBACK_MODEL, PROBE_MS: PROBE_MS, OFFLINE_FACE: OFFLINE_FACE, OFFLINE_LINE: OFFLINE_LINE, PILL_LABEL: PILL_LABEL,
    PREFERRED_MODELS: PREFERRED_MODELS, isEmbedModel: isEmbedModel, chatModels: chatModels,
    RECEIPT_KEYS: RECEIPT_KEYS, portOf: portOf, probe: probe, resolveModel: resolveModel, modelOptions: modelOptions, face: face, probeReceipt: probeReceipt,
    parseLines: parseLines, streamChat: streamChat, SERVER_CTX: SERVER_CTX, contextLength: contextLength, fitMessages: fitMessages, fitNote: fitNote, actionsFor: actionsFor, createSession: createSession };
});
