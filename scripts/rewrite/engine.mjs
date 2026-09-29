// scripts/rewrite/engine.mjs
// ════════════════════════════════════════════════════════════════════════════
// THE ENGINE — keeps the writer supplied and the file honest.
//
// TWO-STAGE PIPELINE, running continuously in the background:
//
//   SCAN      the local model diagnoses paragraphs from the aperture forward,
//             producing ranked cold sentences. Cheap and fast, so it runs ahead.
//   GENERATE  each cold sentence fans out to the enabled tracks in parallel,
//             becoming a finished card. Expensive (cloud latency), so several
//             generate concurrently.
//
// The stages are decoupled by a queue: the scanner never blocks on generation.
// That decoupling is what makes "always ≥10 cards ahead of the writer" achievable
// with a 3-second cloud round-trip in the loop.
//
// ── THE OFFSET HAZARD (the thing that would silently corrupt the book) ──
// Accepting an edit changes the file's length, so every byte offset after the
// edit point shifts. Any pending card still holding pre-edit offsets would splice
// its next accepted rewrite into the WRONG PLACE — silently, with a clean-looking
// commit. So after every applied edit the file is re-parsed and every pending card
// is re-anchored by exact sentence-text match. A card whose sentence no longer
// exists verbatim is DROPPED, never guessed at. Dropping a card costs one rescan;
// guessing costs a corrupted manuscript.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractProse, contextWindow, sentenceWindow, spliceRange, lineIndex, lineAt } from './chunker.mjs';
import { diagnoseParagraph, rankFindings, DEFAULT_PERSONA } from './diagnose.mjs';
import { runTrackCard, TRACKS, TRACK_BY_ID } from './tracks.mjs';
import * as store from './store.mjs';
import { enqueue as enqueueCommit } from './commit-queue.mjs';
import { buildLearner } from './learning.mjs';
import { dropFindings, addDrop, dropSummary } from './drops.mjs';
import { recordEdit, attributionSummary } from './attribution.mjs';

const execFileAsync = promisify(execFile);

export const BUFFER_TARGET = Number(process.env.REWRITE_BUFFER || 10);
const GEN_CONCURRENCY = Number(process.env.REWRITE_GEN_CONCURRENCY || 3);
// Scanning is the bottleneck, not generation: a local diagnose costs ~20s per
// paragraph, and most paragraphs are fine, so cards are sparse. Measured
// sequentially it took ~5 minutes to surface ONE card — the ≥10-ahead buffer
// would never fill. Ollama serves concurrent requests happily, so scans are
// dispatched in parallel and the tick loop never awaits an individual one.
const SCAN_CONCURRENCY = Number(process.env.REWRITE_SCAN_CONCURRENCY || 2);
// How many cards one track may generate at once, before the per-engine semaphore.
const CLOUD_IN_FLIGHT = Number(process.env.REWRITE_CLOUD_IN_FLIGHT || 1);
const LOCAL_IN_FLIGHT = Number(process.env.REWRITE_LOCAL_IN_FLIGHT || 1);

let _id = 0;
const nextId = () => `c${Date.now().toString(36)}${(_id++).toString(36)}`;

// Mirrors diagnose.mjs's weighting so the global rank and the local rank agree
// about which failure kinds are worse. An undefined load-bearing term inverts the
// reader; a merely-long sentence does not.
const DEFECT_RANK = {
  'undefined-term': 12, 'non-sequitur': 10, 'slop': 8,
  'reread': 6, 'ambiguous': 4, 'none': 0,
};

export class RewriteEngine {
  constructor({ repoRoot, file, aperture = 0, tracks = ['A', 'B', 'C', 'D'], persona = DEFAULT_PERSONA, threshold = 80 }) {
    this.repoRoot = repoRoot;
    this.file = file;                       // absolute path
    this.relFile = path.relative(repoRoot, file);
    this.threshold = threshold;
    this.persona = persona;

    this.raw = '';
    this.paragraphs = [];
    this.pendingFindings = [];              // ranked, not yet generated
    this.servedFindings = [];               // recently handed out, kept for other tracks
    // What each track has already ATTEMPTED. Producing a card is not the only way
    // a job ends: generateCard returns immediately when the paragraph cannot be
    // resolved, and the self-calling pump then re-picked the SAME finding from
    // servedFindings forever. Measured: 417,925 runs in three minutes, zero cards.
    // A job is done when it has been tried, whether or not it produced anything.
    this.attempted = new Map();             // trackId -> Set(finding.text)
    this.trackBusy = {};                    // in-flight generations per track (count)
    this.generating = 0;
    this.scanning = 0;
    this.running = false;
    this.lastError = null;
    this.log = [];

    const slug = store.slugForFile(file);
    const prior = store.loadSession(slug);
    this.reload();

    this.session = prior && prior.file === file
      ? { ...prior, tracks, totalParagraphs: this.paragraphs.length, totalLines: this.totalLines }
      : store.newSession({
          file, slug,
          totalParagraphs: this.paragraphs.length,
          totalLines: this.totalLines,
          aperture, tracks, persona,
        });

    if (prior && prior.file === file) {
      // Resuming: re-anchor whatever was queued against the file as it is NOW.
      this.reanchorCards();
    } else {
      this.session.aperture = aperture;
      this.session.cursor = aperture;
    }
    store.saveSession(this.session);
  }

  note(msg) {
    this.log.push({ ts: new Date().toISOString(), msg });
    if (this.log.length > 200) this.log.shift();
  }

  /** Re-read + re-parse the file from disk. The single source of truth. */
  reload() {
    this.raw = fs.readFileSync(this.file, 'utf8');
    const { paragraphs, totalLines } = extractProse(this.raw, { filename: this.file });
    this.paragraphs = paragraphs;
    this.totalLines = totalLines;
    this.lineStarts = lineIndex(this.raw);   // window line numbers resolve off this
  }

  /** Build the card's edit window: five sentences either side, aperture to fit. */
  buildWindow(paragraphIndex, sentenceIndex) {
    const sw = sentenceWindow(this.paragraphs, paragraphIndex, sentenceIndex);
    if (!sw) return null;
    return {
      start: sw.start,
      end: sw.end,
      text: this.raw.slice(sw.start, sw.end),
      startLine: lineAt(this.lineStarts, sw.start),
      endLine: lineAt(this.lineStarts, Math.max(sw.start, sw.end - 1)),
      sentenceInWindow: sw.targetInWindow,
      sentencesBefore: sw.before.length,
      sentencesAfter: sw.after.length,
      radius: sw.radius,
      fitted: sw.fitted,
    };
  }

  /**
   * Re-bind every queued card to current offsets by exact sentence match.
   * Cards whose sentence text no longer appears verbatim are dropped.
   */
  reanchorCards() {
    if (!this.session?.cards?.length) return;
    const kept = [];
    let dropped = 0;
    for (const card of this.session.cards) {
      const target = card.finding?.text;
      if (!target) { dropped++; continue; }
      let found = null;
      for (const p of this.paragraphs) {
        const i = p.sentences.findIndex((x) => x.text === target);
        if (i >= 0) { found = { p, s: p.sentences[i], sentenceIndex: i }; break; }
      }
      if (!found) { dropped++; continue; }
      const win = contextWindow(this.paragraphs, found.p.index, 1, 1);
      card.finding = { ...card.finding, start: found.s.start, end: found.s.end, paragraphIndex: found.p.index, sentenceIndex: found.sentenceIndex };
      card.paragraph = this.serializeParagraph(found.p);
      card.context = {
        before: win.before.map((x) => x.text).join('\n\n'),
        after: win.after.map((x) => x.text).join('\n\n'),
      };
      // THE WINDOW MUST BE RE-ANCHORED TOO. It is the span accept() actually
      // writes, so leaving it on pre-edit offsets means the next accepted card
      // splices over the wrong bytes — a silent corruption with a clean-looking
      // commit. Guard: tests/rewrite/window-write-is-surgical.test.mjs.
      card.window = this.buildWindow(found.p.index, found.sentenceIndex);
      if (!card.window) { dropped++; continue; }
      kept.push(card);
    }
    if (dropped) this.note(`re-anchored queue: kept ${kept.length}, dropped ${dropped} stale card(s)`);
    this.session.cards = kept;
  }

  serializeParagraph(p) {
    return {
      index: p.index, text: p.text, start: p.start, end: p.end,
      startLine: p.startLine, endLine: p.endLine,
    };
  }

  /**
   * Pull in findings anchored from REAL reader drops and queue them ahead of the
   * generated ones. A model's guess about where a human stumbles is a hypothesis;
   * an actual reader saying "I lost you here" is evidence, and it should reach the
   * writer first. Called on start and after every new drop.
   */
  loadDrops() {
    let found = [];
    try { found = dropFindings(this.file, this.paragraphs); } catch (e) { this.note(`drops: ${e.message}`); return 0; }
    const have = new Set([
      ...this.session.cards.map((c) => c.finding.text),
      ...this.pendingFindings.map((f) => f.text),
      ...(this.session.done || []),
    ]);
    const fresh = found.filter((f) => !have.has(f.text) && !have.has(f.text.slice(0, 120)));
    if (!fresh.length) return 0;
    this.pendingFindings.unshift(...fresh);
    this.pendingFindings.sort((a, b) => (b.rank ?? b.coldness ?? 0) - (a.rank ?? a.coldness ?? 0));
    this.note(`${fresh.length} finding(s) from real reader drops queued ahead of generated ones`);
    store.saveSession(this.session);
    return fresh.length;
  }

  /** The flattened sentence list a drop is anchored against. */
  flatSentences() {
    const out = [];
    for (const p of this.paragraphs) {
      for (let i = 0; i < p.sentences.length; i++) {
        out.push({ text: p.sentences[i].text, paragraphIndex: p.index, sentenceIndex: i });
      }
    }
    return out;
  }

  /** ── the background loop ─────────────────────────────────────────────── */
  start() {
    if (this.running) return;
    this.running = true;
    this.note('engine started');
    this.loadDrops();
    this.tick();
  }

  stop() { this.running = false; this.note('engine stopped'); }

  async tick() {
    while (this.running) {
      try {
        if (this.session.paused) { await sleep(800); continue; }
        const need = BUFFER_TARGET - this.session.cards.length;
        const idle = need <= 0 && !this.pendingFindings.length;
        if (idle) { await sleep(1200); continue; }

        // Stage 1 — keep the finding queue stocked. Dispatched, never awaited:
        // awaiting a 20s diagnose here would stall generation behind it.
        while (
          this.running &&
          this.scanning < SCAN_CONCURRENCY &&
          this.session.cursor < this.paragraphs.length &&
          this.pendingFindings.length < need + 2
        ) {
          this.scanning++;
          this.scanNext()
            .catch((e) => this.note(`scan failed: ${e.message}`))
            .finally(() => {
              this.scanning--;
              // A finished scan may have queued findings; hand them out at once.
              this.pump();
            });
        }

        // Stage 2 — FOUR INDEPENDENT PRODUCERS. Each enabled track has its own
        // slot and pulls its own finding off the shared queue, so a slow cloud
        // call never holds up a card a fast track could already have delivered.
        // Each track may keep several generations in flight. Cloud is API-bound
        // and its throughput rises with parallelism (0.019 → 0.063 calls/s from
        // N=1 to N=6, per-call latency flat), so the cloud tracks run WIDE. Local
        // serialises on one GPU, so it stays narrow — running it wide only queues
        // work behind itself. The per-engine semaphore in limiter.mjs is the real
        // ceiling; this just makes sure we offer it enough work to saturate.
        // Producers are self-calling; the tick only nudges in case every thread
        // happened to be idle (nothing in flight to re-dispatch itself).
        this.pump();

        if (this.session.cursor >= this.paragraphs.length && !this.pendingFindings.length && this.generating === 0 && this.scanning === 0) {
          if (!this._exhaustedNoted) { this.note('reached end of document — no paragraphs left to scan'); this._exhaustedNoted = true; }
          await sleep(2000);
        }
        await sleep(150);
      } catch (err) {
        this.lastError = String(err?.message || err);
        this.note(`tick error: ${this.lastError}`);
        await sleep(1500);
      }
    }
  }

  /**
   * One dispatch pass — hand every free thread its next piece of work, choosing
   * worst-represented-arm-first against the CURRENT stack. Called by the tick loop
   * and, more importantly, by each generation as it completes, so the engine is
   * event-driven rather than poll-driven.
   */
  pump() {
    if (!this.running || this.session.paused) return;
    if (this.session.cards.length >= BUFFER_TARGET) return;
    // Re-entrancy guard. A job that fails instantly calls back into pump from its
    // own finally(); without this the stack recurses instead of yielding.
    if (this._pumping) { this._pumpAgain = true; return; }
    this._pumping = true;
    try { this._pumpOnce(); } finally {
      this._pumping = false;
      if (this._pumpAgain) { this._pumpAgain = false; setTimeout(() => this.pump(), 50); }
    }
  }

  _pumpOnce() {

    const produced = {};
    for (const t of TRACKS) if (this.session.tracks.includes(t.id)) produced[t.id] = 0;
    for (const c of this.session.cards) {
      for (const cand of c.candidates || []) {
        if (produced[cand.trackId] !== undefined) produced[cand.trackId]++;
      }
    }
    const order = TRACKS
      .filter((t) => this.session.tracks.includes(t.id))
      .sort((a, b) => (produced[a.id] - produced[b.id]) || a.id.localeCompare(b.id));

    for (const track of order) {
      if (!this.running) break;
      if (this.session.cards.length >= BUFFER_TARGET) break;
      const cap = track.engine === 'cloud' ? CLOUD_IN_FLIGHT : LOCAL_IN_FLIGHT;
      while ((this.trackBusy[track.id] || 0) < cap) {
        const finding = this.nextFindingFor(track.id);
        if (!finding) break;
        if (!this.attempted.has(track.id)) this.attempted.set(track.id, new Set());
        this.attempted.get(track.id).add(finding.text);
        this.trackBusy[track.id] = (this.trackBusy[track.id] || 0) + 1;
        this.generating++;
        this.generateCard(finding, track)
          .catch((e) => this.note(`track ${track.id} failed: ${e.message}`))
          .finally(() => {
            this.trackBusy[track.id]--;
            this.generating--;
            this.pump();          // self-calling: this thread takes the next job
          });
      }
    }
  }

  /** Diagnose the next paragraph and push any cold sentences onto the queue. */
  async scanNext() {
    const i = this.session.cursor;
    if (i >= this.paragraphs.length) return;
    this.session.cursor = i + 1;

    const d = await diagnoseParagraph(this.paragraphs, i, { persona: this.persona });
    if (!d) { store.saveSession(this.session); return; }

    const p = this.paragraphs[i];
    const rec = this.session.scanned[i] || { startLine: p.startLine, endLine: p.endLine, local: false, cloud: false };
    // Mark the engine that ACTUALLY read this paragraph, not the one we asked for
    // — the heatmap's two scan lines are only meaningful if they reflect reality.
    rec[d.engine === 'local' ? 'local' : 'cloud'] = true;
    rec.scannedBy = d.engine;
    rec.startLine = p.startLine;
    rec.endLine = p.endLine;

    if (!d.ok) {
      rec.error = d.error;
      this.session.scanned[i] = rec;
      this.note(`scan p${i} failed: ${d.error}`);
      store.saveSession(this.session);
      return;
    }

    rec.minScore = d.findings.length ? Math.min(...d.findings.map((f) => f.score)) : 100;
    rec.sentences = d.findings.length;
    this.session.scanned[i] = rec;

    const alreadyQueued = new Set([
      ...this.session.cards.map((c) => c.finding.text),
      ...this.pendingFindings.map((f) => f.text),
    ]);
    const doneSet = new Set(this.session.done || []);

    const ranked = rankFindings(d.findings)
      .filter((f) => !alreadyQueued.has(f.text))
      .filter((f) => !doneSet.has(fingerprint(f)));

    // "Good enough" is a RESULT, not silence. Record which paragraphs the reader
    // sailed through and how far above their own baseline they sat — that
    // distribution is what tells us where the prose already works, and it is the
    // control group for every edit the tool does make.
    const good = ranked.filter((f) => f.goodEnough);
    let work = ranked.filter((f) => !f.goodEnough).slice(0, 2);

    // NEVER STARVE THE STACK. On well-written prose every sentence clears the
    // good-enough bar and this queued nothing — pointed at a clean blog post the
    // console sat at 0 cards while the scanner ran happily to the end of the file.
    // That is the tool refusing to work on exactly the writing it exists for.
    // There is always a most-regressed sentence; take it, rank it low so genuine
    // breaks still come first, and let the writer decide it was fine.
    if (!work.length && good.length) {
      work = [{ ...good[0], fromGoodEnough: true, rank: (good[0].rank ?? good[0].coldness ?? 0) * 0.25 }];
    }

    if (good.length && !work.length) {
      rec.goodEnough = true;
      rec.bestScore = Math.max(...good.map((f) => f.score));
      this.note(`¶${i} clean — reader followed it (best ${rec.bestScore}, baseline ${good[0].baseline})`);
      store.appendLedger({
        kind: 'good-enough', file: this.relFile, line: p.startLine, paragraphIndex: i,
        score: rec.bestScore, baseline: good[0].baseline,
        minScore: rec.minScore, sentences: d.findings.length,
      });
    }

    // ── GLOBAL STACK-RANK ("the best fitting ones among the whole set") ──
    // The dip is computed against a LOCAL baseline, which is right for deciding
    // whether a sentence stumbles relative to its neighbours. But the ORDER the
    // writer meets them in must be global: a −55 dip found at ¶180 should be
    // served before a −12 dip found at ¶40, no matter which was scanned first.
    // Ranking only within a paragraph made the queue a scan-order accident.
    // rebuilt per scan, not per finding — it reads the whole ledger.
    this._learner = buildLearner(store.readLedger({ limit: 5000 }));
    this.session.globalScores = [...(this.session.globalScores || []), ...d.findings.map((f) => f.score)].slice(-2000);
    const gs = [...this.session.globalScores].sort((a, b) => a - b);
    const globalBaseline = gs.length ? gs[Math.floor(gs.length / 2)] : 100;

    for (const f of work) {
      f.globalBaseline = globalBaseline;
      f.globalDip = +(globalBaseline - f.score).toFixed(1);
      // Rank on the harsher of the two readings: a sentence that is weak against
      // its neighbours AND weak against the book both deserve to come first.
      const base = Math.max(f.dip ?? 0, f.globalDip) * 2 + (100 - f.score) * 0.5 + (DEFECT_RANK[f.defect] || 0);
      // THE STACK SORTS ITSELF from what you actually did with cards like this one. Demotion-only by
      // default: a class you keep declining sinks, a sentence you already passed on sinks harder, and
      // the single promotion has to be earned by a re-scan that measurably improved. `rankWhy` rides
      // along so the card can say why it moved — a ranker that reorders silently stops being trusted.
      const b = this._learner ? this._learner.bias(f) : { mult: 1, why: null };
      f.rankBias = b.mult;
      f.rankWhy = b.why;
      f.rank = +(base * b.mult).toFixed(2);
    }

    this.pendingFindings.push(...work);
    this.pendingFindings.sort((a, b) => (b.rank ?? b.coldness ?? 0) - (a.rank ?? a.coldness ?? 0));
    store.saveSession(this.session);
  }

  /**
   * Pick the next finding for a given track. Each track works the queue
   * independently, and a track never takes a sentence it has already produced a
   * card for — but two DIFFERENT tracks may both take the same sentence, which is
   * exactly the A/B: two processes proposing against the same defect, each on its
   * own card, judged by which one the writer accepts.
   */
  nextFindingFor(trackId) {
    // A track skips a sentence only if IT has already contributed options to that
    // card. Other tracks are welcome — that overlap is what fills one card with
    // alternatives from several producers, which is the comparison being tested.
    const tried = this.attempted.get(trackId) || new Set();
    const mine = new Set([
      ...this.session.cards
        .filter((c) => (c.trackResults || []).some((t) => t.trackId === trackId))
        .map((c) => c.finding.text),
      ...tried,
    ]);
    const idx = this.pendingFindings.findIndex((f) => !mine.has(f.text));
    if (idx >= 0) {
      const [finding] = this.pendingFindings.splice(idx, 1);
      // Keep it reachable by the other three producers — that overlap IS the A/B.
      this.servedFindings.push(finding);
      if (this.servedFindings.length > 60) this.servedFindings.shift();
      return finding;
    }
    // Nothing fresh: take one another track already worked, so this track still
    // contributes a comparable card instead of idling.
    return this.servedFindings.find((f) => !mine.has(f.text)) || null;
  }

  /** ONE track produces ONE card for one sentence. */
  async generateCard(finding, track) {
    const p = this.paragraphs[finding.paragraphIndex];
    if (!p) return;
    const win = contextWindow(this.paragraphs, finding.paragraphIndex, 1, 1);
    const beforeText = win.before.map((x) => x.text).join('\n\n');
    const afterText = win.after.map((x) => x.text).join('\n\n');

    const r = await runTrackCard(track, {
      finding, paragraph: p, beforeText, afterText,
      repoRoot: this.repoRoot, raw: this.raw,
      direction: finding.direction || '',
    });

    // Coverage: record which engine actually read this paragraph.
    const rec = this.session.scanned[finding.paragraphIndex] || { startLine: p.startLine, endLine: p.endLine, local: true };
    if (r.ok) rec[track.engine] = true;
    this.session.scanned[finding.paragraphIndex] = rec;

    // Per-track latency is a first-class metric of the experiment, recorded
    // whether the track succeeded or timed out — a track that cannot answer in
    // time is a result about that track, not a gap in the data.
    this.session.timing = this.session.timing || {};
    const t = this.session.timing[track.id] || { runs: 0, ok: 0, totalMs: 0, timeouts: 0, produced: 0 };
    t.runs++;
    t.totalMs += r.ms || 0;
    // A FAILURE IS NOT A TIMEOUT. Counting every non-ok result as a timeout produced the single
    // worst reading this instrument has given: tracks B and D showing "timeouts: 2, avgMs: 2".
    // A two-millisecond timeout is not a timeout, it is a track that never ran — and "timeout"
    // reads as "the model was slow", which is plausible, boring, and ignorable. The guided arm
    // of the A/B was dead for a whole session behind that word. Skips, errors and real timeouts
    // are now counted separately, and `lastError` keeps the reason where a human will see it.
    if (r.ok) {
      t.ok++; t.produced += r.candidates.length;
    } else if (r.skipped) {
      t.skipped = (t.skipped || 0) + 1;
      t.lastError = r.error || r.reason || 'skipped';
    } else if (/timeout|timed out/i.test(String(r.error || ''))) {
      t.timeouts++;
      t.lastError = r.error;
    } else {
      t.errors = (t.errors || 0) + 1;
      t.lastError = r.error || 'unknown failure';
    }
    t.avgMs = Math.round(t.totalMs / t.runs);
    this.session.timing[track.id] = t;

    if (!r.ok || !r.candidates.length) {
      this.note(`${track.id} ¶${finding.paragraphIndex}: ${r.error || 'no usable rewrite'} (${r.ms}ms)`);
      store.saveSession(this.session);
      return;
    }

    // ── THE EDITABLE WINDOW — five sentences either side, aperture to fit ──
    // The unit the writer edits, and the first thing they see. Counted in
    // SENTENCES because paragraph boundaries are arbitrary runway: a one-sentence
    // paragraph gives no context, a long one buries the flagged line. The
    // aperture then opens further if the window is too thin to carry gzip mass.
    const win5 = this.buildWindow(finding.paragraphIndex, finding.sentenceIndex);

    // ── ONE CARD PER SENTENCE, OPTIONS MERGED FROM EVERY PRODUCER ────────
    // Both halves of this matter and they were previously in conflict:
    //   · a card must offer MULTIPLE CHOICE — several alternatives the writer
    //     picks between, which is the whole interaction;
    //   · the four producers must run INDEPENDENTLY — fanning one sentence to
    //     all four and waiting made every card move at the speed of the slowest,
    //     and the stack sat empty.
    // Keying cards by SENTENCE resolves it. The first producer to finish creates
    // the card and it is immediately usable with its 4 suggestions; every later
    // producer APPENDS its options to that same card. Nothing waits for anything,
    // and the writer still chooses between tracks — which is the A/B.
    const key = finding.text;
    const existing = this.session.cards.find((c) => c.finding.text === key);
    const trackResult = { trackId: track.id, track: track.key, ok: true, ms: r.ms, model: r.model, produced: r.candidates.length };

    if (existing) {
      const seen = new Set(existing.candidates.map((c) => c.text.replace(/\s+/g, ' ').trim().toLowerCase()));
      for (const c of r.candidates) {
        const k = c.text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!seen.has(k)) { existing.candidates.push(c); seen.add(k); }
      }
      existing.trackResults = [...(existing.trackResults || []).filter((t) => t.trackId !== track.id), trackResult];
      existing.tracks = [...new Set([...(existing.tracks || []), track.id])].sort();
      if (!existing.placement && r.originalPlacement) existing.placement = r.originalPlacement;
      this.note(`${track.id} added ${r.candidates.length} options to the card at L${p.startLine} (${existing.candidates.length} total)`);
    } else {
      this.session.cards.push({
        id: nextId(),
        createdAt: new Date().toISOString(),
        tracks: [track.id],
        firstTrack: track.id,
        ms: r.ms,
        finding,
        paragraph: this.serializeParagraph(p),
        // Offsets are absolute into raw; `sentenceInWindow` locates the flagged
        // sentence for highlighting and for splicing a chosen candidate in place.
        window: win5,
        context: { before: beforeText, after: afterText },
        placement: r.originalPlacement,
        trackResults: [trackResult],
        candidates: r.candidates,
      });
      this.session.stats.served++;
    }
    // Worst dip first, so the writer always meets the biggest comprehension
    // break next regardless of which producer happened to finish first.
    this.session.cards.sort((a, b) => (b.finding.rank ?? b.finding.coldness ?? 0) - (a.finding.rank ?? a.finding.coldness ?? 0));
    store.saveSession(this.session);
  }

  /** ── accepting an edit ───────────────────────────────────────────────── */

  /**
   * Apply a chosen rewrite: splice → write → git commit → re-parse → re-anchor.
   * `winner` is a track id, or 'MANUAL', or 'ORIGINAL' (keep, no file change).
   */
  /**
   * `monologueGrade` grades the DIAGNOSIS, not the rewrite: did the reader model
   * actually catch what a human would stumble on here? That is the one number
   * telling us whether the flagging engine is any good, and it can only come from
   * the writer at the moment they read the monologue against their own sentence.
   * Without it the whole system is unfalsifiable — it would keep flagging
   * confidently and nobody would ever learn it was wrong.
   */
  async accept({ cardId, text, winner, commit = true, monologueGrade = null, monologueNote = '', blind = null, via = null }) {
    // `via` — WHICH MODEL BUTTON produced the text being committed (operator 2026-08-12: "with the
    // button llm used"). The A/B tracks say which arm GENERATED a candidate; `via` says who the
    // writer actually took the wording from, including the on-demand model buttons that are not part
    // of any track. Without it a suggestion accepted from the Opus button is indistinguishable in the
    // ledger from one typed by hand, and the per-model win rate cannot be computed at all.
    const idx = this.session.cards.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error(`card ${cardId} not found (already resolved?)`);
    const card = this.session.cards[idx];

    // Keeping the original: record the decision, change nothing on disk.
    if (winner === 'ORIGINAL' || text === card.finding.text) {
      this.session.cards.splice(idx, 1);
      this.session.done.push(fingerprint(card.finding));
      this.session.stats.skipped++;
      store.saveSession(this.session);
      const row = store.appendLedger({
        kind: 'accept', file: this.relFile, winner: 'ORIGINAL',
      via,
        offeredTracks: [...new Set(card.candidates.map((c) => c.trackId))],
        original: card.finding.text, chosen: card.finding.text,
        monologue: card.finding.monologue, defect: card.finding.defect,
        score: card.finding.score, line: card.paragraph.startLine,
        drift: null, sha: null,
      });
      return { ok: true, kept: true, ledger: row };
    }

    // ── AN EMPTY BOX IS A DELETION, NOT AN ERROR ─────────────────────────
    // Cutting a sentence is the most valuable edit this tool can make — filler is the whole
    // reason the slop detector exists — and it was the one edit that could not be committed.
    // Emptying the box threw `empty replacement`, so the only way to remove a sentence was to
    // leave the console and edit the file by hand, which is the path that clobbers a session.
    //
    // Deleting text leaves the seam behind: two spaces where one belongs, or a leading space at
    // the start of a paragraph. So a delete also absorbs ONE adjacent separator, chosen by which
    // side actually has one. The result reads as though the sentence was never there.
    const replacement = String(text || '').trim();
    const isDelete = replacement === '';

    // ── SENTENCE-SCOPED WRITE ────────────────────────────────────────────
    // The edit unit is the FLAGGED SENTENCE. The surrounding sentences are shown
    // on the card for judgement — you cannot assess a rewrite without seeing what
    // it lands between — but they are read-only and are never written.
    //
    // An earlier cut made the whole window editable and wrote the window's span.
    // Two things went wrong with that: it invited edits the card was never about,
    // and it destroyed track attribution, because a committed multi-paragraph
    // window is no longer identifiably "track C's suggestion" — which is the one
    // measurement this whole experiment produces.
    const useWindow = false;
    let start = card.finding.start;
    let end = card.finding.end;
    let expected = card.finding.text;

    // VERIFY THE ANCHOR before writing. The file may have been edited in another
    // editor since this card was built; splicing on a stale offset would corrupt it.
    if (this.raw.slice(start, end) !== expected) {
      this.reload();
      this.reanchorCards();
      const again = this.session.cards.find((c) => c.id === cardId);
      const s = again?.finding.start;
      const e = again?.finding.end;
      const x = again?.finding.text;
      if (!again || this.raw.slice(s, e) !== x) {
        this.session.cards = this.session.cards.filter((c) => c.id !== cardId);
        store.saveSession(this.session);
        throw new Error('source changed under this card — it was dropped, rescan will re-flag it');
      }
      card.finding = again.finding;
      card.window = again.window;
      start = s; end = e; expected = x;
    }

    // A DELETE ABSORBS ONE ADJACENT SEPARATOR. Removing a sentence otherwise leaves the seam
    // behind — two spaces where one belongs, or a space at the start of a paragraph — and the
    // writer has to go fix punctuation the tool broke. Only when BOTH sides have whitespace is
    // it safe to close the gap; at a paragraph edge there is nothing to absorb.
    if (isDelete && /\s$/.test(this.raw.slice(0, start)) && /^\s/.test(this.raw.slice(end))) {
      start -= (this.raw.slice(0, start).match(/\s+$/) || [''])[0].length;
    }

    // Nothing actually changed in the window — treat as keeping the original.
    if (replacement === expected.trim()) {
      this.session.cards.splice(idx, 1);
      this.session.done.push(fingerprint(card.finding));
      this.session.stats.skipped++;
      store.saveSession(this.session);
      return { ok: true, kept: true, ledger: store.appendLedger({
        kind: 'accept', file: this.relFile, winner: 'ORIGINAL',
      via,
        offeredTracks: [...new Set(card.candidates.map((c) => c.trackId))],
        original: card.finding.text, chosen: card.finding.text,
        monologue: card.finding.monologue, defect: card.finding.defect,
        score: card.finding.score, line: card.paragraph.startLine, sha: null,
      }) };
    }

    // ── THE FILE MOVED UNDER US? REFUSE. DO NOT CLOBBER. ────────────────────
    // `this.raw` is read once when the session opens and every commit splices against that
    // buffer. Anything that edits the file from outside — another tool, an editor, a script —
    // is therefore silently destroyed by the next commit, which writes the whole document back
    // from a stale copy. Measured 2026-08-13: a draft was rewritten out of band, the console
    // committed three sentences on top of its cached version, and the rewrite vanished with the
    // operator's own edits grafted onto the OLD paragraph. Nothing errored; the text simply
    // reverted, which reads as the tool inventing prose.
    //
    // Refusing is the only safe move. Reloading and re-splicing would place the edit at offsets
    // computed against text that no longer exists — corruption instead of a revert.
    let onDisk;
    try { onDisk = fs.readFileSync(this.file, 'utf8'); } catch { onDisk = null; }

    let updated;
    if (onDisk === null || onDisk === this.raw) {
      updated = spliceRange(this.raw, start, end, replacement);       // unchanged: offsets are valid
    } else {
      // THE FILE MOVED. Re-anchor on CONTENT, never on the cached offsets. The span being
      // committed is the only thing this edit is entitled to touch, so find that exact text in
      // the CURRENT document and replace it there — everything else on disk is left alone.
      // Offsets computed against a buffer that no longer exists would place the edit somewhere
      // arbitrary, which is corruption rather than a revert.
      const target = this.raw.slice(start, end);
      const first = onDisk.indexOf(target);
      if (first < 0 || onDisk.indexOf(target, first + 1) >= 0) {
        this.note(`refused: ${this.relFile} changed on disk and the edited span is ${first < 0 ? 'gone' : 'ambiguous'}`);
        return {
          ok: false,
          staleBuffer: true,
          error: `the file changed on disk since this session opened and the sentence being edited is `
            + `${first < 0 ? 'no longer present' : 'now ambiguous'}. Reopen the document to pick up those `
            + `changes — committing would overwrite them from a stale copy.`,
        };
      }
      updated = onDisk.slice(0, first) + replacement + onDisk.slice(first + target.length);
      this.note(`re-anchored on content: ${this.relFile} had changed on disk; only the edited sentence was replaced`);
    }
    fs.writeFileSync(this.file, updated);
    this.raw = updated;   // the buffer now matches disk, so the next commit is not stale by construction

    // Measure what actually landed (not what was predicted at generation time).
    // `replacement` is the whole WINDOW the writer committed; a candidate is a
    // single sentence inside it. Matching by equality therefore never hit, so the
    // ledger recorded no motivation and the re-scan could not locate the edited
    // sentence — it silently fell back to comparing against the paragraph minimum,
    // which is a different sentence and made improvements look like regressions.
    // The committed text is a SENTENCE, so exact match is the right test again;
    // the normalised fallback stays for whitespace-only differences.
    const norm = (v) => String(v).replace(/\s+/g, ' ').trim();
    const flat = norm(replacement);
    const chosen = card.candidates.find((c) => c.text === replacement)
      || card.candidates.find((c) => norm(c.text) === flat);
    const drift = chosen?.drift || null;

    // THE FILE IS ALREADY WRITTEN. The commit is bookkeeping, so it goes on a queue the worker drains
    // in the background and batches per file (operator: "the comitting should be a backround process
    // batched?"). Five edits in fifteen minutes used to be five commits and five post-commit fan-outs,
    // each one blocking the writer mid-decision. `commit: 'inline'` forces the old behaviour for
    // callers that genuinely need the sha in hand.
    let sha = null;
    let commitError = null;
    let commitState = 'skipped';
    if (commit === 'inline') {
      try { sha = await this.commitEdit({ card, replacement, winner, drift, wasText: expected }); commitState = 'committed'; }
      catch (e) { commitError = String(e?.message || e); commitState = 'failed'; this.note(`commit failed: ${commitError}`); }
    } else if (commit) {
      enqueueCommit(store.CACHE_DIR, {
        cardId, relFile: this.relFile, line: card.paragraph.startLine, winner, via,
        monologue: oneLine(card.finding.monologue), defect: card.finding.defect, score: card.finding.score,
        drift: drift ? `Tesseract-Drift: ${drift.verdict} coverage=${drift.coverage} bleed=${drift.weightedBleed} spread=${drift.deltaSpread} sensor=${drift.sensor}` : 'Tesseract-Drift: unmeasured',
        lattice: card.placement?.coords?.length ? `Lattice: ${card.placement.coords.slice(0, 6).join(' ')} (aperture ${card.placement.apertureRatio})` : null,
        offered: [...new Set(card.candidates.map((c) => c.trackId))].sort().join(','),
        was: oneLine(expected ?? card.finding.text), now: oneLine(replacement),
      });
      commitState = 'queued';
      this.note(`edit written · commit queued (batched, background)`);
    }

    // Re-read and re-anchor: every downstream offset just moved.
    this.reload();
    this.session.cards = this.session.cards.filter((c) => c.id !== cardId);
    this.reanchorCards();

    this.session.done.push(fingerprint(card.finding));
    if (winner === 'MANUAL') this.session.stats.manual++;
    else this.session.stats.byTrack[winner] = (this.session.stats.byTrack[winner] || 0) + 1;
    this.session.stats.accepted++;

    // Edit-density heatmap: one mark per edit at the paragraph's line span.
    this.session.edits.push({
      line: card.paragraph.startLine,
      endLine: card.paragraph.endLine,
      winner,
      ts: new Date().toISOString(),
    });
    store.saveSession(this.session);

    // ── RE-SCAN AFTER EDIT — the only direct test of the product claim ──
    // Everything else measures a proxy: readability approximates ease, slop
    // approximates noise, displacement approximates meaning. This re-reads the
    // edited passage with the same reader and asks whether comprehension actually
    // went up. It is the difference between "the metrics say it improved" and
    // "the reader followed it this time". Fire-and-forget so the writer is never
    // waiting on it; the result lands in the ledger as its own row.
    this.rescanAfterEdit({ card, before: card.finding.score, winner, replacement: chosen?.text || null })
      .catch((e) => this.note(`rescan failed: ${e.message}`));

    const row = store.appendLedger({
      kind: 'accept',
      file: this.relFile,
      winner,
      via,
      // 'queued' | 'committed' | 'failed' | 'skipped' — so "did it commit" is answerable from the row
      // itself rather than by going to look at git, which is what made the last batch unclear.
      commitState,
      offeredTracks: [...new Set(card.candidates.map((c) => c.trackId))],
      original: card.finding.text,
      chosen: replacement,
      motivation: chosen?.motivation || null,
      monologue: card.finding.monologue,
      monologueGrade,          // 'right' | 'wrong' | 'partly' — was the flag correct?
      monologueNote,
      // Study integrity: was the engine hidden when this choice was made? Blinded
      // and unblinded decisions are two populations and must never be pooled.
      blind,
      windowScoped: useWindow,
      originalWindow: useWindow ? expected : null,
      defect: card.finding.defect,
      score: card.finding.score,
      dip: card.finding.dip ?? null,
      baseline: card.finding.baseline ?? null,
      line: card.paragraph.startLine,
      placement: card.placement,
      drift,
      sha,
      commitError,
    });

    // Persistent in-line attribution, in a sidecar — never in the manuscript.
    try {
      recordEdit(this.file, {
        text: chosen?.text || null,
        original: card.finding.text,
        track: winner, sha, line: card.paragraph.startLine,
        defect: card.finding.defect, monologueGrade,
      });
    } catch (e) { this.note(`attribution: ${e.message}`); }

    return { ok: true, sha, commitError, drift, ledger: row };
  }

  /**
   * Re-read the edited paragraph and record whether comprehension actually rose.
   * Runs detached from the accept path — the writer moves on immediately.
   */
  async rescanAfterEdit({ card, before, winner, replacement }) {
    // The file has already been re-parsed by accept(); find where the paragraph
    // landed. If the edit dissolved it, there is nothing honest to compare.
    const pIndex = Math.min(card.finding.paragraphIndex, this.paragraphs.length - 1);
    const p = this.paragraphs[pIndex];
    if (!p) return;

    const d = await diagnoseParagraph(this.paragraphs, pIndex, { persona: this.persona });
    if (!d?.ok || !d.findings.length) return;

    // ── COMPARE LIKE WITH LIKE ──────────────────────────────────────────
    // `before` is ONE sentence's score. Taking the paragraph's minimum afterward
    // compares that against a possibly different sentence that was always the
    // weakest — which reported a 25-point regression on an edit that had
    // improved its target. Score the sentence that actually REPLACED the flagged
    // one; fall back to the paragraph minimum only when it cannot be located, and
    // label the row so the two are never silently mixed in the rollup.
    let after = null;
    let basis = 'sentence';
    if (replacement) {
      const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
      const want = norm(replacement);
      const hit = d.findings.find((f) => norm(f.text) === want)
        || d.findings.find((f) => want.includes(norm(f.text)) || norm(f.text).includes(want));
      if (hit) after = hit.score;
    }
    if (after == null) { after = Math.min(...d.findings.map((f) => f.score)); basis = 'paragraph-min'; }
    const rec = this.session.scanned[pIndex] || { startLine: p.startLine, endLine: p.endLine };
    rec.minScore = after;
    rec.rescanned = true;
    this.session.scanned[pIndex] = rec;
    store.saveSession(this.session);

    const delta = after - before;
    this.note(`rescan ¶${pIndex}: ${before} → ${after} (${delta >= 0 ? '+' : ''}${delta}) after ${winner} [${basis}]`);
    store.appendLedger({
      kind: 'rescan',
      file: this.relFile,
      winner,
      line: card.paragraph.startLine,
      paragraphIndex: pIndex,
      scoreBefore: before,
      scoreAfter: after,
      basis,                 // 'sentence' (valid) | 'paragraph-min' (approximate)
      delta,
      improved: delta > 0,
      defect: card.finding.defect,
      engine: d.engine,
    });
  }

  /** One atomic commit per change, tagged with the winning track. */
  async commitEdit({ card, replacement, winner, drift, wasText }) {
    const trackLabel = winner === 'MANUAL'
      ? 'MANUAL (human rewrite)'
      : `${winner} — ${TRACK_BY_ID.get(winner)?.key || winner}`;

    const subject = `rewrite(${path.basename(this.file, path.extname(this.file))}): L${card.paragraph.startLine} via track ${winner}`;
    const body = [
      `Track: ${trackLabel}`,
      `Reader-Monologue: ${oneLine(card.finding.monologue)}`,
      `Defect: ${card.finding.defect} (comprehension ${card.finding.score}/100)`,
      drift ? `Tesseract-Drift: ${drift.verdict} coverage=${drift.coverage} bleed=${drift.weightedBleed} spread=${drift.deltaSpread} sensor=${drift.sensor}` : 'Tesseract-Drift: unmeasured',
      card.placement?.coords?.length ? `Lattice: ${card.placement.coords.slice(0, 6).join(' ')} (aperture ${card.placement.apertureRatio})` : null,
      `Offered: ${[...new Set(card.candidates.map((c) => c.trackId))].sort().join(',')}`,
      '',
      // was/now must describe THE SAME SPAN or the message lies about the change.
      // The write is window-scoped, so both halves are the window; the flagged
      // sentence is called out separately as the diagnosis that started it.
      `flagged: ${oneLine(card.finding.text)}`,
      '',
      `was: ${oneLine(wasText ?? card.finding.text)}`,
      `now: ${oneLine(replacement)}`,
    ].filter(Boolean).join('\n');

    await execFileAsync('git', ['add', '--', this.relFile], { cwd: this.repoRoot });
    await execFileAsync('git', ['commit', '-m', subject, '-m', body, '--', this.relFile], { cwd: this.repoRoot });
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.repoRoot });
    return stdout.trim();
  }

  /**
   * Re-aim a card: the writer says what the sentence must DO, and every enabled
   * track regenerates against that instead of polishing the existing phrasing.
   * The old options are replaced — keeping them would bury the aimed ones under
   * the four that already failed.
   */
  async regenerate(cardId, direction) {
    const card = this.session.cards.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'card not found' };
    const dir = String(direction || '').trim();
    if (!dir) return { ok: false, error: 'no direction given' };

    const p = this.paragraphs[card.finding.paragraphIndex];
    if (!p) return { ok: false, error: 'paragraph no longer present' };
    const win = contextWindow(this.paragraphs, card.finding.paragraphIndex, 1, 1);
    const beforeText = win.before.map((x) => x.text).join('\n\n');
    const afterText = win.after.map((x) => x.text).join('\n\n');
    const finding = { ...card.finding, direction: dir };

    this.note(`regenerating L${card.paragraph.startLine} with direction: ${dir.slice(0, 80)}`);
    const active = TRACKS.filter((t) => this.session.tracks.includes(t.id));
    const results = await Promise.all(active.map((t) =>
      runTrackCard(t, { finding, paragraph: p, beforeText, afterText, repoRoot: this.repoRoot, raw: this.raw, direction: dir })
        .catch((e) => ({ ok: false, trackId: t.id, track: t.key, error: e.message, candidates: [], ms: 0 }))));

    const seen = new Set();
    const merged = [];
    for (const r of results) {
      if (!r.ok) continue;
      for (const c of r.candidates) {
        const k = c.text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...c, aimed: true });
      }
    }
    if (!merged.length) {
      return { ok: false, error: 'no track produced a rewrite for that direction', trackResults: results.map(({ candidates, ...m }) => m) };
    }

    card.candidates = merged;
    card.direction = dir;
    card.tracks = [...new Set(results.filter((r) => r.ok).map((r) => r.trackId))].sort();
    card.trackResults = results.map(({ candidates, ...m }) => ({ ...m, produced: candidates?.length || 0 }));
    card.finding = finding;
    store.saveSession(this.session);
    store.appendLedger({
      kind: 'direction', file: this.relFile, line: card.paragraph.startLine,
      original: card.finding.text, direction: dir, produced: merged.length,
      tracks: card.tracks,
    });
    return { ok: true, produced: merged.length, tracks: card.tracks };
  }

  /**
   * PASTE A SELECTION — work on a span you choose, not one the reader flagged.
   *
   * Sometimes the whole section has to go, and the diagnostic will never propose
   * that: it flags the sentence where comprehension broke, which is a different
   * question from "this passage is wrong and I know it". This finds the text you
   * paste, verbatim, in the file, and builds a card for it — same four tracks,
   * same rulers, same commit path — with the reason recorded as YOURS rather than
   * the model's.
   *
   * Exact match only. A fuzzy match here would build a card anchored to a span you
   * did not select, and the accept path would then rewrite the wrong text.
   */
  async selectSpan(text, note = '') {
    const target = String(text || '').trim();
    if (target.length < 20) return { ok: false, error: 'select at least 20 characters' };

    this.reload();
    const at = this.raw.indexOf(target);
    if (at < 0) return { ok: false, error: 'that exact text is not in the file (whitespace or markdown may differ)' };
    if (this.raw.indexOf(target, at + 1) >= 0) {
      return { ok: false, error: 'that text appears more than once — select a longer span so it is unambiguous' };
    }

    // Locate the paragraph/sentence the span starts in, so the window and the
    // re-anchoring machinery work exactly as they do for a flagged card.
    let pIdx = -1, sIdx = -1;
    for (const p of this.paragraphs) {
      if (at >= p.start && at < p.end) {
        pIdx = p.index;
        sIdx = Math.max(0, p.sentences.findIndex((x) => at >= x.start && at < x.end));
        break;
      }
    }
    if (pIdx < 0) return { ok: false, error: 'that span is not inside extractable prose (code, frontmatter or a masked block)' };

    const finding = {
      text: target,
      start: at,
      end: at + target.length,
      paragraphIndex: pIdx,
      sentenceIndex: sIdx,
      monologue: note.trim() || 'Selected by the writer — no reader flagged this.',
      score: 0,
      defect: 'writer-selected',
      source: 'selection',
      rank: 10_000,          // a span you chose outranks anything a model found
      dip: null, baseline: null,
    };

    this.pendingFindings.unshift(finding);
    this.note(`selection queued: "${target.slice(0, 60)}${target.length > 60 ? '…' : ''}"`);
    store.saveSession(this.session);
    this.pump();
    return { ok: true, queued: true, paragraphIndex: pIdx, chars: target.length };
  }

  /** Drop a card without editing — "none of these, move on". */
  skip(cardId) {
    const idx = this.session.cards.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, error: 'card not found' };
    const card = this.session.cards[idx];
    this.session.cards.splice(idx, 1);
    this.session.done.push(fingerprint(card.finding));
    this.session.stats.skipped++;
    store.saveSession(this.session);
    store.appendLedger({
      kind: 'skip', file: this.relFile, winner: null,
      offeredTracks: [...new Set(card.candidates.map((c) => c.trackId))],
      original: card.finding.text, monologue: card.finding.monologue,
      defect: card.finding.defect, score: card.finding.score, line: card.paragraph.startLine,
    });
    return { ok: true };
  }

  setTracks(ids) {
    this.session.tracks = ids.length ? ids : ['A'];
    store.saveSession(this.session);
  }

  /**
   * Move the aperture — reposition where SCANNING continues from.
   *
   * This does NOT clear the stack, and that default is load-bearing. It used to,
   * and the consequence was brutal: the console sends an aperture on every page
   * load, so opening `/rewrite?from=L120` against a worker positioned at ¶40
   * destroyed a full 12-card stack and showed the writer 0/10. Every reload wiped
   * minutes of cloud work.
   *
   * A card is a real comprehension break that a model already paid to find. Moving
   * where you read next is not a reason to throw those away. Use `reset()` for an
   * actual start-over.
   */
  setAperture(paragraphIndex, { clearQueue = false } = {}) {
    const i = Math.max(0, Math.min(this.paragraphs.length - 1, paragraphIndex | 0));
    const same = this.session.aperture === i;
    this.session.aperture = i;
    this.session.cursor = i;
    if (clearQueue) { this.session.cards = []; this.pendingFindings = []; }
    this._exhaustedNoted = false;
    store.saveSession(this.session);
    if (!same) this.note(`aperture → ¶${i} (line ${this.paragraphs[i]?.startLine}) · ${this.session.cards.length} cards kept`);
    return i;
  }

  /** Explicit start-over: drop the stack and rescan from the aperture. */
  reset() {
    this.session.cards = [];
    this.pendingFindings = [];
    this.servedFindings = [];
    this.session.done = [];
    this.session.cursor = this.session.aperture;
    this._exhaustedNoted = false;
    store.saveSession(this.session);
    this.note('reset — stack cleared, rescanning from the aperture');
    return { ok: true };
  }

  /** Everything the UI needs in one payload. */
  state() {
    return {
      file: this.file,
      relFile: this.relFile,
      slug: this.session.slug,
      running: this.running,
      paused: !!this.session.paused,
      aperture: this.session.aperture,
      cursor: this.session.cursor,
      totalParagraphs: this.paragraphs.length,
      totalLines: this.totalLines,
      tracks: this.session.tracks,
      threshold: this.threshold,
      persona: this.persona,
      buffer: { have: this.session.cards.length, target: BUFFER_TARGET, generating: this.generating, scanning: this.scanning, pending: this.pendingFindings.length },
      // Per-arm representation ON THE STACK — the number that decides whether the
      // corpus can answer anything. Surfaced so a starved arm is visible, not
      // discovered later in the analysis.
      balance: (() => {
        const b = {};
        for (const t of TRACKS) if (this.session.tracks.includes(t.id)) b[t.id] = 0;
        for (const c of this.session.cards) {
          for (const cand of c.candidates || []) if (b[cand.trackId] !== undefined) b[cand.trackId]++;
        }
        return b;
      })(),
      cards: this.session.cards,
      scanned: this.session.scanned,
      edits: this.session.edits,
      stats: this.session.stats,
      lastError: this.lastError,
      attribution: (() => { try { return attributionSummary(this.file, this.raw); } catch { return null; } })(),
      log: this.log.slice(-25),
    };
  }
}

function fingerprint(f) {
  return `${f.text.slice(0, 120)}`;
}
function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
