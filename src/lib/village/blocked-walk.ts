// ░▒▓ BLOCKED WALK — an agent that waits on his click walks to him after a minute (pure, tested) ▓▒░
// The owner, 26 Nov (relayed by Anorak): "if that happens, I think agents should just literally walk to me, and I'm
// surprised that Tyler didn't walk to me... because that could block the whole Oasis for one click." Tyler sat
// 3 h 20 min on a delete prompt. A blocked agent cannot run its own `me.mjs come`, so the page does it:
//   · an open permission, question or plan card older than a minute (the engine's asked-at time, so a reload does not
//     restart the minute) walks its avatar to him, whatever "Come to me" (Settings) says; its own Come to me switch
//     (its settings) still keeps it home;
//   · only while he is in the Oasis: the page is shown and he did something in the last ten minutes; else nothing
//     walks (the chime, the count and his phone carry it);
//   · several wait in a line beside him, oldest first (nearest him, so E opens the oldest), out of the middle of his
//     view; each faces him; the line moves up as cards are answered. Nothing takes his mouse or his camera.
// The sign over its head says what it needs (Citizens' permissionSign, village-decisions.ts).

export const BLOCKED_WALK = {
  /** Waiting this long on his click: it walks to him. */
  afterMs: 60_000,
  /** No key, click or wheel from him this long (or the page hidden): he is not in the Oasis, nobody walks. */
  awayAfterMs: 10 * 60_000,
} as const

export const QUEUE = {
  /** The first in line stands this far from him... */
  distance: 2.4,
  /** ...this far round to his right from straight ahead (radians: 60 degrees), out of the middle of his view. */
  angle: Math.PI / 3,
  /** Each next one this much further along the line, which runs out to his right and a little back. */
  spacing: 1.2,
  /** How much the line leans back (0: straight out to his right). */
  lean: 0.35,
} as const

interface WaitingCard { receivedAt: number }

/** Since when it waits on him (its oldest open card), or null. */
export function blockedSince(agent: { decisions?: readonly WaitingCard[] | null } | null | undefined): number | null {
  let since: number | null = null
  for (const card of agent?.decisions || []) if (Number.isFinite(card.receivedAt) && (since === null || card.receivedAt < since)) since = card.receivedAt
  return since
}

/** Is he in the Oasis: the page shown, and something he did not long ago. */
export function ownerPresent(visible: boolean, lastInputAt: number | null, now: number): boolean {
  return visible && lastInputAt !== null && now - lastInputAt < BLOCKED_WALK.awayAfterMs
}

/**
 * Does a blocked agent walk to him now? (When not yet, `wakeIn` says in how many ms to look again.) `already`: it is
 * on its way or stands beside him for this card: it stays until he answers, even if he goes quiet meanwhile.
 */
export function blockedWalk(since: number | null, now: number, present: boolean, comeOn: boolean, already = false): { walk: boolean; wakeIn: number | null } {
  if (since === null || !comeOn) return { walk: false, wakeIn: null }
  const left = since + BLOCKED_WALK.afterMs - now
  if (left > 0) return { walk: false, wakeIn: left }
  return { walk: present || already, wakeIn: null }
}

/** Its place in the line: how many came before it (oldest first; the same time: by id). */
export function queueIndex(line: ReadonlyMap<string, number> | Record<string, number>, agentId: string): number {
  const entries = line instanceof Map ? [...line.entries()] : Object.entries(line)
  const mine = entries.find(([id]) => id === agentId)
  if (!mine) return entries.length
  return entries.filter(([id, since]) => since < mine[1] || (since === mine[1] && id < agentId)).length
}

/**
 * The spot of number `index` in the line beside him (`owner` with where he faces). The first stands `distance`
 * from him, 60 degrees to his right; the rest follow outward along a line that leans a little back, each facing him.
 * `distance`: QUEUE.distance, or further while he is busy with another agent.
 */
export function queueSpot(owner: { x: number; z: number; forwardX?: number; forwardZ?: number }, index: number, distance: number = QUEUE.distance): { x: number; z: number } {
  let fx = owner.forwardX ?? 0
  let fz = owner.forwardZ ?? 0
  const length = Math.hypot(fx, fz)
  if (length < 1e-4) {
    fx = 0
    fz = 1
  } else {
    fx /= length
    fz /= length
  }
  // His right, on the ground (forward (0, 1) has its right at (-1, 0) in this world: yaw = atan2(fx, fz)).
  const rx = -fz
  const rz = fx
  const c = Math.cos(QUEUE.angle)
  const s = Math.sin(QUEUE.angle)
  const firstX = owner.x + (fx * c + rx * s) * distance
  const firstZ = owner.z + (fz * c + rz * s) * distance
  let lx = rx - fx * QUEUE.lean
  let lz = rz - fz * QUEUE.lean
  const l = Math.hypot(lx, lz)
  lx /= l
  lz /= l
  const n = Math.max(0, Math.floor(index))
  return { x: firstX + lx * QUEUE.spacing * n, z: firstZ + lz * QUEUE.spacing * n }
}
