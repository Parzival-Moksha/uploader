// The page side of world travel that is not tied to the 3D scene: asking for a trip (the World menu, "Go there") and
// the exit every trip ends with (WorldTravelDirector for the World menu, PortalGateLayer for portals placed in a
// world, such as the Council's): a portal opens at his back where he appears, he rolls out of it, it closes.

import { useOasisStore } from '../store/oasisStore'
import { PORTAL_REVEAL_ROLL_EVENT, readPortalTransitionSettings } from './portal-transition-settings'
import { getPlayerCinematic, setPlayerCinematic, type PlayerAvatarPose } from './player-avatar-runtime'
import { exitPortal, TRAVEL } from './world-travel'
import { COMPANION, requestCompanionExit } from './village/travel-companions'

export const WORLD_TRAVEL_EVENT = 'oasis:world-travel'
/** Same name as PortalGateLayer's PORTAL_GATE_REVEAL_EVENT (not imported: that module imports this one). */
const PORTAL_GATE_REVEAL = 'oasis:portal-gate-reveal'

export interface WorldTravelRequest {
  worldId: string
  worldName?: string
}

let directorMounted = false
let travelling = false

export function setWorldTravelDirectorMounted(mounted: boolean): void {
  directorMounted = mounted
}

export function setWorldTravelActive(active: boolean): void {
  travelling = active
}

export function isWorldTravelActive(): boolean {
  return travelling
}

/**
 * Go to another world. With "Walk through a portal" on (Settings, World VFX) and the 3D scene up, he walks through a
 * conjured portal (WorldTravelDirector); otherwise, or while a trip is already on, the plain switch.
 */
export function travelToWorld(worldId: string, worldName?: string): void {
  const store = useOasisStore.getState()
  if (!worldId || worldId === store.activeWorldId) return
  if (travelling) return
  if (!directorMounted || !readPortalTransitionSettings().walkThroughPortal) {
    store.switchWorld(worldId)
    return
  }
  window.dispatchEvent(new CustomEvent<WorldTravelRequest>(WORLD_TRAVEL_EVENT, { detail: { worldId, worldName } }))
}

/**
 * Holds his keys (the cinematic, no target, no speed) while `step` runs and for up to `ms` after, then always lets go:
 * a throw in `step` is caught, and the hold ends on its own timer even if nobody calls the release it returns (Merge
 * Goat, 23 Nov: a throw between hold and release would have left WASD dead until a reload).
 */
export function holdKeysFor(ms: number, step: () => void): () => void {
  const hold = { target: null, speed: 0 }
  setPlayerCinematic(hold)
  let released = false
  const release = () => {
    if (released) return
    released = true
    clearTimeout(timer)
    // Only our hold: a trip that took the cinematic over in the meantime keeps its own.
    if (getPlayerCinematic() === hold) setPlayerCinematic(null)
  }
  const timer = setTimeout(release, Math.max(0, ms))
  try {
    step()
  } catch (error) {
    console.error('[WorldTravel] the exit failed', error)
  }
  return release
}

function revealSoon(gateId: string) {
  // After PortalGateLayer has drawn the new gate (its reveal burst looks the gate up in what it draws).
  window.requestAnimationFrame(() => window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(PORTAL_GATE_REVEAL, { detail: { gateId } }))
  }, 30))
}

/** A temporary portal: opens with the active placement effect (and the portal's own reveal burst). */
export function openTravelPortal(gate: Parameters<ReturnType<typeof useOasisStore.getState>['addLocalPortalGate']>[0]): void {
  const store = useOasisStore.getState()
  store.addLocalPortalGate(gate)
  store.spawnPlacementVfx(gate.position)
  revealSoon(gate.id)
}

/** It closes: the placement effect once more where it stood, and it is gone. */
export function closeTravelPortal(gateId: string): void {
  const store = useOasisStore.getState()
  const gate = store.localPortalGates.find(candidate => candidate.id === gateId)
  if (!gate) return
  store.spawnPlacementVfx(gate.position)
  store.removeLocalPortalGate(gateId)
}

/**
 * He has just appeared at `arrival` in `worldId`: a portal opens at his back unless one already stands there (a
 * placed portal's return gate), he rolls out (PlayerAvatar's reveal roll, 3 m forward), and the temporary portal
 * closes behind him.
 */
export function openTravelExit(
  arrival: PlayerAvatarPose | null,
  worldId: string | null,
  options?: { gateId?: string; targetWorldName?: string },
): void {
  if (typeof window === 'undefined') return
  const store = useOasisStore.getState()
  if (arrival && worldId) {
    const near = [...store.portalGates, ...store.localPortalGates].find(gate =>
      Math.hypot(gate.position[0] - arrival.position[0], gate.position[2] - arrival.position[2]) < 2.5)
    console.info(`[WorldTravel] exit at ${arrival.position.map(n => n.toFixed(1)).join(',')}: ${near ? `the portal ${near.id} already stands there` : 'a portal opens at his back'}`)
    if (!near) {
      const gate = exitPortal(arrival, worldId, `travel-exit-${Date.now().toString(36)}`)
      openTravelPortal(gate)
      // Open long enough for an agent that follows him to come out after him (travel-companions.ts).
      window.setTimeout(() => closeTravelPortal(gate.id), Math.max(TRAVEL.exitCloseMs, COMPANION.delayMs + COMPANION.rollMs))
    }
    requestCompanionExit({ x: arrival.position[0], z: arrival.position[2], yaw: arrival.yaw }, performance.now())
  }
  window.dispatchEvent(new CustomEvent(PORTAL_REVEAL_ROLL_EVENT, {
    detail: { gateId: options?.gateId, targetWorldName: options?.targetWorldName, animationId: 'ual-roll' },
  }))
}
