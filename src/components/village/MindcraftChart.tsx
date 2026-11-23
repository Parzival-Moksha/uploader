'use client'

// ░▒▓ MINDCRAFT CHART — hours per day: his (carbon), the agents' (silicon), or both ▓▒░
// The owner, 2026-11-23: "I just wanna see the chart... the last seven days, selectable to the past 28 days... one for
// carbon, one for silicon, and a combined one... draw that number on the chart as a barrier, the 24 hours per day...
// that will give us a carbon to silicon ratio." One axis (hours), grouped bars, a dashed line at 24 agent-hours,
// the ratio under each day (agent hours per hour of his). Colors checked with the dataviz validator on the
// Mindcraft surface (#0d0f16): carbon #c98500, silicon #9d7bf0 (lightness, chroma, colour-blind pairs: pass).

import { useLayoutEffect, useRef, useState } from 'react'
import { addDays, type MindcraftDay } from '../../lib/village/work-vow'

export const CARBON_COLOR = '#c98500'
export const SILICON_COLOR = '#9d7bf0'
const ALIVE_HOURS = 24

type Series = 'carbon' | 'silicon' | 'both'

export interface ChartDay { date: string; carbon: number; silicon: number; rebuilt?: boolean }

/** Days before the counter began, rebuilt from the transcripts (seconds). */
export type RebuiltDays = { firstBookDay: string; rule: string; days: Record<string, { carbon: number; silicon: number }> } | null

/** The last `count` days up to today, oldest first, hours (missing days are 0). */
export function chartDays(owner: MindcraftDay[], oasis: MindcraftDay[], today: string, count: number, rebuilt: RebuiltDays = null): ChartDay[] {
  const mine = new Map(owner.map(day => [day.date, day.seconds]))
  const theirs = new Map(oasis.map(day => [day.date, day.seconds]))
  const out: ChartDay[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i)
    const old = rebuilt && date < rebuilt.firstBookDay ? rebuilt.days[date] : undefined
    if (old && !mine.has(date) && !theirs.has(date)) out.push({ date, carbon: old.carbon / 3600, silicon: old.silicon / 3600, rebuilt: true })
    else out.push({ date, carbon: (mine.get(date) || 0) / 3600, silicon: (theirs.get(date) || 0) / 3600 })
  }
  return out
}

/** Agent hours per hour of his, as "1 : 12"; "—" when he did not work that day. */
export function ratioLabel(carbon: number, silicon: number): string {
  if (carbon < 1 / 60) return silicon > 0 ? '—' : ''
  const r = silicon / carbon
  return `1 : ${r >= 10 ? Math.round(r) : Math.round(r * 10) / 10}`
}

function hm(hours: number): string {
  const minutes = Math.round(hours * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

function niceStep(max: number): number {
  for (const step of [1, 2, 4, 6, 8, 12, 24, 48]) if (max / step <= 6) return step
  return 96
}

/** A bar with its 4 px rounded end away from the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function HoursChart({ owner, oasis, today, initial = 'both', liveToday, rebuilt = null }: { owner: MindcraftDay[]; oasis: MindcraftDay[]; today: string; initial?: Series; liveToday?: { carbon: number; silicon: number }; rebuilt?: RebuiltDays }) {
  const [range, setRange] = useState<7 | 28>(7)
  const [series, setSeries] = useState<Series>(initial)
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.floor(el.clientWidth)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Today's bars run with the clock (seconds from the page, the book's when larger).
  const days = chartDays(owner, oasis, today, range, rebuilt).map(d => (d.date === today && liveToday ? { ...d, carbon: Math.max(d.carbon, liveToday.carbon / 3600), silicon: Math.max(d.silicon, liveToday.silicon / 3600) } : d))
  const showCarbon = series !== 'silicon'
  const showSilicon = series !== 'carbon'
  const top = Math.max(showSilicon ? ALIVE_HOURS : 1, ...days.map(d => Math.max(showCarbon ? d.carbon : 0, showSilicon ? d.silicon : 0)))
  const step = niceStep(top * 1.08)
  const yMax = Math.ceil((top * 1.08) / step) * step
  const height = 300
  const pad = { left: 34, right: 10, top: 10, bottom: range === 7 ? 40 : 24 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const band = plotW / days.length
  const y = (hours: number) => pad.top + plotH - (hours / yMax) * plotH
  const groups = (showCarbon ? 1 : 0) + (showSilicon ? 1 : 0)
  const barW = Math.max(2, Math.min(28, (band * 0.72 - (groups - 1) * 2) / groups))
  const groupW = barW * groups + (groups - 1) * 2
  const totals = days.reduce((sum, d) => ({ carbon: sum.carbon + d.carbon, silicon: sum.silicon + d.silicon }), { carbon: 0, silicon: 0 })
  const shown = hover !== null ? days[hover] : null
  const label = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', range === 7 ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' })

  const toggle = (on: boolean) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 4, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(201,162,86,0.45)', background: on ? 'rgba(201,162,86,0.28)' : 'transparent', color: on ? '#f1dca8' : 'rgba(255,255,255,0.6)' })
  return (
    <div className="mc-card flex flex-col gap-1.5 px-3 py-2" data-mindcraft="hours-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="mc-strong text-[14px]">Hours a day</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([7, 28] as const).map(n => <button key={n} type="button" style={toggle(range === n)} onClick={() => setRange(n)}>{n} days</button>)}
          <span className="w-1" />
          {(['carbon', 'silicon', 'both'] as const).map(s => <button key={s} type="button" style={toggle(series === s)} onClick={() => setSeries(s)}>{s === 'carbon' ? 'you' : s === 'silicon' ? 'agents' : 'both'}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px] text-white/75">
        {showCarbon && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: CARBON_COLOR }} />you (carbon) {hm(totals.carbon)}</span>}
        {showSilicon && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: SILICON_COLOR }} />agents (silicon) {hm(totals.silicon)}</span>}
        {series === 'both' && totals.carbon > 0 && <span title="Agent hours for every hour of yours, over these days">{ratioLabel(totals.carbon, totals.silicon)} over {range} days</span>}
        {days.some(d => d.rebuilt) && <span className="text-white/50" title={rebuilt?.rule || ''}>lighter bars: rebuilt from the transcripts, before the counter began</span>}
      </div>
      <div ref={box} className="relative w-full" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={`Hours per day, last ${range} days`}>
          {Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step).map(h => (
            <g key={h}>
              <line x1={pad.left} x2={width - pad.right} y1={y(h)} y2={y(h)} stroke="rgba(255,255,255,0.08)" />
              <text x={pad.left - 6} y={y(h) + 4} textAnchor="end" fontSize={11} fill="rgba(255,255,255,0.5)">{h}h</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x0 = pad.left + band * i + (band - groupW) / 2
            const bars: Array<{ hours: number; color: string }> = [...(showCarbon ? [{ hours: d.carbon, color: CARBON_COLOR }] : []), ...(showSilicon ? [{ hours: d.silicon, color: SILICON_COLOR }] : [])]
            return (
              <g key={d.date} opacity={(hover === null || hover === i ? 1 : 0.55) * (d.rebuilt ? 0.5 : 1)}>
                {/* A rebuilt day (before the counter began): lighter, with a dashed edge. */}
                {bars.map((bar, j) => <path key={j} d={barPath(x0 + j * (barW + 2), y(bar.hours), barW, y(0) - y(bar.hours))} fill={bar.color} stroke={d.rebuilt ? '#fff' : 'none'} strokeDasharray={d.rebuilt ? '3 2' : undefined} strokeWidth={d.rebuilt ? 1 : 0} />)}
                {(range === 7 || i % 4 === 3 || i === days.length - 1) && (
                  <text x={pad.left + band * i + band / 2} y={height - pad.bottom + 15} textAnchor="middle" fontSize={11.5} fill={d.date === today ? '#fff' : 'rgba(255,255,255,0.55)'} fontWeight={d.date === today ? 700 : 400}>{label(d.date)}</text>
                )}
                {range === 7 && series === 'both' && (
                  <text x={pad.left + band * i + band / 2} y={height - pad.bottom + 31} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.45)">{ratioLabel(d.carbon, d.silicon)}</text>
                )}
                <rect x={pad.left + band * i} y={pad.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          {showSilicon && (
            <g pointerEvents="none">
              <line x1={pad.left} x2={width - pad.right} y1={y(ALIVE_HOURS)} y2={y(ALIVE_HOURS)} stroke={SILICON_COLOR} strokeDasharray="5 4" strokeWidth={1.5} opacity={0.8} />
              <text x={width - pad.right - 2} y={y(ALIVE_HOURS) - 5} textAnchor="end" fontSize={11.5} fill="rgba(255,255,255,0.75)">24 agent-hours a day: alive</text>
            </g>
          )}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.25)" />
        </svg>
        {shown && hover !== null && (
          <div className="pointer-events-none absolute top-1 rounded border border-white/15 bg-black/85 px-2 py-1 text-[12.5px] leading-snug text-white shadow-lg" style={{ left: Math.min(width - 170, Math.max(0, pad.left + band * hover + band / 2 - 80)), width: 165 }}>
            <div className="font-bold">{new Date(`${shown.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
            <div><span style={{ color: CARBON_COLOR }}>■</span> you {hm(shown.carbon)}</div>
            <div><span style={{ color: SILICON_COLOR }}>■</span> agents {hm(shown.silicon)}</div>
            {shown.carbon > 0 && <div className="text-white/65">{ratioLabel(shown.carbon, shown.silicon)}</div>}
            {shown.rebuilt && <div className="text-white/55">rebuilt from the transcripts (before the counter began); yours is a lower bound</div>}
          </div>
        )}
      </div>
    </div>
  )
}
