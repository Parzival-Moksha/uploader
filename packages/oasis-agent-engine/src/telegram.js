// Telegram: the owner's phone line to the village, through the bot in data/anorak-pro-telegram.local.json (@anorakprobot).
// The engine is the bot's one getUpdates consumer (Telegram allows only one); the Next app keeps `pollingEnabled: false`
// in that file and only sends. Our own offset and settings: data/agent-engine-telegram.local.json.
//
//   in   only the owner's chat (chatId); everything else is ignored.
//        "Tyler: fix the intro" or "@tyler fix the intro" -> the agent whose name starts with that (case-insensitive);
//        "Tyler, fix the intro" too when the name is known (voice notes come out like that). No name -> Anorak.
//        /agents (names + status), /pings on|off, /stop [name], /help. Voice notes -> ElevenLabs Scribe -> like text.
//   out  when a turn that a Telegram message started ends: its final text (name first unless it's Anorak, split at 4096)
//        and the files it sent with SendUserFile (photos or documents).
//        Pings: an agent at needs-decision (amber) or error (red) for PING_MS (2 min) gets one short message per state.
//        The daily check-in (checkin.js): at 21:00 local, the day's work from the Mindcraft work counter. /checkin.
//        A "needs you" message is one he can act on (approvals.js): "Perf: allow", "Perf: deny", "Perf: allow always",
//        "Perf: show" (the rest of a long request), "Perf: pick 2" (a simple question). Only from his own private chat,
//        typed (not by voice, not forwarded), and only for a request he has been shown whole. Not sent while an Oasis page
//        is open and he was active in the last ten minutes; several agents waiting together are one message.
//
// Across engine restarts (journal.js): an update taken from the bot is kept until it is handed to an agent, and handled
// at the next start if the engine stopped in between; a message handed to an agent rides in that agent's journal queue
// (source "tg:<update id>") until its CLI has it; and an agent whose turn a Telegram message started still owes its
// reply here after the restart (the turn it is resumed into answers on Telegram).
//
// Runs only in the real engine (port 4530) unless OASIS_TELEGRAM=1; OASIS_TELEGRAM=0 turns it off. Test engines on other
// ports never touch the bot. The token never reaches a log line, a message or an error text (redact()).
import { envValue, ownEnvValue, setting } from './settings.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { attachmentFile } from './files.js';
import { CHECKIN_DEFAULT, checkinDue, checkinText, localDate, parseCheckinTime } from './checkin.js';
import { stripSpoken } from './voice.js';
import { describeSuggestions, groupBlocks, handle, parseDecision, requestBlock, requestText, showText, simpleQuestion, splitExact, suggestionProblem } from './approvals.js';

export const TG_MAX = 4096;
export const PING_MS = 2 * 60_000;
const CHUNK = 3800; // markdown source per message; HTML tags and escapes need some room under 4096
const PHOTO_MAX = 10 * 1024 * 1024;
const DOC_MAX = 50 * 1024 * 1024;
const VOICE_MAX = 20 * 1024 * 1024; // the Bot API's getFile limit
const TYPING_MAX_MS = 30 * 60_000;
/** An agent may write to the owner on its own once in this long (tell()). */
export const TELL_GAP_MS = 30 * 60_000;
/** After a restart, an agent that owed a reply here still owes it for this long (journal.js `owed`). */
const REARM_MS = 15 * 60_000;
const SCRIBE_API = 'https://api.elevenlabs.io/v1/speech-to-text';
/** Several agents waiting within this long of the first ping become one message. */
export const BATCH_MS = 45_000;
/** No ping while an Oasis page is open and the owner was active this recently (the marker over the agent is enough). */
export const PRESENT_MS = 10 * 60_000;
/** A held ping looks again this often. */
const HOLD_RECHECK_MS = 60_000;

export const STATUS_EMOJI = { working: '🟢', waiting: '🔵', 'needs-decision': '🟠', error: '🔴', idle: '⚪' };

// ------------------------------------------------------------------ pure helpers (unit-tested)
/** "Og's ward" -> "ogsward", "WG kereső" -> "wgkereso": what a typed or spoken name is compared on. */
export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Agents the owner can write to: owned ones, and watched sessions whose Oasis mod is connected (bridge.js). */
export function canTalk(a) { return !!a && (a.kind === 'owned' || a.bridged === true); }

export function isAnorak(a) { return /anorak/i.test(a?.name || ''); }

/** Anorak: the talkable agent whose name says Anorak (an owned one, and a plain "Anorak", first). */
export function defaultAgent(agents) {
  const list = agents.filter((a) => isAnorak(a) && canTalk(a));
  list.sort((a, b) => Number(b.kind === 'owned') - Number(a.kind === 'owned') || Number(normName(b.name) === 'anorak') - Number(normName(a.name) === 'anorak'));
  return list[0] || null;
}

/** Exact name first, else every agent whose name starts with it; talkable ones win a tie. */
export function findAgents(token, agents) {
  const t = normName(token);
  if (!t) return [];
  const exact = agents.filter((a) => normName(a.name) === t);
  const found = exact.length ? exact : agents.filter((a) => normName(a.name).startsWith(t));
  if (found.length > 1) {
    const talk = found.filter(canTalk);
    if (talk.length) return talk;
  }
  return found;
}

/**
 * Where a message goes.
 * -> {kind:'command', command, arg} | {kind:'agent', agent, text} | {kind:'default', text}
 *  | {kind:'unknown', name} | {kind:'ambiguous', name, matches} | {kind:'empty'}
 */
export function parseRoute(raw, agents) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty' };
  const cmd = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (cmd) return { kind: 'command', command: cmd[1].toLowerCase(), arg: (cmd[2] || '').trim() };
  const pick = (name, rest, { strict, minLen = 1 }) => {
    if (normName(name).length < minLen) return null;
    const found = findAgents(name, agents);
    if (found.length === 1) return rest.trim() ? { kind: 'agent', agent: found[0], text: rest.trim() } : { kind: 'empty' };
    if (!strict) return null;
    return found.length ? { kind: 'ambiguous', name: name.trim(), matches: found } : { kind: 'unknown', name: name.trim() };
  };
  // "@tyler fix the intro" (also "@tyler: ..." and "@tyler, ...")
  let m = text.match(/^@([^\s:,]+)[:,]?\s*([\s\S]*)$/);
  if (m) return pick(m[1], m[2], { strict: true });
  // "Tyler: fix the intro". A colon needs a space after it, so "https://..." and "10:30" are not names. No agent by
  // that name ("Note: build is red", "PS: ...") and it is just a sentence for Anorak; only "@name" gets the list back.
  m = text.match(/^([^:\n]{1,40}):\s+([\s\S]+)$/);
  if (m) {
    const r = pick(m[1], m[2], { strict: false });
    if (r) return r;
  }
  // "Tyler, fix the intro" / "Hey Tyler, ..." (how a voice note comes out): only a known name, at least 3 letters.
  m = text.match(/^(?:(?:hey|hi|hello|ok|okay|so)[,\s]+)?([^,.!?:\n]{1,40})[,.!?]\s+([\s\S]+)$/i);
  if (m) {
    const r = pick(m[1], m[2], { strict: false, minLen: 3 });
    if (r) return r;
  }
  return { kind: 'default', text };
}

/** One line per agent: colour dot, name, status. */
export function agentListText(agents) {
  if (!agents.length) return 'Nobody in the village right now.';
  const line = (a) => {
    const st = a.status === 'needs-decision' ? `needs you${a.statusReason ? ` (${a.statusReason})` : ''}` : a.status || 'idle';
    return `${STATUS_EMOJI[a.status] || '⚪'} ${a.name || a.id} · ${st}${canTalk(a) ? '' : ' · watching only'}`;
  };
  return agents.map(line).join('\n');
}

export const HELP = [
  'Write anything: it goes to Anorak.',
  '"Tyler: fix the intro" or "@tyler fix the intro" goes to that agent.',
  'Voice notes work the same way.',
  '/agents  who is in the village',
  '/stop [name]  interrupt a turn (Anorak without a name)',
  '/pings on|off  messages when an agent waits for you for 2 minutes',
  '"Perf: allow", "Perf: deny", "Perf: allow always", "Perf: show"  answer an agent that waits for you (typed, not by voice)',
  '/checkin on|off|21:30|now  the evening sum-up of the day\'s work',
].join('\n');

/** Split for Telegram: at a blank line, else a line break, else a space; a ``` block cut in two is closed and reopened. */
export function chunkText(text, max = CHUNK) {
  const out = [];
  let rest = String(text || '');
  let reopen = '';
  while (rest.length) {
    rest = reopen + rest;
    reopen = '';
    if (rest.length <= max) { out.push(rest); break; }
    const room = max - 8; // space for a closing fence
    let cut = rest.lastIndexOf('\n\n', room);
    if (cut < room * 0.5) cut = rest.lastIndexOf('\n', room);
    if (cut < room * 0.5) cut = rest.lastIndexOf(' ', room);
    if (cut < room * 0.5) cut = room;
    let piece = rest.slice(0, cut).replace(/\s+$/, '');
    rest = rest.slice(cut).replace(/^\s+/, '');
    if ((piece.match(/```/g) || []).length % 2 === 1) { piece += '\n```'; reopen = '```\n'; }
    out.push(piece);
  }
  return out.filter((s) => s.trim());
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineHtml(s) {
  return s.split(/(`[^`\n]+`)/).map((part) => {
    if (/^`[^`\n]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    return escapeHtml(part)
      .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
      .replace(/^(\s*)[-*]\s+/gm, '$1• ')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  }).join('');
}

/** The bits of an agent's markdown that Telegram's HTML mode shows well: code, code blocks, bold, headings, links. */
export function mdToHtml(md) {
  return String(md || '').split('```').map((part, i) => (i % 2
    ? `<pre>${escapeHtml(part.replace(/^[\w+.-]*\n/, '').replace(/\n$/, ''))}</pre>`
    : inlineHtml(part))).join('');
}

const plainMd = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const clipLine = (s, n) => { const t = plainMd(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The last question in a text (a line ending in "?", its last sentence), else its end. */
export function lastQuestion(text) {
  const lines = String(text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\*+\s*$/, '');
    if (!/\?\s*$/.test(line)) continue;
    const sentences = line.match(/[^.!?]+[.!?]+/g) || [line];
    let q = sentences[sentences.length - 1];
    // Keep the sentence before when the question is short or a question too ("Push it? Or wait?" reads better whole)
    const before = sentences[sentences.length - 2];
    if (before && (q.length < 20 || /\?\s*$/.test(before))) q = sentences.slice(-2).join('');
    return q.trim();
  }
  const all = lines.join(' ');
  return all.length > 300 ? `…${all.slice(-300)}` : all;
}

/** Does this agent's state need the owner: an error, or an open card (permission, question, plan)? */
export function needsOwner(a) {
  if (a.status === 'error') return true;
  if (a.status !== 'needs-decision') return false;
  if (a.permissions?.length) return true;
  return ['permission', 'question', 'plan'].includes(a.statusReason);
}

/** "🟠 Tyler needs you: allow Bash: npm test?" / "🔴 Tyler is stuck: claude exited (code 1)". */
export function pingText(a, { lastText = '', lastTurnEnd = null } = {}) {
  const name = a.name || a.id;
  if (a.status === 'error') return `🔴 ${name} is stuck: ${clipLine(a.statusReason || 'an error', 300)}`;
  const req = a.permissions?.[0];
  let what;
  if (req?.requestKind === 'question') what = req.input?.questions?.[0]?.question || 'it has a question';
  else if (req?.requestKind === 'plan') what = 'a plan to approve';
  else if (req) {
    // summarizeTool already starts with the tool's name ("Write src/x.ts", "Bash: npm test")
    const s = String(req.summary || '');
    what = `allow ${s && req.toolName && s.startsWith(req.toolName) ? s : `${req.toolName || 'a tool'}${s ? `: ${s}` : ''}`}?`;
  }
  else if (a.statusReason === 'permission-denied') {
    const d = lastTurnEnd?.permissionDenials?.[0];
    what = d?.toolName ? `${d.toolName} was blocked and needs your OK` : 'a blocked tool needs your OK';
  } else what = lastText ? lastQuestion(lastText) : (a.statusReason || 'a decision');
  return `🟠 ${name} needs you: ${clipLine(what, 400)}`;
}

/** ELEVENLABS_API_KEY from the environment, else the Oasis's own .env, else the file this machine names (`scribeEnv`). Never logged. */
export function readScribeKey(file = setting('scribeEnv')) {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const own = ownEnvValue('ELEVENLABS_API_KEY');
  if (own) return own;
  if (!file) return '';
  try { return envValue(fs.readFileSync(file, 'utf8'), 'ELEVENLABS_API_KEY'); } catch { return ''; }
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const onAbort = () => { clearTimeout(t); resolve(); };
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});
const stripBom = (s) => s.replace(/^\uFEFF/, '');
const oneLineClip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

// ------------------------------------------------------------------ the bot
export class TelegramLine {
  /**
   * @param {{
   *   configFile: string, stateFile: string, apiBase?: string, pollTimeoutS?: number, pingMs?: number,
   *   listAgents: () => any[], send: (agentId: string, text: string) => Promise<any>|any,
   *   interrupt?: (agentId: string) => Promise<any>|any, fileFor?: (id: string) => ({path:string,isImage:boolean}|null),
   *   scribeApi?: string, scribeKey?: () => string, log?: (...a: any[]) => void,
   * }} o
   */
  constructor(o) {
    this.configFile = o.configFile;
    this.stateFile = o.stateFile;
    this.apiBase = (o.apiBase || 'https://api.telegram.org').replace(/\/$/, '');
    this.pollTimeoutS = o.pollTimeoutS ?? 25;
    this.pingMs = o.pingMs ?? PING_MS;
    this.listAgents = o.listAgents;
    this.sendToAgent = o.send;
    this.interruptAgent = o.interrupt || null;
    this.respondFn = o.respond || null; // (agentId, requestId, {behavior, message, answers, always}) -> engine's respond
    this.pages = o.pages || (() => 0); // Oasis pages connected to the engine (0: unknown, never holds a ping back)
    this.batchMs = o.batchMs ?? BATCH_MS;
    this.presentMs = o.presentMs ?? PRESENT_MS;
    this.presenceEveryMs = o.presenceEveryMs ?? 30_000;
    this.holdMs = o.holdMs ?? HOLD_RECHECK_MS;
    this.fileFor = o.fileFor || attachmentFile;
    this.scribeApi = o.scribeApi || process.env.OASIS_SCRIBE_API || SCRIBE_API;
    this.scribeKey = o.scribeKey || (() => readScribeKey());
    this.rawLog = o.log || ((...a) => console.log(...a));
    this.journal = o.journal || null;
    this.told = new Map(); // agentId -> when it last wrote to the owner on its own (tell)
    this.leftDone = false;
    this.tokens = new Set(); // every token seen, for redact()
    this.cfg = null;
    this.refreshConfig();
    this.state = this.loadState(); // {offset, pings}
    this.turns = new Map(); // agentId -> {name, expect:Set<text>, uuids:Set, bridge:[{text,at}], armed, finalText, files[], captions:Map, repliedAt, since}
    this.pings = new Map(); // agentId -> {status, since, timer}
    this.lastText = new Map(); // agentId -> last main-thread text (ping summaries)
    this.lastTurnEnd = new Map();
    this.shown = new Map(); // requestId -> {agentId, msgId (the Telegram message that showed it), full, noPhone, alwaysOk}: what he has been shown, so "allow" only meets a request he saw whole
    this.batch = new Map(); // agentId -> ping waiting for its message (several agents become one)
    this.batchTimer = null;
    this.activity = { date: null, seconds: 0, lastGrowthAt: 0 }; // the work counter's seconds, to know when he last worked
    this.presenceTimer = null;
    this.outbox = Promise.resolve();
    this.running = false;
    this.abort = null;
    this.typingTimer = null;
    this.now = o.now || Date.now;
    this.webUrl = (o.webUrl || process.env.OASIS_WEB_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '');
    this.checkinEveryMs = o.checkinEveryMs ?? 30_000;
    this.checkinTimer = null;
    this.checkinBusy = false;
    this.checkinFailedDay = null;
    this.stats = { lastPollAt: null, lastOkAt: null, lastError: null, received: 0, pinged: 0 };
  }

  // ---------------------------------------------------------------- plumbing
  redact(s) {
    let out = String(s ?? '');
    for (const t of this.tokens || []) out = out.split(t).join('<token>').split(encodeURIComponent(t)).join('<token>');
    return out;
  }

  log(...a) { this.rawLog(this.redact(`telegram: ${a.join(' ')}`)); }

  readConfig() {
    try {
      const c = JSON.parse(stripBom(fs.readFileSync(this.configFile, 'utf8')));
      const token = String(c.botToken || '').trim();
      const chatId = String(c.chatId || '').trim();
      return { ok: c.enabled !== false && !!token && !!chatId, token, chatId, nextPolls: c.pollingEnabled === true };
    } catch (e) {
      return { ok: false, token: '', chatId: '', error: e.code === 'ENOENT' ? 'no config file' : 'unreadable config' };
    }
  }

  /** Re-read the config. A file caught mid-write (the Next app writes it in place) keeps the last good one. */
  refreshConfig() {
    const next = this.readConfig();
    if (next.token) this.tokens.add(next.token);
    if (next.error === 'unreadable config' && this.cfg?.token) return this.cfg;
    this.cfg = next;
    return next;
  }

  loadState() {
    try {
      const s = JSON.parse(stripBom(fs.readFileSync(this.stateFile, 'utf8')));
      const c = s.checkin && typeof s.checkin === 'object' ? s.checkin : {};
      const checkin = {
        on: c.on !== false,
        time: parseCheckinTime(c.time) || CHECKIN_DEFAULT.time,
        lastSent: typeof c.lastSent === 'string' ? c.lastSent : null,
      };
      return { offset: Number(s.offset) || 0, pings: s.pings !== false, checkin };
    } catch { return { offset: 0, pings: true, checkin: { ...CHECKIN_DEFAULT } }; }
  }

  saveState() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ offset: this.state.offset, pings: this.state.pings, checkin: this.state.checkin, updatedAt: new Date().toISOString() }, null, 2));
      fs.renameSync(tmp, this.stateFile);
    } catch (e) { this.log(`saving ${this.stateFile} failed: ${e.message}`); }
  }

  async api(method, params = {}, { timeoutMs = 30_000, signal } = {}) {
    const url = `${this.apiBase}/bot${this.cfg.token}/${method}`;
    const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.any(signals) });
    } catch (e) {
      throw new Error(this.redact(`${method}: ${e.name === 'TimeoutError' ? 'timed out' : e.name === 'AbortError' ? 'stopped' : e.cause?.code || e.message}`));
    }
    return this.parse(method, res);
  }

  async parse(method, res) {
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (data.ok) return data.result;
    const err = new Error(this.redact(`${method}: ${data.description || `HTTP ${res.status}`}`));
    err.code = data.error_code || res.status;
    err.retryAfter = data.parameters?.retry_after || 0;
    throw err;
  }

  async upload(method, field, filePath, extra = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') form.append(k, String(v));
    form.append(field, new Blob([await fsp.readFile(filePath)]), path.basename(filePath));
    let res;
    try {
      res = await fetch(`${this.apiBase}/bot${this.cfg.token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    } catch (e) { throw new Error(this.redact(`${method}: ${e.message}`)); }
    return this.parse(method, res);
  }

  /** Everything outgoing goes through one queue, so messages arrive in the order they were made. */
  queue(job) {
    const run = this.outbox.then(async () => {
      if (!this.cfg.ok) throw new Error('not sent: the bot config is off (enabled, botToken, chatId)');
      for (let attempt = 1; ; attempt++) {
        try { return await job(); } catch (e) {
          if (e.code === 429 && e.retryAfter && attempt <= 3) { await sleep(e.retryAfter * 1000); continue; }
          // No code = the network or a timeout; 5xx = Telegram's side. A reply is worth two more tries.
          if ((!e.code || e.code >= 500) && attempt < 3) { await sleep(attempt * 2000); continue; }
          throw e;
        }
      }
    });
    this.outbox = run.catch((e) => this.log(`send failed: ${e.message}`));
    return run;
  }

  /** Plain text to the owner, split if long. */
  say(text) {
    for (const piece of chunkText(text, TG_MAX)) {
      void this.queue(() => this.api('sendMessage', { chat_id: this.cfg.chatId, text: piece, link_preview_options: { is_disabled: true } }));
    }
  }

  /**
   * Plain text sent exactly as given (cut only at 4096, nothing trimmed). Resolves to the highest message id Telegram
   * gave its pieces once it has all of them (ids in a private chat only rise, so this is "after this, he has read it");
   * 0 when any piece did not go out.
   */
  async sayAsync(text) {
    try {
      const sent = await Promise.all(splitExact(text, TG_MAX).map((piece) => this.queue(() => this.api('sendMessage', { chat_id: this.cfg.chatId, text: piece, link_preview_options: { is_disabled: true } }))));
      return Math.max(0, ...sent.map((r) => Number(r?.message_id) || 0));
    } catch { return 0; }
  }

  /** An agent's markdown: HTML mode where it parses, plain text where it doesn't. `head` (a name) goes in front, bold. */
  sayMarkdown(md, head = '') {
    chunkText(md, CHUNK).forEach((piece, i) => {
      const lead = i === 0 && head;
      const html = `${lead ? `<b>${escapeHtml(head)}</b>\n` : ''}${mdToHtml(piece)}`;
      const plain = `${lead ? `${head}:\n` : ''}${piece}`;
      void this.queue(async () => {
        const base = { chat_id: this.cfg.chatId, link_preview_options: { is_disabled: true } };
        if (html.length <= TG_MAX) {
          try { return await this.api('sendMessage', { ...base, text: html, parse_mode: 'HTML' }); } catch (e) {
            if (e.code !== 400) throw e;
          }
        }
        return this.api('sendMessage', { ...base, text: plain.slice(0, TG_MAX) });
      });
    });
  }

  /** A file an agent sent: pictures as photos (a document if Telegram refuses the photo), the rest as documents. */
  sendFile(f) {
    return this.queue(async () => {
      const known = this.fileFor(f.id);
      if (!known) return this.api('sendMessage', { chat_id: this.cfg.chatId, text: `(file no longer available: ${f.name})` });
      let size = 0;
      try { size = (await fsp.stat(known.path)).size; } catch { return this.api('sendMessage', { chat_id: this.cfg.chatId, text: `(file is gone: ${f.name})` }); }
      const caption = f.caption ? String(f.caption).slice(0, 1000) : undefined;
      if (known.isImage && size <= PHOTO_MAX) {
        try { return await this.upload('sendPhoto', 'photo', known.path, { chat_id: this.cfg.chatId, caption }); } catch (e) {
          if (e.code !== 400) throw e;
        }
      }
      if (size > DOC_MAX) return this.api('sendMessage', { chat_id: this.cfg.chatId, text: `(${f.name} is ${Math.round(size / 1e6)} MB, too big for Telegram)` });
      return this.upload('sendDocument', 'document', known.path, { chat_id: this.cfg.chatId, caption });
    });
  }

  // ---------------------------------------------------------------- polling
  start() {
    if (this.running) return this;
    this.running = true;
    // Agents that owed a reply here when the last run stopped: the next message they take in (the carry-on note,
    // or the owner's own message going out again) is answered on Telegram.
    const owing = new Set([...(this.journal?.owed() || []), ...(this.journal?.agentsWithSource('tg:') || [])]);
    for (const id of owing) this.turn(id).rearm = Date.now();
    this.abort = new AbortController();
    void this.loop();
    if (this.checkinEveryMs > 0) {
      this.checkinTimer = setInterval(() => void this.checkinTick(), this.checkinEveryMs);
      this.checkinTimer.unref?.();
    }
    if (this.presenceEveryMs > 0) {
      this.presenceTimer = setInterval(() => { if (this.pages()) void this.sampleActivity(); }, this.presenceEveryMs);
      this.presenceTimer.unref?.();
    }
    return this;
  }

  stop() {
    this.running = false;
    this.abort?.abort();
    clearInterval(this.typingTimer);
    this.typingTimer = null;
    clearInterval(this.checkinTimer);
    this.checkinTimer = null;
    clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    clearTimeout(this.batchTimer);
    this.batchTimer = null;
    for (const p of this.pings.values()) clearTimeout(p.timer);
  }

  // ---------------------------------------------------------------- the daily check-in
  /** The Mindcraft work counter's snapshot from the Next app (local only). Throws when it isn't there. */
  async fetchWork() {
    let res;
    try {
      res = await fetch(`${this.webUrl}/api/village/work`, { signal: AbortSignal.timeout(10_000) });
    } catch (e) { throw new Error(`the Oasis page server is not reachable (${e.cause?.code || e.name})`); }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== 'object' || !data.today || !data.date) throw new Error(`the work counter answered ${res.status}${data?.error ? `: ${String(data.error).slice(0, 120)}` : ''}`);
    return data;
  }

  /** Text and send; resolves once Telegram has it (throws if it never got there). */
  async sendCheckin(now = this.now()) {
    const text = checkinText(await this.fetchWork(), now);
    await Promise.all(chunkText(text, TG_MAX).map((piece) => this.queue(() => this.api('sendMessage', { chat_id: this.cfg.chatId, text: piece, link_preview_options: { is_disabled: true } }))));
    return text;
  }

  /**
   * Every 30 s: past today's time and not sent today -> send it, then remember the day in the state file (so a restart
   * never sends it twice). The Next app or the counter not answering: skipped quietly (logged once a day) and tried
   * again on the next tick, until midnight.
   */
  async checkinTick(now = this.now()) {
    const c = this.state.checkin;
    const date = checkinDue(now, c);
    if (!date || this.checkinBusy || !this.cfg.ok) return false;
    this.checkinBusy = true;
    try {
      await this.sendCheckin(now);
      c.lastSent = date;
      this.saveState();
      this.log(`check-in sent for ${date}`);
      return true;
    } catch (e) {
      if (this.checkinFailedDay !== date) this.log(`check-in for ${date} waits: ${e.message}`);
      this.checkinFailedDay = date;
      return false;
    } finally {
      this.checkinBusy = false;
    }
  }

  checkinStatus(now = this.now()) {
    const c = this.state.checkin;
    if (!c.on) return `Check-in is off. /checkin on brings back the ${c.time} sum-up.`;
    const sentToday = c.lastSent === localDate(now);
    const due = checkinDue(now, c);
    return `Check-in is on, every day at ${c.time}. ${sentToday ? "Today's is sent; next one tomorrow." : due ? "Today's is on its way." : `Next: today at ${c.time}.`}`;
  }

  async loop() {
    let backoff = 1000;
    let said409 = false;
    this.log(`polling (pings ${this.state.pings ? 'on' : 'off'}, offset ${this.state.offset || 'none'})`);
    while (this.running) {
      this.refreshConfig();
      if (!this.cfg.ok) {
        this.stats.lastError = this.cfg.error || 'disabled in the config (enabled, botToken, chatId)';
        await sleep(30_000, this.abort.signal);
        continue;
      }
      if (!this.leftDone) {
        this.leftDone = true;
        await this.handleLeft();
      }
      try {
        this.stats.lastPollAt = Date.now();
        const params = { timeout: this.pollTimeoutS, allowed_updates: ['message'] };
        if (this.state.offset) params.offset = this.state.offset;
        const updates = await this.api('getUpdates', params, { timeoutMs: (this.pollTimeoutS + 15) * 1000, signal: this.abort.signal });
        this.stats.lastOkAt = Date.now();
        this.stats.lastError = null;
        backoff = 1000;
        said409 = false;
        for (const u of updates || []) {
          // Confirm first (the bot never gives it out again), but keep it in the journal until it is handled: a
          // restart in between handles it at the next start, twice at most (a message that crashes its handler
          // is not tried again at every restart).
          this.journal?.telegramTook(u);
          this.state.offset = u.update_id + 1;
          this.saveState();
          try { await this.onUpdate(u); } catch (e) { this.log(`update ${u.update_id} failed: ${e.message}`); }
          this.journal?.telegramHandled(u.update_id);
        }
      } catch (e) {
        if (!this.running) break;
        this.stats.lastError = e.message;
        if (e.code === 409) {
          // Another getUpdates consumer (the Next app with pollingEnabled, the old sidecar) or a webhook.
          if (!said409) this.log(`${e.message}: another poller or a webhook holds this bot${this.cfg.nextPolls ? ' (pollingEnabled is true in the config: the Next app polls too)' : ''}; retrying every 30 s`);
          said409 = true;
          await sleep(30_000, this.abort.signal);
        } else {
          this.log(`poll error: ${e.message}; retry in ${Math.round(backoff / 1000)} s`);
          await sleep(backoff, this.abort.signal);
          backoff = Math.min(backoff * 2, 60_000);
        }
      }
    }
  }

  /** Updates the last run took from the bot but did not finish handling (the engine stopped in between). */
  async handleLeft() {
    for (const u of this.journal?.telegramLeft() || []) {
      const id = u.update_id;
      if ((u.tries || 0) >= 2) this.log(`update ${id} given up on: two starts did not get through it`);
      else if (this.journal.hasSource(`tg:${id}`)) { /* already with its agent: that queue delivers it */ }
      else {
        this.log(`update ${id} was taken before the restart and not handled: handling it now`);
        try { await this.onUpdate(u); } catch (e) { this.log(`update ${id} failed: ${e.message}`); }
      }
      this.journal.telegramHandled(id);
    }
  }

  async onUpdate(u) {
    const m = u.message;
    if (!m) return;
    if (String(m.chat?.id) !== this.cfg.chatId) {
      this.log(`ignored a message from chat ${m.chat?.id} (${m.from?.username || 'no username'})`);
      return;
    }
    this.stats.received++;
    const sentAt = (m.date || 0) * 1000;
    const late = sentAt && Date.now() - sentAt > 10 * 60_000 ? sentAt : 0;
    // What may answer an agent's request (decide()): the configured chat is a private chat, and its owner wrote this
    // himself (Telegram's own `from`), not a bot, not a message forwarded from elsewhere. Only `message` updates are
    // asked for (no edited messages, channel posts or button callbacks), so nothing else can carry an answer.
    const ctx = {
      messageId: Number(m.message_id) || 0,
      verified: m.chat?.type === 'private' && String(m.from?.id) === this.cfg.chatId && m.from?.is_bot !== true && !m.via_bot,
      forwarded: Boolean(m.forward_origin || m.forward_date || m.forward_from || m.forward_from_chat),
    };
    if (m.voice || m.audio || m.video_note) return this.onVoice(m, late, u.update_id, ctx);
    const text = m.text ?? m.caption;
    if (!text) { this.say('I can take text and voice notes for now.'); return; }
    return this.handleText(text, { late, updateId: u.update_id, ...ctx });
  }

  async onVoice(m, late, updateId, ctx = {}) {
    const v = m.voice || m.audio || m.video_note;
    const key = this.scribeKey();
    if (!key) { this.say("Voice notes aren't wired yet (no ElevenLabs key)."); return; }
    if (v.file_size > VOICE_MAX) { this.say('That voice note is too long for me (20 MB at most).'); return; }
    let text;
    try {
      const file = await this.api('getFile', { file_id: v.file_id });
      const res = await fetch(`${this.apiBase}/file/bot${this.cfg.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      text = await this.transcribe(audio, path.basename(file.file_path || 'voice.ogg'), v.mime_type || 'audio/ogg', key);
    } catch (e) {
      this.log(`voice note failed: ${e.message}`);
      this.say(`I couldn't transcribe that voice note (${this.redact(e.message).slice(0, 200)}).`);
      return;
    }
    if (!text) { this.say("Heard nothing I could make out."); return; }
    this.say(`heard: ${text.length > 300 ? `${text.slice(0, 299)}…` : text}`);
    return this.handleText(text, { voice: true, late, updateId, ...ctx });
  }

  /** ElevenLabs Scribe (scribe_v2, as in C:/8f_dirk/scribe.py), with the village's names as key terms. */
  async transcribe(audio, name, mime, key) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('tag_audio_events', 'false');
    const terms = new Set(['Anorak', 'Oasis']);
    for (const a of this.listAgents()) if (a.name && a.name.length <= 40) terms.add(a.name);
    for (const t of [...terms].slice(0, 40)) form.append('keyterms', t);
    form.append('file', new Blob([audio], { type: mime }), name);
    const res = await fetch(this.scribeApi, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(120_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Scribe ${res.status}: ${String(data?.detail?.message || data?.detail || '').slice(0, 160)}`);
    return String(data.text || '').trim();
  }

  // ---------------------------------------------------------------- routing
  async handleText(text, { voice = false, late = 0, updateId = null, verified = false, forwarded = false, messageId = 0 } = {}) {
    const agents = this.listAgents();
    const r = parseRoute(text, agents);
    const ctx = { voice, verified, forwarded, messageId };
    switch (r.kind) {
      case 'empty': return undefined;
      case 'command': return this.onCommand(r.command, r.arg, agents);
      case 'unknown': return this.say(`No agent called "${r.name}". Here's who's around:\n${agentListText(agents)}`);
      case 'ambiguous': return this.say(`"${r.name}" could be ${r.matches.map((a) => a.name).join(' or ')}. Here's who's around:\n${agentListText(agents)}`);
      case 'agent': {
        // "Perf: allow" answers Perf's open request; with none open it is an ordinary message to Perf.
        const d = parseDecision(r.text);
        if (d && await this.decide(r.agent, d, ctx)) return undefined;
        return this.deliver(r.agent, r.text, { voice, late, updateId });
      }
      default: {
        // A bare "allow" is for the one agent that waits; with several waiting, a name is needed.
        const d = parseDecision(r.text);
        if (d) {
          const waiting = agents.filter((a) => a.permissions?.length);
          if (waiting.length > 1) return this.say(`More than one is waiting (${waiting.map((a) => a.name).join(', ')}). Say which: "${handle(waiting[0].name)}: ${r.text}".`);
          if (waiting.length === 1 && await this.decide(waiting[0], d, ctx)) return undefined;
        }
        const anorak = defaultAgent(agents);
        if (!anorak) return this.say(`Anorak isn't in the village right now. Name someone ("Tyler: ...").\n${agentListText(agents)}`);
        return this.deliver(anorak, r.text, { voice, late, updateId });
      }
    }
  }

  async onCommand(command, arg, agents) {
    switch (command) {
      case 'agents': return this.say(agentListText(agents));
      case 'start': case 'help': return this.say(HELP);
      case 'checkin': case 'check_in': {
        const c = this.state.checkin;
        if (/^now$/i.test(arg)) {
          // A preview: today's numbers right now. The evening one still goes out at its time.
          try { await this.sendCheckin(); } catch (e) { this.say(`No check-in right now: ${e.message}.`); }
          return undefined;
        }
        if (/^(on|off|yes|no)$/i.test(arg)) c.on = /^(on|yes)$/i.test(arg);
        else if (arg) {
          const time = parseCheckinTime(arg);
          if (!time) return this.say('A time like 21:30, please (or /checkin on, off, now).');
          c.time = time;
        }
        if (arg) { this.saveState(); this.log(`check-in ${c.on ? `on at ${c.time}` : 'off'} (from Telegram)`); }
        return this.say(this.checkinStatus());
      }
      case 'pings': {
        if (/^(on|off|yes|no|1|0)$/i.test(arg)) {
          this.state.pings = /^(on|yes|1)$/i.test(arg);
          this.saveState();
          this.log(`pings ${this.state.pings ? 'on' : 'off'} (from Telegram)`);
        }
        return this.say(`Pings are ${this.state.pings ? 'on' : 'off'}: ${this.state.pings ? 'I write when an agent waits for you (amber) or is stuck (red) for 2 minutes.' : 'nothing unless you write first.'}`);
      }
      case 'stop': {
        const target = (arg ? findAgents(arg, agents) : [defaultAgent(agents)]).filter((a) => a?.kind === 'owned');
        if (target.length !== 1) return this.say(arg ? `No single agent called "${arg}" that I can stop.` : 'Stop whom? /stop <name>');
        if (!this.interruptAgent) return this.say('Interrupting is not wired here.');
        try {
          const r = await this.interruptAgent(target[0].id);
          return this.say(r?.ok === false ? `Could not interrupt ${target[0].name}: ${r.error}` : `Interrupted ${target[0].name}.`);
        } catch (e) { return this.say(`Could not interrupt ${target[0].name}: ${e.message}`); }
      }
      default: return this.say(`Unknown command /${command}.\n\n${HELP}`);
    }
  }

  turn(agentId) {
    let t = this.turns.get(agentId);
    if (!t) this.turns.set(agentId, (t = { name: agentId, expect: new Set(), uuids: new Set(), bridge: [], armed: false, rearm: 0, finalText: '', files: [], captions: new Map(), repliedAt: 0, since: 0 }));
    return t;
  }

  /** Who owes a reply here right now, kept in the journal so a restart does not forget it. */
  syncOwed() {
    if (!this.journal) return;
    const now = Date.now();
    this.journal.setOwed([...this.turns].filter(([, t]) => t.armed || t.uuids.size || t.expect.size || t.bridge.length || (t.rearm && now - t.rearm < REARM_MS)).map(([id]) => id));
  }

  async deliver(agent, text, { voice = false, late = 0, updateId = null } = {}) {
    if (!canTalk(agent)) return this.say(`${agent.name} runs somewhere else without the Oasis plugin; I can only watch it.`);
    const tag = `[Telegram${voice ? ' voice note' : ''}${late ? `, sent ${hhmm(late)}` : ''}]`;
    const tagged = `${tag} ${text}`;
    const t = this.turn(agent.id);
    t.name = agent.name;
    t.expect.add(tagged);
    try {
      const res = await this.sendToAgent(agent.id, tagged, updateId != null ? { source: `tg:${updateId}` } : undefined);
      if (res?.uuid && t.expect.has(tagged)) { t.expect.delete(tagged); t.uuids.add(res.uuid); }
      if (res?.viaBridge) { t.expect.delete(tagged); t.bridge.push({ text: tagged, at: Date.now() }); }
      t.since = Date.now();
      this.log(`-> ${agent.name}: ${text.length} chars${voice ? ' (voice)' : ''}`);
      this.typing();
    } catch (e) {
      t.expect.delete(tagged);
      // While the engine closes, the agent's journal keeps the message and the next start delivers it.
      if (this.running) this.say(`Not delivered to ${agent.name}: ${e.message}`);
    }
    this.syncOwed();
  }

  /** "typing…" in the chat while an agent works on a Telegram message (Telegram shows it for about 5 s per call). */
  typing() {
    const busy = () => [...this.turns.values()].some((t) => (t.armed || t.uuids.size || t.bridge.length) && Date.now() - t.since < TYPING_MAX_MS);
    const tick = () => {
      this.sweepBridge();
      if (!busy() || !this.running) { clearInterval(this.typingTimer); this.typingTimer = null; return; }
      void this.api('sendChatAction', { chat_id: this.cfg.chatId, action: 'typing' }).catch(() => {});
    };
    if (!this.typingTimer && busy()) { tick(); this.typingTimer = setInterval(tick, 4500); this.typingTimer.unref?.(); }
  }

  /**
   * Messages for a bridged session wait in bridge.js until its mod collects them (dropped after a minute there). One the
   * session went away from is lost: say so. One still unseen after TYPING_MAX_MS is forgotten the same way.
   */
  sweepBridge(now = Date.now()) {
    for (const [id, t] of this.turns) {
      if (!t.bridge.length) continue;
      const a = this.listAgents().find((x) => x.id === id);
      const lost = t.bridge.filter((b) => (now - b.at > 65_000 && !a?.bridged) || now - b.at > TYPING_MAX_MS);
      if (!lost.length) continue;
      t.bridge = t.bridge.filter((b) => !lost.includes(b));
      this.say(`${t.name} never picked up your message${lost.length > 1 ? 's' : ''} (the session went away).`);
    }
  }

  // ---------------------------------------------------------------- engine events
  /** Every hub event passes through here (index.js). Never throws. */
  onEvent(e) {
    try { this.handleEvent(e); } catch (err) { this.log(`event ${e?.kind} failed: ${err.message}`); }
  }

  handleEvent(e) {
    if (!e || e.history || e.kind === 'text.delta') return;
    this.handleAgentEvent(e);
    if (this.turns.size || e.kind === 'removed') this.syncOwed();
  }

  handleAgentEvent(e) {
    const id = e.agentId;
    if (e.kind === 'removed') {
      const gone = this.turns.get(id);
      if (gone && (gone.armed || gone.uuids.size || gone.bridge.length)) this.say(`${gone.name} was stopped or moved before answering your message.`);
      clearTimeout(this.pings.get(id)?.timer);
      this.batch.delete(id);
      for (const [rid, s] of this.shown) if (s.agentId === id) this.shown.delete(rid);
      this.pings.delete(id); this.turns.delete(id); this.lastText.delete(id); this.lastTurnEnd.delete(id);
      return;
    }
    if (e.kind === 'permission.resolved' && e.requestId) this.shown.delete(e.requestId);
    if (e.kind === 'status') return this.onStatus(id, e.status);
    if (e.kind === 'text' && !e.parentToolUseId) this.lastText.set(id, stripSpoken(e.text || ''));
    if (e.kind === 'turn.end') this.lastTurnEnd.set(id, e);
    const t = this.turns.get(id);
    if (!t) return;
    switch (e.kind) {
      case 'user.sent':
        if (t.expect.delete(e.text)) t.uuids.add(e.uuid);
        // A wake-up from the agent's schedule is not the owner writing: its turn is not answered here.
        if (e.auto === 'schedule') (t.scheduled ||= new Set()).add(e.uuid);
        return;
      case 'user.consumed':
        if (t.scheduled?.delete(e.uuid)) return;
        // Back from a restart, owing a reply here: the first message it takes in (the carry-on note, or the
        // owner's message going out again) starts the turn that answers on Telegram.
        if (t.rearm) {
          const fresh = Date.now() - t.rearm < REARM_MS;
          t.rearm = 0;
          if (fresh && !e.dropped) {
            t.uuids.delete(e.uuid);
            t.name = this.nameOf(id);
            t.since = Date.now();
            if (!t.armed) { t.armed = true; t.finalText = ''; t.files = []; }
            this.typing();
            return;
          }
        }
        if (!t.uuids.delete(e.uuid)) return;
        if (e.dropped) this.say(`${t.name} never took your message (${e.dropped}).`);
        else if (!t.armed) { t.armed = true; t.finalText = ''; t.files = []; }
        return;
      case 'user': {
        // A bridged session: its transcript shows our prompt once the mod has submitted it. Other prompts (the owner
        // typing at the desk, a task notification) don't arm; ours folded into a turn that is already armed just
        // leaves the queue.
        const seen = t.bridge.find((b) => typeof e.text === 'string' && e.text.includes(b.text.slice(0, 120)));
        if (!seen) return;
        t.bridge = t.bridge.filter((b) => b !== seen);
        if (!t.armed) { t.armed = true; t.finalText = ''; t.files = []; }
        return;
      }
      case 'text':
        if (t.armed && !e.parentToolUseId) t.finalText = stripSpoken(e.text || '');
        return;
      case 'tool.start':
        if (t.armed && e.name === 'SendUserFile' && e.input?.caption) t.captions.set(e.toolUseId, String(e.input.caption));
        return;
      case 'tool.end':
        if (t.armed && e.name === 'SendUserFile' && Array.isArray(e.attachments)) {
          const caption = t.captions.get(e.toolUseId);
          t.captions.delete(e.toolUseId);
          for (const f of e.attachments) t.files.push({ ...f, caption });
        }
        return;
      case 'turn.end':
        // Refused for usage: not the answer. The engine moves the agent to another account and the turn runs again;
        // that one answers here (the agent stays armed).
        if (e.limit) { t.finalText = ''; t.files = []; return; }
        if (t.armed) this.reply(id, e, t);
        return;
      case 'exit':
        // The engine itself is closing: the agent is resumed at the next start and answers then.
        if (!this.running) return;
        // Moving to another Claude account (accounts.js): the same session goes on in a moment.
        if (e.switching) return;
        if (t.armed || t.uuids.size) {
          this.say(`${t.name} stopped before answering${e.code != null ? ` (exit code ${e.code})` : ''}.`);
          t.armed = false; t.uuids.clear(); t.repliedAt = Date.now();
        }
        return;
      default:
    }
  }

  nameOf(id) { return this.listAgents().find((a) => a.id === id)?.name || id; }

  reply(id, end, t) {
    const name = this.nameOf(id);
    let body = t.finalText || end.result || '';
    if (end.reason === 'interrupted') body = `${body ? `${body}\n\n` : ''}(interrupted)`;
    else if (end.outcome === 'error') body = `${body ? `${body}\n\n` : ''}⚠ the turn ended with an error: ${end.reason || end.subtype || 'error'}`;
    const files = t.files;
    t.armed = false; t.finalText = ''; t.files = []; t.captions.clear();
    t.repliedAt = Date.now();
    if (!body.trim() && !files.length) body = '(done, no text)';
    const head = isAnorak({ name }) ? '' : name;
    if (body.trim()) this.sayMarkdown(body, head);
    else if (head) this.say(`${head}:`);
    for (const f of files) void this.sendFile(f).catch(() => {});
    this.log(`<- ${name}: ${body.length} chars${files.length ? `, ${files.length} file(s)` : ''}`);
  }

  // ---------------------------------------------------------------- pings
  onStatus(id, status) {
    const prev = this.pings.get(id);
    if (prev && prev.status === status) return; // same state (the reason may change): the timer keeps running
    clearTimeout(prev?.timer);
    const p = { status, since: Date.now(), timer: null };
    if (status === 'needs-decision' || status === 'error') {
      p.timer = setTimeout(() => this.firePing(id, p), this.pingMs);
      p.timer.unref?.();
    }
    this.pings.set(id, p);
  }

  firePing(id, p) {
    if (this.pings.get(id) !== p) return;
    p.timer = null;
    const a = this.listAgents().find((x) => x.id === id);
    if (!a || a.status !== p.status) return;
    const why = `${a.name} (${a.status}${a.statusReason ? `: ${a.statusReason}` : ''})`;
    // Only an open card (a permission, a question, a plan) or an error needs the owner. A reply ending with "?" or a
    // tool the CLI refused by itself does not: no ping, so nothing wakes him for it (Anorak, 22 Nov).
    if (!needsOwner(a)) return this.log(`no ping for ${why}: no card open and no error`);
    if (!this.state.pings) return this.log(`no ping for ${why}: pings are off`);
    if (!this.cfg.ok) return this.log(`no ping for ${why}: no bot config`);
    // A watched transcript replays its past when the Oasis starts watching it: an old question is not news.
    if (a.kind === 'observer' && a.lastWriteAt && a.lastWriteAt < p.since - 60_000) return this.log(`no ping for ${why}: from old transcript lines`);
    // The answer to the owner's Telegram message already went out and ended there (a question, or the error).
    const t = this.turns.get(id);
    if (t?.repliedAt && t.repliedAt >= p.since - 15_000 && !a.permissions?.length) return this.log(`no ping for ${why}: the reply is already on Telegram`);
    void this.holdOrBatch(id, p, why).catch((e) => this.log(`ping for ${why} failed: ${e.message}`));
  }

  /** The work counter's seconds, sampled: when they grow, he is working in the Oasis. A page server that doesn't answer leaves the last picture. */
  async sampleActivity(now = this.now()) {
    let w;
    try { w = await this.fetchWork(); } catch {
      // Not answering means no page is being served: never hold a ping back for it.
      this.activity.lastGrowthAt = 0;
      return this.activity;
    }
    const secs = Number(w.today?.seconds) || 0;
    const act = this.activity;
    if (act.date === w.date && secs > act.seconds) act.lastGrowthAt = now;
    act.date = w.date;
    act.seconds = secs;
    return act;
  }

  /** An Oasis page is open and he did something in the last PRESENT_MS: the marker over the agent is enough. */
  async ownerAtOasis(now = this.now()) {
    if (!this.pages()) return false;
    await this.sampleActivity(now);
    return this.activity.lastGrowthAt > 0 && now - this.activity.lastGrowthAt < this.presentMs;
  }

  /** At the ping's time: he is at the Oasis -> hold it (look again in a minute, and send it once he is away); else it joins the next message. */
  async holdOrBatch(id, p, why) {
    const present = await this.ownerAtOasis();
    if (this.pings.get(id) !== p) return;
    if (present) {
      if (!p.held) { p.held = true; this.log(`holding the ping for ${why}: an Oasis page is open and he was active in the last ${Math.round(this.presentMs / 60_000)} min`); }
      p.timer = setTimeout(() => this.firePing(id, p), this.holdMs);
      p.timer.unref?.();
      return;
    }
    this.batch.set(id, p);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => { this.batchTimer = null; void this.flushPings().catch((e) => this.log(`ping message failed: ${e.message}`)); }, this.batchMs);
      this.batchTimer.unref?.();
    }
  }

  /** The pings that came together become one message, one entry per agent. */
  async flushPings() {
    const entries = [...this.batch];
    this.batch.clear();
    const present = await this.ownerAtOasis();
    const agents = this.listAgents();
    const blocks = [];
    for (const [id, p] of entries) {
      if (this.pings.get(id) !== p) continue;
      const a = agents.find((x) => x.id === id);
      if (!a || a.status !== p.status || !needsOwner(a)) continue;
      if (present) { p.timer = setTimeout(() => this.firePing(id, p), this.holdMs); p.timer.unref?.(); continue; }
      blocks.push(this.blockFor(a));
    }
    for (const g of groupBlocks(blocks)) {
      this.stats.pinged += g.blocks.length;
      for (const b of g.blocks) this.log(`ping: ${b.agent.name} (${b.agent.status}${b.agent.statusReason ? `: ${b.agent.statusReason}` : ''})`);
      await this.announce(g);
    }
  }

  /** One agent's entry: an error, an open card he can answer here, or a state only its own window can settle. */
  blockFor(a) {
    const name = a.name || a.id;
    if (a.status === 'error') return { agent: a, text: `🔴 ${name} is stuck: ${clipLine(a.statusReason || 'an error', 300)}`, full: true, kind: 'error' };
    const reqs = Array.isArray(a.permissions) ? a.permissions : [];
    if (reqs.length) return { ...requestBlock(a, reqs[0], { more: reqs.length - 1 }), agent: a, req: reqs[0] };
    const text = pingText(a, { lastText: this.lastText.get(a.id), lastTurnEnd: this.lastTurnEnd.get(a.id) });
    return { agent: a, text: `${text}\nThat one is settled in its own window, not from here.`, full: true, kind: 'window' };
  }

  /** Send a message of entries and remember which requests it showed, and whole or in part. */
  async announce(g) {
    const msgId = await this.sayAsync(g.text);
    if (!msgId) return false;
    for (const b of g.blocks) if (b.req) this.remember(b.req.requestId, { agentId: b.agent.id, msgId, full: Boolean(b.full), noPhone: Boolean(b.noPhone), alwaysOk: b.alwaysOk !== false });
    return true;
  }

  remember(requestId, entry) {
    this.shown.set(requestId, entry);
    if (this.shown.size > 200) for (const [k] of [...this.shown].slice(0, this.shown.size - 200)) this.shown.delete(k);
  }

  // ---------------------------------------------------------------- answering an agent's request
  /** `show`: the whole request, exactly. */
  async showRequest(a, req) {
    const s = showText(a, req);
    const msgId = await this.sayAsync(`${s.head}\n\n${s.body}\n\n${s.tail}`);
    if (msgId) this.remember(req.requestId, { agentId: a.id, msgId, full: s.full, noPhone: !s.full, alwaysOk: s.alwaysOk !== false });
    return Boolean(msgId);
  }

  /** The line that says what was answered: the tool and the start of its command. */
  describeWhat(req) {
    if (req.requestKind === 'plan') return 'the plan';
    if (req.requestKind === 'question') return 'the question';
    const t = oneLineClip(requestText(req), 110);
    return `${req.toolName || 'the tool'}${t ? `: ${t}` : ''}`;
  }

  /** Shown whole, and his message came after the one that showed it (a higher message id: no clocks involved). */
  canAllow(req, messageId) {
    const s = this.shown.get(req.requestId);
    return Boolean(s && s.full && !s.noPhone && s.msgId && messageId && messageId > s.msgId);
  }

  /**
   * "Name: allow | allow always | deny | show | pick N". Returns false when Name has nothing open (then it is an ordinary
   * message). Allowing needs: his own typed message, and the request shown to him whole, before he wrote.
   */
  async decide(agent, d, ctx = {}) {
    const a = this.listAgents().find((x) => x.id === agent.id) || agent;
    const reqs = Array.isArray(a.permissions) ? a.permissions : [];
    if (!reqs.length) return false;
    const name = a.name || a.id;
    const who = handle(name);
    if (d.verb === 'show') { await this.showRequest(a, reqs[0]); return true; }
    if (!ctx.verified || ctx.forwarded || ctx.voice) {
      const why = !ctx.verified ? 'not his own private chat' : ctx.forwarded ? 'forwarded' : 'by voice';
      this.log(`refused "${d.verb}" for ${name}: ${why}`);
      this.say(!ctx.verified ? 'I only take approvals typed in your own private chat with me.'
        : ctx.forwarded ? 'A forwarded message is not an approval: type it yourself.'
          : `I don't take approvals by voice: a misheard word could allow the wrong thing. Type "${who}: ${d.verb}".`);
      return true;
    }
    if (!this.respondFn) { this.say('Answering from here is not wired in this engine.'); return true; }
    if (d.verb === 'deny') {
      const req = reqs.find((r) => this.shown.has(r.requestId)) || reqs[0];
      await this.answer(a, req, { behavior: 'deny', message: 'Denied by the owner on Telegram.' }, `🚫 ${who}: denied ${this.describeWhat(req)}`);
      return true;
    }
    if (d.verb === 'pick') {
      const req = reqs.find((r) => r.requestKind === 'question');
      const q = req && simpleQuestion(req);
      if (!req) this.say(`${name} isn't asking a question (it waits for an allow or a deny).`);
      else if (!q) this.say(`${name}'s question has several parts or several choices: answer it in the Oasis.`);
      else if (!this.canAllow(req, ctx.messageId)) await this.showFirst(a, req, ctx.messageId);
      else if (d.n < 1 || d.n > q.options.length) this.say(`Pick a number from 1 to ${q.options.length}.`);
      else {
        const label = q.options[d.n - 1].label;
        await this.answer(a, req, { behavior: 'allow', answers: { [req.input.questions[0].question]: label } }, `✅ ${who}: answered "${label}"`);
      }
      return true;
    }
    // allow / allow always
    const open = reqs.filter((r) => r.requestKind !== 'question');
    if (!open.length) { this.say(`${name} asks a question, not for permission. Reply "${who}: pick 1" (or the number you choose), or answer it in the Oasis.`); return true; }
    const req = open.find((r) => this.canAllow(r, ctx.messageId));
    if (!req) { await this.showFirst(a, open[0], ctx.messageId); return true; }
    if (d.always && suggestionProblem(req.suggestions)) {
      this.say(`"allow always" is not offered for ${name}'s request (${suggestionProblem(req.suggestions)}). "${who}: allow" allows it once.`);
      return true;
    }
    if (d.always && describeSuggestions(req.suggestions) && this.shown.get(req.requestId)?.alwaysOk === false) {
      this.say(`"allow always" was not shown to you whole for this request. "${who}: allow" allows it once.`);
      return true;
    }
    const standing = d.always ? describeSuggestions(req.suggestions) : null;
    const what = this.describeWhat(req);
    await this.answer(a, req, { behavior: 'allow', always: Boolean(standing) },
      d.always && !standing ? `✅ ${who}: allowed ${what} once (no standing rule was offered for it)`
        : `✅ ${who}: allowed ${what}${standing ? `, and always: ${standing}` : ' (this once)'}`);
    return true;
  }

  /** "allow" met a request he has not been shown whole (or since before he wrote): show it, never allow it. */
  async showFirst(a, req, messageId) {
    const who = handle(a.name || a.id);
    const s = this.shown.get(req.requestId);
    if (s && !s.full) {
      this.say(s.noPhone ? `${a.name}'s request can't be checked on a phone ("${who}: show" says why): decide it in the Oasis, or "${who}: deny".` : `You have seen only the first part of ${a.name}'s request. "${who}: show" sends the rest.`);
    } else if (s && !(messageId && messageId > s.msgId)) {
      this.say(`That was written before I showed you this request. Look at it again, then send it again.`);
    } else {
      const b = requestBlock(a, req);
      await this.announce({ text: `${b.text}\n\nI had not shown you this one yet. Look it over, then answer.`, blocks: [{ ...b, agent: a, req }] });
    }
  }

  /** Answer through the engine and say in one line what was done; if more wait on the same agent, show the next. */
  async answer(a, req, opts, line) {
    const who = handle(a.name || a.id);
    try {
      await this.respondFn(a.id, req.requestId, opts);
    } catch (e) {
      this.say(/no pending request/.test(e.message) ? `${a.name}'s request was already answered (in the Oasis?).` : `Could not answer ${a.name}: ${e.message}`);
      this.shown.delete(req.requestId);
      return;
    }
    this.shown.delete(req.requestId);
    const after = (this.listAgents().find((x) => x.id === a.id)?.permissions) || [];
    this.say(`${line}${after.length ? ` · ${after.length} more waiting for ${who}` : ''}.`);
    this.log(`answered ${a.name}: ${opts.behavior}${opts.always ? ' always' : ''}${opts.answers ? ' (pick)' : ''}`);
    if (after.length) {
      const fresh = this.listAgents().find((x) => x.id === a.id) || a;
      const b = { ...requestBlock(fresh, after[0], { more: after.length - 1 }), agent: fresh, req: after[0] };
      await this.announce({ text: b.text, blocks: [b] });
    }
  }

  // ---------------------------------------------------------------- an agent tells the owner
  /**
   * An agent writes to the owner on its own (scripts/tell.mjs, the engine's tellOwner command): for what truly needs
   * him now, from a scheduled wake-up above all. Its name goes first, so he can answer "Name: …". At most one per
   * agent every TELL_GAP_MS: the rest is refused, with when it may write again.
   */
  tell(agentId, name, text) {
    const body = String(text || '').trim();
    if (!body) throw new Error('empty message');
    if (!this.cfg.ok) throw new Error('the Telegram line is off (no bot config)');
    const now = Date.now();
    const last = this.told.get(agentId) || 0;
    if (now - last < TELL_GAP_MS) throw new Error(`already told the owner at ${hhmm(last)}: once is enough (again from ${hhmm(last + TELL_GAP_MS)})`);
    this.told.set(agentId, now);
    this.sayMarkdown(`${body.slice(0, 3500)}\n\n(Answer with "${name}: …")`, name);
    this.log(`${name} told the owner (${body.length} chars)`);
    return { ok: true, at: now };
  }

  // ---------------------------------------------------------------- engine command
  /** `{cmd:"telegram"}`: status. `pings: true|false`, `checkin: true|false`, `checkinTime: "21:30"` change them. */
  command({ pings, checkin, checkinTime } = {}) {
    if (typeof pings === 'boolean') { this.state.pings = pings; this.saveState(); this.log(`pings ${pings ? 'on' : 'off'}`); }
    const time = checkinTime != null ? parseCheckinTime(checkinTime) : null;
    if (checkinTime != null && !time) return { ok: false, error: 'checkinTime: a time like 21:30' };
    if (typeof checkin === 'boolean' || time) {
      if (typeof checkin === 'boolean') this.state.checkin.on = checkin;
      if (time) this.state.checkin.time = time;
      this.saveState();
      this.log(`check-in ${this.state.checkin.on ? `on at ${this.state.checkin.time}` : 'off'}`);
    }
    return {
      enabled: true, polling: this.running, configOk: this.cfg.ok, chatId: this.cfg.chatId || null,
      nextAppAlsoPolls: !!this.cfg.nextPolls, pings: this.state.pings, checkin: { ...this.state.checkin }, offset: this.state.offset,
      presence: { pages: this.pages(), lastActiveAt: this.activity.lastGrowthAt || null, atOasis: Boolean(this.pages() && this.activity.lastGrowthAt && this.now() - this.activity.lastGrowthAt < this.presentMs) },
      waitingToPing: this.batch.size, ...this.stats,
    };
  }
}

/**
 * The engine's Telegram line, or null when it should stay off: test engines (any port but 4530) unless OASIS_TELEGRAM=1,
 * OASIS_TELEGRAM=0, or no usable bot config. Paths and the API base can be overridden for tests.
 */
export function startTelegram({ port, root, log, listAgents, send, interrupt, respond, pages, journal = null }) {
  const flag = process.env.OASIS_TELEGRAM;
  if (flag === '0' || (flag !== '1' && Number(port) !== 4530)) return null;
  const line = new TelegramLine({
    configFile: process.env.OASIS_TELEGRAM_CONFIG || path.join(root, 'data', 'anorak-pro-telegram.local.json'),
    stateFile: process.env.OASIS_TELEGRAM_STATE || path.join(root, 'data', 'agent-engine-telegram.local.json'),
    apiBase: process.env.OASIS_TELEGRAM_API,
    pingMs: Number(process.env.OASIS_TELEGRAM_PING_MS) || PING_MS,
    checkinEveryMs: process.env.OASIS_TELEGRAM_CHECKIN_MS != null ? Number(process.env.OASIS_TELEGRAM_CHECKIN_MS) : undefined, // 0: no timer (tests)
    batchMs: process.env.OASIS_TELEGRAM_BATCH_MS != null ? Number(process.env.OASIS_TELEGRAM_BATCH_MS) : undefined,
    presentMs: process.env.OASIS_TELEGRAM_PRESENT_MS != null ? Number(process.env.OASIS_TELEGRAM_PRESENT_MS) : undefined,
    listAgents, send, interrupt, respond, pages, log, journal,
  });
  if (!line.cfg.ok) { line.log(`off: ${line.cfg.error || 'the bot config lacks enabled, botToken or chatId'}`); return null; }
  return line.start();
}
