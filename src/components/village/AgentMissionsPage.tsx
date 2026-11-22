'use client'

// ░▒▓ AN AGENT'S MISSIONS — the "Mindcraft" page of its panel: what it asked the owner, answerable right there ▓▒░
// The owner (2026-11-22): "this agent wants two things from me... it'd be interesting to have it here in the same
// agent panel: if you've got questions I want to see them. The only way now is to go to Mindcraft and then scroll."
// Each of its open missions (docs/questions, by: this agent) in full, with Mission Wall's own answer box
// (CarbonAnswerBox: quick answers, voice typing, the file written, the asker told). The number on the "?" over its
// head is the number of missions here.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { renderMarkdown } from '../../lib/anorak-renderers'
import { splitCommands, type CarbonMission } from '../../lib/village/carbon-missions'
import { CarbonAnswerBox, CommandBox } from './CarbonMissions'
import { getVillageMissions, openMissionsOf, refreshVillageMissions, subscribeVillageMissions } from './village-missions-client'

function MissionCard({ mission, onAnswered }: { mission: CarbonMission; onAnswered: () => void }) {
  const body = useMemo(() => splitCommands(mission.body).map((part, index) => (part.kind === 'command'
    ? <CommandBox key={index} text={part.text} />
    : <div key={index}>{renderMarkdown(part.text)}</div>)), [mission.body])
  return (
    <div data-agent-mission={mission.file} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">
          {mission.kind === 'task' ? 'A thing to do' : 'A question'} · asked {mission.asked}{mission.minutes !== null ? ` · ~${mission.minutes} min` : ''}
        </div>
        <div className="break-words text-[15px] font-bold leading-tight text-white">{mission.title}</div>
        {mission.blocks && <div className="mt-0.5 text-[11.5px] text-white/70"><span className="text-white/45">waits on it: </span>{mission.blocks}</div>}
      </div>
      <div className="text-[12.5px] leading-relaxed text-white/90">
        {body}
        {mission.recommend && <div className="mt-1.5 border-t border-white/10 pt-1.5"><span className="text-[10px] uppercase tracking-[0.14em] text-white/50">recommended </span><b>{mission.recommend}</b></div>}
      </div>
      <CarbonAnswerBox mission={mission} onDone={onAnswered} />
    </div>
  )
}

export function AgentMissionsPage({ agentId, name }: { agentId: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  useSyncExternalStore(subscribeVillageMissions, getVillageMissions, getVillageMissions)
  // Fresh when the page opens (the village's count may be up to 30 s old).
  useEffect(() => {
    let live = true
    void refreshVillageMissions().then(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [agentId])
  const missions = openMissionsOf(agentId)
  return (
    <div data-agent-missions-page className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" onKeyDown={event => event.stopPropagation()}>
      {missions.length === 0 ? (
        <div className="px-1 py-2 text-[12px] text-white/65">
          {loaded ? `${name} has no open mission for you.` : 'Reading the missions…'}
        </div>
      ) : (
        <>
          <div className="px-0.5 text-[11px] text-white/60">
            {missions.length === 1 ? `${name} needs one decision from you.` : `${name} needs ${missions.length} decisions from you.`} Your answer goes into the mission file, and {name} is told.
          </div>
          {missions.map(mission => (
            <MissionCard key={mission.file} mission={mission} onAnswered={() => { void refreshVillageMissions() }} />
          ))}
        </>
      )}
    </div>
  )
}
