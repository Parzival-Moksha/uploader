'use client'

// The loading bar: 200 px at the bottom centre, and under it what is loading and what took long (the owner, 2026-11-24:
// "it'd be cool if it was like a 200px wide bar on the bottom center instead. and if it gave max info on whats being
// loaded. in megabytes or in type of asset or stuff, im just curious to see what takes so long at load time").
// The detail and the phase come from Perf's load-tracker.ts (agreed shape: getLoadSnapshot / subscribeLoad); the 3D
// loaders' count (world-load-progress.ts) still says a world is loading. When a load ends,
// a one-line summary with the slowest files stays a few seconds, then the bar leaves the page.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getWorldLoadState, subscribeWorldLoad, type WorldLoadState } from '../../lib/world-load-progress'
import { getLoadSnapshot, subscribeLoad, type LoadItem, type LoadKind, type LoadSnapshot } from '../../lib/load-tracker'
import { formatMb, slowest } from '../../lib/load-insight'

const KIND_LABEL: Record<LoadKind, string> = {
  world: 'world', model: 'model', texture: 'texture', sky: 'sky', avatar: 'avatar', animation: 'animation',
  audio: 'sound', ui: 'menu art', code: 'code', data: 'data', other: 'file',
}
const KIND_COLOUR: Record<LoadKind, string> = {
  world: '#fde68a', model: '#a78bfa', texture: '#7dd3fc', sky: '#f9a8d4', avatar: '#86efac', animation: '#fdba74',
  audio: '#c4b5fd', ui: '#e9cf8f', code: '#94a3b8', data: '#cbd5e1', other: '#cbd5e1',
}
const PHASE_LABEL = { page: 'the Oasis itself', world: 'the world', assets: 'models and textures', warming: 'warming up the scene', ready: 'ready' } as const
/** How long the summary stays after a load. */
const SUMMARY_MS = 5000

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`

function Kind({ kind }: { kind: LoadKind }) {
  return <span style={{ color: KIND_COLOUR[kind] }}>{KIND_LABEL[kind]}</span>
}

function SlowList({ items }: { items: LoadItem[] }) {
  if (!items.length) return null
  return (
    <div className="mt-0.5 flex flex-col items-center gap-[2px] text-[11px] leading-tight text-white/55" data-load-slowest="">
      {items.map(item => (
        <div key={item.id} className="flex max-w-[480px] gap-1.5 whitespace-nowrap">
          <span className="tabular-nums text-white/75">{seconds(item.endMs! - item.startMs)}</span>
          <Kind kind={item.kind} />
          <span className="truncate">{item.name}</span>
          {item.bytes ? <span className="tabular-nums text-white/45">{formatMb(item.bytes)}</span> : null}
        </div>
      ))}
    </div>
  )
}

export function WorldLoadingBar() {
  const [state, setState] = useState<WorldLoadState>(() => getWorldLoadState())
  useEffect(() => subscribeWorldLoad(setState), [])
  const snap = useSyncExternalStore(subscribeLoad, getLoadSnapshot, getLoadSnapshot)

  // After a load: the summary stays a few seconds.
  const [summary, setSummary] = useState<LoadSnapshot | null>(null)
  const wasLoading = useRef(false)
  // A world loading, or the tracker's load still going (it also sees the page itself and the scene warm-up).
  const loading = state.isLoading || state.progress < 1 || (snap.active && snap.phase !== 'ready')
  useEffect(() => {
    if (loading) { wasLoading.current = true; setSummary(null); return }
    if (!wasLoading.current) return
    wasLoading.current = false
    setSummary(getLoadSnapshot())
    const timer = window.setTimeout(() => setSummary(null), SUMMARY_MS)
    return () => window.clearTimeout(timer)
  }, [loading])

  if (!loading && !summary) return null

  const shown = summary ?? snap
  // Files done of the files known so far (more are found as the world unpacks: held under 97% until it is done); while
  // the scene warms up, its objects ready of waiting.
  const pct = !loading ? 1
    : shown.phase === 'warming' && shown.warm && shown.warm.total > 0 ? Math.min(0.99, shown.warm.done / shown.warm.total)
    : Math.max(0, Math.min(0.97, shown.itemsDone / Math.max(1, shown.itemsTotal)))
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  const lastEnd = shown.done.reduce((m, i) => Math.max(m, i.endMs ?? 0), shown.startedMs)
  const elapsed = (summary ? lastEnd : now) - shown.startedMs
  const current = summary ? null : shown.inFlight[0] ?? null
  const top = slowest(shown, 3)

  return (
    <div
      data-world-loading-bar=""
      data-world-loading-progress={pct.toFixed(3)}
      data-world-loading-legacy={state.total > 0 ? `${state.loaded}/${state.total}` : ''}
      data-world-loading-done={summary ? '1' : '0'}
      className="fixed bottom-[14px] left-1/2 z-[calc(var(--z-notice)_+_5)] flex -translate-x-1/2 flex-col items-center font-mono pointer-events-none select-none transition-opacity duration-700"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
    >
      <div className="flex items-center gap-2">
        <div className="h-[6px] w-[200px] overflow-hidden rounded-full border border-white/15 bg-black/55 backdrop-blur-sm">
          <div
            className="h-full rounded-full transition-[width] duration-150 ease-out"
            style={{
              width: `${pct * 100}%`,
              background: 'linear-gradient(90deg, rgba(34,211,238,0.85) 0%, rgba(167,139,250,0.95) 50%, rgba(244,114,182,0.9) 100%)',
              boxShadow: '0 0 8px rgba(167,139,250,0.7), 0 0 16px rgba(34,211,238,0.45)',
            }}
          />
        </div>
        <span className="w-[38px] text-[11px] tabular-nums text-cyan-100/85">{(pct * 100).toFixed(0)}%</span>
      </div>
      <div className="mt-1 rounded-md bg-black/45 px-2 py-1 text-center backdrop-blur-sm" style={{ minWidth: 240 }}>
        <div className="flex max-w-[520px] items-center justify-center gap-1.5 whitespace-nowrap text-[12px] leading-tight text-white/85" data-load-now="">
          {summary ? (
            <span>Loaded {shown.itemsDone} files · {formatMb(shown.bytesDone)} · {seconds(elapsed)}</span>
          ) : shown.phase === 'warming' && shown.warm ? (
            <span className="tabular-nums">{PHASE_LABEL.warming}: {shown.warm.done}/{shown.warm.total} · shaders and textures to the GPU</span>
          ) : (
            <>
              {current ? <><Kind kind={current.kind} /><span className="truncate">{current.name}</span>{current.bytesDone > 0 && current.bytes ? <span className="tabular-nums text-white/55">{formatMb(current.bytesDone)}/{formatMb(current.bytes)}</span> : null}<span className="text-white/35">·</span></> : null}
              <span className="tabular-nums">{formatMb(shown.bytesDone)}{shown.bytesTotal ? ` of ${formatMb(shown.bytesTotal)}` : ''}</span>
              <span className="text-white/35">·</span>
              <span className="tabular-nums">{shown.itemsDone}/{Math.max(shown.itemsTotal, shown.itemsDone)} files</span>
              <span className="text-white/35">·</span>
              <span className="tabular-nums">{seconds(elapsed)}</span>
            </>
          )}
        </div>
        {top.length > 0 && <div className="mt-1 text-[9.5px] uppercase tracking-[0.14em] text-white/40">{summary ? 'took longest' : 'slowest so far'}</div>}
        <SlowList items={top} />
      </div>
    </div>
  )
}
