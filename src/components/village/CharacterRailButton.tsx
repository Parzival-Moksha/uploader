'use client'

// ░▒▓ CHARACTER RAIL BUTTON — the Character menu's button, always on the HUD's rail ▓▒░
// The owner, 2026-11-24: "time for a character menu, always on the screen, like in Diablo there is a char
// button." On the rail with Menu, World and Spells (the hud layer), opening the menu on its Character tab as K
// does, with his level underneath the way Agents shows who is here.

import { useEffect, useState } from 'react'
import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { closeCharacter, openCharacter, useCharacterState } from './character-store'

/** The player's level, read when the page opens, when the window is looked at again, and every few minutes. */
function usePlayerLevel(menuOpen: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)
  useEffect(() => {
    let gone = false
    const read = () => {
      fetch('/api/profile', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .then((data: { level?: unknown } | null) => {
          if (!gone && data && typeof data.level === 'number') setLevel(data.level)
        })
        .catch(() => { /* the button works without it */ })
    }
    const timer = window.setInterval(read, 5 * 60_000)
    window.addEventListener('focus', read)
    return () => {
      gone = true
      window.clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [])
  // On mount, and again on closing the menu: XP may have come in while it was open.
  useEffect(() => {
    if (menuOpen) return
    fetch('/api/profile', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: { level?: unknown } | null) => { if (data && typeof data.level === 'number') setLevel(data.level) })
      .catch(() => {})
  }, [menuOpen])
  return level
}

export function CharacterRailButton() {
  const { open } = useCharacterState()
  const level = usePlayerLevel(open)
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
