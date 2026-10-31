// One append log per family, never one dated file per run (operator 2026-10-13: the 1k+ untracked
// files). A dated file per run costs every `git status -uall` a walk and fseventsd a create event;
// one ndjson row retains the same record (AXIOM 1: retain, never free) in one inode.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export function appendRecord(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n');
  return path;
}

// Fold the dated files a generator left behind into its append log, then remove them.
// Each file becomes one row { at: <file stem>, file, ...content }; a file that will not parse is
// kept on disk and reported, never dropped.
export function foldDated(dir, re, logPath, { stamp = (f) => f } = {}) {
  const folded = [], kept = [];
  for (const f of readdirSync(dir).filter((n) => re.test(n)).sort()) {
    const p = join(dir, f);
    let body;
    try { body = JSON.parse(readFileSync(p, 'utf8')); } catch { kept.push(f); continue; }
    appendRecord(logPath, { at: stamp(f), file: f, ...(body && typeof body === 'object' && !Array.isArray(body) ? body : { value: body }) });
    unlinkSync(p);
    folded.push(f);
  }
  return { folded, kept };
}

// Content-addressed retention: the same bytes land at one path, written once. A per-run copy of
// identical content is a new file per run with no new information (replay briefs 2026-10-13: 270
// files, 26 distinct contents).
export function retainByContent(dir, text, ext = '.txt') {
  const p = join(dir, createHash('sha256').update(text).digest('hex').slice(0, 16) + ext);
  if (!existsSync(p)) { mkdirSync(dir, { recursive: true }); writeFileSync(p, text); }
  return p;
}
