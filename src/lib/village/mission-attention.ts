// ░▒▓ MISSION ATTENTION — which agents wait on the owner's answer to a mission they wrote ▓▒░
// The owner (2026-11-21): agents should walk up to him "when they have stuff that needs decisions", not to report
// that they are done. A real question is a carbon mission, a file in docs/questions with its asker in `by:`
// (README there). An agent with an open one needs him: the "?" with the number over its head, the chime, N, walking
// up (village attentionRank). Pure: the page polls /api/village/questions and dispatches the counts.

import { resolveAsker } from './carbon-missions'

export interface MissionLike {
  state: string
  by: string
}

export interface AgentLike {
  id: string
  name: string
}

/**
 * The agent that asked, by Mission Wall's one rule (carbon-missions.ts resolveAsker, the same that decides who is
 * told when he answers): its name, the start of its name, Anorak when he or a helper asked; nobody when the asker
 * is not in the village (Anorak is never a stand-in for someone who left). So the "?" number, the agent's own
 * Mindcraft page and Mindcraft's Carbon list always agree.
 */
export function missionAsker<T extends AgentLike>(by: string, agents: T[]): T | null {
  return resolveAsker(by, agents).agent
}

/** Open missions per agent id (parked and answered ones wait on nobody). */
export function openMissionCounts(missions: MissionLike[], agents: AgentLike[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const mission of missions) {
    if (mission.state !== 'open') continue
    const asker = missionAsker(mission.by || '', agents)
    if (asker) counts[asker.id] = (counts[asker.id] || 0) + 1
  }
  return counts
}
