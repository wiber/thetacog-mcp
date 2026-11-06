// packages/thetacog-mcp-vscode/src/standing-answers.ts — C921 the extension's half of the holder's
// readiness check: the ten standing questions (bundled read-only from standing-questions.json, which
// scripts/backup/emit-standing-questions.mjs copies byte-for-byte from the one source,
// src/lib/backup/standing-answers.mjs — NEVER retype a question here, regenerate instead) and the
// read/write of the holder's own .thetacog/deployer-playbook.json.
//
// AXIOM 1 (record conservation): a save never overwrites the prior answers — it APPENDS them to
// `revisions` first, then writes the new answer. The holder's playbook accumulates what they believed
// and when, never just what they believe now.
//
// @guard tests/site/c921-the-standing-answers.test.mjs
import { promises as fs } from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import standingQuestionsData from './standing-questions.json';

export type SliderSpec = { label: string; unit: string; min: number; max: number; step: number };
export type ChoiceSpec = { label: string; options: string[] };
export type NumberSpec = { id: string; label: string; unit: string };
export type DateSpec = { id: string; label: string };
export type DecisionSpec = { label: string; options: string[] };
export type Question = {
    id: string; pair: number; n: number; title: string; kind: string; draft: 'ai' | 'you';
    short: string; fill: string; ask: string; teach: string; suggestion?: string; tests?: string;
    slider?: SliderSpec; choice?: ChoiceSpec; numbers?: NumberSpec[]; date?: DateSpec; decision?: DecisionSpec;
};

export type ReadingRow = { id: string; status: string; why: string | null };
const bundled = standingQuestionsData as { version: number; playbookFile: string; readinessLine: string; copyAllLead: string; licenceKey?: string; pairs: { n: number; name: string; line: string }[]; parts?: Record<string, string>; questions: Question[]; readings?: ReadingRow[] };

export const QUESTIONS: Question[] = bundled.questions;
export const PLAYBOOK_VERSION: number = bundled.version;
export const PLAYBOOK_FILE: string = bundled.playbookFile;   // '.thetacog/deployer-playbook.json'
export const READINESS_LINE: string = bundled.readinessLine;
export const COPY_ALL_LEAD: string = bundled.copyAllLead;
export const LICENCE_KEY: string = bundled.licenceKey || '';   // C921q: the pricing key, read off the Stripe record at emit time
export const PAIRS = bundled.pairs;
export const PARTS: Record<string, string> = bundled.parts || {};   // C921j: the stack part each question sets (The spec, The routing, …)   // C921f: the five orthogonal pairs the ten are read in
// C930: the extension holds no live tape, so this is standingEvaluation() (C922) bundled once, over an empty
// playbook and no readings — every one of the ten UNMEASURED with why, honest about what the side panel cannot
// yet read locally. Regenerate with the rest: node scripts/backup/emit-standing-questions.mjs.
export const READINGS: Record<string, ReadingRow> = Object.fromEntries((bundled.readings || []).map((r) => [r.id, r]));

export type Answer = {
    text: string;
    drafted_by_model: boolean;
    slider: number | null;
    choice: string | null;
    numbers: Record<string, number | null> | null;
    // C937: standing answer 10's own stop date, and what the holder recorded on reading it. Every other
    // question leaves both null — nothing else reads them.
    date: string | null;
    decision: string | null;
};
export type Revision = { at: string; answers: Record<string, Answer> };
export type Playbook = {
    version: number;
    updated_at: string;
    signed: string | null;
    answers: Record<string, Answer>;
    revisions?: Revision[];
};

const blankAnswer = (): Answer => ({ text: '', drafted_by_model: false, slider: null, choice: null, numbers: null, date: null, decision: null });

// C937 — the SAME rule as stopDateDue in the mjs source (the vsix cannot import it at runtime, so this is
// the bundled mirror; guard: tests/vna/c937-your-stop-date-comes-due.test.mjs holds the two in step).
export const STOP_DUE_LINE = 'Your stop date is due: read your number';
export function stopDue(pb: Playbook | null | undefined, now: Date = new Date()): { due: boolean; date: string | null; decision: string | null } {
    const a = (pb && pb.answers && pb.answers['level-and-stop']) || ({} as Partial<Answer>);
    if (!a.date) { return { due: false, date: null, decision: a.decision || null }; }
    if (a.decision) { return { due: false, date: a.date, decision: a.decision }; }
    return { due: new Date(a.date).getTime() <= now.getTime(), date: a.date, decision: null };
}

/** an empty playbook in the shape the holder's file takes — one entry per question, nothing filled */
export function emptyPlaybook(now: string = new Date().toISOString()): Playbook {
    return { version: PLAYBOOK_VERSION, updated_at: now, signed: null,
        answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, blankAnswer()])) };
}

// the same counting rule as answeredCount in the source: text present, or a slider/choice/number set — never a score
function isAnswered(a: Partial<Answer> | undefined): boolean {
    if (!a) { return false; }
    return Boolean(a.text && a.text.trim() && !/___/.test(a.text)) || a.slider != null || a.choice != null
        || Boolean(a.numbers && Object.values(a.numbers).some((v) => v != null));
}

/** the readiness line every surface prints: N of ten answered, and how many your AI could still draft */
export function readiness(pb: Playbook | null | undefined): { answered: number; of: number; aiCanDraft: string[]; onlyYou: string[] } {
    const answers = (pb && pb.answers) || {};
    const open = QUESTIONS.filter((q) => !isAnswered(answers[q.id]));
    return {
        answered: QUESTIONS.length - open.length,
        of: QUESTIONS.length,
        aiCanDraft: open.filter((q) => q.draft === 'ai').map((q) => q.id),
        onlyYou: open.filter((q) => q.draft === 'you').map((q) => q.id),
    };
}

function playbookPath(workspaceRoot: string): string { return path.join(workspaceRoot, PLAYBOOK_FILE); }

/** the holder's file, or an empty one if it has never been written */
export async function readPlaybook(workspaceRoot: string): Promise<Playbook> {
    try { return JSON.parse(await fs.readFile(playbookPath(workspaceRoot), 'utf8')) as Playbook; }
    catch { return emptyPlaybook(); }
}

// Every save APPENDS the prior `answers` object to `revisions` before applying the patch — never
// overwrites history (AXIOM 1: evict or retain, never free) — and bumps updated_at.
export async function savePlaybookAnswer(workspaceRoot: string, questionId: string, patch: Partial<Answer>): Promise<Playbook> {
    const pb = await readPlaybook(workspaceRoot);
    const revisions = [...(pb.revisions || []), { at: pb.updated_at, answers: pb.answers }];
    const prior = pb.answers[questionId] || blankAnswer();
    // `numbers` is itself a {id: value} map (C921 Q4 has three) — a patch naming one must not blank the others.
    const numbers = patch.numbers ? { ...(prior.numbers || {}), ...patch.numbers } : prior.numbers;
    const next: Playbook = {
        version: pb.version || PLAYBOOK_VERSION,
        signed: pb.signed ?? null,
        updated_at: new Date().toISOString(),
        revisions,
        answers: { ...pb.answers, [questionId]: { ...prior, ...patch, numbers } },
    };
    const p = playbookPath(workspaceRoot);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(next, null, 2));
    return next;
}

/** C921d — the clipboard block for "Copy all ten + my answers", the SAME text src/lib/backup/standing-answers.mjs copyAllText() builds
 *  (the guard compares the two on one playbook; the vsix cannot import the mjs, so the format is held equal by the guard, not by sharing) */
export function copyAllText(pb: Partial<Playbook> | null, key: string = LICENCE_KEY): string {
    const a: Record<string, Partial<Answer>> = (pb && pb.answers) || {};
    const one = (q: Question): string => { const x = a[q.id] || {};
        const parts: string[] = [x.text && x.text.trim() ? x.text.trim() : '(no answer yet)'];
        if (x.choice) { parts.push(`choice: ${x.choice}`); }
        if (x.slider != null && q.slider) { parts.push(`${q.slider.label}: ${x.slider} ${q.slider.unit}`); }
        if (x.numbers && q.numbers) { const nums = x.numbers; parts.push(q.numbers.map((n) => `${n.label}: ${nums[n.id] ?? '?'} ${n.unit}`).join(' · ')); }
        return `${q.n}. ${q.title}\nQ: ${q.ask}\nWhat the tape can and cannot measure: ${q.teach}\nAnswer shape: ${q.fill}\nMy answer: ${parts.join(' · ')}`; };
    const body = [COPY_ALL_LEAD, '', ...QUESTIONS.map(one).join('\n\n').split('\n')];
    return (key ? [...body, '', key] : body).join('\n');
}

/** C921j — Claude's cleaned reply ("1. …" … "10. …") → { id: text }; the SAME rule as parseCleanedAnswers in the mjs (guard-held equal) */
export function parseCleanedAnswers(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = /^\s*\**\s*(\d{1,2})\s*[.)]\s*\**\s*(.*\S)\s*$/.exec(line); if (!m) { continue; }
        const q = QUESTIONS.find((x) => x.n === Number(m[1])); if (!q || out[q.id] !== undefined) { continue; }
        if (/^\(?(skip|skipped|n\/a|—|-)\)?\.?$/i.test(m[2].trim())) { continue; }   // C921r: an explicit skip leaves the box as it is
        out[q.id] = m[2];
    }
    return out;
}
