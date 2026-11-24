'use client'

// ░▒▓ AGENT SESSION PANEL — the focused agent's session view + composer ▓▒░
// Opens when an agent is focused (E, click, N, roster chip). Right side on desktop, bottom sheet
// on phones. Typing never reaches the world: keydown stops here, keyup still bubbles so no
// movement key can get stuck (the WASD-stuck bug class).

import { useEffect, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { kitConfirm } from '../ui-kit'
import { HERMES_MODES, MODE_LABEL, MODE_MEANING, PERMISSION_MODES, switchAgentMode } from './agent-mode'
import { CUSTOM_MODEL_VALUE, cleanModelId, mergeModelLists, type ModelOption } from '../../lib/village/village-models'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '../../lib/input-manager'
import { effectiveStatus, type EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import { AgentSessionView, StatusPill } from './AgentSessionView'
import {
  VILLAGE_SESSION_LAYER,
  focusVillageAgent,
  getSessionPanelGeometry,
  getSessionPanelWidth,
  getVillageScreen,
  leaveVillageFocus,
  sessionPanelMaxWidth,
  setSessionPanelWidth,
  subscribeSessionPanelWidth,
  subscribeVillageScreen,
  pressVillageView,
  villageEscape,
} from './village-actions'
import { VillageComposer } from './VillageComposer'
import { EffortSelect } from './EffortSelect'
import { AccountSelect } from './AccountSelect'
import { EyesToggle } from './EyesToggle'
import { ChromeToggle } from './ChromeToggle'
import { FollowKitToggle, VoiceKitToggle } from './CompanionToggles'
import { FollowWorldsToggle } from './FollowWorldsToggle'
import { AgentSettingsSections } from './AgentSettingsMenu'
import { AcademyTrainToggle } from './VillageAcademyTrainee'
import { usePanelLook } from './PanelLook'
import { dismissVillageAgent } from './village-leave'
import { AgentWhereBar } from './AgentWhereBar'
import { AgentPanelHeaderTabs, ThreadFontScale, ThreadFontSlider, useAgentPanelTab } from './AgentPanelTabs'
import { AgentMissionsPage } from './AgentMissionsPage'
import { KitSelectField, KitChip } from '@/components/ui-kit'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS, agentDisplayName, canTalkTo, cwdLabel, formatCost, modelLabel, statusColor, statusLabel } from './village-status'
import { useKitStyle } from '@/components/ui-kit'
import { raiseLayer, useLayer } from '@/lib/ui-kit/layers'


function useViewport() {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Watching a session (one found on this machine, or open in the desktop app or a terminal). "Talk to it here" makes it
 * yours: the same session, not a copy.
 * If it is still open elsewhere (the desktop app, a terminal), the engine stops that idle process first; when the
 * owner types there again, the engine lets go and the Oasis goes back to watching.
 */
function ObservedFooter({ agentId }: { agentId: string }) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  const [busy, setBusy] = useState(false)
  if (!agent) return null
  const takeOver = async () => {
    if (!agent.cwd || !agent.sessionId) {
      showNotice('This session has no folder or id to resume from.', 'error')
      return
    }
    setBusy(true)
    const client = getAgentEngineClient()
    try {
      const live = await client.listLive().catch(() => [])
      const openElsewhere = live.some(entry => entry.sessionId === agent.sessionId)
      if (openElsewhere && !await kitConfirm({
        title: `Talk to "${agentDisplayName(agent)}" here?`,
        body: 'Same conversation, not a copy. It is open in the desktop app or a terminal, so that window stops holding it. When you type there again, it moves back and the Oasis goes to watching. The desktop app may only show what you said here after you reopen the session there.',
        confirm: 'Talk to it here',
      })) return
      const spawned = await client.spawnAgent({ name: agentDisplayName(agent).slice(0, 32), cwd: agent.cwd, sessionId: agent.sessionId, move: openElsewhere })
      await client.unobserve(agent.id).catch(() => {})
      focusVillageAgent(spawned.id)
    } catch (error) {
      showNotice(`Could not move it here: ${describeError(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-2 text-[11.5px] leading-snug text-cyan-100/90">
      <div>
        One of your Claude Code sessions, as it was last. You can read it here; to carry it on, talk to it here (on your own plan, in its own folder).
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => { void takeOver() }}
        className="self-start rounded-md border border-emerald-300/45 bg-emerald-400/20 px-3 py-1 text-[11.5px] font-black text-emerald-50 transition hover:bg-emerald-400/35 disabled:opacity-40"
      >
        {busy ? 'one moment…' : 'Talk to it here'}
      </button>
    </div>
  )
}

export function AgentSessionPanel() {
  const agentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const agent = useOasisStore(s => (s.agentEngine.focusedAgentId ? s.agentEngine.agents[s.agentEngine.focusedAgentId] : undefined))
  const viewport = useViewport()
  useUILayer(VILLAGE_SESSION_LAYER, Boolean(agentId))
  const [busy, setBusy] = useState(false)
  const screenAgentId = useSyncExternalStore(subscribeVillageScreen, getVillageScreen, () => null)
  // On the panel layer (src/lib/ui-kit/layers.ts), with Mindcraft and the Wizard console: the later opened or clicked
  // is on top; Esc closes it when it is the topmost. Another agent opened (from Mindcraft, N) comes to the front.
  const shown = Boolean(agentId && agent && screenAgentId !== agentId)
  const zIndex = useLayer('village-session', 'panel', shown, () => villageEscape())
  useEffect(() => { if (agentId && shown) raiseLayer('village-session', 'panel') }, [agentId, shown])
  // The remembered width (the owner drags the left edge); geometry reads it, this re-renders on a change.
  useSyncExternalStore(subscribeSessionPanelWidth, getSessionPanelWidth, () => null)
  // Every agent's model list merged (village-models.ts): an agent started before a release still offers the new model.
  const mergedModelsKey = useOasisStore(s => JSON.stringify(mergeModelLists(Object.values(s.agentEngine.agents).map(a => a.models))))
  const mergedModels = useMemo(() => JSON.parse(mergedModelsKey) as ModelOption[], [mergedModelsKey])
  // Transparency + blur for all agent chats, this agent's colour (PanelLook.tsx).
  const { accent: panelAccent, ...panelLook } = usePanelLook(agent?.sessionId || agentId || '')
  // The one menu style (ui-kit): Glass keeps this agent's own colour, see-through and blur; a textured style dresses the panel like every menu.
  const menuStyle = useKitStyle()
  const textured = menuStyle !== 'glass'

  // The page shown (thread or settings): a hook, so above the early return below.
  const panelTab = useAgentPanelTab()
  // F: the agent's own screen took over (camera + composer in the world); the layer above stays pushed.
  if (!agentId || !agent || screenAgentId === agentId) return null
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const shownStatus = effectiveStatus(agent)
  const color = statusColor(shownStatus)
  const models = mergeModelLists([agent.models, mergedModels])
  const currentModel = agent.model || 'default'
  const style = geometry.side === 'right'
    ? { top: geometry.margin, right: geometry.margin, bottom: geometry.margin, width: geometry.width, zIndex }
    : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height, zIndex }

  const composer = <VillageComposer key={agent.id} agentId={agent.id} containerHeight={geometry.height} />

  // Asks in the village's dialog, plays its leaving effect, then stops it (village-leave.ts; Delete does the same).
  const dismiss = () => {
    setBusy(true)
    void dismissVillageAgent(agent.id, () => leaveVillageFocus()).finally(() => setBusy(false))
  }

  // Drag the left edge: wider to the left (remembered); double-click: the automatic width again.
  const startWidthDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = geometry.width
    const max = sessionPanelMaxWidth(viewport.width)
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => setSessionPanelWidth(Math.min(max, startWidth + (startX - move.clientX)))
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      data-ui-panel="village-session"
      data-kit-style={textured ? menuStyle : undefined}
      className={textured
        ? `kit-panel fixed flex flex-col gap-2 p-3 text-white ${VILLAGE_TYPE_CLASS}`
        : `fixed flex flex-col gap-2 rounded-xl border bg-slate-950/95 p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${VILLAGE_TYPE_CLASS}`}
      style={textured
        ? { ...style, boxShadow: `0 24px 70px rgba(0,0,0,0.55)` }
        : { ...style, ...panelLook, borderColor: `${color}88`, boxShadow: `inset 0 3px 0 ${panelAccent}, 0 24px 70px rgba(0,0,0,0.55)`, fontFamily: VILLAGE_FONT_BODY }}
      onPointerDown={() => raiseLayer('village-session', 'panel')}
    >
      {geometry.side === 'right' && (
        <div
          onPointerDown={startWidthDrag}
          onDoubleClick={() => setSessionPanelWidth(null)}
          title="Drag to make the panel wider or narrower (double-click: automatic)"
          className="group absolute -left-1.5 bottom-6 top-6 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center"
        >
          <span className="h-16 w-1 rounded-full bg-white/15 transition group-hover:bg-white/50" />
        </div>
      )}
      {/* The name keeps its room: with Mindcraft and Settings in the header the buttons go to a second line on a
          narrow panel rather than squeezing the name to a letter per line. */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-[9rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            <span className="min-w-0 break-words text-[17px] font-bold leading-tight tracking-wide" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{agentDisplayName(agent)}</span>
            <StatusPill
              status={shownStatus}
              label={`${statusLabel({ status: shownStatus, unseen: agent.unseen, parked: agent.parked, offline: agent.offline })}${agent.bridged ? ' · desktop app' : agent.readOnly ? ' · read-only' : ''}`}
            />
          </div>
          {/* The repo it works in. Its session id is on the Settings page (with Copy); the engine's status word and the
              session's API-price total went (the owner, 2026-11-23: "it feels like bloat"; "$12 since when?"). */}
          <div className="mt-0.5 truncate text-[10.5px] text-white/70" title={agent.cwd || ''}>
            {cwdLabel(agent.cwd) || 'unknown folder'}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Its pages: Mindcraft (its missions for you) and Settings; the thread when neither is pressed. */}
          <AgentPanelHeaderTabs missions={agent.openMissions || 0} />
          <KitChip tone="danger" disabled={busy} onClick={dismiss} title={agent.owned ? 'Stop this agent and remove it from the village' : 'Stop observing'}>
            {agent.owned ? 'dismiss' : 'unobserve'}
          </KitChip>
          <KitChip onClick={() => pressVillageView('F')} title="Zoom into the agent's screen and talk there (F)">
            F screen
          </KitChip>
          <KitChip onClick={() => leaveVillageFocus()} title="Back to the world (Esc)" aria-label="Close">
            ✕
          </KitChip>
        </div>
      </div>

      {/* Three pages (AgentPanelTabs.tsx, chosen in the header): the thread, its missions, its settings. */}
      {panelTab === 'settings' ? (
        <AgentControls agent={agent} />
      ) : panelTab === 'mindcraft' ? (
        <AgentMissionsPage agentId={agent.id} name={agent.name} />
      ) : (
        <>
      {/* Where it is when that is not here: Call here / Go there / Send home (village-worlds.ts). */}
      <AgentWhereBar agentId={agent.id} />

      <div className="min-h-0 flex-1">
        <ThreadFontScale><AgentSessionView agentId={agent.id} variant="2d" /></ThreadFontScale>
      </div>
        </>
      )}

      {/* Keyed by agent: N to the next agent gets a fresh box, and T's "mic on" request finds it. */}
      {agent.owned ? (
        agent.alive || agent.status !== 'error' ? composer : (
          <div className="shrink-0 border-t border-white/10 pt-2 text-[11.5px] text-rose-100/90">
            The process stopped. Sending a message restarts it.
            {composer}
          </div>
        )
      ) : canTalkTo(agent) ? composer : (
        <ObservedFooter agentId={agent.id} />
      )}
    </div>
  )
}

/**
 * The agent's settings page (its panel's Settings tab, in the side panel and on the full screen): model and mode on
 * top, then thinking, account and its switches, Follow across worlds, and the thread's text size.
 */
/**
 * Its permission mode, one row per mode with what it means (agent-mode.ts): a click switches, bypass asks once, and
 * when its running process refuses, it restarts in the mode with the same conversation, without another question.
 */
function ModeChooser({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState<string | null>(null)
  const current = agent.permissionMode || agent.effectivePermissionMode || 'default'
  return (
    <div data-agent-mode-chooser className="flex flex-col gap-1">
      <div className="kit-label text-[10px] uppercase tracking-[0.12em]">Permissions</div>
      {PERMISSION_MODES.map(mode => {
        const on = mode === current
        return (
          <div key={mode} className="flex items-center gap-2">
            <KitChip
              data-mode={mode}
              pressed={on}
              tone={mode === 'bypassPermissions' ? 'danger' : undefined}
              disabled={busy !== null || on}
              onClick={() => { setBusy(mode); void switchAgentMode(agent.id, agent.name, mode).finally(() => setBusy(null)) }}
              className="w-[7.5rem] shrink-0 justify-center"
            >
              {busy === mode ? '…' : MODE_LABEL[mode]}
            </KitChip>
            <span className={`text-[11px] leading-snug ${on ? 'text-white/90' : 'text-white/55'}`}>{MODE_MEANING[mode]}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Its session id, whole, to copy (it left the header: "7d97fabf. Is it the commit hash or something?"). */
function SessionIdLine({ sessionId }: { sessionId: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!sessionId) return null
  return (
    <div data-agent-session-id className="flex items-center gap-2 text-[10.5px] text-white/60">
      <span className="shrink-0">Session</span>
      <code className="min-w-0 truncate font-mono text-white/80" title="Its Claude Code session id: what resume and the desktop app call it">{sessionId}</code>
      <KitChip onClick={() => { void navigator.clipboard?.writeText(sessionId).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}>
        {copied ? 'Copied' : 'Copy'}
      </KitChip>
    </div>
  )
}

/**
 * Follow me and Follow across worlds, at the top of every agent's Settings (2026-11-22: on the Hacker's he could not
 * find them; they were deep in the Walking section, under its name, character, schedule and voice).
 */
function FollowPair({ agent }: { agent: EngineAgentState }) {
  return (
    <div data-agent-follow-pair className="flex flex-col gap-1">
      <FollowKitToggle agent={agent} />
      <FollowWorldsToggle agentKey={agent.sessionId || agent.id} name={agent.name} kit />
    </div>
  )
}

export function AgentControls({ agent }: { agent: EngineAgentState }) {
  const mergedModelsKey = useOasisStore(s => JSON.stringify(mergeModelLists(Object.values(s.agentEngine.agents).map(a => a.models))))
  const mergedModels = useMemo(() => JSON.parse(mergedModelsKey) as ModelOption[], [mergedModelsKey])
  const models = mergeModelLists([agent.models, mergedModels])
  const currentModel = agent.model || 'default'
  return (
    <div data-agent-settings-tab className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 text-[11.5px]">
      {agent.owned ? (
        <>
          {/* Model, mode and thinking: one row (the owner, 2026-11-20: "they should fit in one line"). */}
          <div data-agent-model-row className="grid grid-cols-3 items-end gap-2 [&>*]:min-w-0 [&_select]:w-full">
          <KitSelectField
              label="Model"
              value={models.some(m => m.value === currentModel) ? currentModel : '__current'}
              onChange={event => {
                let model: string | null = event.target.value
                if (!model || model === '__current') return
                if (model === CUSTOM_MODEL_VALUE) {
                  model = cleanModelId(window.prompt('Model id (any the Claude Code CLI takes, e.g. claude-fable-5-2)', ''))
                  if (!model) return
                }
                getAgentEngineClient().setModel(agent.id, model).catch(error => showNotice(`Model switch failed: ${describeError(error)}`, 'error'))
              }}
              onKeyDown={event => event.stopPropagation()}
            >
              {!models.some(m => m.value === currentModel) && <option value="__current">{modelLabel(agent)}</option>}
              {models.map(model => <option key={model.value} value={model.value}>{model.displayName || model.value}</option>)}
              <option value={CUSTOM_MODEL_VALUE}>Other model id…</option>
          </KitSelectField>
          {agent.runtime === 'hermes' && (
            <KitSelectField
                label="Mode"
                value={agent.permissionMode || ''}
                onChange={event => {
                  const mode = event.target.value
                  if (!mode) return
                  void switchAgentMode(agent.id, agent.name, mode)
                }}
                onKeyDown={event => event.stopPropagation()}
              >
                <option value="">{`settings (${agent.effectivePermissionMode || '?'})`}</option>
                {HERMES_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
            </KitSelectField>
          )}
          <EffortSelect agent={agent} />
          </div>
          {agent.runtime !== 'hermes' && <ModeChooser agent={agent} />}
          <FollowPair agent={agent} />
          <div className="flex flex-wrap items-center gap-2">
          {/* Its Claude account (engine accounts.js), when there is more than one. */}
          <AccountSelect agent={agent} />
          <EyesToggle agent={agent} />
          <ChromeToggle agent={agent} />
          <AcademyTrainToggle agent={agent} />
          </div>
          <VoiceKitToggle agent={agent} />
        </>
      ) : (
        <>
          <FollowPair agent={agent} />
          <div className="flex flex-wrap items-center gap-2"><AcademyTrainToggle agent={agent} /></div>
        </>
      )}
      <ThreadFontSlider />
      <SessionIdLine sessionId={agent.sessionId} />
      <div className="kit-hint">{agent.runtime === 'hermes' ? `Hermes${agent.remoteHost ? ` on ${agent.remoteHost}` : ''} · ` : ''}{modelLabel(agent)}</div>
      {/* What the gear rolled down before (name, character, schedule, voice, walking, home, avatar, colour, all chats). */}
      <AgentSettingsSections agent={agent} />
    </div>
  )
}
