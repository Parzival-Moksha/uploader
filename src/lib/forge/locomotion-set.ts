import { freeUalClips } from './ual-catalog'

// Which clips walk, run and sprint use: the free Quaternius loops (CC0, may be shipped; the default since
// 2026-11-20, so what the owner sees is what a stranger gets) or the Mixamo ones (stay on this PC). Picked in
// Settings > Experiments; the player's avatar reloads its clips on a change.

export type LocomotionSet = 'mixamo' | 'quaternius'
// v2: everyone starts on the free set once, whatever was picked while comparing on 2026-11-19.
const KEY = 'oasis-locomotion-set-v2'
export const DEFAULT_LOCOMOTION_SET: LocomotionSet = 'quaternius'

/** Controller state → clip name in the free UAL1 pack. */
const QUATERNIUS: Record<string, string> = { walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop' }

export function getLocomotionSet(): LocomotionSet {
  if (typeof window === 'undefined') return DEFAULT_LOCOMOTION_SET
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === 'quaternius' || stored === 'mixamo' ? stored : DEFAULT_LOCOMOTION_SET
  } catch { return DEFAULT_LOCOMOTION_SET }
}

export function setLocomotionSet(set: LocomotionSet): void {
  try { window.localStorage.setItem(KEY, set) } catch { /* private mode */ }
}

// ░▒▓ One clip per gait, picked in the avatar selector ▓▒░
// The owner, 25 Nov: the walk "reminds me of the year 2000... do we have different walking animations?... compare the
// different walking and running animations and choose from them", each synced with the footsteps (they are: the
// steps' contacts and stride are read from whatever clip plays, stride-speed.ts). A pick beats the set above.

export type GaitState = 'walk' | 'run' | 'sprint'
export interface GaitChoice { id: string; label: string; mixamo?: boolean }

export const GAIT_CHOICES: Record<GaitState, GaitChoice[]> = {
  walk: [
    { id: 'ual-walk', label: 'Walk' },
    { id: 'ual-walk-formal', label: 'Formal walk' },
    { id: 'ual-walk-carry', label: 'Carry walk' },
    { id: 'ual-zombie-walk', label: 'Zombie walk' },
    { id: 'walk', label: 'Walk', mixamo: true },
    { id: 'drunk-walk', label: 'Drunk walk', mixamo: true },
  ],
  run: [
    { id: 'ual-jog', label: 'Jog' },
    { id: 'run', label: 'Run', mixamo: true },
  ],
  sprint: [
    { id: 'ual-sprint', label: 'Sprint' },
    { id: 'sprint', label: 'Sprint', mixamo: true },
  ],
}

const GAIT_KEY = 'oasis-gait-clips'
export const GAIT_CHANGED_EVENT = 'oasis:locomotion-set-changed'

function readGaitPicks(): Partial<Record<GaitState, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GAIT_KEY) || '{}') as Partial<Record<GaitState, string>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

/** The clip picked for a gait (its library id), or null when none was picked. */
export function getGaitPick(state: GaitState): string | null {
  const id = readGaitPicks()[state]
  return id && GAIT_CHOICES[state].some(choice => choice.id === id) ? id : null
}

/** Pick a gait's clip; the player's avatar loads it at once (PlayerAvatar listens for GAIT_CHANGED_EVENT). */
export function setGaitPick(state: GaitState, id: string): void {
  try { window.localStorage.setItem(GAIT_KEY, JSON.stringify({ ...readGaitPicks(), [state]: id })) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GAIT_CHANGED_EVENT))
}

/** The clip a gait plays now: the pick, else the set's. */
export function currentGaitClip(state: GaitState): string {
  return getGaitPick(state) ?? locomotionClipId(state)
}

/** The library id to load for a controller state. */
export function locomotionClipId(animId: string): string {
  if (animId === 'walk' || animId === 'run' || animId === 'sprint') {
    const pick = getGaitPick(animId)
    if (pick) return pick
  }
  if (getLocomotionSet() !== 'quaternius' || !QUATERNIUS[animId]) return animId
  return freeUalClips().find(clip => clip.clip === QUATERNIUS[animId] && clip.file.includes('UAL1'))?.id ?? animId
}

// ░▒▓ How fast plain WASD goes ▓▒░
// The owner, 2026-11-20: "when I just walk, it's not walking, it's actually already running", and the walk clip
// "as our default walk", its steps matched to the real speed. The free walk covers about 0.8 m/s, so a walk that
// still looks like one tops out near 1.5 m/s; the old 3 m/s can only be a jog. 'walk' is the default; 'jog' keeps
// the old speed. Shift is 4x either way, Space a quarter.

export type DefaultPace = 'walk' | 'jog'
const PACE_KEY = 'oasis-default-pace'
export const PACE_SPEED: Record<DefaultPace, number> = { walk: 1.4, jog: 3.0 }
export const PACE_CHANGED_EVENT = 'oasis:default-pace-changed'
let paceCache: DefaultPace | null = null

export function getDefaultPace(): DefaultPace {
  if (paceCache) return paceCache
  if (typeof window === 'undefined') return 'walk'
  try { paceCache = window.localStorage.getItem(PACE_KEY) === 'jog' ? 'jog' : 'walk' } catch { paceCache = 'walk' }
  return paceCache
}

export function setDefaultPace(pace: DefaultPace): void {
  paceCache = pace
  try { window.localStorage.setItem(PACE_KEY, pace) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(PACE_CHANGED_EVENT))
}

/** The player's plain WASD speed, metres a second. */
export function playerBaseSpeed(): number {
  return PACE_SPEED[getDefaultPace()]
}
