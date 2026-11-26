// Network smoke [no real turns]: the internet line (src/network.js), on a test engine (port 4554 unless OASIS_PORT)
// that runs a fake `claude` (scripts/fake-claude.js) which ends turns like a dead line ("Can't reach the API server
// (ENOTFOUND)", api_error connection_failed), and a check file standing in for the engine's own check of the line.
// Never on the real engine (4530).
//   1  the line dies: running turns end on it, the village is offline since the first, /network and /health say so
//   2  while offline: a message waits (no turn into the dead line); scheduled wake-ups are held, not sent one by one
//   3  the line is back: each agent whose turn died is told to carry on, a few at a time; the held message goes out;
//      the held wake-up goes out once; the log says offline from when to when and who was carried on
//   4  a blip: a turn dies on the network while the check says the line works: carried on, at most 3 times
//   5  an idle village: GET /network?fresh=1 checks the line now (Tyler's launcher asks this way)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4554);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-network-smoke-'));
const STATE = path.join(tmp, 'fake-state.json');
const FAKE_LOG = path.join(tmp, 'fake-claude.jsonl');
const LINE = path.join(tmp, 'line.txt');
const GAP_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const fake = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const line = (up) => fs.writeFileSync(LINE, up ? 'up' : 'down');
const fakeLog = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const RESUME = /^Your last turn was cut off: this PC lost its internet connection/;

fs.writeFileSync(path.join(tmp, 'accounts.json'), JSON.stringify({ accounts: [] }));
// No quiet hours for the test engine: its clock is moved hours ahead, and run late at night that lands inside the
// default quiet hours (01:00 to 08:00), where a held wake-up rightly stays held (24 Nov, 23:30: "goes out once: 0").
fs.writeFileSync(path.join(tmp, 'roster.schedule.local.json'), JSON.stringify({ quiet: null, dailyCap: 200 }));
fake({});
line(true);
const logs = [];
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.local.json'), OASIS_CHARACTERS: path.join(tmp, 'characters'),
    OASIS_ACCOUNTS: path.join(tmp, 'accounts.json'), OASIS_ACCOUNTS_STATE: path.join(tmp, 'accounts-state.json'), OASIS_TELEGRAM: '0', OASIS_LOOKS: '0',
    OASIS_FAKE_CLOCK: '1', OASIS_SCHEDULE_START_MS: '0', OASIS_SCHEDULE_TICK_MS: '1000',
    OASIS_NETWORK_CHECK_FILE: LINE, OASIS_NETWORK_EVERY_MS: '1000', OASIS_NET_RESUME_GAP_MS: String(GAP_MS),
    OASIS_CLAUDE_BIN: path.join(HERE, 'fake-claude.js'), FAKE_CLAUDE_STATE: STATE, FAKE_CLAUDE_LOG: FAKE_LOG,
  },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));

async function connect() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not yet */ } await sleep(100); }
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0; const messages = [];
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      messages.push(m);
      if (m.type === 'hello') res();
      if (m.type === 'reply') replies.get(m.id)?.(m);
      if (m.type === 'event') events.push(m.event);
    });
  });
  const cmd = async (name, args = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); }); if (!r.ok) throw new Error(r.error); return r.data && typeof r.data === 'object' && 'data' in r.data ? r.data.data : r.data; };
  const next = async (pred, ms = 20000) => { const until = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > until) return null; await sleep(50); } };
  return { ws, events, messages, cmd, next };
}
const net = async () => (await fetch(`http://127.0.0.1:${PORT}/network`)).json();
const turnsOf = (session) => fakeLog().filter((l) => l.turn && l.session === session);

try {
  const c = await connect();
  const names = ['net-a', 'net-b', 'net-c', 'net-d', 'net-e'];
  const ag = [];
  for (const name of names) ag.push(await c.cmd('spawnAgent', { name, cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false }));
  await sleep(800);
  const send = async (id, text) => { const from = c.events.length; await c.cmd('send', { agentId: id, text }); return c.next((e) => c.events.indexOf(e) >= from && e.agentId === id && e.kind === 'turn.end'); };
  for (const a of ag) await send(a.id, 'hello');
  const snaps = Object.fromEntries((await c.cmd('listAgents')).map((a) => [a.id, a]));
  const sess = Object.fromEntries(ag.map((a) => [a.id, snaps[a.id].sessionId]));
  check('online at the start', (await net()).online === true);

  // ---- 1  the line dies under four running agents
  await c.cmd('setSchedule', { agentId: ag[0].id, every: 'hourly', prompt: 'Scheduled check.' });
  fake({ netDown: true });
  line(false);
  const died = await Promise.all(ag.slice(0, 4).map((a) => send(a.id, `work of ${a.name}`)));
  check('the running turns end on the dead line', died.every((e) => /Can't reach the API server/.test(e?.result || '')), died.map((e) => (e?.result || '').slice(0, 30)).join(' | '));
  await sleep(800);
  const n1 = await net();
  check('/network: offline, since the first death', n1.online === false && typeof n1.offlineSince === 'number', JSON.stringify(n1));
  const h1 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  check('/health says it too', h1.network?.online === false);
  const s1 = Object.fromEntries((await c.cmd('listAgents')).map((a) => [a.id, a]));
  check('each of the four waits, offline since then', ag.slice(0, 4).every((a) => s1[a.id].offline?.since === n1.offlineSince), ag.map((a) => JSON.stringify(s1[a.id].offline)).join(' '));
  const told = c.events.filter((e) => e.kind === 'notice' && e.subtype === 'network');
  check('each is told once, with the time', told.length === 4 && /no internet since \d\d:\d\d/.test(told[0].text || ''), `${told.length}`);
  check('the page hears the line went down', c.messages.some((m) => m.type === 'network' && m.online === false));

  // ---- 2  while offline
  const eTurns = turnsOf(sess[ag[4].id]).length;
  const r2 = await c.cmd('send', { agentId: ag[4].id, text: 'a message while offline' });
  await sleep(1200);
  check('a message waits: no turn into the dead line', r2?.parked === true && turnsOf(sess[ag[4].id]).length === eTurns, JSON.stringify(r2));
  const wakesBefore = c.events.filter((e) => e.agentId === ag[0].id && e.kind === 'user.sent' && e.auto === 'schedule').length;
  for (let h = 0; h < 3; h++) { await c.cmd('clock', { advanceMs: 3600_000 + 60_000 }); await sleep(1300); }
  check('three hourly wake-ups are held, none sent into the line', c.events.filter((e) => e.agentId === ag[0].id && e.kind === 'user.sent' && e.auto === 'schedule').length === wakesBefore);

  // ---- 3  the line is back
  const from3 = c.events.length;
  const logFrom = fakeLog().length;
  fake({});
  line(true);
  const back = await c.next((e) => c.events.indexOf(e) >= from3 && e.kind === 'notice' && e.subtype === 'resumed', 15000);
  check('the line is noticed within the minute check', Boolean(back));
  await sleep(GAP_MS * 2 + 4000);
  const after = fakeLog().slice(logFrom).filter((l) => l.turn);
  const resumed = ag.slice(0, 4).map((a) => after.find((l) => l.session === sess[a.id] && RESUME.test(l.text || '')));
  check('each agent whose turn died is told to carry on, once', resumed.every(Boolean) && ag.slice(0, 4).every((a) => after.filter((l) => l.session === sess[a.id] && RESUME.test(l.text || '')).length === 1), after.map((l) => `${l.session.slice(0, 4)}:${(l.text || '').slice(0, 20)}`).join(' | '));
  const times = resumed.filter(Boolean).map((l) => l.at).sort((x, y) => x - y);
  check('a few at a time: the fourth after a pause', times.length === 4 && times[3] - times[2] >= GAP_MS - 200 && times[2] - times[0] < GAP_MS, times.map((t) => t - times[0]).join(','));
  check('the held message goes out', after.some((l) => l.session === sess[ag[4].id] && /a message while offline/.test(l.text || '')));
  const wakes = c.events.filter((e) => c.events.indexOf(e) >= from3 && e.agentId === ag[0].id && e.kind === 'user.sent' && e.auto === 'schedule');
  check('the held wake-up goes out once', wakes.length === 1, `${wakes.length}`);
  check('the owner\'s line: offline from when to when, who was carried on', logs.join('').match(/This PC was offline from \d\d:\d\d to \d\d:\d\d \([^)]*\)\. The line is back: carrying on net-[a-d]/) !== null, (logs.join('').match(/🌐[^\n]*/) || [''])[0]);
  const s3 = await c.cmd('listAgents');
  check('nobody waits any more', s3.every((a) => !a.offline) && (await net()).online === true);

  // ---- 4  a blip: the turn dies, the line checks fine
  fake({ netDown: true });
  const before4 = turnsOf(sess[ag[4].id]).length;
  await c.cmd('send', { agentId: ag[4].id, text: 'blip' });
  await sleep(6000);
  const e4 = turnsOf(sess[ag[4].id]).length - before4;
  const s4 = (await c.cmd('listAgents')).find((a) => a.id === ag[4].id);
  check('a blip is carried on, at most 3 times, then left in error', e4 === 4 && !s4.offline && s4.status === 'error' && (await net()).online === true, `${e4} turns, ${s4.status}`);

  // ---- 5  nobody working: asking with ?fresh=1 checks the line now
  fake({});
  line(false);
  const n5 = await (await fetch(`http://127.0.0.1:${PORT}/network?fresh=1`)).json();
  check('/network?fresh=1 sees the line down with nobody working', n5.online === false && typeof n5.offlineSince === 'number', JSON.stringify(n5));
  line(true);
  await sleep(2500);
  check('and back up by the minute check', (await net()).online === true);

  for (const a of ag) await c.cmd('kill', { agentId: a.id }).catch(() => {});
  await c.cmd('shutdown').catch(() => {});
  c.ws.close();
} catch (e) {
  console.error('ERROR', e);
  failed = true;
} finally {
  await sleep(800);
  try { engine.kill(); } catch { /* gone */ }
  if (failed) console.log(logs.join('').split('\n').filter((l) => /network|offline|carry|died/i.test(l)).slice(-25).join('\n'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* busy */ }
  console.log(failed ? 'network smoke: FAILED' : 'network smoke: all passed');
  process.exit(failed ? 1 : 0);
}
