// The internet line: knowing the village is offline, holding work while it is, and noticing when it is back.
// The mission: Anorak, 21 Nov (C:/7c_oasis/docs/incidents/2026-11-21_offline-overnight.md): the PC lost its internet
// from Fri 19:26 to Sat 12:03; every running turn died with "API Error: Can't reach the API server (ENOTFOUND)", six
// scheduled wake-ups went into the dead line one after another, and nothing went on by itself until the owner spoke.
//
// The same shape as the account failover (accounts.js):
//   - know: a turn ends on a network error (networkFailureFrom: the CLI's `connection_failed`, or its "can't reach"
//     text; never a usage limit or a 529), and the engine's own check agrees (a name lookup of the API host, then a
//     HEAD to it; any HTTP answer at all means the line works). Then the village is offline, since that turn.
//   - while offline: the check runs every CHECK_EVERY_MS; no turn is started into the dead line (agent.js sendNow
//     holds messages in the journal, the scheduler holds wake-ups, one per agent).
//   - back: the agents whose turn died are resumed with a carry-on note, a few at a time (index.js), held wake-ups go
//     out once, and the owner gets one Telegram line.
// Anything else on this PC can ask the engine: GET /network -> { online, offlineSince, checkedAt, why }.
//
// Tests replace the check: OASIS_NETWORK_CHECK_FILE=<file>, whose content "down" means offline (anything else, or no
// file, online). Unit-tested in src/lib/__tests__/agent-engine-network.test.ts.
import dns from 'node:dns/promises';
import fs from 'node:fs';

export const API_HOST = 'api.anthropic.com';
/** While offline, how often the line is checked. */
export const CHECK_EVERY_MS = 60_000;
/** At most this often when someone writes to a waiting agent (a check then is worth it, a storm of them is not). */
export const CHECK_ASKED_MS = 15_000;

const NET_TEXT = /can't reach the api server|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|getaddrinfo|connection error|request timed out/i;

function textOf(msg) {
  if (typeof msg?.result === 'string') return msg.result;
  const content = msg?.message?.content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text || '').join(' ');
  return '';
}

/**
 * A message of the CLI's stream that says the network is gone: { kind, text } or null. The CLI (2.1.323) ends such a
 * turn with an assistant message and a result carrying api_error "connection_failed" (error "server_error") after its
 * own ten retries. A usage limit, a 529 or any other API error is not the network.
 */
export function networkFailureFrom(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type !== 'assistant' && msg.type !== 'result') return null;
  const kind = msg.api_error || msg.message?.api_error || null;
  if (kind === 'connection_failed') return { kind, text: textOf(msg).slice(0, 200) };
  if (kind) return null; // a typed error of another kind (usage_limit_reached, …)
  const isError = msg.type === 'result' ? msg.is_error === true : msg.is_api_error_message === true;
  if (!isError) return null;
  if (msg.api_error_status && msg.api_error_status !== 0) return null; // the server answered: not the line
  const text = textOf(msg);
  return NET_TEXT.test(text) ? { kind: 'connection_failed', text: text.slice(0, 200) } : null;
}

const timeout = (ms, what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms).unref?.());

/** The real check: can this PC look up the API host, and does the host answer at all? -> { online, why } */
export async function checkLine(host = API_HOST) {
  try {
    await Promise.race([dns.lookup(host), timeout(5000, 'name lookup')]);
  } catch (e) {
    return { online: false, why: `no name lookup for ${host} (${e.code || e.message})` };
  }
  try {
    const r = await fetch(`https://${host}/`, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return { online: true, why: `${host} answered ${r.status}` };
  } catch (e) {
    return { online: false, why: `${host} did not answer (${e.cause?.code || e.name || e.message})` };
  }
}

/** The check tests use: a file saying "down". */
export function fileCheck(file) {
  return async () => {
    let s = '';
    try { s = fs.readFileSync(file, 'utf8').trim(); } catch { s = ''; }
    return s === 'down' ? { online: false, why: 'test: the line is down' } : { online: true, why: 'test: the line is up' };
  };
}

export class Network {
  /** @param {{ check?: () => Promise<{online: boolean, why: string}>, now?: () => number, log?: (...a: any[]) => void, onChange?: (view: object) => void }} o */
  constructor(o = {}) {
    this.check = o.check || (() => checkLine());
    this.now = o.now || Date.now;
    this.log = o.log || (() => {});
    this.onChange = o.onChange || (() => {});
    this.offlineSince = null;
    this.checkedAt = null;
    this.why = null;
    this.checking = null;
    this.lastAskedAt = 0;
  }

  get offline() { return this.offlineSince !== null; }

  view() {
    return { online: !this.offline, offlineSince: this.offlineSince, checkedAt: this.checkedAt, why: this.why };
  }

  /**
   * Check the line now (one check at a time; callers share it). `since`: when it first failed, if this check finds
   * it down (a turn that died at 19:26 makes the village offline since 19:26, not since the check).
   * -> { online, why, changed: 'down' | 'up' | null, offlineFor? }
   */
  async checkNow({ since = null } = {}) {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      let r;
      try { r = await this.check(); } catch (e) { r = { online: false, why: e.message }; }
      const t = this.now();
      this.checkedAt = t;
      this.why = r.why || null;
      let changed = null;
      let offlineFor = null;
      if (!r.online && !this.offline) {
        this.offlineSince = Math.min(since ?? t, t);
        changed = 'down';
        this.log(`network: offline since ${new Date(this.offlineSince).toTimeString().slice(0, 5)} (${r.why})`);
      } else if (r.online && this.offline) {
        offlineFor = { from: this.offlineSince, to: t };
        this.offlineSince = null;
        changed = 'up';
        this.log(`network: back (offline from ${new Date(offlineFor.from).toTimeString().slice(0, 5)} to ${new Date(t).toTimeString().slice(0, 5)})`);
      }
      if (changed) this.onChange(this.view());
      return { online: r.online, why: r.why, changed, ...(offlineFor ? { offlineFor } : {}) };
    })();
    try { return await this.checking; } finally { this.checking = null; }
  }

  /** Someone wants an agent while offline: check, at most every CHECK_ASKED_MS. */
  async askedNow() {
    const t = this.now();
    if (t - this.lastAskedAt < CHECK_ASKED_MS) return null;
    this.lastAskedAt = t;
    return this.checkNow();
  }
}

/** "16 h 37 min", "12 min". */
export function spanText(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
