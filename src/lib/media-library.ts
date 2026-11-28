// ░▒▓ MEDIA THAT COMES WITH THE OASIS ▓▒░
// The Media spells (MP3, MP4, JPEG) show your own uploads and the media the Oasis ships with (the owner, 27 Nov).
// Shipped media lives in public/media-library/, listed by a manifest there:
//   { "items": [ { "file": "audio/nightingale.mp3", "type": "audio", "title": "Nightingale at dusk",
//                  "credit": "who made it", "licence": "CC0" } ] }
// `file` is relative to public/media-library/. OASIS_MEDIA_MANIFEST names another manifest in that folder (the
// deployed Oasis: its own set, e.g. deployed.json), so each Oasis shows its own defaults. Shipped items cannot be
// deleted from the page. OASIS_MEDIA_UPLOADS=off hides uploading (the deployed Oasis: visitors upload nothing).

import fs from 'node:fs'
import path from 'node:path'

export type MediaType = 'image' | 'video' | 'audio'
type EnvLike = { [key: string]: string | undefined }

export interface ShippedMediaItem {
  name: string
  url: string
  type: MediaType
  size: number
  createdAt: string
  shipped: true
  credit?: string
  licence?: string
}

export const MEDIA_LIBRARY_DIR = 'media-library'

const TYPES = new Set<MediaType>(['image', 'video', 'audio'])

/** A manifest file name inside public/media-library (no folders, no escapes), else manifest.json. */
export function mediaManifestName(env: EnvLike = process.env): string {
  const name = (env.OASIS_MEDIA_MANIFEST || '').trim()
  return /^[\w.-]+\.json$/.test(name) && !name.startsWith('.') ? name : 'manifest.json'
}

export function mediaUploadsOn(env: EnvLike = process.env): boolean {
  return (env.OASIS_MEDIA_UPLOADS || '').trim().toLowerCase() !== 'off'
}

/** A manifest's `file`: a relative path of plain segments, never leaving the folder. */
export function safeLibraryFile(file: unknown): string | null {
  if (typeof file !== 'string') return null
  const clean = file.replace(/\\/g, '/').trim()
  if (!clean || clean.startsWith('/') || clean.includes('\0')) return null
  const parts = clean.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) return null
  return parts.join('/')
}

/** The shipped media listed by this Oasis's manifest, each checked to exist on disk. */
export function readShippedMedia(publicDir = path.join(process.cwd(), 'public'), env: EnvLike = process.env): ShippedMediaItem[] {
  const dir = path.join(publicDir, MEDIA_LIBRARY_DIR)
  let manifest: { items?: unknown }
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, mediaManifestName(env)), 'utf8'))
  } catch {
    return []
  }
  const out: ShippedMediaItem[] = []
  for (const raw of Array.isArray(manifest.items) ? manifest.items : []) {
    const entry = raw as Record<string, unknown>
    const file = safeLibraryFile(entry?.file)
    const type = entry?.type as MediaType
    if (!file || !TYPES.has(type)) continue
    let size = 0
    try { size = fs.statSync(path.join(dir, file)).size } catch { continue }
    out.push({
      name: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim().slice(0, 80) : path.basename(file),
      url: `/${MEDIA_LIBRARY_DIR}/${file.split('/').map(encodeURIComponent).join('/')}`,
      type,
      size,
      createdAt: '',
      shipped: true,
      ...(typeof entry.credit === 'string' ? { credit: entry.credit.slice(0, 120) } : {}),
      ...(typeof entry.licence === 'string' ? { licence: entry.licence.slice(0, 40) } : {}),
    })
  }
  return out
}
