// ░▒▓ VOICE OUT — how the agents' spoken lines are made: ElevenLabs best, ElevenLabs fast (half the credits), or off ▓▒░
// The owner (2026-11-23): "it's burning a bunch of ElevenLabs tokens, and we're running low... could you downgrade
// the voices in the Oasis to something cheaper, like fast mode?... the same voices that we already have... just lower
// quality." The same voice ids work on ElevenLabs' fast model, so every agent keeps its voice (Harry, Brian, Merlin…).
// Pure: the choice and the model it means. The page keeps the choice (voice-out-setting.ts); the speech server
// (village-speech-server.ts) makes the clip with this model.

export type VoiceOutQuality = 'best' | 'fast'

/** Fast by default from 2026-11-23 (the credits ran low): half the credits per character. */
export const DEFAULT_VOICE_OUT: VoiceOutQuality = 'fast'

/** ElevenLabs' fast model: the same voices, 32 languages (Hungarian among them), half the credits per character. */
export const FAST_MODEL = 'eleven_flash_v2_5'

export function isVoiceOutQuality(value: unknown): value is VoiceOutQuality {
  return value === 'best' || value === 'fast'
}

/** Credits per character of a model, as ElevenLabs counts them on a subscription (their documentation, 2026-11-23). */
export function creditsPerCharacter(model: string): number {
  return /flash|turbo/.test(model) ? 0.5 : 1
}
