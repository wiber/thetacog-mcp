#!/usr/bin/env node
// scripts/ops/mem.mjs — /mem: WHERE THE MEMORY WENT, AND WHICH PROCESSES NOBODY IS COMING BACK FOR.
// =============================================================================================
// THE MEASUREMENT THAT CREATED THIS (2026-10-03, 19:21). Load average 204 on ten cores, swap 21.4
// of 22.5 GB used, ~13.8 GB wired, kernel_task at 105% (the compressor thrashing). `ps` showed no
// Z-state zombie at all. What it showed instead were processes whose reason to exist had ended:
// MCP servers whose claude parent was gone, editor extension hosts orphaned by closed windows, a
// `tail -F` on a scratchpad of a session that died a day earlier, detached render chains queued
// behind a lock for commits four commits stale. Each is small. Nothing ever looks at them again.
//
// THE RULE: KILL ONLY WHAT YOU CAN NAME, AND COUNT EVERY KILL.
//   · A process the repo did not launch is NEVER reaped (WindowServer, the OS, the user's apps) — with ONE
//     named exceptions: an OFF-SCREEN Chrome tab over TAB_MIN_MB while the machine is slow (see SLOW below),
//     and the Xcode IDE, always (see XCODE_IDE), and the SWAP HOLDERS (an idle colima VM, a leaked next dev).
//   · A live room (claude on a tty) and everything under it is NEVER reaped.
//   · A named daemon (attest-serve, the resident pmu-onchip, clip-watch, ollama serve, next dev)
//     is kept however old — age is not a defect for a server.
//   · Everything else the repo launched detached has an age CEILING. Past it, the worker is hung
//     or has been superseded, and either way nobody is coming back for it.
//   · A true zombie (Z) cannot be signalled; it is reported against the parent that failed to reap it.
//   · Every kill is one row in .thetacog/mem-reaps.ndjson (AXIOM 1: a kill is a displacement).
//
//   node scripts/ops/mem.mjs            # pressure + verdict table, kills nothing
//   node scripts/ops/mem.mjs --reap     # TERM, then KILL survivors after 3 s, ledger each
//   node scripts/ops/mem.mjs --reap --quiet   # the controller-tick stage (one line, only if it acted)
//   node scripts/ops/mem.mjs --json
//
// Guard: tests/ops/mem-reap.test.mjs   ·   Skill: .claude/skills/mem/SKILL.md
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDriverOf } from '../vna/workers.mjs';   // C293: what a local-LLM driver IS, off its argv — one rule, one place

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = join(REPO, '.thetacog/mem-reaps.ndjson');
const MIN = 60, HOUR = 3600;

export function parseEtime(s) {
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(d) * 86400 + parts[0] * HOUR + parts[1] * MIN + parts[2];
}

export function parsePs(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], ppid: +m[2], stat: m[3], tty: m[4], age: parseEtime(m[5]), rssKb: +m[6], cmd: m[7] });
  }
  return rows;
}

const MCP = /node_modules\/\.bin\/thetacoach-crm|\.thetacog\/mcp\/swarm-comms\.js|thetacog-mcp\/server\.js|claude-flow(@[\w.-]+)? mcp|ruv-swarm mcp/;
const EDITOR_HOST = /(Cursor|Code) Helper \(Plugin\)/;
const SESSION_LEFTOVER = /\/tmp\/claude-\d+\//;
// A test or replay that copied the repo into os.tmpdir() (mkdtemp) and ran a script from the copy. The copy
// is repo-shaped (…/T/<dir>/scripts|hooks/…), so it is ours, but it is never the real surface: a daemon name
// inside one is not the daemon. Orphaned past 2 h, its test is over (measured 2026-10-10: a C636 fixture
// node busy-looping 150 CPU-hours, a replay-bench clip-watch for 6 days, both after their dir was removed).
const TMP_FIXTURE = /\/var\/folders\/[^/\s]+\/[^/\s]+\/T\/[^/\s]+\/(scripts|hooks)\//;
const SEARCH_TOOL = /^(ugrep|rg|\S*\/rg) /; // a session Grep tool: orphaned means its session died
// RUNAWAY: a Bash or Grep tool call is capped at 10 min, so a search still burning CPU past an hour has no caller
// waiting on it, even under a live room (measured 2026-10-11: `.{300}gurianov.{300}` backtracking 4 h at 381%).
// An unmeasured CPU (cpu undefined) never reaps; an idle search under a room stays the room's.
export const HOT_CPU_PCT = 50;
export const RUNAWAY_SEARCH_S = HOUR;
const runaway = (r) => SEARCH_TOOL.test(r.cmd) && r.age > RUNAWAY_SEARCH_S && r.cpu != null && r.cpu >= HOT_CPU_PCT;
// 2026-10-13: the audio basin's daemon, its mic segmenter and its whisper server, and the HUD's server are resident by design; the reaper took
// the armed audio daemon at 01:54Z as "repo-script past its 180 min ceiling" (pid 1495, mem-reaps.ndjson) and the mic went silent for 17 h with
// the checkbox still on. A daemon the operator armed is never a stuck script.
const DAEMON = /attest-serve\.mjs|pmu-onchip --(resident|door-serve|hud-serve)|clip-watch\.mjs --daemon|audio-basin\.mjs --daemon|whisper-server |ffmpeg .*\.thetacog\/audio\/seg\/|ollama serve|next dev|dev-smart\.js|scripts\/controller\/tick\.sh|caffeinate /;
// A detached chain the repo launched, and how long it may live before it is hung or superseded.
// commit-render waits on mailbox.sh, whose lock is reported stale at 30 min (MAILBOX_MAX_HOLD_S),
// so a chain alive at 60 min is waiting for a holder that will never release.
const CEILINGS = [
  { name: 'render-chain', re: /THE canonical anatomy|mailbox\.sh commit-render|commit-triptych\.mjs|triptych-to-blog-og\.sh/, max: 60 * MIN },
  { name: 'goose', re: /^goose run /, max: 45 * MIN },
  { name: 'repo-script', re: /./, max: 3 * HOUR },
];

const launchedByRepo = (cmd) =>
  cmd.toLowerCase().includes(REPO.toLowerCase()) || /^(bash|node|sh)\s+(scripts|hooks)\//.test(cmd) ||
  /THE canonical anatomy/.test(cmd) || /^goose run /.test(cmd) || MCP.test(cmd);

// THRASH: swap this full means the compressor, not the work, owns the cores. An ORPHANED local-LLM driver
// (an automatic caller — an operator-started one sits under a room) reloads the model the quiet gate just
// evicted (measured 2026-10-03: qwen3:8b "Stopping..." then back at 7.8 GB under an orphan `goose run`).
export const THRASH_SWAP_PCT = 90;
// Swap % alone lies: macOS shrinks the swap TOTAL as files deallocate, so 15.9/17 GB read 94 % with 54 %
// free (measured 2026-10-03, minutes after the model unloaded). Thrash needs BOTH signals.
export const THRASH_FREE_PCT = 25;
export const isThrash = (p) => p.swapTotalGb > 0 && 100 * p.swapUsedGb / p.swapTotalGb >= THRASH_SWAP_PCT && p.freePct != null && p.freePct < THRASH_FREE_PCT;
export const ZOMBIE_MIN_S = 2 * MIN;

// OFF-SCREEN CHROME TABS (operator 2026-10-10: "just killing the tabs to speed up the computer should
// self evidently be auto done when the computer gets slow .. you can just refresh the page"). Chrome itself
// says which tabs are off-screen: it drops a hidden tab's renderer to background priority (pri 4 measured;
// visible tabs sit at 46/47, 57 of 70 renderers were at 4). Killing a renderer leaves the tab in place
// with a reload button — the tab is not closed, its URL survives. Extension renderers, the GPU process and
// any visible tab are never touched. Footprint comes from top (RSS hides the compressed pages, which is
// where a backgrounded tab lives: 13621 read ~0 RSS against 2013 MB footprint).
export const TAB_MIN_MB = 500;
// While SWAP is full (not merely load), the floor drops: 2026-10-11 51 off-screen tabs held 11.3 GB and only
// 2 crossed 500 MB. A 200 MB tab costs one reload; the 120 MB tail is left alone.
export const TAB_SWAP_MIN_MB = 200;
export const TAB_MIN_AGE_S = 10 * MIN;
export const BACKGROUND_PRI_MAX = 10;
// Chrome 155 named its renderer "Google Chrome Helper (Aperitif Renderer)"; the "(Renderer)"-only pattern matched no tab from that update
// until 2026-10-24, so the tab reaper read 0 tabs while Chrome held 14.4 GB. Any word before "Renderer" is the same helper.
const CHROME_RENDERER = /Google Chrome Helper \((?:[A-Za-z]+ )?Renderer\)\.app\/.* --type=renderer /;
// SLOW: the tab rule's trigger is looser than THRASH on purpose — a wrong discard costs one reload.
export const isSlow = (p, ncpu = 10) => (p.swapTotalGb > 0 && 100 * p.swapUsedGb / p.swapTotalGb >= THRASH_SWAP_PCT) || (p.load1 != null && p.load1 >= 2 * ncpu);

export function parseFootprintMb(s) {
  const m = String(s).match(/^([\d.]+)([KMG])/);
  return m ? +m[1] * { K: 1 / 1024, M: 1, G: 1024 }[m[2]] : 0;
}

// rows: { pid, pri, age, cmd, mb } — pure, so the test feeds real lines.
// AWAY (operator 2026-10-24, verbatim: "you can use skills to pause memory like but not only /mem when i say i al stepping away"):
// his word that he has stepped away stands in for SLOW on the classes that already wait for it — an off-screen tab (at the 200 MB
// floor) and a day-old next dev server (size bar waived). Never on by itself: only --away, which /shot's step-away launch passes.
export function chromeTabs(rows, { slow = false, swapFull = false, away = false } = {}) {
  if (away) { slow = true; swapFull = true; }
  const floor = swapFull ? TAB_SWAP_MIN_MB : TAB_MIN_MB;
  return rows.filter(r => CHROME_RENDERER.test(r.cmd)).map(r => {
    const v = (verdict, why) => ({ ...r, verdict, why });
    if (/--extension-process/.test(r.cmd)) return v('keep', 'extension');
    if (r.pri > BACKGROUND_PRI_MAX) return v('keep', 'on screen');
    if (r.mb < floor) return v('keep', 'off screen, small');
    if (r.age < TAB_MIN_AGE_S) return v('keep', 'off screen, just backgrounded');
    return slow ? v('reap', `off-screen Chrome tab, ${Math.round(r.mb)} MB — reload restores it`) : v('keep', 'off screen, machine not slow');
  });
}

// top took 4.85 s at load 110 (2026-10-10) — a 5 s ceiling read every tab as 0 MB and kept them all, silently.
// So it gets 30 s, and an empty read returns null: the tab rule reports UNMEASURED, never "nothing heavy".
function readTabs(fp = new Map()) {
  for (const l of sh('top', ['-l', '1', '-o', 'mem', '-n', '400', '-stats', 'pid,mem'], 30000).split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\S+)/); if (m) fp.set(+m[1], parseFootprintMb(m[2]));
  }
  if (!fp.size) return null;
  return sh('ps', ['-axo', 'pid=,pri=,etime=,command=']).split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: +m[1], pri: +m[2], age: parseEtime(m[3]), cmd: m[4], mb: fp.get(+m[1]) || 0, rssKb: 0 }));
}

// SWAP HOLDERS (2026-10-11, swap 24.3 of 25 GB). RSS named Chrome the top family; two tab reaps freed 1.1 GB
// and swap did not move. Footprint (top MEM — counts compressed and swapped pages, which RSS hides) named
// the real holders: an idle colima VM, 9 days up with 0 containers, and a `next dev` server 9 days up at
// 3.3 GB. Neither was visible to the RSS rules: the VM is an Apple XPC service, the server a named daemon.
//   · colima VM: STOPPED through `colima stop`, never signalled — only when colima says it is running, and
//     docker counts zero containers (an unread count keeps it). The C603 container tests start it on demand.
//   · next dev: a server a day old past NEXT_MAX_MB has leaked; it and its `next dev` wrappers go, and
//     ./scripts/dev.sh brings a fresh one. A fresh or small dev server is the operator's, kept.
// Both only while SLOW. The user's own windows (a VS Code renderer at 5.7 GB) are reported, never reaped.
export const VZ_VM = /\/com\.apple\.Virtualization\.VirtualMachine$/;
export const NEXT_SERVER = /^next-server \(v[\d.]+\)/;
const NEXT_WRAPPER = /\bnext dev\b/;
export const NEXT_MAX_MB = 2048;
export const NEXT_MIN_AGE_S = 24 * HOUR;
export const VM_MIN_AGE_S = HOUR;
// C827 — A RUNAWAY git grep. 2026-10-14: three repo-wide `git grep -n -i … -- .` from one room held 12.3 + 5.4 + 3.7 GB
// footprint (load 84, 2,947 swap-ins/s). The tape (.thetacog/walk-tape.ndjson, 1.6 GB) and amendments.ndjson (459 MB) are
// tracked on purpose, and git grep has no setting that skips a tracked file, so every repo-wide grep inflates them. A grep is
// a bounded tool call the caller can re-run narrower; past GREP_MAX_MB it is the swap, so it is reaped even under a live room
// (the ugrep rule's argument, applied to footprint).
export const GIT_GREP = /(^|\/)git(\s+-[cC]\s+\S+)*\s+grep\b/;
export const GREP_MAX_MB = 2048;

// rows: { pid, ppid, age, cmd, mb } (mb = top footprint) — pure; colima: { running, containers|null }.
export function swapHolders(rows, { slow = false, colima = {}, away = false } = {}) {
  const byPid = new Map(rows.map(r => [r.pid, r]));
  const out = [];
  for (const r of rows) {
    const v = (verdict, why, extra = {}) => out.push({ ...r, verdict, why, ...extra });
    if (VZ_VM.test(r.cmd)) {
      if (!colima.running) v('keep', 'VM colima does not own');
      else if (colima.containers == null) v('keep', 'colima VM, container count UNMEASURED');
      else if (colima.containers > 0) v('keep', `colima VM, ${colima.containers} containers running`);
      else if (!slow) v('keep', 'idle colima VM, machine not slow');
      else if (r.age < VM_MIN_AGE_S) v('keep', 'idle colima VM, just started');
      else v('reap', `idle colima VM (0 containers), ${Math.round(r.mb)} MB — colima start brings it back`, { action: 'colima-stop' });
      continue;
    }
    if (GIT_GREP.test(r.cmd)) {
      if (r.mb >= GREP_MAX_MB) v('reap', `runaway git grep at ${Math.round(r.mb)} MB footprint — re-run it on a narrower pathspec (never the 1.6 GB tape)`);
      continue;
    }
    if (NEXT_SERVER.test(r.cmd)) {
      if (!(slow || away) || (!away && r.mb < NEXT_MAX_MB) || r.age < NEXT_MIN_AGE_S) { v('keep', 'next dev server'); continue; }
      v('reap', `next dev server ${(r.age / HOUR / 24).toFixed(1)} days up at ${Math.round(r.mb)} MB — ./scripts/dev.sh starts a fresh one`);
      for (let p = byPid.get(r.ppid); p && p.pid > 1 && NEXT_WRAPPER.test(p.cmd); p = byPid.get(p.ppid))
        out.push({ ...p, verdict: 'reap', why: `next dev wrapper of reaped ${r.pid}` });
    }
  }
  return out;
}

function readColima() {
  if (!sh('colima', ['status', '--json'], 10000).includes('"runtime"')) return { running: false };
  const r = spawnSync('docker', ['ps', '-q'], { encoding: 'utf8', timeout: 10000 });
  return { running: true, containers: r.status === 0 ? r.stdout.split('\n').filter(Boolean).length : null };
}

// XCODE, BY DEFAULT (operator 2026-10-10: "kill xcode by default with it"). Measured that day: the IDE open
// a day unused, its source-control XPC respawning git every few seconds. The app binary and its own PlugIns /
// SharedFrameworks services go; Contents/Developer/ is the command-line toolchain (git, clang, swift) that
// xcode-select points everything else at, so it is never matched.
export const XCODE_IDE = /^\/Applications\/Xcode[^/]*\.app\/Contents\/(MacOS\/Xcode$|PlugIns\/|SharedFrameworks\/)/;

export function classify(rows, { selfPids = new Set(), thrash = false } = {}) {
  const byPid = new Map(rows.map(r => [r.pid, r]));
  const out = [];
  const isRoom = (r) => /^claude( |$)/.test(r.cmd) && r.tty !== '??';
  const underRoom = (r) => { for (let p = byPid.get(r.ppid); p && p.pid > 1; p = byPid.get(p.ppid)) if (isRoom(p)) return !MCP.test(r.cmd); return false; };
  for (const r of rows) {
    const v = (verdict, why, extra = {}) => out.push({ ...r, verdict, why, ...extra });
    // A defunct child seconds old is a process mid-exit; its parent reaps it on the next tick. Only a
    // zombie that OUTLIVES that is a parent bug worth naming (noise here would make the line ignored).
    if (r.stat.startsWith('Z') && r.age < ZOMBIE_MIN_S) { v('keep', 'exiting'); continue; }
    if (r.stat.startsWith('Z')) { v('zombie', `defunct; parent ${r.ppid} has not reaped it`, { parent: r.ppid }); continue; }
    if (selfPids.has(r.pid)) { v('keep', 'this process or its ancestor'); continue; }
    const orphan = r.ppid === 1;
    if (isRoom(r)) { v('keep', 'live room'); continue; }
    if (runaway(r)) { v('reap', `search tool at ${Math.round(r.cpu)}% CPU for ${(r.age / HOUR).toFixed(1)} h — no tool call waits that long`); continue; }
    if (underRoom(r)) { v('keep', 'under a live room — the room owns it'); continue; }
    if (MCP.test(r.cmd)) { orphan ? v('reap', 'MCP server whose claude parent is gone') : v('keep', 'MCP under a live session'); continue; }
    if (EDITOR_HOST.test(r.cmd)) { orphan ? v('reap', 'editor extension host orphaned by a closed window') : v('keep', 'editor host'); continue; }
    if (SESSION_LEFTOVER.test(r.cmd) && orphan && r.age > 2 * HOUR) { v('reap', 'leftover from a session scratchpad, parent gone'); continue; }
    if (TMP_FIXTURE.test(r.cmd) && orphan && r.age > 2 * HOUR) { v('reap', 'fixture left running from an os.tmpdir() repo copy'); continue; }
    if (thrash && orphan && localDriverOf({ command: r.cmd, argv: r.cmd.trim().split(/\s+/) })) { v('reap', 'orphaned local-LLM driver reloading the model while swap thrashes'); continue; }
    if (SEARCH_TOOL.test(r.cmd) && orphan && r.age > HOUR) { v('reap', 'search tool orphaned by a dead session'); continue; }
    if (XCODE_IDE.test(r.cmd)) { v('reap', 'Xcode — reaped by default'); continue; }
    if (!launchedByRepo(r.cmd)) { v('keep', 'not launched by this repo'); continue; }
    if (DAEMON.test(r.cmd)) { v('keep', 'named daemon'); continue; }
    if (r.tty !== '??') { v('keep', 'foreground job on a terminal'); continue; }
    const c = CEILINGS.find(c => c.re.test(r.cmd));
    if (r.age > c.max) v('reap', `${c.name} past its ${Math.round(c.max / MIN)} min ceiling`);
    else v('keep', `${c.name}, ${Math.round(r.age / MIN)} of ${Math.round(c.max / MIN)} min`);
  }
  // A reaped parent takes its subtree: a hung chain's children are the hung work.
  const reap = new Set(out.filter(o => o.verdict === 'reap').map(o => o.pid));
  for (const o of out) {
    if (o.verdict !== 'keep' || selfPids.has(o.pid)) continue;
    for (let p = byPid.get(o.ppid); p && p.pid > 1; p = byPid.get(p.ppid))
      if (reap.has(p.pid)) { o.verdict = 'reap'; o.why = `child of reaped ${p.pid}`; break; }
  }
  return out;
}

// CPU: ps %CPU is the kernel's decayed recent share, 100 = one core. Read as its own column so the ps fixtures
// above keep their captured shape; a row with no reading carries cpu undefined and is judged on memory alone.
export function parseCpu(text) {
  const m = new Map();
  for (const line of text.split('\n')) { const x = line.trim().match(/^(\d+)\s+([\d.]+)$/); if (x) m.set(+x[1], +x[2]); }
  return m;
}
export const busiest = (rows, n = 8) => rows.filter(r => r.cpu != null).sort((a, b) => b.cpu - a.cpu).slice(0, n);

function sh(cmd, args, timeout = 5000) { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout }); } catch { return ''; } }

export function pressure() {
  const swap = sh('sysctl', ['-n', 'vm.swapusage']).match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
  const vm = sh('vm_stat', []);
  const page = +(vm.match(/page size of (\d+)/)?.[1] || 16384);
  const pages = (k) => +(vm.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || 0);
  const gb = (n) => +(n * page / 2 ** 30).toFixed(1);
  const free = sh('memory_pressure', []).match(/free percentage: (\d+)%/)?.[1];
  const load = sh('sysctl', ['-n', 'vm.loadavg']).trim().split(/\s+/)[1];
  const ncpu = +sh('sysctl', ['-n', 'hw.ncpu']).trim() || null;
  return {
    swapUsedGb: swap ? +(swap[2] / 1024).toFixed(1) : null, swapTotalGb: swap ? +(swap[1] / 1024).toFixed(1) : null,
    wiredGb: gb(pages('Pages wired down')), compressedGb: gb(pages('Pages occupied by compressor')),
    freePct: free ? +free : null, load1: load ? +load : null, ncpu,
    ollama: sh('ollama', ['ps']).split('\n').slice(1).filter(Boolean).map(l => l.split(/\s{2,}/).slice(0, 4).join(' · ')),
  };
}

function family(cmd) {
  if (/^claude /.test(cmd)) return 'claude rooms';
  if (MCP.test(cmd)) return 'MCP servers';
  if (/ollama runner/.test(cmd)) return 'ollama model';
  if (/whisper/.test(cmd)) return 'whisper';
  if (VZ_VM.test(cmd)) return 'virtual machine';
  if (NEXT_SERVER.test(cmd) || NEXT_WRAPPER.test(cmd)) return 'next dev';
  if (/Google Chrome/.test(cmd)) return 'Chrome';
  if (XCODE_IDE.test(cmd)) return 'Xcode';
  if (/Cursor/.test(cmd)) return 'Cursor';
  if (/Visual Studio Code|Code Helper/.test(cmd)) return 'VS Code';
  if (launchedByRepo(cmd)) return 'repo scripts';
  return null;
}

function selfChain(rows) {
  const by = new Map(rows.map(r => [r.pid, r])); const s = new Set();
  for (let p = process.pid; p > 1 && !s.has(p); p = by.get(p)?.ppid ?? 1) s.add(p);
  return s;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// WHAT KEEPS RUNNING (measured 2026-10-12). Nothing reaped, yet load sat at 46–82 and swap paged ~230 MB/s each way: the
// holder was a punch-list task (bisect-cadence, 4× node --test --test-concurrency=2 over 208 guards) that took 93 % of the rotation's wall clock,
// each run young enough to pass every age ceiling above. A snapshot cannot see a job that is always young; the ledger can.
// pure: punch-list ledger lines → tasks by share of wall clock in the window, heaviest first.
export const BG_HOG_SHARE = 0.25;
export function backgroundShare(lines, nowMs, windowH = 12) {
  const since = nowMs - windowH * HOUR * 1000; const t = {};
  for (const l of lines) { let r; try { r = JSON.parse(l); } catch { continue; }
    const at = Date.parse(r.ts); if (!(at >= since) || !r.task) continue;
    const x = t[r.task] ??= { task: r.task, runs: 0, ms: 0, maxMs: 0 }; x.runs++; x.ms += r.elapsed_ms || 0; x.maxMs = Math.max(x.maxMs, r.elapsed_ms || 0); }
  const all = Object.values(t); const total = all.reduce((a, x) => a + x.ms, 0) || 1;
  return all.map(x => ({ ...x, share: x.ms / total, hog: x.ms / total >= BG_HOG_SHARE && x.ms >= 30 * MIN * 1000 })).sort((a, b) => b.ms - a.ms);
}

// SUSTAINED HOGS — ANY PROCESS, MEASURED AS A DELTA (operator 2026-10-12: "every time we do that some new thing pops up
// that ruins the performance"). Each fix that day uncovered the next holder: renders outside the queue, then the guard pool,
// then Finder at 92–98 % CPU and ~130k faults per 10 s for 19 days. A snapshot ranks by lifetime totals and by our own
// families, so a stranger that is ALWAYS busy never surfaced. Every run now takes a 5 s delta of %CPU and page faults over
// every process (OS apps included) plus the swap-in rate, appends it to HOG_LEDGER, and a pid busy in ≥ SUSTAIN_RUNS of the
// runs inside SUSTAIN_WINDOW_S (and in this one) is SUSTAINED. A sustained hog is always NAMED; only a RESTARTABLE one
// (relaunches itself, loses nothing) is acted on, under --reap.
export const HOG_CPU_PCT = 50;
export const HOG_FAULTS_PER_S = 5000;
export const SUSTAIN_RUNS = 3;
export const SUSTAIN_WINDOW_S = 30 * MIN;
// operator 2026-10-22: "we can be more aggressive, its very unlikely any process (that is not an l1 walk) slowing the system is
// beneficial" — the bar drops from one core to half a core, still sustained over ≥ SUSTAIN_RUNS runs.
export const TAB_HOG_CPU_PCT = 50;
const HOG_LEDGER = join(REPO, '.thetacog/mem-hogs.ndjson');
// operator 2026-10-12: "kill finder" — Finder relaunches with its windows; killall is the documented reset.
export const RESTARTABLE = [{ re: /^\/System\/Library\/CoreServices\/Finder\.app\/Contents\/MacOS\/Finder$/, name: 'Finder', path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', cmd: ['kill', '-TERM'] },
  // operator 2026-10-19: "can it be killed when it slows the computer". Photos' media analysis (the "Shared with You" library
  // scan) held 99–122 % CPU for 674 min; launchd respawns it and the scan resumes from its own sqlite, so a TERM loses nothing.
  { re: /^\/System\/Library\/PrivateFrameworks\/MediaAnalysis\.framework\/Versions\/A\/mediaanalysisd$/, name: 'mediaanalysisd', path: '/System/Library/PrivateFrameworks/MediaAnalysis.framework/Versions/A/mediaanalysisd', cmd: ['kill', '-TERM'], escalate: true },
  // operator 2026-10-19: "can you use /mem to kill all tabs safari too when they exceed 80% of cpu? or what is a reasonable
  // limit, 100?" — measured that day: one Safari tab at 312 % CPU for 37 min was most of a load of 43. Killing a WebContent
  // process leaves the tab in place ("this webpage was reloaded"), as with Chrome. The bar is ONE FULL CORE (100 %) in this
  // run AND a hog in ≥ SUSTAIN_RUNS runs inside the window: a page load or a video spikes past 80 % for seconds, a runaway
  // script holds it for the ten minutes three ticks span. WebKit content processes also back Raycast, NordVPN and Mail web
  // views, so the owner is read off lsappinfo (parentasn → app name) and only Safari's are touched.
  { re: /^\/System\/Library\/Frameworks\/WebKit\.framework\/Versions\/A\/XPCServices\/com\.apple\.WebKit\.WebContent\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.WebContent$/, name: 'Safari tab', path: '/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent', cmd: ['kill', '-TERM'], escalate: true, minCpu: TAB_HOG_CPU_PCT, owner: /^Safari\b/ }];
/** pure: may this sustained hog be restarted? codesign output + owning app name (lsappinfo) → { restart|null, why } */
export function restartGate(h, restart, { sigOut = '', ownerName = null } = {}) {
  if (!restart) return { restart: null, why: null };
  if (restart.minCpu != null && !(h.cpu >= restart.minCpu)) return { restart: null, why: `${restart.name} at ${Math.round(h.cpu)} %, under its ${restart.minCpu} % bar` };
  if (restart.owner && !(ownerName && restart.owner.test(ownerName))) return { restart: null, why: `owner ${ownerName || 'UNREAD'} is not ${restart.owner.source.replace(/\\b|\^/g, '')} — not touched` };
  const sig = appleSignedAs(sigOut, restart.path);
  return { restart: sig.ok ? restart : null, why: sig.why };
}
const NOTIFIED = join(REPO, '.thetacog/mem-hog-notified.ndjson');
export const NOTIFY_CPU_PCT = 100;
/** pure: sustained hogs + rows already notified → the ones to tell him about (≥ one core, not being restarted, new pid+cmd) */
export const hogsToNotify = (stuck, seen = []) => stuck.filter(h => !h.restart && h.cpu >= NOTIFY_CPU_PCT && !seen.some(x => x.pid === h.pid && x.cmd === h.cmd));
/** pure: a hog → the notification. The app name is the .app bundle (or the binary), never the raw argv. */
export function notifyText(h) {
  const app = h.cmd.match(/\/([^/]+)\.app\//)?.[1] || h.cmd.split(' ')[0].split('/').pop();
  return { title: `${app} is holding the Mac`, body: `${Math.round(h.cpu)} % CPU, busy in ${h.runs} checks over 30 min (pid ${h.pid}). /mem may not kill it${h.sigWhy ? ': ' + h.sigWhy : ''}.` };
}
/** pure: `lsappinfo info -only name <asn>` output → the app's display name, or null */
export const parseLsappName = (out) => (out || '').match(/"LSDisplayName"="([^"]*)"/)?.[1] || null;
// A KILL'S EXIT CODE IS NOT ITS OUTCOME (measured 2026-10-19): `kill -TERM 66399` returned 0 and mediaanalysisd (a launchd
// "supports transactions" service) kept running at the same age, while the report printed "restarted". The outcome is read
// off the pid: TERM, wait, and only a pid that is gone counts. An `escalate` entry gets SIGKILL when TERM is ignored.
export function stopAndConfirm(pid, { escalate = false, kill = (p, sig) => process.kill(p, sig), isAlive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } }, wait = (ms) => spawnSync('sleep', [String(ms / 1000)]) } = {}) {
  try { kill(pid, 'SIGTERM'); } catch { /* gone already, or not ours */ }
  for (let i = 0; i < 10 && isAlive(pid); i++) wait(500);
  if (!isAlive(pid)) return { stopped: true, signal: 'TERM' };
  if (!escalate) return { stopped: false, signal: 'TERM ignored' };
  try { kill(pid, 'SIGKILL'); } catch {}
  for (let i = 0; i < 4 && isAlive(pid); i++) wait(250);
  return isAlive(pid) ? { stopped: false, signal: 'TERM+KILL ignored' } : { stopped: true, signal: 'TERM ignored → KILL' };
}
export const restartableOf = (cmd) => RESTARTABLE.find(r => r.re.test(cmd)) || null;
// A NAME IS NOT AN IDENTITY (measured 2026-10-12). Any user process can overwrite its argv, and a 10-line C program that wrote
// Finder's path into argv[0] showed in `ps` — command AND comm — as /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder.
// `codesign -dv <pid>` reads the kernel's view of the RUNNING code: Executable=/private/tmp/… · Signature=adhoc. So a restartable
// is acted on only when the running pid's executable is the expected path AND it is Apple-signed; otherwise it is reported as a
// possible impersonator, never restarted. pure: codesign -dv output → { ok, why }
export function appleSignedAs(codesignOut, expectedPath) {
  // macOS 26 runs WebKit (and other updatable system code) out of a Cryptex: the kernel reports
  // /System/Volumes/Preboot/Cryptexes/[Incoming/]OS/System/… for a pid whose argv reads /System/…. Same code, sealed volume.
  const exe = codesignOut.match(/^Executable=(.*)$/m)?.[1]?.trim().replace(/^\/System\/Volumes\/Preboot\/Cryptexes\/(?:Incoming\/)?OS(?=\/System\/)/, '');
  if (!exe) return { ok: false, why: 'signature UNREAD — not restarted' };
  if (exe !== expectedPath) return { ok: false, why: `⚠ IMPERSONATOR? argv says ${expectedPath}, running code is ${exe}` };
  if (!/^Authority=Software Signing$|^Authority=macOS Software Signing$/m.test(codesignOut)) return { ok: false, why: `⚠ IMPERSONATOR? ${exe} is not Apple-signed` };
  return { ok: true, why: 'Apple-signed' };
}

/** pure: the second sample of `top -l 2 -c d -stats pid,command,cpu,faults` → [{pid, cpu, faults}] (faults over the interval) */
export function parseTopDelta(text) {
  const parts = text.split(/^PID\s+COMMAND.*$/m); if (parts.length < 3) return [];
  const out = [];
  for (const l of parts[2].split('\n')) {
    const m = l.trim().match(/^(\d+)\s+.*?\s+([\d.]+)\s+(\d+)\+?\s*$/); if (!m) continue;
    out.push({ pid: +m[1], cpu: +m[2], faults: +m[3] });
  }
  return out;
}
/** pure: is this delta row a hog over an interval of `secs`? */
export const isHog = (r, secs) => r.cpu >= HOG_CPU_PCT || r.faults / secs >= HOG_FAULTS_PER_S;
/** pure: history rows ({ts, hogs:[{pid,cmd}]}) + this run's hogs → the ones busy in ≥ SUSTAIN_RUNS runs in the window */
export function sustained(history, current, nowMs) {
  const since = nowMs - SUSTAIN_WINDOW_S * 1000;
  const recent = history.filter(h => Date.parse(h.ts) >= since);
  return current.map(c => ({ ...c, runs: 1 + recent.filter(h => (h.hogs || []).some(x => x.pid === c.pid && x.cmd === c.cmd)).length }))
    .filter(c => c.runs >= SUSTAIN_RUNS);
}
function measureDeltas(rows, secs = 5) {
  const swapins = () => +(sh('vm_stat', []).match(/Swapins:\s+(\d+)/)?.[1] || NaN);
  const a = swapins();
  const top = sh('top', ['-l', '2', '-s', String(secs), '-c', 'd', '-n', '40', '-o', 'cpu', '-stats', 'pid,command,cpu,faults'], (secs + 20) * 1000);
  const b = swapins();
  const byPid = new Map(rows.map(r => [r.pid, r]));
  const deltas = parseTopDelta(top).map(d => ({ ...d, cmd: byPid.get(d.pid)?.cmd || '' })).filter(d => d.cmd && !/^top\b|^\/usr\/bin\/top\b/.test(d.cmd));
  return { secs, swapinsPerS: Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / (secs + 1)) : null, deltas, measured: deltas.length > 0 };
}

// THE ADMISSION RULE (2026-10-13, operator: "can the issue be prevented?"). The slowdowns were never one bad job: heavy
// background work kept STARTING while the machine was already paging, and each start made the paging worse. The signal that
// separates the two states is swap-ins per second, not swap % (90–97 % all day, calm or not) and not free % (33–42 % even
// mid-thrash): measured from .thetacog/mem-hogs.ndjson, calm ticks sat under ~100/s and thrash ran 1,000–5,600/s.
// Background heavy work asks `node scripts/ops/mem.mjs --admit` before it starts; 75 = not now, the next tick retries.
// Interactive work is never gated. Guard: tests/ops/mem-reap.test.mjs (admission)
export const ADMIT_MAX_SWAPINS_PER_S = 1000;
/** pure: may background heavy work start? → { admit, why } */
export function admitVerdict(swapinsPerS) {
  if (swapinsPerS == null || !Number.isFinite(swapinsPerS)) return { admit: true, why: 'swap rate UNMEASURED — admitted (the gate never blocks on a failed read)' };
  return swapinsPerS >= ADMIT_MAX_SWAPINS_PER_S
    ? { admit: false, why: `thrashing: ${swapinsPerS} swap-ins/s ≥ ${ADMIT_MAX_SWAPINS_PER_S} — deferred to the next tick` }
    : { admit: true, why: `${swapinsPerS} swap-ins/s` };
}
function admitDoor(label) {
  const swapins = () => +(sh('vm_stat', []).match(/Swapins:\s+(\d+)/)?.[1] || NaN);
  const a = swapins(); spawnSync('sleep', ['1']); const b = swapins();
  const v = admitVerdict(Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  if (!v.admit) { try { mkdirSync(join(REPO, '.thetacog'), { recursive: true }); appendFileSync(join(REPO, '.thetacog/mem-admit.ndjson'), JSON.stringify({ ts: new Date().toISOString(), label, ...v }) + '\n'); } catch { /* ledger best-effort */ } }
  console.log(`mem --admit${label ? ` [${label}]` : ''}: ${v.admit ? 'ADMIT' : 'DEFER'} — ${v.why}`);
  process.exit(v.admit ? 0 : 75);
}

// THE SETTLE DOOR (operator 2026-10-28: "make sure that the computer gets a certain amount of rest and clean up, clean up all
// memory between every round" · "takes as long as it needs to take to clean up the swap file"). Between two rounds of a
// recurring job: reap (this file, --reap), unload every model ollama holds, then rest by the minute until the machine is CALM,
// never past the cap. CALM is both: 1-min load per core at or under SETTLE_LOAD_PER_CORE, and swap-ins/s under
// SETTLE_MAX_SWAPINS_PER_S (the calm band the admission rule measured: calm ticks sat under ~100/s). Swap USED is printed and
// never waited on: it sat at 90–97 % all day, calm or not, and the swap file shrinks only when the processes holding its pages
// exit or touch them, which a rest cannot cause. So the line names the biggest holders instead, read off top's CMPRS column.
//   node scripts/ops/mem.mjs --settle [--min 5] [--max 20] [--load-per-core 0.4] [--tick-s 60] [--dry]
// MEM_SETTLE_LOAD / MEM_SETTLE_SWAPINS override the two reads (the guard drives the door with them).
// Guard: tests/ops/mem-settle.test.mjs
export const SETTLE_LOAD_PER_CORE = 0.4;
export const SETTLE_MAX_SWAPINS_PER_S = 100;
/** pure: is the machine calm enough to start the next round? An unread signal counts as calm (never wedge on a failed read). */
export function settleCalm({ load1, ncpu, swapinsPerS }, { loadPerCore = SETTLE_LOAD_PER_CORE, maxSwapins = SETTLE_MAX_SWAPINS_PER_S } = {}) {
  const loadOk = !Number.isFinite(load1) || !(ncpu > 0) || load1 / ncpu <= loadPerCore;
  const swapOk = swapinsPerS == null || !Number.isFinite(swapinsPerS) || swapinsPerS < maxSwapins;
  return { calm: loadOk && swapOk, loadOk, swapOk };
}
/** pure: `top -o cmprs -stats pid,command,mem,cmprs` output → the n biggest compressed-memory holders, [{pid, cmd, cmprsMb}] */
export function parseCmprs(topOut, n = 3) {
  const mb = (v) => { const m = String(v).match(/^([\d.]+)([KMG])?[+-]?$/); return m ? +m[1] * ({ K: 1 / 1024, M: 1, G: 1024 }[m[2] || 'M']) : 0; };
  const rows = [];
  for (const l of String(topOut).split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(.+?)\s+([\d.]+[KMG]?[+-]?)\s+([\d.]+[KMG]?[+-]?)\s*$/);
    if (m) rows.push({ pid: +m[1], cmd: m[2].trim(), cmprsMb: Math.round(mb(m[4])) });
  }
  return rows.sort((a, b) => b.cmprsMb - a.cmprsMb).slice(0, n);
}
function settleRead() {
  const env = process.env;
  const set = (k) => env[k] != null && env[k] !== '';   // an empty override is unset, never a zero
  const load1 = set('MEM_SETTLE_LOAD') ? +env.MEM_SETTLE_LOAD : +(sh('sysctl', ['-n', 'vm.loadavg']).match(/[\d.]+/)?.[0] || NaN);
  const ncpu = +(sh('sysctl', ['-n', 'hw.ncpu']).trim() || 0) || 1;
  let swapinsPerS = null;
  if (set('MEM_SETTLE_SWAPINS')) swapinsPerS = +env.MEM_SETTLE_SWAPINS;
  else {
    const si = () => +(sh('vm_stat', []).match(/Swapins:\s+(\d+)/)?.[1] || NaN);
    const a = si(); spawnSync('sleep', ['2']); const b = si();
    swapinsPerS = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 2) : null;
  }
  return { load1, ncpu, swapinsPerS };
}
function settleDoor(argv) {
  const num = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? +argv[i + 1] : d; };
  const min = num('--min', 5), max = Math.max(num('--max', 20), min), lpc = num('--load-per-core', SETTLE_LOAD_PER_CORE), tick = num('--tick-s', 60);
  const dry = argv.includes('--dry');
  const reaped = dry ? 'REAPED (dry)' : ((spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--reap', '--quiet'], { encoding: 'utf8', timeout: 120000 }).stdout || '').match(/REAPED \(\d+\)/)?.[0] || 'REAPED (0)');
  const unloaded = [];
  if (!dry) for (const n of sh('ollama', ['ps']).split('\n').slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean)) if (spawnSync('ollama', ['stop', n]).status === 0) unloaded.push(n);
  const before = settleRead(), p0 = pressure();
  let m = 0, now = before, v = settleCalm(now, { loadPerCore: lpc });
  while (m < min) { spawnSync('sleep', [String(tick)]); m++; }
  if (m > 0) { now = settleRead(); v = settleCalm(now, { loadPerCore: lpc }); }
  while (m < max && !v.calm) { spawnSync('sleep', [String(tick)]); m++; now = settleRead(); v = settleCalm(now, { loadPerCore: lpc }); }
  const p1 = pressure();
  const holders = dry ? [] : parseCmprs(sh('top', ['-l', '1', '-o', 'cmprs', '-n', '8', '-stats', 'pid,command,mem,cmprs'], 15000));
  const swap = (p) => (p.swapTotalGb > 0 ? `${Math.round(100 * p.swapUsedGb / p.swapTotalGb)}%` : '?');
  const why = v.calm ? 'calm' : 'cap reached, not calm';
  console.log(`mem --settle: ${m} min · ${why} · load ${before.load1} → ${now.load1} on ${now.ncpu} cores · swap-ins/s ${before.swapinsPerS ?? 'UNMEASURED'} → ${now.swapinsPerS ?? 'UNMEASURED'} · swap used ${swap(p0)} → ${swap(p1)} · ${reaped} · local models unloaded: ${unloaded.join(' ') || 'none'} · biggest swap holders: ${holders.map(h => `${h.cmd} ${h.pid} ${h.cmprsMb} MB`).join(', ') || 'UNMEASURED'}`);
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--settle')) return settleDoor(argv);
  if (argv.includes('--admit')) return admitDoor(argv[argv.indexOf('--admit') + 1] && !argv[argv.indexOf('--admit') + 1].startsWith('--') ? argv[argv.indexOf('--admit') + 1] : '');
  const doReap = argv.includes('--reap'), away = argv.includes('--away'), quiet = argv.includes('--quiet'), json = argv.includes('--json');
  const cpu = parseCpu(sh('ps', ['-axo', 'pid=,%cpu=']));
  const rows = parsePs(sh('ps', ['-axo', 'pid=,ppid=,stat=,tty=,etime=,rss=,command='])).map(r => ({ ...r, cpu: cpu.get(r.pid) }));
  const p = pressure();
  const thrash = isThrash(p);
  const verdicts = classify(rows, { selfPids: selfChain(rows), thrash });
  const fp = new Map();
  const tabRows = readTabs(fp);
  const holders = fp.size ? swapHolders(rows.map(r => ({ ...r, mb: fp.get(r.pid) || 0 })), { slow: isSlow(p, p.ncpu || 10), colima: readColima(), away }) : [];
  const tabs = tabRows ? chromeTabs(tabRows, { away, slow: isSlow(p, p.ncpu || 10), swapFull: p.swapTotalGb > 0 && 100 * p.swapUsedGb / p.swapTotalGb >= THRASH_SWAP_PCT }) : [];
  const reap = [...verdicts.filter(v => v.verdict === 'reap'), ...tabs.filter(t => t.verdict === 'reap'), ...holders.filter(h => h.verdict === 'reap')], zombies = verdicts.filter(v => v.verdict === 'zombie');

  if (doReap && reap.length) {
    for (const r of reap) {
      if (r.action === 'colima-stop') { r.stopped = spawnSync('colima', ['stop'], { timeout: 180000 }).status === 0; continue; }
      try { process.kill(r.pid, 'SIGTERM'); } catch {}
    }
    await new Promise(res => setTimeout(res, 3000));
    mkdirSync(dirname(LEDGER), { recursive: true });
    for (const r of reap) {
      let signal = r.action === 'colima-stop' ? (r.stopped ? 'colima stop' : 'colima stop FAILED') : 'TERM';
      if (!r.action && alive(r.pid)) { try { process.kill(r.pid, 'SIGKILL'); signal = 'KILL'; } catch {} }
      appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), pid: r.pid, ppid: r.ppid, ageS: r.age, rssKb: r.rssKb, mb: r.mb, signal, why: r.why, cmd: r.cmd.slice(0, 300) }) + '\n');
    }
  }

  const dm = measureDeltas(rows);
  const hogsNow = dm.deltas.filter(d => isHog(d, dm.secs)).map(d => ({ pid: d.pid, cmd: d.cmd.slice(0, 200), cpu: d.cpu, faultsPerS: Math.round(d.faults / dm.secs) }));
  let hogHistory = []; try { hogHistory = readFileSync(HOG_LEDGER, 'utf8').trim().split('\n').slice(-200).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { /* first run */ }
  const stuck = sustained(hogHistory, hogsNow, Date.now()).map(h => {
    const restart = restartableOf(h.cmd); if (!restart) return { ...h, restart: null };
    const sigOut = spawnSync('codesign', ['-dv', '--verbose=2', String(h.pid)], { encoding: 'utf8', timeout: 10000 }).stderr || '';
    let ownerName = null;
    if (restart.owner) { const asn = (spawnSync('lsappinfo', ['info', '-only', 'parentasn', String(h.pid)], { encoding: 'utf8', timeout: 5000 }).stdout || '').match(/ASN:[^"]*/)?.[0];
      if (asn) ownerName = parseLsappName(spawnSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8', timeout: 5000 }).stdout); }
    const g = restartGate(h, restart, { sigOut, ownerName });
    return { ...h, restart: g.restart, sigWhy: g.why };
  });
  if (dm.measured) { mkdirSync(dirname(HOG_LEDGER), { recursive: true }); appendFileSync(HOG_LEDGER, JSON.stringify({ ts: new Date().toISOString(), swapinsPerS: dm.swapinsPerS, hogs: hogsNow }) + '\n'); }
  // THE HOG COMES TO HIM (operator 2026-10-19: "ths slowdown keeps hiding in different apps - LIKE WE ARE CHASING IT").
  // The delta above already sees every process; what hid was the VERDICT — a sustained hog /mem may not kill sat in a report
  // nobody reads on the 5-minute tick, until he asked. Now a sustained hog at ≥ one core that is not restarted posts ONE
  // macOS notification per pid+command (.thetacog/mem-hog-notified.ndjson), naming the app, its CPU and how long.
  if (doReap) { let seen = []; try { seen = readFileSync(NOTIFIED, 'utf8').trim().split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { /* none yet */ }
    for (const h of hogsToNotify(stuck, seen)) {
      const msg = notifyText(h);
      spawnSync('osascript', ['-e', `display notification ${JSON.stringify(msg.body)} with title ${JSON.stringify(msg.title)}`], { timeout: 5000 });
      mkdirSync(dirname(NOTIFIED), { recursive: true }); appendFileSync(NOTIFIED, JSON.stringify({ ts: new Date().toISOString(), pid: h.pid, cmd: h.cmd, cpu: h.cpu, runs: h.runs, body: msg.body }) + '\n');
    } }
  if (doReap) for (const h of stuck.filter(h => h.restart)) {
    const out = stopAndConfirm(h.pid, { escalate: !!h.restart.escalate }); h.restarted = out.stopped;
    appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), pid: h.pid, signal: out.signal, stopped: out.stopped, why: `sustained hog: ${h.cpu}% CPU, ${h.faultsPerS} faults/s, busy in ${h.runs} runs inside ${SUSTAIN_WINDOW_S / MIN} min — restartable (${h.restart.name}, ${h.sigWhy})`, cmd: h.cmd }) + '\n');
  }
  const hot = busiest(rows).filter(r => r.cpu >= 10 && !selfChain(rows).has(r.pid));
  if (json) { console.log(JSON.stringify({ pressure: p, cpu: hot.map(({ pid, ppid, age, cpu, cmd }) => ({ pid, ppid, age, cpu, cmd: cmd.slice(0, 200) })), reap, zombies, reaped: doReap, swapinsPerS: dm.swapinsPerS, hogs: hogsNow, sustained: stuck }, null, 2)); return; }
  // C825 — THE TEMP SWEEP (scripts/ops/tmp-sweep.mjs): under --reap the repo's leaked temp folders (prefix read from the
  // code, older than 6 h, ≤ 5000 per run) are removed on every tick; without --reap the report counts them.
  let saf = null; try { const { tidy } = await import('./safari-tidy.mjs'); saf = tidy({ reap: doReap, slow: isSlow(p, p.ncpu || 10) || (dm.swapinsPerS || 0) >= 1000, rows: rows.map(r => ({ ...r, mb: fp.get(r.pid) || 0 })) }); } catch (e) { saf = { line: `SAFARI  UNMEASURED (${e && e.message || e})` }; }
  let tmp = null; try { const { sweep } = await import('./tmp-sweep.mjs'); tmp = sweep({ dryRun: !doReap }); } catch (e) { tmp = { error: String(e && e.message || e) }; }
  // C826c — THE CACHE FOLD (scripts/ops/cache-fold.mjs): under --reap, per-run files in .thetacog/cache older than 24 h fold
  // into one daily gzip tape per family (≤ 3000 files / 300 MB per run); without --reap the report counts them.
  let cf = null; try { const { fold } = await import('./cache-fold.mjs'); cf = fold({ dryRun: !doReap }); } catch (e) { cf = { error: String(e && e.message || e) }; }
  // C826e — THE STAGES FOLD: data/pmu/pipeline/stages held 210,415 loose run-/cell-*.json files (123 GB).
  // pipeline-state.mjs's writeRunReceipt now appends straight to a tape, but .thetacog/pmu/src/door_panel.rs's
  // own `records()` (the on-chip {"op":"panel"} door-serve path) is a SEPARATE writer still using std::fs::write
  // to a loose file — not ported in this pass (too large a blast radius: it is the binary every post-commit
  // hook on this shared tree runs). This recurring sweep (2-min min age — short, since these are read-once
  // immutable receipts, not a live process's pidfile) catches whatever that writer leaves behind on every
  // --reap tick, so accumulation stays capped at roughly the last tick's worth instead of growing without
  // bound. The one-time backlog drain is scripts/pmu/migrate-stages-to-tapes.mjs (run once, separately, in
  // the background — this call only ever sees what accrued since the last tick).
  let sf = null;
  try {
    const { fold } = await import('./cache-fold.mjs');
    const { STAGES_DIR, stageFamily } = await import('../pmu/pipeline-state.mjs');
    sf = fold({ dir: STAGES_DIR, family: stageFamily, minAgeMs: 2 * 60 * 1000, dryRun: !doReap, ledger: resolve(REPO, '.thetacog/stages-fold.ndjson') });
  } catch (e) { sf = { error: String(e && e.message || e) }; }
  // C826f — THE FILE CENSUS (scripts/ops/file-census.mjs): at most once an hour, detached and niced, count the files each
  // folder gave birth to in 24 h, so the next per-run generator is named on the CONTROL line before it becomes a pile.
  if (doReap) { try { const { due } = await import('./file-census.mjs'); if (due()) spawn('nice', ['-n', '15', process.execPath, resolve(REPO, 'scripts/ops/file-census.mjs'), '--json'], { detached: true, stdio: 'ignore' }).unref(); } catch {} }
  // C831 — the controllers line: every control that keeps a measured slowdown from coming back, read from its own ledger
  let ctl = null; try { const C = await import('./controllers.mjs'); ctl = C.controllersLine(C.controllers()); } catch (e) { ctl = `CONTROL UNMEASURED (${String(e && e.message || e).slice(0, 80)})`; }
  if (quiet) {
    if (ctl && /MISSING|UNMEASURED/.test(ctl)) console.log(`${new Date().toISOString()} mem: ${ctl}`);
    if (cf && cf.folded) console.log(`${new Date().toISOString()} mem: cache fold put ${cf.folded} per-run files (${Math.round(cf.bytes / 1e6)} MB) on tapes · ${cf.eligible - cf.folded} left`);
    if (sf && sf.folded) console.log(`${new Date().toISOString()} mem: stages fold put ${sf.folded} run/cell receipts (${Math.round(sf.bytes / 1e6)} MB) on tapes · ${sf.eligible - sf.folded} left`);
    if (tmp && tmp.removed) console.log(`${new Date().toISOString()} mem: tmp sweep removed ${tmp.removed} leaked repo folders (${tmp.entries} entries before)`);
    for (const h of stuck) console.log(`${new Date().toISOString()} mem: SUSTAINED HOG pid ${h.pid} ${h.cpu}% CPU ${h.faultsPerS} faults/s × ${h.runs} runs — ${h.restart ? (h.restarted ? 'restarted' : 'restart FAILED') : (h.sigWhy || 'named, not ours to kill')} · ${h.cmd.slice(0, 120)}`);
    if (reap.length || zombies.length) console.log(`${new Date().toISOString()} mem: ${doReap ? 'reaped' : 'would reap'} ${reap.length} (${Math.round(reap.reduce((a, r) => a + (r.mb || r.rssKb / 1024), 0))} MB) · zombies ${zombies.length} · swap ${p.swapUsedGb}/${p.swapTotalGb} GB · load ${p.load1}`);
    return;
  }

  const fams = {};
  for (const r of rows) { const f = family(r.cmd); if (f) { fams[f] ??= { n: 0, mb: 0, cpu: 0 }; fams[f].n++; fams[f].mb += fp.get(r.pid) ?? r.rssKb / 1024; fams[f].cpu += r.cpu || 0; } }
  const swapPct = p.swapTotalGb ? Math.round(100 * p.swapUsedGb / p.swapTotalGb) : null;
  console.log(`MEMORY  swap ${p.swapUsedGb}/${p.swapTotalGb} GB (${swapPct}%)${isThrash(p) ? '  ⚠ THRASH' : ''} · wired ${p.wiredGb} GB · compressed ${p.compressedGb} GB · free ${p.freePct}% · load ${p.load1}`);
  const per = p.load1 != null && p.ncpu ? (p.load1 / p.ncpu).toFixed(1) : '?';
  const total = Math.round(rows.reduce((a, r) => a + (r.cpu || 0), 0));
  console.log(`CPU     load ${p.load1} on ${p.ncpu ?? '?'} cores (${per}× per core) · ps %CPU summed ${total}% of ${(p.ncpu || 0) * 100}%${cpu.size ? '' : '  · UNMEASURED (ps %cpu returned nothing)'}`);
  for (const r of hot) console.log(`  ${String(Math.round(r.cpu)).padStart(5)}%  ${String(r.pid).padStart(6)}  ${String(Math.round(r.age / MIN)).padStart(6)} min  ${(CHROME_RENDERER.test(r.cmd) ? 'Chrome renderer (tab)' : r.cmd.replace(REPO + '/', '')).slice(0, 110)}`);
  if (!tabRows) console.log('CHROME  tab footprints UNMEASURED (top returned nothing) — no tab was judged');
  console.log(`OLLAMA  ${p.ollama.length ? p.ollama.join(' | ') : 'no model resident'}`);
  if (ctl) console.log(ctl);
  if (saf) console.log(saf.line);
  console.log(tmp && !tmp.error ? `TMP     ${tmp.entries} entries · ${tmp.leaked} leaked repo folders older than 6 h · ${doReap ? `removed ${tmp.removed}` : 'run with --reap to sweep'}${tmp.entries >= 50000 ? '  ⚠ LEAK — a fixture is not cleaning up; read .thetacog/tmp-sweep.ndjson' : ''}` : `TMP     UNMEASURED (${tmp && tmp.error})`);
  console.log(cf && !cf.error ? `CACHE   ${cf.entries} entries in .thetacog/cache · ${cf.eligible} per-run files older than 24 h · ${doReap ? `folded ${cf.folded} onto tapes` : 'run with --reap to fold'}${cf.entries >= 20000 ? '  ⚠ PILE — read .thetacog/cache-fold.ndjson' : ''}` : `CACHE   UNMEASURED (${cf && cf.error})`);
  console.log(sf && !sf.error ? `STAGES  ${sf.entries} entries in data/pmu/pipeline/stages · ${sf.eligible} receipts older than 2 min · ${doReap ? `folded ${sf.folded} onto tapes` : 'run with --reap to fold'}${sf.entries >= 5000 ? '  ⚠ PILE — door_panel.rs still writes loose receipts; read .thetacog/stages-fold.ndjson' : ''}` : `STAGES  UNMEASURED (${sf && sf.error})`);
  if (!dm.measured) console.log('HOGS    UNMEASURED (top delta returned nothing) — no process was judged');
  else {
    console.log(`SWAP IO ${dm.swapinsPerS ?? '?'} pages/s in${dm.swapinsPerS >= 1000 ? '  ⚠ THRASHING (≥1000/s) — read HOGS and BACKGROUND for the holder' : ''}`);
    console.log(`HOGS    (${dm.secs} s delta, any process: ≥${HOG_CPU_PCT}% CPU or ≥${HOG_FAULTS_PER_S} faults/s)${hogsNow.length ? '' : '  none'}`);
    for (const h of hogsNow.slice(0, 8)) { const st = stuck.find(x => x.pid === h.pid);
      console.log(`  ${String(Math.round(h.cpu)).padStart(5)}%  ${String(h.faultsPerS).padStart(7)} f/s  ${String(h.pid).padStart(6)}  ${st ? `⚠ SUSTAINED ×${st.runs}${st.restart ? (doReap ? (st.restarted ? ' → restarted' : ' → restart FAILED') : ' → restartable, --reap restarts it') : ` → ${st.sigWhy || "named; not ours to kill"}`}  ` : ''}${h.cmd.slice(0, 100)}`); }
  }
  { let led = []; try { led = readFileSync(join(REPO, '.thetacog/punch-list-ledger.ndjson'), 'utf8').trim().split('\n').slice(-3000); } catch { /* no ledger */ }
    const bg = backgroundShare(led, Date.now()).slice(0, 3);
    if (bg.length) console.log('BACKGROUND (punch-list wall clock, last 12 h)  ' + bg.map(x => `${x.hog ? '⚠ ' : ''}${x.task} ${Math.round(100 * x.share)}% · ${x.runs} runs · ${Math.round(x.ms / 60000)} min · max ${Math.round(x.maxMs / 60000)} min`).join('  |  ')); }
  console.log(fp.size ? 'FOOTPRINT BY FAMILY (top MEM, which counts compressed + swapped pages; + ps %CPU)' : 'RESIDENT BY FAMILY (RSS — footprint UNMEASURED, swapped pages are not counted; + ps %CPU)');
  for (const [f, s] of Object.entries(fams).sort((a, b) => b[1].mb - a[1].mb)) console.log(`  ${String(Math.round(s.mb)).padStart(6)} MB  ${String(Math.round(s.cpu)).padStart(4)}% CPU  ${String(s.n).padStart(3)} × ${f}`);
  if (fp.size) {
    console.log('LARGEST FOOTPRINTS (what swap is holding)');
    for (const r of rows.filter(r => !CHROME_RENDERER.test(r.cmd)).sort((a, b) => (fp.get(b.pid) || 0) - (fp.get(a.pid) || 0)).slice(0, 6))
      console.log(`  ${String(Math.round(fp.get(r.pid))).padStart(6)} MB  ${String(r.pid).padStart(6)}  ${String(Math.round(r.age / HOUR)).padStart(5)} h  ${(holders.find(h => h.pid === r.pid)?.why || '').padEnd(0)}${holders.find(h => h.pid === r.pid) ? '  · ' : ''}${r.cmd.replace(REPO + '/', '').replace(/^.*\/(Code Helper \(Renderer\)|com\.apple\.Virtualization\.VirtualMachine).*$/, '$1').slice(0, 90)}`);
  }
  const line = (r) => `  ${String(r.pid).padStart(6)}  ${String(Math.round(r.age / MIN)).padStart(6)} min  ${String(Math.round(r.mb || r.rssKb / 1024)).padStart(5)} MB  ${r.why}\n          ${(CHROME_RENDERER.test(r.cmd) ? 'Chrome renderer (tab)' : r.cmd.replace(REPO + '/', '')).slice(0, 150)}`;
  console.log(`\n${doReap ? 'REAPED' : 'WOULD REAP'} (${reap.length})${doReap ? '  → .thetacog/mem-reaps.ndjson' : '  — run with --reap'}`);
  for (const r of reap) console.log(line(r));
  if (zombies.length) { console.log(`\nZOMBIES (${zombies.length}) — cannot be signalled; their parent must wait() or die`); for (const z of zombies) console.log(line(z)); }
  const young = verdicts.filter(v => v.verdict === 'keep' && /ceiling|min$/.test(v.why) && / of /.test(v.why));
  if (young.length) { console.log(`\nKEPT, ON THE CLOCK (${young.length}) — repo work still inside its ceiling`); for (const r of young.slice(0, 12)) console.log(line(r)); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
