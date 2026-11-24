// ░▒▓ AGENT MODE — an agent's permission mode, switched from the Oasis, the restart done for him ▓▒░
// The owner (2026-11-24, after three "needs you: allow Bash" lines on Telegram): "do these agents need bypass
// permissions? i cant flip them from the oasis... in cc app i can flip them no problem." The engine could (agent.js
// setPermissionMode: a running Claude Code refuses some switches, bypass above all, and then restarts with the same
// session when the page confirms), but the control was a dropdown of internal names on the Settings page. Now: one
// row per mode with what it means (ModeChooser in AgentSessionPanel), one confirm before bypass, and when the running
// process refuses, the restart without another question. Only the owner, from the page's own socket, can confirm a
// restart into another mode (engine index.js); an agent can't raise its own.

import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { kitConfirm } from '@/components/ui-kit'
import { showNotice } from '../forge/GlobalNotice'

export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const
export type PermissionMode = typeof PERMISSION_MODES[number]

export const MODE_LABEL: Record<string, string> = {
  default: 'Ask first',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  plan: 'Plan only',
  bypassPermissions: 'Bypass',
}

/** What each mode means, in one line. */
export const MODE_MEANING: Record<string, string> = {
  default: 'It asks you before edits, commands and other tools.',
  acceptEdits: 'It edits files without asking, and asks before commands.',
  auto: 'It decides by itself what is safe, and asks you about the rest.',
  plan: 'It only reads and plans: it changes nothing.',
  bypassPermissions: 'It does everything without asking: edits, commands, the network.',
}

/** A Hermes agent's modes (ACP session/set_mode): ask before edits, allow workspace edits, allow edits except sensitive paths. */
export const HERMES_MODES = ['default', 'accept_edits', 'dont_ask']

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Switch an agent's mode. Bypass is confirmed first (it then runs anything without asking). When its running process
 * can't take the mode (bypass on a session not started with it), it restarts in that mode with the same session: at
 * once when it is idle, after its turn when it works. True when the switch is on its way.
 */
export async function switchAgentMode(agentId: string, name: string, mode: string): Promise<boolean> {
  if (mode === 'bypassPermissions') {
    const ok = await kitConfirm({
      title: `Let ${name} do everything without asking?`,
      body: `${MODE_MEANING.bypassPermissions} If its running process can't switch, it restarts with the same session (the conversation stays).`,
      confirm: 'Switch to bypass',
      danger: true,
    })
    if (!ok) return false
  }
  const client = getAgentEngineClient()
  try {
    await client.setPermissionMode(agentId, mode)
    showNotice(`${name}: ${MODE_LABEL[mode] || mode}. ${MODE_MEANING[mode] || ''}`, 'info')
    return true
  } catch (error) {
    const data = (error as { data?: { needsRestart?: boolean } }).data
    if (!data?.needsRestart) { showNotice(`Mode switch failed: ${describeError(error)}`, 'error'); return false }
  }
  try {
    const reply = await client.setPermissionMode(agentId, mode, true) as { data?: { applied?: string } }
    const later = reply?.data?.applied === 'after this turn'
    showNotice(`${name} restarts in ${MODE_LABEL[mode] || mode}${later ? ' after this turn' : ''}, same conversation.`, 'info')
    return true
  } catch (error) {
    showNotice(`Mode switch failed: ${describeError(error)}`, 'error')
    return false
  }
}
