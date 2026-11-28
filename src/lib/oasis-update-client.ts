'use client'

// The browser's half of the Upgrade button (7c_oasis docs/missions/oasis-upgrade-button.md). The owner, 27 Nov:
// "new version available. Hit this flashy, big, satisfying button to build it... as soon as it has built... flashing
// on my main screen... And when I hit it, that's when it all reloads."
//
// One poll of GET /api/oasis/update shared by the Settings > Misc card and the rail's "New version ready" button
// (src/lib/oasis-village-update.ts answers it for his village; the package half answers the same shape). Every 10 s
// while a build is running, every minute otherwise. No route (the hosted Oasis, an older copy): nothing shows.

import { create } from 'zustand'

export type UpdatePhase = 'idle' | 'building' | 'proving' | 'ready' | 'swapping' | 'failed'

export interface OasisUpdateStatus {
  kind: 'village' | 'package'
  how?: 'clone' | 'plugin'
  running: { label: string; commit?: string | null; at?: string | null; dist?: string | null } | null
  newer: { label: string; count?: number } | null
  busy: boolean
  phase: UpdatePhase
  step?: string
  startedAt?: string | number | null
  ready: { commit?: string; label?: string; at?: string } | null
  error?: string | null
}

interface UpdateStore {
  status: OasisUpdateStatus | null
  /** what the page itself is doing: posting, waiting for the swapped server, or an error of its own */
  local: 'idle' | 'starting' | 'switching' | 'failed'
  localError: string
  refresh: () => Promise<void>
  build: () => Promise<void>
  switchNow: () => Promise<void>
}

const ACTIVE: UpdatePhase[] = ['building', 'proving', 'swapping']

export const useOasisUpdate = create<UpdateStore>((set, get) => ({
  status: null,
  local: 'idle',
  localError: '',
  refresh: async () => {
    try {
      const r = await fetch('/api/oasis/update', { cache: 'no-store' })
      if (!r.ok) { set({ status: null }); return }
      set({ status: await r.json() as OasisUpdateStatus })
    } catch { /* the server is restarting, or gone: keep the last answer */ }
  },
  build: async () => {
    set({ local: 'starting', localError: '' })
    try {
      const r = await fetch('/api/oasis/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'build' }) })
      const data = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      set({ local: 'idle' })
    } catch (e) {
      set({ local: 'failed', localError: (e as Error).message })
    }
    await get().refresh()
  },
  switchNow: async () => {
    set({ local: 'switching', localError: '' })
    const before = await buildId()
    try {
      const r = await fetch('/api/oasis/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'switch' }) })
      const data = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    } catch (e) {
      // the server may close the connection as it swaps: only a clear refusal is an error
      if (!/fetch|network/i.test((e as Error).message)) { set({ local: 'failed', localError: (e as Error).message }); return }
    }
    // Wait for the page server to answer with another build, then reload once (about ten seconds).
    const t0 = Date.now()
    while (Date.now() - t0 < 120_000) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const now = await buildId()
      if (now && now !== before) { window.location.reload(); return }
      if (now && Date.now() - t0 > 8000) {
        await get().refresh()
        const status = get().status
        if (status?.phase === 'failed') { set({ local: 'failed', localError: status.error || 'The new version did not start; the old one is back.' }); return }
      }
    }
    set({ local: 'failed', localError: 'The page server did not come back with the new version within 2 minutes. Reload the page; if it does not answer, the supervisor log (logs/world.log) says why.' })
  },
}))

async function buildId(): Promise<string | null> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    if (!r.ok) return null
    return ((await r.json()) as { buildId?: string }).buildId ?? null
  } catch { return null }
}

let polling = 0
let timer: ReturnType<typeof setTimeout> | null = null

function tick(): void {
  const { refresh } = useOasisUpdate.getState()
  void refresh().then(() => {
    if (!polling) return
    const phase = useOasisUpdate.getState().status?.phase
    timer = setTimeout(tick, phase && ACTIVE.includes(phase) ? 10_000 : 60_000)
  })
}

/** Keep the shared status fresh while a component that shows it is mounted. Returns the stop function. */
export function startUpdatePolling(): () => void {
  if (process.env.NEXT_PUBLIC_OASIS_MODE === 'hosted') return () => {}
  polling++
  if (polling === 1) tick()
  return () => {
    polling = Math.max(0, polling - 1)
    if (!polling && timer) { clearTimeout(timer); timer = null }
  }
}

/** Poll again soon (after a click), whatever the current pace. */
export function pokeUpdatePolling(): void {
  if (timer) clearTimeout(timer)
  if (polling) timer = setTimeout(tick, 1500)
}

/** The rail button shows when a proven copy newer than the running one waits. */
export function upgradeReady(status: OasisUpdateStatus | null): boolean {
  if (!status || status.phase !== 'ready' || !status.ready) return false
  if (status.ready.commit && status.running?.commit) return status.ready.commit !== status.running.commit
  return true
}

/** "3 h ago", "2 days ago": for the running copy's build time. */
export function agoText(at: string | number | null | undefined, now = Date.now()): string {
  if (!at) return ''
  const t = typeof at === 'number' ? at : Date.parse(at)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
