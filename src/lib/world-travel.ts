// Changing worlds by walking through a portal (the owner, 22 Nov 2026): "when I switch worlds, we're gonna have the
// camera snap to my character, and my character entering a literal portal... a portal appear from nowhere, with
// whatever placement effect is active, about one and a half meters away from my character, so my character will just
// take a step. That will mean locking the mouse and locking WASD... during the travel inside of the portal, take as
// long as it needs to. As soon as the new world is loaded, that's when we exit the portal... it should be an
// impermanent portal... the character spawns in the middle or something, and then the portal disappears. And we have
// this effect where the character kind of rolls forward as it arrives right out of the portal."
//
// The pure part: where the portals stand, where he arrives, how a trip ended. The page part is WorldTravelDirector.

import type { PortalGate, PortalGateVariant } from './portal-gates'
import type { PlayerAvatarPose } from './player-avatar-runtime'

export const TRAVEL = {
  /** The portal opens this far ahead of him: one step. */
  portalDistance: 1.5,
  /** It opens (its placement effect) before he steps. */
  openMs: 650,
  /** His step in, metres a second (a walk). */
  stepSpeed: 1.4,
  /** He is in once this close to its plane. */
  inDistance: 0.35,
  /** A step that doesn't arrive (blocked, no body) goes on anyway after this. */
  stepTimeoutMs: 2600,
  /** The new world may take as long as it needs, up to this; then he gets his controls back whatever happened. */
  maxLoadMs: 30_000,
  /** Once the world is in, its assets get this long more behind the travel view (the scene's loading flag counts every
   *  asset anywhere, so it can stay up long after the world itself is there). */
  assetWaitMs: 8000,
  /** The whole trip, whatever happens, never holds his controls longer than this. */
  hardLimitMs: 45_000,
  /** The exit portal closes this long after he rolls out of it. */
  exitCloseMs: 1700,
} as const

export const TRAVEL_VARIANT: PortalGateVariant = 'stargate-vortex'

/** `elsewhere`: a third world came in meanwhile (an agent's load_world while he travelled). */
export type TravelOutcome = 'arrived' | 'failed' | 'elsewhere' | 'timeout'

function forwardOf(pose: PlayerAvatarPose): [number, number] {
  const [fx, , fz] = pose.forward
  const length = Math.hypot(fx, fz)
  return length > 1e-4 ? [fx / length, fz / length] : [Math.sin(pose.yaw), Math.cos(pose.yaw)]
}

/** The portal he walks into: one step ahead, its face turned to him. Local (never saved) and inert (never triggers). */
export function departurePortal(pose: PlayerAvatarPose, worldId: string, id: string): PortalGate {
  const [fx, fz] = forwardOf(pose)
  const yaw = Math.atan2(fx, fz)
  return {
    id,
    variant: TRAVEL_VARIANT,
    label: 'Travel',
    position: [pose.position[0] + fx * TRAVEL.portalDistance, pose.position[1], pose.position[2] + fz * TRAVEL.portalDistance],
    rotationY: yaw + Math.PI,
    width: 2.2,
    height: 3,
    sourceWorldId: worldId,
    inert: true,
  }
}

/** Where he arrives in a world reached from the World menu: its middle, facing along +z. */
export function arrivalPose(): PlayerAvatarPose {
  return { position: [0, 0, 0], yaw: 0, forward: [0, 0, 1] }
}

/** Coming back out where he left (the world didn't open): his old spot, turned round to face away from the portal. */
export function returnPose(departure: PlayerAvatarPose): PlayerAvatarPose {
  const [fx, fz] = forwardOf(departure)
  const yaw = Math.atan2(-fx, -fz)
  return { position: [...departure.position] as [number, number, number], yaw, forward: [-fx, 0, -fz] }
}

/** The portal he comes out of: right behind where he appears, its face turned the way he goes. */
export function exitPortal(arrival: PlayerAvatarPose, worldId: string, id: string): PortalGate {
  const [fx, fz] = forwardOf(arrival)
  return {
    id,
    variant: TRAVEL_VARIANT,
    label: 'Travel',
    position: [arrival.position[0] - fx * 0.25, arrival.position[1], arrival.position[2] - fz * 0.25],
    rotationY: Math.atan2(fx, fz),
    width: 2.2,
    height: 3,
    sourceWorldId: worldId,
    inert: true,
  }
}

/**
 * How a trip ended, once the switch was asked for (null: still loading). The store's switchWorld sets the target at
 * once; when the world doesn't load it puts the old one back, ready.
 */
export function travelOutcome(
  state: { activeWorldId: string | null; _worldReady: boolean },
  target: string,
  origin: string,
  elapsedMs: number,
): TravelOutcome | null {
  if (state._worldReady && state.activeWorldId === target) return 'arrived'
  if (state._worldReady && state.activeWorldId === origin) return 'failed'
  if (state._worldReady && state.activeWorldId) return 'elsewhere'
  if (elapsedMs > TRAVEL.maxLoadMs) return 'timeout'
  return null
}

/**
 * Waits for how the trip ends, and gives up the moment he presses Escape ('skipped'): the controls must come back at
 * once, whatever the load is doing (Merge Goat, 23 Nov). `read` and `wait` are the store and a timer (tests pass fakes).
 */
export async function waitForTravelOutcome(args: {
  read: () => { activeWorldId: string | null; _worldReady: boolean }
  target: string
  origin: string
  skipped: () => boolean
  now: () => number
  wait: (ms: number) => Promise<void>
  issuedAt: number
}): Promise<TravelOutcome | 'skipped'> {
  for (;;) {
    if (args.skipped()) return 'skipped'
    const outcome = travelOutcome(args.read(), args.target, args.origin, args.now() - args.issuedAt)
    if (outcome) return outcome
    await args.wait(40)
  }
}
