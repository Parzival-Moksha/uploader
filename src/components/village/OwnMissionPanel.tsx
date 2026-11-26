'use client'

// ░▒▓ OWN MISSION PANEL — his own missions, in Mindcraft's small panel (bottom left) ▓▒░
// The owner, 2026-11-23: "I wanna do one hour academy. I wanna do one hour of work with Conrad." New mission: a title,
// a length in minutes (timed by default, open-ended if he says so), Start, or Save for later (with ease, impact,
// urgency, into his list). Running: the countdown, notes (typed or said), pause, end, and who gets his notes.
// Ended: kept or not, its minutes and XP, who was told. Logic: lib/village/own-mission.ts; book: work-vow-server.ts.

import { useCallback, useEffect, useState } from 'react'
import { commitBonusPct, commitInWindow, commitStateAt, commitWhen, easeFromMinutes, minutesLabel, OWN_MISSION_AGENT, runClock, stepMinutes, COMMIT_GRACE_MS, type Commitment } from '../../lib/village/own-mission'
import { formatClock, type WorkSnapshot } from '../../lib/village/work-vow'
import { useOasisStore } from '../../store/oasisStore'
import { commitOwnRun, uncommitOwnRun, endOwnRun, extendOwnRun, noteOwnRun, notifyOwnRun, pauseOwnRun, readOwnRunNotes, RUN_ANSWER_GRACE_MS, saveOwnRun, setRunDraft, startOwnRun } from './work-vow-client'
import { kitConfirm } from '@/components/ui-kit'

const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'

/** In a row, each button as wide as its words (the kit's .mc-btn is a full-width block). */
const INLINE_BTN = { display: 'inline-block', width: 'auto', minWidth: 72, padding: '9px 14px 8px' } as const

/** Keys typed here stay here (WASD must not walk the avatar); Esc still closes. */
function keepKeys(event: React.KeyboardEvent) {
  if (event.key !== 'Escape') event.stopPropagation()
}

/** The village's agents by name; the default for his notes is Anorak. */
function useAgentNames(): string[] {
  const joined = useOasisStore(s => s.agentEngine.order.map(id => s.agentEngine.agents[id]?.name || '').filter(Boolean).join('\u0001'))
  return joined ? joined.split('\u0001') : []
}

function defaultAgent(names: string[]): string {
  return names.find(name => /^anorak/i.test(name)) || OWN_MISSION_AGENT
}

/**
 * Who hears how it went (the owner, 2026-11-23: "send my notes to Anorakdev: what is that?"): when it ends, the agent picked
 * here gets the whole mission: title, planned and real time, kept or not, every note. A mission an agent gave him reports to
 * that agent when he answers it in Carbon; one he made himself reports to the agent chosen here, Anorak by default.
 */
function NotifySwitch({ on, agent, onChange }: { on: boolean; agent: string; onChange: (on: boolean, agent: string) => void }) {
  const names = useAgentNames()
  const options = names.includes(agent) ? names : [agent, ...names]
  return (
    <label className="flex flex-wrap items-center gap-1.5 text-[12px] leading-snug text-white/80" title="When it ends, this agent gets a message with the mission's title, the time planned and the real time, kept or not, and every note you logged.">
      <input type="checkbox" checked={on} onChange={event => onChange(event.target.checked, agent)} />
      <span>when it ends, tell</span>
      <select value={agent} disabled={!on} onChange={event => onChange(on, event.target.value)} className="mc-field px-1 py-0.5 text-[12px] text-white outline-none">
        {options.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <span className="basis-full pl-5 text-[11px] text-white/50">the whole mission: its title, the time planned and the real time, kept or not, and every note</span>
    </label>
  )
}

/** The mission running now: its clock, notes, pause, end. */
export function RunningMission({ snapshot }: { snapshot: WorkSnapshot }) {
  const active = snapshot.active
  const run = active?.run
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One mic: the one inside the box (voice typing on any text field); a second one beside it did the same (2026-11-23).
  const [draft, setDraft] = useState('')
  const names = useAgentNames()
  const startedAt = active?.startedAt || 0
  useEffect(() => { setRunDraft(draft) }, [draft])
  useEffect(() => {
    let live = true
    void readOwnRunNotes().then(list => { if (live) setNotes(list) })
    return () => { live = false }
  }, [startedAt])
  const addNote = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    const answer = await noteOwnRun(text)
    setBusy(false)
    if (answer.error) return setError(answer.error)
    setNotes(answer.notes || [])
    setDraft('')
  }, [busy, draft])
  if (!active || !run) return null
  const clock = runClock(active.startedAt, run, Date.now())
  const paused = run.pausedAt !== null
  const act = async (job: () => Promise<{ error?: string }>) => {
    if (busy) return
    setBusy(true)
    setError('')
    const answer = await job()
    setBusy(false)
    if (answer.error) setError(answer.error)
  }
  return (
    <div data-own-mission="running" className="mc-card mt-2 p-2" onKeyDown={keepKeys}>
      <div className="mc-label">Your mission{paused ? ' · paused' : ''}</div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="mc-strong min-w-0 break-words text-[15px]">{active.title}</div>
        <div className="mc-clock shrink-0 text-[20px] font-bold tabular-nums" style={{ color: paused ? 'rgba(255,255,255,0.5)' : clock.over ? GREEN : AMBER }}>{formatClock(clock.seconds)}</div>
      </div>
      <div className="text-[11.5px] text-white/60">
        {run.plannedSeconds === null ? 'open-ended: counting up' : `${Math.round(run.plannedSeconds / 60)} min, counting down`} · counts as work on this mission, whichever agent you talk to
      </div>
      {notes.length > 0 && (
        <ul data-own-mission="notes" className="mt-1.5 max-h-[140px] list-none overflow-y-auto pl-0 text-[12.5px] leading-snug text-white/85">
          {notes.map((note, index) => <li key={index} className="border-b border-white/5 py-0.5">{note}</li>)}
        </ul>
      )}
      <div className="mt-1.5 flex items-end gap-1.5">
        <textarea
          data-own-mission="note"
          value={draft}
          rows={2}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void addNote()
            }
          }}
          placeholder="A note: say or type it (Enter logs it)"
          className="mc-field min-w-0 flex-1 resize-none px-2 py-1 text-[13px] text-white outline-none placeholder:text-white/35"
        />
        <button type="button" data-own-mission="log" disabled={busy || !draft.trim()} onClick={() => { void addNote() }} className="mc-btn shrink-0" style={{ ...INLINE_BTN, minWidth: 76, padding: '13px 16px 12px', fontSize: 13 }} data-tone="go" title="Log this note (Enter does the same)">Log</button>
      </div>
      <div className="mt-1.5">
        <NotifySwitch on={run.notify !== null} agent={run.notify || defaultAgent(names)} onChange={(on, agent) => { void notifyOwnRun(on ? agent : null) }} />
      </div>
      {clock.over && <TimeUpButtons startedAt={active.startedAt} />}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => { void act(() => pauseOwnRun(!paused)) }} className="mc-btn" style={INLINE_BTN}>{paused ? '▶ go on' : '❙❙ pause'}</button>
        <button type="button" data-own-mission="end" disabled={busy} onClick={() => { void act(() => endOwnRun(active.startedAt)) }} className="mc-btn" style={INLINE_BTN} data-tone="stop" title={run.plannedSeconds !== null && !clock.over ? 'Ending before the time is up: not kept' : 'End it'}>■ end{run.plannedSeconds !== null && !clock.over ? ' now' : ''}</button>
      </div>
      {error && <div className="mt-1 text-[12px] text-rose-300">{error}</div>}
    </div>
  )
}

/** Time is up: more time, or done, right there (the old Mindcraft's "+5, +15"). */
export function TimeUpButtons({ startedAt, compact = false }: { startedAt: number; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const go = async (job: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    await job()
    setBusy(false)
  }
  const style = compact ? { ...INLINE_BTN, minWidth: 0, padding: '6px 11px 5px' } : INLINE_BTN
  return (
    <div data-own-mission="time-up" className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'mt-2'}`}>
      <button type="button" disabled={busy} onClick={() => { void go(() => extendOwnRun(5)) }} className="mc-btn" style={style}>+5 min</button>
      <button type="button" disabled={busy} onClick={() => { void go(() => extendOwnRun(15)) }} className="mc-btn" style={style}>+15 min</button>
      <button type="button" disabled={busy} onClick={() => { void go(() => endOwnRun(startedAt)) }} className="mc-btn" style={style} data-tone="go">✓ done</button>
    </div>
  )
}

/** The bar over the counter when the time is up: what ran out, +5, +15, done; it ends by itself after ten minutes. */
export function TimeUpBar({ snapshot, bottom }: { snapshot: WorkSnapshot; bottom: number }) {
  const active = snapshot.active
  const run = active?.run
  if (!active || !run || run.plannedSeconds === null || run.pausedAt !== null) return null
  const now = Date.now()
  if (!runClock(active.startedAt, run, now).over) return null
  const ranOutAt = active.startedAt + run.pausedMs + run.plannedSeconds * 1000
  const left = Math.max(0, Math.ceil((ranOutAt + RUN_ANSWER_GRACE_MS - now) / 60_000))
  return (
    <div
      data-own-mission="time-up-bar"
      className="mc-scope fixed left-3 z-[calc(var(--z-hud)_+_11)] flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-2 rounded-xl border-2 bg-slate-950/90 px-3 py-2 text-white shadow-[0_0_28px_rgba(52,211,153,0.55)] backdrop-blur-md"
      style={{ bottom, borderColor: GREEN, animation: 'oasis-time-up 1.2s ease-in-out infinite' }}
    >
      <style>{'@keyframes oasis-time-up { 0%, 100% { box-shadow: 0 0 10px rgba(52,211,153,0.35) } 50% { box-shadow: 0 0 34px rgba(52,211,153,0.95) } }'}</style>
      <span className="text-[15px] font-bold" style={{ color: GREEN }}>⏰ Time&rsquo;s up</span>
      <span className="max-w-[260px] truncate text-[14px] font-bold">{active.title}</span>
      <TimeUpButtons startedAt={active.startedAt} compact />
      <span className="text-[11px] text-white/55">ends by itself, kept, in {left} min</span>
    </div>
  )
}

/** The one that just ended: kept or not, minutes, XP, who was told. */
export function LastRun({ snapshot }: { snapshot: WorkSnapshot }) {
  const last = snapshot.lastRun
  if (!last || snapshot.active?.run) return null
  const color = last.plannedSeconds === null || last.kept ? GREEN : RED
  return (
    <div data-own-mission="ended" className="mt-2 rounded-md border px-2 py-1.5 text-[12.5px] leading-snug" style={{ borderColor: `${color}55`, background: `${color}10` }}>
      <div><b style={{ color }}>{last.title}</b>: {last.line}</div>
      <div className="text-white/60">
        {last.away >= 60 ? `${formatClock(last.counted)} in the Oasis, ${formatClock(last.away)} outside it (in Mindcraft, Today: you can take that back). ` : ''}
        {last.told ? `Your notes went to ${last.told}.` : 'Nobody was sent your notes.'}
      </div>
    </div>
  )
}

/**
 * Minutes with a left and a right arrow (the owner, 2026-11-23: the browser's "two miniature little arrows" are too
 * small): ◀ fewer, ▶ more, the number typed in between.
 */
export function MinutesStepper({ value, onChange, disabled = false, label = 'min' }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const n = Number(value) || 0
  const arrow = { width: 30, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 } as const
  return (
    <span data-own-mission="minutes-stepper" className={`inline-flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`}>
      <button type="button" disabled={disabled} onClick={() => onChange(String(stepMinutes(n, -1)))} className="mc-field font-bold text-amber-100 hover:brightness-150" style={arrow} title="Fewer minutes" aria-label="Fewer minutes"><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M9 1 2 6l7 5z" fill="currentColor" /></svg></button>
      <input
        data-own-mission="minutes"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        className="mc-field w-[52px] px-1 py-1 text-center text-[15px] font-bold tabular-nums text-white outline-none"
      />
      <button type="button" disabled={disabled} onClick={() => onChange(String(stepMinutes(n, 1)))} className="mc-field font-bold text-amber-100 hover:brightness-150" style={arrow} title="More minutes" aria-label="More minutes"><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1l7 5-7 5z" fill="currentColor" /></svg></button>
      <span className="text-[12.5px] text-white/75">{label}</span>
    </span>
  )
}

const SCORE_HELP = {
  ease: '5: under 2 minutes · 4: up to 5 · 3: up to 15 · 2: up to an hour · 1: more',
  impact: '5: several agents or a release wait on it · 3: one next step · 1: taste, nothing waits',
  urgency: '5: today · 3: this week · 1: any time',
}

/** "New mission": a title, minutes (or open-ended), Start, or Save for later with scores. */
export function NewMission({ onStarted }: { onStarted?: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('60')
  const [openEnded, setOpenEnded] = useState(false)
  const names = useAgentNames()
  const [notify, setNotify] = useState<{ on: boolean; agent: string }>({ on: true, agent: '' })
  const agent = notify.agent || defaultAgent(names)
  const [later, setLater] = useState(false)
  // Commit: a day (0 = today … 13) and a time; the length is the minutes above.
  const [committing, setCommitting] = useState(false)
  const [dayOffset, setDayOffset] = useState(1)
  const [clock, setClock] = useState(() => { const d = new Date(Date.now() + 3600_000); return `${String(d.getHours()).padStart(2, '0')}:00` })
  const commitAt = (() => {
    const [h, m] = clock.split(':').map(Number)
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h || 0, m || 0).getTime()
  })()
  const commitBonus = commitBonusPct(Date.now(), commitAt)
  const [scores, setScores] = useState<{ ease: number | null; impact: number; urgency: number }>({ ease: null, impact: 3, urgency: 3 })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const length = openEnded ? null : Math.max(1, Math.min(24 * 60, Math.round(Number(minutes) || 0))) || null
  const ease = scores.ease ?? easeFromMinutes(length)

  if (!open) {
    return (
      <div className="mt-2">
        <button type="button" data-own-mission="new" onClick={() => { setOpen(true); setNote('') }} className="mc-btn" data-tone="go">＋ New mission</button>
        {note && <div className="mt-1 text-[12px] text-emerald-200/90">{note}</div>}
      </div>
    )
  }
  const reset = () => {
    setTitle('')
    setLater(false)
    setScores({ ease: null, impact: 3, urgency: 3 })
    setOpen(false)
  }
  const start = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    const answer = await startOwnRun({ title: title.trim(), minutes: length, notify: notify.on ? agent : null })
    setBusy(false)
    if (answer.error) return setError(answer.error)
    reset()
    onStarted?.()
  }
  const commit = async () => {
    if (!title.trim() || busy || !length) return
    setBusy(true)
    setError('')
    const answer = await commitOwnRun({ title: title.trim(), at: commitAt, minutes: length, notify: notify.on ? agent : null })
    setBusy(false)
    if (answer.error) return setError(answer.error)
    setCommitting(false)
    reset()
    setNote(`Committed: “${title.trim()}”, ${commitWhen(commitAt)}${commitBonus ? `, +${commitBonus}% if kept` : ''}. The bell rings when it is due.`)
  }
  const save = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    const answer = await saveOwnRun({ title: title.trim(), minutes: length, ease, impact: scores.impact, urgency: scores.urgency })
    setBusy(false)
    if (answer.error) return setError(answer.error)
    reset()
    setNote(`Saved to your list (Mindcraft, Carbon): “${title.trim()}”.`)
  }
  const scoreSelect = (key: 'ease' | 'impact' | 'urgency', value: number) => (
    <label className="flex items-center gap-1 text-[12px] text-white/75" title={SCORE_HELP[key]}>
      {key}
      <select value={value} onChange={event => setScores(s => ({ ...s, [key]: Number(event.target.value) }))} className="mc-field px-1 py-0.5 text-[12px] text-white outline-none">
        {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )
  return (
    <div data-own-mission="form" className="mc-card mt-2 p-2" onKeyDown={keepKeys}>
      <div className="mc-label">New mission</div>
      <input
        data-own-mission="title"
        value={title}
        autoFocus
        maxLength={140}
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void (committing ? commit() : later ? save() : start()) } }}
        placeholder="What: Academy, an hour with Conrad…"
        className="mc-field mt-1 w-full px-2 py-1 text-[14px] text-white outline-none placeholder:text-white/35"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/80">
        <MinutesStepper value={minutes} onChange={setMinutes} disabled={openEnded} />
        {!committing && (
          <label className="flex items-center gap-1" title="No set length: it counts up until you end it">
            <input type="checkbox" checked={openEnded} onChange={event => setOpenEnded(event.target.checked)} />
            open-ended
          </label>
        )}
      </div>
      <div className="mt-1.5">
        <NotifySwitch on={notify.on} agent={agent} onChange={(on, name) => setNotify({ on, agent: name })} />
      </div>
      {later && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {scoreSelect('ease', ease)}
          {scoreSelect('impact', scores.impact)}
          {scoreSelect('urgency', scores.urgency)}
        </div>
      )}
      {committing && (
        <div data-own-mission="commit-when" className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-white/80">
          <select value={dayOffset} onChange={event => setDayOffset(Number(event.target.value))} className="mc-field px-1 py-1 text-[13px] text-white outline-none">
            {Array.from({ length: 14 }, (_, i) => {
              const d = new Date(Date.now() + i * 86_400_000)
              const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              return <option key={i} value={i}>{i === 0 ? `today (${label})` : i === 1 ? `tomorrow (${label})` : label}</option>
            })}
          </select>
          <span>at</span>
          <input type="time" value={clock} onChange={event => setClock(event.target.value || clock)} className="mc-field px-1 py-0.5 text-[13px] text-white outline-none" />
          <span className="basis-full text-[11px] text-white/55">Kept if you start it within 15 minutes of its time and run it to its length. The further ahead, the bigger the bonus: +100% for a day ahead, growing evenly from now, at most +200% from two days ahead.</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {committing && (
          <button type="button" data-own-mission="commit" disabled={busy || !title.trim() || !length || commitAt < Date.now() + 60_000} onClick={() => { void commit() }} className="mc-btn" style={INLINE_BTN} data-tone="go" title="Commit it: the bell rings when it is due, and Telegram if no Oasis page is open">
            Commit · {commitWhen(commitAt)} · {commitAt < Date.now() + 60_000 ? 'pick a later time' : commitBonus ? `+${commitBonus}% if kept` : 'no bonus'}
          </button>
        )}
        {!later && !committing && <button type="button" data-own-mission="start" disabled={busy || !title.trim()} onClick={() => { void start() }} className="mc-btn" style={INLINE_BTN} data-tone="go">▶ Start</button>}
        {!later && !committing && <button type="button" data-own-mission="commit-open" disabled={busy} onClick={() => { setCommitting(true); setOpenEnded(false) }} className="mc-btn" style={INLINE_BTN} title="For a day and a time: worth more the further ahead">Commit…</button>}
        {!committing && <button type="button" data-own-mission="later" disabled={busy || (later && !title.trim())} onClick={() => { if (later) void save(); else setLater(true) }} className="mc-btn" style={INLINE_BTN}>{later ? 'Save to my list' : 'Save for later'}</button>}
        <button type="button" disabled={busy} onClick={() => (committing ? setCommitting(false) : later ? setLater(false) : reset())} className="mc-btn" style={INLINE_BTN}>{later || committing ? 'back' : 'cancel'}</button>
      </div>
      {error && <div className="mt-1 text-[12px] text-rose-300">{error}</div>}
    </div>
  )
}

/** One committed mission in the list: when, what, how long, the bonus; Start when it is due, × to call it off. */
function CommitRow({ c, canStart }: { c: Commitment; canStart: boolean }) {
  const [busy, setBusy] = useState(false)
  const now = Date.now()
  const state = commitStateAt(c, now)
  const due = state === 'pending' && commitInWindow(c, now)
  const go = async (job: () => Promise<unknown>) => { if (busy) return; setBusy(true); await job(); setBusy(false) }
  const color = state === 'kept' ? GREEN : state === 'missed' ? RED : due ? GREEN : '#f1dca8'
  return (
    <div data-own-mission="commit-row" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 py-1 text-[12.5px]">
      <span className="shrink-0 tabular-nums" style={{ color }}>{commitWhen(c.at)}</span>
      <span className="min-w-0 flex-1 break-words text-white">{c.title} <span className="text-white/55">· {minutesLabel(c.minutes * 60)}{c.bonusPct ? ` · +${c.bonusPct}%` : ''}</span></span>
      {state === 'kept' && <span style={{ color: GREEN }}>kept ✓</span>}
      {state === 'missed' && <span style={{ color: RED }}>missed</span>}
      {state === 'started' && <span style={{ color: AMBER }}>running</span>}
      {/* Start only when it is due: starting a later one early would cost its bonus. */}
      {state === 'pending' && canStart && due && (
        <button type="button" disabled={busy} onClick={() => { void go(() => startOwnRun({ commit: c.id, minutes: null, notify: c.notify ?? null })) }} className="mc-btn" style={{ ...INLINE_BTN, minWidth: 0, padding: '5px 10px 4px' }} data-tone={due ? 'go' : undefined} title={due ? `On time: +${c.bonusPct}% if you keep it` : 'Outside its window: it runs without the bonus, and the commitment counts as missed'}>
          ▶ {due ? 'Start' : 'start now'}
        </button>
      )}
      {state === 'pending' && !due && (
        <button type="button" disabled={busy} onClick={() => { void kitConfirm({ title: `Call off "${c.title}"?`, body: commitWhen(c.at), confirm: 'Call it off', danger: true }).then(ok => { if (ok) void go(() => uncommitOwnRun(c.id)) }) }} className="text-[13px] text-white/45 hover:text-rose-200" title="Call it off">✕</button>
      )}
    </div>
  )
}

/** His committed missions: today's and the coming days'. */
export function CommittedList({ snapshot, title = 'Committed' }: { snapshot: WorkSnapshot; title?: string }) {
  // Still ahead or under way; the kept and missed ones are in CommitHistory.
  const list = (snapshot.commits || []).filter(c => { const st = commitStateAt(c, Date.now()); return st === 'pending' || st === 'started' })
  if (!list.length) return null
  const running = Boolean(snapshot.active?.run)
  return (
    <div data-own-mission="committed" className="mc-card mt-2 px-2 py-1.5">
      <div className="mc-label">{title}</div>
      {list.map(c => <CommitRow key={c.id} c={c} canStart={!running} />)}
    </div>
  )
}

/** The commitments he has been through: kept ones with their bonus (their glory), missed ones plainly. */
export function CommitHistory({ snapshot }: { snapshot: WorkSnapshot }) {
  const list = snapshot.commitsDone || []
  if (!list.length) return null
  const kept = list.filter(c => c.state === 'kept')
  const bonus = kept.reduce((sum, c) => sum + (c.bonusXp || 0), 0)
  return (
    <div data-own-mission="commit-history" className="mc-card mt-2 px-2 py-1.5">
      <div className="mc-label">Commitments kept: {kept.length} of {list.length}{bonus ? ` · +${Math.round(bonus)} XP of bonus` : ''}</div>
      {list.map(c => (
        <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-white/5 py-1 text-[12.5px]">
          <span className="shrink-0" style={{ color: c.state === 'kept' ? GREEN : RED }}>{c.state === 'kept' ? '✓ kept' : '× missed'}</span>
          <span className="shrink-0 tabular-nums text-white/60">{commitWhen(c.at)}</span>
          <span className="min-w-0 flex-1 break-words text-white">{c.title} <span className="text-white/55">· {minutesLabel(c.minutes * 60)}{c.bonusPct ? ` · +${c.bonusPct}%` : ''}</span></span>
          {c.state === 'kept' && c.bonusXp ? <span className="shrink-0 font-bold" style={{ color: GREEN }}>+{Math.round(c.bonusXp * 10) / 10} XP</span> : null}
        </div>
      ))}
    </div>
  )
}

/** The bar over the counter when a committed mission is due: Start, with its bonus, until its window closes. */
export function CommitDueBar({ snapshot, bottom }: { snapshot: WorkSnapshot; bottom: number }) {
  const [busy, setBusy] = useState(false)
  if (snapshot.active?.run) return null
  const now = Date.now()
  const due = (snapshot.commits || []).find(c => commitStateAt(c, now) === 'pending' && commitInWindow(c, now) && now >= c.at - 60_000)
  if (!due) return null
  const until = new Date(due.at + COMMIT_GRACE_MS).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <div
      data-own-mission="commit-due-bar"
      className="mc-scope fixed left-3 z-[calc(var(--z-hud)_+_11)] flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-2 rounded-xl border-2 bg-slate-950/90 px-3 py-2 text-white backdrop-blur-md"
      style={{ bottom, borderColor: AMBER, animation: 'oasis-commit-due 1.2s ease-in-out infinite' }}
    >
      <style>{'@keyframes oasis-commit-due { 0%, 100% { box-shadow: 0 0 10px rgba(251,191,36,0.35) } 50% { box-shadow: 0 0 34px rgba(251,191,36,0.95) } }'}</style>
      <span className="text-[15px] font-bold" style={{ color: AMBER }}>⏰ Due now</span>
      <span className="max-w-[260px] truncate text-[14px] font-bold">{due.title}</span>
      <span className="text-[12px] text-white/70">{minutesLabel(due.minutes * 60)}{due.bonusPct ? ` · +${due.bonusPct}% if kept` : ''}</span>
      <button type="button" disabled={busy} onClick={() => { setBusy(true); void startOwnRun({ commit: due.id, minutes: null, notify: due.notify ?? null }).finally(() => setBusy(false)) }} className="mc-btn" style={{ ...INLINE_BTN, minWidth: 0, padding: '6px 12px 5px' }} data-tone="go">▶ Start</button>
      <span className="text-[11px] text-white/55">on time until {until}</span>
    </div>
  )
}

/** The counter's line while a mission runs: its name and its clock. Null when none runs. */
export function runningClock(snapshot: WorkSnapshot | null, now: number): { title: string; seconds: number; share: number | null; over: boolean; paused: boolean } | null {
  const active = snapshot?.active
  if (!active?.run) return null
  const clock = runClock(active.startedAt, active.run, now)
  return { title: active.title, ...clock, paused: active.run.pausedAt !== null }
}

export { AMBER as RUN_AMBER, GREEN as RUN_GREEN }
