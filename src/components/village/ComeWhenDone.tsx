'use client'

// ░▒▓ COME WHEN DONE (UI) — the switch under an agent's composer, and the strip of who is on the way ▓▒░
// The owner, 25 Nov: "tell agents: this is important, come to me when you're finished with X, and they would come."
// The switch: "come to me when this is done" (his words in a message turn it on too); the agent's next finished
// turn walks it to him, in whatever world he is, and the switch is off again. The strip: who is on the way to him
// and why, each with a wave-off (✕: it goes back). Rules and file: village-come.ts, lib/village/come-when-done.ts.
// Built from the shared kit (Hipster's); no colours of its own on kit parts.

import { useSyncExternalStore } from 'react'
import { KitChip, KitToggle } from '@/components/ui-kit'
import { useOasisStore } from '../../store/oasisStore'
import { askComeWhenDone, clearVillageComing, comeWhenDoneWhat, getVillageComeVersion, isComeWhenDoneAsked, subscribeVillageCome, villageComingList } from './village-come'

/** Under the composer, next to "urgent". */
export function ComeWhenDoneToggle({ agentId }: { agentId: string }) {
  const key = useOasisStore(s => s.agentEngine.agents[agentId]?.sessionId || agentId)
  useSyncExternalStore(subscribeVillageCome, getVillageComeVersion, () => 0)
  const asked = isComeWhenDoneAsked(key)
  const what = comeWhenDoneWhat(key)
  return (
    <span title={asked
      ? `When its turn ends with ${what ? `"${what}"` : 'this'} done, it walks to you wherever you are and says its line there. Once; then this is off again.`
      : 'Come to me when this is done: its next finished turn walks it to you (also: say "come to me when you\'re done with ...")'}
    >
      <KitToggle checked={asked} onChange={on => askComeWhenDone(key, on)} label="come to me when done" data-come-when-done={asked ? 'on' : 'off'} />
    </span>
  )
}

/** Who is on the way to him (or waits in front of him), each with a wave-off. Nothing when nobody is. */
export function VillageComingStrip() {
  useSyncExternalStore(subscribeVillageCome, getVillageComeVersion, () => 0)
  const agents = useOasisStore(s => s.agentEngine.agents)
  const list = villageComingList()
    .map(([key, trip]) => {
      const entry = Object.values(agents).find(agent => agent && (agent.sessionId || agent.id) === key)
      return entry ? { key, trip, name: entry.name || 'An agent' } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
  if (!list.length) return null
  return (
    <div data-village-coming className="pointer-events-auto fixed left-1/2 top-14 z-[30] flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5">
      {list.map(({ key, trip, name }) => (
        <KitChip
          key={key}
          data-coming={key}
          onClick={() => clearVillageComing(key)}
          title={`${name} is coming to you${trip.by === 'agent' ? ' (by itself)' : ' (you asked)'}: ${trip.why}. Click to wave it off: it goes back.`}
        >
          {name} is coming: {trip.why} <span aria-hidden className="opacity-70">✕</span>
        </KitChip>
      ))}
    </div>
  )
}
