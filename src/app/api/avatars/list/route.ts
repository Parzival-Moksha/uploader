// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/avatars/list — Runtime disk scan of public/avatars/gallery/*.vrm
// ─═̷─═̷─ॐ─═̷─═̷─ Drop a VRM in the folder, the Oasis auto-assimilates ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

import { browserChoiceOf, shippedView, shipsFilter } from '@/lib/only-what-ships-server'

// Read on every request: Next 14 prerendered this list at build time (the Innkeeper, 28 Nov): avatars added later never showed.
export const dynamic = 'force-dynamic'

const GALLERY_DIR = path.join(process.cwd(), 'public', 'avatars', 'gallery')

export interface DiskAvatarEntry {
  id: string
  file: string
  name: string
  sizeBytes: number
}

function fileToId(filename: string): string {
  return filename
    .replace(/\.vrm$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function fileToDisplayName(filename: string): string {
  const base = filename.replace(/\.vrm$/i, '')
  return base
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET(request: Request) {
  try {
    // "Only what ships": an avatar the package leaves out (its licence) is not offered.
    const ships = shipsFilter(await shippedView(browserChoiceOf(request)))
    try { await fs.promises.access(GALLERY_DIR) } catch { return NextResponse.json([]) }
    const dirents = await fs.promises.readdir(GALLERY_DIR, { withFileTypes: true })
    // Reject symlinks — static file serving would follow them and leak adjacent files.
    const entries = await Promise.all(dirents
      .filter(d => d.isFile() && !d.isSymbolicLink() && d.name.toLowerCase().endsWith('.vrm') && ships(`/avatars/gallery/${d.name}`))
      .map(async d => ({
        id: fileToId(d.name),
        file: d.name,
        name: fileToDisplayName(d.name),
        sizeBytes: (await fs.promises.stat(path.join(GALLERY_DIR, d.name))).size,
      })))
    const sortedEntries: DiskAvatarEntry[] = entries
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json(sortedEntries)
  } catch {
    return NextResponse.json([])
  }
}
