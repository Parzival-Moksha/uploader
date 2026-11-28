// Processes the agents leave behind, and ones that run away. Windows only (elsewhere a no-op).
// The Hacker's finding, 22 Nov (the white-hat mission): 96 orphaned Git-Bash processes, nearly all
// `tail -f <log> | grep --line-buffered …` log watchers from Monitor or background Bash. An agent's tool ends by killing
// its bash.exe; on Windows that doesn't take the MSYS children with it (no shared process group or job object),
// `tail -f` never ends, and `grep` waits on `tail`. A runaway `sed` held a core overnight the same way.
//
// Three parts, all from one process list taken every minute (one long-lived PowerShell, about a quarter second of CPU
// per list):
//   1  sweep (every SWEEP_EVERY_MS): a Git-Bash helper (Git's usr\bin or bin) older than ORPHAN_MIN_AGE_MS whose parent
//      chain no longer reaches a live claude.exe, the Oasis's own node, or a human shell is stopped. The rule of
//      C:/7m_sysadmin/scripts/orphan-sweep.ps1 -Execute -MinAgeMinutes 60.
//   2  an agent's process exits (a restart, an account switch, a kill): the Git-Bash helpers recorded under it are
//      stopped. Only those: a render or a server the agent started on purpose (python, node, ffmpeg …) keeps running.
//   3  runaway: any process under an agent averaging at least RUNAWAY_CORES of a core over RUNAWAY_WINDOW_MS shows in
//      /health and is said once in that agent's thread, and to the agent with its next message.
// Never the engine (4530) or the page server (4516) themselves: only processes under an agent, or orphaned Git-Bash
// helpers. Before anything is stopped it is matched again by pid AND start time in a fresh list (pids are reused).
// The pure rules are unit-tested (src/lib/__tests__/agent-engine-procs.test.ts).
import { spawn } from 'node:child_process';

export const GIT_HELPER = /\\Git\\(usr\\)?bin\\/i;
const KEEP_ROOTS = /^(claude\.exe|WindowsTerminal\.exe|explorer\.exe|Code\.exe|Cursor\.exe|OpenConsole\.exe)$/i;
const OASIS_NODE = /oasis-agent-engine|start-server\.js|next[\\/]dist|next dev|next-server/i;

export const SAMPLE_EVERY_MS = Number(process.env.OASIS_PROC_EVERY_MS || 60_000);
export const SWEEP_EVERY_MS = Number(process.env.OASIS_SWEEP_EVERY_MS || 30 * 60_000);
export const ORPHAN_MIN_AGE_MS = Number(process.env.OASIS_ORPHAN_MIN_AGE_MS ?? 60 * 60_000);
export const RUNAWAY_WINDOW_MS = Number(process.env.OASIS_RUNAWAY_WINDOW_MS || 20 * 60_000);
export const RUNAWAY_CORES = 0.9;

/** One process: { pid, ppid, name, path, created (ms), cpuMs, cmd }. */
export function parseList(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { return null; }
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((p) => ({
    pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), name: String(p.Name || ''), path: String(p.ExecutablePath || ''),
    created: Date.parse(p.Created) || 0, cpuMs: Number(p.Cpu) || 0, cmd: String(p.Cmd || ''),
  })).filter((p) => p.pid > 0);
}

export const keyOf = (p) => `${p.pid}@${p.created}`;

/**
 * Where a process's parent chain ends: { root } (a live claude.exe, the Oasis's own node, a human shell) or { why }
 * ('parent gone' | 'parent PID reused': a parent younger than its child is another process with a reused pid).
 */
export function chainRoot(p, byPid) {
  let cur = p;
  for (let i = 0; i < 30; i += 1) {
    const par = byPid.get(cur.ppid);
    if (!par) return { why: 'parent gone' };
    if (par.created > cur.created) return { why: 'parent PID reused' };
    if (KEEP_ROOTS.test(par.name)) return { root: par.name };
    if (/^node\.exe$/i.test(par.name) && OASIS_NODE.test(par.cmd)) return { root: 'oasis node' };
    cur = par;
  }
  return { why: 'chain too long' };
}

/** Part 1: Git-Bash helpers older than minAgeMs whose chain reaches nothing alive that owns them. `match`: tests only. */
export function findOrphans(list, { now, minAgeMs = ORPHAN_MIN_AGE_MS, match = null } = {}) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const out = [];
  for (const p of list) {
    if (!GIT_HELPER.test(p.path)) continue;
    if (now - p.created < minAgeMs) continue;
    if (match && !match.test(p.cmd)) continue;
    const r = chainRoot(p, byPid);
    if (!r.root) out.push({ ...p, why: r.why });
  }
  return out;
}

/** Every process under `rootPid` (children younger than their parent; a reused pid breaks the line). */
export function descendantsOf(list, rootPid) {
  const root = list.find((p) => p.pid === rootPid);
  if (!root) return [];
  const children = new Map();
  for (const p of list) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const out = [];
  const queue = [root];
  const seen = new Set([root.pid]);
  while (queue.length) {
    const cur = queue.shift();
    for (const c of children.get(cur.pid) || []) {
      if (seen.has(c.pid) || c.created < cur.created) continue;
      seen.add(c.pid);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/**
 * The work running under an agent's claude that a restart or an account move would cut off (27 Nov: Tyler's final
 * encode died with his session's restart): its descendants, without Git-Bash utilities (a tail -f watcher, a grep),
 * the shells that only wrap a job (cmd, powershell, conhost: the job itself counts), claude itself, and the servers
 * claude keeps for its tools (MCP, the Chrome bridge).
 */
const WRAPPERS = /^(conhost|cmd|powershell|pwsh|claude)(\.exe)?$/i;
const TOOL_SERVERS = /mcp|native-messaging|chrome-native-host/i;
export function workHelpers(list, rootPid) {
  return descendantsOf(list, rootPid).filter((p) => !GIT_HELPER.test(p.path) && !WRAPPERS.test(p.name) && !TOOL_SERVERS.test(p.cmd));
}

/** "ffmpeg.exe (… -i final.mov …)": a name and a short look at what it runs. */
export function helperText(p) {
  const cmd = String(p.cmd || '').replace(/^"[^"]*"\s*|^\S+\s*/, '').replace(/\s+/g, ' ').trim();
  return cmd ? `${p.name} (${cmd.length > 70 ? `${cmd.slice(0, 69)}…` : cmd})` : p.name;
}

/**
 * Part 3: from CPU samples per process ({ key -> [{ at, cpuMs }] }), the ones that averaged at least `cores` over the
 * last `windowMs` (a sample at least that old is needed). -> [{ key, cores }]
 */
export function runawaysFrom(history, { now, windowMs = RUNAWAY_WINDOW_MS, cores = RUNAWAY_CORES } = {}) {
  const out = [];
  for (const [key, samples] of history) {
    if (samples.length < 2) continue;
    const last = samples[samples.length - 1];
    const old = samples.filter((s) => s.at <= now - windowMs);
    if (!old.length) continue;
    const first = old[old.length - 1];
    const span = last.at - first.at;
    if (span < windowMs * 0.9) continue;
    const avg = (last.cpuMs - first.cpuMs) / span;
    if (avg >= cores) out.push({ key, cores: Math.round(avg * 100) / 100 });
  }
  return out;
}

const PS_LIST = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}},@{n='Cpu';e={[int64](($_.KernelModeTime+$_.UserModeTime)/10000)}},@{n='Cmd';e={ if ($_.CommandLine) { $_.CommandLine.Substring(0,[Math]::Min(160,$_.CommandLine.Length)) } }} | ConvertTo-Json -Compress";

/** One list now (a short-lived PowerShell): for the checks right before stopping anything. */
export function listOnce() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_LIST], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } }, 30_000);
    ps.on('close', () => { clearTimeout(timer); resolve(parseList(out)); });
    ps.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

/** Stop these processes, each only if a fresh list still shows it with the same pid and start time. -> the stopped. */
export async function stopExact(targets, { log = () => {} } = {}) {
  if (!targets.length) return [];
  const fresh = await listOnce();
  if (!fresh) return [];
  const alive = new Set(fresh.map(keyOf));
  const stopped = [];
  for (const t of targets) {
    if (!alive.has(keyOf(t))) continue;
    try { process.kill(t.pid); stopped.push(t); } catch (e) { log(`procs: could not stop ${t.name} ${t.pid}: ${e.message}`); }
  }
  return stopped;
}

/** "3 × tail.exe, 3 × grep.exe, sed.exe". */
export function namesText(list) {
  const counts = new Map();
  for (const p of list) counts.set(p.name, (counts.get(p.name) || 0) + 1);
  return [...counts].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(', ');
}

/**
 * The watcher. `agents()`: [{ id, name, pid }] of the agents whose claude runs now. `onRunaway(agentId, info)`: once per
 * runaway process. Every sample: who is under each agent, CPU per process; every SWEEP_EVERY_MS: the sweep.
 */
export class ProcWatch {
  constructor({ agents, onRunaway = () => {}, log = () => {}, match = null } = {}) {
    this.agents = agents;
    this.onRunaway = onRunaway;
    this.log = log;
    this.match = match;
    /** agentId -> Map(key -> proc): what was under its claude when last seen (part 2). */
    this.under = new Map();
    /** key -> [{ at, cpuMs }] for processes under agents (part 3). */
    this.cpu = new Map();
    /** key -> { agentId, agent, pid, name, cmd, cores, since } said already. */
    this.runaways = new Map();
    this.lastSample = null;
    this.lastSweep = null;
    this.nextSweepAt = Date.now() + Math.min(SWEEP_EVERY_MS, 5 * 60_000); // the first a few minutes after the start
    this.ps = null;
    this.buf = '';
    this.stopped = false;
    this.backoff = 5000;
  }

  start() {
    if (process.platform !== 'win32' || this.ps || this.stopped) return;
    const loop = `while ($true) { $j = ${PS_LIST}; [Console]::Out.WriteLine($j); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${SAMPLE_EVERY_MS} }`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', loop], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    this.ps = ps;
    ps.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const list = parseList(line);
        if (list) { this.backoff = 5000; void this.onList(list).catch((e) => this.log(`procs: ${e.message}`)); }
      }
    });
    ps.on('exit', () => {
      this.ps = null;
      this.buf = '';
      if (this.stopped) return;
      setTimeout(() => this.start(), this.backoff).unref?.();
      this.backoff = Math.min(this.backoff * 2, 10 * 60_000);
    });
    ps.on('error', () => {});
  }

  stop() {
    this.stopped = true;
    try { this.ps?.kill(); } catch { /* gone */ }
  }

  async onList(list) {
    const now = Date.now();
    this.lastSample = now;
    const live = new Set(list.map(keyOf));
    const running = this.agents();
    const watched = new Set();
    for (const a of running) {
      if (!a.pid) continue;
      const under = this.under.get(a.id) || new Map();
      for (const k of [...under.keys()]) if (!live.has(k)) under.delete(k);
      for (const p of descendantsOf(list, a.pid)) {
        const k = keyOf(p);
        under.set(k, p);
        watched.add(k);
        const samples = this.cpu.get(k) || [];
        samples.push({ at: now, cpuMs: p.cpuMs, agentId: a.id });
        while (samples.length && samples[0].at < now - RUNAWAY_WINDOW_MS * 1.5) samples.shift();
        this.cpu.set(k, samples);
      }
      this.under.set(a.id, under);
    }
    for (const k of [...this.cpu.keys()]) if (!watched.has(k)) this.cpu.delete(k);
    for (const k of [...this.runaways.keys()]) if (!live.has(k)) this.runaways.delete(k);
    for (const r of runawaysFrom(this.cpu, { now })) {
      if (this.runaways.has(r.key)) { this.runaways.get(r.key).cores = r.cores; continue; }
      const p = list.find((x) => keyOf(x) === r.key);
      const agentId = this.cpu.get(r.key).at(-1).agentId;
      const agent = running.find((a) => a.id === agentId);
      if (!p || !agent) continue;
      const info = { agentId, agent: agent.name, pid: p.pid, name: p.name, cmd: p.cmd, cores: r.cores, since: now - RUNAWAY_WINDOW_MS };
      this.runaways.set(r.key, info);
      this.log(`procs: runaway under ${agent.name}: ${p.name} ${p.pid} at ${r.cores} of a core for ${Math.round(RUNAWAY_WINDOW_MS / 60_000)} min (${p.cmd.slice(0, 80)})`);
      this.onRunaway(agentId, info);
    }
    if (now >= this.nextSweepAt) {
      this.nextSweepAt = now + SWEEP_EVERY_MS;
      await this.sweep(list, now);
    }
  }

  /** Part 1. */
  async sweep(list, now = Date.now()) {
    const orphans = findOrphans(list, { now, match: this.match });
    const stopped = await stopExact(orphans, { log: this.log });
    this.lastSweep = { at: now, found: orphans.length, stopped: stopped.length, names: namesText(stopped) };
    if (stopped.length) this.log(`procs: sweep stopped ${stopped.length} orphaned Git-Bash process(es): ${namesText(stopped)}`);
    return stopped;
  }

  /** Part 2: its claude exited; stop the Git-Bash helpers that were under it (matched again first). */
  async agentExited(agentId) {
    const under = this.under.get(agentId);
    this.under.delete(agentId);
    if (!under?.size) return [];
    const helpers = [...under.values()].filter((p) => GIT_HELPER.test(p.path) && (!this.match || this.match.test(p.cmd)));
    const stopped = await stopExact(helpers, { log: this.log });
    if (stopped.length) this.log(`procs: its claude exited; stopped ${stopped.length} Git-Bash process(es) left under it: ${namesText(stopped)}`);
    return stopped;
  }

  /** What runs under each agent's claude now, as last sampled (a minute old at most): { agentId: [text] }. */
  helpersView() {
    const out = {};
    for (const [agentId, under] of this.under) {
      const list = [...under.values()];
      const roots = list.filter((p) => !list.some((q) => q.pid === p.ppid));
      const work = roots.flatMap((r) => [r, ...descendantsOf(list, r.pid)]).filter((p) => !GIT_HELPER.test(p.path) && !WRAPPERS.test(p.name) && !TOOL_SERVERS.test(p.cmd));
      if (work.length) out[agentId] = [...new Set(work.map(helperText))];
    }
    return out;
  }

  view() {
    return {
      watching: Boolean(this.ps),
      lastSample: this.lastSample,
      lastSweep: this.lastSweep,
      runaways: [...this.runaways.values()].map(({ agent, pid, name, cmd, cores, since }) => ({ agent, pid, name, cmd, cores, since })),
    };
  }
}
