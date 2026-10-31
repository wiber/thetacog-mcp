// packages/thetacog-mcp-vscode/src/webview-patch.ts — THE SIDEBAR IS ONE DOCUMENT, PATCHED IN PLACE (C564).
//
// Operator 2026-10-02, verbatim: "the left side panel flickers, so when a + is open it closes for no reason, lets fix that,
// maybe svg all". The fifth report (C203, C79a, C173c, C530 each fixed the RESTORE after a fresh document). The CAUSE was
// never touched: VnaViewProvider.refresh() assigned `webview.html = …` on every receipt write — the page watcher, the
// cockpit watcher, the 1.2 s repaint after every button — and every assignment destroys the document, so every open "+"
// <details> is re-parsed closed and has to be put back. Measured on the tree: the watchers fire on the steer page,
// cockpit.json and envelope.json, the page itself is re-rendered by a working-tree preview on every scripts/src/tests save,
// and `refresh()` reassigned even when the page bytes had not moved (a custom page was re-assigned on EVERY refresh).
//
// THE FIX AT THE ROOT — the host never replaces a live steer document:
//   (a) an identical page assigns NOTHING (WebviewDoor.show → 'skip');
//   (b) a changed steer page is POSTED to the loaded document and PAGE_PATCH_SCRIPT morphs it in place — same element
//       nodes, attributes and text updated, the `open` attribute of every <details> left exactly as the hand left it, so no
//       frame is ever painted closed and nothing re-parses (listeners on kept nodes survive with them);
//   (c) only a change of KIND (steer ↔ a custom page ↔ the fallback render), a page the morph cannot read, or a webview
//       that refused the post, assigns a fresh document — and that path still has OPEN_STATE_SCRIPT (C79a/C530).
// "maybe svg all" was the operator's guess at a mechanism: with the document never rebuilt there is nothing for SVG to fix,
// so the page is NOT converted to SVG.
//
// C647m (operator 2026-10-05, "make sure the left extension panel never flickers or auto closes pills (same with the online
// design)") — two holes C564 left open, both measured on this host:
//   (d) THE DOOR OUTLIVED ITS WEBVIEW. VS Code calls resolveWebviewView again when a view is disposed and re-created (moved to
//       another container, closed and reopened); the new webview has NO document, but the door still remembered the page it
//       had shown in the old one, so the first refresh of the new view returned 'skip' and the panel stayed BLANK until the
//       page bytes next moved. The door now binds its record to the webview object it assigned; a different webview is a
//       view with no document, and gets one.
//   (e) A PAGE READ MID-WRITE REPLACED THE LIVE ONE. steer-ui.mjs writes its ~2 MB page with a plain writeFileSync and the
//       page watcher refreshes on every change event, so a read can land on a truncated file (measured: 2 torn reads in 439
//       during a 300-write storm on this machine). An EMPTY read fell through to the fallback render (a different document,
//       assigned while the view is visible, then the steer page assigned again: the whole panel flashed); a TORN read was
//       morphed in and removed every node past the tear (pills gone, the scroll clamped to the shorter page). paintSteer()
//       is the one decision: a read whose bytes do not match the file's settled size is HELD while a steer document is live.
// The morph itself is morphKeepOpen below — ONE function, inlined into the webview's script and imported by the site
// (src/components/receipt/KeepOpenHtml.tsx), so the sidebar and the online pills cannot drift.
// @guard tests/vna/c564-the-left-side-panel-flickers-so.test.mjs · tests/vna/c647m-pills-never-flicker-or-auto-close.test.mjs

export const PATCH_TYPE = 'vnaPatch';
export const PATCH_FAILED_TYPE = 'vnaPatchFailed';

export type WebviewLike = { html: string; postMessage(message: unknown): Thenable<boolean> | Promise<boolean> | boolean };
export type DoorAction = 'skip' | 'patch' | 'assign' | 'hold';

// Only the steer page is patched: it is the one document that carries a `.wrap` and PAGE_PATCH_SCRIPT's listener with a
// stable shape between renders. A custom page or the fallback render is assigned (and then skipped while unchanged).
const PATCHABLE = new Set(['steer']);

export class WebviewDoor {
    private kind?: string;      // the kind of the document that is live
    private shown?: string;     // the page that document currently shows (assigned or patched in)
    private doc?: WebviewLike;  // C647m (d): the webview that document lives in — a re-resolved view is a different one
    constructor(private readonly webview: () => WebviewLike | undefined) {}

    // Show `page` (the raw page) of `kind`; `build` turns it into the full document (CSP + shim) when a document is needed.
    show(kind: string, page: string, build: (page: string) => string): DoorAction {
        const wv = this.webview();
        if (!wv) { return 'skip'; }
        if (this.doc !== wv) { this.kind = undefined; this.shown = undefined; }   // a new webview carries no document of ours
        if (this.kind === kind && this.shown === page) { return 'skip'; }
        if (this.kind === kind && PATCHABLE.has(kind) && this.shown !== undefined) {
            this.shown = page;
            const posted = wv.postMessage({ type: PATCH_TYPE, html: page });
            // a webview that did not take the post (disposed, not yet live) gets a fresh document with the latest page
            void Promise.resolve(posted).then((ok) => { if (ok === false && this.shown === page) { this.assign(kind, page, build); } }, () => { if (this.shown === page) { this.assign(kind, page, build); } });
            return 'patch';
        }
        this.assign(kind, page, build);
        return 'assign';
    }

    // The page answered that it could not morph (no .wrap on one side): the next show() builds a fresh document.
    invalidate(): void { this.kind = undefined; this.shown = undefined; }

    // C647m (e): is a document of this kind live in the current webview?
    live(kind: string): boolean { const wv = this.webview(); return !!wv && this.doc === wv && this.kind === kind; }

    private assign(kind: string, page: string, build: (page: string) => string): void {
        const wv = this.webview(); if (!wv) { return; }
        wv.html = build(page);
        this.kind = kind; this.shown = page; this.doc = wv;
    }
}

// THE ONE MORPH THAT NEVER CLOSES A PILL (C647m). Replacing a live container's HTML (webview.html = …, React's
// dangerouslySetInnerHTML, el.innerHTML = …) re-parses every <details> closed: that is the auto-close. This morphs a fresh render
// into the live one instead: element nodes matched by tag + id (a pill is keyed by its stable id, never its index), attributes
// and text updated in place, the `open` attribute of a <details> never touched. A plain function closing over nothing, so
// PAGE_PATCH_SCRIPT inlines morphKeepOpen.toString() and the site imports it: the same bytes run in both. `doc` owns `live`.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function morphKeepOpen(live: any, fresh: any, doc: any): void {
    function attrs(a: any, b: any): void {
        var keepOpen = a.nodeName === 'DETAILS', i: number, n: any;
        for (i = 0; i < b.attributes.length; i++) { n = b.attributes[i]; if (keepOpen && n.name === 'open') continue; if (a.getAttribute(n.name) !== n.value) a.setAttribute(n.name, n.value); }
        for (i = a.attributes.length - 1; i >= 0; i--) { n = a.attributes[i]; if (keepOpen && n.name === 'open') continue; if (!b.hasAttribute(n.name)) a.removeAttribute(n.name); }
        var focused = doc.activeElement === a;
        if (a.nodeName === 'INPUT' && !focused) { var t = (a.getAttribute('type') || '').toLowerCase(); if (t === 'checkbox' || t === 'radio') a.checked = b.hasAttribute('checked'); }
    }
    function same(a: any, b: any): boolean { return a.nodeType === b.nodeType && a.nodeName === b.nodeName && (a.nodeType !== 1 || (a.id || '') === (b.id || '')); }
    function morph(a: any, b: any): void {
        if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
        attrs(a, b);
        // a textarea's text is its DEFAULT value: an untouched one (the copy payload) follows it, a half-typed one keeps the hand's text
        if (a.nodeName === 'TEXTAREA') { if (a.defaultValue !== b.defaultValue) a.defaultValue = b.defaultValue; return; }
        children(a, b);
    }
    function children(a: any, b: any): void {
        var bc: any[] = Array.prototype.slice.call(b.childNodes), i: number, j: number;
        for (i = 0; i < bc.length; i++) {
            var bn = bc[i], an = a.childNodes[i] || null;
            if (an && same(an, bn)) { morph(an, bn); continue; }
            var hit: any = null;
            if (bn.nodeType === 1 && bn.id) { for (j = i + 1; j < a.childNodes.length; j++) { if (same(a.childNodes[j], bn)) { hit = a.childNodes[j]; break; } } }
            if (hit) { a.insertBefore(hit, an); morph(hit, bn); }
            else { a.insertBefore(doc.importNode(bn, true), an); }
        }
        while (a.childNodes.length > bc.length) a.removeChild(a.lastChild);
    }
    children(live, fresh);
}

// C647m (e): one read of the steer page file — its bytes, and the file's size settled across the read (stat before and after
// agreed), or -1 when the file moved under the read. undefined = there is no page file.
export type SteerRead = { page: string; size: number } | undefined;

// Whole = non-empty and exactly the bytes the settled file holds. Anything else is a write in flight.
export function pageWhole(read: SteerRead): boolean {
    return !!read && read.size > 0 && Buffer.byteLength(read.page, 'utf8') === read.size;
}

// THE ONE STEER-PAINT DECISION (vna-view.ts refresh): a whole page goes through the door (skip / patch / assign); a page read
// mid-write is HELD while a steer document is live — the watcher's next change event brings the whole page — and only with
// no steer document live does the caller paint its fallback ('none').
export function steerFit(door: WebviewDoor, read: SteerRead): 'paint' | 'hold' | 'none' {
    if (read && pageWhole(read)) { return 'paint'; }
    if (read && door.live('steer')) { return 'hold'; }
    return 'none';
}
export function paintSteer(door: WebviewDoor, read: SteerRead, build: (page: string) => string): DoorAction | 'none' {
    const fit = steerFit(door, read);
    return fit === 'paint' ? door.show('steer', read!.page, build) : fit;
}

// Runs INSIDE the webview (appended by bridge() with the rest of the shim). A plain string, so the guard replays it over a
// real parsed document. `_vs` is the shim's API handle; the patch never acquires one of its own.
export const PAGE_PATCH_SCRIPT = `(function(){
  var api = (typeof _vs !== 'undefined' && _vs) ? _vs : null;
  var morphKeepOpen = ${morphKeepOpen.toString()};
  function patch(html) {
    var next = new DOMParser().parseFromString(html, 'text/html');
    var live = document.querySelector('.wrap'), fresh = next.querySelector('.wrap');
    if (!live || !fresh) return false;
    var ls = document.querySelectorAll('style'), ns = next.querySelectorAll('style');
    for (var i = 0; i < ns.length && i < ls.length; i++) { if (ls[i].textContent !== ns[i].textContent) ls[i].textContent = ns[i].textContent; }
    morphKeepOpen(live, fresh, document);
    try { if (typeof window.__vnaOpenRestore === 'function') window.__vnaOpenRestore(live); } catch (e) {}
    return true;
  }
  window.__vnaPatch = patch;
  window.addEventListener('message', function (ev) {
    var m = ev && ev.data; if (!m || m.type !== '${PATCH_TYPE}' || typeof m.html !== 'string') return;
    var ok = false; try { ok = patch(m.html); } catch (e) { ok = false; }
    if (!ok && api) api.postMessage({ type: '${PATCH_FAILED_TYPE}' });
  });
})();`;
