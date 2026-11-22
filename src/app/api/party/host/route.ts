// GET /api/party/host: is a party running from this Oasis, can it host.
// POST /api/party/host { action: 'start', hostName, paidSpells? } | { action: 'stop' }
// It starts processes on this machine, so it answers only this machine's own Oasis page (like the agent routes).
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { partyHostState, startParty, stopParty } from '@/lib/party/host'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const headers = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json(partyHostState(), { headers })
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => ({})) as { action?: string; hostName?: unknown; paidSpells?: unknown }
  if (body.action === 'start') return NextResponse.json(startParty({ hostName: body.hostName, paidSpells: body.paidSpells === true }), { headers })
  if (body.action === 'stop') return NextResponse.json(stopParty(), { headers })
  return NextResponse.json({ error: 'action must be start or stop' }, { status: 400, headers })
}
