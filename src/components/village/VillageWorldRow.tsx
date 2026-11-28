'use client'

// ░▒▓ VILLAGE WORLD ROW — Settings > Agents: do agents live in one world, or come with the owner? ▓▒░
// The owner (2026-11-20): "I just kinda wanna have it A/B… for most people, including me, it will make more sense for
// agents to chill in one world… one agent only could exist in one world, except if I specifically request it."
//   Agents live in one world (default): each agent is in its own world (village-worlds.ts): its own home, else the
//   village's world. Agents set to "Follow across worlds" (Anorak) still come along.
//   Agents come with me: everyone appears wherever he is (as before 2026-11-20).
// 27 Nov: choosing "one world" set the village's world to the world he stood in (a brand-new private world), and the
// whole village moved there. Now choosing it takes the world the agents' homes are in; the village's world is shown
// by name, and moving it to the world he is in is its own button.

import { useState } from 'react'
import { KitButton, KitTabs } from '@/components/ui-kit'
import { useOasisStore } from '../../store/oasisStore'
import { isStageWorldName } from '../../lib/village/village-stage'
import { showNotice } from '../forge/GlobalNotice'
import { currentVillageWorld, getVillageHomesFile, setVillageWorld } from './village-homes'
import { useVillageWorldsVersion, villageHomeWorld, villageWorldName } from './village-worlds'
import { VILLAGE_EVERYWHERE } from '../../lib/village/village-worlds'

type Mode = 'one' | 'with'

export function VillageWorldRow() {
  useVillageWorldsVersion()
  const [busy, setBusy] = useState(false)
  const worldName = useOasisStore(s => s.worldRegistry.find(entry => entry.id === (s.viewingWorldId || s.activeWorldId))?.name || '')
  const village = getVillageHomesFile().villageWorld
  // Unset is one world too (the page sets it to the world the agents' homes are in); "with" is a choice.
  const mode: Mode = village === VILLAGE_EVERYWHERE ? 'with' : 'one'
  const here = currentVillageWorld()
  const hereIsStage = !here || isStageWorldName(worldName)
  const save = (world: string) => {
    setBusy(true)
    setVillageWorld(world)
      .catch(error => showNotice(`Could not change it: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  const choose = (next: Mode) => {
    if (busy || next === mode) return
    if (next === 'with') { save(VILLAGE_EVERYWHERE); return }
    // One world: where their homes are, not where he happens to stand (only a fresh Oasis takes this world).
    const world = villageHomeWorld() ?? (hereIsStage ? null : here)
    if (!world) { showNotice('Go to the world they should live in first.', 'warn'); return }
    save(world)
  }
  const elsewhere = mode === 'one' && village && village !== here && !hereIsStage
  return (
    <div className="py-1.5" data-village-world={village === VILLAGE_EVERYWHERE ? 'with-me' : village || 'one'}>
      <KitTabs<Mode>
        tabs={[
          { id: 'one', label: 'Agents live in one world', title: 'Each agent stays in its world; the Agents menu reaches it from anywhere' },
          { id: 'with', label: 'Agents come with me', title: 'Everyone appears wherever you are' },
        ]}
        active={mode}
        onChange={choose}
      />
      <div className="kit-hint mt-1">
        {mode === 'with'
          ? 'Everyone appears wherever you are.'
          : `They live in ${village ? villageWorldName(village) : 'the world their homes are in'}: each agent in its own home world if it has one, the others there. Only agents with "Follow across worlds" on (Anorak) come along when you change worlds. From any world the Agents menu reaches the others: Call here or Go there.`}
      </div>
      {elsewhere && (
        <div className="mt-1.5">
          <KitButton
            onClick={() => { if (!busy && here) save(here) }}
            title={`The agents without a home of their own move from ${villageWorldName(village)} to ${worldName || 'this world'}`}
          >
            Move them to {worldName || 'this world'}
          </KitButton>
        </div>
      )}
    </div>
  )
}
