// ░▒▓ LOCAL VOICES (server) — this machine's own extra voices, never shipped ▓▒░
// A voice cloned from someone's own voice (the owner's "Parzival", his ElevenLabs clone) is theirs: it lives in
// data/voices.local.json (git-ignored like the other *.local.json; OASIS_VILLAGE_VOICES_FILE overrides), the same
// shape as village-voices.json: [{ "key", "id", "name", "sound" }]. The speech server resolves them, the page lists
// them in an agent's Voice menu (/api/village/voices). They are never dealt at random to an agent, and an agent
// can't pick one for itself (the engine reads only the shipped list): only the owner, by hand. Anyone's Oasis can
// add their own clones the same way.

import fs from 'node:fs'
import path from 'node:path'

import type { VillageVoice } from './village-voices'

type EnvLike = { [key: string]: string | undefined }

export function localVoicesFile(env: EnvLike = process.env): string {
  return env.OASIS_VILLAGE_VOICES_FILE || path.join(process.cwd(), 'data', 'voices.local.json')
}

/** The entries that look like voices (key, an ElevenLabs id), trimmed; anything else is left out. */
export function parseLocalVoices(raw: unknown): VillageVoice[] {
  if (!Array.isArray(raw)) return []
  const out: VillageVoice[] = []
  for (const entry of raw) {
    const v = entry as Partial<VillageVoice> | null
    if (!v || typeof v.key !== 'string' || typeof v.id !== 'string') continue
    const key = v.key.trim().slice(0, 40)
    const id = v.id.trim()
    if (!/^[\w.-]{1,40}$/.test(key) || !/^[A-Za-z0-9]{10,40}$/.test(id)) continue
    out.push({ key, id, name: String(v.name || key).slice(0, 60), sound: String(v.sound || '').slice(0, 200) })
  }
  return out
}

let cache: { file: string; mtimeMs: number; voices: VillageVoice[] } | null = null

/** This machine's extra voices (read again when the file changes; none without the file). */
export function readLocalVoices(env: EnvLike = process.env): VillageVoice[] {
  const file = localVoicesFile(env)
  try {
    const { mtimeMs } = fs.statSync(file)
    if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.voices
    const voices = parseLocalVoices(JSON.parse(fs.readFileSync(file, 'utf8')))
    cache = { file, mtimeMs, voices }
    return voices
  } catch {
    return []
  }
}

export function localVoice(key: string, env: EnvLike = process.env): VillageVoice | null {
  return readLocalVoices(env).find(voice => voice.key === key) || null
}
