// ░▒▓ SOUND MOMENTS — the shipped sounds for things that are not a spell cast ▓▒░
// Each moment is a key in public/audio/spells-cc0/manifest.json's picks (see spell-sounds.ts for the list).
// A moment without a pick stays silent (or keeps the sound it had before), so a pick can be added later
// without touching code.

import { useAudioManager } from '@/lib/audio-manager'
import { spellSoundFor } from '@/lib/spell-sounds'

/** Plays the pick for `keys` (first that has one) at `volume` x its level. False when nothing is picked. */
export function playSoundMoment(keys: string | string[], volume = 1, chosenId?: string | null): boolean {
  const sound = spellSoundFor(keys, chosenId)
  if (!sound) return false
  useAudioManager.getState().playUrl(sound.url, volume * sound.volume)
  return true
}

// ── the brush: a start, a loop while drawing, an end ──
let brushLoop: HTMLAudioElement | null = null

export function brushStrokeStarted(): void {
  playSoundMoment('brush-start')
  stopBrushLoop()
  const sound = spellSoundFor('brush-loop')
  const audio = useAudioManager.getState()
  if (!sound || audio.muted || audio.volume <= 0 || typeof Audio === 'undefined') return
  const loop = new Audio(sound.url)
  loop.loop = true
  loop.volume = Math.max(0, Math.min(1, audio.volume * sound.volume * 0.7))
  brushLoop = loop
  void loop.play().catch(() => { if (brushLoop === loop) brushLoop = null })
}

export function brushStrokeEnded(): void {
  stopBrushLoop()
  playSoundMoment('brush-end')
}

function stopBrushLoop(): void {
  if (!brushLoop) return
  brushLoop.pause()
  brushLoop.removeAttribute('src')
  brushLoop = null
}
