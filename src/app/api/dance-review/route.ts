// /api/dance-review: the dances waiting for the owner's verdict, and his ratings.
// The clips are the CMU motion-capture selection in public/animations/cmu/ (listed in its review.json); the avatar
// picker shows them in a Review tab and saves a rating (1 to 5, 0 = no) here, into data/dance-review.local.json (ignored by git: his ratings never land in a commit), so Animator
// can import the ones he keeps. Only this machine's own Oasis page may write (never a hosted deploy).

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { guardAgentRoute } from '@/lib/local-request-guard'
import { isHostedOasis } from '@/lib/oasis-profile'

const CLIPS_DIR = path.join(process.cwd(), 'public', 'animations', 'cmu')
const RATINGS_FILE = path.join(process.cwd(), 'data', 'dance-review.local.json')

interface Ratings { ratings: Record<string, { rating: number; at: string }> }

function readRatings(): Ratings {
  try {
    const parsed = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8'))
    return parsed && typeof parsed.ratings === 'object' ? parsed : { ratings: {} }
  } catch {
    return { ratings: {} }
  }
}

export async function GET() {
  if (isHostedOasis()) return NextResponse.json({ clips: [] })
  try {
    const list = JSON.parse(fs.readFileSync(path.join(CLIPS_DIR, 'review.json'), 'utf8')) as { clips: [string, string][] }
    const { ratings } = readRatings()
    const clips = list.clips
      .filter(([file]) => /^[\w-]+$/.test(file) && fs.existsSync(path.join(CLIPS_DIR, `${file}.fbx`)))
      .map(([file, label]) => {
        const id = `cmu-${file}`
        return { id, filename: `cmu/${file}.fbx`, label, rating: ratings[id]?.rating ?? null }
      })
    return NextResponse.json({ clips })
  } catch {
    return NextResponse.json({ clips: [] })
  }
}

export async function POST(request: Request) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: { id?: unknown; rating?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const id = typeof body.id === 'string' && /^cmu-[\w-]+$/.test(body.id) ? body.id : null
  const rating = typeof body.rating === 'number' && Number.isInteger(body.rating) && body.rating >= 0 && body.rating <= 5 ? body.rating : null
  if (!id || rating === null) return NextResponse.json({ error: 'id (cmu-…) and rating (0 to 5) needed' }, { status: 400 })
  const data = readRatings()
  data.ratings[id] = { rating, at: new Date().toISOString() }
  await fs.promises.mkdir(path.dirname(RATINGS_FILE), { recursive: true })
  await fs.promises.writeFile(RATINGS_FILE, `${JSON.stringify(data, null, 2)}\n`)
  return NextResponse.json({ ok: true, id, rating })
}
