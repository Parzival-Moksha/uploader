'use client'

// ░▒▓ VOICE SETUP LINE — one plain line while voice typing's local helper sets itself up ▓▒░
// A packaged Oasis sets its local helper up by itself on its first start (engine ears.js autoInstallEars): its Python
// packages, then the English speech model. Meanwhile the mic types with the browser's own recognition
// (lib/voice/dictation-route.ts) and switches to the helper by itself once it is ready. This line says what is going
// on, under the agent's text box and in Settings > Sound. Nothing shows when nothing is being set up, or on an engine
// that does not know the command (the owner's own, until its next start).

import { useEffect, useState } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EarsSetupState } from '../../lib/agent-engine-types'
import { isBrowserDictationSupported } from '../../lib/voice/browser-dictation'
import { forgetEarsProbe } from '../../lib/voice/dictation-route'

const POLL_MS = 3000

/** The setup's state while it runs; null when there is nothing to say. One poll shared by every line on the page. */
let shared: EarsSetupState | null = null
let timer: number | null = null
let unknown = false
const listeners = new Set<(state: EarsSetupState | null) => void>()

function poll(): void {
  const client = getAgentEngineClient()
  if (unknown || !client.isOpen) { stop(); return }
  client.earsSetup()
    .then(state => {
      const was = shared?.state
      shared = state
      if (was === 'installing' && state.state === 'ready') forgetEarsProbe() // the next press uses the helper
      listeners.forEach(listener => listener(shared))
      if (state.state !== 'installing') stop()
    })
    .catch(() => { unknown = true; stop() })
}

function stop(): void {
  if (timer !== null) window.clearInterval(timer)
  timer = null
}

function watch(listener: (state: EarsSetupState | null) => void): () => void {
  listeners.add(listener)
  if (timer === null && !unknown) {
    poll()
    timer = window.setInterval(poll, POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) stop()
  }
}

export function voiceSetupText(state: EarsSetupState, now = Date.now(), browser = true): string {
  const minutes = Math.max(0, Math.floor((now - (state.startedAt || now)) / 60_000))
  const so = minutes < 1 ? 'under a minute so far' : `${minutes} min so far`
  const what = state.step === 'model' ? 'the speech model (about 260 MB)' : 'its packages (about 50 MB)'
  // A download's own percentage is worth showing; the helper's generic "Setting up…" lines are not.
  const pct = /(\d+)%/.exec(state.text || '')?.[1]
  const meanwhile = browser ? "Until then your browser's own recognition types." : 'Until then the mic waits for it.'
  return `Setting up voice typing on this computer, ${so} (usually 1 to 5): now ${what}${pct ? `, ${pct}%` : ''}. ${meanwhile}`
}

export function VoiceSetupLine({ className = '' }: { className?: string }) {
  const [state, setState] = useState<EarsSetupState | null>(shared)
  const [, tick] = useState(0)
  useEffect(() => watch(setState), [])
  // The minutes move on between polls too.
  useEffect(() => {
    if (state?.state !== 'installing') return
    const t = window.setInterval(() => tick(n => n + 1), 20_000)
    return () => window.clearInterval(t)
  }, [state?.state])
  if (!state || state.state !== 'installing') return null
  return (
    <div data-voice-setup-line className={`text-[10.5px] leading-snug opacity-70 ${className}`}>
      {voiceSetupText(state, Date.now(), isBrowserDictationSupported())}
    </div>
  )
}
