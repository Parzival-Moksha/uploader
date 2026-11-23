'use client'

// ░▒▓ CARBON — Mindcraft's mission list: what the Oasis needs from the owner ▓▒░
// The owner, 2026-11-20: "the Oasis needs to employ me in the most effective way possible." Every open
// question or task for him is a file in docs/questions (7c_oasis); this lists them, highest priority first
// (or by date, urgency, impact, ease), and opens one with its stats, its context, the options, the
// recommendation, Anorak's guess (shown only once he has answered, so it doesn't steer him), and an answer box
// with voice typing and quick answers. Answering writes into the file and tells Anorak.
// Time with Mindcraft open is counted work at valor 1 (work-vow), so answering counts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentVoiceInput } from '../../hooks/useAgentVoiceInput'
import { renderMarkdown } from '../../lib/anorak-renderers'
import { askingAgent, quickAnswer, sortCarbon, splitCommands, type CarbonMission, type CarbonSort } from '../../lib/village/carbon-missions'
import { setDraftText } from '../../lib/voice/village-dictation'
import { useOasisStore } from '../../store/oasisStore'
import { focusVillageAgent } from './village-actions'
import { useMindcraftLook } from './mindcraft-look'
import { startOwnRun } from './work-vow-client'
import { MinutesStepper } from './OwnMissionPanel'

const SORTS: Array<{ id: CarbonSort; label: string }> = [
  { id: 'priority', label: 'priority' },
  { id: 'oldest', label: 'oldest' },
  { id: 'newest', label: 'newest' },
  { id: 'urgency', label: 'urgency' },
  { id: 'impact', label: 'impact' },
  { id: 'ease', label: 'ease' },
]
type Filter = 'open' | 'parked' | 'answered' | 'all'

/** The kit's .mc-btn is a full-width block; in a row of answers each button is as wide as its words. */
const INLINE_BTN = { display: 'inline-block', width: 'auto', minWidth: 96, padding: '10px 18px 9px' } as const

function priorityColor(p: number | null): string {
  if (p === null) return 'rgba(255,255,255,0.45)'
  return p >= 0.5 ? '#fbbf24' : p >= 0.25 ? '#fde68a' : '#cbd5e1'
}

function dayShort(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '—'
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="mc-field flex items-baseline gap-1.5 px-2 py-0.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-white/50">{label}</span>
      <span className="font-bold" style={color ? { color } : undefined}>{value}</span>
    </span>
  )
}

/** A command from the mission, in a box with a copy button (the owner runs it himself). */
export function CommandBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div data-mindcraft="command" className="my-2 flex items-start gap-2 rounded border border-sky-300/30 bg-black/55 px-2.5 py-2">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[13.5px] leading-snug text-sky-100">{text}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})
        }}
        className="mc-field shrink-0 px-2 py-0.5 text-[12px] font-bold hover:brightness-125"
        title="Copy the command"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

function keepKeys(event: React.KeyboardEvent) {
  if (event.key !== 'Escape') event.stopPropagation()
}

/**
 * The one way to answer a mission: an answer box with voice typing, Yes (the recommendation) / No / Later / Done,
 * and "not enough to decide". Used by Mindcraft's Carbon tab, and by an agent's own panel (its missions, answered
 * in place). It posts to /api/village/questions, which writes the file and tells the asker and Anorak.
 * `onDone` runs after a successful answer (or "not enough"); the caller re-reads its list.
 */
export function CarbonAnswerBox({ mission, onDone }: { mission: CarbonMission; onDone: () => void }) {
  useMindcraftLook()
  const onAnswered = onDone
  const openedAt = useRef(Date.now())
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  draftRef.current = draft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const voiceBase = useRef<string | null>(null)
  const join = (base: string, spoken: string) => (base.trim() && spoken.trim() ? `${base.trim()} ${spoken.trim()}` : `${base}${spoken}`)
  const voice = useAgentVoiceInput({
    onLiveText: spoken => {
      if (voiceBase.current === null) voiceBase.current = draftRef.current
      setDraft(join(voiceBase.current, spoken))
    },
    onTranscript: spoken => {
      setDraft(join(voiceBase.current ?? draftRef.current, spoken))
      voiceBase.current = null
    },
  })
  // "Not enough to decide": the asker is told to add what is missing to the file; the mission sinks until it does.
  const notEnough = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/village/questions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: mission.file, unclear: true, expected: mission.markdown }) })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      onAnswered()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }
  const answered = mission.state === 'answered'

  const submit = useCallback(async (answer: string, state: 'answered' | 'parked') => {
    if (!answer.trim() || busy) return
    if (voice.listening) voice.stop()
    setBusy(true)
    setError('')
    try {
      const took = Math.max(1, Math.ceil((Date.now() - openedAt.current) / 60_000))
      const response = await fetch('/api/village/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: mission.file, answer, state, took, expected: mission.markdown }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setDraft('')
      onAnswered()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }, [busy, mission.file, mission.markdown, onAnswered, voice])

  const quick = (choice: 'yes' | 'no' | 'later' | 'done') => {
    const q = quickAnswer(choice, mission)
    // A word typed or said in the box goes with the quick answer.
    void submit(draft.trim() ? `${q.answer}. ${draft.trim()}` : q.answer, q.state)
  }

  return (
    <div className="mc-scope" data-mindcraft="answer-box">
        <div className="flex shrink-0 flex-col gap-2" onKeyDown={keepKeys}>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              rows={2}
              disabled={busy}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(draft, 'answered')
                }
              }}
              placeholder={answered ? 'Change your answer (Enter sends)' : 'Say or type your answer (Enter sends)'}
              className="mc-field min-w-0 flex-1 resize-none px-2.5 py-1.5 text-[15px] text-white outline-none placeholder:text-white/35"
            />
            {voice.supported && (
              <button type="button" onClick={() => voice.toggle()} className="mc-btn px-3 py-2" style={INLINE_BTN} data-tone={voice.listening ? 'stop' : undefined} title={voice.listening ? 'Stop the mic' : 'Talk: your words appear in the box'}>
                {voice.listening ? '■ mic' : '🎙'}
              </button>
            )}
            <button type="button" disabled={busy || !draft.trim()} onClick={() => { void submit(draft, 'answered') }} className="mc-btn px-3 py-2" style={INLINE_BTN} data-tone="go">answer</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => quick('yes')} className="mc-btn px-3 py-1" style={INLINE_BTN} data-tone="go" title={mission.recommend ? `Yes: ${mission.recommend}` : 'Yes'}>Yes{mission.recommend ? ' (as recommended)' : ''}</button>
            <button type="button" disabled={busy} onClick={() => quick('no')} className="mc-btn px-3 py-1" style={INLINE_BTN} data-tone="stop">No</button>
            <button type="button" disabled={busy} onClick={() => quick('later')} className="mc-btn px-3 py-1" style={INLINE_BTN}>Later</button>
            {mission.kind === 'task' && <button type="button" disabled={busy} onClick={() => quick('done')} className="mc-btn px-3 py-1" style={INLINE_BTN} data-tone="go">Done</button>}
            {!answered && (
              <button type="button" data-mindcraft="not-enough" disabled={busy} onClick={() => { void notEnough() }} className="ml-auto text-[13px] text-amber-200/80 underline decoration-dotted hover:text-amber-100" title="The asker is told to add what is missing to the file; until then this mission sits at the bottom">
                not enough to decide
              </button>
            )}
            {error && <span className="text-rose-300">{error}</span>}
          </div>
        </div>
    </div>
  )
}

function MissionView({ mission, onBack, onAnswered }: { mission: CarbonMission; onBack: () => void; onAnswered: () => void }) {
  // The whole body, nothing cut; commands stand in their own box with a copy button.
  const body = useMemo(() => splitCommands(mission.body).map((part, index) => (part.kind === 'command'
    ? <CommandBox key={index} text={part.text} />
    : <div key={index}>{renderMarkdown(part.text)}</div>)), [mission.body])
  // Who to ask: the agent that asked (or Anorak), if it is in the village.
  const asker = useOasisStore(s => {
    const agents = s.agentEngine.order.map(id => s.agentEngine.agents[id]).filter(Boolean).map(a => ({ id: a.id, name: a.name || '' }))
    const found = askingAgent(mission.by, agents)
    return found ? `${found.id}${found.name}` : ''
  })
  const [askerId, askerName] = asker ? asker.split('') : ['', '']
  // Talk to it about this mission: its panel opens over Mindcraft with the title quoted in its box; closing it
  // comes back to this same mission (Mindcraft stays open underneath).
  const talk = () => {
    if (!askerId) return
    setDraftText(askerId, `About the mission “${mission.title}”: `)
    focusVillageAgent(askerId)
  }
  const answered = mission.state === 'answered'

  return (
    <div data-mindcraft="carbon-mission" className="flex h-full min-h-0 flex-1 flex-col gap-2.5 text-[15px]">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="mc-field shrink-0 px-2.5 py-1 text-[13px] font-bold hover:brightness-125">← all missions</button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/50">{mission.kind === 'task' ? 'A thing to do' : 'A question'} · asked {dayShort(mission.asked)}{mission.by ? ` by ${mission.by}` : ''}</div>
          <div className="mc-strong break-words text-[21px] leading-tight">{mission.title}</div>
        </div>
        {askerId && (
          <button type="button" data-mindcraft="talk-to-asker" onClick={talk} className="mc-btn shrink-0 px-3 py-1" style={INLINE_BTN} title={`Open ${askerName}'s panel with this mission quoted in its box; close it to come back here`}>
            Talk to {askerName}
          </button>
        )}
      </div>
      {mission.sinking && <div className="text-amber-200/80">You marked this “not enough to decide” on {dayShort(mission.unclear?.date || '')}; {askerName || 'the asker'} was asked to add what is missing.</div>}
      <div className="flex flex-wrap gap-1.5 text-[14px]">
        <Stat label="priority" value={mission.priority === null ? '—' : mission.priority.toFixed(2)} color={priorityColor(mission.priority)} />
        <Stat label="minutes" value={mission.minutes === null ? '—' : `~${mission.minutes}`} />
        <Stat label="urgency" value={String(mission.urgency ?? '—')} />
        <Stat label="impact" value={String(mission.impact ?? '—')} />
        <Stat label="ease" value={String(mission.ease ?? '—')} />
        <Stat label="state" value={mission.state === 'parked' ? `later${mission.backOn ? `, back ${mission.backOn}` : ''}` : mission.state} />
      </div>
      {mission.blocks && <div className="text-white/75"><span className="text-[11px] uppercase tracking-[0.14em] text-white/50">waits on it </span>{mission.blocks}</div>}
      <div className="mc-card min-h-[120px] flex-1 overflow-y-auto px-3 py-2 leading-relaxed text-white/90">
        {body}
        {mission.recommend && <div className="mt-2 border-t border-white/10 pt-2"><span className="text-[11px] uppercase tracking-[0.14em] text-white/50">recommended </span><b>{mission.recommend}</b></div>}
        {/* Anorak's guess is written before he answers and shown only after, so it never steers him. */}
        {mission.predict && answered && (
          <div className="mt-2 rounded border border-dashed border-amber-200/35 px-2 py-1 text-white/75"><span className="text-[11px] uppercase tracking-[0.14em] text-amber-200/80">Anorak guessed </span>{mission.predict}</div>
        )}
        {mission.answer && (
          <div className="mt-2 rounded border border-emerald-300/30 bg-emerald-400/5 px-2 py-1"><span className="text-[11px] uppercase tracking-[0.14em] text-emerald-200/80">your answer{mission.answered ? `, ${dayShort(mission.answered)}` : ''}{mission.took !== null ? `, ${mission.took} min` : ''} </span>{mission.answer}</div>
        )}
      </div>
      {mission.by.trim().toLowerCase() === 'owner' && mission.state !== 'answered' && <StartOwn mission={mission} onStarted={onAnswered} />}
      <CarbonAnswerBox mission={mission} onDone={onAnswered} />
    </div>
  )
}

/** His own mission, saved for later: start it from here (its minutes; the clock runs bottom left). */
function StartOwn({ mission, onStarted }: { mission: CarbonMission; onStarted: () => void }) {
  const [minutes, setMinutes] = useState(String(mission.minutes ?? 60))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const start = async (openEnded: boolean) => {
    if (busy) return
    setBusy(true)
    const answer = await startOwnRun({ file: mission.file, minutes: openEnded ? null : Math.max(1, Math.round(Number(minutes) || 60)), notify: 'Anorak' })
    setBusy(false)
    setNote(answer.error ? answer.error : 'Running: its clock is bottom left; click it for notes, pause and end.')
    if (!answer.error) onStarted()
  }
  return (
    <div data-mindcraft="start-own" className="flex flex-wrap items-center gap-2" onKeyDown={keepKeys}>
      <span className="text-white/70">Your own mission.</span>
      <MinutesStepper value={minutes} onChange={setMinutes} />
      <button type="button" disabled={busy} onClick={() => { void start(false) }} className="mc-btn" style={INLINE_BTN} data-tone="go">▶ Start</button>
      <button type="button" disabled={busy} onClick={() => { void start(true) }} className="mc-btn" style={INLINE_BTN}>open-ended</button>
      {note && <span className="text-[13px] text-emerald-200/90">{note}</span>}
    </div>
  )
}

export function CarbonMissions({ initialFile = null }: { initialFile?: string | null } = {}) {
  const [missions, setMissions] = useState<CarbonMission[] | null>(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<CarbonSort>('priority')
  const [filter, setFilter] = useState<Filter>('open')
  const [selected, setSelected] = useState<string | null>(initialFile)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/village/questions', { cache: 'no-store' })
      const data = await response.json() as { missions?: CarbonMission[]; error?: string }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setMissions(data.missions || [])
      setError(data.error || '')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const shown = useMemo(() => sortCarbon((missions || []).filter(m => filter === 'all' || m.state === filter), sort), [missions, filter, sort])
  const open = (missions || []).filter(m => m.state === 'open')
  const openMinutes = open.reduce((sum, m) => sum + (m.minutes || 0), 0)
  const current = selected ? (missions || []).find(m => m.file === selected) || null : null

  if (current) {
    return <MissionView key={current.file} mission={current} onBack={() => setSelected(null)} onAnswered={() => { setSelected(null); void load() }} />
  }
  if (!missions) return <div className="p-4 text-white/55">{error ? `Can't read the missions: ${error}` : 'Reading the missions…'}</div>

  const header = 'grid grid-cols-[minmax(0,1fr)_58px_52px_34px_34px_34px_64px] items-center gap-x-2'
  return (
    <div data-mindcraft="carbon" className="flex h-full min-h-0 flex-1 flex-col gap-2 text-[14.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-white/75"><b className="text-white">{open.length} open</b>{openMinutes ? ` · about ${openMinutes} min of your time` : ''}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="mc-field flex items-center gap-1.5 px-2 py-1 text-[13px]">
            sort
            <select value={sort} onChange={event => setSort(event.target.value as CarbonSort)} onKeyDown={keepKeys}>
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="mc-field flex items-center gap-1.5 px-2 py-1 text-[13px]">
            show
            <select value={filter} onChange={event => setFilter(event.target.value as Filter)} onKeyDown={keepKeys}>
              <option value="open">open</option>
              <option value="parked">later</option>
              <option value="answered">answered</option>
              <option value="all">all</option>
            </select>
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="py-6 text-center text-white/50">{missions.length ? `Nothing ${filter === 'parked' ? 'for later' : filter}.` : 'When your agents need a decision from you, it shows up here.'}</div>
      ) : (
        <div className="mc-card flex min-h-0 flex-col overflow-y-auto">
          <div className={`${header} sticky top-0 z-10 border-b border-white/10 bg-black/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-white/50`}>
            <span>mission</span><span className="text-right">priority</span><span className="text-right">min</span><span className="text-center" title="urgency">U</span><span className="text-center" title="impact">I</span><span className="text-center" title="ease">E</span><span className="text-right">asked</span>
          </div>
          {shown.map(m => (
            <button
              key={m.file}
              type="button"
              data-mindcraft="carbon-row"
              onClick={() => setSelected(m.file)}
              className={`${header} border-b border-white/5 px-3 py-2 text-left hover:bg-white/5`}
              style={{ opacity: m.state === 'open' ? 1 : 0.6 }}
            >
              <span className="min-w-0">
                <span className="block break-words leading-snug text-white">{m.kind === 'task' ? '☐ ' : ''}{m.title}</span>
                <span className="block break-words text-[12.5px] leading-snug text-white/50">{m.by || 'someone'}{m.blocks ? ` · waits: ${m.blocks}` : ''}{m.state === 'parked' ? ` · later${m.backOn ? `, back ${m.backOn}` : ''}` : m.state !== 'open' ? ` · ${m.state}` : ''}{m.sinking ? ' · waiting for more detail' : ''}</span>
              </span>
              <span className="text-right font-bold tabular-nums" style={{ color: priorityColor(m.priority) }}>{m.priority === null ? '—' : m.priority.toFixed(2)}</span>
              <span className="text-right tabular-nums text-white/80">{m.minutes === null ? '—' : `~${m.minutes}`}</span>
              <span className="text-center tabular-nums text-white/80">{m.urgency ?? '—'}</span>
              <span className="text-center tabular-nums text-white/80">{m.impact ?? '—'}</span>
              <span className="text-center tabular-nums text-white/80">{m.ease ?? '—'}</span>
              <span className="text-right text-[13px] text-white/60">{dayShort(m.asked)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
