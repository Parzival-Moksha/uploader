// ░▒▓ WORK VOW, ON THE PAGE — watches for activity, counts active seconds, reports them in small steps ▓▒░
// Counts only while the tab is visible and the owner did something in the last three minutes (a key,
// the mouse, a tap, the wheel, dictating). Every 15 s the seconds go to /api/village/work, which keeps
// the book; the page only ever shows the server's total plus the seconds it has not sent yet. One
// tick a second drives it all: no per-frame work.

import { onEngineEvent } from '../../lib/agent-engine-client'
import { activeMsBetween, isAutomationClient, ownTurnMs, WORK_BEAT_MS, type AgentWorkReport, type WorkSnapshot } from '../../lib/village/work-vow'
import { commitInWindow, commitStateAt, runClock, type RunResult } from '../../lib/village/own-mission'
import { useOasisStore } from '../../store/oasisStore'
import { useAudioManager } from '../../lib/audio-manager'

export interface WorkVowState {
  /** The server's last answer (null until the first one). */
  snapshot: WorkSnapshot | null
  /** Active seconds counted here and not in the book yet. */
  pendingSeconds: number
  /** Counting right now: visible, recently active, and this tab is the one that counts. */
  running: boolean
  /** Another tab counts; this one only shows. */
  otherTab: boolean
  /** The server cannot be reached: the pending seconds are not in the book. */
  unsaved: boolean
  /** This page is driven by automation (a test browser): it shows the book and never reports. */
  automated: boolean
  /** Mindcraft is open: its time counts at valor 1. */
  inMindcraft?: boolean
  /** When another tab counts: its browser and since when (for the HUD). */
  other?: { client?: string; since: number }
}

/**
 * What must outlive this module: a hot reload swaps the module under the HUD, and a fresh copy that
 * started from nothing left the HUD hidden and the 3D clock at 0:00:00 (2026-11-17). The page keeps
 * one of these; every copy of the module picks it up and carries on.
 */
interface WorkVowGlobal {
  state: WorkVowState
  listeners: Set<() => void>
  tab: string
  seq: number
  pendingMs: number
  lastInputAt: number | null
  /** How many HUDs are mounted (the counter runs while there is one). */
  users: number
  /** Stops the copy that is running (its timer and listeners). */
  halt: (() => void) | null
}
const holder = globalThis as unknown as { __oasisWorkVow?: WorkVowGlobal }
const G: WorkVowGlobal = holder.__oasisWorkVow ||= {
  state: { snapshot: null, pendingSeconds: 0, running: false, otherTab: false, unsaved: false, automated: false },
  listeners: new Set(),
  tab: `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
  seq: 0,
  pendingMs: 0,
  lastInputAt: null,
  users: 0,
  halt: null,
}

let state: WorkVowState = G.state
const listeners = G.listeners

function set(patch: Partial<WorkVowState>): void {
  state = G.state
  const next = { ...state, ...patch }
  if (next.snapshot === state.snapshot && next.pendingSeconds === state.pendingSeconds && next.running === state.running && next.otherTab === state.otherTab && next.unsaved === state.unsaved && next.automated === state.automated && next.other === state.other && next.inMindcraft === state.inMindcraft) return
  state = next
  G.state = next
  listeners.forEach(listener => listener())
}

export function getWorkVowState(): WorkVowState {
  // The page's one state, not this copy's: a HUD still holding an older copy of this module reads the same number.
  return G.state
}

export function subscribeWorkVow(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── activity ───────────────────────────────────────────────────────────────

let lastInputAt: number | null = G.lastInputAt

/** Something the owner did (also called while dictating, where no key is pressed). */
export function markWorkActivity(): void {
  lastInputAt = Date.now()
  G.lastInputAt = lastInputAt
}

// ─── focus: what the owner has open (an agent, a mission card), so each second lands in the right place ───

export interface WorkFocusNow {
  agent: { key: string; name: string } | null
  /** A mission file. */
  mission: string | null
  /** Mindcraft is open in front of him. */
  mindcraft?: boolean
}

let focus: WorkFocusNow = { agent: null, mission: null }

/** The owner opened or left an agent or a mission card: book the seconds so far under what was open, then switch. */
export function setWorkFocus(next: WorkFocusNow): void {
  if ((next.agent?.key || '') === (focus.agent?.key || '') && next.mission === focus.mission) return
  if (pendingMs >= 1000) void beat()
  focus = { ...next, mindcraft: focus.mindcraft }
}

/** Mindcraft is open (or closed): its time is full work, valor 1 (the owner, 2026-11-20). */
export function setWorkInMindcraft(open: boolean): void {
  if (Boolean(focus.mindcraft) === open) return
  if (pendingMs >= 1000) void beat()
  focus = { ...focus, mindcraft: open }
  set({ inMindcraft: open })
}

// ─── agent hours: finished turns and helpers, as the engine reports them ────

const helperSpans = new Map<string, Map<string, { start: number; end: number | null }>>()
/** Waits on the owner's answer (permission, question, plan): never work (Anorak, 27 Nov). */
const ownerWaits = new Map<string, Map<string, { start: number; end: number | null }>>()
let workQueue: AgentWorkReport[] = []
let workTimer: number | null = null

function queueAgentWork(report: AgentWorkReport): void {
  if (!maySend()) return
  // The engine books the agents' hours itself (it sees every turn, window open or not); pages relay only
  // while it doesn't (an engine started before 2026-11-20).
  if (state.snapshot?.agentHoursFrom === 'engine') return
  workQueue.push(report)
  if (workTimer !== null) return
  workTimer = window.setTimeout(() => {
    workTimer = null
    const batch = workQueue
    workQueue = []
    void post({ agentWork: batch })
  }, 2000)
}

function onEngine(event: { kind: string; agentId: string; ts: number } & Record<string, unknown>): void {
  if ((event.kind === 'permission.request' || event.kind === 'permission.resolved') && typeof event.ts === 'number' && typeof event.requestId === 'string') {
    const waits = ownerWaits.get(event.agentId) || new Map<string, { start: number; end: number | null }>()
    ownerWaits.set(event.agentId, waits)
    if (event.kind === 'permission.request') { if (!waits.has(event.requestId)) waits.set(event.requestId, { start: event.ts, end: null }) }
    else { const wait = waits.get(event.requestId); if (wait && wait.end === null) wait.end = event.ts }
    return
  }
  if (event.kind !== 'turn.end' && event.kind !== 'subagent.start' && event.kind !== 'subagent.end') return
  const agent = useOasisStore.getState().agentEngine.agents[event.agentId]
  if (!agent || typeof event.ts !== 'number') return
  const who = { key: agent.sessionId || agent.id, name: agent.name || agent.id }
  const spans = helperSpans.get(event.agentId) || new Map<string, { start: number; end: number | null }>()
  helperSpans.set(event.agentId, spans)
  const waits = ownerWaits.get(event.agentId) || new Map<string, { start: number; end: number | null }>()
  const ids = [event.toolUseId, event.taskId].filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (event.kind === 'subagent.start') {
    if (ids[0]) spans.set(ids[0], { start: event.ts, end: null })
    return
  }
  if (event.kind === 'subagent.end') {
    const id = ids.find(candidate => spans.has(candidate))
    const span = id ? spans.get(id) : null
    if (!span || span.end !== null) return
    span.end = event.ts
    // A helper counts in full, under its parent (the engine, which sees which tool asked, cuts a helper's own waits).
    queueAgentWork({ ...who, ts: event.ts, kind: 'helper', ms: event.ts - span.start })
    return
  }
  if (typeof event.durationMs !== 'number' || !(event.durationMs > 0)) return
  // The agent's own time: the turn minus the time it only waited on helpers or on the owner.
  queueAgentWork({ ...who, ts: event.ts, kind: 'turn', ms: ownTurnMs(event.durationMs, event.ts, [...spans.values(), ...waits.values()]) })
  for (const [id, span] of spans) if (span.end !== null && span.end <= event.ts) spans.delete(id)
  for (const [id, wait] of waits) if (wait.end !== null && wait.end <= event.ts) waits.delete(id)
}

// ─── the loop ───────────────────────────────────────────────────────────────

const tab = G.tab
let seq = G.seq
let pendingMs = G.pendingMs
let lastReadAt = 0
let lastTickAt = 0
let lastBeatAt = 0
let inFlight: Promise<void> | null = null
/** The route said no (hosted, shared on the network) or failed: try again after this moment. */
let quietUntil = 0
/** This tab let go while hidden; its next report says it is back. */
let letGoHidden = false

function isQuiet(): boolean {
  return Date.now() < quietUntil
}

/**
 * A test browser never counts the owner's work. Playwright and other webdrivers set navigator.webdriver;
 * headless browsers say so in their user agent; a page can also carry ?playtest in its URL. Such a page
 * reads the book (the HUD still shows) but sends nothing. Playtests of the counter itself set
 * window.__oasisWorkTestMode = true first: then it counts and reports, marked as automation, and the
 * server ignores it (the playtests answer the reports themselves).
 */
function automation(): { automated: boolean; testMode: boolean } {
  if (typeof window === 'undefined') return { automated: false, testMode: false }
  const automated = isAutomationClient({ webdriver: navigator.webdriver, userAgent: navigator.userAgent, href: location.href })
  return { automated, testMode: automated && (window as unknown as { __oasisWorkTestMode?: boolean }).__oasisWorkTestMode === true }
}

/** May this page send anything to the work book? */
function maySend(): boolean {
  const { automated, testMode } = automation()
  return !automated || testMode
}

async function post(body: unknown): Promise<{ counting?: boolean; credited?: number; otherTab?: boolean; other?: { client?: string; since: number }; snapshot?: WorkSnapshot } | null> {
  if (!maySend()) return null
  if (automation().automated) body = { ...(body as object), automation: true }
  try {
    const response = await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) quietUntil = Date.now() + 60_000
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function beat(): Promise<void> {
  if (inFlight) return inFlight
  if (isQuiet()) return Promise.resolve()
  inFlight = sendBeat().finally(() => { inFlight = null })
  return inFlight
}

async function sendBeat(): Promise<void> {
  lastBeatAt = Date.now()
  const seconds = Math.floor(pendingMs / 1000)
  seq += 1
  const back = letGoHidden
  const answer = await post({ tab, seq, seconds, focus, ...(back ? { back: true } : {}) })
  if (!answer) return // offline or mid-reload: the seconds stay pending and go with the next report
  letGoHidden = false
  if (answer.counting === false) {
    if (answer.otherTab) {
      // A different tab reported within the last minute: it counts, what was counted here is its to count.
      pendingMs = 0
      set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: 0, otherTab: true, running: false, other: answer.other })
      return
    }
    // Turned away for another reason (a report that crossed this tab's own letting-go): nobody else
    // counts, so say "back" with the next report and keep the seconds.
    letGoHidden = true
    lastBeatAt = 0
    set({ snapshot: answer.snapshot || state.snapshot, otherTab: false })
    return
  }
  // The server took what the clock allows; anything it did not take is dropped, never sent twice.
  pendingMs = Math.max(0, pendingMs - seconds * 1000)
  set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: Math.floor(pendingMs / 1000), otherTab: false, other: undefined })
}

function tick(): void {
  const now = Date.now()
  const visible = document.visibilityState === 'visible'
  // A test browser's input is not the owner's work: it gains nothing (unless a counter playtest asks).
  const gained = state.otherTab || !maySend() ? 0 : activeMsBetween(lastTickAt, now, lastInputAt, visible)
  // A tick that arrives late (a sleeping laptop, a throttled tab) is not three hours of work.
  pendingMs += Math.min(gained, 5000)
  lastTickAt = now
  G.seq = seq
  G.pendingMs = pendingMs
  endRunIfDue(now)
  ringDueCommits(now)
  // No book yet (the first read failed, the server was compiling): keep asking, every 5 s, until there is one.
  if (!state.snapshot && now - lastReadAt >= 5000) void refreshWorkVow()
  const due = now - lastBeatAt >= WORK_BEAT_MS
  // Report when there is something to report; a tab that only shows asks now and then who counts.
  if (due && (pendingMs >= 1000 || !state.snapshot || (state.otherTab && visible && gained === 0 && lastInputAt !== null && now - lastInputAt < 20_000))) void beat()
  // More than a minute that the server has not taken: say so, it is not in the book.
  set({ pendingSeconds: Math.floor(pendingMs / 1000), running: gained > 0, unsaved: pendingMs > 60_000 })
}

/** The page is going away (reload, close): send what is left and let the next page count at once. */
function letGo(): void {
  if (state.otherTab || !maySend()) return
  // Whoever lets go must say "back" with its next report, or the server keeps turning this same tab away
  // ("another tab is counting" with no other tab). That covers every way of letting go that the page survives:
  // hidden and shown again, the HUD remounting (a hot reload, React's dev double-mount), a page restored from cache.
  letGoHidden = true
  seq += 1
  const body = JSON.stringify({ tab, seq, seconds: Math.floor(pendingMs / 1000), focus, release: true, ...(automation().automated ? { automation: true } : {}) })
  pendingMs = 0
  try {
    navigator.sendBeacon('/api/village/work', new Blob([body], { type: 'application/json' }))
  } catch { /* the next page starts a little later */ }
}

/** Re-read the book (after starting or stopping a mission, or from another tab's change). */
export async function refreshWorkVow(): Promise<void> {
  lastReadAt = Date.now()
  try {
    const response = await fetch('/api/village/work', { cache: 'no-store' })
    if (response.ok) set({ snapshot: await response.json() as WorkSnapshot })
  } catch { /* next time */ }
}

/** Start working on a mission, or stop (null): the seconds so far are booked under the old kind first. */
export async function setWorkMission(file: string | null): Promise<boolean> {
  await beat()
  const answer = await post({ mission: file })
  if (answer?.snapshot) set({ snapshot: answer.snapshot })
  return Boolean(answer?.snapshot)
}

// ─── his own missions (Mindcraft's small panel) ─────────────────────────────

export type OwnRunAnswer = { ok?: boolean; snapshot?: WorkSnapshot; error?: string; file?: string; notes?: string[]; ended?: RunResult }

async function runPost(run: object): Promise<OwnRunAnswer> {
  if (!maySend()) return { error: 'a test browser writes nothing' }
  try {
    // The end tells an agent and rewrites the board before answering: give it time.
    const response = await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run }), signal: AbortSignal.timeout(40_000) })
    const data = await response.json().catch(() => ({})) as OwnRunAnswer
    if (data.snapshot) set({ snapshot: data.snapshot })
    return response.ok ? data : { error: data.error || `HTTP ${response.status}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Start his own mission: a new one by title, or one from his list by file. minutes null: open-ended. */
export async function startOwnRun(input: { title?: string; file?: string; minutes: number | null; notify: string | null; commit?: string }): Promise<OwnRunAnswer> {
  await beat() // the seconds so far are booked under what was counted before
  return runPost({ start: input })
}

/** Commit a mission for a day and a time (`at`, ms), with its length: kept on time, it earns its bonus. */
export function commitOwnRun(input: { title: string; at: number; minutes: number; notify: string | null }): Promise<OwnRunAnswer> {
  return runPost({ commit: input })
}

/** Call a committed mission off. */
export function uncommitOwnRun(id: string): Promise<OwnRunAnswer> {
  return runPost({ uncommit: id })
}

export function saveOwnRun(input: { title: string; minutes: number | null; ease: number; impact: number; urgency: number }): Promise<OwnRunAnswer> {
  return runPost({ save: input })
}

export function noteOwnRun(note: string): Promise<OwnRunAnswer> {
  return runPost({ note })
}

export async function pauseOwnRun(paused: boolean): Promise<OwnRunAnswer> {
  await beat()
  return runPost({ pause: paused })
}

export function notifyOwnRun(agent: string | null): Promise<OwnRunAnswer> {
  return runPost({ notify: agent })
}

/** A note still in the box when the mission ends goes in first (the owner, 2026-11-23: "save it"). */
let runDraft = ''
export function setRunDraft(text: string): void {
  runDraft = text
}
async function flushRunDraft(): Promise<void> {
  const text = runDraft.trim()
  if (!text) return
  runDraft = ''
  const saved = await runPost({ note: text })
  if (saved.error) runDraft = text
}

/** End the running own mission (only the run that started at `startedAt`). */
/** End it. done: he says it is done (kept, whatever the minutes); false: not done; absent: the timer's own end. */
export async function endOwnRun(startedAt: number, done?: boolean): Promise<OwnRunAnswer> {
  await beat()
  await flushRunDraft()
  return runPost({ end: true, startedAt, ...(done === undefined ? {} : { done }) })
}

/** More time on the running timed mission: +5 or +15 minutes, from now if its time is up. */
export function extendOwnRun(minutes: number): Promise<OwnRunAnswer> {
  dueAskedAt = 0
  return runPost({ extend: Math.round(minutes * 60) })
}

/** Time is up and nobody answered (+5, +15, done): after this long it ends by itself, kept, at the moment it ran out. */
export const RUN_ANSWER_GRACE_MS = 10 * 60_000

let dueAskedAt = 0

/** This page's clock says the time is up: the book ends it only if its own clock agrees (this page may be stale). */
async function endOwnRunIfDue(startedAt: number): Promise<void> {
  dueAskedAt = Date.now()
  await beat()
  await flushRunDraft()
  const answer = await runPost({ end: 'due', startedAt })
  // Declined (paused or resumed elsewhere: the fresh book came back) or failed: ask again later, not every second.
  if (answer.error || !answer.ended) dueAskedAt = Date.now()
}

export async function readOwnRunNotes(): Promise<string[]> {
  try {
    const response = await fetch('/api/village/work?run=1', { cache: 'no-store' })
    return response.ok ? ((await response.json()) as { notes?: string[] }).notes || [] : []
  } catch {
    return []
  }
}

/** A timed own mission whose time is up ends by itself (kept), from whichever page sees it first. */
function endRunIfDue(now: number): void {
  const active = state.snapshot?.active
  const run = active?.run
  if (!active || !run || run.plannedSeconds === null || run.pausedAt !== null || !maySend()) return
  if (!runClock(active.startedAt, run, now).over) return
  chimeOnce(`${active.startedAt}:${run.plannedSeconds}`)
  // It no longer ends by itself: running over is kept, the extra minutes count (the owner, 26 Nov: "nothing is policed").
}

/** A committed mission is due (its window opened): the bell, once, in one tab. Nothing else running. */
function ringDueCommits(now: number): void {
  if (!maySend() || state.snapshot?.active?.run) return
  for (const c of state.snapshot?.commits || []) {
    if (commitStateAt(c, now) === 'pending' && commitInWindow(c, now) && now >= c.at - 60_000) chimeOnce(`commit:${c.id}`)
  }
}

/** The bell when a mission's time is up: once per run and length, in one tab only (tabs share localStorage). */
function chimeOnce(key: string): void {
  try {
    const stored = 'oasis-mission-chime'
    if (localStorage.getItem(stored) === key) return
    localStorage.setItem(stored, key)
  } catch { /* no storage: the bell may ring in each tab */ }
  try { useAudioManager.getState().play('missionEnd') } catch { /* no sound */ }
}

/** Hidden: report what is left and let go, so another Oasis tab can count at once. Back in front: say so. */
function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    if (state.otherTab) return
    letGo()
  } else {
    void refreshWorkVow()
  }
}

const INPUTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const

/** This copy of the module takes the clock: timer, input listeners, engine events. */
function run(): void {
  G.halt?.() // a copy from before a hot reload stops; this one carries on with the same tab, numbers and book
  set({ automated: automation().automated && !automation().testMode })
  lastTickAt = Date.now()
  lastBeatAt = 0
  for (const type of INPUTS) window.addEventListener(type, markWorkActivity, { capture: true, passive: true })
  const timer = window.setInterval(tick, 1000)
  window.addEventListener('pagehide', letGo)
  document.addEventListener('visibilitychange', onVisibility)
  const stopEngine = onEngineEvent(onEngine)
  const halt = () => {
    window.clearInterval(timer)
    for (const type of INPUTS) window.removeEventListener(type, markWorkActivity, { capture: true })
    window.removeEventListener('pagehide', letGo)
    document.removeEventListener('visibilitychange', onVisibility)
    stopEngine()
    if (G.halt === halt) G.halt = null
  }
  G.halt = halt
  void refreshWorkVow()
}

/** A HUD is on screen: the counter runs while at least one is. */
export function startWorkVow(): () => void {
  G.users += 1
  if (G.users === 1 || !G.halt) run()
  return () => {
    G.users = Math.max(0, G.users - 1)
    if (G.users > 0) return
    G.halt?.()
    letGo()
  }
}

// A hot reload made this copy while a HUD is on screen: take over from the old copy at once.
if (typeof window !== 'undefined' && G.users > 0) run()

// Dev-only console helper (playtests): window.__oasisWork.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisWork = {
    state: () => state,
    tab: () => tab,
    /** Show a made-up book (playtests with the API blocked). */
    show: (snapshot: WorkSnapshot) => set({ snapshot }),
  }
}
