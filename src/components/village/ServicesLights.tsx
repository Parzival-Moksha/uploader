'use client'

// Two small lights in the top left of the main menu (GameMenu): the agent engine and the page server, green while
// each runs, red when one is down (the owner, 22 Nov: "it's kinda weird to me to not see the pnpm dev process, the
// server and the engine running… if I could at least have an indicator"; then "send them to the menu… I don't wanna
// see it all the time": in the HUD's corner they covered the Mindcraft button). A click opens Settings > Misc, with
// since when and the Restart buttons. The big red warning when one is down stays ConnectionWarning's.
// The engine's light is this page's socket to it; the page server's comes from useServicesView (services-view.ts): the
// supervisor's status as the engine relays it, at once (24 Nov: probing the busy dev server took up to 20 s).

import type { CSSProperties } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { Light, lightColor, sinceText } from '../forge/config/tabs/ServicesSettings'
import { ageText, useServicesView } from '../forge/config/tabs/services-view'

export function ServicesLights({ onOpen, className = '', style }: { onOpen?: () => void; className?: string; style?: CSSProperties }) {
  const socket = useOasisStore(s => s.agentEngine.connection.status)
  const { data, slow, error } = useServicesView()
  if (socket === 'disabled') return null
  const engineState = socket === 'open' ? 'running' : socket === 'connecting' ? 'starting' : 'down'
  const world = data?.services.find(s => s.name === 'world') || null
  // The page answered this request, so it runs; the supervisor's view adds since when and whether it is tired.
  const worldState = error && !data ? 'down' : world ? (world.state === 'stopping' || world.state === 'starting' ? 'starting' : world.state === 'running' ? 'running' : 'down') : slow ? 'starting' : 'running'
  const since = (name: string) => {
    const s = data?.services.find(x => x.name === name)
    const at = s?.startedAt || s?.since
    return at ? ` since ${sinceText(at)}` : ''
  }
  const tired = worldState === 'running' ? world?.tired || null : null
  const stale = data && data.source === 'cache' ? ` (as last seen, ${ageText(data.at)})` : ''
  const engineTitle = engineState === 'running' ? `Agent engine: running${since('engine')}` : engineState === 'starting' ? 'Agent engine: connecting…' : 'Agent engine: down'
  const worldTitle = tired ? `Page server: restart me (${tired})` : worldState === 'running' ? `Page server: running${since('world')}${stale}` : worldState === 'starting' ? (slow ? 'Page server: slow to answer' : 'Page server: starting…') : 'Page server: down'
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
      <span className="flex items-center gap-1.5"><Light color={tired ? lightColor('starting') : lightColor(worldState)} />{tired ? 'page server · restart me' : 'page server'}</span>
    </button>
  )
}
