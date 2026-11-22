// ░▒▓ SUMMON REQUEST — which kind of agent the summon menu opens on, and whether it comes to you ▓▒░
// A spell (Summon Claude Code, Summon Hermes, …) opens the one summon menu on its own kind, and the agent it makes
// appears where the spell was cast (summon-arrival.ts). The request waits here until the menu opens and takes it, so
// no store field is needed for a one-shot hint. The circle and the Agents list open it without "here": as before.

import { openVillagePicker } from './village-actions'

/** The agent kinds the summon menu shows. Codex and phone call have no engine runtime yet (shown greyed). */
export type SummonKind = 'claude' | 'hermes' | 'codex' | 'phone'

export interface SummonRequest {
  kind: SummonKind | null
  /** Cast as a spell: the new agent stands in front of the caster, in this world. */
  here: boolean
}

let pending: SummonRequest | null = null

export function openSummonMenu(kind?: SummonKind, options: { here?: boolean } = {}): void {
  pending = { kind: kind || null, here: Boolean(options.here) }
  openVillagePicker(true)
}

/** What the menu was opened for (once); null when it was opened by the circle or a list. */
export function takeSummonRequest(): SummonRequest | null {
  const request = pending
  pending = null
  return request
}
