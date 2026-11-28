'use client'

// Settings > Misc: the copy you run, how many commits are past it, and one big button to build the new version
// beside it (src/lib/oasis-update-client.ts). When the new copy is built and proven, the rail's "New version
// ready" button flashes on the main screen; this card offers the same switch.

import { useEffect, useState, type ReactNode } from 'react'

import { agoText, pokeUpdatePolling, startUpdatePolling, upgradeReady, useOasisUpdate } from '@/lib/oasis-update-client'

const PHASE_TEXT: Record<string, string> = {
  building: 'Building the new version beside the one you run. Keep playing: a button flashes on your screen when it is ready.',
  proving: 'Built. Trying it on the side before it is offered to you.',
  swapping: 'Switching to the new version...',
}

/** `fallback`: shown where no update route answers (an older package, before the package half exists). */
export function OasisUpdateSection({ fallback = null }: { fallback?: ReactNode }) {
  const status = useOasisUpdate(s => s.status)
  const local = useOasisUpdate(s => s.local)
  const localError = useOasisUpdate(s => s.localError)
  const build = useOasisUpdate(s => s.build)
  const switchNow = useOasisUpdate(s => s.switchNow)
  // What the last press said when it could not start a build (the owner, 27 Nov 21:08: the first press gave no sign).
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => startUpdatePolling(), [])
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 6000); return () => window.clearTimeout(t) }, [note])
  if (!status) return <>{fallback}</>

  const running = status.running
  const count = status.newer?.count ?? 0
  const active = status.phase === 'building' || status.phase === 'proving' || status.phase === 'swapping' || local === 'starting' || local === 'switching'
  const ready = upgradeReady(status)
  const canBuild = !active && !ready && !status.busy && (status.newer !== null || status.kind === 'package')
  const error = local === 'failed' ? localError : status.phase === 'failed' ? status.error : null

  return (
    <section className="border-t border-white/10 pt-3" data-setting="oasis-update">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Version</div>
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 space-y-2">
        <div className="text-[11px] text-gray-200">
          {running?.commit
            ? <>You run commit <span className="font-mono font-medium text-white">{running.commit}</span>{running.at && <>, built {agoText(running.at)}</>}</>
            : <>You run <span className="font-medium text-white">{running?.label || 'this copy'}</span></>}
        </div>
        <div className="text-[11px]" data-update-newer>
          {status.newer
            ? <span className="text-amber-200">{status.newer.label || `${count} newer commits`}</span>
            : <span className="text-emerald-300">Up to date.</span>}
          {status.kind === 'village' && <span className="text-[9px] text-gray-500"> (commits only; changes not yet committed are not counted)</span>}
        </div>

        {ready ? (
          <button
            type="button"
            onClick={() => { void switchNow() }}
            disabled={local === 'switching'}
            data-update-switch
            className="animate-pulse w-full rounded-lg border-2 border-emerald-300/70 bg-emerald-400/15 px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-60"
          >
            {local === 'switching' ? 'Switching... back in a few seconds' : `Switch to the new version${status.ready?.commit ? ` (${status.ready.commit})` : ''}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              // Never a dead button: a press either starts the build (Building at once) or says why it does not.
              if (active || status.busy) { setNote(`Already building${status.startedAt ? ` (started ${agoText(status.startedAt)})` : ''}: the Upgrade button pulses when it is ready.`); return }
              if (!canBuild) { setNote('Nothing newer to build: you run the newest commit.'); return }
              setNote(null)
              void build().then(pokeUpdatePolling)
            }}
            aria-disabled={!canBuild}
            data-update-build
            className="w-full rounded-lg border-2 border-sky-300/60 bg-gradient-to-b from-sky-400/25 to-indigo-500/20 px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-sky-50 shadow-[0_0_18px_rgba(125,211,252,0.25)] transition hover:from-sky-400/40 hover:shadow-[0_0_26px_rgba(125,211,252,0.45)] active:scale-[0.98] aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:shadow-none"
          >
            {active ? 'Building...' : canBuild ? 'Build the new version' : 'Up to date'}
          </button>
        )}

        {PHASE_TEXT[status.phase] && (
          <div className="text-[10px] text-gray-300">
            {PHASE_TEXT[status.phase]}
            {status.step && <> <span className="text-gray-500">({status.step}{status.startedAt ? `, started ${agoText(status.startedAt)}` : ''})</span></>}
          </div>
        )}
        {note && <div className="text-[10px] text-sky-200" data-update-note>{note}</div>}
        {error && <div className="text-[10px] text-red-300" data-update-error>{error}</div>}
      </div>
    </section>
  )
}
