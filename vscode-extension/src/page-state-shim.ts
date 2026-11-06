// packages/thetacog-mcp-vscode/src/page-state-shim.ts — A REPAINT CLOSES NOTHING (C203 (2), the host half).
//
// Every steer-ui.mjs render is a fresh document set with webview.html, and the operator saw it as "the left panel keeps
// refreshing and auto closing things": the open <details> came back only where the page's OPEN_STATE_SCRIPT could match
// an id, the scroll position was never restored, and a half-typed line in the inline chat or the key box was gone. Two
// causes at the host: (a) the page's open-state save wrote setState({open}) and so ERASED every other key the view kept
// (the chat's cached turns, anything else); (b) nothing saved scroll or inputs at all.
//
// THE SHIM (appended by bridge() after the page, before the page's own scripts have finished their first paint):
//   1. setState MERGES — the API object is patched once so every caller, the page's included, patches rather than replaces;
//   2. scroll is saved on every scroll (trailing 150 ms) and restored immediately and again on load;
//   3. every text input / textarea with an id is saved on input and restored when the fresh document's copy is empty.
// A plain string, not a function, because it runs INSIDE the webview; the guard executes it against a stub DOM.
// @guard tests/vna/c203-the-refresh-is-one-visible-pattern.test.mjs

export const PAGE_STATE_SHIM = `(function(){
  var api = (typeof _vs !== 'undefined' && _vs) ? _vs : null; if (!api) return;
  if (!api.__merge) {                                   // (1) merge, patched once per API object
    var raw = api.setState.bind(api);
    api.setState = function (p) { var cur = {}; try { cur = api.getState() || {}; } catch (e) {} return raw(Object.assign({}, cur, p)); };
    api.__merge = true;
  }
  function st() { try { return api.getState() || {}; } catch (e) { return {}; } }
  var s = st();
  function restoreScroll() { var y = s.scrollY; if (typeof y === 'number' && y > 0) { try { window.scrollTo(0, y); } catch (e) {} } }
  restoreScroll(); window.addEventListener('load', restoreScroll);                                   // (2)
  var t = null; window.addEventListener('scroll', function () { if (t) clearTimeout(t); t = setTimeout(function () { api.setState({ scrollY: window.scrollY || (document.scrollingElement ? document.scrollingElement.scrollTop : 0) }); }, 150); }, { passive: true });
  var inputs = s.inputs || {};                                                                     // (3)
  var els = document.querySelectorAll('textarea[id], input[id]');
  for (var i = 0; i < els.length; i++) { var el = els[i]; var ty = (el.getAttribute('type') || 'text').toLowerCase();
    if (el.tagName !== 'TEXTAREA' && ty !== 'text' && ty !== 'search' && ty !== 'password') continue;
    if (inputs[el.id] && !el.value) el.value = inputs[el.id]; }
  document.addEventListener('input', function (ev) { var el = ev.target; if (!el || !el.id) return; var m = st().inputs || {}; m[el.id] = el.value; api.setState({ inputs: m }); }, true);
})();`;
