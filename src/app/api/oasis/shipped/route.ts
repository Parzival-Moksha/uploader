// GET  /api/oasis/shipped          what this browser sees: the "only what ships" switch and the left-out list
// POST /api/oasis/shipped {on}     turn the switch on or off for the whole Oasis (this machine's own page only)
// See src/lib/only-what-ships-server.ts. The hosted Oasis has no switch.

import { NextResponse, type NextRequest } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { ONLY_WHAT_SHIPS_COOKIE, shippedView, switchApplies, writeSwitch } from '@/lib/only-what-ships-server'
import { isHostedOasis } from '@/lib/oasis-profile'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest) {
  if (isHostedOasis()) return NextResponse.json({ error: 'not here' }, { status: 404 })
  const view = await shippedView(request.cookies.get(ONLY_WHAT_SHIPS_COOKIE)?.value)
  return NextResponse.json(view, { headers: NO_STORE })
}

export async function POST(request: NextRequest) {
  if (isHostedOasis()) return NextResponse.json({ error: 'not here' }, { status: 404 })
  const denied = guardAgentRoute(request)
  if (denied) return denied
  if (!switchApplies()) return NextResponse.json({ error: 'this Oasis ships everything it has: nothing to switch' }, { status: 409 })
  const body = await request.json().catch(() => null) as { on?: unknown } | null
  if (typeof body?.on !== 'boolean') return NextResponse.json({ error: 'send {"on": true} or {"on": false}' }, { status: 400 })
  writeSwitch(body.on)
  const view = await shippedView(request.cookies.get(ONLY_WHAT_SHIPS_COOKIE)?.value)
  return NextResponse.json(view, { headers: NO_STORE })
}
