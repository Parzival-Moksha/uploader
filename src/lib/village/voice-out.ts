// ░▒▓ VOICE OUT — which ElevenLabs model the agents' spoken lines are made with: v4 or v4 Turbo (or off) ▓▒░
// The owner (2026-11-24, after hearing the two): "lets do v4 turbo... make selector v4 and v4 turbo in settings
// sounds/audio for which elevenlabs model to use and set turbo default." Every agent keeps its own voice (the same
// voice ids work on both). Measured on his account, the same 100-character line in Harry's voice: eleven_v4 48
// credits, eleven_v4_turbo 24 (eleven_flash_v2_5, the choice of 23 Nov, also 24: no cheaper, so it is gone).
// Pure: the choice and the model it means. The page keeps the choice (voice-out-setting.ts); the speech server
// (village-speech-server.ts) makes the clip with this model.

export type VoiceOutQuality = 'v4' | 'turbo'

/** v4 Turbo by default (the owner, 2026-11-24): half the credits of v4. */
export const DEFAULT_VOICE_OUT: VoiceOutQuality = 'turbo'

export const VOICE_OUT_MODEL: Record<VoiceOutQuality, string> = {
  v4: 'eleven_v4',
  turbo: 'eleven_v4_turbo',
}

export function isVoiceOutQuality(value: unknown): value is VoiceOutQuality {
  return value === 'v4' || value === 'turbo'
}

/** A choice as saved: the two of today as they are; anything older ('best', 'fast' of 23 Nov) is Turbo. */
export function voiceOutFrom(value: unknown): VoiceOutQuality {
  return isVoiceOutQuality(value) ? value : DEFAULT_VOICE_OUT
}

/** Credits per character of a model on his account (measured 2026-11-23/24 from ElevenLabs' character-cost). */
export function creditsPerCharacter(model: string): number {
  return /turbo|flash/.test(model) ? 0.24 : 0.48
}
