'use client'

// The internet line (engine network.js). While this PC has no internet, a large plain line at the top of the
// village: since when, and that the agents go on by themselves when it is back (the owner, 21 Nov: the PC was offline
// overnight and nothing said so). When it comes back, one notice: for how long, and that they carry on.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { showNotice } from '../forge/GlobalNotice'
import { getSessionPanelGeometry, getSessionPanelWidth, subscribeSessionPanelWidth } from './village-actions'

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** "Offline since 19:26", "since yesterday 19:26". */
export function offlineSinceText(since: number, now = Date.now()): string {
  const d = new Date(since)
  const today = new Date(now)
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? `since ${clock(since)}` : `since ${d.toLocaleDateString('en', { weekday: 'short' })} ${clock(since)}`
}

function spanText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

export function NetworkWatch() {
  const network = useOasisStore(s => s.agentEngine.connection.server?.network || null)
  const since = network && !network.online ? network.offlineSince : null
  const was = useRef<number | null>(null)
  const [, tick] = useState(0)
  // Centred on the part of the screen an open agent panel leaves free, so the panel never covers it.
  const focused = useOasisStore(s => s.agentEngine.focusedAgentId)
  useSyncExternalStore(subscribeSessionPanelWidth, getSessionPanelWidth, () => null)
  useEffect(() => {
    const before = was.current
    was.current = since
    if (before && !since) showNotice(`The internet is back after ${spanText(Date.now() - before)}: the agents carry on by themselves.`, 'info')
  }, [since])
  // "since 19:26" turns into "since Fri 19:26" after midnight.
  useEffect(() => {
    if (!since) return
    const timer = window.setInterval(() => tick(n => n + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [since])
  if (!since) return null
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth
  const panel = focused && typeof window !== 'undefined' ? getSessionPanelGeometry(window.innerWidth, window.innerHeight) : null
  // Between the menu buttons on the left (about 170 px wide) and the panel on the right.
  const right = panel?.side === 'right' ? viewport - panel.width - panel.margin * 2 : viewport
  const left = viewport >= 700 ? 170 : 0
  const free = Math.max(0, right - left)
  return (
    <div
      role="status"
      data-network-offline
      style={{ left: left + free / 2, width: Math.max(260, Math.min(free - 24, 640)) }}
      className="pointer-events-none fixed top-3 z-[60] -translate-x-1/2 rounded-xl border border-amber-300/60 bg-black/75 px-4 py-3 text-center text-amber-50 shadow-lg backdrop-blur"
    >
      <div className="text-[20px] font-bold leading-tight">Offline {offlineSinceText(since)}</div>
      <div className="mt-1 text-[13px] leading-snug text-amber-50/90">
        This PC has no internet. The agents wait and carry on by themselves when the line is back; the engine checks
        every minute. Messages you send now wait and go out then.
      </div>
    </div>
  )
}
