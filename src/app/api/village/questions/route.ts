// /api/village/questions — Mindcraft's Carbon tab: what the Oasis needs from the owner, one file each.
// The folder: OASIS_QUESTIONS_DIR, else `questions` next to the missions folder (C:\7c_oasis\docs\questions).
//   GET   every mission, open first, highest priority first (the page sorts again as he likes)
//   POST  { file, answer, state?: 'answered' | 'parked', took?, expected }  his answer, written into the file's
//         header (state, answered or parked, answer, took). `expected` is the text he was looking at: a file that
//         changed underneath is not overwritten (409). Then Anorakdev gets a message with the file and the answer.
// Local requests only; automated pages may read but never answer.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { engine, questionsDir, rewriteBoard, send, tellAgent } from '@/lib/village/carbon-server'
import { answerCarbonMission, askingAgent, formatAnswerForAsker, formatAnswerNote, resolveAsker, formatUnclearNote, isCarbonFile, markUnclear, parseCarbonMission, sortCarbon } from '@/lib/village/carbon-missions'
import { isAutomationRequest } from '@/lib/village/work-vow'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function questionPath(file: unknown): string | null {
  if (typeof file !== 'string' || !isCarbonFile(file) || file !== path.basename(file) || /[\\/:*?"<>|]/.test(file)) return null
  return path.join(questionsDir(), file)
}

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

function localDate(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const dir = questionsDir()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter(isCarbonFile)
  } catch {
    return NextResponse.json({ dir, missions: [], error: 'questions folder not found' })
  }
  const missions = (await Promise.all(names.map(async name => {
    try {
      return parseCarbonMission(name, await fs.readFile(path.join(dir, name), 'utf8'))
    } catch {
      return null
    }
  }))).filter((m): m is NonNullable<typeof m> => m !== null)
  return NextResponse.json({ dir, missions: sortCarbon(missions) })
}

/**
 * His answer goes straight to the agent that asked ("act on it"), and to Anorak, who keeps the books (Anorak's
 * call, 2026-11-22). A mission Anorak or a helper asked, or one whose asker has left the village: Anorak only.
 */
async function tellAnswer(mission: ReturnType<typeof parseCarbonMission>, answer: string, state: 'answered' | 'parked', took: number | null): Promise<string> {
  const e = await engine()
  if (e.error) return e.error
  const asker = resolveAsker(mission.by, e.agents)
  const anorak = askingAgent('Anorak', e.agents)
  let toldAsker = ''
  if (asker.agent && !asker.isAnorak && (await send(e, asker.agent, formatAnswerForAsker(mission, answer, state)))) toldAsker = asker.agent.name
  const toldAnorak = anorak ? await send(e, anorak, formatAnswerNote(mission, answer, state, took, toldAsker || undefined)) : false
  return [toldAsker && `sent to ${toldAsker}`, toldAnorak && anorak && `sent to ${anorak.name}`].filter(Boolean).join(', ') || 'nobody in the village to tell'
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { file?: unknown; answer?: unknown; state?: unknown; took?: unknown; expected?: unknown; unclear?: unknown } | null
  if (isAutomationRequest(request.headers.get('user-agent'), body)) return NextResponse.json({ error: 'automated pages cannot answer missions' }, { status: 403 })
  const file = questionPath(body?.file)
  // "Not enough to decide": mark the file (it sinks until its body changes) and tell whoever asked.
  if (body?.unclear === true) {
    if (!file || typeof body.expected !== 'string') return NextResponse.json({ error: 'file and expected are required' }, { status: 400 })
    let text: string
    try {
      text = normalize(await fs.readFile(file, 'utf8'))
    } catch {
      return NextResponse.json({ error: 'mission not found' }, { status: 404 })
    }
    if (text !== normalize(body.expected)) return NextResponse.json({ error: 'the mission changed while you had it open: look at it again' }, { status: 409 })
    const next = markUnclear(text, localDate())
    await fs.writeFile(file, next, 'utf8')
    const mission = parseCarbonMission(path.basename(file), next)
    const [told, board] = await Promise.all([tellAgent(mission.by, formatUnclearNote(mission)), rewriteBoard()])
    return NextResponse.json({ ok: true, mission, told, board })
  }
  if (!file || typeof body?.answer !== 'string' || !body.answer.trim() || typeof body.expected !== 'string') {
    return NextResponse.json({ error: 'file, answer and expected are required' }, { status: 400 })
  }
  if (body.answer.length > 10_000) return NextResponse.json({ error: 'too long' }, { status: 413 })
  const state = body.state === 'parked' ? 'parked' : 'answered'
  const took = typeof body.took === 'number' && Number.isFinite(body.took) ? Math.max(0, Math.round(body.took)) : null
  let current: string
  try {
    current = normalize(await fs.readFile(file, 'utf8'))
  } catch {
    return NextResponse.json({ error: 'mission not found' }, { status: 404 })
  }
  if (current !== normalize(body.expected)) return NextResponse.json({ error: 'the mission changed while you had it open: look at it again' }, { status: 409 })
  const next = answerCarbonMission(current, { answer: body.answer, state, took, date: localDate() })
  await fs.writeFile(file, next, 'utf8')
  const mission = parseCarbonMission(path.basename(file), next)
  const [told, board] = await Promise.all([tellAnswer(mission, body.answer, state, took), rewriteBoard()])
  return NextResponse.json({ ok: true, mission, told, board })
}
