// ░▒▓ FIRST RUN — a newcomer's own sessions, already standing in the village ▓▒░
// The owner on his packaged copy (2026-11-22): "there's nothing warm about the Oasis", "the entire Oasis was empty".
// So the first minute brings in something they already have: the Claude Code sessions found on this machine, a
// handful, most recent first, one per folder, as characters they can walk up to and read (watched: no process, no
// tokens). "Talk to it here" carries one on. Pure, tested in src/lib/__tests__/first-run.test.ts.

import type { EngineSessionMeta } from '../agent-engine-types'

/** How many sessions a first run brings in. */
export const FIRST_RUN_SESSIONS = 4
const NAME_MAX = 48

function folderName(cwd: string | null | undefined): string {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** The newest sessions, one per folder, that are not in the village already and have a folder to resume in. */
export function pickFirstSessions(sessions: EngineSessionMeta[], count = FIRST_RUN_SESSIONS): EngineSessionMeta[] {
  const seen = new Set<string>()
  const out: EngineSessionMeta[] = []
  for (const session of [...sessions].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))) {
    if (out.length >= count) break
    if (!session.cwd || session.ownedBy || session.observedBy || !session.path) continue
    const folder = session.cwd.trim().replace(/[\\/]+$/, '').toLowerCase()
    if (seen.has(folder)) continue
    seen.add(folder)
    out.push(session)
  }
  return out
}

/** Titles a person or Claude gave the session; the engine's fallback to the first prompt is not one of them. */
const REAL_TITLE = new Set(['custom-title', 'custom-title.json', 'summary', 'agent-name'])

/**
 * "my-app: Fix the login redirect": its folder's name and what it was about, short enough for a name tag. The tag
 * floats in the world (on screen, in screenshots and in the pictures sent with agent turns), so only a real title is
 * used, never a raw first prompt (it can be a pasted key or a private line), and anything key-shaped is cut out.
 */
export function firstRunName(session: Pick<EngineSessionMeta, 'cwd' | 'title' | 'titleSource'>): string {
  const folder = folderName(session.cwd) || 'session'
  const real = session.titleSource && REAL_TITLE.has(session.titleSource) ? String(session.title || '') : ''
  const about = real.replace(/[A-Za-z0-9_\-]{20,}/g, ' ').replace(/\s+/g, ' ').trim()
  const name = about && about.toLowerCase() !== folder.toLowerCase() ? `${folder}: ${about}` : folder
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name
}

/** What the first run did on this browser: brought sessions in, found none, or nothing yet. */
export interface FirstRunState {
  /** When it ran; 0: not yet. */
  at: number
  /** Sessions it brought in (0: none found, the guide comes first). */
  brought: number
  /** The greeting line was closed (a click on it, or the first agent opened). */
  greeted: boolean
}

export const FIRST_RUN_NONE: FirstRunState = { at: 0, brought: 0, greeted: false }

export function parseFirstRun(raw: string | null): FirstRunState {
  try {
    const value = JSON.parse(raw || 'null') as Partial<FirstRunState> | null
    if (!value || typeof value.at !== 'number') return FIRST_RUN_NONE
    return { at: value.at, brought: Number(value.brought) || 0, greeted: value.greeted === true }
  } catch {
    return FIRST_RUN_NONE
  }
}

/** Should this page bring sessions in now? Only a village that never had an agent, once per browser. */
export function shouldBringSessions(state: FirstRunState, connected: boolean, agentCount: number): boolean {
  return connected && agentCount === 0 && state.at === 0
}

/** The greeting line, or '' when it has nothing to say. */
export function greetingLine(state: FirstRunState): string {
  if (!state.at || state.greeted) return ''
  return state.brought > 0
    ? `Your Claude Code sessions are standing in the village. Walk up to one and press E to read what it last did; "Talk to it here" carries it on.`
    : `Welcome to the Oasis: your coding agents (Claude Code, Codex), as people you can walk up to. Start with a guide: Agents, top left.`
}
