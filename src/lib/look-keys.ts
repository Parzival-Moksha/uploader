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
