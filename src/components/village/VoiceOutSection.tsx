'use client'

// ░▒▓ VOICE OUT — Settings > Sound: how the agents' spoken lines are made, and the month's ElevenLabs credits ▓▒░
// The owner (2026-11-23): "the Oasis sound settings definitely will need voice out", with the fuel shown where he
// sets the burn. Best (eleven_multilingual_v2), Fast (eleven_flash_v2_5: the same voices at half the credits,
// measured on his account: 24 credits for 100 characters against 48), or Off (the agent voices' mute). No free
// voice on this PC: Windows here has only its robotic English voices (David, Mark, Zira), not worth hearing.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { KitProgress, KitTabs } from '@/components/ui-kit'
import { isVillageVoiceOn, setVillageVoiceOn, subscribeVillageVoice } from './village-companion'
import { getVoiceOutQuality, setVoiceOutQuality, subscribeVoiceOutQuality } from './voice-out-setting'
import { DEFAULT_VOICE_OUT } from '../../lib/village/voice-out'

type Choice = 'best' | 'fast' | 'off'

interface Credits { used: number; limit: number; resetAt: number | null }

const HINT: Record<Choice, string> = {
  best: 'ElevenLabs at its best: the richest voices, twice the credits of Fast.',
  fast: 'ElevenLabs fast: the same voices (each agent keeps its own), a little flatter, half the credits. Hungarian too.',
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
          { id: 'best', label: 'ElevenLabs best', title: HINT.best },
          { id: 'fast', label: 'ElevenLabs fast · ½', title: HINT.fast },
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
