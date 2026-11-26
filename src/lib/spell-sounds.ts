// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPELL SOUND MANIFEST LOOKUP
// Resolves a `spellSounds[spellId]` entry (a sound id like
// "mixkit-fairy-glitter") to the actual file URL by reading the manifest
// at /audio/spells/manifest.json once, then caching the id→file map.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import shippedManifest from '../../public/audio/spells-cc0/manifest.json'

interface ManifestEntry {
  id: string
  file: string
  label?: string
  vibe?: string
}

interface SpellSoundsManifest {
  library?: ManifestEntry[]
}

const MANIFEST_URL = '/audio/spells/manifest.json'
const FALLBACK_SOUND_FILES: Record<string, string> = {
  'mixkit-choir-magic-shine': '/audio/spells/mixkit-choir-magic-shine-658.ogg',
  'mixkit-explosion-hit': '/audio/spells/mixkit-explosion-hit-1704.ogg',
  'mixkit-fairy-glitter': '/audio/spells/mixkit-fairy-glitter-867.ogg',
  'mixkit-fairy-sparkle-whoosh': '/audio/spells/mixkit-fairy-sparkle-whoosh-869.ogg',
  'mixkit-icicles-spell-whoosh': '/audio/spells/mixkit-icicles-spell-whoosh-881.ogg',
  'mixkit-magic-sparkle-whoosh': '/audio/spells/mixkit-magic-sparkle-whoosh-2350.ogg',
  'mixkit-spellcaster-fairy-swoosh': '/audio/spells/mixkit-spellcaster-fairy-swoosh-1463.ogg',
}

// ─═̷─ The shipped set (public/audio/spells-cc0/: every sound may be shipped, each with its own licence line) ─═̷─
// Mixkit's licence forbids passing its files on, so a packaged Oasis has no /audio/spells/ at all.
// public/audio/spells-cc0/manifest.json is the one list (Hipster picks by ear; this code only reads it):
// every sound with its licence and level (and, for some, the Mixkit sound it stands in for), and the
// picks: spell or moment -> sound. One set everywhere (the owner, 24 Nov: "I wanna feel and use the same
// Oasis that people are using"): a pick plays in every Oasis, his own included; only what has no pick
// falls back to the sound chosen in Settings, then to the stand-in.
//
// Moments the code plays (keys in picks): a spell id (its cast; the spellbook's sound), 'bolt-cast' (the
// cast of any bolt without its own pick), 'impact-fire' / 'impact-lightning' / 'impact-ice' then 'impact'
// (a bolt landing), 'conjure' (an agent conjuring, about 4.8 s), 'portal' (a form portal opening),
// 'summon' (an agent summoned), 'sky-change' and 'ground-change' (with their 3 s changes), 'ui-confirm'
// (a menu click), 'brush-start' / 'brush-loop' (looped while drawing) / 'brush-end'.

interface ShippedEntry { id: string; file: string; replaces?: string; volume?: number; licence?: string; source?: string; variants?: string[] }
const SHIPPED = shippedManifest as { library: ShippedEntry[]; picks?: Record<string, string> }

export const SHIPPED_SPELL_SOUNDS: Record<string, string> = Object.fromEntries(SHIPPED.library.map(e => [e.id, e.file]))
/** Which shipped sound stands in for each Mixkit one. */
export const SHIPPED_STAND_IN: Record<string, string> = Object.fromEntries(
  SHIPPED.library.filter(e => e.replaces).map(e => [e.replaces as string, e.id]),
)
/** Spell id (or 'impact', 'conjure', 'portal') -> shipped sound id. */
export const SHIPPED_PICKS: Record<string, string> = SHIPPED.picks ?? {}
const SHIPPED_VOLUME = new Map(SHIPPED.library.map(e => [e.file, typeof e.volume === 'number' ? Math.max(0, Math.min(1.5, e.volume)) : 1]))
/** A sound with 'variants' plays one of its takes at random each time (hits that repeat do not grate). */
const SHIPPED_TAKES = new Map(SHIPPED.library.filter(e => e.variants?.length).map(e => [e.file, [e.file, ...(e.variants as string[])]]))

/** The shipped sound for an id: its own file if it is a CC0 id, else the stand-in for a Mixkit id. */
export function shippedSpellSoundUrl(soundId: string): string | null {
  return SHIPPED_SPELL_SOUNDS[soundId] ?? SHIPPED_SPELL_SOUNDS[SHIPPED_STAND_IN[soundId] ?? ''] ?? null
}

/** The shipped pick for a spell or a moment ('impact', 'conjure', 'portal'), if the list names one. */
export function shippedPickUrl(key: string): string | null {
  const id = SHIPPED_PICKS[key]
  return id ? SHIPPED_SPELL_SOUNDS[id] ?? null : null
}

/** A packaged Oasis (the cut): no Mixkit folder to ask for. */
const PACKAGED = process.env.NEXT_PUBLIC_OASIS_EDITION === 'slim'

let cache: Map<string, string> | null = null
let loadPromise: Promise<Map<string, string>> | null = null

function fetchManifest(): Promise<Map<string, string>> {
  if (typeof window === 'undefined') return Promise.resolve(new Map())
  // Use the absolute origin so the URL never gets misinterpreted as a
  // relative path on routes that aren't at /. We do NOT prefix with
  // NEXT_PUBLIC_BASE_PATH because next.config.mjs pins that to '' for the
  // hosted oasis (root-served), and reading the env var in the client
  // bundle has been a source of "Failed to fetch" reports.
  const url = new URL(MANIFEST_URL, window.location.origin).toString()
  return fetch(url, { cache: 'force-cache' })
    .then(res => res.ok ? res.json() as Promise<SpellSoundsManifest> : Promise.reject(new Error(`HTTP ${res.status} (${url})`)))
    .then(data => {
      const map = new Map<string, string>()
      for (const entry of data.library ?? []) {
        if (entry?.id && entry?.file) map.set(entry.id, entry.file)
      }
      cache = map
      return map
    })
    .catch(err => {
      console.warn('[spell-sounds] manifest load failed:', err)
      // Reset promise so a later call can retry the fetch (e.g. after the
      // user opens the Sound tab once the dev server is fully up).
      loadPromise = null
      cache = new Map()
      return cache
    })
}

/** Kicks off manifest fetch on first call; idempotent. */
export function preloadSpellSoundManifest(): Promise<Map<string, string>> {
  if (!cache && PACKAGED) cache = new Map()
  if (cache) return Promise.resolve(cache)
  if (loadPromise) return loadPromise
  loadPromise = fetchManifest()
  return loadPromise
}

/**
 * Returns the file URL for a given spell sound id, or null if the manifest
 * hasn't loaded yet or the id isn't in it. Triggers a background load on
 * first call so subsequent casts can resolve synchronously.
 */
export function resolveSpellSoundUrl(soundId: string | undefined | null): string | null {
  if (!soundId) return null
  const shipped = shippedSpellSoundUrl(soundId)
  if (!cache) {
    void preloadSpellSoundManifest()
    // Before the owner's manifest has answered: his Mixkit file if this Oasis has them, else the shipped one.
    return PACKAGED ? shipped : FALLBACK_SOUND_FILES[soundId] ?? shipped
  }
  // The owner's manifest first; what it lacks plays the shipped stand-in (in a packaged Oasis: always).
  // In the owner's Oasis a manifest that failed to load still falls back to his Mixkit file first.
  return cache.get(soundId) ?? (PACKAGED ? shipped : FALLBACK_SOUND_FILES[soundId] ?? shipped)
}

/**
 * What a spell or a moment sounds like here, with its level. `keys` are tried in order (e.g.
 * ['impact-fire', 'impact']): the first with a pick wins, in every Oasis. Without a pick: the sound chosen
 * for it (Settings, or the default Mixkit id) if this Oasis has it, else that sound's shipped stand-in.
 */
export function spellSoundFor(keys: string | string[], chosenId?: string | null): { url: string; volume: number } | null {
  const picked = shippedSoundFor(keys, null)
  if (picked) return picked
  if (chosenId) {
    if (SHIPPED_SPELL_SOUNDS[chosenId]) return withLevel(SHIPPED_SPELL_SOUNDS[chosenId])
    const own = ownSoundUrl(chosenId)
    if (own) return { url: own, volume: 1 }
  }
  return shippedSoundFor([], chosenId)
}

/** The shipped answer alone (what a packaged Oasis plays): the first pick among `keys`, else the chosen sound's stand-in. */
export function shippedSoundFor(keys: string | string[], chosenId?: string | null): { url: string; volume: number } | null {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const url = shippedPickUrl(key)
    if (url) return withLevel(url)
  }
  const url = chosenId ? shippedSpellSoundUrl(chosenId) : null
  return url ? withLevel(url) : null
}

function withLevel(url: string): { url: string; volume: number } {
  const takes = SHIPPED_TAKES.get(url)
  return { url: takes ? takes[Math.floor(Math.random() * takes.length)] : url, volume: SHIPPED_VOLUME.get(url) ?? 1 }
}

/** The owner's own file for an id (his manifest, or before it answers his Mixkit fallback); never in a packaged Oasis. */
function ownSoundUrl(soundId: string): string | null {
  if (PACKAGED) return null
  if (!cache) {
    void preloadSpellSoundManifest()
    return FALLBACK_SOUND_FILES[soundId] ?? null
  }
  return cache.get(soundId) ?? (cache.size === 0 ? FALLBACK_SOUND_FILES[soundId] ?? null : null)
}
