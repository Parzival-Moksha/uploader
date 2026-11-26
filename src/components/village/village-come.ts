// ░▒▓ COME WHEN DONE (page) — the shared file, and what this page sees happen ▓▒░
// lib/village/come-when-done.ts has the rules; /api/village/come keeps the file. This page:
//   · reads it (every 4 s, and at once after its own change) so the agent panels, the strip and the walk follow it;
//   · hears the owner ask in words ("come to me when you're finished with X") in a message he sent an agent;
//   · tells the file when an asked agent's turn ends (also one that ended while no page was open);
//   · ends a trip when he opens that agent and closes it again (he has heard it).
// The walk itself: VillageWorld (an agent that is coming visits him, whatever "Come to me" says), village-worlds.ts
// (it is in his world while it comes); its line on arrival: VillageVoice.tsx.

import { useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { EMPTY_COME, asksToComeWhenDone, parseComeFile, type ComeFile, type ComeOp, type ComeTrip } from '../../lib/village/come-when-done'

const ROUTE = '/api/village/come'
const EVERY_MS = 4000

let file: ComeFile = EMPTY_COME
let version = 0
const listeners = new Set<() => void>()

function replace(next: ComeFile): void {
  file = next
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeVillageCome(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVillageComeVersion(): number {
  return version
}

/** Is this agent (its session key) on its way to the owner, or standing in front of him for it? */
export function isVillageComing(key: string): boolean {
  return Boolean(file.coming[key])
}

export function villageComingTrip(key: string): ComeTrip | null {
  return file.coming[key] ?? null
}

/** Everyone on the way, oldest first: [session key, trip]. */
export function villageComingList(): Array<[string, ComeTrip]> {
  return Object.entries(file.coming).sort((a, b) => a[1].at - b[1].at)
}

/** Did he ask this agent to come to him when it is done (and it has not yet)? */
export function isComeWhenDoneAsked(key: string): boolean {
  return Boolean(file.asked[key])
}

export function comeWhenDoneWhat(key: string): string | null {
  return file.asked[key]?.what ?? null
}

export function useVillageComeVersion(): number {
  return useSyncExternalStore(subscribeVillageCome, getVillageComeVersion, () => 0)
}

async function post(ops: ComeOp[]): Promise<void> {
  try {
    const response = await fetch(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }) })
    const body = await response.json().catch(() => null) as { file?: unknown } | null
    if (response.ok && body?.file) replace(parseComeFile(body.file))
  } catch {
    // The page server is away: the next poll shows what stands.
  }
}

/** The switch under an agent's composer ("come to me when this is done"), or his words. */
export function askComeWhenDone(key: string, on: boolean, what?: string): void {
  // Shown at once; the file confirms it.
  const asked = { ...file.asked }
  if (on) asked[key] = { at: Date.now(), ...(what ? { what } : {}) }
  else delete asked[key]
  replace({ ...file, asked })
  void post([{ op: 'ask', agent: key, on, ...(what ? { what } : {}) }])
}

/** He waved it off, or heard it: it goes back to where it lives. */
export function clearVillageComing(key: string): void {
  if (!file.coming[key]) return
  const coming = { ...file.coming }
  delete coming[key]
  replace({ ...file, coming })
  void post([{ op: 'clear', agent: key }])
}

async function poll(): Promise<void> {
  try {
    const response = await fetch(`${ROUTE}?since=${file.version}`, { cache: 'no-store' })
    if (!response.ok) return
    const body = await response.json() as { unchanged?: boolean }
    if (!body.unchanged) replace(parseComeFile(body))
  } catch {
    // Away for now.
  }
}

type Agents = ReturnType<typeof useOasisStore.getState>['agentEngine']['agents']
const keyOf = (id: string, agent: Agents[string]) => agent.sessionId || id

/**
 * Mounted once by the village. Returns the stop.
 */
export function startVillageCome(): () => void {
  let stopped = false
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void poll() }, EVERY_MS)
  const lastLogs = new Map<string, unknown>()
  const seenUser = new Set<string>()
  const toldTurn = new Map<string, number>()
  let primed = false

  const scan = (agents: Agents) => {
    const ops: ComeOp[] = []
    for (const [id, agent] of Object.entries(agents)) {
      if (!agent?.owned) continue
      const key = keyOf(id, agent)
      // His words, in a message he just sent it (typed, dictated or a voice message).
      const log = agent.log
      if (log && lastLogs.get(id) !== log) {
        lastLogs.set(id, log)
        for (let i = Math.max(0, log.length - 8); i < log.length; i++) {
          const entry = log[i]
          if (entry.type !== 'user' || entry.history || entry.engineNote || entry.scheduled || seenUser.has(entry.key)) continue
          seenUser.add(entry.key)
          if (!primed || Date.now() - entry.ts > 60_000) continue
          const ask = asksToComeWhenDone(entry.text || '')
          if (ask) {
            file = { ...file, asked: { ...file.asked, [key]: { at: Date.now(), ...(ask.what ? { what: ask.what } : {}) } } }
            version += 1
            ops.push({ op: 'ask', agent: key, on: true, ...(ask.what ? { what: ask.what } : {}) })
          }
        }
      }
      // A turn ended after he asked: the file decides whether that walks it over (once, by whichever page tells it).
      const ask = file.asked[key]
      const turn = agent.lastTurn
      if (ask && turn && turn.ts > ask.at && toldTurn.get(key) !== turn.ts && agent.status !== 'working') {
        toldTurn.set(key, turn.ts)
        ops.push({ op: 'done', agent: key, turnAt: turn.ts, error: turn.isError || turn.outcome === 'error' })
      }
    }
    if (ops.length) {
      listeners.forEach(listener => listener())
      void post(ops)
    }
  }

  // He opened an agent that is coming and closed it again: he has heard it.
  let focused = useOasisStore.getState().agentEngine.focusedAgentId
  const unsubscribe = useOasisStore.subscribe(state => {
    const engine = state.agentEngine
    if (engine.focusedAgentId !== focused) {
      const left = focused ? engine.agents[focused] : null
      focused = engine.focusedAgentId
      if (left && focused !== left.id) clearVillageComing(keyOf(left.id, left))
    }
    scan(engine.agents)
  })
  void poll().then(() => {
    if (stopped) return
    scan(useOasisStore.getState().agentEngine.agents)
    primed = true
  })
  return () => {
    stopped = true
    window.clearInterval(timer)
    unsubscribe()
  }
}
