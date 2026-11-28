'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Profile loader (was the Profile button and its dropdown panel)
// The owner, 26 Nov: "quests and stat points: and then the old profile menu comes out... the same menu twice."
// The Character menu (village/CharacterMenu.tsx) is the one place for who you are now: picture, name, bio,
// body, level, vitals, stat points. What stays here is what the page needs at start, with no panel:
//   · the body you chose, put on as the page opens (from /api/profile);
//   · the daily login XP, claimed once a day;
//   · "open the profile" from anywhere (the main menu's Profile tile) opens the Character menu.
// The old panel's quest list is gone on purpose: quests are being redesigned with the Academy.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef } from 'react'
import { useOasisStore } from '@/store/oasisStore'
import { DEFAULT_PROFILE_AVATAR_3D_URL } from '@/lib/profile-defaults'
import { openCharacter } from '@/components/village/character-store'

interface ProfileStart {
  avatar_3d_url?: string | null
  lastLoginDate?: string | null
}

/** Mounted once in the Scene. `hideRailButton` is kept for the Scene's call; there is no button any more. */
export function ProfileButton(_props: { hideRailButton?: boolean } = {}) {
  const setAvatar3dUrl = useOasisStore(s => s.setAvatar3dUrl)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetch('/api/profile')
      .then(r => r.json() as Promise<ProfileStart>)
      .then(data => {
        if ('avatar_3d_url' in data) setAvatar3dUrl(data.avatar_3d_url || DEFAULT_PROFILE_AVATAR_3D_URL)
        // The daily login XP, at a low amount; the HUD shows the small gain.
        const today = new Date().toISOString().split('T')[0]
        if (data.lastLoginDate === today) return
        return fetch('/api/xp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'DAILY_LOGIN' }) })
          .then(r => r.json())
          .then(bonus => {
            if (bonus?.xp > 0) {
              window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: bonus }))
              window.dispatchEvent(new CustomEvent('oasis:profile-updated'))
            }
          })
      })
      .catch(() => {})
  }, [setAvatar3dUrl])

  // The main menu's Profile tile (and anything else that asks for the profile): the Character menu.
  useEffect(() => {
    const open = () => openCharacter('character')
    window.addEventListener('oasis:open-profile', open)
    return () => window.removeEventListener('oasis:open-profile', open)
  }, [])

  return null
}
