// What an agent's body does while it stands, by what it is doing (the owner, 2026-11-20, first recording 9:52-16:40):
//   - waiting for him (the "!"): "instead of like the original idle, they could cycle across idle torch, spell simple
//     idle, idle fold arms", "sword idle could also be one of those idles that they use when they are waiting for me",
//     "swim idle ... could be also one of those waiting for you idle animations";
//   - working: "talking phone could be one of the defaults for when they're working", "fixing kneeling could also be one
//     of the first random and then less random animations that the avatars could cycle through as they work", "tree
//     chopping needs to be one of those as well";
//   - talking: "the idle talking, we already have that" (when they talk to him; on the phone they are not).
// Each agent picks its own from the pool and changes every so often (with a blend), so they don't all look the same.
// All clips are from Quaternius's free packs (CC0).

export type AgentPose = 'waiting' | 'working' | 'talking' | 'resting'

export const IDLE_POOLS: Record<'waiting' | 'working', readonly string[]> = {
  waiting: ['ual-idle-torch', 'ual-spell-idle', 'ual-fold-arms', 'ual-sword-idle', 'ual-swim-idle'],
  // 24 Nov: "add one more animation to working, which is like typing on a computer" (standing: no chair yet).
  working: ['ual-phone', 'authored-stand-type', 'ual-fixing', 'ual-chop'],
}
export const TALKING_CLIP = 'ual-talking'
/** Without variety (Settings > Agents): one clip per state, the first one he named. */
export const PLAIN_CLIP: Record<'waiting' | 'working', string> = { waiting: 'ual-fold-arms', working: 'ual-phone' }

/** How long one clip holds before the next, seconds: each agent has its own length in this range. */
export const HOLD_MIN_S = 18
export const HOLD_MAX_S = 36

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** This agent's own hold length, seconds. */
export function holdSeconds(agentId: string): number {
  return HOLD_MIN_S + (hash(`${agentId}:hold`) % 1000) / 1000 * (HOLD_MAX_S - HOLD_MIN_S)
}

/** This agent's order through the pool on one lap: a shuffle seeded by its id and the lap. */
function lapOrder(agentId: string, pool: readonly string[], lap: number): string[] {
  const order = [...pool].sort((a, b) => hash(`${agentId}:${lap}:${a}`) - hash(`${agentId}:${lap}:${b}`))
  // The seam between laps never repeats a clip.
  if (lap > 0) {
    const before = lapOrder(agentId, pool, lap - 1)
    if (order[0] === before[before.length - 1]) [order[0], order[1]] = [order[1], order[0]]
  }
  return order
}

/**
 * The clip for an agent's `round` in a pool: its own shuffled order, a new one each time round the pool, so two agents
 * side by side rarely match and one agent never plays the same clip twice in a row.
 */
export function pickVariety(agentId: string, pool: readonly string[], round: number): string {
  if (pool.length === 0) return ''
  if (pool.length === 1) return pool[0]
  const lap = Math.floor(round / pool.length)
  return lapOrder(agentId, pool, lap)[round % pool.length]
}

// ░▒▓ EACH AGENT'S OWN WAY OF BEING ▓▒░
// The owner, 26 Nov, in the animation browser: "when agents spawn ... part of their character is how they idle. Some
// sit down, some fold arms, some ground sit idle. But all of them just doing the one same idle? No." / "ground sit
// enter, idle, and exit. It's genius" / "I love idle look around" / "idle tired ... if they have been waiting for me
// for too long" / "some agents could just crawl instead of walk ... 20% of the agents" / "it'd be great if each agent
// worked one particular way". So every agent has a rest style, a working clip and a way of moving, read from its id:
// the same each time, and the agents that already exist get theirs too. The Pro clips are UAL1 Pro (CC0, the owner's
// purchase of 24 Nov, shipped).

/** Ground sit: down (once), the seated loop, up again (once). Lengths read from UAL1_Pro.glb, seconds. */
export const GROUND_SIT = {
  enter: 'ualpro-1-GroundSit_Enter', loop: 'ualpro-1-GroundSit_Idle_Loop', exit: 'ualpro-1-GroundSit_Exit',
  enterS: 2.5, exitS: 2.17,
} as const

/** What it does when it has nothing to do. Weight: how many agents in ten, roughly. */
export const REST_STYLES = {
  stand: { clip: null, weight: 2 },
  'look-around': { clip: 'ualpro-1-Idle_LookAround_Loop', weight: 2 },
  'fold-arms': { clip: 'ual-fold-arms', weight: 2 },
  'ground-sit': { clip: GROUND_SIT.loop, weight: 3 },
  swim: { clip: 'ual-swim-idle', weight: 1 },
} as const satisfies Record<string, { clip: string | null; weight: number }>
export type RestStyle = keyof typeof REST_STYLES

/**
 * Waiting for him longer than this, tired joins its waiting idles as one more turn (seconds). The owner, 27 Nov:
 * "everybody is in zombie mode... this tired idle is too prominent around the Oasis": it is for a real question left
 * long unanswered (VillageWorld only poses 'waiting' for an open card, not for a dead process), and rare.
 */
export const TIRED_AFTER_S = 600
export const TIRED_CLIP = 'ualpro-1-Idle_Tired_Loop'
const WAITING_LONG: readonly string[] = [...IDLE_POOLS.waiting, TIRED_CLIP]

/** Crawl: down on all fours, crawling, up again. Lengths read from UAL1_Pro.glb, seconds. */
export const CRAWL = {
  enter: 'ualpro-1-Crawl_Enter', loop: 'ualpro-1-Crawl_Fwd_Loop', idle: 'ualpro-1-Crawl_Idle_Loop', exit: 'ualpro-1-Crawl_Exit',
  enterS: 2.13, exitS: 2.0,
} as const

export interface AgentStyle {
  rest: RestStyle
  /** Its one working clip, from IDLE_POOLS.working. */
  work: string
  moves: 'walk' | 'crawl'
}

/** This agent's own style, from its id (independent draws, so rest, work and moves don't follow one another). */
export function agentStyle(agentId: string): AgentStyle {
  const styles = Object.keys(REST_STYLES) as RestStyle[]
  const total = styles.reduce((sum, s) => sum + REST_STYLES[s].weight, 0)
  let roll = hash(`${agentId}:rest`) % total
  let rest: RestStyle = styles[0]
  for (const s of styles) {
    if (roll < REST_STYLES[s].weight) { rest = s; break }
    roll -= REST_STYLES[s].weight
  }
  const work = IDLE_POOLS.working[hash(`${agentId}:work`) % IDLE_POOLS.working.length]
  const moves = hash(`${agentId}:moves`) % 100 < 20 ? 'crawl' : 'walk'
  return { rest, work, moves }
}

/**
 * The clip for a pose (null: the plain idle). With variety (Settings > Agents, on by default) each agent rests and works
 * its own way and cycles its waiting idles, tired once it has waited `waitedS` past TIRED_AFTER_S; without, one clip
 * per state for everyone. Resting gives the rest style's loop (a ground sitter's seated loop: VillageWorld plays the
 * getting down and up around it).
 */
export function clipForPose(agentId: string, pose: AgentPose, round: number, variety: boolean, waitedS = 0): string | null {
  if (pose === 'talking') return TALKING_CLIP
  if (!variety) return pose === 'resting' ? null : PLAIN_CLIP[pose]
  if (pose === 'resting') return REST_STYLES[agentStyle(agentId).rest].clip
  if (pose === 'working') return agentStyle(agentId).work
  return pickVariety(agentId, waitedS > TIRED_AFTER_S ? WAITING_LONG : IDLE_POOLS.waiting, round)
}
