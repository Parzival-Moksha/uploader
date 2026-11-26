// /api/village/voices — this machine's own extra voices (data/voices.local.json, git-ignored: a cloned voice is its
// owner's and never ships). GET -> { local: [{ key, id, name, sound }] }. The page adds them to an agent's Voice menu.
// Local requests only.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { readLocalVoices } from '@/lib/village/local-voices-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json({ local: readLocalVoices() })
}
