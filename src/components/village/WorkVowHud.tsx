'use client'

// ░▒▓ WORK VOW HUD — today's time toward three hours, what is being counted, the week of the vow ▓▒░
// Plain DOM, bottom left, always there in the village. It re-renders when the shown second changes
// (work-vow-client ticks once a second), never per frame. A click opens the detail.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMindcraftLook } from './mindcraft-look'
import { layerZ } from '../../lib/ui-kit/layers'
import { formatClock, WORK_VALOR, type WorkDayView, type WorkSnapshot, timeToGo } from '../../lib/village/work-vow'
import { GAME_HUD_TEXT } from '../forge/GameKeycap'
import { useOasisStore } from '../../store/oasisStore'
import { getMissionState, subscribeMissions } from './village-mission-store'
import { MindcraftWindow, clearBand, openMindcraft, overlayObstacles } from './MindcraftView'
import { CommitDueBar, NewMission, RunningMission, runningClock, TimeUpBar } from './OwnMissionPanel'
import { useLiveWork } from './useLiveWork'
import { nowChanged, startNowMission, useNowMissions } from './NowMissions'
import { carbonRows, HowItCounts, siliconRows, useSecond, WorkRowList } from './WorkRows'
import { getWorkVowState, setWorkFocus, setWorkMission, startWorkVow, subscribeWorkVow } from './work-vow-client'


/** Between an agent's key and its name in the focus selector's string. */
const SEP = String.fromCharCode(1)
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function Ring({ share, color, size = 38 }: { share: number; color: string; size?: number }) {
  const radius = size / 2 - 4
  const length = 2 * Math.PI * radius
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${length * Math.min(1, share)} ${length}`} />
    </svg>
  )
}

function DayPip({ day, today, target, liveSeconds }: { day: WorkDayView; today: boolean; target: number; liveSeconds: number }) {
  const seconds = today ? liveSeconds : day.seconds
  const status = seconds >= target ? 'hit' : day.status
  const color = status === 'hit' ? GREEN : status === 'missed' ? RED : status === 'open' ? AMBER : 'rgba(255,255,255,0.3)'
  const weekday = WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]
  return (
    <span className="flex flex-col items-center gap-0.5" title={`${day.date}: ${formatClock(seconds)} · ${status}`}>
      <span
        className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] text-[9px] font-black leading-none"
        style={{
          border: `1.5px solid ${color}`,
          background: status === 'hit' ? color : status === 'missed' ? `${RED}33` : 'transparent',
          color: status === 'hit' ? '#04130d' : color,
          boxShadow: today ? `0 0 8px ${color}99` : undefined,
        }}
      >
        {status === 'hit' ? '✓' : status === 'missed' ? '×' : ''}
      </span>
      <span className="text-[8px] leading-none" style={{ color: today ? '#fff' : 'rgba(255,255,255,0.5)' }}>{weekday}</span>
    </span>
  )
}

function Bar({ label, seconds, total, color, right, onClick, open }: { label: string; seconds: number; total: number; color: string; right?: string; onClick?: () => void; open?: boolean }) {
  const share = total > 0 ? seconds / total : 0
  return (
    <div className={onClick ? 'cursor-pointer' : undefined} onClick={onClick}>
      <div className="flex items-baseline justify-between gap-2 text-white/80">
        <span className="min-w-0 break-words">{onClick ? (open ? '▾ ' : '▸ ') : ''}{label}</span>
        <span className="shrink-0 tabular-nums">{right ?? formatClock(seconds)} · {Math.round(share * 100)}%</span>
      </div>
      <div className="mc-track mb-1.5 !h-[7px]"><div className="h-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} /></div>
    </div>
  )
}

/**
 * Today's time as rows (WorkRows.tsx): his, sorted by time, groups expandable; a separator; the agents', the working ones
 * highlighted and ticking. No bars with percentages (the owner, 2026-11-25: "96% of what?").
 */
function WhereTimeWent({ snapshot }: { snapshot: WorkSnapshot }) {
  const live = useLiveWork()
  const now = useSecond()
  const day = snapshot.summary
  if (!day) return null
  const agents = day.agentHours.agents.map(a => ({ key: a.key, name: a.name, seconds: a.totalSeconds, xp: a.xp }))
  return (
    <div className="mt-2">
      <div className="mc-label mb-0.5">Your time today</div>
      <WorkRowList rows={carbonRows(day)} tone="carbon" empty="Nothing counted yet today." />
      <div className="my-2 border-t border-white/10" />
      <div className="mc-label mb-0.5">Your agents' time today</div>
      <WorkRowList rows={siliconRows(agents, live.working, now)} tone="silicon" empty="No agent has worked yet today." />
    </div>
  )
}

function Detail({ snapshot, liveSeconds, liveAgents, onClose }: { snapshot: WorkSnapshot; liveSeconds: number; liveAgents: number; onClose: () => void }) {
  const row = 'flex items-baseline justify-between gap-3'
  // What the commitment did to a day: the bonus of a hit, the cost of a miss.
  const stake = (date: string, status: string) => {
    const day = snapshot.commitments?.[0]?.days.find(item => item.date === date)
    if (status === 'hit') return day && day.status === 'hit' ? ` +${day.bonusXp} · hit` : ' · hit'
    if (status === 'missed') return ` −${day?.penaltyXp ?? 0} · missed`
    return ' · open'
  }
  // Beside the game rail, never under it (the owner, 2026-11-19 and 20): measured from the page.
  const [left, setLeft] = useState(12)
  useLayoutEffect(() => {
    const measure = () => {
      const band = clearBand(window.innerWidth, overlayObstacles(layerZ('hud', 49), '[data-ui-panel="village-work-vow"]'))
      setLeft(band.left > 0 ? Math.round(band.left + 12) : 12)
    }
    measure()
    const late = window.setTimeout(measure, 300)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  }, [])
  return (
    <div
      data-ui-panel="village-work-vow"
      style={{ left }}
      className="mc-scope mc-popup oasis-frame fixed bottom-[92px] z-[var(--z-place)] max-h-[calc(100vh-110px)] w-[350px] overflow-y-auto overflow-x-hidden p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl max-[700px]:bottom-auto max-[700px]:top-[120px]"
    >
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 mb-2 flex items-start justify-between bg-[#0b0c12]/95 px-3 pb-1.5 pt-3 backdrop-blur">
        <div>
          <div className="mc-title text-[17px]">Mindcraft</div>
          {snapshot.vow && snapshot.targetSeconds !== null && <div className="mc-eyebrow">{formatClock(snapshot.targetSeconds).replace(/:00$/, '')} hours a day, {snapshot.vow.from.slice(5)} to {snapshot.vow.to.slice(5)}</div>}
        </div>
        <button type="button" onClick={onClose} className="mc-close shrink-0">✕</button>
      </div>
      <button type="button" data-work-open="full" onClick={() => { onClose(); openMindcraft() }} className="mc-btn" data-tone="go" style={{ padding: '22px 22px 20px', fontSize: 15 }}>
        Open the full view
      </button>
      {/* His own mission in hand (clock, notes, end), or a new one. */}
      {snapshot.active?.run ? <RunningMission snapshot={snapshot} /> : <NewMission />}
      <WhereTimeWent snapshot={snapshot} />
      {snapshot.active && !snapshot.active.run && (
        <button type="button" onClick={() => { void setWorkMission(null) }} className="mc-btn mt-2" data-tone="stop">
          ■ stop working on “{snapshot.active.title}”
        </button>
      )}
      {snapshot.commitments?.map((c, index) => (
        <div key={index} className="mc-card mt-3 p-2">
          <div className="mc-label">Committed</div>
          <div className="mc-strong text-[13px]">{c.label}</div>
          <div className="text-white/70">A day you hit: its XP <span style={{ color: GREEN }}>×{c.multiplier}</span>. A day you miss: <span style={{ color: RED }}>−{c.penaltyPerMinute} XP</span> for every missing minute.</div>
          {c.today && (
            <div className="mt-1">Today: finish the last {formatClock(c.today.remainingSeconds)} for <span className="font-bold" style={{ color: GREEN }}>+{c.today.bonusIfHit} XP</span>; stop now and it costs <span className="font-bold" style={{ color: RED }}>−{c.today.penaltyIfStopped} XP</span>.</div>
          )}
          <div className="mt-1 text-white/70">So far: <span style={{ color: GREEN }}>+{c.bonusXp}</span> earned, <span style={{ color: RED }}>−{c.penaltyXp}</span> lost.</div>
        </div>
      ))}
      {snapshot.vow && snapshot.totals && (
        <div className={`${row} mt-2`}><span className="text-white/60">The vow so far</span><span className="font-bold">{snapshot.totals.xp} + {snapshot.totals.bonusXp} − {snapshot.totals.penaltyXp} = {snapshot.totals.netXp} XP</span></div>
      )}
      {snapshot.week.length > 0 && (
        <>
      <div className="mb-1 mt-3 flex items-center justify-between">
        <span className="mc-label">The week</span>
        <span className="flex items-start gap-1 normal-case tracking-normal">
          {snapshot.week.map(day => <DayPip key={day.date} day={day} today={day.date === snapshot.date} target={snapshot.targetSeconds ?? 0} liveSeconds={liveSeconds} />)}
        </span>
      </div>
      {snapshot.week.map(day => {
        const seconds = day.date === snapshot.date ? liveSeconds : day.seconds
        const status = seconds >= (snapshot.targetSeconds ?? Infinity) ? 'hit' : day.status
        return (
          <div key={day.date} className={row} style={{ color: status === 'hit' ? GREEN : status === 'missed' ? RED : status === 'open' ? '#fff' : 'rgba(255,255,255,0.4)' }}>
            <span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
            <span>{status === 'ahead' ? '–' : `${formatClock(seconds)} · ${day.xp} XP${stake(day.date, status)}`}</span>
          </div>
        )
      })}
        </>
      )}
      <div className="mt-3 border-t border-white/10 pt-1.5">
        <HowItCounts text={`${snapshot.rule} Time counts while this tab is visible and you did something in the last 3 minutes. Your own mission: "New mission" above (a timer; it counts outside the Oasis tab too). An agent's mission: open its panel and press "work on this".`} />
      </div>
    </div>
  )
}

export function WorkVowHud() {
  const state = useSyncExternalStore(subscribeWorkVow, getWorkVowState, getWorkVowState)
  const [open, setOpen] = useState(false)
  useMindcraftLook() // textures and typefaces: mindcraft-look.tsx (the look is Hipster's, the content is ours)
  useEffect(() => startWorkVow(), [])
  const live = useLiveWork()
  // Now: the first of his next things, under the two numbers; a click starts it (2026-11-26).
  const nowList = useNowMissions()
  const nextNow = nowList?.[0] || null
  const endedAt = state.snapshot?.lastRun?.endedAt || 0
  useEffect(() => { if (endedAt) nowChanged() }, [endedAt])
  // The time's-up bar stands just above the counter, whatever its height.
  const counterRef = useRef<HTMLButtonElement>(null)
  const [counterTop, setCounterTop] = useState(70)
  useLayoutEffect(() => {
    const el = counterRef.current
    if (!el) return
    const measure = () => setCounterTop(Math.round(window.innerHeight - el.getBoundingClientRect().top + 8))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  })
  // What is open decides where the seconds go: an agent, a mission card, or just the Oasis.
  const agentFocus = useOasisStore(s => {
    const agent = s.agentEngine.focusedAgentId ? s.agentEngine.agents[s.agentEngine.focusedAgentId] : null
    return agent ? `${agent.sessionId || agent.id}\u0001${agent.name || agent.id}` : ''
  })
  const missionFocus = useSyncExternalStore(subscribeMissions, () => getMissionState().reader?.file || null, () => null)
  useEffect(() => {
    const [key, name] = agentFocus.split('\u0001')
    setWorkFocus({ agent: key ? { key, name } : null, mission: missionFocus })
  }, [agentFocus, missionFocus])

  const snapshot = state.snapshot
  // No book yet: say so, in the counter's place. It never just vanishes (it asks again every 5 s).
  if (!snapshot) {
    return (
      <div data-ui-panel="village-work-vow" data-work-vow="reading" className="fixed bottom-3 left-3 z-[calc(var(--z-hud)_+_10)] rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-[11px] text-white/70 max-[700px]:bottom-auto max-[700px]:left-2 max-[700px]:top-[64px]" style={GAME_HUD_TEXT}>
        work counter: reading the book…
      </div>
    )
  }
  const liveSeconds = snapshot.today.seconds + state.pendingSeconds
  // No vow (a new Oasis): no goal, no countdown; just the time.
  const target = snapshot.targetSeconds
  const done = target !== null && liveSeconds >= target
  // His own mission running: the counter is its clock (a countdown with a ring; open-ended counts up, no ring).
  const run = runningClock(snapshot, Date.now())
  const color = run ? (run.paused ? 'rgba(255,255,255,0.55)' : run.over ? GREEN : AMBER) : done ? GREEN : AMBER
  // The ring only goes round on a countdown: his mission's, or the day's goal while a vow runs (the owner,
  // 2026-11-23: "no circle if we're just counting up").
  const ringShare = run ? run.share : target ? liveSeconds / target : null
  const openMission = missionFocus ? getMissionState().missions.find(mission => mission.file === missionFocus) : null
  // What is being counted right now, and what a minute of it is worth.
  const free = snapshot.settings?.freeValor ?? WORK_VALOR.free
  const [what, rate]: [string, number] = snapshot.active && !snapshot.active.run?.pausedAt
    ? [snapshot.active.title, WORK_VALOR.mission]
    : state.inMindcraft
      ? ['in Mindcraft', WORK_VALOR.mindcraft]
    : openMission
      ? [openMission.title, WORK_VALOR.mission]
      : agentFocus
        ? [`with ${agentFocus.split(SEP)[1]}`, WORK_VALOR.agent]
        : ['in the Oasis', free]
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
  const otherSince = state.other?.since ? new Date(state.other.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
  const problem = state.automated
    ? 'not counting: this is a test browser'
    : state.unsaved
    ? 'not saved: server unreachable'
    : state.otherTab
      ? `another Oasis tab is counting${state.other?.client ? ` (${state.other.client}${otherSince ? `, since ${otherSince}` : ''})` : ''}`
      : ''
  void rate; void what; void hidden

  return (
    <>
      {/* While the panel is open it shows the same +5 / +15 / done itself; the bar would sit half under it. */}
      {!open && <TimeUpBar snapshot={snapshot} bottom={counterTop} />}
      {!open && <CommitDueBar snapshot={snapshot} bottom={counterTop} />}
      <button
        ref={counterRef}
        type="button"
        data-ui-panel="village-work-vow"
        onClick={() => setOpen(value => !value)}
        title="Your time and your agents' today: click for the detail"
        data-done={done ? '1' : '0'}
        className="mc-hud fixed bottom-3 left-3 z-[calc(var(--z-hud)_+_10)] flex w-[290px] items-center gap-2 rounded-xl border bg-slate-950/80 px-2 py-1.5 text-left text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-slate-900/90 max-[700px]:bottom-auto max-[700px]:left-2 max-[700px]:top-[64px]"
        style={{ borderColor: run?.over && !run.paused ? GREEN : `${color}66`, boxShadow: run?.over && !run.paused ? `0 0 26px ${GREEN}aa` : done ? `0 0 22px ${GREEN}44` : undefined }}
      >
        {/* A ring and its icon only while a countdown runs (the owner, 2026-11-25: "no play button unless a countdown"). */}
        {run && ringShare !== null && (
          <span className="relative flex shrink-0 items-center justify-center">
            <Ring share={ringShare} color={color} />
            <span className="absolute text-[11px] font-black" style={{ color }}>{run.paused ? '❙❙' : run.over ? '✓' : '▶'}</span>
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {run && (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="mc-clock text-[15px] font-bold leading-none tabular-nums" data-work-clock="mission" style={{ color }}>{formatClock(run.seconds)}</span>
              <span className="min-w-0 truncate text-[12px] font-bold text-white" title={run.title}>{run.title}</span>
            </span>
          )}
          {/* Two numbers, the same size: his (carbon) and the agents' (silicon), running. "Just the numbers." */}
          {/* A carbon half and a silicon half, each centered (the owner, 2026-11-25: "huge gaps"). */}
          <span className="grid grid-cols-[1fr_1px_1.25fr] items-center gap-2">
            <span className="flex min-w-0 flex-col items-center leading-none" title="Carbon: your time today">
              <span className="text-[9px] uppercase tracking-[0.16em] text-amber-200/60">carbon</span>
              <span className="mc-clock text-[17px] font-bold tabular-nums" data-work-clock={run ? 'day' : 'day'} style={{ color: done ? GREEN : '#f1dca8' }}>{formatClock(liveSeconds)}</span>
            </span>
            <span className="h-7 w-px bg-white/15" />
            <span className="flex min-w-0 flex-col items-center leading-none" title={`Silicon: your agents' time today${live.working.length ? `; ${live.working.length} working right now` : ''}`}>
              <span className="text-[9px] uppercase tracking-[0.16em] text-violet-200/60">silicon</span>
              <span className="flex items-baseline gap-1.5">
                <span className="mc-clock text-[17px] font-bold tabular-nums" style={{ color: '#d8b4fe' }}>{formatClock(live.agents)}</span>
                {/* How many work right now, as big as the time: a count, not a multiplier (the owner, 2026-11-25). */}
                {live.working.length > 0 && (
                  <span data-work-clock="working" className="mc-clock inline-flex items-center gap-0.5 whitespace-nowrap text-[17px] font-bold tabular-nums text-violet-100" title={`${live.working.length} ${live.working.length === 1 ? 'agent' : 'agents'} working right now`}>
                    {live.working.length}
                    {/* A standing figure drawn as a shape (the owner, 2026-11-25: a number and a person, not an emoji). */}
                    <svg width="11" height="16" viewBox="0 0 11 16" aria-hidden="true" className="shrink-0">
                      <circle cx="5.5" cy="3" r="2.3" fill="currentColor" />
                      <path d="M5.5 6.2c-2.3 0-3.6 1.4-3.6 3.4v2.2h1.5V16h1.4v-3.8h1.4V16h1.4v-4.2h1.5V9.6c0-2-1.3-3.4-3.6-3.4z" fill="currentColor" />
                    </svg>
                  </span>
                )}
              </span>
            </span>
          </span>
          {!run && nextNow && (
            <span
              role="button"
              tabIndex={0}
              data-work-now="next"
              onClick={event => { event.stopPropagation(); void startNowMission(nextNow) }}
              onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); event.preventDefault(); void startNowMission(nextNow) } }}
              className="mt-0.5 block cursor-pointer truncate text-[12px] font-bold text-emerald-200 hover:text-emerald-100 hover:underline"
              title={nextNow.kind === 'task' ? `Start it now: a ${nextNow.minutes ?? 60}-minute mission of yours` : 'Open it in Mindcraft to answer'}
            >
              next: {nextNow.title}{nextNow.kind === 'task' ? ` · ${nextNow.minutes ?? 60} min ▶` : ' · answer'}
            </span>
          )}
          {target !== null && (
            <span className="text-[10px] font-bold" style={{ color: done ? GREEN : '#fde68a' }} title={`The goal is ${formatClock(target)} a day`}>{timeToGo(liveSeconds, target)}</span>
          )}
          {/* Only when something is wrong (not saved, another tab, a test browser): no "counting" line otherwise. */}
          {problem && <span className="mc-status truncate text-[9.5px]" style={{ ...GAME_HUD_TEXT, color: state.unsaved ? RED : 'rgba(255,255,255,0.6)' }} title={problem}>{problem}</span>}
        </span>
      </button>
      {open && <Detail snapshot={snapshot} liveSeconds={liveSeconds} liveAgents={live.agents} onClose={() => setOpen(false)} />}
      <MindcraftWindow />
    </>
  )
}
