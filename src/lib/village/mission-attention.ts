// ░▒▓ MISSION ATTENTION — which agents wait on the owner's answer to a mission they wrote ▓▒░
// The owner (2026-11-21): agents should walk up to him "when they have stuff that needs decisions", not to report
// that they are done. A real question is a carbon mission, a file in docs/questions with its asker in `by:`
// (README there). An agent with an open one needs him: the "?" with the number over its head, the chime, N, walking
// up (village attentionRank). Pure: the page polls /api/village/questions and dispatches the counts.

export interface MissionLike {
  state: string
  by: string
}

export interface AgentLike {
  id: string
  name: string
}

function normal(text: string): string {
  return text.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The agent that asked: its name whole (any case), else the first name in a list ("Hustler, Anorak" is Hustler's),
 * else an agent whose name starts with it ("Citizens" for "Citizens (dev)"). Nobody when the asker isn't in the
 * village: a mission is never pinned on someone else (unlike Mindcraft's "talk to" link, which falls back to Anorak).
 */
export function missionAsker<T extends AgentLike>(by: string, agents: T[]): T | null {
  const wanted = normal(by)
  if (!wanted) return null
  const named = (name: string) => agents.find(agent => normal(agent.name || '') === name) || null
  const whole = named(wanted)
  if (whole) return whole
  const first = normal(by.split(/[,;+&]| and | via /i)[0] || '')
  if (!first) return null
  return named(first) || (first.length > 2 ? agents.find(agent => normal(agent.name || '').startsWith(first)) || null : null)
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
