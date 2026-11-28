'use client'

// ░▒▓ AGENT WHERE BAR — in an agent's panel: where it is, and the way to bring it here or go to it ▓▒░
// Agents live in a world (village-worlds.ts). Its panel opens from any world; when it is elsewhere this says
// where, with "Call here" (it comes into this world and stays until sent home) and "Go there" (the owner travels to
// its world). A called agent shows "Send home". Nothing when it simply lives here.
// "Live in this world" (the owner, 27 Nov, sorting agents into worlds on camera): its home world becomes this one, and,
// if he says so, the things it built around its old home come along, set down around where he stands (agent-move.ts).

import { useState } from 'react'
import { KitButton, kitConfirm } from '@/components/ui-kit'
import { describeThings } from '../../lib/village/agent-things'
import { liveInThisWorld, readAgentThings } from './agent-move'
import { useOasisStore } from '../../store/oasisStore'
import { villageAgentKey } from '../../lib/village/village-layout'
import { showNotice } from '../forge/GlobalNotice'
import { callVillageAgent, currentVillageWorld, getVillageHomesFile } from './village-homes'
import { isVillageAgentHere, useVillageWorldsVersion, villageAgentWorld, villageWorldName } from './village-worlds'

export function AgentWhereBar({ agentId }: { agentId: string }) {
  useVillageWorldsVersion()
  const sessionId = useOasisStore(s => s.agentEngine.agents[agentId]?.sessionId ?? null)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const key = villageAgentKey({ id: agentId, sessionId })
  const here = currentVillageWorld()
  const world = villageAgentWorld(agentId)
  const calledHere = Boolean(here && getVillageHomesFile().calls[key] === here)
  const name = useOasisStore(s => s.agentEngine.agents[agentId]?.name || 'It')
  const [moving, setMoving] = useState(false)
  if (isVillageAgentHere(agentId) && !calledHere) return null

  const liveHere = async () => {
    setMoving(true)
    try {
      const found = await readAgentThings(agentId).catch(() => null)
      let bring = null
      if (found && found.things.length) {
        const yes = await kitConfirm({
          title: `${name} lives here from now on`,
          body: `What it built in ${villageWorldName(found.from)}: ${describeThings(found.things)}. Bring it along? It is set down around where you stand now, as it stood around its home, and taken out of ${villageWorldName(found.from)}.`,
          confirm: 'Bring them too',
          cancel: 'Only the agent',
        })
        if (yes) bring = found
      }
      showNotice(await liveInThisWorld(agentId, bring), 'info')
    } catch (error) {
      fail(error)
    } finally {
      setMoving(false)
    }
  }

  const fail = (error: unknown) => showNotice(`Could not do that: ${error instanceof Error ? error.message : String(error)}`, 'error')
  return (
    <div data-agent-where={calledHere ? 'called' : 'away'} className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="kit-hint">
        {calledHere ? `Called here: it stays until you send it home.` : `In ${villageWorldName(world)}: not in this world.`}
      </span>
      {calledHere ? (
        <>
          <KitButton data-agent-send-home onClick={() => void callVillageAgent(key, null).catch(fail)} title="Back to its own world">Send home</KitButton>
          <KitButton data-agent-live-here disabled={moving} onClick={() => void liveHere()} title="Its home world becomes this one: it stays here when you leave (it can bring what it built)">Live in this world</KitButton>
        </>
      ) : (
        <>
          <KitButton variant="primary" data-agent-call-here onClick={() => { if (here) void callVillageAgent(key, here).catch(fail) }} title="It comes into this world and stays until you send it home">Call here</KitButton>
          {world && <KitButton data-agent-go-there onClick={() => switchWorld(world)} title={`Travel to ${villageWorldName(world)}`}>Go there</KitButton>}
          <KitButton data-agent-live-here disabled={moving} onClick={() => void liveHere()} title="Its home world becomes this one: it stays here when you leave (it can bring what it built)">Live in this world</KitButton>
        </>
      )}
    </div>
  )
}
