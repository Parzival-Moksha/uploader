// ░▒▓ AGENT THINGS — what an agent built around its home, and the same things moved to another world (pure, tested) ▓▒░
// The owner, 27 Nov (sorting the agents into worlds, on camera): "if there's going to be a new world with Hacker and
// Windows Guru, their assets need to move with them". An agent's things in a world: the crafted scenes, placed objects
// and lights within its home's build ground (HOME.buildRadius), and any crafted scene named after it ("ASI Piller ·
// The Open Pill"). Nothing records who built what, so this is the best guess, and the owner ticks what comes along.
// Moved as one group: each keeps its place relative to the home, around the spot he picks in the new world.

type Vec3 = [number, number, number]
interface Placed { id: string; name?: string; position?: Vec3 | number[] }
export interface Transform { position?: Vec3 | number[]; rotation?: Vec3 | number[]; scale?: Vec3 | number[] | number }

export interface WorldThingsData {
  craftedScenes?: Placed[]
  catalogPlacements?: Placed[]
  lights?: Placed[]
  transforms?: Record<string, Transform>
}

export type ThingKind = 'crafted' | 'object' | 'light'

export interface AgentThing<T extends Placed = Placed> {
  kind: ThingKind
  item: T
  /** Where it stands now (its transform, else its own position). */
  at: Vec3
  transform?: Transform
  /** Why it counts as the agent's: near its home, or named after it. */
  why: 'near' | 'named'
}

const vec = (value: unknown): Vec3 | null =>
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n)) ? [value[0], value[1], value[2]] as Vec3 : null

/**
 * The agent's things in one world. `home`: its home spot there (null: only the things named after it count).
 * A scene laid out over the whole world (at 0, 0, 0 and named "Oasis · ...") is the world's, never an agent's.
 */
export function pickAgentThings(data: WorldThingsData, home: { x: number; z: number } | null, name: string, radius: number): AgentThing[] {
  const out: AgentThing[] = []
  const prefix = name.trim() ? `${name.trim().toLowerCase()} ·` : null
  const consider = (kind: ThingKind, items: Placed[] | undefined) => {
    for (const item of items || []) {
      if (!item || typeof item.id !== 'string') continue
      const transform = data.transforms?.[item.id]
      const at = vec(transform?.position) ?? vec(item.position)
      if (!at) continue
      const named = kind === 'crafted' && prefix !== null && typeof item.name === 'string' && item.name.trim().toLowerCase().startsWith(prefix)
      if (kind === 'crafted' && typeof item.name === 'string' && /^oasis ·/i.test(item.name.trim())) continue
      const near = home !== null && Math.hypot(at[0] - home.x, at[2] - home.z) <= radius
      // A world-wide light (ambient, the sun) belongs to the world wherever its number puts it.
      if (kind === 'light' && /ambient|directional|hemisphere/i.test(String((item as { type?: unknown }).type || ''))) continue
      if (named || near) out.push({ kind, item, at, transform, why: named ? 'named' : 'near' })
    }
  }
  consider('crafted', data.craftedScenes)
  consider('object', data.catalogPlacements)
  consider('light', data.lights)
  return out
}

/** Where a thing goes: the same place relative to the home, around `to`. Height kept. */
export function shiftedPosition(at: Vec3, from: { x: number; z: number }, to: { x: number; z: number }): Vec3 {
  return [at[0] - from.x + to.x, at[1], at[2] - from.z + to.z]
}

/** The middle of the things (where the group is moved from when the agent has no home spot). */
export function thingsCentre(things: readonly AgentThing[]): { x: number; z: number } | null {
  if (!things.length) return null
  let x = 0
  let z = 0
  for (const thing of things) {
    x += thing.at[0]
    z += thing.at[2]
  }
  return { x: x / things.length, z: z / things.length }
}

/** "The Root Shell, a light and 2 objects": what comes along, for the button and the notice. */
export function describeThings(things: readonly AgentThing[]): string {
  const names = things.filter(t => t.kind === 'crafted').map(t => (t.item.name || 'a build').replace(/^[^·]*·\s*/, ''))
  const objects = things.filter(t => t.kind === 'object').length
  const lights = things.filter(t => t.kind === 'light').length
  const parts = [...names]
  if (objects) parts.push(objects === 1 ? 'an object' : `${objects} objects`)
  if (lights) parts.push(lights === 1 ? 'a light' : `${lights} lights`)
  if (parts.length <= 1) return parts[0] || 'nothing'
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
