// ░▒▓ VOICE MESSAGE ENGINE — who transcribes a recorded voice message: ElevenLabs (default) or Moonshine here ▓▒░
// Settings → Sound, beside the voice-typing switch (the owner, 27 Nov: "voice typing ... local and cloud, and also the
// voice messages, separately ... we don't need the same switch. We need two switches"). Saved per browser. Local is
// the same Moonshine Medium helper voice typing runs, fed the whole recording when it ends (the engine's scribe.js):
// free, nothing leaves this PC. Cloud is ElevenLabs Scribe, which costs credits.

import { parseVoiceTypingEngine, type VoiceTypingEngine } from './voice-typing-engine'

export type VoiceMessageEngine = VoiceTypingEngine

export const DEFAULT_VOICE_MESSAGE_ENGINE: VoiceMessageEngine = 'elevenlabs'
const STORAGE_KEY = 'oasis.voiceMessages.engine.v1'

const listeners = new Set<() => void>()

export function getVoiceMessageEngine(): VoiceMessageEngine {
  if (typeof window === 'undefined') return DEFAULT_VOICE_MESSAGE_ENGINE
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved ? parseVoiceTypingEngine(saved) : DEFAULT_VOICE_MESSAGE_ENGINE
  } catch {
    return DEFAULT_VOICE_MESSAGE_ENGINE
  }
}

export function setVoiceMessageEngine(engine: VoiceMessageEngine): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, engine)
  } catch { /* private mode: this tab only */ }
  listeners.forEach(listener => listener())
}

export function subscribeVoiceMessageEngine(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
