// ░▒▓ POST EFFECTS — the setting is the only thing that decides whether an effect renders ▓▒░
// The owner (24 Nov): "when im in E mode on the agent (and also maybe F mode?) there is chromatic aberration which
// i disabled in the settings but somehow it shows. if i switch away and back to E, its gone."
// The path, reproduced headless: a sprint (Shift) adds a colour fringe and a darker vignette on top of the settings,
// and that boost was added even with the effect switched off. Its strength (sprintRef.intensity) is written only
// while you walk or fly, so pressing E (or N) during a sprint, or within half a second of letting go, froze it:
// 0.31 in E mode, a fringe of 0.0037 with chromatic aberration off, and the post-processing stack kept running.
// Leaving E let it fade, which is why switching away and back cured it. Pure: Scene's PostProcessing and the
// camera controller feed it what they see.

import type { InputState } from './input-manager'

/** The settings' own strengths (what the effect is when it is on and you are not sprinting). */
export const CHROMATIC_BASE = 0.003
export const CHROMATIC_SPRINT_BOOST = 0.012
export const VIGNETTE_BASE = 0.7
export const VIGNETTE_SPRINT_BOOST = 0.4

/**
 * States where Shift does something (walking, flying, or placing / painting on top of them). Anywhere else (an
 * agent panel, its full screen, a menu, typing, the orbit camera) a sprint has no business on the screen.
 */
export function sprintCanRun(inputState: InputState, previousCameraState: InputState | null = null): boolean {
  if (inputState === 'third-person' || inputState === 'noclip') return true
  if (inputState === 'placement' || inputState === 'paint') return previousCameraState === 'third-person' || previousCameraState === 'noclip'
  return false
}

/** The sprint's strength as the effects may use it: 0 where nobody can sprint, never negative, never NaN. */
export function sprintEffect(raw: number, canRun: boolean): number {
  if (!canRun || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(1, raw))
}

/** Colour fringe offset: 0 whenever chromatic aberration is off, whatever the sprint. */
export function chromaticOffset(enabled: boolean, sprint: number, boost = true): number {
  if (!enabled) return 0
  return CHROMATIC_BASE + (boost ? sprintEffect(sprint, true) * CHROMATIC_SPRINT_BOOST : 0)
}

/** Vignette darkness: 0 whenever the vignette is off, whatever the sprint. */
export function vignetteDarkness(enabled: boolean, sprint: number, boost = true): number {
  if (!enabled) return 0
  return VIGNETTE_BASE + (boost ? sprintEffect(sprint, true) * VIGNETTE_SPRINT_BOOST : 0)
}

/** The post-processing stack runs only for an effect that is on (a sprint alone never starts it). */
export function postEffectsNeeded(effects: { bloom: boolean; vignette: boolean; chromatic: boolean }): boolean {
  return effects.bloom || effects.vignette || effects.chromatic
}
