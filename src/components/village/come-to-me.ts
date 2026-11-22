// ░▒▓ COME TO ME — one setting: do agents that truly need the owner walk up to him? Off by default ▓▒░
// The owner (2026-11-22, 13:41): "I'm followed by this huge throng of agents, and more often than not I'm getting
// just a random report. It's context switching and it's really tiring." Nobody walks up to him unless this is on
// (Settings > Agents); then only an agent stopped on a permission or question card, or one that hit an error, comes
// (village attentionRank), and only if its own "Come to me" switch (its settings) is on too. Off: they stay where
// they are and only the marker over their heads shows. "Follow me" (Anorak by default) is separate.

const KEY = 'oasis.village.comeToMe'
let on: boolean | null = null
const listeners = new Set<() => void>()

export function isComeToMeOn(): boolean {
  if (on === null) {
    try {
      on = window.localStorage.getItem(KEY) === 'on'
    } catch {
      on = false
    }
  }
  return on
}

export function setComeToMeOn(next: boolean): void {
  on = next
  try {
    window.localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach(listener => listener())
}

export function subscribeComeToMe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
