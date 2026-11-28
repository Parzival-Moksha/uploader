'use client'

// Settings > Misc: "Only what ships" (src/lib/only-what-ships.ts). Shown only in an Oasis that has the switch
// (the owner's repository); the package and the hosted Oasis ship everything they have.

import { useEffect, useState } from 'react'

import { KitToggle } from '@/components/ui-kit'
import { setOnlyWhatShips, syncOnlyWhatShips, type OnlyWhatShipsState } from '@/lib/only-what-ships'

function summary(state: OnlyWhatShipsState): string {
  const count = (re: RegExp) => state.leftOut.filter(f => re.test(f)).length
  const parts = [
    [count(/^\/avatars\/.*\.vrm$/), 'avatars'],
    [count(/^\/models\/.*\.(glb|gltf)$/), 'models'],
    [count(/^\/animations\/.*\.fbx$/), 'Mixamo clips'],
    [count(/^\/audio\/.*\.(mp3|ogg|wav)$/), 'sounds and tracks'],
  ].filter(([n]) => Number(n) > 0).map(([n, what]) => `${n} ${what}`)
  const standIns = Object.keys(state.standIns).filter(f => /\.(vrm|glb|gltf)$/.test(f)).length
  return `${parts.join(', ')} stay on this PC only; ${standIns} your worlds or agents use show a shipped stand-in, the rest are missing, as for anyone who installs it.`
}

export function OnlyWhatShipsSection() {
  const [state, setState] = useState<OnlyWhatShipsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void syncOnlyWhatShips(true).then(setState) }, [])
  if (!state?.applies) return null
  const forced = state.on !== state.switchOn
  return (
    <section className="border-t border-white/10 pt-3" data-setting="only-what-ships">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">The package</div>
      <KitToggle
        checked={state.switchOn}
        disabled={busy}
        onChange={() => {
          setBusy(true)
          setError('')
          setOnlyWhatShips(!state.switchOn)
            .then(() => window.location.reload())
            .catch(e => { setError((e as Error).message); setBusy(false) })
        }}
        label="Only what ships"
        hint={state.switchOn
          ? `Your Oasis offers and plays what the public package ships. ${state.on ? summary(state) : ''}`.trim()
          : 'Off: everything on this PC, including the models, avatars, clips and sounds the package leaves out. The page reloads when you switch.'}
      />
      {forced && <div className="mt-1 text-[9px] text-amber-300/80">This browser has its own setting (the cookie oasis-only-what-ships={state.on ? 'on' : 'off'}).</div>}
      {state.problems.length > 0 && <div className="mt-1 text-[9px] text-amber-300/80">{state.problems.slice(0, 3).join(' · ')}</div>}
      {error && <div className="mt-1 text-[9px] text-red-300">{error}</div>}
    </section>
  )
}
