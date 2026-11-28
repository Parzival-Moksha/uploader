'use client'

// ░▒▓ NOW — the owner's next things, at most three, in Anorak's order ▓▒░
// The owner, 2026-11-26: "I'm kind of lost as to what's the next thing... it's all about the agents employing the carbon
// guy... curating things to my attention." Anorak curates his list every morning and marks up to three questions or
// tasks `now: 1..3` (docs/questions). Mindcraft's Carbon tab opens on them; the counter shows the first under its two
// numbers. A task starts as a timed mission of his in one press (an agent's task becomes his timed mission and is marked
// done when he keeps it); a question opens with its answer box. Answered or done, the next one moves up at once.

import { useCallback, useEffect, useState } from 'react'
import type { CarbonMission } from '../../lib/village/carbon-missions'
import { startOwnRun } from './work-vow-client'

export const NOW_CHANGED = 'oasis:now-changed'

/** Tell every Now list to read again (after an answer, a start, an end). */
export function nowChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOW_CHANGED))
}

/** The Now missions, read on mount, every minute, and whenever something changed them. */
export function useNowMissions(): CarbonMission[] | null {
  const [now, setNow] = useState<CarbonMission[] | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/village/questions?now=1', { cache: 'no-store' })
      if (response.ok) setNow(((await response.json()) as { now?: CarbonMission[] }).now || [])
    } catch { /* next time */ }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    window.addEventListener(NOW_CHANGED, load)
    return () => { window.clearInterval(timer); window.removeEventListener(NOW_CHANGED, load) }
  }, [load])
  return now
}

/** Start one: a task as a timed mission of his (its minutes, or an hour), a question opened in Mindcraft to answer. */
export async function startNowMission(m: CarbonMission): Promise<string | null> {
  if (m.kind !== 'task') {
    // Mindcraft's own open event (not an import: Mindcraft's list imports this file).
    window.dispatchEvent(new CustomEvent('oasis:open-mindcraft', { detail: { carbon: m.file } }))
    return null
  }
  const answer = await startOwnRun({ file: m.file, minutes: m.minutes ?? 60, notify: 'Anorak' })
  nowChanged()
  return answer.error || null
}

/** After a task of his list is done: the next Now opens in Mindcraft with its "What to do" on screen (26 Nov). */
export async function openNextNow(): Promise<void> {
  nowChanged()
  try {
    const response = await fetch('/api/village/questions?now=1', { cache: 'no-store' })
    const next = response.ok ? ((await response.json()) as { now?: CarbonMission[] }).now?.[0] : undefined
    window.dispatchEvent(new CustomEvent('oasis:open-mindcraft', { detail: next ? { carbon: next.file } : {} }))
  } catch { /* the list will show it */ }
}

/** Now, at the top of the Carbon tab: up to three cards; nothing marked: says so. */
export function NowCards({ missions, onOpen }: { missions: CarbonMission[]; onOpen: (file: string) => void }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  return (
    <div data-mindcraft="now" className="mc-card shrink-0 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="mc-strong text-[15px]">Now</span>
        <span className="text-[12px] text-white/45">chosen for you by Anorak{missions.length ? ', in this order' : ''}</span>
      </div>
      {missions.length === 0 && <div className="py-1 text-white/70">Nothing is marked for now: you are done with what was urgent. Everything below can wait.</div>}
      <div className="mt-1 flex flex-col gap-1.5">
        {missions.map((m, index) => (
          <div key={m.file} data-mindcraft="now-card" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-2.5 py-2" style={{ borderColor: index === 0 ? 'rgba(52,211,153,0.55)' : 'rgba(255,255,255,0.12)', background: index === 0 ? 'rgba(52,211,153,0.07)' : 'transparent' }}>
            <span className="w-5 shrink-0 text-center text-[18px] font-bold" style={{ color: index === 0 ? '#34d399' : 'rgba(255,255,255,0.5)' }}>{index + 1}</span>
            <button type="button" onClick={() => onOpen(m.file)} className="min-w-0 flex-1 text-left hover:underline">
              <span className="block break-words text-[15px] font-bold leading-snug text-white">{m.title}</span>
              <span className="block text-[12px] text-white/55">{m.kind === 'task' ? 'a task' : 'a question'}{m.minutes ? ` · about ${m.minutes} min` : ''} · asked by {m.by || 'someone'}</span>
            </button>
            <button
              type="button"
              data-mindcraft="now-start"
              disabled={busy === m.file}
              onClick={() => { setBusy(m.file); setError(''); void startNowMission(m).then(problem => { setBusy(''); if (problem) setError(problem) }) }}
              className="mc-btn shrink-0"
              data-tone={index === 0 ? 'go' : undefined}
              style={{ display: 'inline-block', width: 'auto', minWidth: 120, padding: '10px 16px 9px' }}
            >
              {m.kind === 'task' ? `▶ Start · ${m.minutes ?? 60} min` : 'Answer'}
            </button>
          </div>
        ))}
      </div>
      {error && <div className="mt-1 text-[12px] text-rose-300">{error}</div>}
    </div>
  )
}
