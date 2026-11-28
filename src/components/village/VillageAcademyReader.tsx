'use client'

// ░▒▓ VILLAGE ACADEMY READER — "E open" at a node of the skill tree, and the node's sheet ▓▒░
// Plain DOM over the canvas (mounted by VillageHud), in the mission reader's look: what the skill is,
// the prompt with a Copy button, the proof, the keys with cost and link, XP and minutes, and two
// buttons: "I did it" (claim) and "Ask Anorak to check" (he looks and marks it through /api/academy; with
// no Anorak another of your agents checks, and with no other agent the player says "I saw the proof").
// It also keeps the academy's data fresh and tells the tree which trainee you last picked.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useLayer } from '@/lib/ui-kit/layers'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import {
  ACADEMY_KEY_COLOR,
  academyCheckMessage,
  academyKeyAction,
  academyLaneColor,
  nodeLook,
  pickAcademyChecker,
  type AcademyContent,
  type AcademyNodeLook,
  type AcademySkill,
  type AcademyTraineeView,
} from '../../lib/village/village-academy'
import { showNotice } from '../forge/GlobalNotice'
import { addVillageProximityRival, getNearbyVillageMini, getSessionPanelGeometry, isTypingTarget, subscribeNearbyVillageMini } from './village-actions'
import {
  VILLAGE_ACADEMY_LAYER,
  academyKeyOf,
  closeAcademyReader,
  getAcademyState,
  openAcademyReader,
  postAcademy,
  readerContent,
  readerTrainee,
  selectAcademyTrainee,
  selectedTrainee,
  startAcademyRefresh,
  subscribeAcademy,
  updateAcademyProximity,
  useAcademyEnabled,
} from './academy-store'
import { KeyPrompt, PromptBanner } from './VillageHud'
import { getCharacterState, subscribeCharacter } from './character-store'
import { getKeychainState, openKeychain, refreshKeychainIfOlder, subscribeKeychain } from './keychain-store'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS, agentDisplayName, canTalkTo } from './village-status'
import { AcademyTraineeSelect } from './AcademyGuide'

const LOOK_WORD: Record<AcademyNodeLook, string> = { locked: 'locked', available: 'ready', claimed: 'claimed', verified: 'verified' }
const KIND_WORD = { subscription: 'subscription', api: 'API key', account: 'account', hardware: 'hardware' } as const

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function when(at: number | undefined): string {
  if (!at) return ''
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 text-[9.5px] uppercase tracking-[0.2em] text-white/45">{children}</div>
}

export function AcademySheet({ skill, content, trainee, trainees }: { skill: AcademySkill; content: AcademyContent; trainee: AcademyTraineeView | null; trainees: AcademyTraineeView[] }) {
  // The place layer (src/lib/ui-kit/layers.ts), opened after the Character menu: over it, and Esc closes the sheet first.
  const zIndex = useLayer('village-academy', 'place', true, closeAcademyReader)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // Which of its keys you hold (the keychain looks once per skill opened; the server reuses a look for 45 s).
  const keychainKeys = useSyncExternalStore(subscribeKeychain, () => getKeychainState().keys, () => getKeychainState().keys)
  const held = useMemo(() => new Map(keychainKeys.map(item => [item.id, item.state])), [keychainKeys])
  useEffect(() => { void refreshKeychainIfOlder() }, [skill.id])
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { setCopied(false) }, [skill.id])

  const color = academyLaneColor(skill.lane)
  const look = nodeLook(trainee, skill)
  const progress = trainee?.skills[skill.id]
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const style = geometry.side === 'right'
    ? { right: geometry.margin, top: geometry.margin, width: geometry.width, height: geometry.height }
    : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height }
  const button = 'rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/85 transition hover:bg-white/15 disabled:opacity-40'
  const keys = skill.keys.map(id => content.keys.find(key => key.id === id) || { id, name: id, short: id, kind: 'account' as const, cost: '', link: '' })
  const needs = skill.needs.map(id => content.skills.find(item => item.id === id)).filter((item): item is AcademySkill => Boolean(item))

  const mark = async (state: 'none' | 'claimed' | 'verified', by = 'owner', proof?: string): Promise<boolean> => {
    if (!trainee) return false
    setBusy(true)
    const result = await postAcademy({ trainee: trainee.key, skill: skill.id, state, by, ...(proof ? { proof } : {}) })
    setBusy(false)
    if (!result.ok) showNotice(`Academy: ${result.error}`, 'error')
    return result.ok
  }

  // Who checks: Anorak if there is one, else another of your agents; nobody (a newcomer with one
  // agent): the player looks at the proof and says so.
  const engineAgents = useOasisStore(s => s.agentEngine.agents)
  const engineOrder = useOasisStore(s => s.agentEngine.order)
  const checker = useMemo(() => {
    if (!trainee) return null
    const candidates = engineOrder.map(id => engineAgents[id]).filter(Boolean).map(agent => ({
      id: agent.id,
      name: agentDisplayName(agent),
      owned: agent.owned,
      reachable: canTalkTo(agent) && agent.alive !== false,
      key: academyKeyOf(agent),
    }))
    return pickAcademyChecker(candidates, trainee.key)
  }, [engineAgents, engineOrder, trainee])

  const askChecker = async () => {
    if (!trainee || !checker) return
    // Asking for a check is a claim: the node goes half lit while it looks.
    if (look !== 'claimed' && look !== 'verified' && !(await mark('claimed'))) return
    const body = engineOrder.map(id => engineAgents[id]).find(agent => agent && academyKeyOf(agent) === trainee.key)
    const text = academyCheckMessage({ name: trainee.name, key: trainee.key, cwd: body?.cwd || null, skill, origin: window.location.origin, by: checker.name })
    setBusy(true)
    try {
      await getAgentEngineClient().send(checker.id, text)
      showNotice(`Asked ${checker.name} to check "${skill.name}" for ${trainee.name}.`, 'info')
    } catch (error) {
      showNotice(`Could not reach ${checker.name}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const sawIt = async () => {
    if (!trainee) return
    if (await mark('verified', 'you', `You saw the proof: ${skill.proof}`)) showNotice(`${skill.name}: verified for ${trainee.name}, +${skill.xp} XP.`, 'info')
  }

  return (
    <div
      data-ui-panel="village-academy"
      className={`fixed flex flex-col gap-2.5 rounded-xl border bg-slate-950/95 p-3.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${VILLAGE_TYPE_CLASS}`}
      style={{ ...style, zIndex, borderColor: `${color}88`, fontFamily: VILLAGE_FONT_BODY }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] uppercase tracking-[0.26em]" style={{ color }}>Oasis Academy · skill {skill.order} · tier {skill.tier} · {skill.lane}</div>
          <div className="break-words text-[20px] font-bold leading-tight tracking-wide" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{skill.name}</div>
        </div>
        <button type="button" className={`${button} text-[12px]`} onClick={closeAcademyReader} title="Back to the world (Esc)">✕</button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px]">
        <label className="flex min-w-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">trainee</span>
          <AcademyTraineeSelect
            data="sheet"
            trainee={trainee}
            trainees={trainees}
            className="max-w-[190px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11.5px] text-white outline-none focus:border-sky-300/70"
          />
        </label>
        {trainee && (
          <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5" title="Level: verified XP plus half of the claimed XP">
            <span className="font-bold text-amber-300">{trainee.level.name}</span>
            <span className="text-white/60">{trainee.xp.score} XP{trainee.level.next ? ` / ${trainee.level.next.xp}` : ''}</span>
          </span>
        )}
        <span data-academy-state={look} className="rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ borderColor: look === 'locked' ? '#4b5563' : `${color}aa`, color: look === 'locked' ? '#9ca3af' : color, background: look === 'verified' ? `${color}22` : 'transparent' }}>
          {LOOK_WORD[look]}{look === 'verified' ? ' ✓' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto break-words pr-2 text-[12.5px] leading-relaxed text-white/90">
        {progress && progress.state !== 'none' && (
          <div className="mb-3 rounded-lg border-l-2 bg-white/5 px-3 py-2" style={{ borderColor: color }}>
            <Label>{`${progress.state}${progress.by ? ` by ${progress.by}` : ''}${progress.at ? ` · ${when(progress.at)}` : ''}`}</Label>
            <div>{progress.proof || (progress.state === 'claimed' ? 'Claimed, not checked yet.' : 'No note.')}</div>
          </div>
        )}

        <Label>What it is</Label>
        <div className="mb-3 text-[13.5px] text-white">{skill.what}</div>

        {skill.menu && skill.menu.length > 0 && (
          <>
            {/* What the skill unlocks: the choices the agent now offers and asks you about. */}
            <Label>It asks you</Label>
            <div data-academy-menu className="mb-3 flex flex-col gap-1">
              {skill.menu.map(item => (
                <div key={item.label} className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                  <span className="font-bold" style={{ color }}>{item.label}</span>
                  <span className="text-white/85"> · {item.options}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mb-1 flex items-center justify-between gap-2">
          <Label>Say this to your agent</Label>
          <button
            type="button"
            data-academy-copy
            className={`${button} ${copied ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-50' : ''}`}
            onClick={() => { void copyText(skill.prompt).then(ok => { setCopied(ok); if (!ok) showNotice('Could not copy: select the text instead.', 'warn') }) }}
          >
            {copied ? 'copied ✓' : 'Copy'}
          </button>
        </div>
        <div className="mb-3 select-text whitespace-pre-wrap rounded-lg border border-white/12 bg-black/45 px-3 py-2 font-mono text-[12px] leading-relaxed text-emerald-50">{skill.prompt}</div>

        <Label>Proof</Label>
        <div className="mb-3">{skill.proof}</div>

        {keys.length > 0 && (
          <>
            <Label>{keys.length > 1 ? 'Keys: any one of these is enough' : 'Key'}</Label>
            <div className="mb-3 flex flex-col gap-1">
              {keys.map(key => (
                <div key={key.id} data-academy-key={key.id} data-key-state={held.get(key.id) || 'unknown'} className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
                  {/* Held: the gem is lit with a white rim; missing: an outline. */}
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={held.get(key.id) === 'have'
                    ? { background: ACADEMY_KEY_COLOR[key.kind], boxShadow: `0 0 8px ${ACADEMY_KEY_COLOR[key.kind]}`, border: '1.5px solid #fff' }
                    : held.get(key.id) === 'missing'
                      ? { border: `1.5px solid ${ACADEMY_KEY_COLOR[key.kind]}88` }
                      : { background: ACADEMY_KEY_COLOR[key.kind], boxShadow: `0 0 8px ${ACADEMY_KEY_COLOR[key.kind]}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold text-white">{key.name}</span>
                      <span className="text-[9.5px] uppercase tracking-[0.14em]" style={{ color: ACADEMY_KEY_COLOR[key.kind] }}>{KIND_WORD[key.kind]}</span>
                      {held.get(key.id) === 'have' && <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-emerald-300">you have it</span>}
                    </div>
                    {key.cost && <div className="text-[11.5px] text-white/65">{key.cost}</div>}
                  </div>
                  {key.link && <a href={key.link} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-bold text-sky-300 hover:underline">get it ↗</a>}
                </div>
              ))}
              {skill.way && <div className="text-[11.5px] text-white/60">Easiest way: {skill.way}</div>}
              <button type="button" data-academy-open-keychain className="self-start text-[11px] font-bold text-amber-200 hover:underline" onClick={() => openKeychain(skill.keys.find(id => getKeychainState().keys.find(item => item.id === id)?.state !== "have") || null)}>open the keychain</button>
            </div>
          </>
        )}

        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5"><span className="font-bold" style={{ color }}>{skill.xp} XP</span></span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/75">about {skill.mins} min</span>
        </div>

        {needs.length > 0 && (
          <>
            <Label>Needs first</Label>
            <div className="flex flex-wrap gap-1.5">
              {needs.map(item => {
                const state = trainee?.skills[item.id]?.state || 'none'
                return (
                  <button key={item.id} type="button" className={button} onClick={() => openAcademyReader(item.id, getAcademyState().readerMap)} title="Open this skill">
                    {item.name} · {state === 'none' ? 'not yet' : state}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 pt-2">
        <button
          type="button"
          data-academy-claim
          disabled={busy || !trainee || look === 'claimed' || look === 'verified'}
          onClick={() => { void mark('claimed') }}
          className={`${button} border-amber-300/45 bg-amber-400/15 px-3 py-2 text-[12px] text-amber-50`}
          title={trainee ? 'Mark it claimed: half the XP counts until someone checks it' : 'Pick a trainee first'}
        >
          I did it
        </button>
        {checker || !trainee ? (
          <button
            type="button"
            data-academy-check
            disabled={busy || !trainee || look === 'verified'}
            onClick={() => { void askChecker() }}
            className={`${button} border-emerald-300/45 bg-emerald-400/20 px-3 py-2 text-[12px] text-emerald-50`}
            title={checker ? `${checker.name} looks at the proof (the world, the disk, the trainee's session) and marks it verified, or says why not` : 'Pick a trainee first'}
          >
            Ask {checker?.name || 'Anorak'} to check
          </button>
        ) : (
          <button
            type="button"
            data-academy-saw
            disabled={busy || look === 'verified'}
            onClick={() => { void sawIt() }}
            className={`${button} border-emerald-300/45 bg-emerald-400/20 px-3 py-2 text-[12px] text-emerald-50`}
            title="No other agent to check it: you looked at the proof yourself. Summon a second agent (Anorak) to have it checked."
          >
            I saw the proof
          </button>
        )}
        {(look === 'claimed' || look === 'verified') && (
          <button type="button" data-academy-reset disabled={busy} onClick={() => { void mark('none') }} className={`${button} ml-auto`} title="Back to not done (for another take)">
            reset
          </button>
        )}
      </div>
      <div className="shrink-0 text-[10px] text-white/40">
        {trainee ? `Progress of ${trainee.name}, kept on this computer.` : 'No trainee yet: pick one of your agents under Trainee, above.'}
      </div>
    </div>
  )
}

export function VillageAcademyReader() {
  const enabled = useAcademyEnabled()
  const { content, trainees, nearby, reader, readerMap } = useSyncExternalStore(subscribeAcademy, getAcademyState, getAcademyState)
  // The Character menu (skills, keys) covers the world: no prompts for the tree behind it.
  const menuOpen = useSyncExternalStore(subscribeCharacter, () => getCharacterState().open, () => false)
  // The open sheet reads the set it was opened from: the map's, or the world's.
  const sheetContent = useSyncExternalStore(subscribeAcademy, () => readerContent(), () => null)
  const sheetTrainee = useSyncExternalStore(subscribeAcademy, () => readerTrainee(), () => null)
  const trainee = useSyncExternalStore(subscribeAcademy, () => selectedTrainee(), () => null)
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearMini = useSyncExternalStore(subscribeNearbyVillageMini, getNearbyVillageMini, () => null)
  const open = enabled && reader ? sheetContent?.skills.find(skill => skill.id === reader) || null : null
  const near = enabled && nearby && !menuOpen ? content?.skills.find(skill => skill.id === nearby) || null : null
  useUILayer(VILLAGE_ACADEMY_LAYER, Boolean(open))

  // Progress: every few seconds and when the window is looked at again.
  useEffect(() => (enabled ? startAcademyRefresh() : undefined), [enabled])

  // Which node the owner looks at: the village's proximity tick asks.
  useEffect(() => {
    if (!enabled) return
    const remove = addVillageProximityRival(updateAcademyProximity)
    return () => {
      remove()
      updateAcademyProximity(null, null)
      closeAcademyReader()
    }
  }, [enabled])

  // Reading needs a free mouse (scroll, buttons, the Copy button).
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])

  // Opening an agent that is in training turns the tree to it; its panel takes the reader's place.
  useEffect(() => {
    if (!focusedAgentId) return
    closeAcademyReader()
    const agent = useOasisStore.getState().agentEngine.agents[focusedAgentId]
    const key = agent ? academyKeyOf(agent) : null
    if (key && getAcademyState().trainees.some(item => item.key === key && item.training)) selectAcademyTrainee(key)
  }, [focusedAgentId])

  // A canvas click pops every UI layer: that closes the reader too.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(VILLAGE_ACADEMY_LAYER) && !state._uiLayerStack.includes(VILLAGE_ACADEMY_LAYER)) closeAcademyReader()
  }), [])

  // E at a node, E / Esc while reading: before the world's own bindings.
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const current = getAcademyState()
      const village = useOasisStore.getState().agentEngine
      const action = academyKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        readerOpen: Boolean(current.reader),
        nearby: Boolean(current.nearby) && !getCharacterState().open,
        agent: Boolean(village.focusedAgentId || village.nearbyAgentId || getNearbyVillageMini()),
        worldKeysFree: useInputManager.getState().can().enterFocuses,
      })
      if (!action) return
      if (action === 'close') closeAcademyReader()
      else if (current.nearby) openAcademyReader(current.nearby)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled])

  const shown = enabled && Boolean(content) && !focusedAgentId
  return (
    <>
      {shown && near && !open && !nearMini && (
        <PromptBanner accent={academyLaneColor(near.lane)} title={`${near.name} · ${LOOK_WORD[nodeLook(trainee, near)]}`}>
          <KeyPrompt k="E" label="Open skill" accent="#38bdf8" primary />
        </PromptBanner>
      )}
      {/* A sheet opened from the skill map is the Character menu's to show (CharacterMenu.tsx). */}
      {shown && open && sheetContent && !readerMap && <AcademySheet skill={open} content={sheetContent} trainee={sheetTrainee} trainees={trainees} />}
    </>
  )
}
