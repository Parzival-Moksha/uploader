// ░▒▓ RELOAD RESUME — after a reload he stands where he was ▓▒░
// The owner (24 Nov): "when oasis reloads (i guess hot reloading while i work) im spawned at 0,0 and all fresh. id
// love it if i could at least stand where i was before. if the same agent panel was open as the one at the time of
// reload would be even better."
// Kept in this tab's sessionStorage (a reload keeps it, another tab or a new window does not), written every second
// and when the page goes away; read once when the world is in. A state older than RESUME_MAX_AGE_MS or from another
// world is ignored. What is kept: where the player stands and faces, the camera (around the player when walking, the
// camera itself when flying), walking / flying / orbit, whether mouse-look was on, and the agent view that was open
// (E: the panel, F: its full screen). Which page of the panel and where its thread was are Companion's
// (components/village/thread-anchor.ts). Pure: components/forge/ReloadResume.tsx feeds it what the page sees.

import type { InputState } from './input-manager'

export const RESUME_KEY = 'oasis.resume.v1'
export const RESUME_MAX_AGE_MS = 3 * 60 * 60 * 1000
/** Mouse-look lost this recently still counts as on (a reload takes the lock away just before the page goes). */
export const RESUME_LOOK_GRACE_MS = 1500
/**
 * A reload is also the way out of a bad spot (fell through the ground, flew far off): a kept place below this height
 * or further out than this from the world's middle is not put back; he starts at the world's spawn (Merge Goat, 25 Nov).
 */
export const RESUME_FLOOR_Y = -20
export const RESUME_REACH_M = 500

export type ResumeMode = 'third-person' | 'noclip' | 'orbit'
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface ResumeState {
  v: 1
  at: number
  worldId: string
  mode: ResumeMode
  /** Mouse-look was on (or was on when the open panel opened). */
  look: boolean
  player: { position: Vec3; yaw: number } | null
  /** The walking camera around the player. */
  orbit: { azimuth: number; elevation: number; zoom: number } | null
  /** The flying camera. */
  camera: { position: Vec3; quaternion: Quat } | null
  panel: { agentId: string; view: 'panel' | 'screen' } | null
}

/** What the page sees right now. */
export interface ResumeSnapshot {
  at: number
  worldId: string | null
  worldReady: boolean
  inputState: InputState
  previousCameraState: InputState | null
  locked: boolean
  lockLostAt: number
  lookBeforeFocus: boolean
  player: { position: Vec3; yaw: number } | null
  orbit: { azimuth: number; elevation: number; zoom: number } | null
  camera: { position: Vec3; quaternion: Quat } | null
  view: { kind: 'none' } | { kind: 'panel' | 'screen'; agentId: string }
}

const MODES: readonly ResumeMode[] = ['third-person', 'noclip', 'orbit']
const isMode = (value: unknown): value is ResumeMode => MODES.includes(value as ResumeMode)

/** Walking, flying or orbit: the camera states you stand in (everything else sits on top of one of them). */
function baseOf(state: InputState, previous: InputState | null): ResumeMode | null {
  if (isMode(state)) return state
  return isMode(previous) ? previous : null
}

/** States where the look is live (not a panel or a menu that froze it). */
function lookIsLive(state: InputState): boolean {
  return state === 'third-person' || state === 'noclip' || state === 'placement' || state === 'paint' || state === 'orbit'
}

/**
 * The state to keep after this snapshot. Null while no world is in (nothing to keep yet); the previous state is
 * carried where the snapshot cannot see it (a flying camera while a panel holds the camera at the agent).
 */
export function captureResume(prev: ResumeState | null, s: ResumeSnapshot): ResumeState | null {
  if (!s.worldReady || !s.worldId) return prev
  const same = prev && prev.worldId === s.worldId ? prev : null
  const mode = baseOf(s.inputState, s.previousCameraState) ?? same?.mode ?? 'third-person'
  const cameraLive = s.inputState === 'noclip' || ((s.inputState === 'placement' || s.inputState === 'paint') && s.previousCameraState === 'noclip')
  const look = lookIsLive(s.inputState)
    ? s.locked || (Boolean(same?.look) && s.at - s.lockLostAt < RESUME_LOOK_GRACE_MS)
    : s.lookBeforeFocus
  return {
    v: 1,
    at: s.at,
    worldId: s.worldId,
    mode,
    look,
    player: validPlayer(s.player) ?? same?.player ?? null,
    orbit: validOrbit(s.orbit) ?? same?.orbit ?? null,
    camera: cameraLive ? validCamera(s.camera) ?? same?.camera ?? null : same?.camera ?? null,
    panel: s.view.kind === 'none' || !s.view.agentId ? null : { agentId: s.view.agentId, view: s.view.kind },
  }
}

/** The kept state if it belongs here: this world, not older than RESUME_MAX_AGE_MS, and well formed. */
export function readResume(raw: string | null | undefined, now: number, worldId: string | null): ResumeState | null {
  if (!raw || !worldId) return null
  let data: unknown
  try { data = JSON.parse(raw) } catch { return null }
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.v !== 1 || typeof d.at !== 'number' || !Number.isFinite(d.at)) return null
  if (now - d.at > RESUME_MAX_AGE_MS || d.at - now > 60_000) return null
  if (d.worldId !== worldId || !isMode(d.mode)) return null
  const panel = d.panel as Record<string, unknown> | null | undefined
  return {
    v: 1,
    at: d.at,
    worldId,
    mode: d.mode,
    look: d.look === true,
    player: saneOrNull(validPlayer(d.player)),
    orbit: validOrbit(d.orbit),
    camera: saneOrNull(validCamera(d.camera)),
    panel: panel && typeof panel.agentId === 'string' && panel.agentId && (panel.view === 'panel' || panel.view === 'screen')
      ? { agentId: panel.agentId, view: panel.view }
      : null,
  }
}

/** Inside the world: not under the floor, not hundreds of metres out (the walker has no fall: his height is the ground's). */
export function placeIsSane(position: Vec3): boolean {
  return position[1] >= RESUME_FLOOR_Y && Math.abs(position[0]) <= RESUME_REACH_M && Math.abs(position[2]) <= RESUME_REACH_M
}

function saneOrNull<T extends { position: Vec3 }>(value: T | null): T | null {
  return value && placeIsSane(value.position) ? value : null
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const vec = (value: unknown, n: number): boolean => Array.isArray(value) && value.length === n && value.every(finite)

function validPlayer(value: unknown): ResumeState['player'] {
  const p = value as { position?: unknown; yaw?: unknown } | null | undefined
  if (!p || !vec(p.position, 3) || !finite(p.yaw)) return null
  return { position: [...(p.position as Vec3)] as Vec3, yaw: p.yaw }
}

function validOrbit(value: unknown): ResumeState['orbit'] {
  const o = value as { azimuth?: unknown; elevation?: unknown; zoom?: unknown } | null | undefined
  if (!o || !finite(o.azimuth) || !finite(o.elevation) || !finite(o.zoom)) return null
  return { azimuth: o.azimuth, elevation: o.elevation, zoom: o.zoom }
}

function validCamera(value: unknown): ResumeState['camera'] {
  const c = value as { position?: unknown; quaternion?: unknown } | null | undefined
  if (!c || !vec(c.position, 3) || !vec(c.quaternion, 4)) return null
  const q = c.quaternion as Quat
  if (Math.hypot(q[0], q[1], q[2], q[3]) < 0.5) return null
  return { position: [...(c.position as Vec3)] as Vec3, quaternion: [...q] as Quat }
}
