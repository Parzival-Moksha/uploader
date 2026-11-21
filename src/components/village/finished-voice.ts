// ░▒▓ FINISHED VOICE — "Speak finished reports only when I'm near" (Settings > Agents, on by default) ▓▒░
// The owner (2026-11-21): most agents come to him to say "it's done, man"; he wants to hear the ones that need him.
// An agent that just finished (no decision, no mission, no error) says its spoken line only when he opened it near
// it (its T / E / F prompt showed) or had it selected (a click on it). One that needs him is heard wherever he opens
// it. Kept in this browser.

const KEY = 'oasis.village.finishedNearOnly'
let on: boolean | null = null
const listeners = new Set<() => void>()

export function isFinishedNearOnly(): boolean {
  if (on === null) {
    try {
      on = window.localStorage.getItem(KEY) !== 'off'
    } catch {
      on = true
    }
  }
  return on
}

export function setFinishedNearOnly(next: boolean): void {
  on = next
  try {
    window.localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach(listener => listener())
}

export function subscribeFinishedNearOnly(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Should a finished agent's line play now? `needsYou`: it needs the owner (always heard). */
export function mayVoiceFinished({ needsYou, near, selected, nearOnly }: { needsYou: boolean; near: boolean; selected: boolean; nearOnly: boolean }): boolean {
  return needsYou || !nearOnly || near || selected
}
