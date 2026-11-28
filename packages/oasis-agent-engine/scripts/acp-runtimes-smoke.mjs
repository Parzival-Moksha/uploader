// Other vendors' ACP agents as villagers (src/hermes.js ACP_RUNTIMES: grok, gemini), against scripts/fake-acp.mjs
// standing in for them: no model, no login, no window. Its own engine on port 4545 (OASIS_PORT); never 4530.
//
//   node packages/oasis-agent-engine/scripts/acp-runtimes-smoke.mjs
//
// "Grok" here is the fake with --needs-auth (it refuses sessions until `authenticate`, as grok agent stdio does) and
// --kinds-only (permission options and modes named its own way: only the ACP kinds are standard).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const FAKE = path.join(HERE, 'fake-acp.mjs');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-acp-runtimes-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const DESK = path.join(tmp, 'desk');
const GROK = path.join(tmp, 'grok');
const GEMINI = path.join(tmp, 'gemini');
const CODEX = path.join(tmp, 'codex');
for (const d of [DESK, GROK, GEMINI, CODEX]) fs.mkdirSync(d, { recursive: true });

// A fake Oasis MCP route: three tools, one free (get_world_info), two that need the owner's yes.
const oasisCalls = [];
const oasis = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    const m = JSON.parse(b);
    oasisCalls.push(m.method === 'tools/call' ? `call ${m.params?.name}` : m.method);
    if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'o-' + oasisCalls.length }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-oasis', version: '0' } } })); return; }
    if (m.id == null) { res.writeHead(202).end(); return; }
    if (m.method === 'tools/list') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: ['get_world_info', 'clear_world', 'generate_image'].map((name) => ({ name, inputSchema: { type: 'object' } })) } })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `done: ${m.params?.name}` }] } }));
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => oasis.on('listening', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

let engine = null;
const logs = [];
async function startEngine() {
  if (await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken by another engine`);
  engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
    cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: {
      ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_TELEGRAM: '0', OASIS_LOOKS: '0', OASIS_CLIP_WATCHDOG: '0', OASIS_SCHEDULE_START_MS: '3600000',
      OASIS_GROK_BIN: JSON.stringify([process.execPath, FAKE, GROK, '--needs-auth', '--kinds-only']),
      OASIS_GEMINI_BIN: JSON.stringify([process.execPath, FAKE, GEMINI]),
      OASIS_CODEX_BIN: JSON.stringify([process.execPath, FAKE, CODEX, '--mcp-http']),
      OASIS_WEB_URL: `http://127.0.0.1:${oasis.address().port}`, OASIS_ASK_TOOL_MS: '8000',
    },
  });
  for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));
  for (let i = 0; i < 100; i++) { if (await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false)) return; await sleep(100); }
  throw new Error('the test engine did not come up');
}
async function stopEngine() {
  await fetch(`http://127.0.0.1:${PORT}/api/cmd`, { method: 'POST', body: JSON.stringify({ cmd: 'shutdown' }) }).catch(() => {});
  if (engine.exitCode === null) await new Promise((r) => engine.once('exit', r));
  await sleep(800);
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0;
  await new Promise((res, rej) => { ws.on('error', rej); ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'hello') { for (const l of Object.values(m.backlog || {})) events.push(...l); res(); } if (m.type === 'reply') replies.get(m.id)?.(m); if (m.type === 'event') events.push(m.event); }); });
  const cmd = async (name, a = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...a })); }); return r.ok ? r.data : Promise.reject(new Error(r.error)); };
  const until = async (from, pred, ms, what) => { const end = Date.now() + ms; for (;;) { const e = events.slice(from).find(pred); if (e) return e; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(50); } };
  return { ws, events, cmd, until, mark: () => events.length };
}

try {
  await startEngine();
  let c = await connect();
  const of = (id, kind) => (e) => e.agentId === id && e.kind === kind && !e.history;
  const said = (from, id) => c.events.slice(from).filter(of(id, 'text')).map((e) => e.text).join('');

  // ---------------------------------------------------------------- Grok (fake): sign-in, its own names
  const g = await c.cmd('spawnAgent', { name: 'Grok', cwd: DESK, runtime: 'grok' });
  check('spawned with runtime grok', g.runtime === 'grok');
  const init = await c.until(0, of(g.id, 'init'), 15000, 'grok init');
  check('it asked to sign in, and the engine used the login offered (authenticate fake.login)', lines(path.join(GROK, 'auth.jsonl')).some((a) => a.methodId === 'fake.login') && c.events.some((e) => e.agentId === g.id && e.kind === 'notice' && e.subtype === 'auth'));
  check('init says grok', init.runtime === 'grok' && !!init.sessionId);
  check('it gets the world tools (stdio gate)', lines(path.join(GROK, 'opened.jsonl'))[0]?.mcpServers?.[0]?.name === 'oasis');
  let m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'hello grok' });
  await c.until(m, of(g.id, 'turn.end'), 15000, 'grok reply');
  check('it answers', /echo: hello grok/.test(said(m, g.id)), said(m, g.id));
  m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'TOOL please' });
  await c.until(m, of(g.id, 'turn.end'), 15000, 'grok tool turn');
  check('its tool call shows as a card', c.events.slice(m).some((e) => e.agentId === g.id && e.kind === 'tool.start') && c.events.slice(m).some((e) => e.agentId === g.id && e.kind === 'tool.end'));
  m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'PERMIT please' });
  const card = await c.until(m, of(g.id, 'permission.request'), 10000, 'grok permission card');
  check('a risky command asks in the Oasis card', card.input?.command === 'rm -rf x');
  await c.cmd('respond', { agentId: g.id, requestId: card.requestId, behavior: 'allow', always: true });
  await c.until(m, of(g.id, 'turn.end'), 10000, 'grok permission turn');
  check('"allow always" reaches it as its own allow_always option', /permission: proceed-always/.test(said(m, g.id)), said(m, g.id));
  m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'PERMIT again' });
  const card2 = await c.until(m, of(g.id, 'permission.request'), 10000, 'second card');
  await c.cmd('respond', { agentId: g.id, requestId: card2.requestId, behavior: 'deny' });
  await c.until(m, of(g.id, 'turn.end'), 10000, 'denied turn');
  check('"deny" reaches it as its own reject option', /permission: cancel/.test(said(m, g.id)), said(m, g.id));
  m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'PERMIT unanswered' });
  const card3 = await c.until(m, of(g.id, 'permission.request'), 10000, 'third card');
  await new Promise((r) => setTimeout(r, 1500));
  check('an agent other than Hermes keeps its card until answered (no 60 s drop)', card3.expiresAt == null && !c.events.slice(m).some((e) => e.agentId === g.id && e.kind === 'permission.resolved'));
  await c.cmd('interrupt', { agentId: g.id });
  const gone = await c.until(m, (e) => e.agentId === g.id && e.kind === 'permission.resolved', 10000, 'card answered by the interrupt');
  await c.until(m, of(g.id, 'turn.end'), 10000, 'interrupted turn');
  check('an interrupt answers the open card "cancelled" (the ACP rule) and the turn ends', gone.behavior === 'cancelled');
  const rt = await c.cmd('runtimes', {});
  check('the circle can ask which agents are here', rt && 'claude' in rt && rt.codex?.modes?.length === 4 && typeof rt.codex.ready === 'boolean' && 'hermes' in rt && 'grok' in rt, JSON.stringify(rt?.codex || rt).slice(0, 200));
  const okMode = await c.cmd('setPermissionMode', { agentId: g.id, mode: 'auto-edit' }).then(() => true, () => false);
  const badMode = await c.cmd('setPermissionMode', { agentId: g.id, mode: 'acceptEdits' }).then((r) => r?.ok !== false, (e) => e.message);
  check('its own modes work; a Hermes/Claude name it does not have is refused with its list', okMode && typeof badMode === 'string' && /ask, auto-edit, yolo/.test(badMode), String(badMode));

  // ---------------------------------------------------------------- Gemini (fake): no sign-in step
  const gm = await c.cmd('spawnAgent', { name: 'Gemini', cwd: DESK, runtime: 'gemini' });
  await c.until(0, of(gm.id, 'init'), 15000, 'gemini init');
  m = c.mark();
  await c.cmd('send', { agentId: gm.id, text: 'hello gemini' });
  await c.until(m, of(gm.id, 'turn.end'), 15000, 'gemini reply');
  check('a Gemini villager answers', /echo: hello gemini/.test(said(m, gm.id)) && (await c.cmd('listAgents')).find((a) => a.id === gm.id)?.runtime === 'gemini');

  // ---------------------------------------------------------------- Codex (fake, MCP over HTTP): every tool, asking
  const cx = await c.cmd('spawnAgent', { name: 'Codex', cwd: DESK, runtime: 'codex' });
  await c.until(0, of(cx.id, 'init'), 15000, 'codex init');
  const given = lines(path.join(CODEX, 'opened.jsonl'))[0]?.mcpServers?.[0];
  check('an agent that takes MCP over HTTP gets the engine gate', given?.type === 'http' && /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{48}$/.test(given?.url || ''), given?.url);
  m = c.mark();
  await c.cmd('send', { agentId: cx.id, text: 'WORLD please' });
  const ask1 = await c.until(m, of(cx.id, 'permission.request'), 15000, 'the card for clear_world');
  check('a tool that changes worlds asks first, in the Oasis card', ask1.toolName === 'mcp__oasis__clear_world' && !oasisCalls.includes('call clear_world') && ask1.suggestions?.length === 1, ask1.toolName);
  await c.cmd('respond', { agentId: cx.id, requestId: ask1.requestId, behavior: 'allow' });
  await c.until(m, of(cx.id, 'turn.end'), 15000, 'codex world turn');
  const w1 = said(m, cx.id);
  check('it sees every tool; allowed, the call reaches the Oasis', /world tools: get_world_info,clear_world,generate_image;/.test(w1) && /clear_world refused: false/.test(w1) && oasisCalls.includes('call clear_world'), w1);
  check('the free tool ran without a card', oasisCalls.includes('call get_world_info'));
  const before = oasisCalls.filter((x) => x === 'call clear_world').length;
  m = c.mark();
  await c.cmd('send', { agentId: cx.id, text: 'WORLD again' });
  const ask2 = await c.until(m, of(cx.id, 'permission.request'), 15000, 'second card');
  await c.cmd('respond', { agentId: cx.id, requestId: ask2.requestId, behavior: 'deny' });
  await c.until(m, of(cx.id, 'turn.end'), 15000, 'denied world turn');
  check('denied, it never reaches the Oasis and the agent is told', /clear_world refused: true/.test(said(m, cx.id)) && oasisCalls.filter((x) => x === 'call clear_world').length === before);
  m = c.mark();
  await c.cmd('send', { agentId: cx.id, text: 'WORLD once more' });
  const ask3 = await c.until(m, of(cx.id, 'permission.request'), 15000, 'third card');
  await c.cmd('respond', { agentId: cx.id, requestId: ask3.requestId, behavior: 'allow', always: true });
  await c.until(m, of(cx.id, 'turn.end'), 15000, 'always turn');
  m = c.mark();
  await c.cmd('send', { agentId: cx.id, text: 'WORLD after always' });
  await c.until(m, of(cx.id, 'turn.end'), 15000, 'turn after always');
  check('"allow always" lets that tool through without another card', !c.events.slice(m).some(of(cx.id, 'permission.request')) && /clear_world refused: false/.test(said(m, cx.id)));
  m = c.mark();
  await c.cmd('send', { agentId: cx.id, text: 'WORLD unanswered' });
  // nobody answers: the card expires (OASIS_ASK_TOOL_MS 8 s here); "always" covered clear_world, so ask for another tool next time
  await c.until(m, of(cx.id, 'turn.end'), 20000, 'turn without an answer');
  check('a remembered tool needs no card on later turns either', !c.events.slice(m).some(of(cx.id, 'permission.request')));

  // ---------------------------------------------------------------- restart: both come back, same sessions
  c.ws.close();
  await stopEngine();
  const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8')).agents;
  check('the roster keeps the runtimes', roster.find((a) => a.id === g.id)?.runtime === 'grok' && roster.find((a) => a.id === gm.id)?.runtime === 'gemini');
  await startEngine();
  c = await connect();
  const init2 = await c.until(0, of(g.id, 'init'), 15000, 'grok init after restart');
  check('Grok resumes its session after a restart (signed in again, session/load)', init2.sessionId === init.sessionId && lines(path.join(GROK, 'opened.jsonl')).some((o) => o.how === 'load'));
  m = c.mark();
  await c.cmd('send', { agentId: g.id, text: 'back again' });
  await c.until(m, of(g.id, 'turn.end'), 15000, 'grok after restart');
  check('and answers', /echo: back again/.test(said(m, g.id)));
  for (const id of [g.id, gm.id, cx.id]) await c.cmd('kill', { agentId: id }).catch(() => {});
  c.ws.close();
} catch (e) {
  check('no exception', false, e.message);
} finally {
  if (engine && engine.exitCode === null) await stopEngine();
  oasis.close();
  if (failed) console.log(logs.join('').split('\n').filter((l) => /Grok|Gemini|error|Error/.test(l)).slice(-25).join('\n'));
  console.log(failed ? 'FAILED' : 'ALL PASSED', `(scratch: ${tmp})`);
  process.exit(failed ? 1 : 0);
}
