#!/usr/bin/env node
// A second engine beside a live roster never stops processes it did not start (27 Nov 2026: a test engine on a copy
// of the data folder stopped every village agent, twice). A spare engine starts on a roster naming two live "claude"
// processes, each holding its session in a Claude folder of its own:
//   held:   started by this script, which stays alive (like the village's agents under the real engine) -> survives,
//           and the engine does not start its own process on that session;
//   orphan: its parent exited (a dead engine's left-over) -> stopped, as before.
// Usage: node scripts/orphan-smoke.mjs   (spare port 4593; fake claude; nothing of the real village is read or touched)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PORT = 4593;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-orphan-'));
const CLAUDE = path.join(tmp, 'claude');
fs.mkdirSync(path.join(CLAUDE, 'sessions'), { recursive: true });
const FAKE_LOG = path.join(tmp, 'fake.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

const IDLE = 'setInterval(() => {}, 1000)';
// held: our own child, we stay alive.
const held = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true });
// orphan: a parent that starts it detached and exits at once.
const starter = spawnSync(process.execPath, ['-e', `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(IDLE)}], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); console.log(c.pid);`], { encoding: 'utf8' });
const orphanPid = Number(starter.stdout.trim());
await sleep(500);

const SESSIONS = { held: '11111111-1111-4111-8111-111111111111', orphan: '22222222-2222-4222-8222-222222222222' };
for (const [pid, session] of [[held.pid, SESSIONS.held], [orphanPid, SESSIONS.orphan]]) {
  fs.writeFileSync(path.join(CLAUDE, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: session, status: 'idle', kind: 'interactive', cwd: tmp }));
}
fs.writeFileSync(path.join(tmp, 'roster.local.json'), JSON.stringify({ agents: [
  { id: 'agent-held0001', name: 'Held', cwd: tmp, sessionId: SESSIONS.held, pid: held.pid },
  { id: 'agent-orph0001', name: 'Orphan', cwd: tmp, sessionId: SESSIONS.orphan, pid: orphanPid },
] }));
fs.writeFileSync(path.join(tmp, 'accounts.json'), JSON.stringify({ accounts: [] }));
fs.writeFileSync(path.join(tmp, 'roster.schedule.local.json'), JSON.stringify({ quiet: null, dailyCap: 200 }));

const logs = [];
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.local.json'), OASIS_CHARACTERS: path.join(tmp, 'characters'),
    OASIS_ACCOUNTS: path.join(tmp, 'accounts.json'), OASIS_ACCOUNTS_STATE: path.join(tmp, 'accounts-state.json'), OASIS_TELEGRAM: '0', OASIS_LOOKS: '0',
    OASIS_PROC_WATCH: '0', OASIS_SCRATCH_SWEEP: '0', CLAUDE_CONFIG_DIR: CLAUDE, OASIS_VOICE_DIR: path.join(tmp, 'voice'),
    OASIS_CLAUDE_BIN: path.join(HERE, 'fake-claude.js'), FAKE_CLAUDE_STATE: path.join(tmp, 'fake-state.json'), FAKE_CLAUDE_LOG: FAKE_LOG,
  },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not yet */ } await sleep(100); }
  // The start-up clean-up waits up to 5 s for a left-over to go by itself, then decides.
  for (let i = 0; i < 40 && alive(orphanPid); i++) await sleep(500);
  await sleep(1500);
  const text = logs.join('');
  check('a process someone alive holds survives the second engine', alive(held.pid), `pid ${held.pid}`);
  check('the engine says why it left it', /\[Held\] pid \d+ holds session 11111111 and is not a left-over/.test(text));
  const fakeStarts = fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').split('\n').filter((l) => l.includes(SESSIONS.held)).length : 0;
  check('and starts no process of its own on that session', fakeStarts === 0, `fake claude lines for it: ${fakeStarts}`);
  check('a dead engine\'s left-over is still stopped', !alive(orphanPid), `pid ${orphanPid}`);
  check('with its reason', /\[Orphan\] the last run's process \(pid \d+\) still holds session 22222222 \(its parent/.test(text));
  if (failed) console.log(text.split('\n').filter((l) => /Held|Orphan/.test(l)).join('\n'));
} finally {
  engine.kill();
  try { held.kill(); } catch {}
  try { if (alive(orphanPid)) process.kill(orphanPid); } catch {}
  await sleep(500);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
