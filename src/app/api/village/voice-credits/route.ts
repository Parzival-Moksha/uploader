// /api/village/voice-credits — the month's ElevenLabs credits, for Settings > Sound > Voice out (the owner, 2026-11-23:
// "so he sees the fuel where he sets the burn").
//   GET  -> { used, limit, resetAt (ms), tier }   read from ElevenLabs (/v1/user/subscription), kept for a minute.
// Local requests only; the key never leaves the page server.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let cached: { at: number; data: { used: number; limit: number; resetAt: number | null; tier: string | null } } | null = null

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return NextResponse.json({ error: 'no ElevenLabs key on this machine' }, { status: 404 })
  if (cached && Date.now() - cached.at < 60_000) return NextResponse.json(cached.data)
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key }, cache: 'no-store' })
    if (!response.ok) return NextResponse.json({ error: `ElevenLabs answered ${response.status}` }, { status: 502 })
    const sub = await response.json() as { character_count?: number; character_limit?: number; next_character_count_reset_unix?: number; tier?: string }
    const data = {
      used: Number(sub.character_count) || 0,
      limit: Number(sub.character_limit) || 0,
      resetAt: typeof sub.next_character_count_reset_unix === 'number' ? sub.next_character_count_reset_unix * 1000 : null,
      tier: typeof sub.tier === 'string' ? sub.tier : null,
    }
    cached = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
  }
}
