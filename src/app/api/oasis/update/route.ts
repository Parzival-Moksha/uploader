// The Upgrade button (the owner, 27 Nov: "new version available. Hit this flashy, big, satisfying button to build it...
// as soon as it has built... flashing on my main screen... when I hit it, that's when it all reloads").
// Contract: 7c_oasis docs/missions/oasis-upgrade-button.md. Local only (guardAgentRoute: loopback, never cross-site,
// 404 on the hosted Oasis). This file answers kind 'village' (his own git checkout, built copies served by
// scripts/oasis-world.mjs); the 'package' branch is Hustler's.
//   GET  -> { kind, running: {label, commit, at, dist} | null, newer: {label, count} | null, head, busy, phase, step,
//             startedAt, ready: {commit, at, dist} | null, error }
//            phase: idle | building | proving | ready | swapping | failed ("ready" only once the copy passed its check)
//   POST { action: 'build' }  -> 202: build beside the running copy and prove it, in the background
//   POST { action: 'switch' } -> 202: swap to the ready copy (about 2 s; the old copy comes back if the new one fails)
// The work is scripts/oasis-village-build.mjs (status, start, swap-start), run as its own process: a switch restarts
// this page server, so nothing of it may live inside it.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { guardAgentRoute } from '@/lib/local-request-guard'
import { villageView, type VillageStatus } from '@/lib/oasis-village-update'

export const dynamic = 'force-dynamic'

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, 'scripts', 'oasis-village-build.mjs')

function script(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: ROOT, timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: String(stdout), err: String(stderr) })
    })
  })
}

function isVillage(): boolean {
  // The proof of a new copy runs it from a copy of the folder without .git (OASIS_VILLAGE_UPDATE=1): it must answer there too.
  return process.env.OASIS_UPDATE_KIND !== 'package' && fs.existsSync(SCRIPT) && (fs.existsSync(path.join(ROOT, '.git')) || process.env.OASIS_VILLAGE_UPDATE === '1')
}

async function current() {
  const r = await script(['status'])
  if (r.code !== 0) throw new Error(r.err.trim() || 'the build script did not answer')
  return villageView(JSON.parse(r.out) as VillageStatus)
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  if (!isVillage()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await current(), { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ kind: 'village', error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  if (!isVillage()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { action?: string }
  const action = body.action === 'switch' ? 'swap-start' : body.action === 'build' ? 'start' : null
  if (!action) return NextResponse.json({ error: "action is 'build' or 'switch'" }, { status: 400 })
  const r = await script([action])
  if (r.code !== 0) return NextResponse.json({ error: r.err.replace(/^\[village-build\]\s*/, '').trim() || 'it did not start' }, { status: 409 })
  // A switch restarts this server a moment later: answer now.
  return NextResponse.json(await current().catch(() => ({ kind: 'village', phase: action === 'swap-start' ? 'swapping' : 'building' })), { status: 202 })
}
