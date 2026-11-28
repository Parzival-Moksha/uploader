// /api/media/list — Scan public/images/ for uploaded media files

import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'
import { mediaUploadsOn, readShippedMedia } from '@/lib/media-library'

type MediaType = 'image' | 'video' | 'audio'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aac', '.m4a'])

interface MediaItem {
  name: string
  url: string
  type: MediaType
  size: number
  createdAt: string
}

function inferMediaType(fileName: string): MediaType | null {
  if (fileName.startsWith('img-')) return 'image'
  if (fileName.startsWith('vid-')) return 'video'
  if (fileName.startsWith('aud-')) return 'audio'

  const ext = path.extname(fileName).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  return null
}

// Answered per request: the list reads the disk and the environment (OASIS_MEDIA_MANIFEST, OASIS_MEDIA_UPLOADS). Without
// this, the build renders it once with the build's environment (the deployed Oasis then listed no media, 28 Nov).
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const mediaDir = path.join(process.cwd(), 'public', 'images')
    let files: string[]

    try {
      files = await readdir(mediaDir)
    } catch {
      files = []
    }

    const items: MediaItem[] = []

    for (const file of files) {
      const type = inferMediaType(file)
      if (!type) continue

      try {
        const fileStat = await stat(path.join(mediaDir, file))
        items.push({
          name: file,
          url: `/images/${file}`,
          type,
          size: fileStat.size,
          createdAt: fileStat.birthtime.toISOString(),
        })
      } catch {
        // Skip unreadable entries.
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Then what this Oasis ships with (public/media-library, src/lib/media-library.ts), after your own; and whether
    // this Oasis takes uploads at all (the deployed one does not).
    return NextResponse.json({ items: [...items, ...readShippedMedia()], uploads: mediaUploadsOn() })
  } catch (err) {
    console.error('[Media:List] Error:', err)
    return NextResponse.json({ items: readShippedMedia(), uploads: mediaUploadsOn() })
  }
}
