// ░▒▓ LOOK KEYS — the rules for when the mouse steers the camera (pure, tested) ▓▒░
// The owner (24 Nov): Esc from mouse-look frees the mouse first and only the next Esc opens the menu; leaving an
// agent panel gives back the look he had (no cursor, no click needed; asked about five times); a tap of Space turns
// mouse-look on and off, because clicking is for selecting. input-manager.ts applies these.

/** A press shorter than this, with no other key during it, is a tap. Longer is "hold to walk slowly". */
export const SPACE_TAP_MS = 250

/** Just after the lock ended (some paths release it a moment before the panel opens) counts as still looking. */
export const LOOK_GRACE_MS = 700

/** Was the mouse steering the camera when the panel or menu opened? */
export function wasLooking(locked: boolean, lastLockLostAt: number, at: number): boolean {
  return locked || at - lastLockLostAt < LOOK_GRACE_MS
}

/** Give the look back when leaving: only if it was on, the mode we return to can lock, and nothing else is open. */
export function shouldGiveLookBack(lookBefore: boolean, canLockReturnState: boolean, uiLayers: number): boolean {
  return lookBefore && canLockReturnState && uiLayers === 0
}

/** A Space press that was a tap (toggle mouse-look), not a hold (walk slowly) or part of a key chord. */
export function isSpaceTap(heldMs: number, otherKeyDuring: boolean): boolean {
  return !otherKeyDuring && heldMs >= 0 && heldMs < SPACE_TAP_MS
}

/** Where a Space key-up may toggle mouse-look: not in a text field, not on a focused button or link (it clicks it). */
export function spaceTargetIsWorld(tag: string | undefined, editable: boolean): boolean {
  if (editable) return false
  const t = (tag || '').toUpperCase()
  return !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(t)
}

// --- a lone jump of the mouse is not a turn ----------------------------------------------------------------------
// The 120 degree snap the owner saw in the static demo (26 Nov) is not in the Oasis: mouse-look is clamped (96 px an
// event, 160 a frame). What was left: one huge event (Chrome on Windows sometimes reports one; also the first movement
// after a pointer-lock re-grant) still turned the camera 16.5 degrees at once (headless: a 2000 px event, 16.5). Such an
// event, after calm motion, is held one event: the motion carries on (the next event is big too) = a real fast turn,
// both apply; it does not = a glitch, dropped.

/** px: an event this big after calm motion is held (one event). */
export const SPIKE_PX = 150
/** px: the motion before counts as calm under this (a running average), and an event this big carries a held one on. */
export const CALM_PX = 30
/** A held event the next one does not come for within this (ms) is dropped (the mouse stopped right after: a glitch). */
export const SPIKE_HOLD_MS = 50
/**
 * ms: only a big event this soon after the one before is suspect (a jump faster than a hand). Perf, 27 Nov: Chrome hands
 * pointer-locked movement over once per frame, so after a slow frame (a busy PC) the next event carries all the movement
 * since, one big event after a long gap: that is a real turn, and holding it (then dropping it when the next came late)
 * threw real turns away, six flicks of 200 px out of six. After a gap, a big event is merged movement: it turns at once.
 */
export const SPIKE_FAST_GAP_MS = 20

export interface SpikeState { held: { x: number; y: number; at: number } | null; calm: number; lastAt?: number }
export const SPIKE_START: SpikeState = { held: null, calm: 0 }

export interface SpikeResult { apply: Array<{ x: number; y: number }>; dropped: number; state: SpikeState }

function calmAfter(calm: number, magnitude: number): number {
  return calm * 0.5 + magnitude * 0.5
}

/** One mouse-look event through the filter: what to turn by now, what was dropped (px), the state after. */
export function filterLookEvent(state: SpikeState, x: number, y: number, at: number): SpikeResult {
  const m = Math.hypot(x, y)
  let dropped = 0
  let held = state.held
  if (held && at - held.at > SPIKE_HOLD_MS) { dropped += Math.hypot(held.x, held.y); held = null }
  if (held) {
    if (m >= CALM_PX) return { apply: [{ x: held.x, y: held.y }, { x, y }], dropped, state: { held: null, calm: calmAfter(calmAfter(state.calm, Math.hypot(held.x, held.y)), m), lastAt: at } }
    return { apply: [{ x, y }], dropped: dropped + Math.hypot(held.x, held.y), state: { held: null, calm: calmAfter(state.calm, m), lastAt: at } }
  }
  const gap = typeof state.lastAt === 'number' ? at - state.lastAt : Infinity
  if (m >= SPIKE_PX && state.calm < CALM_PX && gap <= SPIKE_FAST_GAP_MS) return { apply: [], dropped, state: { held: { x, y, at }, calm: state.calm, lastAt: at } }
  return { apply: [{ x, y }], dropped, state: { held: null, calm: calmAfter(state.calm, m), lastAt: at } }
}

/** A held event that nothing followed: dropped (called when a frame takes the turn). */
export function settleSpike(state: SpikeState, now: number): { dropped: number; state: SpikeState } {
  if (!state.held || now - state.held.at <= SPIKE_HOLD_MS) return { dropped: 0, state }
  return { dropped: Math.hypot(state.held.x, state.held.y), state: { held: null, calm: state.calm } }
}
