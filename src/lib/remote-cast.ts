// ░▒▓ REMOTE CAST — what other visitors see when someone casts ▓▒░
// The owner, 28 Nov (the deployed Oasis, two screens): "the caster faces the wrong way and stands in a boxing
// stance without boxing". A caster's own animation name reached the others late or not at all (a clip still
// loading there when the name had already moved on). Now the cast itself drives it: when another player's bolt
// arrives (pvp-bridge onRemoteBolt), their avatar turns to the bolt's direction and plays that spell's gesture
// once (RemoteVRMAvatar, MultiplayerPresenceLayer). Gesture names sent over the network are ignored.

import { castGestureFor } from '@/components/forge/combat-stance'

export interface RemoteCast { clip: string; yaw: number; at: number }

/** How long the gesture leads; the facing is held a little longer so a burst keeps them turned. */
export const REMOTE_CAST_GESTURE_MS = 750
export const REMOTE_CAST_FACING_MS = 1400

const casts = new Map<string, RemoteCast>()

export function noteRemoteCast(sessionId: string, spell: string, direction: [number, number, number], now = performance.now()): void {
  if (!sessionId) return
  const [dx, , dz] = direction
  casts.set(sessionId, { clip: castGestureFor(spell).clip, yaw: Math.atan2(dx, dz), at: now })
}

export function getRemoteCast(sessionId: string, now = performance.now()): RemoteCast | null {
  const cast = casts.get(sessionId)
  if (!cast) return null
  if (now - cast.at > REMOTE_CAST_FACING_MS) { casts.delete(sessionId); return null }
  return cast
}

/** Animation names that are decided on each screen from events (hits, casts), never taken from the network. */
const EVENT_DRIVEN = new Set(['ual-death', 'ual-hit-knockback', 'ual-throw', 'ual-punch-cross', 'ual-spell-shoot', 'ual-pistol-shoot'])
export function isEventDrivenAnim(networkState: string): boolean {
  return networkState.startsWith('custom:') && EVENT_DRIVEN.has(networkState.slice('custom:'.length))
}
