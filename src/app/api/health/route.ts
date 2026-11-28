// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/health — Lightweight liveness check for crash detection
// Used by dev:agent blue-green builder to know when server is truly alive
// vs zombie (process running, port bound, cache corrupted, returning 500)
// buildId changes on every server restart — used by Phoenix Protocol to
// detect when dev-agent has swapped in a fresh build after merge.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

// Read on every request: Next 14 prerenders a GET that reads no request at build time (the Innkeeper, 28 Nov: its BUILD_ID froze per build, not per restart).
export const dynamic = 'force-dynamic'

// Set once per server lifetime — changes on every restart
const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export async function GET() {
  // version: a packaged Oasis's release (baked in by its start script); the updater asks for it to know that the
  // new version, not any server on the port, is the one answering.
  return NextResponse.json({ status: 'ok', timestamp: Date.now(), buildId: BUILD_ID, version: process.env.NEXT_PUBLIC_OASIS_VERSION || null })
}
