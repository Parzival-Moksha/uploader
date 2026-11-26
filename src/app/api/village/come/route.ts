// /api/village/come — who the owner asked to come to him when done, and who is on the way (lib/village/come-when-done.ts).
//   GET  [?since=<version>]   -> the file ({ unchanged: true, version } when nothing changed since)
//   POST { op, agent, ... }  or  { ops: [{ op, agent, ... }, ...] }
//        ask { on, what? } (his switch or words) · later (the agent: not done yet) · done { turnAt, error? } (a page saw
//        the turn end) · call { why } (the agent comes by itself: scripts/me.mjs come) · clear (heard, or waved off)
//        -> { ok, results, file }
// Local requests only.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { ComeError, applyComeOps, cleanComeOp, readCome } from '@/lib/village/come-when-done-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const file = await readCome()
  const asked = request.nextUrl.searchParams.get('since')
  const since = asked === null || asked === '' ? Number.NaN : Number(asked)
  if (Number.isFinite(since) && since === file.version) return NextResponse.json({ unchanged: true, version: file.version })
  return NextResponse.json(file)
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  try {
    const raw = Array.isArray(body.ops) ? body.ops.slice(0, 20) : [body]
    const { file, results } = await applyComeOps(raw.map(cleanComeOp))
    return NextResponse.json({ ok: true, results, file })
  } catch (error) {
    if (error instanceof ComeError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[Village:Come] Error:', error)
    return NextResponse.json({ error: 'come failed' }, { status: 500 })
  }
}
