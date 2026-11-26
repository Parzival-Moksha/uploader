// Test installs and the disk (on 24 Nov leftover Oasis test installs had eaten about 115 GB).
//
//   - Every test install lives in one scratch root, C:/oasis-scratch/<agent>/<name> (OASIS_SCRATCH_ROOT), and each test
//     deletes its own folder when it ends. What is left behind is swept here: a folder at exactly that depth whose
//     newest file is older than SCRATCH_MAX_AGE_MS and that no process names (its program or its command line) is
//     removed with fs.rmSync (a junction or link inside is unlinked, never followed: its target survives), and then
//     `pnpm store prune` gives back what no install uses any more. The engine does it, not an agent: the agent harness
//     keeps agents from deleting outside their own folder. Nothing outside the scratch root is ever touched.
//   - The disk: /health says it when C: (the scratch root's drive) has under DISK_LOW_GB free; the owner gets one
//     Telegram line under DISK_ALERT_GB (said again only after it was back above DISK_REARM_GB).
// Pure parts unit-tested (src/lib/__tests__/agent-engine-scratch.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SCRATCH_ROOT = process.env.OASIS_SCRATCH_ROOT || 'C:/oasis-scratch';
export const SCRATCH_MAX_AGE_MS = Number(process.env.OASIS_SCRATCH_MAX_AGE_MS || 24 * 3_600_000);
export const DISK_LOW_GB = 30;
export const DISK_ALERT_GB = 15;
export const DISK_REARM_GB = 20;

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The file that says a folder is the scratch root (written by the helper that makes C:/oasis-scratch/<agent>/). */
export const ROOT_MARKER = '.oasis-scratch-root';

/**
 * Why this root must not be swept, or null when it is the scratch root (Merge Goat and the Hacker, 24 Nov: a wrong
 * OASIS_SCRATCH_ROOT, C:/ or a home folder, would make every day-old folder two levels down sweepable). It must be
 * named oasis-scratch, hold the marker file, and be neither a drive root nor under C:/Users/<user> or Program Files.
 * guardHome: false only for tests, whose temporary folders live under the user's folder.
 */
export function rootProblem(root, { guardHome = true } = {}) {
  let r;
  try { r = fs.realpathSync(path.resolve(root)); } catch { return 'the folder does not exist'; }
  if (path.basename(r).toLowerCase() !== 'oasis-scratch') return 'not named oasis-scratch';
  if (path.parse(r).root.toLowerCase() === r.toLowerCase() || path.dirname(r) === r) return 'a drive root';
  const n = r.replace(/\\/g, '/').toLowerCase();
  if (/^[a-z]:\/program files[^/]*(\/|$)/.test(n)) return 'under Program Files';
  if (guardHome && /^[a-z]:\/users\/[^/]+(\/|$)/.test(n)) return "under a user's own folder";
  if (!fs.existsSync(path.join(r, ROOT_MARKER))) return `no ${ROOT_MARKER} marker in it`;
  return null;
}

export const DEFAULT_SCRATCH_ROOT = 'C:/oasis-scratch';

/**
 * The engine marks the built-in scratch root once, at start (making it if it is missing), so the sweep can run. Only
 * that one: a root set by OASIS_SCRATCH_ROOT is never marked here (a wrong setting must not mark itself and pass the
 * guard); mark it by hand. Windows only. -> true when the marker is there afterwards.
 */
export function ensureDefaultMarker(root = SCRATCH_ROOT, env = process.env) {
  if (process.platform !== 'win32' || env.OASIS_SCRATCH_ROOT || root !== DEFAULT_SCRATCH_ROOT) return false;
  try {
    fs.mkdirSync(root, { recursive: true });
    const marker = path.join(root, ROOT_MARKER);
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'The Oasis scratch root: test installs live in <agent>/<name> below and are swept by the engine after a day without a process (scratch.js).\n');
    return true;
  } catch {
    return false;
  }
}

/** The newest modification time in a folder, looking two levels down (enough to see a test still writing). */
export function newestMtime(dir, depth = 2) {
  let newest = 0;
  const walk = (d, level) => {
    let st;
    try { st = fs.lstatSync(d); } catch { return; }
    newest = Math.max(newest, st.mtimeMs);
    if (!st.isDirectory() || st.isSymbolicLink() || level >= depth) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice(0, 2000)) walk(path.join(d, e.name), level + 1);
  };
  walk(dir, 0);
  return newest;
}

/** Folders at <root>/<agent>/<name>, never following a link: [{ dir, agent, name }]. */
export function scratchFolders(root = SCRATCH_ROOT) {
  const out = [];
  let agents = [];
  try { agents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const a of agents) {
    if (!a.isDirectory() || a.isSymbolicLink()) continue;
    let names = [];
    try { names = fs.readdirSync(path.join(root, a.name), { withFileTypes: true }); } catch { continue; }
    for (const n of names) if (n.isDirectory() && !n.isSymbolicLink()) out.push({ dir: path.join(root, a.name, n.name), agent: a.name, name: n.name });
  }
  return out;
}

/**
 * Which folders may go: older than maxAgeMs (by their newest file) and named by no process.
 * procs: [{ path, cmd }] of the processes that mention the scratch root at all.
 */
export function sweepable(folders, procs, { now = Date.now(), maxAgeMs = SCRATCH_MAX_AGE_MS, mtime = newestMtime } = {}) {
  return folders.filter((f) => {
    const key = norm(f.dir);
    if (procs.some((p) => norm(p.path).startsWith(`${key}/`) || norm(p.cmd).includes(key))) return false;
    return now - mtime(f.dir) >= maxAgeMs;
  });
}

/** The processes whose program or command line mentions the scratch root (Windows; elsewhere none can be known: []). */
export function processesInScratch(root = SCRATCH_ROOT) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const leaf = path.basename(norm(root)).replace(/'/g, "''");
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${leaf}*' -or $_.ExecutablePath -like '*${leaf}*' } | Select-Object @{n='path';e={$_.ExecutablePath}},@{n='cmd';e={$_.CommandLine}} | ConvertTo-Json -Compress`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } }, 30_000);
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      try { const j = out.trim() ? JSON.parse(out) : []; resolve((Array.isArray(j) ? j : [j]).map((p) => ({ path: p.path || '', cmd: p.cmd || '' }))); } catch { resolve(null); }
    });
    ps.on('error', () => resolve(null));
  });
}

/** Free space where `dir` lives, in GB, or null. */
export function freeGb(dir = SCRATCH_ROOT) {
  let probe = dir;
  while (probe && !fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try { const s = fs.statfsSync(probe); return (s.bavail * s.bsize) / 1024 ** 3; } catch { return null; }
}

/** The disk as /health says it: { freeGb, low, line }. */
export function diskView(gb) {
  if (gb === null || gb === undefined) return { freeGb: null, low: false, line: null };
  const g = Math.round(gb);
  return { freeGb: g, low: gb < DISK_LOW_GB, line: gb < DISK_LOW_GB ? `C: has only ${g} GB free (under ${DISK_LOW_GB} GB): old test installs and caches are the first to look at` : null };
}

export class ScratchKeeper {
  /** @param {{ log?: Function, say?: (line: string) => void, root?: string, prune?: () => Promise<void> }} o */
  constructor(o = {}) {
    this.log = o.log || (() => {});
    this.say = o.say || (() => {});
    this.root = o.root || SCRATCH_ROOT;
    this.prune = o.prune || (() => runPnpmPrune(this.log));
    this.guardHome = o.guardHome !== false;
    /** Why the sweep is off (the root is not recognised), or null: known from the start, for /health. */
    this.off = rootProblem(this.root, { guardHome: this.guardHome });
    this.lastSweep = null;
    this.disk = diskView(null);
    this.alerted = false;
  }

  /** Remove what is left behind. -> the removed folders. */
  async sweep(now = Date.now()) {
    // Before anything: is this the scratch root at all? If not, nothing is removed and /health says why.
    const problem = rootProblem(this.root, { guardHome: this.guardHome });
    if (problem) {
      if (this.off !== problem) this.log(`scratch: sweep off: root not recognised (${this.root}: ${problem})`);
      this.off = problem;
      this.lastSweep = { at: now, removed: [], note: `sweep off: root not recognised (${problem})` };
      return [];
    }
    this.off = null;
    const folders = scratchFolders(this.root);
    if (!folders.length) { this.lastSweep = { at: now, removed: [] }; return []; }
    const procs = await processesInScratch(this.root);
    // Not knowing which processes run is not "none": nothing goes then.
    if (procs === null) { this.lastSweep = { at: now, removed: [], note: 'process list not available: nothing removed' }; return []; }
    const gone = [];
    for (const f of sweepable(folders, procs, { now })) {
      try {
        fs.rmSync(f.dir, { recursive: true, force: true, maxRetries: 2 });
        gone.push(`${f.agent}/${f.name}`);
      } catch (e) { this.log(`scratch: could not remove ${f.dir} (${e.message})`); }
    }
    if (gone.length) {
      this.log(`scratch: removed ${gone.length} test install(s) left behind for over a day: ${gone.join(', ')}`);
      await this.prune().catch((e) => this.log(`scratch: pnpm store prune failed (${e.message})`));
    }
    this.lastSweep = { at: now, removed: gone };
    return gone;
  }

  /** Free space, and one Telegram line when it gets low. */
  checkDisk() {
    const gb = freeGb(this.root);
    this.disk = diskView(gb);
    if (gb === null) return this.disk;
    if (gb < DISK_ALERT_GB && !this.alerted) {
      this.alerted = true;
      const line = `💾 C: has only ${Math.round(gb)} GB free. Old test installs (C:/oasis-*), downloads and caches are the first to look at; the Hacker can list what is big.`;
      this.log(`disk: ${line}`);
      try { this.say(line); } catch { /* no Telegram: /health says it */ }
    } else if (gb > DISK_REARM_GB) this.alerted = false;
    return this.disk;
  }

  view() {
    return { root: this.root, ...(this.off ? { line: `scratch sweep off: root not recognised (${this.off})` } : {}), lastSweep: this.lastSweep, disk: this.disk };
  }
}

/** `pnpm store prune` in the Oasis folder: what no install uses any more goes from pnpm's shared store. */
export function runPnpmPrune(log = () => {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('pnpm', ['store', 'prune'], { cwd: process.cwd(), shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } reject(new Error('took over 10 minutes')); }, 10 * 60_000);
    p.on('close', (code) => { clearTimeout(timer); log(`scratch: pnpm store prune ${code === 0 ? 'done' : `exited ${code}`}${out.trim() ? `: ${out.trim().split('\n').pop().slice(0, 160)}` : ''}`); resolve(); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
