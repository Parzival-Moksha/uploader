// May this engine stop a process its roster names? Only one it can prove is a left-over of a dead engine.
//
// 27 Nov 2026: a test engine started on a copy of the data folder (Citizens' proof of the built copy, twice, 00:26
// and 02:07) read the copied roster, found the real agents' claude processes alive holding their sessions, took them
// for its own last run's left-overs and stopped all of them: every village agent ended in the same seconds. A
// left-over of a dead engine is an orphan: walking up from it through the wrappers that start claude (claude, node,
// cmd), the chain ends at a parent that no longer exists. Any live parent that is something else (another engine, a
// terminal, the supervisor, a test runner) means the process belongs to someone alive, and it is never touched.
import { execFileSync } from 'node:child_process';

const WRAPPERS = /^(claude|node|cmd|conhost|bash|sh|pwsh|powershell)(\.exe)?$/i;
const ENGINE = /oasis-agent-engine[\\/]src[\\/]index\.js|dev:engine/i;

/**
 * chain: the process and its ancestors, nearest first, each { pid, name, cmd, created } (created as ms or null);
 * the walk stops at the first missing parent (a null entry), or at the root. selfPid: this engine.
 * -> { orphan: boolean, why }
 */
export function orphanVerdict(chain, selfPid = process.pid) {
  if (!Array.isArray(chain) || !chain[0]) return { orphan: false, why: 'the process is gone or unreadable' };
  for (let i = 1; i < chain.length; i++) {
    const up = chain[i];
    const child = chain[i - 1];
    // A missing parent, or a pid reused by a process younger than its "child": the real parent is dead.
    if (!up || (up.created && child.created && up.created > child.created)) return { orphan: true, why: `its parent ${child.ppid ?? '?'} is gone` };
    if (up.pid === selfPid) return { orphan: false, why: 'it is this engine\'s own child' };
    if (ENGINE.test(up.cmd || '')) return { orphan: false, why: `another engine (pid ${up.pid}) runs it` };
    if (!WRAPPERS.test(up.name || '')) return { orphan: false, why: `${up.name} (pid ${up.pid}) runs it` };
    // A wrapper that is itself alive and not an engine: keep climbing to see who started it.
  }
  // Ran out of chain while every ancestor was a live wrapper: someone alive (a terminal, a test) holds it.
  const last = chain[chain.length - 1];
  return last === null ? { orphan: true, why: 'its parent is gone' } : { orphan: false, why: 'a live process holds it' };
}

/** The process and up to `depth` ancestors from the OS; a dead parent ends the chain with null. */
export function processChain(pid, depth = 6) {
  const chain = [];
  let cur = Number(pid);
  for (let i = 0; i <= depth && cur > 0; i++) {
    const p = readProcess(cur);
    if (!p) { chain.push(i === 0 ? undefined : null); break; }
    chain.push(p);
    if (!p.ppid || p.ppid === p.pid || (process.platform !== 'win32' && p.ppid === 1)) { if (process.platform !== 'win32' && p.ppid === 1) chain.push(null); break; }
    cur = p.ppid;
  }
  return chain[0] ? chain : [];
}

function readProcess(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { [pscustomobject]@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; name = $p.Name; cmd = $p.CommandLine; created = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
      if (!out) return null;
      const p = JSON.parse(out);
      return { pid: p.pid, ppid: p.ppid, name: p.name, cmd: p.cmd || '', created: Date.parse(p.created) || null };
    }
    const out = execFileSync('ps', ['-o', 'pid=,ppid=,comm=,args=', '-p', String(Number(pid))], { encoding: 'utf8' }).trim();
    const m = out.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), name: m[3].split('/').pop(), cmd: m[4], created: null } : null;
  } catch { return null; }
}
