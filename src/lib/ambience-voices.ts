// The ambience voices (Web Audio graphs): wind and the drone made live, the birds recording as a crossfaded loop.
// Browser only. The player and its lifecycle: src/components/BackgroundAmbience.tsx; choices and arithmetic: ./ambience.ts.

import { BIRDS_URL, loopingBrownNoise, nextGust, type AmbienceId } from './ambience'

export interface Voice {
  /** Called four times a second while it plays, with the audio clock. */
  tick: (now: number) => void
  /** Fade out from `at` and let go of everything. */
  stop: (at: number) => void
}

export interface Engine {
  ctx: AudioContext
  out: GainNode
}

export function makeEngine(): Engine | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(ctx.destination)
    return { ctx, out }
  } catch {
    return null
  }
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.round(ctx.sampleRate * seconds)
  const fade = Math.round(ctx.sampleRate * 0.5)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) buffer.getChannelData(ch).set(loopingBrownNoise(length, fade, Math.random))
  return buffer
}

function panned(ctx: BaseAudioContext, node: AudioNode, pan: number, to: AudioNode) {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    node.connect(p).connect(to)
  } else {
    node.connect(to)
  }
}

export function windVoice(ctx: BaseAudioContext, out: AudioNode): Voice {
  const voice = ctx.createGain()
  voice.gain.value = 0
  voice.connect(out)
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 9)
  src.loop = true
  // the body of the wind: deep noise under a lowpass that opens with each gust
  const body = ctx.createBiquadFilter()
  body.type = 'lowpass'
  body.frequency.value = 450
  body.Q.value = 0.6
  const bodyGain = ctx.createGain()
  bodyGain.gain.value = 0.5
  // the whistle round edges: a narrow band that rises with the stronger gusts
  const whistle = ctx.createBiquadFilter()
  whistle.type = 'bandpass'
  whistle.frequency.value = 800
  whistle.Q.value = 7
  const whistleGain = ctx.createGain()
  whistleGain.gain.value = 0.04
  src.connect(body).connect(bodyGain).connect(voice)
  src.connect(whistle).connect(whistleGain).connect(voice)
  src.start()
  voice.gain.setTargetAtTime(1.3, ctx.currentTime, 0.8) // evened with the drone and the birds (about -20 LUFS at full level)
  let strength = 0.4
  let nextAt = 0
  return {
    tick(now) {
      if (now < nextAt) return
      const gust = nextGust(Math.random, strength)
      strength = gust.strength
      nextAt = now + gust.seconds
      const tc = gust.seconds / 2.5
      body.frequency.setTargetAtTime(220 + strength * 1000, now, tc)
      // steeper than the strength itself: lulls nearly still, strong gusts about 17 dB above them
      bodyGain.gain.setTargetAtTime(0.12 + Math.pow(strength, 1.6) * 1.1, now, tc)
      whistle.frequency.setTargetAtTime(550 + strength * 1100 + Math.random() * 120, now, tc * 1.5)
      whistleGain.gain.setTargetAtTime(0.015 + strength * strength * 0.09, now, tc)
    },
    stop(at) {
      voice.gain.setTargetAtTime(0, at, 0.3)
      try { src.stop(at + 1.5) } catch { /* already stopped */ }
      window.setTimeout(() => voice.disconnect(), 2000)
    },
  }
}

export function droneVoice(ctx: BaseAudioContext, out: AudioNode): Voice {
  const voice = ctx.createGain()
  voice.gain.value = 0
  voice.connect(out)
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 480
  lowpass.Q.value = 1.5
  const swell = ctx.createGain()
  swell.gain.value = 0.75
  lowpass.connect(swell).connect(voice)
  // a dark echo: a long delay feeding back through a lowpass
  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.43
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 900
  const feedback = ctx.createGain()
  feedback.gain.value = 0.42
  const wet = ctx.createGain()
  wet.gain.value = 0.35
  swell.connect(delay)
  delay.connect(damp).connect(feedback).connect(delay)
  damp.connect(wet).connect(voice)

  const sources: AudioScheduledSourceNode[] = []
  const tone = (freq: number, type: OscillatorType, level: number, pan: number) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = level
    osc.connect(g)
    panned(ctx, g, pan, lowpass)
    sources.push(osc)
    return g
  }
  // Pitched where laptop speakers still carry it (A2, not A1), with a sine floor an octave down for headphones.
  tone(110, 'sawtooth', 0.14, -0.5)     // A2, and a hair above it: a slow beating
  tone(110.37, 'sawtooth', 0.14, 0.5)
  tone(55, 'sine', 0.3, 0)              // the floor
  tone(220.6, 'triangle', 0.06, 0.1)
  tone(155.56, 'triangle', 0.08, -0.25) // the tritone: the unease
  const rub = tone(233.08, 'sine', 0.03, 0.3) // a minor second above the octave, faint, coming and going

  // breath: noise in the low band
  const breath = ctx.createBufferSource()
  breath.buffer = noiseBuffer(ctx, 6)
  breath.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 260
  band.Q.value = 0.9
  const breathGain = ctx.createGain()
  breathGain.gain.value = 0.12
  breath.connect(band).connect(breathGain).connect(lowpass)
  sources.push(breath)

  // slow movement: the filter breathes (35 s), the whole swells (77 s), the rub comes and goes (14 s)
  const lfo = (hz: number, depth: number, target: AudioParam) => {
    const osc = ctx.createOscillator()
    osc.frequency.value = hz
    const g = ctx.createGain()
    g.gain.value = depth
    osc.connect(g).connect(target)
    sources.push(osc)
  }
  lfo(0.029, 220, lowpass.frequency)
  lfo(0.013, 0.22, swell.gain)
  lfo(0.07, 0.03, rub.gain)

  for (const s of sources) s.start()
  voice.gain.setTargetAtTime(0.85, ctx.currentTime, 2) // evened with the wind and the birds
  return {
    tick() { /* moves by itself */ },
    stop(at) {
      voice.gain.setTargetAtTime(0, at, 0.4)
      for (const s of sources) { try { s.stop(at + 2) } catch { /* already stopped */ } }
      window.setTimeout(() => voice.disconnect(), 2500)
    },
  }
}

/** Seconds two copies of the recording overlap at each turn of the loop. */
const BIRDS_FADE = 4

export function birdsVoice(ctx: AudioContext, out: AudioNode): Voice {
  const voice = ctx.createGain()
  voice.gain.value = 1.35 // evened with the wind and the drone
  voice.connect(out)
  const players = [0, 1].map(() => {
    const el = new Audio()
    el.preload = 'auto'
    el.src = BIRDS_URL
    const gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(el).connect(gain).connect(voice)
    return { el, gain }
  })
  // a quiet breeze under the bird, so the pauses between its phrases are outdoors, not silence
  const breezeLevel = ctx.createGain()
  breezeLevel.gain.value = 0.22
  breezeLevel.connect(voice)
  const breeze = windVoice(ctx, breezeLevel)
  let current = 0
  let started = false
  let swapUntil = 0
  const swap = (now: number) => {
    const next = 1 - current
    const incoming = players[next]
    incoming.el.currentTime = 0
    void incoming.el.play().catch(() => {})
    incoming.gain.gain.setTargetAtTime(1, now, BIRDS_FADE / 3)
    players[current].gain.gain.setTargetAtTime(0, now, BIRDS_FADE / 3)
    const outgoing = players[current]
    window.setTimeout(() => { if (players[current] !== outgoing) outgoing.el.pause() }, BIRDS_FADE * 1000 + 500)
    current = next
    swapUntil = now + BIRDS_FADE
  }
  for (const p of players) p.el.addEventListener('ended', () => { if (p === players[current]) swap(ctx.currentTime) })
  return {
    tick(now) {
      breeze.tick(now)
      const p = players[current]
      if (!started) {
        started = true
        void p.el.play().catch(() => {})
        p.gain.gain.setTargetAtTime(1, now, 1.2)
        return
      }
      const d = p.el.duration
      if (now >= swapUntil && Number.isFinite(d) && d > BIRDS_FADE * 3 && p.el.currentTime >= d - BIRDS_FADE) swap(now)
    },
    stop(at) {
      voice.gain.setTargetAtTime(0, at, 0.4)
      breeze.stop(at)
      window.setTimeout(() => {
        for (const p of players) { p.el.pause(); p.el.removeAttribute('src'); p.el.load() }
        voice.disconnect()
      }, 2000)
    },
  }
}

export function makeVoice(id: Exclude<AmbienceId, 'off'>, ctx: AudioContext, out: AudioNode): Voice {
  if (id === 'wind') return windVoice(ctx, out)
  if (id === 'drone') return droneVoice(ctx, out)
  return birdsVoice(ctx, out)
}
