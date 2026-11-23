// ░▒▓ VOICE OUT (page) — Settings > Sound > Voice out: ElevenLabs best or fast, kept in this browser ▓▒░
// Fast (half the credits) by default from 2026-11-23. "Off" is the agent voices' mute (village-companion.ts
// isVillageVoiceOn), so there is one switch for silence, not two. The model each means: lib/village/voice-out.ts.

import { DEFAULT_VOICE_OUT, isVoiceOutQuality, type VoiceOutQuality } from '../../lib/village/voice-out'

const KEY = 'oasis.village.voiceOut'
let quality: VoiceOutQuality | null = null
const listeners = new Set<() => void>()

export function getVoiceOutQuality(): VoiceOutQuality {
  if (quality === null) {
    let saved: unknown = null
    try { saved = window.localStorage.getItem(KEY) } catch { saved = null }
    quality = isVoiceOutQuality(saved) ? saved : DEFAULT_VOICE_OUT
  }
  return quality
}

export function setVoiceOutQuality(next: VoiceOutQuality): void {
  quality = next
  try { window.localStorage.setItem(KEY, next) } catch { /* storage blocked: this page only */ }
  listeners.forEach(listener => listener())
}

export function subscribeVoiceOutQuality(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
