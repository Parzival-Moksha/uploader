// ░▒▓ WORK VOW, SERVER SIDE — the book of time worked: data/work-vow.local.json ▓▒░
// One record per local day (seconds free, seconds per mission, XP). Gitignored like every
// data/*.local.json. One writer at a time; written to a temp file first, so a crash mid-write
// leaves the old book, not half of a new one.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { missionsDir } from './oasis-settings'
import { appendMissionLog } from './village/village-mission-edit'
import { missionForAgent } from './village/mission-dispatch'
import { isMissionFile, parseMission, type Mission } from './village/village-missions'
import { isCarbonFile, parseCarbonMission } from './village/carbon-missions'
import { questionsDir, rewriteBoard, tellAgent } from './village/carbon-server'
import { addOwnNote, finishOwnMissionText, formatRunNote, markRunStart, ownMissionFileName, ownMissionText, ownNotes, runLine, type RunResult } from './village/own-mission'
import {
  addManualTime,
  removeManualTime,
  applyAgentWork,
  applyWorkBeat,
  daySummary,
  localDay,
  mindcraftBook,
  agentHoursHistory,
  type AgentHoursDay,
  missionTimers,
  missionActivity,
  emptyWorkFile,
  formatClock,
  parseWorkFile,
  releaseWorkHolder,
  setWorkMission,
  setRunPaused,
  extendRunInBook,
  finishRunInBook,
  recordRun,
  workSnapshot,
  type AgentWorkReport,
  type WorkBeat,
  type MindcraftBook,
  type WorkDaySummary,
  type WorkFile,
  type WorkSnapshot,
} from './village/work-vow'

export function workVowPath(): string {
  return process.env.OASIS_WORK_VOW_STATE || path.join(process.cwd(), 'data', 'work-vow.local.json')
}

/** No file yet is an empty book. A file that cannot be read is an error: never overwrite days with nothing. */
async function readBook(): Promise<WorkFile> {
  let text: string
  try {
    text = await fs.readFile(workVowPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkFile()
    throw error
  }
  return parseWorkFile(JSON.parse(text.replace(/^\uFEFF/, '')))
}

async function writeBook(file: WorkFile): Promise<void> {
  const target = workVowPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(file, null, 1)}\n`, 'utf8')
  await fs.rename(temp, target)
}

// One change at a time (the dev server is one process; hot reloads keep the chain on globalThis).
const chainHolder = globalThis as unknown as { __oasisWorkVowChain?: Promise<unknown> }

function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = (chainHolder.__oasisWorkVowChain || Promise.resolve()).then(job, job)
  chainHolder.__oasisWorkVowChain = next.catch(() => {})
  return next
}

export function workVowSnapshot(now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => workSnapshot(await readBook(), now))
}

/** A mission's title and priority, for time on a card that is merely open. Null: no such mission. */
async function missionMeta(file: string): Promise<{ file: string; title: string; priority: number } | null> {
  if (!isMissionFile(file) || file !== path.basename(file)) return null
  try {
    const parsed = parseMission(file, await fs.readFile(path.join(missionsDir(), file), 'utf8'))
    return { file, title: parsed.title, priority: parsed.priority || 0 }
  } catch {
    return null
  }
}

/** Every day in the book as lists: the owner's Mindcraft, each agent's, the whole Oasis'. */
export function workMindcraft(): Promise<MindcraftBook> {
  return serial(async () => mindcraftBook(await readBook()))
}

export interface RebuiltDays {
  /** The book's first day: rebuilt days are only the ones before it. */
  firstBookDay: string
  rule: string
  days: Record<string, { carbon: number; silicon: number }>
}

/**
 * The days before the counter began, rebuilt from the transcripts by scripts/rebuild-work-days.py
 * (data/work-rebuilt.local.json). Shown in Mindcraft's chart as rebuilt; never mixed into the book. Null: not built.
 */
export async function workRebuilt(): Promise<RebuiltDays | null> {
  const file = process.env.OASIS_WORK_REBUILT || path.join(process.cwd(), 'data', 'work-rebuilt.local.json')
  try {
    const raw = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as { firstBookDay?: unknown; rule?: unknown; days?: Record<string, { carbon?: unknown; silicon?: unknown }> }
    const days: RebuiltDays['days'] = {}
    const first = typeof raw.firstBookDay === 'string' ? raw.firstBookDay : '9999-12-31'
    for (const [date, d] of Object.entries(raw.days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= first || !d) continue
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, 30 * 86_400) : 0)
      days[date] = { carbon: Math.min(n(d.carbon), 86_400), silicon: n(d.silicon) }
    }
    return { firstBookDay: first, rule: typeof raw.rule === 'string' ? raw.rule : '', days }
  } catch {
    return null
  }
}

/** The owner's settings: valor with nothing in focus (0 to 1). */
export function setWorkSettings(settings: { freeValor?: number }, now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => {
    const book = await readBook()
    if (typeof settings.freeValor === 'number' && settings.freeValor >= 0 && settings.freeValor <= 1) {
      book.settings = { ...book.settings, freeValor: Math.round(settings.freeValor * 100) / 100 }
      await writeBook(book)
    }
    return workSnapshot(book, now)
  })
}

/**
 * The owner's one XP: his old Profile XP, taken once as a starting balance (the first call records
 * `currentOldXp`), plus every Mindcraft XP he earned (the same total Mindcraft shows, the commitment
 * included). The old Profile row in the database is left as it was.
 */
export function foldedOwnerXp(currentOldXp: number, now = Date.now()): Promise<{ total: number; oldXp: number; mindcraftXp: number; foldedAt: number }> {
  return serial(async () => {
    const book = await readBook()
    if (!book.profileFold) {
      book.profileFold = { oldXp: Math.max(0, Math.floor(currentOldXp || 0)), at: now }
      await writeBook(book)
    }
    const mindcraftXp = mindcraftBook(book, localDay(now)).totals.owner.xp
    const fold = book.profileFold
    return { total: Math.max(0, Math.round(fold.oldXp + mindcraftXp)), oldXp: fold.oldXp, mindcraftXp, foldedAt: fold.at }
  })
}

/** The Oasis's own working hours, one line per day, oldest first (the curve). */
export function workAgentHours(): Promise<AgentHoursDay[]> {
  return serial(async () => agentHoursHistory(await readBook()))
}

/** Per agent mission: the last day agents worked on it, and who. */
export function workMissionActivity(): Promise<ReturnType<typeof missionActivity>> {
  return serial(async () => missionActivity(await readBook()))
}

/** Per mission: the owner's time and the agents' time, over every day. */
export function workMissionTimers(): Promise<Record<string, { ownerSeconds: number; agentSeconds: number }>> {
  return serial(async () => missionTimers(await readBook()))
}

/**
 * An agent says which mission it is working on (null: back to the default, the mission whose `who`
 * names it). Its working minutes are booked there from now on.
 */
export function declareAgentMission(agent: string, file: string | null): Promise<{ ok: true; agent: string; mission: string | null; title?: string; priority?: number } | { ok: false; status: number; error: string }> {
  return serial(async () => {
    const name = agent.trim().toLowerCase()
    if (!name) return { ok: false as const, status: 400, error: 'agent is the agent\'s name' }
    const book = await readBook()
    let meta: { file: string; title: string; priority: number } | null = null
    if (file !== null) {
      meta = await missionMeta(file)
      if (!meta) return { ok: false as const, status: 404, error: 'mission not found' }
    }
    const next = { ...(book.agentMissions || {}) }
    if (meta) next[name] = meta.file
    else delete next[name]
    book.agentMissions = next
    await writeBook(book)
    return { ok: true as const, agent: name, mission: meta?.file || null, ...(meta ? { title: meta.title, priority: meta.priority } : {}) }
  })
}

/** Add time to a day by hand (with a reason), or take an entry back. */
export function editManualTime(edit: { date: string; seconds?: number; reason?: string; valor?: number; remove?: number }, now = Date.now()): Promise<{ ok: boolean; summary: WorkDaySummary }> {
  return serial(async () => {
    const before = await readBook()
    const next = typeof edit.remove === 'number'
      ? removeManualTime(before, edit.date, edit.remove)
      : addManualTime(before, { date: edit.date, seconds: edit.seconds || 0, reason: edit.reason || '', valor: edit.valor }, now)
    if (next !== before) await writeBook(next)
    return { ok: next !== before, summary: daySummary(next, edit.date, localDay(now)) }
  })
}

/** One day, ready to tell (the 21:00 message reads this). */
export function workDaySummary(date: string, now = Date.now()): Promise<WorkDaySummary> {
  return serial(async () => daySummary(await readBook(), date, localDay(now)))
}

let missionCache: { at: number; missions: Mission[] } | null = null

/** Every mission, re-read at most every 30 s (agent XP looks up whose mission a turn counts on). */
async function allMissions(now: number): Promise<Mission[]> {
  if (missionCache && now - missionCache.at < 30_000) return missionCache.missions
  let missions: Mission[] = []
  try {
    const dir = missionsDir()
    const names = (await fs.readdir(dir)).filter(isMissionFile)
    missions = (await Promise.all(names.map(async name => {
      try { return parseMission(name, await fs.readFile(path.join(dir, name), 'utf8')) } catch { return null }
    }))).filter((mission): mission is Mission => mission !== null)
  } catch { /* no folder: no missions, no agent XP */ }
  missionCache = { at: now, missions }
  return missions
}

/** Finished turns and helpers, from the page that heard the engine say so. */
export function reportAgentWork(reports: AgentWorkReport[], fromEngine = false): Promise<{ booked: number }> {
  return serial(async () => {
    const before = await readBook()
    let book = before
    // The engine reports (an empty heartbeat too): pages stop relaying while it does.
    if (fromEngine) book = { ...book, engineReportAt: Date.now() }
    let booked = 0
    const missions = reports.length ? await allMissions(Date.now()) : []
    for (const report of reports.slice(0, 200)) {
      // The agent's minutes count on the mission whose `who` names it: XP = minutes × that priority.
      // The mission the agent said it is on wins; else the open mission whose `who` names it.
      const said = book.agentMissions?.[report.name.trim().toLowerCase()]
      const mission = (said ? missions.find(item => item.file === said && item.column !== 'done') : null) || missionForAgent(missions, report.name)
      const next = applyAgentWork(book, { ...report, mission: mission ? { file: mission.file, title: mission.title, priority: mission.priority || 0 } : null })
      if (next !== book) booked += 1
      book = next
    }
    if (book !== before) await writeBook(book)
    return { booked }
  })
}

export function reportWorkBeat(input: Omit<WorkBeat, 'focus'> & { release?: boolean; focus?: { agent?: { key: string; name: string } | null; mission?: string | null; mindcraft?: boolean } }, now = Date.now()): Promise<{ counting: boolean; credited: number; otherTab: boolean; other?: { client?: string; since: number }; snapshot: WorkSnapshot }> {
  return serial(async () => {
    const mission = input.focus?.mission ? await missionMeta(input.focus.mission) : null
    const beat: WorkBeat & { release?: boolean } = { ...input, focus: { agent: input.focus?.agent || null, mission, mindcraft: input.focus?.mindcraft === true } }
    const before = await readBook()
    const result = applyWorkBeat(before, beat, now)
    // A closing page reports its last seconds and lets go.
    if (beat.release) result.file = releaseWorkHolder(result.file, beat.tab)
    if (result.file !== before) await writeBook(result.file)
    return { counting: result.counting, credited: result.credited, otherTab: result.otherTab === true, ...(result.other ? { other: result.other } : {}), snapshot: workSnapshot(result.file, now) }
  })
}

/** Start working on a mission (its title and priority are read from its file), or stop with null. */
export function switchWorkMission(file: string | null, now = Date.now()): Promise<{ ok: true; snapshot: WorkSnapshot } | { ok: false; status: number; error: string }> {
  return serial(async () => {
    const book = await readBook()
    let mission: { file: string; title: string; priority: number } | null = null
    if (file !== null) {
      if (!isMissionFile(file) || file !== path.basename(file)) return { ok: false as const, status: 400, error: 'not a mission file' }
      try {
        const parsed = parseMission(file, await fs.readFile(path.join(missionsDir(), file), 'utf8'))
        mission = { file, title: parsed.title, priority: parsed.priority || 0 }
      } catch {
        return { ok: false as const, status: 404, error: 'mission not found' }
      }
    }
    // A running own mission ends first (its file and its agent after the book is written).
    const closed = book.active?.run && book.active.file !== mission?.file ? closeRun(book, now) : null
    if (closed?.result) { const { result, notify } = closed; setTimeout(() => { void afterRun(result, notify).catch(() => {}) }, 0) }
    const before = closed?.result ? null : book.active
    const next = setWorkMission(closed?.book || book, mission, now)
    await writeBook(next)
    // Stopping leaves a line in the mission's own log: how long today, and the XP it earned.
    if (before && before.file !== mission?.file) {
      const snapshot = workSnapshot(next, now)
      const today = snapshot.today.missions.find(item => item.file === before.file)
      if (today && today.seconds >= 60) {
        try {
          const target = path.join(missionsDir(), before.file)
          const text = (await fs.readFile(target, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
          const two = (n: number) => String(n).padStart(2, '0')
          const at = new Date(now)
          const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
          const xp = today.xp
          await fs.writeFile(target, appendMissionLog(text, { at: stamp, who: 'owner', text: `Worked on this in the Oasis: ${formatClock(today.seconds)} so far today, ${xp} XP.` }), 'utf8')
        } catch { /* the mission file is gone: the time is still in the book */ }
      }
    }
    return { ok: true as const, snapshot: workSnapshot(next, now) }
  })
}

// ─── his own missions (Mindcraft's small panel) ─────────────────────────────
// A mission he makes is a file in docs/questions (by: owner, kind: task); started, it runs on a timer and the
// book counts it like "work on this". The end writes the file, books the time outside the Oasis tab, and sends his
// notes to an agent (Anorak by default). Format and timer: village/own-mission.ts.

function ownMissionPath(file: string): string | null {
  if (!isCarbonFile(file) || file !== path.basename(file) || /[\\/:*?"<>|]/.test(file)) return null
  return path.join(questionsDir(), file)
}

async function newOwnMissionFile(input: { title: string; minutes: number | null; ease?: number; impact?: number; urgency?: number; started: boolean }, now: number): Promise<string> {
  const dir = questionsDir()
  await fs.mkdir(dir, { recursive: true })
  const taken = new Set(await fs.readdir(dir).catch(() => [] as string[]))
  const name = ownMissionFileName(input.title, now, taken)
  await fs.writeFile(path.join(dir, name), ownMissionText(input, now), { encoding: 'utf8', flag: 'wx' })
  return name
}

// His mission files are written one change at a time (a note and the end must not overwrite each other).
const fileChains = globalThis as unknown as { __oasisOwnMissionFiles?: Map<string, Promise<unknown>> }
function withFile<T>(target: string, job: () => Promise<T>): Promise<T> {
  const chains = (fileChains.__oasisOwnMissionFiles ||= new Map())
  const next = (chains.get(target) || Promise.resolve()).then(job, job)
  chains.set(target, next.catch(() => {}))
  return next
}

const readText = async (target: string) => (await fs.readFile(target, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

/** Inside the book's chain: end the running own mission (if any) and keep it in the day. */
function closeRun(book: WorkFile, now: number, startedAt?: number, onlyIfDue = false): { book: WorkFile; result: RunResult | null; notify: string | null } {
  const notify = book.active?.run?.notify ?? null
  const ended = finishRunInBook(book, now, startedAt, onlyIfDue)
  if (!ended) return { book, result: null, notify: null }
  const result: RunResult = { ...ended.result, told: '', line: runLine(ended.result) }
  return { book: recordRun(ended.file, result), result, notify }
}

/** Outside the chain: the file gets the result, the agent gets his notes, the board is rewritten. Never throws. */
async function afterRun(result: RunResult, notify: string | null): Promise<string> {
  const target = ownMissionPath(result.file)
  let notes: string[] = []
  if (target) {
    // Behind any note still being written.
    try { notes = ownNotes(await withFile(target, () => readText(target))) } catch { /* the file is gone: the run is still in the book */ }
  }
  let told = ''
  if (notify) {
    const sent = await tellAgent(notify, formatRunNote(result, notes))
    told = sent.startsWith('sent to ') ? sent.slice('sent to '.length) : ''
  }
  if (target) {
    // Read again right before writing: a note that came in while the agent was being told stays.
    const wrote = await withFile(target, async () => {
      try {
        await fs.writeFile(target, finishOwnMissionText(await readText(target), result, told), 'utf8')
        return true
      } catch { return false }
    })
    if (wrote) await rewriteBoard()
  }
  if (told) {
    await serial(async () => {
      const book = await readBook()
      if (book.lastRun?.startedAt !== result.startedAt) return
      book.lastRun.told = told
      for (const day of Object.values(book.days)) for (const run of day.runs || []) if (run.startedAt === result.startedAt && run.file === result.file) run.told = told
      await writeBook(book)
    })
  }
  return told
}

export type OwnMissionOutcome = { ok: true; snapshot: WorkSnapshot; file?: string; ended?: RunResult } | { ok: false; status: number; error: string }

const cleanMinutes = (minutes: number | null) => (minutes !== null && Number.isFinite(minutes) && minutes > 0 ? Math.min(24 * 60, Math.round(minutes)) : null)

/**
 * Start his own mission: a new one (`title`) or one from his list (`file`). `minutes` null: open-ended.
 * `notify`: the agent his notes go to at the end, null for nobody. A run already going ends first.
 */
export async function startOwnMission(input: { title?: string; file?: string; minutes: number | null; notify: string | null }, now = Date.now()): Promise<OwnMissionOutcome> {
  const minutes = cleanMinutes(input.minutes)
  let file: string
  let title: string
  if (input.file) {
    const target = ownMissionPath(input.file)
    if (!target) return { ok: false, status: 400, error: 'not a mission file' }
    let parsed: ReturnType<typeof parseCarbonMission>
    try {
      parsed = parseCarbonMission(input.file, await fs.readFile(target, 'utf8'))
    } catch {
      return { ok: false, status: 404, error: 'mission not found' }
    }
    // Only his own: the end writes the file's answer, which an agent's question must not get.
    if (parsed.by.trim().toLowerCase() !== 'owner') return { ok: false, status: 400, error: 'only your own missions run on a timer' }
    title = parsed.title
    file = input.file
    const startAt = now
    await withFile(target, async () => {
      try { await fs.writeFile(target, markRunStart(await readText(target), startAt, minutes ? minutes * 60 : null), 'utf8') } catch { /* the run still starts */ }
    })
  } else {
    title = (input.title || '').replace(/\s+/g, ' ').trim()
    if (!title) return { ok: false, status: 400, error: 'a mission needs a title' }
    file = await newOwnMissionFile({ title, minutes, started: true }, now)
  }
  const closed = await serial(async () => {
    const book = await readBook()
    const before = closeRun(book, now)
    const next = setWorkMission(before.book, { file, title: title.slice(0, 140), priority: 0, run: { plannedSeconds: minutes ? minutes * 60 : null, notify: input.notify, pausedAt: null, pausedMs: 0, counted: 0 } }, now)
    await writeBook(next)
    return { ...before, snapshot: workSnapshot(next, now) }
  })
  if (closed.result) void afterRun(closed.result, closed.notify).catch(() => {})
  if (!input.file) void rewriteBoard()
  return { ok: true, snapshot: closed.snapshot, file, ...(closed.result ? { ended: closed.result } : {}) }
}

/** Save a mission for later: into his list (the Carbon tab), with his scores. */
export async function saveOwnMission(input: { title: string; minutes: number | null; ease?: number; impact?: number; urgency?: number }, now = Date.now()): Promise<{ ok: true; file: string } | { ok: false; status: number; error: string }> {
  const title = input.title.replace(/\s+/g, ' ').trim()
  if (!title) return { ok: false, status: 400, error: 'a mission needs a title' }
  const file = await newOwnMissionFile({ ...input, title, minutes: cleanMinutes(input.minutes), started: false }, now)
  void rewriteBoard()
  return { ok: true, file }
}

/** End the running own mission now (`startedAt`: only that run; `onlyIfDue`: only if its time is up by the book). */
export async function endOwnMission(startedAt?: number, now = Date.now(), onlyIfDue = false): Promise<OwnMissionOutcome> {
  const closed = await serial(async () => {
    const book = await readBook()
    const result = closeRun(book, now, startedAt, onlyIfDue)
    if (result.result) await writeBook(result.book)
    return { ...result, snapshot: workSnapshot(result.book, now) }
  })
  if (!closed.result) return { ok: true, snapshot: closed.snapshot }
  // The file, the agent and the board before answering, so the page shows who was told.
  const told = await afterRun(closed.result, closed.notify)
  return { ok: true, snapshot: { ...closed.snapshot, lastRun: closed.snapshot.lastRun ? { ...closed.snapshot.lastRun, told } : null }, ended: { ...closed.result, told } }
}

/** Pause the timer (the book stops counting it) or go on. */
export function pauseOwnMission(paused: boolean, now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => {
    const book = await readBook()
    const next = setRunPaused(book, paused, now)
    if (next !== book) await writeBook(next)
    return workSnapshot(next, now)
  })
}

/** More time on the running timed mission (+5, +15 when it runs out). */
export function extendOwnMission(seconds: number, now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => {
    const book = await readBook()
    const next = extendRunInBook(book, seconds, now)
    if (next !== book) await writeBook(next)
    return workSnapshot(next, now)
  })
}

/** Who his notes go to at the end (null: nobody). */
export function notifyOwnMission(agent: string | null, now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => {
    const book = await readBook()
    if (book.active?.run) {
      book.active.run.notify = agent
      await writeBook(book)
    }
    return workSnapshot(book, now)
  })
}

/** A note on the running own mission (typed or said), into its file under "## Notes". */
export async function noteOwnMission(note: string, now = Date.now()): Promise<{ ok: true; notes: string[] } | { ok: false; status: number; error: string }> {
  const text = note.trim()
  if (!text) return { ok: false, status: 400, error: 'an empty note' }
  const book = await serial(readBook)
  const target = book.active?.run ? ownMissionPath(book.active.file) : null
  if (!target) return { ok: false, status: 409, error: 'no own mission is running' }
  return withFile(target, async () => {
    try {
      const next = addOwnNote(await readText(target), text.slice(0, 4000), now)
      await fs.writeFile(target, next, 'utf8')
      return { ok: true as const, notes: ownNotes(next) }
    } catch {
      return { ok: false as const, status: 404, error: 'the mission file is gone' }
    }
  })
}

/** The running own mission's notes (empty when none runs). */
export async function ownMissionNotes(): Promise<string[]> {
  const book = await serial(readBook)
  const target = book.active?.run ? ownMissionPath(book.active.file) : null
  if (!target) return []
  try { return ownNotes(await fs.readFile(target, 'utf8')) } catch { return [] }
}
