'use client'

// Two small lights in the top left of the main menu (GameMenu): the agent engine and the page server, green while
// each runs, red when one is down (the owner, 22 Nov: "it's kinda weird to me to not see the pnpm dev process, the
// server and the engine running… if I could at least have an indicator"; then "send them to the menu… I don't wanna
// see it all the time": in the HUD's corner they covered the Mindcraft button). A click opens Settings > Misc, with
// since when and the Restart buttons. The big red warning when one is down stays ConnectionWarning's.
// The engine's light is this page's socket to it; the page server's is a light request every 15 s while the menu is
// open (the supervisor says since when each runs, for the tooltip).

import { useEffect, useState, type CSSProperties } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { Light, lightColor, sinceText } from '../forge/config/tabs/ServicesSettings'

const EVERY_MS = 15_000

interface Seen { ok: boolean; since: Record<string, number | null> }

export function ServicesLights({ onOpen, className = '', style }: { onOpen?: () => void; className?: string; style?: CSSProperties }) {
  const socket = useOasisStore(s => s.agentEngine.connection.status)
  const [world, setWorld] = useState<Seen | null>(null)
  useEffect(() => {
    let alive = true
    let next: number | undefined
    // Any answer means the page server runs (a refusal too). A server that is down refuses at once; a busy dev server
    // can take 10-20 s to answer while a world loads, which is slow, not down: the light keeps its colour then.
    const check = () => {
      const ask = new AbortController()
      let slow = false
      const timer = window.setTimeout(() => { slow = true; ask.abort() }, 30_000)
      fetch('/api/oasis/services', { cache: 'no-store', signal: ask.signal })
        .then(async res => {
          const body = (await res.json().catch(() => ({}))) as { services?: Array<{ name: string; since?: number | null }> }
          if (!alive) return
          setWorld({ ok: true, since: Object.fromEntries((body.services || []).map(s => [s.name, s.since ?? null])) })
          next = window.setTimeout(check, EVERY_MS)
        })
        .catch(() => {
          if (!alive) return
          if (!slow) setWorld(prev => ({ ok: false, since: prev?.since || {} }))
          next = window.setTimeout(check, slow ? EVERY_MS : 3000)
        })
        .finally(() => window.clearTimeout(timer))
    }
    check()
    return () => { alive = false; window.clearTimeout(next) }
  }, [])
  if (socket === 'disabled') return null
  const engineState = socket === 'open' ? 'running' : socket === 'connecting' ? 'starting' : 'down'
  const worldState = world === null ? 'starting' : world.ok ? 'running' : 'down'
  const since = (name: string) => (world?.since?.[name] ? ` since ${sinceText(world.since[name]!)}` : '')
  const engineTitle = engineState === 'running' ? `Agent engine: running${since('engine')}` : engineState === 'starting' ? 'Agent engine: connecting…' : 'Agent engine: down'
  const worldTitle = worldState === 'running' ? `Page server: running${since('world')}` : worldState === 'starting' ? 'Page server: checking…' : 'Page server: down'
  return (
    <button
      type="button"
      data-services-lights={`${engineState}/${worldState}`}
      title={`${engineTitle}\n${worldTitle}\nClick: Settings > Misc (since when, Restart)`}
      onClick={onOpen}
      style={style}
      className={`flex items-center gap-2.5 rounded-lg border border-white/15 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-white/80 backdrop-blur transition hover:bg-slate-900/85 ${className}`}
    >
      <span className="flex items-center gap-1.5"><Light color={lightColor(engineState)} />engine</span>
      <span className="flex items-center gap-1.5"><Light color={lightColor(worldState)} />page server</span>
    </button>
  )
}
