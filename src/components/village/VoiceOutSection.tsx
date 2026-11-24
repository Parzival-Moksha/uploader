'use client'

// ░▒▓ VOICE OUT — Settings > Sound: which ElevenLabs model speaks, and the month's ElevenLabs credits ▓▒░
// The owner (2026-11-23): "the Oasis sound settings definitely will need voice out", with the fuel shown where he
// sets the burn; (2026-11-24) "make selector v4 and v4 turbo... and set turbo default". v4 (eleven_v4), v4 Turbo
// (eleven_v4_turbo: half the credits, measured on his account: 24 credits for 100 characters against 48), or Off
// (the agent voices' mute). Flash went: no cheaper than Turbo. No free voice on this PC: Windows here has only its
// robotic English voices (David, Mark, Zira), not worth hearing.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { KitProgress, KitTabs } from '@/components/ui-kit'
import { isVillageVoiceOn, setVillageVoiceOn, subscribeVillageVoice } from './village-companion'
import { getVoiceOutQuality, setVoiceOutQuality, subscribeVoiceOutQuality } from './voice-out-setting'
import { DEFAULT_VOICE_OUT } from '../../lib/village/voice-out'

type Choice = 'v4' | 'turbo' | 'off'

interface Credits { used: number; limit: number; resetAt: number | null }

const HINT: Record<Choice, string> = {
  v4: 'ElevenLabs v4: the richest delivery, twice the credits of Turbo, about 2 s to make a line.',
  turbo: 'ElevenLabs v4 Turbo: the same voices (each agent keeps its own), half the credits of v4, about a second per line. Hungarian too.',
  off: 'No spoken lines at all: nothing is made or bought. The replies still come as text.',
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The month's fuel: used of the limit, when it refills, and when it runs out at this month's pace. */
function useCredits(): { credits: Credits | null; error: string } {
  const [credits, setCredits] = useState<Credits | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const read = () => {
      fetch('/api/village/voice-credits', { cache: 'no-store' })
        .then(async response => {
          const data = await response.json().catch(() => ({})) as Partial<Credits> & { error?: string }
          if (!live) return
          if (!response.ok || typeof data.used !== 'number') { setError(data.error || `HTTP ${response.status}`); return }
          setCredits({ used: data.used, limit: data.limit || 0, resetAt: data.resetAt ?? null })
          setError('')
        })
        .catch(problem => { if (live) setError(problem instanceof Error ? problem.message : String(problem)) })
    }
    read()
    const timer = window.setInterval(read, 60_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [])
  return { credits, error }
}

function emptyAround(credits: Credits, now = Date.now()): number | null {
  if (!credits.resetAt || !credits.limit || credits.used <= 0) return null
  const start = new Date(credits.resetAt)
  start.setMonth(start.getMonth() - 1)
  const elapsed = now - start.getTime()
  if (elapsed <= 0) return null
  const perMs = credits.used / elapsed
  const at = now + (credits.limit - credits.used) / perMs
  return at < credits.resetAt ? at : null
}

export function VoiceOutSection() {
  const on = useSyncExternalStore(subscribeVillageVoice, isVillageVoiceOn, () => true)
  const quality = useSyncExternalStore(subscribeVoiceOutQuality, getVoiceOutQuality, () => DEFAULT_VOICE_OUT)
  const choice: Choice = on ? quality : 'off'
  const { credits, error } = useCredits()
  const choose = (next: Choice) => {
    if (next === 'off') { setVillageVoiceOn(false); return }
    setVoiceOutQuality(next)
    if (!on) setVillageVoiceOn(true)
  }
  const empty = credits ? emptyAround(credits) : null
  return (
    <section data-voice-out={choice}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Voice out</div>
      <KitTabs<Choice>
        tabs={[
          { id: 'v4', label: 'ElevenLabs v4', title: HINT.v4 },
          { id: 'turbo', label: 'v4 Turbo · ½', title: HINT.turbo },
          { id: 'off', label: 'Off', title: HINT.off },
        ]}
        active={choice}
        onChange={choose}
      />
      <div className="kit-hint mt-1">{HINT[choice]} {'The agents’ own voices (Harry, Brian…) are in each agent’s Settings.'}</div>
      <div className="mt-2" data-voice-credits>
        {credits ? (
          <>
            <KitProgress
              label="ElevenLabs this month"
              value={credits.used}
              max={Math.max(1, credits.limit)}
              format={(value, max) => `${Math.round(value).toLocaleString()} of ${Math.round(max).toLocaleString()} credits`}
            />
            <div className="kit-hint mt-1">
              {credits.resetAt ? `Refills ${day(credits.resetAt)}.` : ''}
              {empty ? ` At this month's pace it runs out around ${day(empty)}.` : credits.resetAt ? ' At this pace it lasts until then.' : ''}
              {' '}Speech, voice typing, memos and music all draw on it.
            </div>
          </>
        ) : (
          <div className="kit-hint">{error ? `Credits unknown: ${error}.` : 'Reading the credits…'}</div>
        )}
      </div>
    </section>
  )
}
