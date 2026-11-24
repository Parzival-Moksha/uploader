// Approvals over Telegram: a "needs you" message the owner can act on. Pure text and parsing, no network (telegram.js
// sends, remembers what was shown, and answers through the engine's `respond`).
//
// The rules this file serves (Anorak for the owner, 24 Nov 2026):
//   - "Perf: allow", "Perf: deny", "Perf: allow always", "Perf: show" answer the request an agent waits on.
//   - He never allows what he saw only in part: the message carries the whole request up to INLINE_MAX characters; a
//     longer one says so, and "show" sends all of it (up to SHOW_MAX; beyond that it is decided in the Oasis).
//     Every field of the tool's input is in the text, so nothing the agent asks for is hidden behind the command.
//   - "allow always" says what it would grant (the CLI's own suggestion: a rule, a mode, a folder) and where that is
//     saved, because a rule in a settings file outlives the session.
//   - A request that mode auto usually decides on its own says which mode the agent runs in.

export const INLINE_MAX = 600;
export const SHOW_MAX = 12_000;
/** A Telegram message holds 4096 characters; blocks are grouped under this and never cut. */
export const MESSAGE_MAX = 4000;
/** "allow always" is offered only when what it grants fits in this many characters (it is shown whole, never cut). */
export const SUGGEST_MAX = 400;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const val = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/**
 * The words he types, nothing looser: "allow", "allow always", "deny", "show", "pick 2" (an optional full stop or
 * exclamation mark after). "yes" and "no" are ordinary replies to an agent, never an approval.
 * -> {verb:'allow', always:boolean} | {verb:'deny'} | {verb:'show'} | {verb:'pick', n} | null
 */
export function parseDecision(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (s === 'allow') return { verb: 'allow', always: false };
  if (s === 'allow always' || s === 'always allow') return { verb: 'allow', always: true };
  if (s === 'deny') return { verb: 'deny' };
  if (s === 'show') return { verb: 'show' };
  const pick = s.match(/^pick (\d{1,2})$/);
  if (pick) return { verb: 'pick', n: Number(pick[1]) };
  return null;
}

/** How he addresses an agent: its name, cut where "Name: …" can still be typed (the route takes 40 characters before the colon). */
export function handle(name) {
  const n = String(name || '').split(':')[0].trim();
  return n.length > 30 ? n.slice(0, 30).trim() : n;
}

/** The whole request as text: the tool's main field first, then every other field of its input, one per line. */
export function requestText(req) {
  const input = req?.input && typeof req.input === 'object' && !Array.isArray(req.input) ? req.input : {};
  const tool = req?.toolName || '';
  const used = new Set();
  const take = (k) => { used.add(k); return input[k]; };
  const lines = [];
  if (tool === 'Bash' || tool === 'PowerShell') {
    if ('command' in input) lines.push(String(take('command')));
  } else if (tool === 'Write') {
    lines.push(`Write to ${val(take('file_path') ?? '?')}:`, String(take('content') ?? ''));
  } else if (tool === 'Edit') {
    lines.push(`Edit ${val(take('file_path') ?? '?')}:`, '--- old', String(take('old_string') ?? ''), '+++ new', String(take('new_string') ?? ''));
  } else if (tool === 'ExitPlanMode') {
    if ('plan' in input) lines.push(String(take('plan')));
  }
  for (const [k, v] of Object.entries(input)) {
    if (used.has(k)) continue;
    lines.push(`${k === 'description' ? 'description (the agent\'s words)' : k}: ${val(v)}`);
  }
  return lines.join('\n') || '(no details given)';
}

/**
 * What "allow always" would grant: the CLI's own suggestions (permission_suggestions). A destination other than the
 * session is a file that stays after it, and is said.
 */
export function describeSuggestions(suggestions) {
  const parts = [];
  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    if (!s || typeof s !== 'object') continue;
    const where = !s.destination || s.destination === 'session' ? 'this session' : `saved in ${s.destination}, it stays after this session`;
    if (s.type === 'setMode') parts.push(`mode ${s.mode} for ${where}`);
    else if (s.type === 'addRules' || s.type === 'replaceRules') {
      const rules = (Array.isArray(s.rules) ? s.rules : []).map((r) => (r?.ruleContent ? `${r.toolName}(${r.ruleContent})` : r?.toolName || '?')).join(', ');
      parts.push(`${s.behavior || 'allow'} ${rules || 'a rule'}, ${where}`);
    } else if (s.type === 'addDirectories') parts.push(`folder ${(Array.isArray(s.directories) ? s.directories : []).join(', ')}, ${where}`);
    else parts.push(`${s.type || 'a change'}, ${where}`);
  }
  return parts.join('; ') || null;
}

// Characters that hide or reorder text: control codes, zero-width and direction marks, the soft hyphen, the Arabic letter
// mark, the Mongolian vowel separator, line and paragraph separators, the grapheme joiner, variation selectors, the blank
// Hangul and Halfwidth fillers, and the invisible "tag" characters (U+E0000-E007F, used to smuggle text).
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
// A long run of blank lines or spaces pushes the rest of a command below what the phone shows.
const BLANK_RUN = /(?:[ \t]*\r?\n){21,}|[ \t]{200,}/;
const hiddenIn = (text) => HIDDEN.test(text) || BLANK_RUN.test(text);
const longArray = (v, depth = 0) => (Array.isArray(v) ? v.length >= 50 || v.some((x) => longArray(x, depth + 1)) : v && typeof v === 'object' && depth < 8 ? Object.values(v).some((x) => longArray(x, depth + 1)) : false);

/**
 * Why a request cannot be checked on a phone ('' when it can): too long, cut by the engine (a long string carries a
 * "… [+N chars]" mark; an array of 50 or more items is cut without one), or carrying characters that hide or reorder
 * text (zero-width, direction overrides, control codes), so that what the phone shows may not be what runs.
 */
export function phoneProblem(req, body) {
  if (body.length > SHOW_MAX) return `${body.length} characters is too long`;
  if (/… \[\+\d+ chars\]/.test(body) || longArray(req?.input)) return 'the engine had to cut it, so this is not all of it';
  if (hiddenIn(body)) return 'it contains hidden or direction-changing characters, or a long run of blank space';
  return '';
}

/** Why "allow always" cannot be offered ('' when its rule is shown whole): too long to show, or carrying hidden characters. */
export function suggestionProblem(suggestions) {
  const text = describeSuggestions(suggestions);
  if (!text) return '';
  if (text.length > SUGGEST_MAX) return 'its rule is too long to show here';
  if (hiddenIn(text)) return 'its rule contains hidden characters';
  return '';
}

/** Why the agent asks, when mode auto would usually have decided it without him; else ''. */
export function modeNote(a, req) {
  if (req?.requestKind === 'question') return '';
  const mode = a?.effectivePermissionMode || a?.permissionMode || '';
  if (mode === 'default') return 'It asks because it runs in mode default; mode auto usually decides requests like this itself.';
  if (mode === 'acceptEdits' && !EDIT_TOOLS.has(req?.toolName)) return 'It asks because mode acceptEdits only covers file edits; mode auto usually decides requests like this itself.';
  if (mode === 'auto') return 'Even in mode auto this one needs you.';
  return '';
}

/** A question card the phone can answer: one question, one choice, a few options. */
export function simpleQuestion(req) {
  const qs = Array.isArray(req?.input?.questions) ? req.input.questions : [];
  const q = qs[0];
  if (qs.length !== 1 || !q || q.multiSelect || !Array.isArray(q.options) || q.options.length < 1 || q.options.length > 9) return null;
  if (!q.options.every((o) => o && typeof o.label === 'string' && o.label)) return null;
  return { question: String(q.question || ''), options: q.options.map((o) => ({ label: o.label, description: String(o.description || '') })) };
}

/**
 * One agent's entry in a "needs you" message.
 * -> {text, full, always, kind}: `full` = everything the request holds is in `text` (so "allow" may follow at once);
 *    `always` = what "allow always" grants, as shown (null: nothing offered).
 */
export function requestBlock(a, req, { more = 0, inlineMax = INLINE_MAX } = {}) {
  const name = a.name || a.id;
  const who = handle(name);
  const kind = req.requestKind;
  const lines = [];
  let full = true;
  let always = null;
  if (kind === 'question') {
    const q = simpleQuestion(req);
    if (!q) {
      const first = req.input?.questions?.[0]?.question || 'it has a question';
      lines.push(`🟠 ${name} asks: ${clip(oneLine(first), 300)}`, 'Answer it in the Oasis (this one has several parts or several choices).');
      return { text: lines.join('\n'), full: false, always: null, kind };
    }
    lines.push(`🟠 ${name} asks: ${clip(oneLine(q.question), 400)}`);
    q.options.forEach((o, i) => lines.push(`${i + 1}. ${clip(oneLine(o.label), 100)}${o.description ? ` – ${clip(oneLine(o.description), 160)}` : ''}`));
    lines.push(`Reply "${who}: pick ${q.options.length > 1 ? `1 to ${q.options.length}` : '1'}" with your choice, or answer in the Oasis.`);
    const text = lines.join('\n');
    return { text: more > 0 ? `${text}\n+${more} more waiting after this one.` : text, full: text.length <= 1800, always: null, kind };
  }
  const body = requestText(req);
  const truncated = body.length > inlineMax;
  const problem = phoneProblem(req, body);
  full = !truncated;
  const alwaysText = describeSuggestions(req.suggestions);
  const alwaysProblem = suggestionProblem(req.suggestions);
  always = alwaysProblem ? null : alwaysText;
  lines.push(kind === 'plan' ? `🟠 ${name} wants your OK on a plan:` : `🟠 ${name} needs you: allow ${req.toolName || 'a tool'}?`);
  lines.push(truncated ? body.slice(0, inlineMax) : body);
  if (truncated) lines.push(`… ${body.length - inlineMax} more characters not shown.`);
  if (problem) lines.push(`Can't be checked on a phone: ${problem}. Decide it in the Oasis, or "${who}: deny".`);
  else if (truncated) lines.push(`"${who}: show" sends the rest; after that you can allow. "${who}: deny" says no.`);
  else {
    lines.push(`Reply "${who}: allow" · "${who}: deny"${always ? ` · "${who}: allow always" (= ${always})` : ''}`);
    if (alwaysProblem) lines.push(`"allow always" is not offered for this one (${alwaysProblem}); "${who}: allow" allows it once.`);
  }
  const note = modeNote(a, req);
  if (note) lines.push(note);
  if (more > 0) lines.push(`+${more} more waiting after this one.`);
  return { text: lines.join('\n'), full: full && !problem, always: full ? always : null, alwaysOk: !alwaysProblem, kind, noPhone: Boolean(problem) };
}

/** What `show` sends: the whole request (cut at SHOW_MAX), then how to answer. */
export function showText(a, req) {
  const name = a.name || a.id;
  const who = handle(name);
  const kind = req.requestKind;
  const q = kind === 'question' ? simpleQuestion(req) : null;
  if (kind === 'question') {
    if (!q) return { head: `${name}: the question`, body: requestText({ ...req, toolName: 'AskUserQuestion' }), tail: 'Answer this one in the Oasis.', full: false };
    const body = [q.question, ...q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` – ${o.description}` : ''}`)].join('\n');
    return { head: `${name} asks (all of it):`, body, tail: `Reply "${who}: pick 1 to ${q.options.length}".`, full: body.length <= SHOW_MAX };
  }
  const body = requestText(req);
  const alwaysProblem = suggestionProblem(req.suggestions);
  const always = alwaysProblem ? null : describeSuggestions(req.suggestions);
  const problem = phoneProblem(req, body);
  const cut = body.length > SHOW_MAX;
  return {
    head: `${name}: ${kind === 'plan' ? 'the plan' : `${req.toolName || 'tool'} request`}, all of it (${body.length} characters):`,
    body: cut ? body.slice(0, SHOW_MAX) : body,
    tail: problem
      ? `${cut ? `Cut here: ${body.length - SHOW_MAX} more characters. ` : ''}Can't be checked on a phone: ${problem}. Decide it in the Oasis, or "${who}: deny".`
      : `Reply "${who}: allow" · "${who}: deny"${always ? ` · "${who}: allow always" (= ${always})` : ''}${alwaysProblem ? `\n"allow always" is not offered for this one (${alwaysProblem}); "${who}: allow" allows it once.` : ''}`,
    full: !problem,
    always,
    alwaysOk: !alwaysProblem,
  };
}

/** Cut text into pieces of at most `max` characters, exactly: the pieces joined are the text (nothing trimmed or added). */
export function splitExact(text, max = MESSAGE_MAX) {
  const s = String(text ?? '');
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out.length ? out : [''];
}

/** Entries into messages under MESSAGE_MAX, an entry never cut; more than one agent gets a heading. */
export function groupBlocks(blocks, { max = MESSAGE_MAX } = {}) {
  const head = blocks.length > 1 ? `${blocks.length} agents need you:` : '';
  const groups = [];
  let cur = [];
  let len = head.length;
  for (const b of blocks) {
    const add = b.text.length + 2;
    if (cur.length && len + add > max) { groups.push(cur); cur = []; len = 0; }
    cur.push(b);
    len += add;
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => ({ blocks: g, text: `${i === 0 && head ? `${head}\n\n` : ''}${g.map((b) => b.text).join('\n\n')}` }));
}
