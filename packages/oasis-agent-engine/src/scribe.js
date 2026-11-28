// Voice messages from the Oasis, and the sound of voice typing.
// A recorded voice message is transcribed in the cloud (ElevenLabs Scribe, the same request the Telegram module makes
// for voice notes: scribe_v2, no audio-event tags, the village's names as key terms; the key is never logged or sent to
// the page) or on this computer (the owner, 27 Nov: "voice typing ... local or cloud, and also the voice messages,
// separately"; "Moonshine Medium ... could we use the same thing for voice messages?"): the same Moonshine Medium helper
// voice typing runs (ears.py), fed the whole recording, on one thread at below-normal priority, so the Oasis keeps its
// frame rate and nothing leaves the PC.
// His voice is kept where nothing cleans it away (it was in the Windows temp folder): <voiceDir>/messages for voice
// messages and <voiceDir>/typing for what he voice-typed (the owner: "whenever I voice type ... I want it to be recorded
// and saved together with its text"), each recording with a .json beside it: which agent, when, the words. voiceDir is a
// machine setting (OASIS_VOICE_DIR), else ~/oasis-voice: outside every repository, so no commit can take it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readScribeKey } from './telegram.js';
import { registerAttachment } from './files.js';
import { earsPaths } from './ears.js';
import { setting } from './settings.js';

const SCRIBE_API = 'https://api.elevenlabs.io/v1/speech-to-text';
// Long voice messages are fine: Scribe takes long files. At the page's 32 kbit/s that is about 4 hours, and as base64
// it still fits the engine socket's 100 MiB message limit.
export const VOICE_MAX_BYTES = 70 * 1024 * 1024;

/** Where his voice is kept (created when first used). */
export function voiceDir(kind = 'messages') {
  const root = setting('voiceDir') || path.join(os.homedir(), 'oasis-voice');
  return path.join(root, kind);
}

const EXT = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };

export function voiceExtension(mime) {
  return EXT[String(mime || '').split(';')[0].trim().toLowerCase()] || '.webm';
}

export async function scribeTranscribe({ audio, name, mime, key, keyterms = [], api = process.env.OASIS_SCRIBE_API || SCRIBE_API, timeoutMs = 120_000 }) {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('tag_audio_events', 'false');
  for (const t of [...new Set(keyterms)].filter((t) => t && t.length <= 40).slice(0, 40)) form.append('keyterms', t);
  form.append('file', new Blob([audio], { type: String(mime || 'audio/webm').split(';')[0] }), name);
  const res = await fetch(api, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Scribe ${res.status}: ${String(data?.detail?.message || data?.detail || '').slice(0, 160)}`);
  return String(data.text || '').trim();
}

const EARS_PY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ears', 'ears.py');

function ffmpegPath() {
  try { return createRequire(import.meta.url)('ffmpeg-static'); } catch { return 'ffmpeg'; }
}

const lower = (child) => { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal then */ } };

/**
 * A whole recording through Moonshine Medium on this computer: ffmpeg turns it into 16 kHz mono PCM, a helper of its own
 * (ears.py, the one voice typing uses, but not the live one: dictation goes on undisturbed) hears it, the settled lines
 * are the text. One thread, below normal priority. Resolves { text, audioS, seconds }.
 */
export function localTranscribe(file, { timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const { python, models, model } = earsPaths();
    if (!python) { reject(new Error('Local transcription needs the voice helper: press the microphone on a text field once to install it.')); return; }
    const t0 = Date.now();
    const ears = spawn(python, [EARS_PY, '--model', model, '--models-dir', models, '--threads', '1'], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', MOONSHINE_ORT_SINGLE_THREAD: '1' } });
    lower(ears);
    let finished = false;
    const finish = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ears.stdin.write(JSON.stringify({ t: 'quit' }) + '\n'); } catch { /* gone */ }
      setTimeout(() => { try { ears.kill(); } catch { /* gone */ } }, 2000);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('the local transcription took too long')), timeoutMs);
    const lines = new Map();
    let buf = '';
    const send = (msg) => new Promise((r) => { if (!ears.stdin.write(JSON.stringify(msg) + '\n')) ears.stdin.once('drain', r); else r(); });
    ears.on('error', (e) => finish(new Error(`the voice helper did not start (${e.code || e.message})`)));
    ears.on('exit', () => finish(new Error('the voice helper stopped')));
    ears.stderr.on('data', () => {});
    ears.stdout.on('data', async (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'ready') feed().catch((e) => finish(e));
        else if (m.t === 'final' && m.sid === 1) lines.set(m.line, m.text);
        else if (m.t === 'stopped' && m.sid === 1) {
          const text = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).filter(Boolean).join(' ').trim();
          finish(null, { text, audioS: m.audio_s, seconds: Math.round((Date.now() - t0) / 100) / 10 });
        } else if (m.t === 'error') finish(new Error(`the voice helper: ${String(m.text || '').slice(0, 160)}`));
      }
    });
    const feed = async () => {
      await send({ t: 'start', sid: 1, lang: 'en' });
      const ff = spawn(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { windowsHide: true });
      lower(ff);
      let rest = Buffer.alloc(0);
      for await (const chunk of ff.stdout) {
        const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
        const even = all.length - (all.length % 6400); // whole 200 ms pieces of 16-bit samples
        for (let o = 0; o < even; o += 6400) await send({ t: 'audio', pcm: all.subarray(o, o + 6400).toString('base64') });
        rest = all.subarray(even);
      }
      if (rest.length > 1) await send({ t: 'audio', pcm: rest.subarray(0, rest.length - (rest.length % 2)).toString('base64') });
      await send({ t: 'stop' });
    };
  });
}

function keep(kind, audio, type) {
  const dir = voiceDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${voiceExtension(type)}`);
  fs.writeFileSync(file, audio);
  return file;
}

function note(file, data) {
  try { fs.writeFileSync(file.replace(/\.[^.]+$/, '.json'), JSON.stringify(data, null, 2)); } catch { /* the sound is kept anyway */ }
}

/**
 * Keep a recorded voice message (playable at GET /file/<id>) and transcribe it, in the cloud or (local: true) on this
 * computer. Returns { fileId, mime, transcript, local }.
 */
export async function takeVoiceMessage({ audioBase64, mime, keyterms = [], local = false, agent = null, durationMs = null }) {
  const key = local ? null : readScribeKey();
  if (!local && !key) throw new Error('Voice messages need an ElevenLabs key (ELEVENLABS_API_KEY), or set voice messages to local (Settings > Sound).');
  const audio = Buffer.from(String(audioBase64 || ''), 'base64');
  if (!audio.length) throw new Error('empty recording');
  if (audio.length > VOICE_MAX_BYTES) throw new Error('recording too long');
  const type = String(mime || 'audio/webm').split(';')[0].trim().toLowerCase();
  const file = keep('messages', audio, type);
  const fileId = registerAttachment(file, type, false);
  let transcript;
  if (local) {
    // Measured 27 Nov on three of his 23-29 minute messages: 0.34-0.48 of the recording's length on one thread (a busy
    // PC), so an hour, or one and a half times the recording when it is longer.
    transcript = (await localTranscribe(file, { timeoutMs: Math.max(3_600_000, (Number(durationMs) || 0) * 1.5) })).text;
  } else {
    // Two minutes, plus time for long recordings (about 30 s more per MB, ~4 minutes of speech).
    const timeoutMs = 120_000 + Math.ceil(audio.length / (1024 * 1024)) * 30_000;
    transcript = await scribeTranscribe({ audio, name: path.basename(file), mime: type, key, keyterms: ['Anorak', 'Oasis', ...keyterms], timeoutMs });
  }
  note(file, { kind: 'voice message', agent, at: new Date().toISOString(), ...(durationMs ? { durationMs: Math.round(durationMs) } : {}), transcriber: local ? 'local (Moonshine Medium)' : 'cloud (ElevenLabs scribe_v2)', text: transcript });
  return { fileId, mime: type, transcript, local };
}

/** The sound of something he voice-typed and sent, kept with the text as sent. Never transcribed again, never uploaded. */
export function keepVoiceTyping({ audioBase64, mime, agent = null, text = '', durationMs = null }) {
  const audio = Buffer.from(String(audioBase64 || ''), 'base64');
  if (!audio.length) throw new Error('empty recording');
  if (audio.length > VOICE_MAX_BYTES) throw new Error('recording too long');
  const type = String(mime || 'audio/webm').split(';')[0].trim().toLowerCase();
  const file = keep('typing', audio, type);
  note(file, { kind: 'voice typing', agent, at: new Date().toISOString(), ...(durationMs ? { durationMs: Math.round(durationMs) } : {}), text: String(text) });
  return { file: path.basename(file) };
}
