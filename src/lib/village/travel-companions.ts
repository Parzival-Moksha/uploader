// Agents that follow the owner come out of the same portal a moment after him (Anorak, 22 Nov 2026: "for a followed
// Anorak a moment later"). The exit (world-travel-exit.ts) leaves a mark where the portal stands; each agent that
// follows him (VillageWorld's follower loop) claims it once, appears there, and rolls out the way he did (the roll
// clip, sliding forward 3 m), then follows as usual. Pure apart from the clock and a listener set.

export const COMPANION = {
  /** The first one comes out this long after him; each next one a little later. */
  delayMs: 900,
  staggerMs: 650,
  /** The roll clip (UAL1 Roll, 1.47 s) and how far it carries the body. */
  rollMs: 1470,
  /** Shorter than his 3 m, and to one side of where he came out (right, then left, then further right...), so it
   *  ends up beside him, not on him. */
  slide: 2.2,
  side: 0.9,
  /** A mark nobody claims (no follower here) is dropped after this. */
  expireMs: 8000,
} as const

export interface CompanionSpot {
  x: number
  z: number
  yaw: number
}

interface Exit extends CompanionSpot {
  at: number
  claimed: number
  /** Who came out of it already (each agent once per exit). */
  by: Set<string>
}

interface Roll extends CompanionSpot {
  startedAt: number
}

let pending: Exit | null = null
const rolls = new Map<string, Roll>()
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

/** He just came out of a portal at `spot` (facing its way): followers come out of it next. */
export function requestCompanionExit(spot: CompanionSpot, now: number): void {
  pending = { ...spot, at: now + COMPANION.delayMs, claimed: 0, by: new Set() }
}

/** A follower asks, each frame, whether it comes out now. Once per agent and exit; one after another. */
export function claimCompanionExit(agentId: string, now: number): CompanionSpot | null {
  if (!pending || rolls.has(agentId) || pending.by.has(agentId)) return null
  if (now > pending.at + COMPANION.expireMs) {
    pending = null
    return null
  }
  if (now < pending.at + pending.claimed * COMPANION.staggerMs) return null
  const index = pending.claimed
  pending.claimed += 1
  pending.by.add(agentId)
  // Right of the way he came out: (cos yaw, -sin yaw). Alternating sides, further out every second one.
  const side = (index % 2 === 0 ? 1 : -1) * COMPANION.side * (1 + Math.floor(index / 2) * 0.8)
  const spot = { x: pending.x + Math.cos(pending.yaw) * side, z: pending.z - Math.sin(pending.yaw) * side, yaw: pending.yaw }
  rolls.set(agentId, { ...spot, startedAt: now })
  notify()
  return spot
}

/** Where a rolling agent is now (sliding forward, fast then settling), or null once its roll is over. */
export function companionRollAt(agentId: string, now: number): { x: number; z: number } | null {
  const roll = rolls.get(agentId)
  if (!roll) return null
  const t = (now - roll.startedAt) / COMPANION.rollMs
  if (t >= 1) {
    rolls.delete(agentId)
    notify()
    return null
  }
  const ease = 1 - Math.pow(1 - Math.max(0, t), 3)
  return { x: roll.x + Math.sin(roll.yaw) * COMPANION.slide * ease, z: roll.z + Math.cos(roll.yaw) * COMPANION.slide * ease }
}

export function isCompanionRolling(agentId: string): boolean {
  return rolls.has(agentId)
}

export function subscribeCompanions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getCompanionsVersion(): number {
  return version
}

/** Tests: start again. */
export function resetCompanions(): void {
  pending = null
  rolls.clear()
  notify()
}
