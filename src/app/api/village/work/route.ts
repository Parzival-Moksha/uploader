// /api/village/work — the Mindcraft work counter (the owner's vow: three hours a day in the Oasis).
//   GET   ?day=YYYY-MM-DD: that day's `summary` alone (time, XP, kept or not, per agent, per mission, top XP, agent hours).
//   GET   ?mindcraft=1: every day as lists of work units (the owner's, each agent's, the whole Oasis').
//   GET   ?missions=1: per mission, the owner's seconds on it and the agents' (`activity`: the last day agents worked on it, and who).
//   POST  { agentMission: { agent: "Name", mission: "file.md" | null } }  an agent says which mission it works on
//         (its minutes and XP are booked there; null: back to the mission whose `who` names it)
//   POST  { manual: { date, minutes, reason, valor? } }  add time to a day by hand (shown as manual) · { manual: { date, remove: 0 } }
//   POST  { settings: { freeValor: 0.7 } }  valor for time with nothing in focus.
//   A day runs from 04:20 to 04:20 local. Automated pages (headless, webdriver, body.automation) never write.
//   The day summary's `tabs[]` says which page each counted second came from.
//   GET   today and the week of the vow: seconds, XP, each day hit / missed / open / ahead, the mission
//         being worked on. For the HUD, for Anorak, for the Telegram pings.
//   POST  { tab, seq, seconds, release? }  a page reports active seconds since its last report (one tab counts
//         at a time; `release` when the page closes)
//         (a report may carry `focus: { agent: { key, name }, mission: "file.md" }`: what the owner had open)
//         { agentWork: [{ key, name, ts, kind: 'turn' | 'helper', ms }] }  finished agent turns and helpers
//         { mission: "file.md" }  start working on a mission · { mission: null }  stop: back to "in the Oasis"
//   His own missions (Mindcraft's small panel; files in docs/questions, by: owner):
//   POST  { run: { start: { title | file, minutes: 60 | null, notify: "Anorak" | null } } }  start (null minutes: open-ended)
//         { run: { save: { title, minutes, ease, impact, urgency } } }  into his list, for later
//         { run: { note: "..." } }  a note on the running one · { run: { pause: true | false } } · { run: { notify: name | null } }
//         { run: { end: true, startedAt? } }  end it: kept or not, minutes, XP; his notes go to the agent
//         { run: { extend: 300 } }  more time on the timed one (from now if its time is up)
//         { run: { end: 'due', startedAt } }  a page saw the time run out: ended only if the book agrees
//   GET   ?run=1: the running one's notes
//   `run` commands are refused without a loopback browser Origin (the Oasis page): not from curl or an agent's shell.
// Local requests only, like /api/academy. The book is data/work-vow.local.json.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { extendOwnMission, endOwnMission, noteOwnMission, notifyOwnMission, ownMissionNotes, pauseOwnMission, saveOwnMission, startOwnMission, declareAgentMission, editManualTime, reportAgentWork, reportWorkBeat, setWorkSettings, switchWorkMission, workDaySummary, workAgentHours, workMindcraft, workMissionTimers, workMissionActivity, workRebuilt, workVowSnapshot } from '@/lib/work-vow-server'
import { clientLabel, isAutomationRequest, type AgentWorkReport } from '@/lib/village/work-vow'
import { fromOasisPage } from '@/lib/village/own-mission'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    // ?day=2026-11-16: that day's summary alone.
    const day = new URL(request.url).searchParams.get('day')
    if (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'day is YYYY-MM-DD' }, { status: 400 })
      return NextResponse.json({ summary: await workDaySummary(day) })
    }
    // ?mindcraft=1: every day in the book as lists (the owner's, each agent's, the whole Oasis').
    // (with `rebuilt`: the days before the counter began, from the transcripts, when they have been rebuilt)
    if (new URL(request.url).searchParams.get('mindcraft')) return NextResponse.json({ ...(await workMindcraft()), rebuilt: await workRebuilt() })
    // ?agentHours=1: the agents' working hours per day, oldest first, with the mark each day reached.
    if (new URL(request.url).searchParams.get('agentHours')) return NextResponse.json({ marks: [24, 72, 168], days: await workAgentHours() })
    // ?missions=1: per mission, the owner's time on it and the agents' time on it.
    if (new URL(request.url).searchParams.get('missions')) return NextResponse.json({ missions: await workMissionTimers(), activity: await workMissionActivity() })
    if (new URL(request.url).searchParams.get('run')) return NextResponse.json({ notes: await ownMissionNotes() })
    return NextResponse.json(await workVowSnapshot())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { tab?: unknown; seq?: unknown; seconds?: unknown; mission?: unknown; release?: unknown; back?: unknown; focus?: { agent?: { key?: unknown; name?: unknown } | null; mission?: unknown } | null; agentWork?: unknown; settings?: { freeValor?: unknown }; agentMission?: { agent?: unknown; mission?: unknown }; manual?: { date?: unknown; seconds?: unknown; minutes?: unknown; reason?: unknown; valor?: unknown; remove?: unknown } } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  // A test browser (headless, webdriver, a page that says so) never writes to the owner's work book.
  const userAgent = request.headers.get('user-agent')
  if (isAutomationRequest(userAgent, body)) {
    const report = typeof body.tab === 'string' || Array.isArray(body.agentWork)
    return report
      ? NextResponse.json({ ok: true, ignored: 'automation', counting: false, credited: 0 })
      : NextResponse.json({ error: 'automated pages cannot change the work book' }, { status: 403 })
  }
  try {
    const run = (body as { run?: unknown }).run
    // His own missions only from the Oasis page in a browser: the end speaks to an agent in his voice.
    if (run !== undefined && !fromOasisPage(request.headers.get('origin'), request.headers.get('host'))) {
      return NextResponse.json({ error: 'own missions are run from the Oasis page only' }, { status: 403 })
    }
    if (run && typeof run === 'object') return NextResponse.json(...(await ownMissionRequest(run as Record<string, unknown>)))
    if (body.agentMission && typeof body.agentMission === 'object') {
      const { agent, mission } = body.agentMission
      if (typeof agent !== 'string' || (mission !== null && typeof mission !== 'string')) return NextResponse.json({ error: 'agentMission is { agent: name, mission: "file.md" | null }' }, { status: 400 })
      const result = await declareAgentMission(agent, mission)
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (body.manual && typeof body.manual === 'object') {
      const m = body.manual
      if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return NextResponse.json({ error: 'manual.date is YYYY-MM-DD' }, { status: 400 })
      const seconds = typeof m.seconds === 'number' ? m.seconds : typeof m.minutes === 'number' ? m.minutes * 60 : 0
      const result = await editManualTime({
        date: m.date,
        seconds,
        reason: typeof m.reason === 'string' ? m.reason : '',
        valor: typeof m.valor === 'number' ? m.valor : undefined,
        remove: typeof m.remove === 'number' ? m.remove : undefined,
      })
      if (!result.ok) return NextResponse.json({ error: 'nothing changed: an entry needs minutes (up to a day) and a reason; remove needs an existing place' }, { status: 400 })
      return NextResponse.json(result)
    }
    if (body.settings && typeof body.settings === 'object') {
      if (typeof body.settings.freeValor !== 'number' || !(body.settings.freeValor >= 0 && body.settings.freeValor <= 1)) return NextResponse.json({ error: 'freeValor is a number from 0 to 1' }, { status: 400 })
      return NextResponse.json({ ok: true, snapshot: await setWorkSettings({ freeValor: body.settings.freeValor }) })
    }
    if (Array.isArray(body.agentWork)) {
      const reports = (body.agentWork as Array<Partial<AgentWorkReport>>).filter((r): r is AgentWorkReport =>
        Boolean(r) && typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 120 && typeof r.ts === 'number' && typeof r.ms === 'number' && (r.kind === 'turn' || r.kind === 'helper'))
        .map(r => ({ key: r.key, name: String(r.name || r.key).slice(0, 80), ts: r.ts, kind: r.kind, ms: r.ms }))
      return NextResponse.json({ ok: true, ...(await reportAgentWork(reports, (body as { source?: unknown }).source === 'engine')) })
    }
    if ('mission' in body) {
      if (body.mission !== null && typeof body.mission !== 'string') return NextResponse.json({ error: 'mission is a file name or null' }, { status: 400 })
      // From outside the page (no Origin) it may not end his running own mission.
      const result = await switchWorkMission(body.mission, Date.now(), fromOasisPage(request.headers.get('origin'), request.headers.get('host')))
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (typeof body.tab !== 'string' || !body.tab || body.tab.length > 80 || typeof body.seq !== 'number' || typeof body.seconds !== 'number') {
      return NextResponse.json({ error: 'tab, seq and seconds are required' }, { status: 400 })
    }
    const agent = body.focus?.agent && typeof body.focus.agent.key === 'string' && body.focus.agent.key
      ? { key: body.focus.agent.key.slice(0, 120), name: String(body.focus.agent.name || body.focus.agent.key).slice(0, 80) }
      : null
    const focus = { agent, mission: typeof body.focus?.mission === 'string' ? body.focus.mission : null, mindcraft: (body.focus as { mindcraft?: unknown } | null)?.mindcraft === true }
    return NextResponse.json({ ok: true, ...(await reportWorkBeat({ tab: body.tab, seq: body.seq, seconds: body.seconds, release: body.release === true, back: body.back === true, focus, client: clientLabel(userAgent) })) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')
const minutesOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)
const agentOf = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null)
const scoreOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** His own missions: start, save, note, pause, notify, end. Returns [body, init] for NextResponse.json. */
async function ownMissionRequest(run: Record<string, unknown>): Promise<[unknown, { status: number }?]> {
  const fail = (result: { error: string; status: number }): [unknown, { status: number }] => [{ error: result.error }, { status: result.status }]
  if (run.start && typeof run.start === 'object') {
    const start = run.start as Record<string, unknown>
    const result = await startOwnMission({ title: str(start.title, 140) || undefined, file: str(start.file, 120) || undefined, minutes: minutesOf(start.minutes), notify: agentOf(start.notify) })
    return result.ok ? [result] : fail(result)
  }
  if (run.save && typeof run.save === 'object') {
    const save = run.save as Record<string, unknown>
    const result = await saveOwnMission({ title: str(save.title, 140), minutes: minutesOf(save.minutes), ease: scoreOf(save.ease), impact: scoreOf(save.impact), urgency: scoreOf(save.urgency) })
    return result.ok ? [result] : fail(result)
  }
  if (typeof run.note === 'string') {
    const result = await noteOwnMission(run.note)
    return result.ok ? [result] : fail(result)
  }
  if (typeof run.extend === 'number' && run.extend > 0) return [{ ok: true, snapshot: await extendOwnMission(run.extend) }]
  if (typeof run.pause === 'boolean') return [{ ok: true, snapshot: await pauseOwnMission(run.pause) }]
  if ('notify' in run) return [{ ok: true, snapshot: await notifyOwnMission(agentOf(run.notify)) }]
  if (run.end === true || run.end === 'due') {
    // 'due': a page's clock says the time is up; the book ends it only if its own clock agrees.
    const result = await endOwnMission(typeof run.startedAt === 'number' ? run.startedAt : undefined, Date.now(), run.end === 'due')
    return result.ok ? [result] : fail(result)
  }
  return [{ error: 'run is { start } | { save } | { note } | { pause } | { notify } | { end: true }' }, { status: 400 }]
}
