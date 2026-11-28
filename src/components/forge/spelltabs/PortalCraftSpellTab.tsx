'use client'
// ░▒▓ PORTAL CRAFT WINDOW — Spells > Portal Craft ▓▒░
// Its own small window (the owner, 27 Nov: "a custom Select Portal pop-up", not the placing palette and its tabs),
// the same SpellTabFrame as the other spell windows, so it works on a phone too. Pick a style, pick where it leads,
// then place it: the ghost follows the crosshair like any placement.
//   Existing world: a two-way gate; placePortalGateAt puts the same style in that world, leading back.
//   New world: the world is made when the portal is put down (cancelling makes nothing), then the same two-way gate.
//     Locally it is the owner's own (private); on the hosted Oasis no visibility is sent, so the server's default for
//     new worlds applies (free for all, PvP on: OASIS_NEW_WORLD_VISIBILITY / OASIS_NEW_WORLD_PVP, the Innkeeper, 27 Nov).

import { useEffect, useState } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import { useClientOasisMode } from '../../../lib/oasis-mode-client'
import { PORTAL_GATE_VARIANT_DEFS } from '../../../lib/portal-gates'
import { SpellTabFrame } from './SpellTabFrame'
import { PortalCraftBody, type PortalCraftChoice } from './bodies/PortalCraftBody'

const SPELL_ID = 'portal-create'

export function PortalCraftSpellTab() {
  const [isOpen, setIsOpen] = useState(false)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const hosted = useClientOasisMode() === 'hosted'

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      setIsOpen(detail.spellId === SPELL_ID)
    }
    const onClose = () => setIsOpen(false)
    window.addEventListener('oasis:open-spelltab', onOpen as EventListener)
    window.addEventListener('oasis:close-spelltabs', onClose as EventListener)
    return () => {
      window.removeEventListener('oasis:open-spelltab', onOpen as EventListener)
      window.removeEventListener('oasis:close-spelltabs', onClose as EventListener)
    }
  }, [])

  // Fresh list when it opens (a world made elsewhere since).
  useEffect(() => { if (isOpen) useOasisStore.getState().refreshWorldRegistry() }, [isOpen])

  const activeWorldName = worldRegistry.find(world => world.id === activeWorldId)?.name || 'this world'
  const worlds = worldRegistry.map(world => ({ id: world.id, name: world.name, icon: world.icon }))

  const place = (choice: PortalCraftChoice) => {
    const style = PORTAL_GATE_VARIANT_DEFS.find(def => def.id === choice.variant)?.label || 'Portal'
    if (choice.destination.kind === 'existing') {
      const { worldId, worldName } = choice.destination
      enterPlacementMode({
        type: 'portal',
        name: `${style} to ${worldName}`,
        portalVariant: choice.variant,
        portalAction: { type: 'load_world', worldId, worldName },
        portalTargetWorldId: worldId,
        portalTargetWorldName: worldName,
        portalDirection: 'two-way',
      })
    } else {
      enterPlacementMode({
        type: 'portal',
        name: `${style} to ${choice.destination.name}`,
        portalVariant: choice.variant,
        portalDirection: 'two-way',
        portalNewWorld: { name: choice.destination.name, ...(hosted ? {} : { visibility: 'private' as const }) },
      })
    }
    setIsOpen(false)
  }

  return (
    <SpellTabFrame isOpen={isOpen} title="Portal Craft" spellId={SPELL_ID} accentColor="#6fe3ff" onClose={() => setIsOpen(false)}>
      <PortalCraftBody worlds={worlds} activeWorldId={activeWorldId} activeWorldName={activeWorldName} hosted={hosted} onPlace={place} />
    </SpellTabFrame>
  )
}
