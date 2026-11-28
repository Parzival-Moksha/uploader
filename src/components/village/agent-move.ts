// ░▒▓ AGENT MOVE (page) — "Live in this world": an agent's home world becomes the one he stands in ▓▒░
// The owner, 27 Nov (sorting the agents into worlds, on camera: a portal to a new world, "the Hacker world", then he
// invites Hacker and Windows Guru): one action in the agent's panel. Its home world becomes this one; it appears here
// and stays when he leaves (a "Call here" visit stays what it was: until sent home). If he says so, the things it built
// around its home in its old world (lib/village/agent-things.ts: the Root Shell, the ASI Pill stage) come along as one
// group, around the spot where he stands, each in the same place relative to the home, which moves with them.
// How: this world is the one his page has open, so the things are added through the page's own store (which saves it);
// the old world is not open, so they are taken out of it on the server (/api/worlds/<id>/commands, one per thing),
// after they are safely here. The village's own world is never touched (Debugger's, VillageWorldRow).

import { useOasisStore } from '../../store/oasisStore'
import { applyStoreWorldCommand } from '../../lib/world-commands/store-adapter'
import { makeWorldCommand } from '../../lib/world-commands/legacy-map'
import { HOME } from '../../lib/village/village-homes'
import { villageAgentKey } from '../../lib/village/village-layout'
import { pickAgentThings, shiftedPosition, thingsCentre, type AgentThing, type WorldThingsData } from '../../lib/village/agent-things'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { callVillageAgent, clearVillageHome, currentVillageWorld, getVillageHome, getVillageHomesFile, setVillageHome } from './village-homes'
import { setVillageAgentHomeWorld, villageAgentWorld } from './village-worlds'
import type { CatalogPlacement, CraftedScene, WorldLight } from '../../lib/conjure/types'

type Vec3 = [number, number, number]

export interface AgentThingsHere {
  /** The world it lives in now (where the things are). */
  from: string
  things: AgentThing[]
}

function agentKeyOf(agentId: string): string {
  const agent = useOasisStore.getState().agentEngine.agents[agentId]
  return villageAgentKey({ id: agentId, sessionId: agent?.sessionId ?? null })
}

/** What it built around its home in the world it lives in (null when it lives here, or that world can't be read). */
export async function readAgentThings(agentId: string): Promise<AgentThingsHere | null> {
  const here = currentVillageWorld()
  const from = villageAgentWorld(agentId)
  if (!from || from === here) return null
  const agent = useOasisStore.getState().agentEngine.agents[agentId]
  const response = await fetch(`/api/worlds/${encodeURIComponent(from)}`, { cache: 'no-store' })
  if (!response.ok) return null
  const body = await response.json() as WorldThingsData & { data?: WorldThingsData }
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const home = getVillageHome(from, agentKeyOf(agentId))
  return { from, things: pickAgentThings(data, home, agent?.name || '', HOME.buildRadius) }
}

/** This world's saved copy has every one of them (asked again for up to 15 s: the save is debounced). */
async function savedHere(worldId: string, things: readonly AgentThing[]): Promise<boolean> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 1500))
    const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}`, { cache: 'no-store' }).catch(() => null)
    if (!response?.ok) continue
    const body = await response.json().catch(() => null) as (WorldThingsData & { data?: WorldThingsData }) | null
    const data = body?.data && typeof body.data === 'object' ? body.data : body
    const ids = new Set([...(data?.craftedScenes || []), ...(data?.catalogPlacements || []), ...(data?.lights || [])].map(item => item.id))
    if (things.every(thing => ids.has(thing.item.id))) return true
  }
  return false
}

async function removeFromWorld(worldId: string, things: readonly AgentThing[]): Promise<number> {
  let failed = 0
  for (const thing of things) {
    const command = thing.kind === 'crafted'
      ? makeWorldCommand('crafted.remove', { id: thing.item.id }, { worldId, actorId: 'local-user' })
      : thing.kind === 'object'
        ? makeWorldCommand('object.remove', { id: thing.item.id }, { worldId, actorId: 'local-user' })
        : makeWorldCommand('light.remove', { id: thing.item.id }, { worldId, actorId: 'local-user' })
    const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }).catch(() => null)
    if (!response?.ok) failed += 1
  }
  return failed
}

/**
 * Its home world becomes this one. `bring`: its things from the old world, moved around where he stands (they keep
 * their places relative to its home; the home comes along). Returns a sentence for the notice.
 */
export async function liveInThisWorld(agentId: string, bring: AgentThingsHere | null): Promise<string> {
  const here = currentVillageWorld()
  if (!here) throw new Error('no world open')
  const key = agentKeyOf(agentId)
  const name = useOasisStore.getState().agentEngine.agents[agentId]?.name || 'It'
  setVillageAgentHomeWorld(key, here)
  // A visit becomes a home: it is no longer "called here".
  if (getVillageHomesFile().calls[key]) await callVillageAgent(key, null)
  const things = bring?.things || []
  if (!bring || !things.length) return `${name} lives in this world now.`

  const pose = getPlayerAvatarPose()
  if (!pose) throw new Error('stand somewhere in this world first (walk with your avatar)')
  // Only into a world he may build in: anywhere else the page would not save them, and they must never be nowhere.
  const meta = useOasisStore.getState().worldRegistry.find(world => world.id === here)
  if (!meta || meta.canWrite !== true) return `${name} lives in this world now. Its things stay where they are: this world is not yours to build in.`
  const oldHome = getVillageHome(bring.from, key)
  const origin = oldHome ?? thingsCentre(things) ?? { x: pose.position[0], z: pose.position[2] }
  const to = { x: pose.position[0], z: pose.position[2] }
  const store = useOasisStore.getState()
  for (const thing of things) {
    const position = shiftedPosition(thing.at, origin, to)
    const context = { worldId: here, actorId: 'local-user' }
    const state = useOasisStore.getState()
    const result = thing.kind === 'crafted'
      ? applyStoreWorldCommand(state, 'crafted.add', { scene: { ...(thing.item as unknown as CraftedScene), position } }, context)
      : thing.kind === 'object'
        ? applyStoreWorldCommand(state, 'object.add', { object: { ...(thing.item as unknown as CatalogPlacement), position } }, context)
        : applyStoreWorldCommand(state, 'light.add', { light: { ...(thing.item as unknown as WorldLight), position } }, context)
    if (result.changed) useOasisStore.setState(result.patch)
    if (thing.transform) {
      const t = thing.transform
      store.setObjectTransform(thing.item.id, {
        position,
        ...(Array.isArray(t.rotation) ? { rotation: t.rotation.slice(0, 3) as Vec3 } : {}),
        ...(t.scale !== undefined ? { scale: (Array.isArray(t.scale) ? t.scale.slice(0, 3) : t.scale) as Vec3 | number } : {}),
      })
    }
  }
  useOasisStore.getState().saveWorldState()
  // Its home ground comes along: the same spot relative to its things, facing the same way.
  if (oldHome) {
    await setVillageHome(here, key, { x: to.x, z: to.z, yaw: oldHome.yaw })
    await clearVillageHome(bring.from, key)
  }
  // Out of the old world only once this world's saved copy has them (read back from the server): a save that did not
  // happen leaves a copy in the old world, never nothing anywhere.
  if (!(await savedHere(here, things))) {
    return `${name} lives here now and its things are here, but this world's save was not confirmed, so a copy of them stays in the old world for now.`
  }
  const failed = await removeFromWorld(bring.from, things)
  return failed
    ? `${name} lives here now with its things; ${failed} could not be taken out of the old world (a copy stays there).`
    : `${name} lives here now, with its things.`
}
