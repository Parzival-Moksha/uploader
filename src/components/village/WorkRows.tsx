'use client'

// ░▒▓ WORK ROWS — his time and the agents' time as plain rows, the same shape in the small panel and in Mindcraft ▓▒░
// The owner, 2026-11-25: the bars with percentages go ("96% of what?"); the minutes and XP stay. His work is grouped and
// expandable, sorted by time; then a separator; then the agents' time. Carbon and Silicon rhyme: one row style for both.
// The agents working right now stand out (bigger, a glow) and their own timers tick every second.

import { useEffect, useState } from 'react'
import { formatClock, localMidnight, type WorkDaySummary } from '../../lib/village/work-vow'
import type { WorkingAgent } from './useLiveWork'

export interface WorkRow {
  key: string
  label: string
  seconds: number
  xp?: number
  /** What it was on (an agent's mission), shown small after the name. */
  note?: string
  children?: WorkRow[]
  /** Working right now: highlighted, its time ticking. */
  live?: boolean
}

const CARBON = '#f1dca8'
const SILICON = '#d8b4fe'

/** His day as rows: each mission, his time with agents (opens into each agent), in the Oasis, added by hand. */
export function carbonRows(summary: WorkDaySummary | undefined): WorkRow[] {
  if (!summary) return []
  const rows: WorkRow[] = summary.topXp.map((t, i) => ({ key: `${t.kind}:${t.label}:${i}`, label: t.label, seconds: t.seconds, xp: t.xp }))
  const withAgents = rows.find(r => r.label === 'With agents')
  if (withAgents && summary.agents.length) withAgents.children = summary.agents.map(a => ({ key: `a:${a.key}`, label: a.name, seconds: a.seconds }))
  return rows.filter(r => r.seconds >= 1).sort((a, b) => b.seconds - a.seconds)
}

/** The agents' day as rows, the working ones on top of their own time, ticking (re-rendered each second by the caller). */
export function siliconRows(agents: Array<{ key: string; name: string; seconds: number; xp?: number; mission?: string }>, working: WorkingAgent[], now: number): WorkRow[] {
  const dayStart = localMidnight(now)
  const byName = new Map(agents.map(a => [a.name.toLowerCase(), a]))
  const rows: WorkRow[] = agents.map(a => ({ key: `s:${a.key}`, label: a.name, seconds: a.seconds, xp: a.xp, note: a.mission }))
  for (const w of working) {
    const running = Math.max(0, now - Math.max(w.since, dayStart)) / 1000
    const known = byName.get(w.name.toLowerCase())
    const row = known ? rows.find(r => r.key === `s:${known.key}`) : null
    if (row) {
      row.seconds += running
      row.live = true
    } else {
      rows.push({ key: `w:${w.id}`, label: w.name, seconds: running, live: true })
    }
  }
  return rows.filter(r => r.seconds >= 1 || r.live).sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || b.seconds - a.seconds)
}

/** One second's tick for the live rows. */
export function useSecond(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function Row({ row, tone, depth = 0, shade = false }: { row: WorkRow; tone: 'carbon' | 'silicon'; depth?: number; shade?: boolean }) {
  const [open, setOpen] = useState(false)
  const color = tone === 'carbon' ? CARBON : SILICON
  const canOpen = Boolean(row.children?.length)
  return (
    <>
      <div
        data-work-row={row.live ? 'live' : 'row'}
        className={`flex items-baseline justify-between gap-2 rounded-sm px-1.5 py-0.5 ${canOpen ? 'cursor-pointer hover:bg-white/10' : ''}`}
        style={{ paddingLeft: 6 + depth * 14, background: shade ? 'rgba(255,255,255,0.05)' : undefined }}
        onClick={canOpen ? () => setOpen(v => !v) : undefined}
      >
        <span className={`min-w-0 break-words ${row.live ? 'text-[17px] font-bold' : 'text-white/85'}`} style={row.live ? { color, textShadow: `0 0 10px ${color}aa` } : undefined}>
          {canOpen ? (open ? '▾ ' : '▸ ') : ''}
          {row.live && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full align-middle" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
          {row.label}
          {row.note && <span className="text-[11px] font-normal text-white/45"> · {row.note}</span>}
        </span>
        <span className={`shrink-0 tabular-nums ${row.live ? 'text-[17px] font-bold' : 'text-white/80'}`} style={row.live ? { color } : undefined}>
          {formatClock(row.seconds)}{typeof row.xp === 'number' ? <span className="text-white/45"> · {Math.round(row.xp * 10) / 10} XP</span> : null}
        </span>
      </div>
      {open && row.children?.map(child => <Row key={child.key} row={child} tone={tone} depth={depth + 1} />)}
    </>
  )
}

/** A list of rows; empty: a quiet line. */
export function WorkRowList({ rows, tone, empty }: { rows: WorkRow[]; tone: 'carbon' | 'silicon'; empty: string }) {
  if (!rows.length) return <div className="py-1 text-white/45">{empty}</div>
  return <div data-work-rows={tone} className="flex flex-col">{rows.map((row, index) => <Row key={row.key} row={row} tone={tone} shade={index % 2 === 1} />)}</div>
}

/** A small "how it counts" mark: the explainer as a tooltip, for newcomers (the owner, 2026-11-25). */
export function HowItCounts({ text, label = 'how it counts' }: { text: string; label?: string }) {
  return <span className="cursor-help text-[11px] text-white/45 underline decoration-dotted" title={text}>ⓘ {label}</span>
}
