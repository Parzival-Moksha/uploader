// ░▒▓ SUMMON A GUIDE — one click from an empty village to a first agent that talks ▓▒░
// Spawns "Guide" (lib/village/guide.ts: model, permissions, first message, card) in ~/Oasis (created if missing),
// walks the camera to it so its first reply is seen and heard, and writes its card once its session exists.
// Nothing here needs a key: the reply's spoken line plays in the browser's own voice when there is no ElevenLabs key.

import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { GUIDE_MODEL, GUIDE_NAME, GUIDE_PERMISSION_MODE, GUIDE_ROLE, guideFirstMessage, guideWho } from '../../lib/village/guide'
import { focusVillageAgent } from './village-actions'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

interface Where { workspace: string; readme: string }

async function where(): Promise<Where> {
  const response = await fetch(`${BASE}/api/local/summon-defaults`, { cache: 'no-store' })
  const data = await response.json().catch(() => null) as Partial<Where> & { error?: string } | null
  if (!response.ok || !data?.workspace) throw new Error(data?.error || `the Oasis could not say where your home folder is (HTTP ${response.status})`)
  return { workspace: data.workspace, readme: data.readme || '' }
}

/** Walk to the agent once the page knows it (the engine's roster update can trail the spawn's reply). */
function focusWhenKnown(agentId: string, tries = 40): void {
  if (focusVillageAgent(agentId) || tries <= 0) return
  window.setTimeout(() => focusWhenKnown(agentId, tries - 1), 150)
}

/** Its card needs its session: write it as soon as the session id shows up (the first turn starts it). */
function writeCardWhenReady(agentId: string, who: string): void {
  const done = () => {
    getAgentEngineClient().setCharacter(agentId, { role: GUIDE_ROLE, who }).catch(() => { /* told again with its next message anyway */ })
  }
  if (useOasisStore.getState().agentEngine.agents[agentId]?.sessionId) { done(); return }
  const stopAt = Date.now() + 5 * 60_000
  const unsubscribe = useOasisStore.subscribe(state => {
    const agent = state.agentEngine.agents[agentId]
    if (agent?.sessionId) { unsubscribe(); done() }
    else if (!agent || Date.now() > stopAt) unsubscribe()
  })
}

let busy = false

/** Spawns the guide and sends its first message. Resolves with its agent id; throws with a sentence to show. */
export async function summonGuide(): Promise<string> {
  if (busy) throw new Error('the guide is already on its way')
  busy = true
  try {
    // One guide: a second click walks to the first.
    const existing = Object.values(useOasisStore.getState().agentEngine.agents).find(agent => agent.owned && agent.name === GUIDE_NAME)
    if (existing) { focusWhenKnown(existing.id); return existing.id }
    const { workspace, readme } = await where()
    const client = getAgentEngineClient()
    const agent = await client.spawnAgent({ name: GUIDE_NAME, cwd: workspace, createCwd: true, model: GUIDE_MODEL, permissionMode: GUIDE_PERMISSION_MODE })
    focusWhenKnown(agent.id)
    await client.send(agent.id, guideFirstMessage(workspace))
    writeCardWhenReady(agent.id, guideWho(workspace, readme))
    return agent.id
  } finally {
    busy = false
  }
}
