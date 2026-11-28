// ░▒▓ VOICE MODE — the agents' spoken lines: Off, On click, or Auto (pure, tested) ▓▒░
// The owner, 27 Nov (relayed by Anorak), on ElevenLabs credits ("maybe that could be the difference between us making
// it or not") and a Play button that showed while voices were muted: three states, one switch.
//   off    nothing is made or bought; no Play buttons.
//   click  nothing plays by itself; Play makes that one line and plays it. The default.
//   auto   as before: an agent's unheard line plays when he opens it (and is made a moment ahead as he walks up).
// Kept in this browser under the old key: 'off' stays Off, 'on' (chosen by hand before) is Auto, nothing is On click.

export type VoiceMode = 'off' | 'click' | 'auto'

export const DEFAULT_VOICE_MODE: VoiceMode = 'click'

export function voiceModeFrom(saved: unknown): VoiceMode {
  if (saved === 'off') return 'off'
  if (saved === 'auto' || saved === 'on') return 'auto'
  if (saved === 'click') return 'click'
  return DEFAULT_VOICE_MODE
}

/** Lines play by themselves (opening an agent, an agent that came to him). */
export const speaksByItself = (mode: VoiceMode): boolean => mode === 'auto'

/** A line may be made and played at all (a Play press, a Council). */
export const mayMakeLines = (mode: VoiceMode): boolean => mode !== 'off'

export const VOICE_MODE_TEXT: Record<VoiceMode, { label: string; hint: string }> = {
  off: { label: 'Off', hint: 'No spoken lines: nothing is made or bought, and no Play buttons. The replies still come as text.' },
  click: { label: 'On click', hint: 'Nothing plays by itself. Each reply has a Play button; pressing it makes that one line (a few cents at most) and plays it. A line already made replays for free.' },
  auto: { label: 'Auto', hint: 'An agent says its newest line when you open it (E or F), and it is made a moment ahead as you walk up. Costs the most.' },
}
