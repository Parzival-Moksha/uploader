'use client'

// ░▒▓ VOICE TYPING SETUP — what types for you now, and the local helper one click away ▓▒░
// Under Settings > Sound > Voice typing. The order is the mic's own (lib/voice/dictation-route.ts): ElevenLabs with
// its key, the local helper when installed, else the browser's own speech recognition. Without the helper, a button
// installs it (engine ears.js startEarsInstall): no variable in a file.

import { useCallback, useEffect, useState } from 'react'
import { KitButton } from '@/components/ui-kit'
import { getAgentEngineClient } from '@/lib/agent-engine-client'
import { browserRecognizerOwner, isBrowserDictationSupported } from '@/lib/voice/browser-dictation'
import { forgetEarsProbe } from '@/lib/voice/dictation-route'

type Now = 'checking' | 'elevenlabs' | 'helper' | 'browser' | 'none' | 'offline'

const HELPER_WHAT = 'Uses your Python 3. Downloads its packages once (about 50 MB, 160 MB on disk, about a minute), and one English speech model of about 260 MB at its first use. Runs on this computer only: nothing you say leaves it.'

export function VoiceTypingSetup() {
  const [now, setNow] = useState<Now>('checking')
  const [install, setInstall] = useState<{ state: string; text?: string; error?: string } | null>(null)

  const check = useCallback(async () => {
    const client = getAgentEngineClient()
    if (!client.isOpen) { setNow(isBrowserDictationSupported() ? 'browser' : 'offline'); return }
    try {
      const answer = await client.warmEars('elevenlabs')
      if (answer.model?.startsWith('elevenlabs')) setNow('elevenlabs')
      else if (answer.model || answer.ready) setNow('helper')
      else setNow(isBrowserDictationSupported() ? 'browser' : 'none')
    } catch {
      setNow(isBrowserDictationSupported() ? 'browser' : 'none')
    }
  }, [])

  useEffect(() => { void check() }, [check])

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
  const line: Record<Now, string> = {
    checking: 'Checking what types for you…',
    elevenlabs: 'Now: ElevenLabs, with your key.',
    helper: 'Now: the local helper (Moonshine), on this computer.',
    browser: `Now: your browser's own speech recognition (it sends what you say to ${owner === 'the browser maker' ? "the browser's maker" : owner}).`,
    none: 'Now: nothing yet. This browser has no speech recognition of its own: install the local helper below.',
    offline: 'The agent engine is not running.',
  }
  const showInstall = now === 'browser' || now === 'none'

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/25 p-2 text-[10.5px] leading-snug text-white/65" data-voice-typing-now={now}>
      <div>{line[now]}</div>
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
          {(install?.state === 'failed' || install?.state === 'off') && install.error && <div role="alert" className="mt-1 text-amber-200">{install.error}</div>}
        </div>
      )}
    </div>
  )
}
