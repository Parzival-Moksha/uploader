// POST /api/debug/camera-blackbox — the page's camera black box (src/lib/camera-blackbox.ts) after a spin:
// the last frames go to data/camera-blackbox/<time>.json on this PC, for the Debugger to read. Local only.

import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const runtime = 'nodejs'

const DIR = path.join(process.cwd(), 'data', 'camera-blackbox')
const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 20

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const text = await request.text()
  if (text.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'too big' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(text) } catch { return NextResponse.json({ ok: false, error: 'not JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { frames?: unknown }).frames)) {
    return NextResponse.json({ ok: false, error: 'frames missing' }, { status: 400 })
  }
  fs.mkdirSync(DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(DIR, `${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), ...(body as object) }))
  // Only the newest KEEP files stay.
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(DIR, old), { force: true })
  return NextResponse.json({ ok: true, file: path.relative(process.cwd(), file) })
}
