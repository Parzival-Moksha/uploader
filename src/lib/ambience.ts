// Ambience: a bed of sound under everything, chosen in Settings > Sound (the owner, 24 Nov: rather than music,
// "ambience to choose from: wind, birds, an ominous drone"). Off by default. The level is the Ambience slider
// (settings.ambientVolume) times Master. Wind and the drone are made live in Web Audio (no files, nothing to
// license); the birds are a CC0 nightingale recording with a quiet live breeze under it (public/audio/ambience/manifest.json). The player is
// src/components/BackgroundAmbience.tsx; this file holds its choices and its arithmetic, kept pure for tests.

export type AmbienceId = 'off' | 'wind' | 'birds' | 'drone'

export interface AmbienceChoice {
  id: AmbienceId
  label: string
  /** One line for Settings under the chooser. */
  hint: string
}

export const AMBIENCES: readonly AmbienceChoice[] = [
  { id: 'off', label: 'Off', hint: 'Off. Choose wind, birds or a drone to hear one under everything.' },
  { id: 'wind', label: 'Wind', hint: 'Wind in gusts, made live (never the same twice).' },
  { id: 'birds', label: 'Birds', hint: 'A nightingale at dusk over a quiet breeze (a CC0 recording from Norfolk, England).' },
  { id: 'drone', label: 'Ominous drone', hint: 'A low, slow, uneasy swell, made live.' },
]

export function ambienceId(value: unknown): AmbienceId {
  return AMBIENCES.some(a => a.id === value) ? (value as AmbienceId) : 'off'
}

export function ambienceHint(value: unknown): string {
  const id = ambienceId(value)
  return AMBIENCES.find(a => a.id === id)!.hint
}

// ── Per world (Anorak's must list for 0.7.0; the owner, 24 Nov: "worlds have their own ambience") ──
// A world keeps its own ambience with its data (WorldState.ambience, saved like its sky). Settings > Sound >
// Ambience chooses "The world's own" or one ambience for everywhere.

export type AmbienceSetting = AmbienceId | 'world'

export const WORLD_CHOICE = {
  id: 'world' as const,
  label: "The world's own",
  hint: "Each world's own ambience (a world without one is quiet). This world's is chosen below.",
}

/** Settings' choices: the world's own first, then the four for everywhere. */
export const AMBIENCE_SETTINGS: readonly { id: AmbienceSetting; label: string; hint: string }[] = [WORLD_CHOICE, ...AMBIENCES]

export function ambienceSetting(value: unknown): AmbienceSetting {
  return value === 'world' ? 'world' : ambienceId(value)
}

export function ambienceSettingHint(value: unknown): string {
  const setting = ambienceSetting(value)
  return setting === 'world' ? WORLD_CHOICE.hint : ambienceHint(setting)
}

/** What plays: the world's own when the setting says so (a world without one: off), else the setting itself. */
export function resolveAmbience(setting: unknown, worldAmbience: unknown): AmbienceId {
  return ambienceSetting(setting) === 'world' ? ambienceId(worldAmbience) : ambienceId(setting)
}

/** The birds recording (CC0). */
export const BIRDS_URL = '/audio/ambience/nightingale-evening.mp3'

/** An ambience sits under the voices: at the default sliders (ambience 0.5, master 0.8) it plays at 0.2. */
export const AMBIENCE_BASE = 0.5

const unit = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

/** The gain the ambience plays at, 0..1; zero when it is off or either slider is at zero. */
export function ambienceLevel(choice: unknown, ambient: number, master: number): number {
  return ambienceId(choice) === 'off' ? 0 : unit(ambient) * unit(master) * AMBIENCE_BASE
}

/** A seeded random source (mulberry32), so the noise and the gusts can be tested. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Brown noise (a leaky random walk: deep, like wind or surf) that loops without a click: `length + fade` samples are
 * made and the last `fade` are blended into the first, so sample length-1 runs on into sample 0. Peak 0.9.
 */
export function loopingBrownNoise(length: number, fade: number, rand: () => number): Float32Array {
  const total = length + fade
  const raw = new Float32Array(total)
  let v = 0
  for (let i = 0; i < total; i++) {
    v = v * 0.995 + (rand() * 2 - 1) * 0.06
    raw[i] = v
  }
  const out = raw.slice(0, length)
  for (let i = 0; i < fade; i++) {
    const t = i / fade
    // equal power: the two stretches are unrelated noise
    out[i] = raw[i] * Math.sin(t * Math.PI / 2) + raw[length + i] * Math.cos(t * Math.PI / 2)
  }
  let mean = 0
  for (let i = 0; i < length; i++) mean += out[i]
  mean /= length
  let peak = 0
  for (let i = 0; i < length; i++) { out[i] -= mean; peak = Math.max(peak, Math.abs(out[i])) }
  if (peak > 0) for (let i = 0; i < length; i++) out[i] *= 0.9 / peak
  return out
}

export interface Gust {
  /** 0..1, how strong this gust is. */
  strength: number
  /** Seconds until the next gust is chosen. */
  seconds: number
}

/** The next gust: mostly moderate, now and then a strong one or a lull. */
export function nextGust(rand: () => number, previous = 0.4): Gust {
  const r = rand()
  const target = r < 0.12 ? 0.85 + rand() * 0.15 : r < 0.25 ? rand() * 0.15 : 0.25 + rand() * 0.45
  // drift toward the target rather than jump: gusts build and fall
  const strength = Math.max(0, Math.min(1, previous + (target - previous) * 0.7))
  return { strength, seconds: 1.5 + rand() * 3 }
}

/** When each copy of a recording starts so that copies overlap by `fade` seconds (an endless crossfaded loop). */
export function loopStarts(duration: number, fade: number, from: number, until: number): number[] {
  const period = Math.max(1, duration - fade)
  const starts: number[] = []
  for (let t = from; t < until; t += period) starts.push(t)
  return starts
}

/** Equal-power fade curves for Web Audio's setValueCurveAtTime. */
export function fadeCurve(points: number, rising: boolean): Float32Array {
  const c = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1)
    c[i] = rising ? Math.sin(t * Math.PI / 2) : Math.cos(t * Math.PI / 2)
  }
  return c
}
