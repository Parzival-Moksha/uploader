// ░▒▓ VILLAGE WORLDS — which world each agent is in, so a world shows only its own agents ▓▒░
// The plan (Anorak and the owner, 2026-11-20): agents are people with a home world. Each one is visible only in the
// world it is in; the Agents menu lists everyone, grouped by world; an agent can be called into the owner's world
// (it stays until sent home) and the owner can travel to an agent's world. Anorak, who follows the owner, is in
// whatever world the owner is in. Pure, so it can be tested.

export interface AgentWorldInput {
  /** Follow me is on: it is wherever the owner is. */
  follows: boolean
  /** Called into a world by the owner ("Call here"), until sent home. */
  calledTo: string | null
  /** Its home world, when one is set for it (the shared identity store). */
  homeWorld: string | null
  /** The worlds where it has a home spot (village-homes.ts), in no particular order. */
  homeSpots: string[]
}

/**
 * The village's world when the owner chose "Agents come with me" (Settings > Agents): everyone appears wherever he
 * is. Stored as the village's world in the homes file; unset (null) is not this any more (2026-11-22: the owner
 * walked into Portal Zero and all 25 agents were there; "I thought that by default they just spawn in a specific
 * world"): the page sets the village's world the first time it is opened in one.
 */
export const VILLAGE_EVERYWHERE = 'everywhere'

/**
 * The world it is in: the owner's when it follows across worlds; the one it was called into; its home world (where
 * it was summoned); the one world where it has a home spot; else the village's world. null: every world, only
 * with "Agents come with me" (or for the moment before a fresh village has its world).
 */
export function agentWorld(input: AgentWorldInput, villageWorld: string | null, currentWorld: string | null): string | null {
  if (input.follows) return currentWorld
  if (input.calledTo) return input.calledTo
  if (villageWorld === VILLAGE_EVERYWHERE) return null
  if (input.homeWorld) return input.homeWorld
  if (input.homeSpots.length === 1) return input.homeSpots[0]
  return villageWorld
}

export function isAgentHere(world: string | null, currentWorld: string | null): boolean {
  return world === null || world === currentWorld
}

export interface WorldGroup {
  world: string | null
  name: string
  here: boolean
  ids: string[]
}

/** The Agents menu's groups: this world first, then the others by name; agents keep their order inside a group. */
export function groupAgentsByWorld(
  ids: readonly string[],
  worldOf: (id: string) => string | null,
  currentWorld: string | null,
  nameOf: (world: string) => string,
): WorldGroup[] {
  const groups = new Map<string, WorldGroup>()
  for (const id of ids) {
    const world = worldOf(id)
    const here = isAgentHere(world, currentWorld)
    const key = here ? '\u0000here' : String(world)
    let group = groups.get(key)
    if (!group) {
      group = { world: here ? currentWorld : world, name: here ? (currentWorld ? nameOf(currentWorld) : 'Here') : nameOf(String(world)), here, ids: [] }
      groups.set(key, group)
    }
    group.ids.push(id)
  }
  return [...groups.values()].sort((a, b) => (a.here === b.here ? a.name.localeCompare(b.name) : a.here ? -1 : 1))
}
