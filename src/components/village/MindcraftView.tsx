'use client'

// ░▒▓ MINDCRAFT — the list of days: what was worked on, how long, how much XP ▓▒░
// Self-contained: <MindcraftView /> fills whatever holds it (a menu tile's page, a window) and needs
// nothing but /api/village/work. <MindcraftWindow /> is the same view as a window over the world; it
// opens on the `oasis:open-mindcraft` window event (openMindcraft()).
//
// Tabs: Mine (the owner's days), The Oasis (all agents together), and one per agent. A day is one
// row; click it and it opens into its units of work: one per mission, one for time with agents, one
// for just being in the Oasis. Never a row per turn.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMindcraftLook } from './mindcraft-look'
import { ManualTimeForm } from './ManualTimeForm'
import { CarbonMissions } from './CarbonMissions'
import { HoursChart, type RebuiltDays } from './MindcraftChart'
import { CommittedList, runningClock } from './OwnMissionPanel'
import { useLiveWork } from './useLiveWork'
import { useKitStyle } from '@/components/ui-kit'
import { layerZ, raiseLayer, useLayer } from '@/lib/ui-kit/layers'
import { setWorkInMindcraft } from './work-vow-client'
import { addDays, formatClock, type MindcraftBook, type MindcraftDay, type WorkSnapshot, type WorkUnit } from '../../lib/village/work-vow'

const UNIT_COLOR = { mission: '#38bdf8', agent: '#c084fc', free: '#34d399', manual: '#f59e0b' }

export const MINDCRAFT_EVENT = 'oasis:open-mindcraft'

/** Open the Mindcraft window from anywhere (a menu tile, a key, the work counter). */
export function openMindcraft(carbonFile?: string): void {
  window.dispatchEvent(new CustomEvent(MINDCRAFT_EVENT, { detail: carbonFile ? { carbon: carbonFile } : {} }))
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** `1:23:45`, spelled so nobody misreads it: hours, minutes, seconds. */
function hms(seconds: number): string {
  return formatClock(seconds)
}

function UnitRow({ unit, date, onRemoveManual }: { unit: WorkUnit; date: string; onRemoveManual?: (date: string, index: number) => void }) {
  const [open, setOpen] = useState(false)
  const foldable = Boolean(unit.parts?.length)
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-start gap-3 text-white/90 ${foldable ? 'cursor-pointer' : ''}`} onClick={foldable ? () => setOpen(value => !value) : undefined}>
        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: UNIT_COLOR[unit.kind] }} />
        <span className="min-w-0 flex-1 break-words">
          {foldable ? (open ? '▾ ' : '▸ ') : ''}{unit.label}
          {/* XP is time; the mission only says what the time went to. */}
          {unit.kind === 'agent' && !unit.parts && (
            <span className="text-white/55">
              {unit.mission ? <> · on “{unit.mission}”</> : <> · no mission named</>}
              {unit.split ? <> · own {hms(unit.split.own)} + helpers {hms(unit.split.helpers)}</> : null}
            </span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-right font-bold tabular-nums">{hms(unit.seconds)}</span>
        {unit.kind === 'manual' && typeof unit.manualIndex === 'number' && onRemoveManual && (
          <button
            type="button"
            data-mindcraft="manual-delete"
            title="Delete this entry"
            onClick={event => { event.stopPropagation(); onRemoveManual(date, unit.manualIndex as number) }}
            className="shrink-0 rounded border border-rose-300/40 bg-rose-500/15 px-2 py-0.5 text-[12px] font-bold text-rose-100 hover:bg-rose-500/35"
          >
            delete
          </button>
        )}
      </div>
      {open && unit.parts && (
        <div className="ml-5 flex flex-col gap-0.5 border-l border-white/10 pl-3">
          {unit.parts.map(part => (
            <div key={part.label} className="flex items-start gap-3 text-white/75">
              <span className="min-w-0 flex-1 break-words">{part.label}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{hms(part.seconds)}</span>
              <span className="min-w-[78px] shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DayList({ days, today, target, empty, onRemoveManual, liveToday }: { days: MindcraftDay[]; today: string; target: number | null; empty: string; onRemoveManual?: (date: string, index: number) => void; liveToday?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!days.length) return <div className="py-6 text-center text-white/45">{empty}</div>
  // Today's row runs with the clock (the owner, 2026-11-23: "it needs to be real time").
  const secondsOf = (day: MindcraftDay) => (day.date === today && liveToday !== undefined ? Math.max(day.seconds, liveToday) : day.seconds)
  const top = Math.max(1, ...days.map(secondsOf))
  return (
    <div className="flex flex-col gap-1.5">
      {days.map(raw => {
        const day = { ...raw, seconds: secondsOf(raw) }
        const isOpen = open[day.date] ?? day.date === today
        const hit = target !== null && day.seconds >= target
        return (
          <div key={day.date} className="mc-card">
            <button type="button" onClick={() => setOpen(value => ({ ...value, [day.date]: !isOpen }))} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5">
              <span className="w-3 text-white/50">{isOpen ? '▾' : '▸'}</span>
              <span className="mc-strong w-[136px] shrink-0 text-[14px]">{dayLabel(day.date)}{day.date === today ? ' · today' : ''}</span>
              <span className="mc-track min-w-0 flex-1">
                <span className="block h-full" style={{ width: `${(day.seconds / (target ? Math.max(target, top) : top)) * 100}%`, background: hit ? '#34d399' : '#fbbf24' }} />
              </span>
              {/* Hours only on screen (the owner, 2026-11-22: "hours"); XP is in the counter's detail, where it feeds the Profile level. */}
              <span className="shrink-0 whitespace-nowrap text-right text-[17px] font-bold tabular-nums" style={{ color: hit ? '#34d399' : '#fff' }}>{hms(day.seconds)}</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-2">
                {day.units.map((unit, index) => <UnitRow key={index} unit={unit} date={day.date} onRemoveManual={onRemoveManual} />)}
                {(day.bonusXp || day.penaltyXp) ? (
                  <div className="mt-1 text-white/55">
                    {day.bonusXp ? <>The day was kept.</> : <>The day fell short of the vow.</>}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The agents' missions (docs/missions). The owner, 2026-11-23: what do "open", "doing" and the golden scores mean, and
 * is the list true? So each line says who has it and when an agent last worked on it (from the agents' hours, not
 * from the file's word); "in hand" only if that was today or yesterday (48 h). The rest waits, longest-idle last.
 */
function AgentMissionBoard({ today }: { today: string }) {
  const [list, setList] = useState<Array<{ file: string; title: string; column: string; state: string; who: string; priority: number | null; tldr: string }> | null>(null)
  const [activity, setActivity] = useState<Record<string, { last: string; seconds: number; agents: Record<string, number> }>>({})
  useEffect(() => {
    let gone = false
    fetch('/api/village/missions', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: { missions?: typeof list } | null) => { if (!gone) setList(data?.missions || []) })
      .catch(() => { if (!gone) setList([]) })
    fetch('/api/village/work?missions=1', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: { activity?: typeof activity } | null) => { if (!gone && data?.activity) setActivity(data.activity) })
      .catch(() => {})
    return () => { gone = true }
  }, [])
  if (!list?.length) return null
  const yesterday = addDays(today, -1)
  const open = list.filter(m => m.column !== 'done').map(m => {
    const a = activity[m.file]
    const top = a ? Object.entries(a.agents).sort((x, y) => y[1] - x[1]).map(([name]) => name).slice(0, 3) : []
    return { ...m, last: a?.last || '', inHand: Boolean(a && a.last >= yesterday), workers: top }
  }).sort((a, b) => Number(b.inHand) - Number(a.inHand) || b.last.localeCompare(a.last) || (b.priority ?? 0) - (a.priority ?? 0))
  const when = (date: string) => (!date ? 'no agent time counted on it yet' : date === today ? 'last worked on today' : date === yesterday ? 'last worked on yesterday' : `last worked on ${dayLabel(date)}`)
  const inHand = open.filter(m => m.inHand).length
  return (
    <div className="mc-card flex flex-col gap-1 px-3 py-2" data-mindcraft="silicon-missions">
      <div className="mc-strong text-[14px]">The agents&rsquo; missions: {inHand} in hand, {open.length - inHand} waiting</div>
      <div className="text-[12.5px] text-white/55">In hand: an agent worked on it today or yesterday (counted from the agents&rsquo; hours). The number is its priority, ease × impact × urgency ÷ 125: what is done next, not what it pays.</div>
      {open.map(m => (
        <div key={m.file} className="flex items-start gap-3 text-white/85">
          <span className="w-[66px] shrink-0 pt-[2px] text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: m.inHand ? '#34d399' : 'rgba(255,255,255,0.4)' }}>{m.inHand ? 'in hand' : 'waiting'}</span>
          <span className="min-w-0 flex-1 break-words">{m.title} <span className="text-white/50">· {m.who ? `who: ${m.who}` : 'nobody named'} · {when(m.last)}{m.workers.length && m.workers.join(', ').toLowerCase() !== (m.who || '').toLowerCase() ? ` (by ${m.workers.join(', ')})` : ''}</span></span>
          <span className="w-[42px] shrink-0 text-right tabular-nums text-white/55" title="priority: ease × impact × urgency ÷ 125">{m.priority === null ? '—' : m.priority.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Today, beside the chart in Carbon (the Today tab folded into it, 2026-11-23: the owner found the tab was "all the
 * other days"): the mission running now, today's hours by what they went to, his own missions that ended today, and
 * adding (or taking back) time by hand. Earlier days are in the chart; their entries fold out at the bottom.
 */
function TodayCard({ book, snapshot, onRemoveManual, onSaved }: { book: MindcraftBook; snapshot: WorkSnapshot; onRemoveManual: (date: string, index: number) => void; onSaved: () => void }) {
  const [manual, setManual] = useState(false)
  const [earlier, setEarlier] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick(n => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const run = runningClock(snapshot, Date.now())
  const live = useLiveWork()
  const today = book.owner.filter(day => day.date === snapshot.date)
  return (
    <div className="mc-card flex min-w-[280px] flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2" style={{ maxHeight: 372 }} data-mindcraft="today">
      <div className="flex items-baseline justify-between gap-2">
        <div className="mc-strong text-[14px]">Today</div>
        <div className="text-[17px] font-bold tabular-nums">{hms(Math.max(snapshot.today.seconds, live.mine))}{snapshot.targetSeconds !== null && <span className="text-white/45"> / {hms(snapshot.targetSeconds)}</span>}</div>
      </div>
      {run
        ? <div className="rounded border border-amber-300/30 bg-amber-400/5 px-2 py-1"><b>{run.title}</b> <span className="tabular-nums text-amber-200">{formatClock(run.seconds)}</span> <span className="text-white/55">{run.paused ? 'paused' : run.share === null ? 'so far' : 'to go'} · notes and end: the counter, bottom left</span></div>
        : <div className="text-white/55">No mission of yours running. Start one from the counter, bottom left: “New mission”.</div>}
      {snapshot.runs.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {snapshot.runs.map((r, i) => <div key={i} className="text-white/85"><span style={{ color: r.plannedSeconds === null || r.kept ? '#34d399' : '#f87171' }}>{r.plannedSeconds === null || r.kept ? '✓' : '×'}</span> {r.title}: {r.plannedSeconds === null ? 'done' : r.kept ? 'kept' : 'not kept'} · {hms(r.seconds)}{r.told ? ' · notes to ' + r.told : ''}</div>)}
        </div>
      )}
      <CommittedList snapshot={snapshot} title="Committed: today and the coming days" />
      <DayList days={today} today={snapshot.date} target={snapshot.targetSeconds} onRemoveManual={onRemoveManual} empty="Nothing counted yet today." liveToday={live.mine} />
      <div className="flex flex-wrap gap-3 text-[13px]">
        <button type="button" className="text-amber-200/85 underline decoration-dotted" onClick={() => setManual(v => !v)}>{manual ? 'close' : 'add time by hand'}</button>
        <button type="button" className="text-amber-200/85 underline decoration-dotted" onClick={() => setEarlier(v => !v)}>{earlier ? 'hide earlier days' : 'earlier days'}</button>
      </div>
      {manual && <ManualTimeForm today={snapshot.date} targetSeconds={snapshot.targetSeconds ?? undefined} daySeconds={date => book.owner.find(day => day.date === date)?.seconds || 0} onSaved={onSaved} />}
      {earlier && <DayList days={book.owner.filter(day => day.date !== snapshot.date)} today={snapshot.date} target={snapshot.targetSeconds} onRemoveManual={onRemoveManual} empty="No earlier days." />}
    </div>
  )
}

export function MindcraftView({ carbonFile }: { carbonFile?: string | null } = {}) {
  useMindcraftLook() // the look (textures, typefaces) lives in mindcraft-look.tsx; this file carries its class names
  // Time in Mindcraft is work at valor 1 (the owner, 2026-11-20), wherever this view is shown.
  useEffect(() => {
    setWorkInMindcraft(true)
    return () => setWorkInMindcraft(false)
  }, [])
  const [book, setBook] = useState<(MindcraftBook & { rebuilt?: RebuiltDays }) | null>(null)
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null)
  // Carbon: what the Oasis needs from him. Silicon: what the agents did. Today: his own time (the owner, 2026-11-20).
  const [tab, setTab] = useState<'carbon' | 'silicon'>('carbon')
  const live = useLiveWork()
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([
        fetch('/api/village/work?mindcraft=1', { cache: 'no-store' }),
        fetch('/api/village/work', { cache: 'no-store' }),
      ])
      if (!b.ok || !s.ok) throw new Error(`the work book answered ${b.ok ? s.status : b.status}`)
      setBook(await b.json() as MindcraftBook)
      setSnapshot(await s.json() as WorkSnapshot)
      setError('')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    }
  }, [])
  // The lists move slowly: on open, then every 30 s while it is looked at.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const post = async (body: unknown) => {
    await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    void load()
  }
  const removeManual = (date: string, index: number) => {
    const entry = book?.owner.find(day => day.date === date)?.units.find(unit => unit.manualIndex === index)
    if (entry && window.confirm(`Delete "${entry.label}" (${formatClock(entry.seconds)}) from ${date}?`)) void post({ manual: { date, remove: index } })
  }

  if (error && !book) return <div className="p-6 text-rose-200">Mindcraft can&rsquo;t read the work book: {error}</div>
  if (!book || !snapshot) return <div className="p-6 text-white/50">Opening the book…</div>

  // Every running figure ticks: his time and the agents' (turns running now included).
  const mine = Math.max(snapshot.today.seconds, live.mine)
  const theirs = Math.max(snapshot.agentHours?.today || 0, live.agents)
  const tabs = [
    { id: 'carbon' as const, label: 'Carbon', sub: `you today ${hms(mine)}` },
    { id: 'silicon' as const, label: 'Silicon', sub: `agents today ${hms(theirs)}` },
  ]
  const vow = snapshot.commitments[0]
  return (
    <div className="mc-scope flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 pr-14 pt-4">
        <div className="pl-1">
          <div className="mc-title text-[34px] leading-none tracking-[0.06em]">Mindcraft</div>
          <div className="mt-1.5 text-[19px] text-white/80">
            Today <b className="tabular-nums text-white">{hms(mine)}</b>{snapshot.targetSeconds !== null && <span className="text-white/45"> / {hms(snapshot.targetSeconds)}</span>} · agents <b className="tabular-nums text-violet-200">{hms(theirs)}</b>
          </div>
          {vow && (
            <div className="mc-note" style={{ fontSize: 21 }}>
              {vow.label}.
            </div>
          )}
        </div>
        <label className="mc-field flex items-center gap-2 px-2.5 py-1.5" title="What a minute is worth when no agent and no mission is open">
          Valor with nothing in focus
          <select
            value={String(snapshot.settings.freeValor)}
            onChange={event => { void post({ settings: { freeValor: Number(event.target.value) } }) }}
            onKeyDown={event => event.stopPropagation()}
            className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-white"
          >
            {[...new Set([0, 0.3, 0.5, 0.7, 0.8, 1, snapshot.settings.freeValor])].sort((a, b) => a - b).map(value => <option key={value} value={String(value)}>×{value}</option>)}
          </select>
        </label>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2.5 px-1 pb-1">
        {tabs.map(item => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className="mc-tab" style={{ minWidth: 220 }} data-on={tab === item.id ? '1' : '0'}>
            <div>{item.label}</div>
            <div>{item.sub}</div>
          </button>
        ))}
      </div>
      {/* Carbon fills the space and scrolls inside its own list; the other tabs scroll here. */}
      <div className={`min-h-0 flex-1 pr-1 ${tab === 'carbon' ? 'flex flex-col gap-3' : 'overflow-y-auto'}`}>
        {tab === 'carbon' && (
          <>
            {/* Top left the chart, beside it today (the owner, 2026-11-23). */}
            <div className="flex shrink-0 flex-wrap items-start gap-3">
              <div style={{ flex: '0 1 640px', minWidth: 320 }}><HoursChart owner={book.owner} oasis={book.oasis} today={snapshot.date} liveToday={{ carbon: mine, silicon: theirs }} rebuilt={book.rebuilt ?? null} /></div>
              <TodayCard book={book} snapshot={snapshot} onRemoveManual={removeManual} onSaved={() => { void load() }} />
            </div>
            <CarbonMissions key={carbonFile || ''} initialFile={carbonFile || null} />
          </>
        )}
        {tab === 'silicon' && (
          <div className="flex flex-col gap-3">
            {/* Top left the chart; beside it the last two days, today open, each agent and its time. */}
            <div className="flex flex-wrap items-start gap-3">
              <div style={{ flex: '0 1 640px', minWidth: 320 }}><HoursChart owner={book.owner} oasis={book.oasis} today={snapshot.date} liveToday={{ carbon: mine, silicon: theirs }} rebuilt={book.rebuilt ?? null} /></div>
              <div className="min-w-[280px] flex-1 overflow-y-auto" style={{ maxHeight: 372 }}>
                <DayList days={book.oasis.slice(0, 2)} today={snapshot.date} target={null} empty="No agent has finished a turn yet while an Oasis page was listening." liveToday={theirs} />
              </div>
            </div>
            {snapshot.agentHours && (
              <div className="mc-card px-3 py-2 text-[14px] leading-snug">
                <div className="mc-strong">The Oasis worked {hms(theirs)} today{snapshot.agentHours.mark ? `: ${snapshot.agentHours.mark}` : ''} · yesterday {hms(snapshot.agentHours.yesterday)}</div>
                <div className="text-white/60">24 h of agent work in a day: alive · 72 h: superalive · 168 h: uploaded. An agent-hour is time inside an agent&rsquo;s turns (minus time it only waited on its helpers) plus its helpers&rsquo; time; time between turns doesn&rsquo;t count. Helpers working at once each count.</div>
              </div>
            )}
            {book.agents.length > 0 && (
              <div className="mc-card flex flex-col gap-1 px-3 py-2">
                <div className="mc-strong text-[14px]">All days: who worked longest</div>
                {book.agents.map(agent => (
                  <UnitRow key={agent.key} date="" unit={{ kind: 'agent', label: agent.name, seconds: agent.seconds, xp: agent.xp, ...(agent.mission ? { mission: agent.mission } : {}), ...(typeof agent.priority === 'number' ? { priority: agent.priority } : {}) }} />
                ))}
              </div>
            )}
            {book.oasis.length > 2 && <DayList days={book.oasis.slice(2)} today={snapshot.date} target={null} empty="" />}
            <AgentMissionBoard today={snapshot.date} />
          </div>
        )}
      </div>
      <div className="mc-foot shrink-0 pt-2 leading-snug" style={{ fontSize: 16, display: tab === 'carbon' ? 'none' : undefined }}>
        Hours are what counts here. Behind them, in the counter&rsquo;s detail and your Profile level, XP is time: 1 XP a minute of work, for you and for every agent; 0.7 only for time in the world with nothing in focus. A mission&rsquo;s priority decides what comes next, not what it pays. A day runs from {snapshot.settings.dayStartsAt} to {snapshot.settings.dayStartsAt}.
      </div>
    </div>
  )
}

// Its layer (Hipster's one order, src/lib/ui-kit/layers.ts): the panel layer, with the agent panels, so whichever
// opened last is on top (the owner, 2026-11-22: Mindcraft opened over an agent panel is above it; an agent opened from
// Mindcraft is above Mindcraft). Above the HUD, so over the rail's World and Spells buttons (the owner, 2026-11-23);
// below the spell book, Settings, the main menu and dialogs. Esc closes it when it is the topmost.
// Nearly full screen (the owner: "honestly, that could be full screen somehow"), between the always-on buttons.
// The same margin on all four sides (the owner, 2026-11-23: "horizontally 95 percent, vertically only about 90").
const WINDOW_MAX_WIDTH = 1800
const WINDOW_GAP = 28

/**
 * Where the window may stand: between the always-on overlays that sit above it (the game rail on the
 * left, the key hints on the right), so it opens beside them, never under them (the owner, 2026-11-20).
 * Measured from the page, so a restyled rail or a phone layout needs no change here.
 */
export function clearBand(viewportWidth: number, obstacles: Array<{ left: number; right: number }>): { left: number; right: number } {
  let left = 0
  let right = viewportWidth
  for (const box of obstacles) {
    const middle = (box.left + box.right) / 2
    if (middle < viewportWidth / 2) left = Math.max(left, box.right)
    else right = Math.min(right, box.left)
  }
  // Too narrow beside them (a phone): use the whole width; the window then covers the rail, as before.
  if (right - left < 360) return { left: 0, right: viewportWidth }
  return { left, right }
}

/** Fixed, narrow overlays at an edge that stand above `minZ` (the game rail, the key hints). */
export function overlayObstacles(minZ = layerZ('panel'), ignore = '[data-ui-panel="mindcraft"]'): Array<{ left: number; right: number }> {
  const out: Array<{ left: number; right: number }> = []
  const vw = window.innerWidth
  const vh = window.innerHeight
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('body *'))) {
    const style = getComputedStyle(el)
    if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
    const z = Number.parseInt(style.zIndex, 10)
    if (!Number.isFinite(z) || z <= minZ) continue
    if (el.closest(ignore)) continue
    const box = el.getBoundingClientRect()
    // Edge overlays only: narrow, inside the window's height band, not full-screen layers or bars.
    if (box.width <= 0 || box.height <= 0 || box.width > vw * 0.4 || box.bottom < vh * 0.05 || box.top > vh * 0.95) continue
    out.push({ left: box.left, right: box.right })
  }
  return out
}

/** The view as a window over the world. Esc or a click outside closes it. */
export function MindcraftWindow() {
  const kitStyle = useKitStyle()
  const [open, setOpen] = useState(false)
  const [carbonFile, setCarbonFile] = useState<string | null>(null)
  // On the panel layer: the later opened (or clicked) of Mindcraft and an agent panel is on top; Esc closes the topmost.
  const z = useLayer('mindcraft', 'panel', open, () => setOpen(false))
  const zRef = useRef(z)
  zRef.current = z
  useEffect(() => {
    const onOpen = (event: Event) => {
      const file = (event as CustomEvent<{ carbon?: string }>).detail?.carbon
      setCarbonFile(typeof file === 'string' ? file : null)
      raiseLayer('mindcraft', 'panel')
      setOpen(true)
    }
    window.addEventListener(MINDCRAFT_EVENT, onOpen)
    return () => window.removeEventListener(MINDCRAFT_EVENT, onOpen)
  }, [])
  // Beside the always-on buttons, not under them: measured on open and on every resize.
  const [band, setBand] = useState<{ left: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    // Only what stands above Mindcraft is in its way (the HUD and its rail are below it).
    const measure = () => setBand(clearBand(window.innerWidth, overlayObstacles(zRef.current)))
    measure()
    const late = window.setTimeout(measure, 300) // overlays that settle after the first paint
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  }, [open, z])
  if (!open) return null
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const area = band || { left: 0, right: vw }
  const width = Math.max(0, Math.min(WINDOW_MAX_WIDTH, area.right - area.left - WINDOW_GAP * 2))
  const left = area.left + (area.right - area.left - width) / 2
  // Top and bottom as far from the edge as left and right (a wide screen caps the width, not the height).
  const margin = Math.min(WINDOW_GAP * 2, Math.max(WINDOW_GAP, left - area.left))
  return (
    <>
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" style={{ zIndex: z - 1 }} onClick={() => setOpen(false)} />
      <div
        data-ui-panel="mindcraft"
        // A kit panel (Hipster's UI kit), so the one menu-style switch reaches Mindcraft too.
        data-kit-style={kitStyle}
        className="kit-panel fixed flex flex-col px-2 pb-1 pt-0"
        style={{ left, width, top: margin, bottom: margin, zIndex: z }}
        onPointerDown={() => raiseLayer('mindcraft', 'panel')}
      >
        <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" className="mc-scope absolute right-1 top-1 z-10"><span className="mc-close flex items-center justify-center">✕</span></button>
        <MindcraftView carbonFile={carbonFile} />
      </div>
    </>
  )
}
