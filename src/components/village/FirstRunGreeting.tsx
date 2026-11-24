'use client'

// ░▒▓ FIRST RUN GREETING — a newcomer's first minute: their own sessions, and one line that says what to do ▓▒░
// lib/village/first-run.ts decides. On a village that never had an agent, this page brings in the newest Claude Code
// sessions found on this machine, one per folder, as watched characters (client.observe: no process, no tokens),
// and shows one line at the top: walk up to one, press E, "Talk to it here" carries it on. With no sessions, the line
// points at the guide (GuideInvite in the Agents list does the summoning). The line goes once the newcomer opens an
// agent, summons the guide, or closes it. Kept per browser (localStorage).

import { useEffect, useSyncExternalStore } from 'react'
import { KitButton } from '@/components/ui-kit'
import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { FIRST_RUN_NONE, firstRunName, greetingLine, parseFirstRun, pickFirstSessions, shouldBringSessions, type FirstRunState } from '../../lib/village/first-run'
import { summonGuide } from './summon-guide'
import { arcInFront } from '../../lib/village/summon-defaults'
import { villageAgentKey } from '../../lib/village/village-layout'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { callVillageAgent, currentVillageWorld, setVillageHome } from './village-homes'
import { showNotice } from '../forge/GlobalNotice'

const KEY = 'oasis.village.firstRun.v1'
let state: FirstRunState | null = null
let running = false
const listeners = new Set<() => void>()

function read(): FirstRunState {
  if (state) return state
  try { state = parseFirstRun(window.localStorage.getItem(KEY)) } catch { state = FIRST_RUN_NONE }
  return state
}

function write(next: FirstRunState): void {
  state = next
  try { window.localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: this tab only */ }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function closeFirstRunGreeting(): void {
  const now = read()
  if (now.at && !now.greeted) write({ ...now, greeted: true })
}

/** They stand in an arc in front of the newcomer, facing them: the first thing seen (the ring is often behind). */
async function standInFront(keys: string[]): Promise<void> {
  let pose = getPlayerAvatarPose()
  for (let i = 0; i < 30 && !pose; i++) {
    await new Promise(resolve => window.setTimeout(resolve, 500))
    pose = getPlayerAvatarPose()
  }
  const world = currentVillageWorld()
  if (!pose || !world) return
  // In front of what the newcomer sees: the camera's way, not the avatar's (at the start it faces the camera).
  const camera = getCameraSnapshot()
  const look: [number, number, number] = camera && Math.hypot(camera.forward[0], camera.forward[2]) > 0.1 ? camera.forward : pose.forward
  const spots = arcInFront(pose.position, look, keys.length)
  await Promise.all(keys.map((key, i) => setVillageHome(world, key, spots[i]).then(() => callVillageAgent(key, world)).catch(() => { /* it stands on the ring */ })))
}

/** Brings the newest sessions in as watched characters, once, in a village that never had an agent. */
async function bringSessions(): Promise<void> {
  if (running) return
  running = true
  try {
    const client = getAgentEngineClient()
    const sessions = await client.listSessions(60)
    // Someone else (another tab, an agent) may have filled the village meanwhile.
    if (useOasisStore.getState().agentEngine.order.length > 0) return
    const picked = pickFirstSessions(sessions)
    const keys: string[] = []
    for (const session of picked) {
      try {
        const agent = await client.observe(session.path, firstRunName(session))
        keys.push(villageAgentKey(agent))
      } catch { /* one that cannot be read is left out */ }
    }
    write({ at: Date.now(), brought: keys.length, greeted: false })
    if (keys.length) void standInFront(keys)
  } catch {
    // The engine could not list sessions: the guide path, as before.
    write({ at: Date.now(), brought: 0, greeted: false })
  } finally {
    running = false
  }
}

/** The first-run step and its greeting line. Mounted with the village's Agents menu. */
export function FirstRunGreeting() {
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  const agentCount = useOasisStore(s => s.agentEngine.order.length)
  const focused = useOasisStore(s => s.agentEngine.focusedAgentId)
  const current = useSyncExternalStore(subscribe, read, () => FIRST_RUN_NONE)

  useEffect(() => {
    if (shouldBringSessions(current, connected, agentCount)) void bringSessions()
  }, [current, connected, agentCount])

  // Opening an agent is the first step done: the line has said what it had to say.
  useEffect(() => { if (focused) closeFirstRunGreeting() }, [focused])

  const line = greetingLine(current)
  if (!line) return null
  return (
    <div
      data-first-run-greeting
      className="pointer-events-auto fixed left-1/2 top-[64px] z-[var(--z-hud)] flex w-max max-w-[min(820px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-[13.5px] leading-snug text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md max-[700px]:top-[120px]"
      style={{ background: 'rgba(15,12,30,0.82)', border: '1px solid rgba(167,139,250,0.45)' }}
      role="status"
    >
      <span className="min-w-0">{line}</span>
      {/* The guide second: with sessions standing there, it is the one who explains; without, the Agents list offers it. */}
      {current.brought > 0 && <KitButton
        variant="plain"
        className="shrink-0"
        title="A first Claude Code agent, in a new folder 'Oasis' in your home, on your own plan, that shows you around"
        onClick={() => {
          closeFirstRunGreeting()
          summonGuide().catch(error => showNotice(`The guide could not start: ${error instanceof Error ? error.message : String(error)}`, 'error'))
        }}
      >
        Summon a guide
      </KitButton>}
      <button type="button" aria-label="Close" title="Close" className="shrink-0 rounded px-1.5 text-[14px] opacity-60 hover:opacity-100" onClick={closeFirstRunGreeting}>✕</button>
    </div>
  )
}
