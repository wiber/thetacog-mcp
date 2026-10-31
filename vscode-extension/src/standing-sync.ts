// packages/thetacog-mcp-vscode/src/standing-sync.ts — C923 THE ANSWERS SYNC BACK DOWN (operator 2026-10-17: "your standing
// answers to this should be also saved in the vscode extension as a json file! sync it back down — its the playbook, handbook,
// that proves you are capable of being a responsible deployer").
//
// PURE fs + fetch, no vscode import (the engine-key-audit.ts / licence-list.ts discipline), so the guard drives `mergeIncoming`
// directly without a vscode host. The holder edits the same ten questions (src/lib/backup/standing-answers.mjs) from /backup,
// the side panel, or by hand in .thetacog/deployer-playbook.json; both sides save through GET/PUT /api/backup/standing-answers
// (standing-answers-store.mjs, APPEND-ONLY). THE RULE (AXIOM 1 — evict or retain, never free): a pull that finds a newer server
// face never drops the local answers it is about to replace — it pushes them onto `revisions` first. The newest `updated_at`
// wins the face; the losing side's answers are RETAINED, never discarded.
//
// Do NOT edit vna-view.ts or standing-answers.ts here — a parallel worker owns them. This file only exports pull/push for
// whichever caller wires the sync (a command, a timer, the panel's own save) to call later.
// @guard tests/api/c923-standing-answers-sync-down.test.mjs
import { promises as fs } from 'fs';
import * as path from 'path';

export const PLAYBOOK_RELATIVE_PATH = path.join('.thetacog', 'deployer-playbook.json');
export const STANDING_ANSWERS_ROUTE = '/api/backup/standing-answers';

export interface PlaybookAnswers {
  version: number;
  updated_at: string;
  signed: unknown;
  answers: Record<string, unknown>;
}

export interface PlaybookRevision { playbook: PlaybookAnswers; replaced_at: string }

export interface LocalPlaybookFile extends PlaybookAnswers {
  revisions?: PlaybookRevision[];
}

/** pure: strip `revisions` down to the bare answers shape the server stores and compares by `updated_at`. */
function answersOnly(pb: PlaybookAnswers): PlaybookAnswers {
  return { version: pb.version, updated_at: pb.updated_at, signed: pb.signed, answers: pb.answers };
}

/** pure: does `incoming` (the server's face) supersede `local` (whatever is on disk)? No `updated_at` on either side, or an
 * incoming that is not strictly newer, never overwrites — equal timestamps keep the side already held. */
export function isNewer(local: PlaybookAnswers | null, incoming: PlaybookAnswers | null): boolean {
  if (!incoming || !incoming.updated_at) return false;
  if (!local || !local.updated_at) return true;
  return incoming.updated_at > local.updated_at;
}

/**
 * The one merge both pull and push read through. When `incoming` is newer, it becomes the face and local's prior answers are
 * pushed onto `revisions` (never discarded — AXIOM 1, evict or retain, never free). When it is not newer, `local` comes back
 * UNCHANGED (same reference), so a caller can tell "nothing to write" from "wrote the same bytes" by identity.
 */
export function mergeIncoming(local: LocalPlaybookFile | null, incoming: PlaybookAnswers | null): LocalPlaybookFile | null {
  if (!incoming) return local;
  if (!isNewer(local, incoming)) return local;
  const priorRevisions = local && Array.isArray(local.revisions) ? local.revisions : [];
  const revisions = local
    ? [...priorRevisions, { playbook: answersOnly(local), replaced_at: new Date().toISOString() }]
    : priorRevisions;
  return { ...answersOnly(incoming), revisions };
}

async function readLocal(workspaceRoot: string): Promise<LocalPlaybookFile | null> {
  try { return JSON.parse(await fs.readFile(path.join(workspaceRoot, PLAYBOOK_RELATIVE_PATH), 'utf8')); } catch { return null; }
}

async function writeLocal(workspaceRoot: string, playbook: LocalPlaybookFile): Promise<void> {
  const file = path.join(workspaceRoot, PLAYBOOK_RELATIVE_PATH);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(playbook, null, 2)}\n`);
}

export type PullResult = { status: 'pulled' | 'unchanged' | 'refused'; why?: string };
export type PushResult = { status: 'pushed' | 'nothing-local' | 'refused'; why?: string };

/** GET the holder's face and merge it down onto the local file — never a raw overwrite (see mergeIncoming). */
export async function pullStandingAnswers(workspaceRoot: string, bearer: string, baseUrl: string): Promise<PullResult> {
  let res: Response;
  try { res = await fetch(`${baseUrl}${STANDING_ANSWERS_ROUTE}`, { headers: { authorization: `Bearer ${bearer}` } }); }
  catch (e) { return { status: 'refused', why: `fetch failed — ${(e as Error).message}` }; }
  if (!res.ok) { const body = await res.json().catch(() => ({} as { why?: string })); return { status: 'refused', why: body.why || `GET ${res.status}` }; }
  const incoming = (await res.json().catch(() => null)) as PlaybookAnswers | null;
  const local = await readLocal(workspaceRoot);
  const merged = mergeIncoming(local, incoming);
  if (merged === local) return { status: 'unchanged' };
  if (merged) await writeLocal(workspaceRoot, merged);
  return { status: 'pulled' };
}

/** PUT the local file's answers up to the server — the server appends it as a new row; never an overwrite there either. */
export async function pushStandingAnswers(workspaceRoot: string, bearer: string, baseUrl: string): Promise<PushResult> {
  const local = await readLocal(workspaceRoot);
  if (!local) return { status: 'nothing-local' };
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${STANDING_ANSWERS_ROUTE}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ playbook: answersOnly(local) }),
    });
  } catch (e) { return { status: 'refused', why: `fetch failed — ${(e as Error).message}` }; }
  if (!res.ok) { const body = await res.json().catch(() => ({} as { why?: string })); return { status: 'refused', why: body.why || `PUT ${res.status}` }; }
  return { status: 'pushed' };
}
