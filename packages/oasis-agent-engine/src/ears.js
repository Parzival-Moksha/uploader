// Live dictation: the words appear while you talk. The page streams the mic (16 kHz, 16-bit mono, ~100 ms pieces) over
// ws://127.0.0.1:4530/listen; a small local Python helper (../ears/ears.py, the same one Tyler uses) runs Moonshine
// Medium Streaming on the CPU and sends back "partial" lines that can still change and a "final" line once you pause.
// The helper stays warm between dictations and is let go after 20 quiet minutes. Nothing leaves this computer.
//
//   page -> engine   binary frames: PCM16 LE      text: {"t":"stop"}
//   engine -> page   {"t":"status"|"ready"|"partial"|"final"|"stopped"|"error", ...}   (ears.py's own lines)
//
// Which Python and which model folder: OASIS_EARS_PYTHON / OASIS_EARS_MODELS, else the engine's own ears/.venv and
// ears/.cache, else Tyler's (C:/7f_Tyler, or OASIS_TYLER_DIR), which already has the helper's packages and the models.
// With none of them, the first press of the mic creates ears/.venv and installs ears/requirements.txt (about 50 MB).
import { saveSetting, setting } from './settings.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EARS_DIR = path.resolve(HERE, '..', 'ears');
const isWin = process.platform === 'win32';
const venvPython = (venv) => (isWin ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python'));
const OWN_VENV = path.join(EARS_DIR, '.venv');
const OWN_MODELS = path.join(EARS_DIR, '.cache');
// A folder that already has the helper set up (this machine's `tylerDir` setting); without one the engine builds its own.
const TYLER = setting('tylerDir');
const TYLER_PYTHON = TYLER ? venvPython(path.join(TYLER, 'Tyler', 'ears', '.venv')) : '';
const TYLER_MODELS = TYLER ? path.join(TYLER, 'studio', '.cache', 'ears') : '';
export const EARS_MODEL = process.env.OASIS_EARS_MODEL || 'moonshine-medium';
const IDLE_MS = 20 * 60_000;
const SETUP_OK = path.join(OWN_VENV, 'oasis-ears.ok');

export function earsPaths() {
  const python = process.env.OASIS_EARS_PYTHON
    || (fs.existsSync(SETUP_OK) ? venvPython(OWN_VENV) : null)
    || (TYLER_PYTHON && fs.existsSync(TYLER_PYTHON) ? TYLER_PYTHON : null);
  const models = process.env.OASIS_EARS_MODELS
    || (fs.existsSync(OWN_MODELS) ? OWN_MODELS : null)
    || (TYLER_MODELS && fs.existsSync(TYLER_MODELS) ? TYLER_MODELS : OWN_MODELS);
  return { python, models, model: EARS_MODEL };
}

// --- first-use setup: our own Python folder ------------------------------------------------------------------------------
function findSystemPython() {
  // The Microsoft Store stub (WindowsApps\python.exe) only opens the Store, so check that it really runs.
  // A Mac without Apple's command-line tools has a /usr/bin/python3 stub that opens an install window: only real
  // Pythons there (Homebrew, python.org), and the plain python3 only when xcode-select says the tools are in place.
  const candidates = process.platform === 'darwin'
    ? [['/opt/homebrew/bin/python3', []], ['/usr/local/bin/python3', []], ['/Library/Frameworks/Python.framework/Versions/Current/bin/python3', []],
       ...(spawnSync('xcode-select', ['-p'], { stdio: 'ignore' }).status === 0 ? [['python3', []]] : [])]
    : [['py', ['-3']], ['python', []], ['python3', []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && String(r.stdout).trim() === '3') return [cmd, pre];
  }
  return null;
}

function run(cmd, args, status) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: EARS_DIR, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    let tail = '';
    const take = (d) => { tail = (tail + d).slice(-600); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const tick = setInterval(() => status?.('Setting up the voice helper (one time, about a minute)…'), 8000);
    child.on('close', (code) => { clearInterval(tick); code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed (${code}): ${tail.trim().split('\n').pop()}`)); });
    child.on('error', (e) => { clearInterval(tick); reject(e); });
  });
}

let setupPromise = null;
let earsAskedAt = 0;
const EARS_ASK_MS = 10 * 60_000;
/** What the first press of the mic answers in the packaged Oasis. */
export const EARS_ASK = 'Voice typing needs a local helper that is not installed yet. Press the mic again to install it: it uses your Python 3, downloads about 50 MB of packages and one speech model (once, about a minute), and runs on this machine only.';
async function ensurePython(status, { asked = false } = {}) {
  const found = earsPaths().python;
  if (found) return found;
  // The packaged Oasis installs nothing unasked: the helper is a Python folder of about 50 MB plus a speech model
  // fetched on first use. The first press of the mic says so; a second press within ten minutes is the yes, and
  // it is remembered (this machine's settings, `earsInstall`). OASIS_EARS_INSTALL=1 says yes ahead, =0 never.
  // The owner's own Oasis (no edition set) sets itself up as before.
  if (process.env.OASIS_EARS_INSTALL === '0') throw new Error('Voice typing is switched off on this machine (OASIS_EARS_INSTALL=0).');
  if (!asked && process.env.OASIS_EDITION === 'slim' && process.env.OASIS_EARS_INSTALL !== '1' && setting('earsInstall') !== 'yes') {
    if (Date.now() - earsAskedAt > EARS_ASK_MS) {
      earsAskedAt = Date.now();
      throw new Error(EARS_ASK);
    }
    saveSetting('earsInstall', 'yes');
  }
  setupPromise ||= (async () => {
    const py = findSystemPython();
    if (!py) throw new Error('No Python 3 found: install it from python.org (tick "Add to PATH"), then press the mic again');
    status?.('Setting up the voice helper (one time, about a minute)…');
    await run(py[0], [...py[1], '-m', 'venv', OWN_VENV], status);
    await run(venvPython(OWN_VENV), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', path.join(EARS_DIR, 'requirements.txt')], status);
    fs.writeFileSync(SETUP_OK, new Date().toISOString());
    return venvPython(OWN_VENV);
  })().finally(() => { setupPromise = null; });
  return setupPromise;
}

/**
 * Can the local helper run here at all? Its speech package (moonshine-voice 0.1.5) ships wheels for Windows, Linux and
 * Apple-silicon Macs on macOS 15 or newer only; anywhere else the page's browser recognition is the voice typing.
 */
export function earsPlatform(platform = process.platform, arch = process.arch, release = os.release()) {
  if (platform !== 'darwin') return { ok: true };
  if (arch !== 'arm64') return { ok: false, why: "The local voice-typing helper needs an Apple-silicon Mac (its speech package has no Intel build); your browser's recognition types instead." };
  if (Number(String(release).split('.')[0]) < 24) return { ok: false, why: "The local voice-typing helper needs macOS 15 or newer; your browser's recognition types instead." };
  return { ok: true };
}

/**
 * The helper's setup, from Settings' button (installEars) or by itself at a packaged engine's first start
 * (autoInstallEars): its Python packages (about 50 MB, 160 MB on disk), then the English speech model (about 260 MB,
 * fetched and checked by the speech package on the helper's first start). Asked again, it says how far it is.
 * state: idle, installing, ready, failed, off (OASIS_EARS_INSTALL=0), unsupported (earsPlatform). step: packages, model.
 */
let install = { state: 'idle', step: '', text: '', error: '', startedAt: 0, auto: false };
export function earsSetupState() {
  const where = earsPlatform();
  if (!where.ok) return { state: 'unsupported', error: where.why };
  if (install.state === 'idle' && earsPaths().python && helper?.ready) return { state: 'ready' };
  return { ...install };
}

export function startEarsInstall(log, { auto = false } = {}) {
  const where = earsPlatform();
  if (!where.ok) return { state: 'unsupported', error: where.why };
  if (process.env.OASIS_EARS_INSTALL === '0') return { state: 'off', error: "Voice typing's local helper is switched off on this machine (OASIS_EARS_INSTALL=0)." };
  if (install.state === 'installing' || install.state === 'ready') return { ...install };
  saveSetting('earsInstall', 'yes'); // started by itself or from Settings: a press of the mic meanwhile is no question
  install = { state: 'installing', step: 'packages', text: 'Starting…', error: '', startedAt: Date.now(), auto };
  const failed = (e) => { install = { ...install, state: 'failed', text: '', error: e.message || String(e) }; log?.(`ears: setup ${auto ? '(by itself)' : 'from Settings'} failed: ${install.error}`); };
  (earsPaths().python ? Promise.resolve(earsPaths().python) : ensurePython((text) => { install.text = text; }, { asked: true }))
    .then((python) => {
      // The model: the helper fetches it on its first start (status lines "Downloading Moonshine (en): 40%").
      install.step = 'model';
      install.text = 'Loading the speech model…';
      const h = getHelper(python, earsPaths().models, log);
      sleepLater();
      if (h.ready) { install = { ...install, state: 'ready', text: '' }; return; }
      const onMsg = (m) => {
        if (m.t === 'status' && m.text) install.text = m.text;
        else if (m.t === 'ready') { h.off('msg', onMsg); install = { ...install, state: 'ready', text: '' }; log?.(`ears: set up ${auto ? 'by itself' : 'from Settings'} in ${Math.round((Date.now() - install.startedAt) / 1000)} s`); }
        else if (m.t === 'error') { h.off('msg', onMsg); failed(new Error(m.text || 'the voice helper stopped')); }
      };
      h.on('msg', onMsg);
    })
    .catch(failed);
  return { ...install };
}

/**
 * A packaged engine's first start: voice typing is part of the Oasis (the owner, 2026-11-22: "talking is kind of the
 * point"), so with no ElevenLabs key the helper sets itself up in the background; the page's browser recognition types
 * until it is ready, and the mic switches over by itself. Not on the owner's own Oasis (no edition: as before), not
 * with OASIS_EARS_INSTALL=0, not where it cannot run, and only once it is missing (a set-up helper just stays cold).
 */
export function autoInstallEars(log, { hasKey = false } = {}) {
  if (process.env.OASIS_EDITION !== 'slim' || process.env.OASIS_EARS_INSTALL === '0' || hasKey) return null;
  if (!earsPlatform().ok || earsPaths().python) return null;
  log?.('ears: setting itself up in the background (packages about 50 MB, speech model about 260 MB)');
  return startEarsInstall(log, { auto: true });
}

// --- the helper: one model, kept warm ----------------------------------------------------------------------------------
class Helper extends EventEmitter {
  constructor(python, models, log) {
    super();
    this.setMaxListeners(50);
    this.ready = false;
    this.dead = false;
    this.err = [];
    const threads = String(Math.max(2, Math.min(4, Math.floor((os.availableParallelism?.() || os.cpus().length) / 4))));
    this.child = spawn(python, [path.join(EARS_DIR, 'ears.py'), '--model', EARS_MODEL, '--models-dir', models, '--threads', threads], {
      cwd: EARS_DIR,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    });
    log?.(`ears: ${EARS_MODEL} starting (pid ${this.child.pid})`);
    this.child.stdin.on('error', () => {});
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.t === 'ready') { this.ready = true; log?.(`ears: ready in ${m.load_s}s`); }
      this.emit('msg', m);
    });
    readline.createInterface({ input: this.child.stderr }).on('line', (l) => {
      this.err.push(l);
      if (this.err.length > 20) this.err.shift();
    });
    const gone = (code) => {
      if (this.dead) return;
      this.dead = true;
      const why = this.err.filter((l) => /Error|error|Traceback|No module/.test(l)).slice(-1)[0] || this.err.slice(-1)[0] || '';
      if (!this.quitting) this.emit('msg', { t: 'error', text: `The voice helper stopped (${code ?? '?'})${why ? `: ${why.slice(0, 200)}` : ''}` });
      this.emit('exit');
    };
    this.child.on('close', gone);
    this.child.on('error', (e) => gone(e.message));
  }
  send(obj) {
    if (!this.dead) this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }
  kill() {
    if (this.dead) return;
    this.quitting = true;
    this.send({ t: 'quit' });
    const child = this.child;
    setTimeout(() => { if (!this.dead) try { child.kill(); } catch { /* gone */ } }, 1500);
  }
}

let helper = null;
let idleTimer = null;
let session = null;
let sids = 0;

function getHelper(python, models, log) {
  clearTimeout(idleTimer);
  if (helper && !helper.dead) return helper;
  helper = new Helper(python, models, log);
  return helper;
}

function sleepLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!session) helper?.kill(); }, IDLE_MS);
  idleTimer.unref?.();
}

/** Load the model ahead of the first press, so the first words come fast. Never installs or downloads. */
export function warmEars(log) {
  const { python, models } = earsPaths();
  if (!python || session) return { warming: false, ready: Boolean(helper?.ready) };
  const h = getHelper(python, models, log);
  sleepLater();
  return { warming: !h.ready, ready: h.ready, model: EARS_MODEL };
}

export function earsStatus() {
  const { python, models } = earsPaths();
  return { model: EARS_MODEL, python: python || null, models, warm: Boolean(helper && !helper.dead && helper.ready), loading: Boolean(helper && !helper.dead && !helper.ready) };
}

export function stopEars() {
  helper?.kill();
}

/** One dictation per WebSocket; a new one ends the one before (one microphone at a time). */
export async function listen(ws, url, log) {
  const lang = (url.searchParams.get('lang') || 'en').slice(0, 8);
  const sid = ++sids;
  const json = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  session?.end('Another microphone took over.');
  let stopped = false;
  let attached = null;
  const me = {
    end(why) {
      if (why) json({ t: 'error', text: why });
      ws.close();
    },
  };
  session = me;
  const pending = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const b = Buffer.isBuffer(data) ? data : Buffer.concat(data);
      if (attached) attached.send({ t: 'audio', pcm: b.toString('base64') });
      else if (pending.length < 600) pending.push(b); // ~60 s while the helper wakes up
      return;
    }
    let m = {};
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'stop' && !stopped) {
      stopped = true;
      if (attached) attached.send({ t: 'stop' });
      else ws.close();
    }
  });
  const relay = (m) => {
    if (m.sid != null && m.sid !== sid) return;
    json(m);
    if (m.t === 'stopped') setTimeout(() => ws.close(), 50);
  };
  const gone = () => setTimeout(() => ws.close(), 100);
  ws.on('close', () => {
    if (attached && !stopped) attached.send({ t: 'stop' });
    stopped = true;
    if (session === me) session = null;
    setTimeout(() => {
      attached?.off('msg', relay);
      attached?.off('exit', gone);
    }, 5000);
    sleepLater();
  });

  let python;
  try {
    python = await ensurePython((text) => json({ t: 'status', text }));
  } catch (e) {
    return me.end(e.message === EARS_ASK ? e.message : `Setting up the voice helper failed: ${e.message}`);
  }
  if (ws.readyState !== 1) return;
  const { models } = earsPaths();
  const h = getHelper(python, models, log);
  attached = h;
  h.on('msg', relay);
  h.once('exit', gone);
  if (h.ready) json({ t: 'ready', model: EARS_MODEL, warm: true });
  else json({ t: 'status', text: 'Waking up Moonshine…' });
  h.send({ t: 'start', sid, lang });
  for (const b of pending.splice(0)) h.send({ t: 'audio', pcm: b.toString('base64') });
  if (stopped) h.send({ t: 'stop' });
}
