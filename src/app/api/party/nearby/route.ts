// GET /api/party/nearby: the Oasis parties on this computer's networks (World menu asks every few seconds while
// it is open). The asking is UDP, which only this page server can do (src/lib/party/discovery.ts).
import { NextResponse } from 'next/server'

import { findParties } from '@/lib/party/discovery'
import { oasisVersion } from '@/lib/party/host'
import { isHostedOasis } from '@/lib/oasis-profile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const headers = { 'cache-control': 'no-store' }
  // The hosted Oasis is on nobody's Wi-Fi, and a party page does not look for other parties.
  if (isHostedOasis() || process.env.OASIS_LAN === '1') return NextResponse.json({ parties: [], version: oasisVersion() }, { headers })
  const parties = await findParties(700)
  return NextResponse.json({ parties, version: oasisVersion() }, { headers })
}
