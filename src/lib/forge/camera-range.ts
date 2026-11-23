// ░▒▓ CAMERA RANGE — the camera's near and far planes ▓▒░
// Far: how far the world is drawn (Settings → Graphics → View distance), capped lower by the flop
// saver's last tier. Near: grows with the camera's height. The depth buffer's precision at a
// distance z is about z² / (near · 2^24): with near at 0.1 m two surfaces 7 mm apart already
// flicker against each other seen from 110 m up (the plaza's floor and its pattern in Oasis Dusk,
// 23 Nov). From up there nothing is closer than a few metres, so near can grow to 2 m and the
// precision is 20 times better; on the ground it stays 0.1 m, as before.

export const VIEW_DISTANCES = [250, 500, 1000, 2000] as const
export type ViewDistance = (typeof VIEW_DISTANCES)[number]
export const VIEW_DISTANCE_DEFAULT: ViewDistance = 500

export const NEAR_GROUND_M = 0.1
export const NEAR_MAX_M = 2
/** Below this height the near plane stays at NEAR_GROUND_M. */
export const NEAR_FREE_HEIGHT_M = 20
/** Near-plane metres per metre of height above NEAR_FREE_HEIGHT_M. */
export const NEAR_PER_M = 0.015
/** Near changes in these steps, so the projection is not rebuilt every frame while flying. */
export const NEAR_STEP_M = 0.05

/** The near plane for a camera at height `y` (metres). */
export function nearForHeight(y: number): number {
  if (!Number.isFinite(y)) return NEAR_GROUND_M
  const raw = (y - NEAR_FREE_HEIGHT_M) * NEAR_PER_M
  const stepped = Math.round(raw / NEAR_STEP_M) * NEAR_STEP_M
  return Math.min(NEAR_MAX_M, Math.max(NEAR_GROUND_M, +stepped.toFixed(2)))
}

/** The far plane: the setting, or the flop saver's cap when that is lower. */
export function farFor(viewDistance: number, cap: number | null): number {
  return cap === null ? viewDistance : Math.min(viewDistance, cap)
}
