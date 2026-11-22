// ░▒▓ SUMMON ARRIVAL — what the summon menu's choices do once the agent exists ▓▒░
// The body picked in the menu (village memory, the same as Settings > Avatar), the "who it is" line (the role on its
// card, engine character.js), and, for a spell, its place: two metres in front of the caster, facing them, in the
// world they stand in (a home spot there and a call into that world, village-homes.ts). Everything keys on the
// agent's session (villageAgentKey), so it waits for that when a runtime gives it later (Hermes).

import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { villageAgentKey } from '../../lib/village/village-layout'
import { setVillageAgentSkin } from '../../lib/village/village-memory'
import { spotInFront } from '../../lib/village/summon-defaults'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { callVillageAgent, currentVillageWorld, setVillageHome } from './village-homes'

export interface ArrivalChoices {
  /** /avatars/gallery/….vrm, or '' to let the village pick. */
  avatar?: string
  /** One sentence for its card's role; '' leaves it empty. */
  role?: string
  /** Cast as a spell: it stands in front of the caster. */
  here?: boolean
}

function whenSession(agentId: string, run: (key: string) => void): void {
  const now = useOasisStore.getState().agentEngine.agents[agentId]
  if (now?.sessionId) { run(villageAgentKey(now)); return }
  const stopAt = Date.now() + 5 * 60_000
  const unsubscribe = useOasisStore.subscribe(state => {
    const agent = state.agentEngine.agents[agentId]
    if (agent?.sessionId) { unsubscribe(); run(villageAgentKey(agent)) }
    else if (!agent || Date.now() > stopAt) unsubscribe()
  })
}

export function afterSummon(agentId: string, choices: ArrivalChoices): void {
  // Taken now, while the caster still stands where the spell was cast.
  const pose = choices.here ? getPlayerAvatarPose() : null
  const world = choices.here ? currentVillageWorld() : null
  whenSession(agentId, key => {
    if (choices.avatar) setVillageAgentSkin(key, choices.avatar)
    const role = choices.role?.trim()
    if (role) getAgentEngineClient().setCharacter(agentId, { role }).catch(() => { /* it can be written in its settings */ })
    if (pose && world) {
      void setVillageHome(world, key, spotInFront(pose.position, pose.forward))
        .then(() => callVillageAgent(key, world))
        .catch(() => { /* it stands on the ring instead */ })
    }
  })
}
