// ░▒▓ OWN MISSION — the owner's own missions, from Mindcraft's small panel ▓▒░
// The owner, 2026-11-23: "I wanna do one hour academy. I wanna do one hour of work with Conrad... in the old
// Mindcraft I could just create missions." A mission he makes is a file in docs/questions like every carbon
// mission (by: owner, kind: task), so it survives a restart and Anorak can read it. Started, it runs on a timer:
// the wall clock, minus pauses (a call with Conrad happens outside the Oasis tab, and counts). Timed by default,
// open-ended if he says so. When it ends: kept or not, its minutes and XP; his notes go to an agent (Anorak by
// default, a switch per mission). Pure: file text, the timer, the end. The book and the files: work-vow-server.ts.

export interface RunState {
  /** null: open-ended (counts up, no ring). */
  plannedSeconds: number | null
  /** The agent his notes go to at the end; null: nobody. */
  notify: string | null
  /** ms; null while it runs. */
  pausedAt: number | null
  /** ms spent paused before the current pause. */
  pausedMs: number
  /** Seconds the Oasis counted on it while it ran (the rest of the wall time was outside the Oasis tab). */
  counted: number
  /** Started as a committed mission inside its window: its id and the bonus it earns if kept. */
  commit?: { id: string; bonusPct: number }
  /** Started now on a timer (not from a commitment): the bonus it earns if kept, +30%. */
  nowBonusPct?: number
  /** A task an agent gave him, done as this timed mission: kept, that task is marked done and its asker told. */
  forFile?: string
}

export interface RunResult {
  file: string
  title: string
  plannedSeconds: number | null
  /** The mission's time: the wall clock from start to end, minus pauses (a timed one stops at its length). */
  seconds: number
  /** Of that, what the Oasis tab counted itself. */
  counted: number
  /** Booked at the end as time outside the Oasis (a manual entry he can take back in Mindcraft, Today). */
  away: number
  kept: boolean
  xp: number
  startedAt: number
  endedAt: number
  /** Who his notes were sent to; '' if nobody. */
  told: string
  /** He ended it and said it is done (before its time or after): kept, whatever the minutes. */
  done?: boolean
  /** A committed mission kept: the bonus XP it earned (its percentage of its XP). */
  bonusXp?: number
  bonusPct?: number
  /** The board line and the agent note say it; the HUD shows it for a while. */
  line: string
}

/**
 * His own missions are run from the Oasis page in a browser only (Merge Goat's review, 2026-11-23): ending one tells an
 * agent "the owner ended his own mission... his notes", in his voice, so a local script with no Origin (curl, an agent's
 * shell) must not be able to send that. A browser always sends Origin on a POST; it must be a loopback page on this
 * server's own port. Not a wall against a determined local process (it can forge the header), but no agent ends his
 * mission by accident or on a whim.
 */
export function fromOasisPage(origin: string | null, host: string | null): boolean {
  if (!origin || origin === 'null' || !host) return false
  try {
    const url = new URL(origin)
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostPort = /:(\d+)$/.exec(host.trim())?.[1] || (url.protocol === 'https:' ? '443' : '80')
    return (url.protocol === 'http:' || url.protocol === 'https:') && loopback && port === hostPort
  } catch {
    return false
  }
}

// ─── committed missions ─────────────────────────────────────────────────────
// The owner, 2026-11-24: "committed missions will be worth more. And the further out you commit, the more XP bonus it
// gives you, because of the discounting effect: future you will be busy doing other stuff." A mission for a day and a
// time, with its length. Kept (started within COMMIT_GRACE_MS of its time and run to its length): its XP plus a bonus
// that grows with how far ahead it was committed. What a missed one costs is still his to decide (0 until then).

/** Started this long before or after its time counts as on time. */
export const COMMIT_GRACE_MS = 15 * 60_000

export type CommitState = 'pending' | 'started' | 'kept' | 'missed' | 'cancelled'

export interface Commitment {
  id: string
  /** His mission's file (docs/questions). */
  file: string
  title: string
  /** When it starts (ms). */
  at: number
  minutes: number
  /** When he committed (ms): the bonus grows with at − madeAt. */
  madeAt: number
  bonusPct: number
  notify: string | null
  state: CommitState
  /** The run that came of it (its start), and the Telegram reminder (when sent). */
  startedAt?: number
  remindedAt?: number
  /** Kept: the bonus XP it earned. */
  bonusXp?: number
}

/**
 * Two flat bonuses, nothing else (the owner, 2026-11-26: "30% is fine... significant, but not crazy... in the future, we're
 * not going to make any difference between tomorrow or in a year or in five minutes: let's give it a 60% bonus"; Anorak's
 * ruling): a mission started now on a timer and kept, +30%; a mission committed ahead (any distance) and kept, +60%. A miss
 * costs only the bonus. Rating a mission's reward and long-range commitments: parked by him for later.
 */
export const START_NOW_BONUS_PCT = 30
export const COMMIT_AHEAD_BONUS_PCT = 60

export function commitBonusPct(madeAt: number, at: number): number {
  return at - madeAt > 0 ? COMMIT_AHEAD_BONUS_PCT : 0
}

/** What it is now: a pending one whose window has passed unstarted is missed. */
export function commitStateAt(c: Pick<Commitment, 'state' | 'at'>, now: number): CommitState {
  return c.state === 'pending' && now > c.at + COMMIT_GRACE_MS ? 'missed' : c.state
}

/** Inside its window now (from COMMIT_GRACE_MS before its time to COMMIT_GRACE_MS after). */
export function commitInWindow(c: Pick<Commitment, 'at'>, now: number): boolean {
  return Math.abs(now - c.at) <= COMMIT_GRACE_MS
}

/** "Wed 25 Nov 14:00". */
export function commitWhen(at: number): string {
  const d = new Date(at)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${clockOf(at)}`
}

/** The reminder when it is due (Telegram when no Oasis page is open). */
export function commitReminder(c: Pick<Commitment, 'title' | 'minutes' | 'bonusPct' | 'at'>): string {
  const bonus = c.bonusPct ? `, +${c.bonusPct}% XP if you keep it` : ''
  return `⏰ Now: your committed mission "${c.title}" (${minutesLabel(c.minutes * 60)}${bonus}). Start it in the Oasis by ${clockOf(c.at + COMMIT_GRACE_MS)}: the counter, bottom left.`
}

/** Default agent his notes go to. */
export const OWN_MISSION_AGENT = 'Anorak'
/** A run longer than this is a forgotten timer, not work: what is past it is not booked as outside time. */
export const RUN_AWAY_CAP_SECONDS = 4 * 3600

/** Seconds on the timer: wall clock since start, minus pauses. */
export function runElapsed(startedAt: number, run: Pick<RunState, 'pausedAt' | 'pausedMs'>, now: number): number {
  const until = run.pausedAt ?? now
  return Math.max(0, (until - startedAt - run.pausedMs) / 1000)
}

/** What the counter shows: a countdown (timed) or the time so far (open-ended); share for the ring, null: no ring. */
export function runClock(startedAt: number, run: Pick<RunState, 'plannedSeconds' | 'pausedAt' | 'pausedMs'>, now: number): { seconds: number; share: number | null; over: boolean } {
  const elapsed = runElapsed(startedAt, run, now)
  if (run.plannedSeconds === null) return { seconds: elapsed, share: null, over: false }
  // Over its time it shows the time worked, counting up (the owner, 26 Nov: running over is kept; nothing below zero).
  if (elapsed >= run.plannedSeconds) return { seconds: elapsed, share: 1, over: true }
  return { seconds: run.plannedSeconds - elapsed, share: elapsed / run.plannedSeconds, over: false }
}

export function pauseRun(run: RunState, now: number): RunState {
  return run.pausedAt === null ? { ...run, pausedAt: now } : run
}

export function resumeRun(run: RunState, now: number): RunState {
  return run.pausedAt === null ? run : { ...run, pausedMs: run.pausedMs + Math.max(0, now - run.pausedAt), pausedAt: null }
}

/** Next step of the minutes: 5 at a time up to an hour, then 15 (◀ 60 ▶ goes 45 / 75). */
export function stepMinutes(value: number, direction: 1 | -1): number {
  const n = Math.max(0, Math.round(value) || 0)
  const step = (direction > 0 ? n >= 60 : n > 60) ? 15 : 5
  const next = direction > 0 ? Math.floor(n / step) * step + step : Math.ceil(n / step) * step - step
  return Math.min(1440, Math.max(5, next))
}

/** "1 h", "45 min", "1 h 30 min". */
export function minutesLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

/**
 * The end of a run: how long it was, what the Oasis counted, what is booked as outside time, kept or not.
 * A timed mission is kept when its timer ran out (ended at its length); ended early, it is not. An open-ended
 * one has no promise: it is kept. XP is time, 1 a minute (the Oasis already booked what it counted).
 */
export function endRun(active: { file: string; title: string; startedAt: number; run: RunState }, now: number, done?: boolean): Omit<RunResult, 'told' | 'line'> {
  const { run } = active
  const elapsed = runElapsed(active.startedAt, run, now)
  // He ended it himself (done or not): it ends now, and all its time counts, over its minutes too ("going over is not
  // a failure"). Done is kept, whatever the minutes (the owner, 26 Nov, three times: "done before the time is the best
  // outcome there is"). Nobody answered (the bell, then ten minutes): it ended when it ran out, kept.
  const byHim = done !== undefined
  const kept = run.plannedSeconds === null || done === true || elapsed >= run.plannedSeconds - 5
  const endedAt = !byHim && run.plannedSeconds !== null && elapsed >= run.plannedSeconds
    ? Math.min(now, active.startedAt + run.pausedMs + run.plannedSeconds * 1000)
    : now
  const counted = Math.round(run.counted)
  // A forgotten timer books no more than the cap beyond what the Oasis saw; one that ran out unanswered, its length.
  const wall = byHim || run.plannedSeconds === null ? Math.min(elapsed, counted + RUN_AWAY_CAP_SECONDS) : Math.min(elapsed, run.plannedSeconds)
  const seconds = Math.round(Math.max(wall, counted))
  const away = Math.max(0, seconds - counted)
  return { file: active.file, title: active.title, plannedSeconds: run.plannedSeconds, seconds, counted, away, kept, xp: Math.round(seconds / 60), startedAt: active.startedAt, endedAt, ...(done ? { done: true } : {}) }
}

/** A timed run whose time is up by the book's own clock (the server decides; a page's snapshot may be old). */
export function runIsDue(startedAt: number, run: RunState, now: number): boolean {
  return run.plannedSeconds !== null && runElapsed(startedAt, run, now) >= run.plannedSeconds
}

/** "kept · 1 h · 60 XP", "not kept: 40 min of 1 h · 40 XP", "done · 1 h 12 min · 72 XP". */
export function runLine(result: Pick<RunResult, 'plannedSeconds' | 'seconds' | 'kept' | 'xp'> & Partial<Pick<RunResult, 'bonusXp' | 'bonusPct' | 'done'>>): string {
  const bonus = result.bonusXp ? ` + ${result.bonusXp} XP bonus (+${result.bonusPct}%)` : ''
  if (result.plannedSeconds === null) return `done · ${minutesLabel(result.seconds)} · ${result.xp} XP`
  if (result.done) return `done · ${minutesLabel(result.seconds)} (planned ${minutesLabel(result.plannedSeconds)}) · ${result.xp} XP${bonus}`
  return result.kept
    ? `kept · ${minutesLabel(result.seconds)} · ${result.xp} XP${result.bonusXp ? ` + ${result.bonusXp} XP bonus (+${result.bonusPct}%)` : ''}`
    : `not kept: ${minutesLabel(result.seconds)} of ${minutesLabel(result.plannedSeconds)} · ${result.xp} XP`
}

// ─── the file ───────────────────────────────────────────────────────────────

const two = (n: number) => String(n).padStart(2, '0')

export function dateOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

function clockOf(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** `2026-11-23_academy-hour.md`; `taken` names already in the folder (a second "Academy" today gets -2). */
export function ownMissionFileName(title: string, now: number, taken: Set<string>): string {
  const slug = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'mission'
  const base = `${dateOf(now)}_${slug}`
  for (let i = 1; i < 100; i += 1) {
    const name = i === 1 ? `${base}.md` : `${base}-${i}.md`
    if (!taken.has(name)) return name
  }
  return `${base}-${now}.md`
}

/** Ease from his own minutes, the README's scale: 5 = under 2 min … 1 = over an hour. */
export function easeFromMinutes(minutes: number | null): number {
  if (minutes === null) return 2
  return minutes <= 2 ? 5 : minutes <= 5 ? 4 : minutes <= 15 ? 3 : minutes <= 60 ? 2 : 1
}

const clampScore = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : fallback)

export interface OwnMissionInput {
  title: string
  /** null: open-ended. */
  minutes: number | null
  ease?: number
  impact?: number
  urgency?: number
  /** Started now, or saved for later. */
  started: boolean
}

/** A new file in the format of docs/questions/README.md: by owner, a task, his own words as the title. */
export function ownMissionText(input: OwnMissionInput, now: number): string {
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 140)
  const minutes = input.minutes && input.minutes > 0 ? Math.round(input.minutes) : null
  const ease = clampScore(input.ease, easeFromMinutes(minutes))
  // Started now: it is today's (urgency 5). Saved for later: as he scored it.
  const impact = clampScore(input.impact, 3)
  const urgency = clampScore(input.urgency, input.started ? 5 : 3)
  const length = minutes ? minutesLabel(minutes * 60) : 'open-ended, no set length'
  const day = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return [
    'state: open',
    'kind: task',
    `asked: ${dateOf(now)}`,
    'by: owner',
    `score: ease ${ease} · impact ${impact} · urgency ${urgency}`,
    // `minutes` must be a positive number; open-ended: an hour as the estimate.
    `minutes: ${minutes ?? 60}`,
    'blocks:',
    'recommend: his own mission',
    'predict:',
    '',
    `# ${title}`,
    '',
    '## What to do',
    `${title}: ${length}. His own mission, ${input.started ? `started in Mindcraft on ${day} at ${clockOf(now)}` : `saved for later in Mindcraft on ${day}`}.`,
    '',
    '## Recommendation',
    'His own: nothing to decide, only to do.',
    '',
  ].join('\n')
}

/** Append a line under a `## Heading` (made at the end of the body if missing). */
function appendUnder(text: string, heading: string, line: string): string {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  const at = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`)
  if (at < 0) return [...lines, '', `## ${heading}`, line, ''].join('\n')
  let next = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  if (next < 0) next = lines.length
  const section = lines.slice(at + 1, next)
  while (section.length && !section[section.length - 1].trim()) section.pop()
  const after = lines.slice(next)
  return [...lines.slice(0, at + 1), ...section, line, ...(after.length ? ['', ...after] : ['']) ].join('\n')
}

/** The commitment in the file: when, how long, the bonus if kept. */
export function markCommitted(text: string, c: Pick<Commitment, 'at' | 'minutes' | 'madeAt' | 'bonusPct'>): string {
  const made = new Date(c.madeAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return appendUnder(text, 'Committed', `- for ${commitWhen(c.at)}, ${minutesLabel(c.minutes * 60)}; committed on ${made} at ${clockOf(c.madeAt)}${c.bonusPct ? `: +${c.bonusPct}% XP if kept` : ''}`)
}

/** One note, with the time: "- 19:12 the skill tree needs a back button". */
export function addOwnNote(text: string, note: string, now: number): string {
  const clean = note.replace(/\r\n?/g, '\n').trim().replace(/\n+/g, ' / ')
  return appendUnder(text, 'Notes', `- ${clockOf(now)} ${clean}`)
}

const RUN_MARK = /^- run started /

/** The notes he logged in the latest run, as lines (newest last); notes from earlier runs stay in the file. */
export function ownNotes(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const at = lines.findIndex(l => l.trim().toLowerCase() === '## notes')
  if (at < 0) return []
  let out: string[] = []
  for (let i = at + 1; i < lines.length && !/^##?\s/.test(lines[i]); i += 1) {
    const line = lines[i].trim()
    if (RUN_MARK.test(line)) out = []
    else if (line.startsWith('- ')) out.push(line.slice(2))
  }
  return out
}

/** Started again from his list: a mark in the notes, so the end sends only this run's notes. */
export function markRunStart(text: string, now: number, plannedSeconds: number | null): string {
  if (!/^## notes\s*$/im.test(text)) return text
  const day = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return appendUnder(text, 'Notes', `- run started ${day} ${clockOf(now)}, ${plannedSeconds ? minutesLabel(plannedSeconds) : 'open-ended'}`)
}

function setHeader(text: string, values: Record<string, string>): string {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let end = lines.findIndex(l => !l.trim() || l.startsWith('#') || l.indexOf(':') < 0)
  if (end < 0) end = lines.length
  const header = lines.slice(0, end)
  for (const [key, value] of Object.entries(values)) {
    const at = header.findIndex(l => l.slice(0, l.indexOf(':')).trim().toLowerCase() === key)
    const line = `${key}: ${value}`
    if (at < 0) header.push(line)
    else header[at] = line
  }
  return [...header, ...lines.slice(end)].join('\n')
}

/**
 * The end, in the file: state answered (he did it), the answer is the result line, took its minutes, hit is
 * kept (README: for his own missions `hit` says whether he kept it), and the run under "## Runs".
 */
export function finishOwnMissionText(text: string, result: Omit<RunResult, 'told' | 'line'>, told: string): string {
  const line = runLine(result)
  const outside = result.away >= 60 ? ` (${minutesLabel(result.counted)} in the Oasis, ${minutesLabel(result.away)} outside it)` : ''
  const day = new Date(result.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const next = setHeader(text, { state: 'answered', answered: dateOf(result.endedAt), answer: line, took: String(Math.max(1, Math.round(result.seconds / 60))), hit: result.kept ? 'yes' : 'no' })
  return appendUnder(next, 'Runs', `- ${day} ${clockOf(result.startedAt)} to ${clockOf(result.endedAt)}: ${line}${outside}${told ? `; notes sent to ${told}` : ''}`)
}

/** A run, under "## Runs" in a task's own file (a task of his list he did on the timer; its header is answered apart). */
export function appendRunLine(text: string, result: Omit<RunResult, 'told' | 'line'>): string {
  const day = new Date(result.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return appendUnder(text, 'Runs', `- ${day} ${clockOf(result.startedAt)} to ${clockOf(result.endedAt)}: ${runLine(result)}`)
}

/** What the agent gets when it ends (his notes, in full). */
export function formatRunNote(result: Pick<RunResult, 'file' | 'title' | 'plannedSeconds' | 'seconds' | 'kept' | 'xp'> & Partial<Pick<RunResult, 'counted' | 'away' | 'startedAt' | 'endedAt'>>, notes: string[]): string {
  const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')
  const when = result.startedAt && result.endedAt ? ` from ${clock(result.startedAt)} to ${clock(result.endedAt)}` : ''
  const outside = result.away && result.away >= 60 ? ` (${minutesLabel(result.counted || 0)} in the Oasis, ${minutesLabel(result.away)} outside it)` : ''
  return [
    `The owner ended his own mission "${result.title}" (Mindcraft): ${runLine(result)}.`,
    `Planned: ${result.plannedSeconds === null ? 'open-ended' : minutesLabel(result.plannedSeconds)}. Real: ${minutesLabel(result.seconds)}${when}${outside}. ${result.plannedSeconds === null ? 'Done.' : result.kept ? 'Kept.' : 'Not kept: he ended it early.'}`,
    notes.length ? `His notes while it ran:\n${notes.map(n => `- ${n}`).join('\n')}` : 'He logged no notes.',
    `The file: ${result.file} in the questions folder. Act on the notes if one is for you; otherwise keep them in mind.`,
  ].join('\n\n')
}
