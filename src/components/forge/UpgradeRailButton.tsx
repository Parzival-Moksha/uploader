'use client'

// The rail's Upgrade button (the owner, 27 Nov: "flashing on my main screen... Something the same size as the build
// button on the top left. And when I hit it, that's when it all reloads."). Always the way in when there is something
// to do (Anorak, 27 Nov 15:46: he stood in Settings > Misc and could not find it):
//   commits wait            "Upgrade · 10 newer: build"   a press starts the build beside the running copy
//   building / proving      "Building · ..."              not pulsing; nothing to press
//   a proven copy waits     "Upgrade · new version ready" pulsing; a press swaps and reloads
//   it failed               "Upgrade failed · ..."        red; the title says why; a press tries the build again
// Nothing waiting (up to date) or no update route (the hosted Oasis, an older copy): no button.

import { useEffect } from 'react'

import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { pokeUpdatePolling, startUpdatePolling, upgradeReady, useOasisUpdate } from '@/lib/oasis-update-client'

export function UpgradeRailButton() {
  const status = useOasisUpdate(s => s.status)
  const local = useOasisUpdate(s => s.local)
  const localError = useOasisUpdate(s => s.localError)
  const switchNow = useOasisUpdate(s => s.switchNow)
  const build = useOasisUpdate(s => s.build)
  useEffect(() => startUpdatePolling(), [])

  if (!status) return null
  const ready = upgradeReady(status)
  const switching = local === 'switching' || status.phase === 'swapping'
  const building = local === 'starting' || status.phase === 'building' || status.phase === 'proving'
  const failed = (local === 'failed' && localError) || (status.phase === 'failed' && status.error) || ''
  const count = status.newer?.count ?? 0

  if (ready || switching) {
    return (
      <GameMenuButton
        label={switching ? 'Upgrading' : 'Upgrade'}
        sublabel={switching ? 'back in seconds' : 'new version ready'}
        accent="#34D399"
        active={!switching}
        disabled={switching}
        aria-label="A new version of the Oasis is ready: switch to it"
        title={`Switch to the new version${status.ready?.commit ? ` (commit ${status.ready.commit})` : ''}: the page reloads in a few seconds`}
        data-rail-button="upgrade"
        data-upgrade-state={switching ? 'switching' : 'ready'}
        className={switching ? '' : 'animate-pulse'}
        onClick={() => { if (!switching) void switchNow() }}
      />
    )
  }
  if (building) {
    return (
      <GameMenuButton
        label="Building"
        sublabel={status.phase === 'proving' ? 'checking it' : `${count ? `${count} newer` : 'new version'}`}
        accent="#7DD3FC"
        disabled
        aria-label="The new version is being built beside the one you run"
        title={status.step || 'Building the new version beside the one you run. Keep playing: this button pulses when it is ready.'}
        data-rail-button="upgrade"
        data-upgrade-state="building"
      />
    )
  }
  if (failed) {
    return (
      <GameMenuButton
        label="Upgrade failed"
        sublabel={count ? 'press to try again' : 'see Settings'}
        accent="#F87171"
        aria-label="The upgrade failed"
        title={failed}
        data-rail-button="upgrade"
        data-upgrade-state="failed"
        onClick={() => { if (count) void build().then(pokeUpdatePolling) }}
      />
    )
  }
  if (count > 0 && !status.busy) {
    return (
      <GameMenuButton
        label="Upgrade"
        sublabel={`${count} newer: build`}
        accent="#7DD3FC"
        aria-label={`${count} newer commits: build the new version`}
        title={`${status.newer?.label || `${count} newer commits`} since the copy you run: build the new version beside it (you keep playing; this button pulses when it is ready)`}
        data-rail-button="upgrade"
        data-upgrade-state="newer"
        onClick={() => { void build().then(pokeUpdatePolling) }}
      />
    )
  }
  return null
}
