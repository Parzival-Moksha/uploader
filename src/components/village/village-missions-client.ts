// ░▒▓ VILLAGE MISSIONS (page) — the owner's missions from docs/questions, and who in the village asked each ▓▒░
// One fetch for the two places that need it: the village's count per agent (the "?" with its number, N, walking up;
// VillageController polls every 30 s) and an agent's own Mindcraft page in its panel (AgentMissionsPage). After an
// answer the page refreshes at once, so the number over the agent's head drops without waiting for the next poll.

import { openMissionCounts, missionAsker } from '../../lib/village/mission-attention'
import type { CarbonMission } from '../../lib/village/carbon-missions'
import { useOasisStore } from '../../store/oasisStore'

let latest: CarbonMission[] = []
const listeners = new Set<() => void>()

function villageAgents(): Array<{ id: string; name: string }> {
  const engine = useOasisStore.getState().agentEngine
  return engine.order.map(id => engine.agents[id]).filter(Boolean).map(agent => ({ id: agent.id, name: agent.name || '' }))
}

/** The counts per agent, from the last list read. */
export function applyVillageMissionCounts(): void {
  useOasisStore.getState().agentEngineDispatch({ type: 'missions/set', counts: openMissionCounts(latest, villageAgents()), at: Date.now() })
}

/** Read the folder again (through /api/village/questions); the counts follow. Quiet without a folder (hosted). */
export async function refreshVillageMissions(): Promise<CarbonMission[]> {
  try {
    const response = await fetch('/api/village/questions', { cache: 'no-store' })
    if (!response.ok) return latest
    const data = await response.json() as { missions?: CarbonMission[] }
    latest = Array.isArray(data.missions) ? data.missions : []
    applyVillageMissionCounts()
    listeners.forEach(listener => listener())
  } catch {
    // No questions folder here: nobody waits on a mission.
  }
  return latest
}

export function getVillageMissions(): CarbonMission[] {
  return latest
}

export function subscribeVillageMissions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** This agent's open missions for the owner, highest priority first (the list comes sorted). */
export function openMissionsOf(agentId: string, missions: CarbonMission[] = latest): CarbonMission[] {
  const agents = villageAgents()
  return missions.filter(mission => mission.state === 'open' && missionAsker(mission.by || '', agents)?.id === agentId)
}
