'use client'

// ░▒▓ PARTY COMBAT LAYER — what a hit on a player looks like, on every screen in the room ▓▒░
// Under party rules (the room server's OASIS_ROOM_PARTY_COMBAT, set by scripts/party-server.mjs) the room
// broadcasts every landed hit on a player. Each page shows it the way the village shows a hit on an agent:
// the flinch, or on a lethal hit a six-second knock-down (lib/village/village-combat.ts, id `pvp:<sessionId>`;
// remote bodies in RemoteVRMAvatar, our own in PlayerAvatar), and the blood (VillageGore, mounted at the
// first hit so a room without fights pays nothing). Nothing here decides damage: the room does.

import { useEffect, useState } from 'react'

import { getLatestPlayers, onPlayerHit, onRespawn } from '@/lib/pvp-bridge'
import { clearRoomDown, showRoomHit } from '@/lib/village/village-combat'
import { VillageGore } from '@/components/village/VillageGore'

export function PartyCombatLayer() {
  const [gore, setGore] = useState(false)

  useEffect(() => {
    const offHit = onPlayerHit(event => {
      const feet = getLatestPlayers().find(player => player.sessionId === event.victimId)?.position
      showRoomHit(`pvp:${event.victimId}`, {
        amount: event.damage,
        hp: event.hp,
        lethal: event.lethal,
        at: event.at,
        ground: feet ? feet[1] : null,
        from: event.from,
      })
      setGore(true)
    })
    const offRespawn = onRespawn(event => {
      if (event.soft && event.sessionId) clearRoomDown(`pvp:${event.sessionId}`)
    })
    return () => { offHit(); offRespawn() }
  }, [])

  return gore ? <VillageGore /> : null
}
