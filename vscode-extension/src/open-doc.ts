// packages/thetacog-mcp-vscode/src/open-doc.ts — C109e, the pure half of two doors. No vscode import, so the guard
// (tests/vna/c109e-every-reference-opens-its-doc.test.mjs) runs it under tsx the way C102a runs device-door.ts.
//
//   insideRepo(cwd, rel)  — vna.openFile's path guard: the page hands over a repo-relative receipt path (data/vna/*,
//                           docs/specs/vna/*, .thetacog/*); anything that resolves outside cwd (absolute, `..`, a URL,
//                           an empty string) is refused with null, never opened. The page is rendered from receipts and
//                           mounted in a webview; a path is data, and data does not get to name a file outside the repo.
//   rowLine(specText, label) — vna.viewUnit's row finder, now taking the label the page clicked (C109e) as well as the
//                           /goal's current unit (C98d): the 0-based line of `- [ ] <label>` or `- [x] <label>` at any
//                           indent (rows under a parent are indented two spaces), or -1.
import * as path from 'path';

export function insideRepo(cwd: string, rel: unknown): string | null {
    if (typeof rel !== 'string' || !rel.trim() || !cwd) { return null; }
    if (path.isAbsolute(rel) || /^[a-z]+:/i.test(rel) || rel.includes('\0')) { return null; }
    const root = path.resolve(cwd);
    const abs = path.resolve(root, rel);
    const inside = abs === root ? false : abs.startsWith(root + path.sep);
    return inside ? abs : null;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function rowLine(specText: string, label: string | null | undefined): number {
    if (!label) { return -1; }
    const re = new RegExp(`^\\s*- \\[[ x]\\] ${escapeRe(label)}\\b`);
    return String(specText || '').split('\n').findIndex((l) => re.test(l));
}
