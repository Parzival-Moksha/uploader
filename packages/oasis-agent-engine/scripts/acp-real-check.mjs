// A real ACP agent (src/hermes.js ACP_RUNTIMES: codex, grok, gemini, hermes) as a villager, from its own engine on port
// 4545 (OASIS_PORT) with a throwaway roster; never the real engine on 4530. It runs on the person's own login.
//
//   node packages/oasis-agent-engine/scripts/acp-real-check.mjs <runtime> "<message>" ["<message>" ...] [--answer allow|deny] [--mode <its mode id>]
//
// Every permission card is answered "deny" unless --answer allow (so no paid or world-changing tool runs by accident).
// World tools go to the Oasis page at OASIS_WEB_URL (default 127.0.0.1:4516). Prints, per turn: the tools it called,
// the cards it raised and how they were answered, its reply, and the time.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const args = process.argv.slice(2);
const ai = args.indexOf('--answer');
const answer = ai >= 0 ? args.splice(ai, 2)[1] : 'deny';
const mi = args.indexOf('--mode');
const mode = mi >= 0 ? args.splice(mi, 2)[1] : undefined;
const [runtime, ...messages] = args;
if (!runtime || !messages.length) { console.log('usage: acp-real-check.mjs <runtime> "<message>" [...] [--answer allow|deny]'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-acp-check-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken`);
const logs = [];
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: { ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.local.json'), OASIS_TELEGRAM: '0', OASIS_LOOKS: '0', OASIS_CLIP_WATCHDOG: '0', OASIS_SCHEDULE_START_MS: '3600000' },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));
for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false)); i++) await sleep(100);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const events = []; const replies = new Map(); let n = 0;
await new Promise((res, rej) => { ws.on('error', rej); ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'hello') res(); if (m.type === 'reply') replies.get(m.id)?.(m); if (m.type === 'event') events.push(m.event); }); });
const cmd = async (name, a = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...a })); }); return r.ok ? r.data : Promise.reject(new Error(r.error)); };
let code = 0;
try {
  const desk = path.join(tmp, 'desk'); fs.mkdirSync(desk);
  const snap = await cmd('spawnAgent', { name: `${runtime} (check)`, cwd: desk, runtime, ...(mode ? { permissionMode: mode } : {}) });
  const t0 = Date.now();
  for (;;) { const e = events.find((x) => x.agentId === snap.id && (x.kind === 'init' || (x.kind === 'status' && x.status === 'error'))); if (e) { if (e.kind !== 'init') throw new Error(e.reason); console.log(`session ${e.sessionId} · ${e.runtime} ${e.agentVersion || ''} · model ${e.model} · world tools ${e.mcpServers.map((s) => s.name).join(',') || 'none'} · ${((Date.now() - t0) / 1000).toFixed(1)} s`); break; } if (Date.now() - t0 > 90000) throw new Error('no session in 90 s'); await sleep(100); }
  for (const text of messages) {
    const from = events.length;
    const t1 = Date.now();
    await cmd('send', { agentId: snap.id, text });
    let end = null;
    const answered = new Set();
    while (!end && Date.now() - t1 < 600000) {
      for (const e of events.slice(from)) {
        if (e.agentId !== snap.id) continue;
        if (e.kind === 'permission.request' && !answered.has(e.requestId)) { answered.add(e.requestId); console.log(`  card: ${e.toolName} -> ${answer}`); await cmd('respond', { agentId: snap.id, requestId: e.requestId, behavior: answer }).catch((err) => console.log('  respond failed', err.message)); }
        if (e.kind === 'turn.end') end = e;
      }
      await sleep(200);
    }
    const mine = events.slice(from).filter((e) => e.agentId === snap.id);
    const ends = mine.filter((e) => e.kind === 'tool.end');
    console.log(`> ${text}`);
    for (const t of mine.filter((e) => e.kind === 'tool.start')) { const r = ends.find((x) => x.toolUseId === t.toolUseId); console.log(`  tool ${t.name}${r ? (r.isError ? ' ERROR ' : ' ok ') + String(r.output || '').replace(/\s+/g, ' ').slice(0, 140) : ' (no result)'}`); }
    console.log(`  reply: ${mine.filter((e) => e.kind === 'text').map((e) => e.text).join(' ').replace(/\s+/g, ' ').slice(0, 500)}`);
    console.log(`  ${end ? `${end.outcome} ${end.reason}, ${Math.round((Date.now() - t1) / 1000)} s, in ${end.usage?.input ?? '?'} out ${end.usage?.output ?? '?'}` : 'no end within 10 minutes'}`);
    for (const l of logs.join('').split('\n').filter((x) => /\(check\)\] asks:/.test(x))) console.log('  engine: ' + l.trim().slice(0, 200));
    logs.length = 0;
    if (!end || end.outcome === 'error') code = 1;
  }
  await cmd('kill', { agentId: snap.id });
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  console.log(logs.join('').split('\n').filter((l) => /\(check\)/.test(l)).slice(-15).join('\n'));
  code = 1;
} finally {
  await fetch(`http://127.0.0.1:${PORT}/api/cmd`, { method: 'POST', body: JSON.stringify({ cmd: 'shutdown' }) }).catch(() => {});
  if (engine.exitCode === null) await new Promise((r) => engine.once('exit', r));
  process.exit(code);
}
