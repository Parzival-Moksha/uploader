// Which agents this machine can run, for the Summon circle (Summoner's contract, 28 Nov): Claude Code, Codex, Hermes,
// Grok, Gemini: found or not, the version, signed in or not (true / false / null when it cannot be told), and the one
// line to tell the person when something is missing. Read without opening any login file: a login is "there" when its
// file exists or the CLI itself says so (`codex login status`); no key or token is read or passed on.
//
//   runtimesView({ fresh })  the answer (cached 30 s; /health shows the last one without waiting)
//   setupRuntime('codex')    the Oasis's Codex adapter (@agentclientprotocol/codex-acp, Apache-2.0, bringing its own
//                            Codex), installed once into ~/.oasis/runtimes/codex-acp with npm. hermes.js runs it.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';
const HOME = os.homedir();
export const CODEX_ACP_VERSION = '2.12.1'; // the adapter tested with the Oasis (26-28 Nov); its Codex is ^0.172.0
export const CODEX_ACP_DIR = path.join(HOME, '.oasis', 'runtimes', 'codex-acp');
export const CODEX_ACP_MAIN = path.join(CODEX_ACP_DIR, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js');

/** The models an ACP agent offered at its last start, by runtime (hermes.js fills it): the circle's model list. */
export const seenModels = new Map();

/** A command on PATH (Windows: .exe, .cmd), or null. */
function onPath(name) {
  const exts = WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) { const p = path.join(d, name + e); try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  }
  return null;
}

/** A command's output (stdout, else stderr), or null when it fails or takes more than `ms`. */
function run(file, args, ms = 8000) {
  return new Promise((resolve) => {
    const shell = WIN && /\.(cmd|bat)$/i.test(file);
    execFile(file, args, { timeout: ms, windowsHide: true, shell, encoding: 'utf8' }, (err, out, errOut) => {
      if (err && err.code !== 0 && !out) return resolve(null);
      resolve(String(out || errOut || '').trim());
    });
  });
}
const firstVersion = (s) => (s && /(\d+\.\d+\.\d+)/.exec(s)?.[1]) || null;
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

async function claude() {
  const bin = process.env.OASIS_CLAUDE_BIN || onPath('claude');
  const out = bin ? await run(bin, ['--version']) : null;
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
  // On a Mac the login sits in the keychain: not readable from here without a prompt, so "can't tell".
  const loggedIn = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN ? true
    : exists(path.join(dir, '.credentials.json')) ? true : process.platform === 'darwin' ? null : false;
  return { found: Boolean(bin && out), version: firstVersion(out), loggedIn: bin && out ? loggedIn : false, install: 'npm install -g @anthropic-ai/claude-code', login: 'claude (then /login)' };
}

function adapterVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(CODEX_ACP_DIR, 'node_modules', '@agentclientprotocol', 'codex-acp', 'package.json'), 'utf8')).version || null; } catch { return null; }
}

async function codex() {
  const bin = onPath('codex');
  const out = bin ? await run(bin, ['--version']) : null;
  const adapter = { found: Boolean(process.env.OASIS_CODEX_BIN) || exists(CODEX_ACP_MAIN), version: adapterVersion(), installing: Boolean(setups.get('codex')) };
  let loggedIn = false;
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) loggedIn = true;
  else if (bin && out) {
    const status = await run(bin, ['login', 'status']);
    loggedIn = status ? /logged in/i.test(status) && !/not logged in/i.test(status) : exists(path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'auth.json'));
  } else loggedIn = exists(path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'auth.json'));
  const found = Boolean(bin && out) || adapter.found;
  return {
    found, version: firstVersion(out), loggedIn, adapter, ready: loggedIn && adapter.found,
    models: seenModels.get('codex') || null,
    modes: [
      { id: 'read-only', name: 'Read only' },
      { id: 'workspace-write', name: 'Workspace access' },
      { id: 'agent', name: 'Auto review', default: true },
      { id: 'agent-full-access', name: 'Full access' },
    ],
    install: 'npm install -g @openai/codex', login: 'codex login',
    setup: adapter.found ? null : 'The Oasis downloads its Codex adapter once (about 540 MB) at the first summon.',
  };
}

async function hermes() {
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  const candidates = process.env.OASIS_HERMES_BIN ? [process.env.OASIS_HERMES_BIN] : WIN
    ? [path.join(local, 'hermes', 'bin', 'hermes.exe'), path.join(local, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')]
    : [path.join(HOME, '.hermes', 'bin', 'hermes'), path.join(HOME, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'), path.join(HOME, '.hermes', 'hermes-agent', '.hermes', 'bin', 'hermes')];
  const bin = candidates.find(exists) || onPath('hermes');
  const out = bin ? await run(bin, ['--version'], 15000) : null;
  const home = process.env.HERMES_HOME || (WIN ? path.join(local, 'hermes') : path.join(HOME, '.hermes'));
  return { found: Boolean(bin && out), version: firstVersion(out), home: exists(path.join(home, 'config.yaml')) ? home : null, install: 'the Hermes Agent installer: github.com/NousResearch/hermes-agent' };
}

async function preset(name, findPaths, install) {
  const bin = findPaths.find(exists) || onPath(name);
  const out = bin && !bin.endsWith('.js') ? await run(bin, ['--version']) : bin ? await run(process.execPath, [bin, '--version']) : null;
  return { found: Boolean(bin && out), version: firstVersion(out), install };
}

let cache = null;
let cachedAt = 0;
let pending = null;
/** The answer for the circle. Cached 30 s; `fresh` reads again. */
export function runtimesView({ fresh = false } = {}) {
  // The last answer at once, read again behind it when it is older than 30 s (a read takes seconds: the circle must not wait).
  if (!fresh && cache) { if (Date.now() - cachedAt >= 30000 && !pending) read(); return Promise.resolve(cache); }
  return pending || read();
}
function read() {
  if (pending) return pending;
  const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  pending = Promise.all([
    claude(), codex(), hermes(),
    preset('grok', [path.join(HOME, '.grok', 'bin', WIN ? 'grok.exe' : 'grok')], 'Grok Build, the command-line agent from xAI'),
    preset('gemini', [path.join(APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')], 'npm install -g @google/gemini-cli'),
  ]).then(([c, x, h, g, gm]) => {
    cache = { claude: c, codex: x, hermes: h, grok: g, gemini: gm, at: new Date().toISOString() };
    cachedAt = Date.now();
    return cache;
  }).finally(() => { pending = null; });
  return pending;
}
/** The last answer, without waiting (for /health); starts a read when there is none or it is old. */
export function runtimesCached() {
  if (!cache || Date.now() - cachedAt > 30000) runtimesView().catch(() => {});
  return cache;
}

const setups = new Map();
/**
 * Install a runtime's adapter once. Only Codex has one: npm, into ~/.oasis/runtimes/codex-acp, the version pinned.
 * Calls while it runs share it. Resolves {ok, data:{path}} or {ok:false, error}.
 */
export function setupRuntime(runtime, log = () => {}) {
  if (runtime !== 'codex') return Promise.resolve({ ok: false, error: `${runtime} has nothing to set up here: install it with its own installer` });
  if (exists(CODEX_ACP_MAIN)) return Promise.resolve({ ok: true, data: { path: CODEX_ACP_MAIN, already: true } });
  if (setups.has(runtime)) return setups.get(runtime);
  const p = new Promise((resolve) => {
    fs.mkdirSync(CODEX_ACP_DIR, { recursive: true });
    const npm = WIN ? 'npm.cmd' : 'npm';
    const args = ['install', '--prefix', CODEX_ACP_DIR, `@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}`, '--no-audit', '--no-fund', '--loglevel=error'];
    log(`setting up Codex for the Oasis: npm ${args.join(' ')}`);
    const t0 = Date.now();
    // npm is a .cmd on Windows: it needs the shell; every argument here is fixed (the folder is the user's own home).
    const child = spawn(npm, WIN ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args, { shell: WIN, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => {
      clearTimeout(timer);
      setups.delete(runtime);
      cachedAt = 0;
      if (code === 0 && exists(CODEX_ACP_MAIN)) { log(`Codex for the Oasis is set up (${Math.round((Date.now() - t0) / 1000)} s)`); resolve({ ok: true, data: { path: CODEX_ACP_MAIN } }); }
      else resolve({ ok: false, error: `could not set up Codex for the Oasis (npm exit ${code}): ${err.trim().split('\n').slice(-3).join(' ') || 'no message'}. By hand: npm install --prefix "${CODEX_ACP_DIR}" @agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}` });
    });
  });
  setups.set(runtime, p);
  return p;
}
