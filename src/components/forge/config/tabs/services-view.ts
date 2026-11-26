'use client'

// What the Oasis services lights and Settings box show, at once (the owner, 24 Nov: "'checking...' for 20+ secs... I
// kinda wanna see them under 1s"). They used to ask the dev page server's /api/oasis/services, which waits behind
// whatever the busy dev server compiles (9 to 21 s). Now, in this order:
//   1  the supervisor's status as the engine relays it over the socket the page already has (instant);
//   2  else the last state this browser saw, with its age (instant; an engine that is down or older than the relay);
//   3  else the page server's route as before, saying "slow to answer" after two seconds instead of "checking".

import { useEffect, useState } from 'react'
import { useOasisStore } from '@/store/oasisStore'

export interface ServiceView {
  name: 'engine' | 'world'
  label: string
  state: 'running' | 'starting' | 'down' | 'stopping' | 'gave-up' | 'unknown'
  managed: boolean
  since?: number | null
  restarts?: number
  lastExit?: { at: number; code: number | null; signal: string | null } | null
  log?: string
  /** Its process tree's memory and when it really started (the supervisor's watch). */
  bytes?: number
  startedAt?: number
  /** Why it should be restarted ("it has grown to 8.6 GB after 2 days"), or null. */
  tired?: string | null
}

export interface ServicesData {
  supervisor: boolean
  services: ServiceView[]
  /** When it was read (ms). */
  at: number
  /** Where it came from: the engine's relay, this browser's last copy, or the page server's route. */
  source: 'engine' | 'cache' | 'route'
}

const CACHE_KEY = 'oasis.services.last'
const ROUTE = '/api/oasis/services'
export const SLOW_MS = 2000

function readCache(): ServicesData | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null') as ServicesData | null
    return raw && Array.isArray(raw.services) && typeof raw.at === 'number' ? { ...raw, source: 'cache' } : null
  } catch { return null }
}

function writeCache(data: ServicesData): void {
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ supervisor: data.supervisor, services: data.services, at: data.at })) } catch { /* storage off */ }
}

/** "now", "2 min ago", "1 h ago". */
export function ageText(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 30) return 'now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  return `${Math.round(s / 3600)} h ago`
}

export function useServicesView(): { data: ServicesData | null; slow: boolean; error: string | null } {
  const relayed = useOasisStore(s => s.agentEngine.connection.server?.services)
  const [cached] = useState<ServicesData | null>(() => (typeof window === 'undefined' ? null : readCache()))
  const [fromRoute, setFromRoute] = useState<ServicesData | null>(null)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const live: ServicesData | null = relayed ? { ...relayed, services: relayed.services as ServiceView[], source: 'engine' } : null
  useEffect(() => { if (live) writeCache(live) }, [relayed]) // eslint-disable-line react-hooks/exhaustive-deps

  // The route only when the engine relays nothing (it is down, older than the relay, or there is no supervisor).
  const needRoute = !relayed
  useEffect(() => {
    if (!needRoute) return
    let alive = true
    let next: number | undefined
    const load = () => {
      const slowTimer = window.setTimeout(() => { if (alive) setSlow(true) }, SLOW_MS)
      fetch(ROUTE, { cache: 'no-store' })
        .then(res => res.json())
        .then((body: { supervisor?: boolean; services?: ServiceView[] }) => {
          if (!alive || !Array.isArray(body.services)) return
          const data: ServicesData = { supervisor: Boolean(body.supervisor), services: body.services, at: Date.now(), source: 'route' }
          setFromRoute(data)
          writeCache(data)
          setSlow(false)
          setError(null)
        })
        .catch(() => { if (alive) setError('The page server does not answer right now.') })
        .finally(() => { window.clearTimeout(slowTimer); if (alive) next = window.setTimeout(load, 5000) })
    }
    load()
    return () => { alive = false; window.clearTimeout(next) }
  }, [needRoute])

  const data = live || fromRoute || cached
  return { data, slow: slow && (!data || data.source === 'cache'), error }
}
