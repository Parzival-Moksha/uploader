'use client'

// ░▒▓ CHARACTER RAIL BUTTON — the Character menu's button, always on the HUD's rail ▓▒░
// The owner, 2026-11-24: "time for a character menu, always on the screen, like in Diablo there is a char
// button." On the rail with Menu, World and Spells (the hud layer), opening the menu on its Character tab as K
// does, with his level underneath the way Agents shows who is here.

import { useEffect } from 'react'
import { persistCachedJson, refreshCachedJson, useCachedJson, warmCachedJson } from '@/lib/cached-json'
import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { closeCharacter, openCharacter, useCharacterState } from './character-store'
import { refreshKeychain } from './keychain-store'

const PROFILE_URL = '/api/profile'
persistCachedJson(PROFILE_URL)

/** The player's level, from the profile kept for the page (the Character menu reads the same one). */
function usePlayerLevel(menuOpen: boolean): number | null {
  const profile = useCachedJson<{ level?: unknown }>(PROFILE_URL, 60_000, 5 * 60_000)
  // Closing the menu reads again: XP may have come in while it was open.
  useEffect(() => { if (!menuOpen) void refreshCachedJson(PROFILE_URL, 10_000) }, [menuOpen])
  return typeof profile?.level === 'number' ? profile.level : null
}

/**
 * The menu's data read ahead once the village is idle, so the first open is instant:
 * the profile, Claude's usage and plan limits (asking Claude Code takes ~10 s the first time), the keychain.
 */
function useWarmCharacterMenu(): void {
  useEffect(() => {
    const cancelWarm = warmCachedJson([PROFILE_URL, '/api/claude-plan', '/api/claude-usage'], 8000)
    const keys = window.setTimeout(() => { void refreshKeychain() }, 12_000)
    return () => {
      cancelWarm()
      window.clearTimeout(keys)
    }
  }, [])
}

export function CharacterRailButton() {
  const { open } = useCharacterState()
  const level = usePlayerLevel(open)
  useWarmCharacterMenu()
  return (
    <GameMenuButton
      type="button"
      label="Character"
      sublabel={level === null ? undefined : `level ${level}`}
      marker="K"
      accent="#C4B5FD"
      active={open}
      aria-label="Character (K)"
      data-oasis-tooltip="Character (K)"
      title="Your character, your agents' skills and your keys (K)"
      data-rail-button="character"
      className="oasis-tooltip"
      onClick={() => (open ? closeCharacter() : openCharacter())}
    />
  )
}
