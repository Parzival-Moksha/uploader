'use client'

// ░▒▓ VOICE TYPING SETUP — what the two switches need, and the local helper one click away ▓▒░
// Under Settings > Sound, below the switches (Voice typing, Voice messages: Local or Cloud). Silent while both can do
// what they say. It speaks only when one cannot: Local without the local helper (a button installs it: engine ears.js
// startEarsInstall, no variable in a file), Cloud without an ElevenLabs key, or no agent engine. (The owner, 27 Nov:
// both switches on Local and this box still said "Now: ElevenLabs, with your key": it asked the engine whether it
// had a key, not what the switches use. The mic does follow the switch: /listen?engine=local runs Moonshine.)

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { KitButton } from '@/components/ui-kit'
import { getAgentEngineClient } from '@/lib/agent-engine-client'
import { browserRecognizerOwner, isBrowserDictationSupported } from '@/lib/voice/browser-dictation'
import { forgetEarsProbe } from '@/lib/voice/dictation-route'
import { VoiceSetupLine } from '@/components/village/VoiceSetupLine'
import { DEFAULT_VOICE_TYPING_ENGINE, getVoiceTypingEngine, subscribeVoiceTypingEngine } from '@/lib/voice/voice-typing-engine'
import { DEFAULT_VOICE_MESSAGE_ENGINE, getVoiceMessageEngine, subscribeVoiceMessageEngine } from '@/lib/voice/voice-message-engine'

/** What this PC has: an ElevenLabs key in the engine, the local helper installed. null: not known yet. */
interface Ears { offline: boolean; key: boolean | null; helper: boolean | null }

const HELPER_WHAT = 'Uses your Python 3. Downloads its packages once (about 50 MB, 160 MB on disk, about a minute), and one English speech model of about 260 MB at its first use. Runs on this computer only: nothing you say leaves it.'

export function VoiceTypingSetup() {
  const typing = useSyncExternalStore(subscribeVoiceTypingEngine, getVoiceTypingEngine, () => DEFAULT_VOICE_TYPING_ENGINE)
  const messages = useSyncExternalStore(subscribeVoiceMessageEngine, getVoiceMessageEngine, () => DEFAULT_VOICE_MESSAGE_ENGINE)
  const needsHelper = typing === 'local' || messages === 'local'
  const [ears, setEars] = useState<Ears>({ offline: false, key: null, helper: null })
  const [install, setInstall] = useState<{ state: string; text?: string; error?: string } | null>(null)

  const check = useCallback(async () => {
    const client = getAgentEngineClient()
    if (!client.isOpen) { setEars({ offline: true, key: null, helper: null }); return }
    try {
      // 'elevenlabs' answers with its model when the engine has the key (and warms nothing then).
      const cloud = await client.warmEars('elevenlabs')
      const key = Boolean(cloud.model?.startsWith('elevenlabs'))
      // 'local' names its model when the helper is installed (and starts loading it: a Local switch uses it soon).
      const local = key ? await client.warmEars('local') : cloud
      setEars({ offline: false, key, helper: Boolean(local.model || local.ready) })
    } catch {
      setEars({ offline: false, key: null, helper: null })
    }
  }, [])

  useEffect(() => { void check() }, [check, typing, messages])

  // While it installs: ask how far it is every two seconds.
  useEffect(() => {
    if (install?.state !== 'installing') return
    const timer = window.setInterval(() => {
      getAgentEngineClient().installEars()
        .then(next => {
          setInstall(next)
          if (next.state === 'ready') { forgetEarsProbe(); void check() }
        })
        .catch(() => {})
    }, 2000)
    return () => window.clearInterval(timer)
  }, [install?.state, check])

  const start = () => {
    setInstall({ state: 'installing', text: 'Starting…' })
    getAgentEngineClient().installEars()
      .then(next => {
        setInstall(next)
        if (next.state === 'ready') { forgetEarsProbe(); void check() }
      })
      .catch(error => setInstall({ state: 'failed', error: error instanceof Error ? error.message : String(error) }))
  }

  const owner = browserRecognizerOwner()
  const browserOwner = owner === 'the browser maker' ? "the browser's maker" : owner
  // Only what a switch cannot do as it says: nothing at all while both work.
  const lines: string[] = []
  if (ears.offline) lines.push('The agent engine is not running: neither switch works until it is.')
  else {
    const noHelper = ears.helper === false
    if (typing === 'local' && noHelper) {
      lines.push(isBrowserDictationSupported()
        ? `Voice typing is set to Local, but the local helper is not installed: until it is, your browser's own recognition types (it sends what you say to ${browserOwner}).`
        : 'Voice typing is set to Local, but the local helper is not installed yet.')
    }
    if (messages === 'local' && noHelper) lines.push('Voice messages are set to Local, but the local helper is not installed yet.')
    if (ears.key === false && typing === 'elevenlabs') lines.push(noHelper ? "No ElevenLabs key on this PC: voice typing uses your browser's own recognition." : 'No ElevenLabs key on this PC: voice typing uses Moonshine instead.')
    if (ears.key === false && messages === 'elevenlabs') lines.push('No ElevenLabs key on this PC: set Voice messages to Local.')
  }
  const showInstall = !ears.offline && ears.helper === false && (needsHelper || ears.key === false)

  return (
    <div className={lines.length || showInstall ? 'mt-2 rounded-lg border border-white/10 bg-black/25 p-2 text-[10.5px] leading-snug text-white/65' : 'mt-1 text-[10.5px] leading-snug text-white/65'} data-voice-setup-lines={lines.length}>
      {lines.map(line => <div key={line}>{line}</div>)}
      <VoiceSetupLine className="mt-1" />
      {showInstall && (
        <div className="mt-1.5">
          <KitButton
            variant="primary"
            disabled={install?.state === 'installing'}
            onClick={start}
            title={HELPER_WHAT}
          >
            {install?.state === 'installing' ? 'Installing the local helper…' : install?.state === 'failed' ? 'Try the install again' : 'Install the local helper'}
          </KitButton>
          <div className="mt-1 text-white/45">{HELPER_WHAT}</div>
          {install?.state === 'installing' && install.text && <div className="mt-1 text-white/60">{install.text}</div>}
          {(install?.state === 'failed' || install?.state === 'off' || install?.state === 'unsupported') && install.error && <div role="alert" className="mt-1 text-amber-200">{install.error}</div>}
        </div>
      )}
    </div>
  )
}
