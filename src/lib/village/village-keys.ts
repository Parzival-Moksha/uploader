// ░▒▓ VILLAGE KEYS — what a key press means in the village (pure, so it can be tested) ▓▒░
//
// An agent has two views: its side panel (E) and its full screen (F). Which one is open, and what E, F and Esc do,
// is decided in one place, VILLAGE_VIEW_TABLE below (the owner, 2026-11-20 18:40: "make it one small state machine"):
//
//                   E                     F                      Esc
//   nothing open    E panel of the agent  F view of the agent    (the world's: the menu)
//   E panel open    nothing open          F view, same agent     nothing open
//   F view open     E panel, same agent   nothing open           nothing open
//
// "The agent" from nothing open: the nearest one, within talking range, whoever is selected (the T / E / F hints
// stand over it, so the keys do what the hints point at; the owner, 2026-11-23). Only with nobody in range does the
// selected one count (N, or a click in the Agents menu, then E, from across the world); with neither, nothing opens
// and a one-line hint says to walk up to someone. In the summoning circle with nobody near, E opens the picker.
// The panel's "F screen" button and the full screen's "E panel" and close buttons press the same keys
// (village-actions.ts pressVillageView).
// Other keys: T next to an agent opens it with the mic on, and toggles the mic with one open; Enter sends what is in
// the box; N jumps to the next agent that needs you; E in the summoning circle opens the picker. Keys typed into a
// text box are text (Ctrl+Space excepted: it dictates). Esc never stops the mic: dictation goes on after leaving
// (the voice widget, bottom left).

export type VillageView = { kind: 'none' } | { kind: 'panel' | 'screen'; agentId: string }
export type VillageViewKey = 'E' | 'F' | 'Esc'
export const VILLAGE_VIEW_NONE: VillageView = { kind: 'none' }

/** The single place that decides: from each view, where each of E, F and Esc goes. */
export const VILLAGE_VIEW_TABLE: Record<VillageView['kind'], Record<VillageViewKey, VillageView['kind']>> = {
  none: { E: 'panel', F: 'screen', Esc: 'none' },
  panel: { E: 'none', F: 'screen', Esc: 'none' },
  screen: { E: 'panel', F: 'none', Esc: 'none' },
}

/** Where `key` goes from `view`. `target`: the agent to open from nothing open (selected, else nearest). */
export function nextVillageView(view: VillageView, key: VillageViewKey, target: string | null): VillageView {
  const kind = VILLAGE_VIEW_TABLE[view.kind][key]
  if (kind === 'none') return VILLAGE_VIEW_NONE
  const agentId = view.kind === 'none' ? target : view.agentId
  return agentId ? { kind, agentId } : VILLAGE_VIEW_NONE
}

/** The agent E and F open from nothing open: the nearest (within talking range), else the selected one. */
export function villageViewTargetOf(nearbyAgentId: string | null, selectedAgentId: string | null): string | null {
  return nearbyAgentId ?? selectedAgentId
}

export function villageViewKey(code: string): VillageViewKey | null {
  return code === 'KeyE' ? 'E' : code === 'KeyF' ? 'F' : code === 'Escape' ? 'Esc' : null
}

export type VillageKeyAction =
  | 'toggle-voice'
  /** E, F or Esc: the view table decides (nextVillageView). */
  | 'view'
  | 'send'
  | 'talk'
  | 'picker'
  /** E or F with nobody near and nobody selected: nothing opens; the page says to walk up to someone. */
  | 'no-target'
  | 'next'

export interface VillageKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  repeat: boolean
  /** The key went into a text field (the agent's box, a search field…): it is typing, not a command. */
  typing: boolean
  focusedAgentId: string | null
  nearbyAgentId: string | null
  /** The selected agent (a click on it, N, the Agents menu): E and F open it when nobody is near. */
  targetAgentId?: string | null
  /** The world's keys are free for the village (walking around, or already in the session view). */
  worldKeysFree: boolean
  inPlaza: boolean
  agentCount: number
}

export function villageKeyAction(c: VillageKeyContext): VillageKeyAction | null {
  // Ctrl+Space dictates into the open agent's box, even while typing in it.
  if (c.ctrl && !c.alt && !c.meta && c.code === 'Space' && !c.repeat && c.focusedAgentId) return 'toggle-voice'
  if (c.ctrl || c.meta || c.alt || c.repeat || c.typing) return null
  if (c.focusedAgentId) {
    if (c.code === 'KeyT') return 'toggle-voice'
    if (villageViewKey(c.code)) return 'view'
    if (c.code === 'Enter' && !c.shift) return 'send'
  }
  // Placement, paint and other panels keep their keys (E is noclip "down", T the rotate gizmo).
  if (!c.worldKeysFree) return null
  if (c.code === 'KeyT') return c.nearbyAgentId && c.nearbyAgentId !== c.focusedAgentId ? 'talk' : null
  if (c.code === 'KeyE' || c.code === 'KeyF') {
    if (c.focusedAgentId) return null
    if (c.nearbyAgentId) return 'view'
    if (c.code === 'KeyE' && c.inPlaza) return 'picker'
    if (c.targetAgentId) return 'view'
    return 'no-target'
  }
  if (c.code === 'KeyN' && !c.shift) return c.agentCount > 0 ? 'next' : null
  return null
}

// ─── the text box: grows with what you say, up to a cap, then scrolls ────────

export interface ComposerHeightInput {
  /** The text's own height (textarea scrollHeight with height:auto). */
  content: number
  min: number
  max: number
  /** Height the owner dragged the box to: it sticks (dictation scrolls inside it) until a double-click on the grip. */
  manual?: number | null
}

export function composerHeight({ content, min, max, manual }: ComposerHeightInput): number {
  const cap = Math.max(min, max)
  if (manual) return Math.round(Math.min(cap, Math.max(min, manual)))
  return Math.round(Math.max(min, Math.min(content, cap)))
}

/** Thread the box always leaves visible above it, so the header and the latest lines stay readable. */
export const COMPOSER_MIN_THREAD_PX = 140

/** The cap where the box is now: its height plus the thread's, minus the thread's minimum. */
export function composerRoom(boxHeight: number, threadHeight: number | null, min: number, max: number): number {
  const room = threadHeight === null ? Infinity : boxHeight + threadHeight - COMPOSER_MIN_THREAD_PX
  return Math.round(Math.max(min, Math.min(max, room)))
}

/** The tallest the box may get: about 450 px, but under half of what holds it, so the thread stays readable. */
export function composerMaxHeight(containerHeight: number, cap = 450): number {
  return Math.max(96, Math.min(cap, Math.round(containerHeight * 0.45)))
}
