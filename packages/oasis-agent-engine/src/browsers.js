// Which Claude account has a Chrome to drive (26 Nov: the owner's Chrome extension was signed in to Gmail, used up;
// every agent had moved to Yahoo, where the Chrome tools were listed but no browser answered, and an upload sat stuck).
// Anthropic's docs: the extension must be signed in to the same claude.ai account (and organization) as the Claude Code
// session; several browsers may be connected and a session picks one. So each account needs a Chrome of its own, the
// extension signed in to it, the owner's hand once (one Chrome profile per account, both left open).
//
// The check: one tiny turn on the account (haiku, --chrome, only list_connected_browsers allowed), counted from the
// tool's own answer (a JSON list), not from the model's words. It lists; it never drives a browser.
import { runClaude } from './probe.js';

export const BROWSER_CHECK_EVERY_MS = Number(process.env.OASIS_BROWSER_CHECK_EVERY_MS || 30 * 60_000);
const TOOL = 'mcp__claude-in-chrome__list_connected_browsers';

/** The tool's answer -> [{ name, isLocal }] or null when it is not a list of browsers. */
export function parseBrowsers(content) {
  const text = Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('') : String(content ?? '');
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.map((b) => ({ name: String(b?.name || 'a browser'), isLocal: Boolean(b?.isLocal) })) : null;
  } catch {
    return /no browsers? (are )?connected/i.test(text) ? [] : null;
  }
}

/** One check on an account (env: accounts.js envFor). -> { ok: true, count, browsers } | { ok: false, reason } */
export function checkBrowsers(env, { timeoutMs = 120_000 } = {}) {
  let found = null;
  let refused = null;
  const ask = 'Call the tool list_connected_browsers once, then reply with only the number of browsers it listed.';
  return runClaude(env, (proc) => proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: ask }, parent_tool_use_id: null, session_id: '' })}\n`), (m, finish) => {
    if (m.type === 'user') for (const b of m.message?.content || []) if (b?.type === 'tool_result') { const list = parseBrowsers(b.content); if (list) found = list; }
    const kind = m.api_error || m.message?.api_error;
    if (kind === 'usage_limit_reached' || kind === 'model_requires_usage_credits') refused = kind;
    if (m.type === 'result') {
      if (found) return finish({ ok: true, count: found.length, browsers: found });
      finish({ ok: false, reason: refused ? 'the account is out of usage' : String(m.is_error ? (m.result || 'error') : 'the tool did not answer').slice(0, 160) });
    }
  }, timeoutMs, ['--model', 'haiku', '--chrome', '--allowedTools', `${TOOL},ToolSearch`, '--strict-mcp-config', '--disable-slash-commands'])
    .then((r) => r || { ok: false, reason: 'no answer (timeout or the CLI did not start)' });
}

/** The card's words: "Chrome: connected", "Chrome: none connected", "Chrome: not checked yet (…)". */
export function browserLine(state) {
  if (!state) return null;
  if (state.count > 0) return `Chrome: connected${state.count > 1 ? ` (${state.count} browsers)` : ''}`;
  if (state.count === 0) return 'Chrome: none connected (sign the Claude extension in to this account in a Chrome profile of its own)';
  return `Chrome: not known (${state.reason || 'not checked yet'})`;
}
