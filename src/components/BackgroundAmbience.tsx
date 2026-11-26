'use client'

// ░▒▓ BACKGROUND AMBIENCE — wind, birds or an ominous drone under everything (Settings > Sound > Ambience) ▓▒░
// Off by default. Wind and the drone are made live in Web Audio: brown noise through moving filters (gusts that
// build and fall at random), and detuned low tones under a slowly breathing filter with an echo. The birds are a
// CC0 recording played as an endless crossfaded loop (two elements, so nothing is decoded into memory whole).
// Like the music: nothing starts before the first click or key (browsers allow sound only then), a hidden tab or
// a zero level stops it and suspends the audio, so it costs nothing while off. Choices and arithmetic:
// src/lib/ambience.ts.

import { useContext, useEffect, useRef, useState } from 'react'
import { SettingsContext } from './scene-lib'
import { ambienceLevel, resolveAmbience, type AmbienceId } from '@/lib/ambience'
import { useOasisStore } from '@/store/oasisStore'
import { makeEngine, makeVoice, type Engine, type Voice } from '@/lib/ambience-voices'

export function BackgroundAmbience() {
  const { settings } = useContext(SettingsContext)
  // "The world's own" follows the world being shown (its saved ambience; none = quiet)
  const worldAmbience = useOasisStore(s => s.worldAmbience)
  const choice = resolveAmbience(settings.ambience, worldAmbience)
  const level = ambienceLevel(choice, settings.ambientVolume, settings.masterVolume)
  const [armed, setArmed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const engineRef = useRef<Engine | null>(null)
  const voiceRef = useRef<{ id: AmbienceId; voice: Voice } | null>(null)

  // The first click or key: from then on the browser allows sound.
  useEffect(() => {
    if (armed) return
    const arm = () => setArmed(true)
    window.addEventListener('pointerdown', arm, true)
    window.addEventListener('keydown', arm, true)
    return () => {
      window.removeEventListener('pointerdown', arm, true)
      window.removeEventListener('keydown', arm, true)
    }
  }, [armed])

  useEffect(() => {
    const read = () => setHidden(document.visibilityState === 'hidden')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])

  const active: AmbienceId = armed && !hidden && level > 0 ? choice : 'off'

  useEffect(() => {
    const engine = engineRef.current
    if (active === 'off') {
      const playing = voiceRef.current
      voiceRef.current = null
      if (!engine) return
      if (playing) playing.voice.stop(engine.ctx.currentTime)
      // once it has faded, the audio stops costing anything
      const t = window.setTimeout(() => { if (!voiceRef.current) void engine.ctx.suspend().catch(() => {}) }, 2500)
      return () => window.clearTimeout(t)
    }
    let e = engine
    if (!e) {
      e = makeEngine()
      if (!e) return
      engineRef.current = e
    }
    const { ctx, out } = e
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const playing = voiceRef.current
    if (!playing || playing.id !== active) {
      if (playing) playing.voice.stop(ctx.currentTime)
      try {
        voiceRef.current = { id: active, voice: makeVoice(active, ctx, out) }
      } catch {
        voiceRef.current = null
      }
    }
    const timer = window.setInterval(() => voiceRef.current?.voice.tick(ctx.currentTime), 250)
    return () => window.clearInterval(timer)
  }, [active])

  useEffect(() => {
    const e = engineRef.current
    if (e && active !== 'off') e.out.gain.setTargetAtTime(level, e.ctx.currentTime, 0.25)
  }, [level, active])

  useEffect(() => () => {
    const e = engineRef.current
    const playing = voiceRef.current
    engineRef.current = null
    voiceRef.current = null
    if (playing && e) playing.voice.stop(e.ctx.currentTime)
    if (e) window.setTimeout(() => { void e.ctx.close().catch(() => {}) }, 2500)
  }, [])

  return null
}
