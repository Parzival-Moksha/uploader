'use client'

// ░▒▓ BACKGROUND MUSIC — the shipped CC0 tracks (src/lib/music.ts), at Settings > Sound > Music × Master ▓▒░
// Browsers let a page make sound only after the user clicked or pressed a key on it, so nothing loads or plays
// before the first one. At zero on either slider it stops; while the tab is hidden it pauses. The level goes
// through a Web Audio gain rather than the element's volume, which iPhones and iPads ignore (always full).

import { useContext, useEffect, useRef, useState } from 'react'
import { SettingsContext } from './scene-lib'
import { MUSIC_TRACKS, musicLevel, nextTrackIndex } from '@/lib/music'

/** Seconds for the gain to move most of the way to a new level (first start, a slider drag, a stop). */
const FADE_SECONDS = 0.6

interface Chain {
  audio: HTMLAudioElement
  ctx: AudioContext | null
  gain: GainNode | null
}

function makeChain(onEnded: () => void): Chain {
  const audio = new Audio()
  audio.preload = 'auto'
  audio.addEventListener('ended', onEnded)
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctx) {
      ctx = new Ctx()
      gain = ctx.createGain()
      gain.gain.value = 0
      ctx.createMediaElementSource(audio).connect(gain)
      gain.connect(ctx.destination)
    }
  } catch {
    ctx = null
    gain = null
  }
  if (!gain) audio.volume = 0
  return { audio, ctx, gain }
}

function setLevel(chain: Chain, level: number) {
  if (chain.gain && chain.ctx) {
    const g = chain.gain.gain
    g.cancelScheduledValues(chain.ctx.currentTime)
    g.setTargetAtTime(level, chain.ctx.currentTime, FADE_SECONDS / 3)
  } else {
    chain.audio.volume = level
  }
}

export function BackgroundMusic() {
  const { settings } = useContext(SettingsContext)
  // Off unless the Music switch is on (Settings > Sound); a saved setting from before the switch counts as off.
  // No tracks (the package, for now: src/lib/music.ts): nothing to play.
  const level = settings.musicEnabled === true && MUSIC_TRACKS.length > 0 ? musicLevel(settings.musicVolume, settings.masterVolume) : 0
  const [armed, setArmed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const chainRef = useRef<Chain | null>(null)
  const trackRef = useRef(0)

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

  const playing = armed && !hidden && level > 0

  useEffect(() => {
    if (!playing) {
      const chain = chainRef.current
      if (chain && !chain.audio.paused) {
        setLevel(chain, 0)
        chain.audio.pause()
      }
      return
    }
    let chain = chainRef.current
    if (!chain) {
      const next = () => {
        const c = chainRef.current
        if (!c) return
        trackRef.current = nextTrackIndex(trackRef.current)
        c.audio.src = MUSIC_TRACKS[trackRef.current].url
        void c.audio.play().catch(() => { /* a missing file or a blocked play: silence, never an error */ })
      }
      chain = makeChain(next)
      chain.audio.src = MUSIC_TRACKS[trackRef.current].url
      chainRef.current = chain
    }
    if (chain.ctx && chain.ctx.state === 'suspended') void chain.ctx.resume().catch(() => {})
    void chain.audio.play().catch(() => {})
  }, [playing])

  useEffect(() => {
    const chain = chainRef.current
    if (chain && playing) setLevel(chain, level)
  }, [level, playing])

  useEffect(() => () => {
    const chain = chainRef.current
    chainRef.current = null
    if (!chain) return
    chain.audio.pause()
    chain.audio.removeAttribute('src')
    void chain.ctx?.close().catch(() => {})
  }, [])

  return null
}
