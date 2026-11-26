// ░▒▓ COME WHEN DONE — an agent walks to the owner when the thing he asked for is done (pure, tested) ▓▒░
// The owner, 25 Nov (relayed by Tyler and Anorak): "I told you to come to me when video X is done, and you didn't
// come... tell agents: this is important, come to me when you're finished with X, and they would come." "Come to me
// when you need me" (come-to-me.ts) only walks an agent over for a decision card or an error; finishing what he
// asked for is not "needing" him, so nothing happened. Two ways in, one file:
//   asked   he says it (in words to the agent, or the switch "come to me when this is done" under its composer):
//           the agent's next finished turn walks it to him, in whatever world he is, and its spoken line is said
//           there. Once: the ask is used up. The agent may keep it for a later turn ("not done yet": `later`).
//   coming  on its way to him (or standing in front of him) until he has opened it and closed it again, or waved it
//           off, or two hours went by. The agent can start this itself (`call`, scripts/me.mjs come "<why>"), only
//           for what he asked to be told about or what blocks him (the card's rule), and at most once in 15 minutes.
// Kept on the page server (data/village-come.local.json, come-when-done-server.ts), so every page and every agent's
// script see the same thing, and a reload keeps it.

export interface ComeAsk {
  /** When he asked (ms). A turn that ended before this is not the one he meant. */
  at: number
  /** What he is waiting for, in his words when they say ("the short"); shown on the strip. */
  what?: string
  /** The agent said its next turn end is not it yet (`later`): that one turn end is skipped. */
  hold?: boolean
}

export interface ComeTrip {
  /** Since when it is on its way (ms). */
  at: number
  /** owner: he asked for it; agent: the agent came by itself. */
  by: 'owner' | 'agent'
  /** Why, in a few words, for the strip ("the short is done"). */
  why: string
}

export interface ComeFile {
  v: 1
  version: number
  asked: Record<string, ComeAsk>
  coming: Record<string, ComeTrip>
  /** When each agent last came by itself (the 15-minute rule). */
  calls: Record<string, number>
}

export type ComeOp =
  | { op: 'ask'; agent: string; on: boolean; what?: string }
  | { op: 'later'; agent: string }
  | { op: 'done'; agent: string; turnAt: number; error?: boolean }
  | { op: 'call'; agent: string; why?: string }
  | { op: 'clear'; agent: string }

export type ComeResult = 'asked' | 'unasked' | 'held' | 'coming' | 'cleared' | 'nothing' | 'too-soon'

/** On its way for at most this long: then it is dropped (he was away, or never opened it). */
export const COMING_MAX_MS = 2 * 60 * 60 * 1000
/** An ask he forgot about lapses after a week. */
export const ASK_MAX_MS = 7 * 24 * 60 * 60 * 1000
/** An agent comes by itself at most once in this long (the throng rule's backstop). */
export const CALL_GAP_MS = 15 * 60 * 1000

export const EMPTY_COME: ComeFile = { v: 1, version: 0, asked: {}, coming: {}, calls: {} }

const KEY = /^[\w.:-]{1,80}$/
export const isComeKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const words = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** What is on disk, cleaned; what is too old is dropped. */
export function parseComeFile(raw: unknown, now = Date.now()): ComeFile {
  const f = raw && typeof raw === 'object' ? (raw as Partial<ComeFile>) : {}
  const asked: Record<string, ComeAsk> = {}
  for (const [key, value] of Object.entries(f.asked || {})) {
    if (!isComeKey(key) || !value || !finite(value.at) || now - value.at > ASK_MAX_MS) continue
    const what = words(value.what, 80)
    asked[key] = { at: value.at, ...(what ? { what } : {}), ...(value.hold === true ? { hold: true } : {}) }
  }
  const coming: Record<string, ComeTrip> = {}
  for (const [key, value] of Object.entries(f.coming || {})) {
    if (!isComeKey(key) || !value || !finite(value.at) || now - value.at > COMING_MAX_MS) continue
    coming[key] = { at: value.at, by: value.by === 'agent' ? 'agent' : 'owner', why: words(value.why, 120) }
  }
  const calls: Record<string, number> = {}
  for (const [key, value] of Object.entries(f.calls || {})) if (isComeKey(key) && finite(value) && now - value < CALL_GAP_MS) calls[key] = value
  return { v: 1, version: finite(f.version) ? f.version : 0, asked, coming, calls }
}

/** One change. `file` is unchanged (the same object) when nothing changed. */
export function applyComeOp(file: ComeFile, op: ComeOp, now = Date.now()): { file: ComeFile; result: ComeResult } {
  const key = op.agent
  const next = (changes: Partial<ComeFile>, result: ComeResult) => ({ file: { ...file, ...changes, version: file.version + 1 }, result })
  const without = <T>(map: Record<string, T>) => {
    const copy = { ...map }
    delete copy[key]
    return copy
  }
  switch (op.op) {
    case 'ask': {
      if (!op.on) return file.asked[key] ? next({ asked: without(file.asked) }, 'unasked') : { file, result: 'nothing' }
      const what = words(op.what, 80)
      return next({ asked: { ...file.asked, [key]: { at: now, ...(what ? { what } : {}) } } }, 'asked')
    }
    case 'later': {
      const ask = file.asked[key]
      if (!ask) return { file, result: 'nothing' }
      return next({ asked: { ...file.asked, [key]: { ...ask, hold: true } } }, 'held')
    }
    case 'done': {
      const ask = file.asked[key]
      // Not asked, or a turn from before he asked, or one that failed (that one shows as an error anyway).
      if (!ask || !(op.turnAt > ask.at) || op.error) return { file, result: 'nothing' }
      // The agent said this turn end is not it: the ask stays for the next one.
      if (ask.hold) return next({ asked: { ...file.asked, [key]: { ...ask, hold: false, at: op.turnAt } } }, 'held')
      const why = ask.what ? `${ask.what} is done` : 'what you asked for is done'
      return next({ asked: without(file.asked), coming: { ...file.coming, [key]: { at: now, by: 'owner', why } } }, 'coming')
    }
    case 'call': {
      if (file.coming[key]) return { file, result: 'coming' }
      const ask = file.asked[key]
      // What he asked for: always. By itself: once in 15 minutes.
      if (!ask && finite(file.calls[key]) && now - file.calls[key] < CALL_GAP_MS) return { file, result: 'too-soon' }
      const why = words(op.why, 120) || (ask?.what ? `${ask.what} is done` : 'has something for you')
      return next({
        asked: ask ? without(file.asked) : file.asked,
        coming: { ...file.coming, [key]: { at: now, by: ask ? 'owner' : 'agent', why } },
        calls: { ...file.calls, [key]: now },
      }, 'coming')
    }
    case 'clear':
      return file.coming[key] ? next({ coming: without(file.coming) }, 'cleared') : { file, result: 'nothing' }
  }
}

// ─── his words ─────────────────────────────────────────────────────────────────────────────────────────

const COME = /\bcome\s+(?:back\s+)?(?:to\s+me|over(?:\s+to\s+me)?|find\s+me|see\s+me|here)\b/i
const WHEN = /\b(?:when|once|after|as\s+soon\s+as)\b/i
const DONE = /\b(?:done|finished|ready|complete|completed|through)\b/i
const NOT = /\b(?:don'?t|do\s+not|never|no\s+need\s+to|needn'?t)\s+(?:\w+\s+){0,2}come\b/i
const WHAT_WITH = /\b(?:done|finished|through)\s+with\s+([^,.;!?\n]{2,80})/i
const WHAT_IS = /\b(?:when|once|after|as\s+soon\s+as)\s+([^,.;!?\n]{2,60}?)\s+(?:is|are|'s)\s+(?:done|finished|ready|complete|completed)\b/i

/**
 * "Come to me when you're finished with X" (or "when the video is done", "once it's ready, come over") in a message
 * to an agent: the ask, with what he is waiting for when the words say. Not "come to me when you need me" (that is
 * the other switch), nor "don't come to me when you're done".
 */
export function asksToComeWhenDone(text: string): { what?: string } | null {
  if (!text) return null
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!COME.test(sentence) || !WHEN.test(sentence) || !DONE.test(sentence) || NOT.test(sentence)) continue
    const raw = (WHAT_WITH.exec(sentence)?.[1] || WHAT_IS.exec(sentence)?.[1] || '').trim()
    const cut = raw.replace(/\s+(?:(?:and|then)\s+)?come\b.*$/i, '').trim()
    const what = /^(?:it|this|that|them|you|you're|you are|everything|all)$/i.test(cut) ? '' : cut
    return what ? { what } : {}
  }
  return null
}
