// Process watcher smoke [no real turns; Windows]: processes the agents leave behind (src/procs.js), on a test engine
// (port 4555 unless OASIS_PORT) with a fake `claude` that starts children on request, and short clocks. Only processes
// this smoke started can be stopped (OASIS_ORPHAN_MATCH = this run's own marker). Never on the real engine (4530).
//   1  sweep: a Git-Bash `sleep` whose bash is gone is stopped
//   2  an agent's claude exits: the `tail -f` started under it is stopped; a busy non-Git process under it is not
//   3  runaway: a process under an agent holding a core for the window shows in /health, is said once in the thread,
//      and reaches the agent with its next message
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

if (process.platform !== 'win32') { console.log('procs smoke: Windows only, skipped'); process.exit(0); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4555);
if (PORT === 4530) throw new Error('never on the real engine port');
const MARK = `oasis-procs-smoke-${process.pid}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${MARK}-`));
const STATE = path.join(tmp, 'fake-state.json');
const FAKE_LOG = path.join(tmp, 'fake-claude.jsonl');
const WATCHED = path.join(tmp, `${MARK}.log`);
const RUNAWAY_MS = 12_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const fakeLog = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Processes whose command line has this run's marker: [{ pid, name, cmd }]. */
function ours() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${MARK}*' -or $_.CommandLine -like '*sleep.exe* 7${process.pid % 100}' -or $_.CommandLine -like '*Date.now() + 91 *' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
  try { const j = JSON.parse(r.stdout || '[]'); return (Array.isArray(j) ? j : [j]).filter(Boolean).map((p) => ({ pid: p.ProcessId, name: p.Name, cmd: p.CommandLine || '' })); } catch { return []; }
}
const alive = (name, re) => ours().some((p) => p.name === name && re.test(p.cmd));

fs.writeFileSync(STATE, '{}');
fs.writeFileSync(WATCHED, 'start\n');
fs.writeFileSync(path.join(tmp, 'accounts.json'), JSON.stringify({ accounts: [] }));
const logs = [];
const SLEEP_ARG = `7${process.pid % 100}`;
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.local.json'), OASIS_CHARACTERS: path.join(tmp, 'characters'),
    OASIS_ACCOUNTS: path.join(tmp, 'accounts.json'), OASIS_ACCOUNTS_STATE: path.join(tmp, 'accounts-state.json'), OASIS_TELEGRAM: '0', OASIS_LOOKS: '0',
    OASIS_PROC_EVERY_MS: '2000', OASIS_SWEEP_EVERY_MS: '4000', OASIS_ORPHAN_MIN_AGE_MS: '0', OASIS_RUNAWAY_WINDOW_MS: String(RUNAWAY_MS),
    OASIS_ORPHAN_MATCH: `${MARK}|sleep\.exe" ${SLEEP_ARG}$`,
    OASIS_CLAUDE_BIN: path.join(HERE, 'fake-claude.js'), FAKE_CLAUDE_STATE: STATE, FAKE_CLAUDE_LOG: FAKE_LOG,
  },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));

async function connect() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not yet */ } await sleep(100); }
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0;
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (data) => { const m = JSON.parse(String(data)); if (m.type === 'hello') res(); if (m.type === 'reply') replies.get(m.id)?.(m); if (m.type === 'event') events.push(m.event); });
  });
  const cmd = async (name, args = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); }); if (!r.ok) throw new Error(r.error); return r.data && typeof r.data === 'object' && 'data' in r.data ? r.data.data : r.data; };
  const next = async (pred, ms = 30000) => { const until = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > until) return null; await sleep(100); } };
  return { ws, events, cmd, next };
}
const waitUntil = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(500); } return false; };

let busyPid = null;
try {
  const c = await connect();
  const health = async () => (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).procs;
  check('the watcher runs', Boolean((await waitUntil(async () => (await health())?.lastSample, 15000)) && (await health()).watching));

  // ---- 1  an orphan: a Git-Bash sleep whose bash is gone
  spawnSync('C:/Program Files/Git/usr/bin/bash.exe', ['-c', `(/usr/bin/sleep ${SLEEP_ARG} &) ; exit 0`], { windowsHide: true });
  // The sweep runs every 4 s here, so it may already have taken it: seen alive, or named by the sweep.
  check('an orphaned sleep exists', await waitUntil(async () => alive('sleep.exe', new RegExp(`sleep\.exe" ${SLEEP_ARG}$`)) || /sweep stopped \d+ orphaned Git-Bash process\(es\): .*sleep\.exe/.test(logs.join('')), 8000));
  check('the sweep stops it', await waitUntil(async () => !alive('sleep.exe', new RegExp(`sleep\.exe" ${SLEEP_ARG}$`)) && /sleep\.exe/.test(logs.join('')), 20000), (await health())?.lastSweep ? JSON.stringify((await health()).lastSweep) : '');

  // ---- 2  under an agent: a tail -f and a busy process; then its claude exits
  const ag = await c.cmd('spawnAgent', { name: 'procs-a', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false });
  await sleep(800);
  const send = async (text) => { const from = c.events.length; await c.cmd('send', { agentId: ag.id, text }); return c.next((e) => c.events.indexOf(e) >= from && e.agentId === ag.id && e.kind === 'turn.end'); };
  await send(`spawn-tail ${WATCHED}`);
  await send('spawn-busy 91');
  await sleep(1000);
  const busy = ours().find((p) => p.name === 'node.exe' && /Date\.now\(\) \+ 91 /.test(p.cmd));
  busyPid = busy?.pid || null;
  check('a tail -f and a busy process run under the agent', alive('tail.exe', new RegExp(MARK)) && Boolean(busy));

  // ---- 3  the busy one holds a core for the window
  const told = await c.next((e) => e.agentId === ag.id && e.kind === 'notice' && e.subtype === 'process', RUNAWAY_MS + 15000);
  check('a runaway is said in its thread, once', Boolean(told) && /held \d+% of a core/.test(told.text || ''), told?.text || '');
  const h3 = await health();
  check('/health lists it', h3.runaways.some((r) => r.agent === 'procs-a' && r.pid === busyPid), JSON.stringify(h3.runaways));
  await send('next message');
  const last = fakeLog().filter((l) => l.turn).at(-1);
  check('the agent hears it with its next message', (last?.notes || []).some((n) => /Oasis process: your node\.exe/.test(n)), JSON.stringify(last?.notes));
  await sleep(4000);
  check('said only once', c.events.filter((e) => e.agentId === ag.id && e.kind === 'notice' && e.subtype === 'process').length === 1);

  // ---- 2 (end)  its claude exits
  await c.cmd('kill', { agentId: ag.id });
  check('its claude exited: the tail -f under it is stopped', await waitUntil(async () => !alive('tail.exe', new RegExp(MARK)), 20000));
  check('the busy non-Git process is left alone', ours().some((p) => p.pid === busyPid));

  await c.cmd('shutdown').catch(() => {});
  c.ws.close();
} catch (e) {
  console.error('ERROR', e);
  failed = true;
} finally {
  await sleep(800);
  try { engine.kill(); } catch { /* gone */ }
  for (const p of ours()) { try { process.kill(p.pid); } catch { /* gone */ } }
  if (busyPid) { try { process.kill(busyPid); } catch { /* gone */ } }
  if (failed) console.log(logs.join('').split('\n').filter((l) => /procs|runaway|sweep/i.test(l)).slice(-20).join('\n'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* busy */ }
  console.log(failed ? 'procs smoke: FAILED' : 'procs smoke: all passed');
  process.exit(failed ? 1 : 0);
}
