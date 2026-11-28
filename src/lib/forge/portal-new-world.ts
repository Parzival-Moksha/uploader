// A Portal Craft portal to a new world (src/components/forge/spelltabs/PortalCraftSpellTab.tsx): the world is made when
// the portal is put down, so cancelling the placement leaves no empty world behind, and the portal is then an ordinary
// two-way gate to it (placePortalGateAt puts the same style in the new world, leading back). The owner, 27 Nov: the
// old create-world gates made a world at every walk-through and left no way back.

import { createWorld, type WorldMeta } from './world-persistence'
import { useOasisStore } from '../../store/oasisStore'
import type { PortalGateVariant } from '../portal-gates'
import { showNotice } from '../../components/forge/GlobalNotice'

export interface PortalNewWorld {
  name: string
  /** Locally 'private' (the owner's own); left out on the hosted Oasis, where the server's default applies. */
  visibility?: WorldMeta['visibility']
}

export async function placePortalToNewWorld(args: { variant: PortalGateVariant; world: PortalNewWorld; position: [number, number, number] }): Promise<string | null> {
  const store = useOasisStore.getState()
  // One world per placement: the ghost goes at once, so a second click cannot make a second world.
  store.cancelPlacement()
  try {
    const meta = await createWorld(args.world.name.trim() || 'New World', '🌀', args.world.visibility ? { visibility: args.world.visibility } : {})
    useOasisStore.getState().refreshWorldRegistry()
    return useOasisStore.getState().placePortalGateAt({
      variant: args.variant,
      action: { type: 'load_world', worldId: meta.id, worldName: meta.name },
      direction: 'two-way',
      position: args.position,
    })
  } catch (err) {
    showNotice(`The new world could not be made: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    return null
  }
}
