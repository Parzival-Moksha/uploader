'use client'

// ░▒▓ LIVE WORK — today's seconds as they run, for every figure that is running ▓▒░
// The owner, 2026-11-23: "it's not updating in real time... That's the whole point of Mindcraft." The book is
// written every 15 s (his time) and at the end of each turn (the agents'); in between, the page adds what it knows:
// his seconds not yet reported, and the running time of every agent turn going on now. Ticks once a second.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { localMidnight } from '../../lib/village/work-vow'
import { useOasisStore } from '../../store/oasisStore'
import { getWorkVowState, refreshWorkVow, subscribeWorkVow } from './work-vow-client'

/** Seconds of agent turns running now, since the later of their start and the day's start (04:20). */
export function runningTurnSeconds(working: number[], now: number, dayStart: number): number {
  return working.reduce((sum, since) => sum + Math.max(0, now - Math.max(since, dayStart)) / 1000, 0)
}

/** An agent working right now: since when (its turn), for the multiplier and the highlighted rows. */
export interface WorkingAgent { id: string; name: string; since: number; sessionId: string }

export function useLiveWork(): { mine: number; agents: number; date: string | null; working: WorkingAgent[] } {
  const state = useSyncExternalStore(subscribeWorkVow, getWorkVowState, getWorkVowState)
  // When each working agent's turn began (its status has been "working" since then).
  const working = useOasisStore(s => s.agentEngine.order.map(id => s.agentEngine.agents[id]).filter(a => a && a.status === 'working' && a.statusSince > 0).map(a => `${a.id}${a.name || a.id}${a.statusSince}${a.sessionId || ''}`).join(''))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  // A turn ended: its time leaves the running part and enters the book (the engine books it at once); read the
  // book again shortly, or the figure would drop until the next report.
  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshWorkVow() }, 3000)
    return () => window.clearTimeout(timer)
  }, [working])
  const snapshot = state.snapshot
  const list: WorkingAgent[] = working ? working.split('').map(item => { const [id, name, since, sessionId] = item.split(''); return { id, name, since: Number(since), sessionId } }) : []
  if (!snapshot) return { mine: 0, agents: 0, date: null, working: list }
  const mine = snapshot.today.seconds + state.pendingSeconds
  const since = list.map(a => a.since)
  const dayStart = localMidnight(now)
  const agents = (snapshot.agentHours?.today || 0) + runningTurnSeconds(since, now, dayStart)
  return { mine, agents, date: snapshot.date, working: list }
}
