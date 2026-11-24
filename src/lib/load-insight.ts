// What is loading, and what took long: the data behind the loading bar (WorldLoadingBar.tsx). Owned by Hipster.
//
// The owner, 2026-11-24: "it'd be cool if it was like a 200px wide bar on the bottom center instead. and if it gave max
// info on whats being loaded. in megabytes or in type of asset or stuff, im just curious to see what takes so long".
//
// The shape (LoadSnapshot) is agreed with Perf, whose src/lib/load-tracker.ts will export the same getLoadSnapshot,
// subscribeLoad and types (with bytes as they arrive, the phase and the warm-up count); the bar then imports that instead.
// Until then this file fills the shape from two sources the browser already has:
//   - THREE.DefaultLoadingManager's itemStart / itemEnd (every GLTF, texture, HDR, VRM and FBX the 3D view loads): what
//     is in flight right now, and how many items this load has.
//   - PerformanceObserver('resource'): every finished request with its size (encodedBodySize, the bytes on the wire
//     before decompression is not available cross-origin, so 0 there) and its time.
// A load begins at page start, and again when something starts loading after a second of quiet (a world opening).

import * as THREE from 'three'

export type LoadKind = 'world' | 'model' | 'texture' | 'sky' | 'avatar' | 'animation' | 'audio' | 'ui' | 'code' | 'data' | 'other'
/** page: the app itself; world: its data; assets: models, textures, skies; warming: shaders and GPU uploads; ready. */
export type LoadPhase = 'page' | 'world' | 'assets' | 'warming' | 'ready'

export interface LoadItem {
  url: string
  name: string
  kind: LoadKind
  /** Bytes over the wire when finished (null while in flight, or unknown). */
  bytes: number | null
  /** Bytes arrived so far (mid-file when the loader streams; else 0 until finished). */
  bytesDone: number
  /** performance.now() times. */
  startMs: number
  endMs: number | null
}

export interface LoadSnapshot {
  /** A load is in progress. */
  active: boolean
  startedMs: number
  /** Started, not finished; newest first. */
  inFlight: LoadItem[]
  /** Finished in this load. */
  done: LoadItem[]
  bytesDone: number
  /** Not known ahead of time (files announce their size only as they arrive). */
  bytesTotal: number | null
  itemsDone: number
  itemsTotal: number
  phase: LoadPhase
  /** The scene warm-up's objects ready out of waiting (phase 'warming'), else null. */
  warm: { done: number; total: number } | null
}

/** The kind of a file, from its URL. */
export function loadKind(url: string): LoadKind {
  const u = url.toLowerCase().split('?')[0]
  if (u.includes('/animations/')) return 'animation'
  if (u.endsWith('.vrm') || u.includes('/avatars/')) return 'avatar'
  if (u.endsWith('.hdr') || u.endsWith('.exr') || u.includes('/skies/') || u.includes('/sky/')) return 'sky'
  if (/\.(glb|gltf|fbx|obj|ply|splat|ksplat)$/.test(u)) return 'model'
  if (/\.(png|jpe?g|webp|avif|ktx2|basis|gif|svg)$/.test(u)) return 'texture'
  if (/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/.test(u)) return 'audio'
  if (u.includes('/ui/')) return 'ui'
  if (u.includes('/_next/') || /\.(js|mjs|css|wasm)$/.test(u)) return 'code'
  if (u.includes('/api/worlds') || u.includes('world.json')) return 'world'
  if (u.includes('/api/') || u.endsWith('.json')) return 'data'
  return 'other'
}

/** A file's short name: its last path part, decoded, without the query, at most 32 characters. */
export function loadName(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  const last = path.split('/').filter(Boolean).pop() || path
  let name = last
  try { name = decodeURIComponent(last) } catch { /* keep it */ }
  return name.length > 32 ? `${name.slice(0, 14)}…${name.slice(-17)}` : name
}

export function formatMb(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / 1_000_000
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

/** What the browser's resource timing gives us per finished request. */
export interface ResourceLike { name: string; startTime: number; responseEnd: number; encodedBodySize?: number; transferSize?: number }

export function buildSnapshot(input: { active: boolean; startedMs: number; entries: ResourceLike[]; inFlightUrls: string[]; inFlightStarts?: number[]; itemsTotal: number; nowMs: number }): LoadSnapshot {
  const done: LoadItem[] = input.entries
    .filter(e => e.startTime >= input.startedMs)
    .map(e => { const bytes = e.encodedBodySize || e.transferSize || 0; return { url: e.name, name: loadName(e.name), kind: loadKind(e.name), bytes, bytesDone: bytes, startMs: e.startTime, endMs: e.responseEnd } })
  const inFlight: LoadItem[] = input.inFlightUrls.map((url, i) => ({ url, name: loadName(url), kind: loadKind(url), bytes: null, bytesDone: 0, startMs: input.inFlightStarts?.[i] ?? input.nowMs, endMs: null }))
  inFlight.sort((a, b) => b.startMs - a.startMs)
  const bytesDone = done.reduce((sum, item) => sum + (item.bytes || 0), 0)
  return {
    active: input.active,
    startedMs: input.startedMs,
    inFlight,
    done,
    bytesDone,
    bytesTotal: null,
    itemsDone: done.length,
    itemsTotal: Math.max(input.itemsTotal, done.length + inFlight.length),
    // The stand-in sees only the 3D loaders: in flight is 'assets'. Perf's tracker knows page, world and warming too.
    phase: inFlight.length ? 'assets' : (input.active ? 'assets' : 'ready'),
    warm: null,
  }
}

/** The slowest finished items, longest first. */
export function slowest(s: LoadSnapshot, n: number): LoadItem[] {
  return s.done.filter(i => i.endMs !== null).slice().sort((a, b) => (b.endMs! - b.startMs) - (a.endMs! - a.startMs)).slice(0, n)
}

// ── in the browser ───────────────────────────────────────────────────────────────────────────

interface Store {
  installed: boolean
  entries: ResourceLike[]
  inFlight: Map<string, number>
  startedMs: number
  managerItems: number
  lastActivityMs: number
  snapshot: LoadSnapshot
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | null
}
const KEY = '__oasisLoadInsight'
const g = globalThis as Record<string, unknown>
const store: Store = (g[KEY] as Store | undefined) ?? (g[KEY] = {
  installed: false, entries: [], inFlight: new Map(), startedMs: 0, managerItems: 0, lastActivityMs: 0,
  snapshot: buildSnapshot({ active: false, startedMs: 0, entries: [], inFlightUrls: [], itemsTotal: 0, nowMs: 0 }),
  listeners: new Set(), timer: null,
} as Store)

/** A second of quiet ends a load; the next start begins a new one. */
const QUIET_MS = 1000
const MAX_ENTRIES = 4000

function recompute() {
  const now = performance.now()
  const urls = [...store.inFlight.keys()]
  store.snapshot = buildSnapshot({
    active: urls.length > 0,
    startedMs: store.startedMs,
    entries: store.entries,
    inFlightUrls: urls,
    inFlightStarts: urls.map(u => store.inFlight.get(u) ?? now),
    itemsTotal: store.managerItems,
    nowMs: now,
  })
}

/** At most ten updates a second to the bar. */
function changed() {
  if (store.timer) return
  store.timer = setTimeout(() => {
    store.timer = null
    recompute()
    store.listeners.forEach(fn => fn())
  }, 100)
}

function noteStart(url: string) {
  const now = performance.now()
  if (store.inFlight.size === 0 && now - store.lastActivityMs > QUIET_MS && store.lastActivityMs > 0) {
    // A new load (a world opening): count from here.
    store.startedMs = now
    store.managerItems = 0
  }
  store.lastActivityMs = now
  store.inFlight.set(url, now)
  store.managerItems += 1
  changed()
}

function noteEnd(url: string) {
  store.inFlight.delete(url)
  store.lastActivityMs = performance.now()
  changed()
}

export function installLoadInsight(): void {
  if (store.installed || typeof window === 'undefined' || typeof performance === 'undefined') return
  store.installed = true
  const mgr = THREE.DefaultLoadingManager as THREE.LoadingManager & { itemStart: (url: string) => void; itemEnd: (url: string) => void; itemError: (url: string) => void }
  const start = mgr.itemStart.bind(mgr)
  const end = mgr.itemEnd.bind(mgr)
  const error = mgr.itemError.bind(mgr)
  mgr.itemStart = (url: string) => { try { noteStart(url) } catch { /* never break a load */ } start(url) }
  mgr.itemEnd = (url: string) => { try { noteEnd(url) } catch { /* never break a load */ } end(url) }
  mgr.itemError = (url: string) => { try { noteEnd(url) } catch { /* never break a load */ } error(url) }
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver(list => {
        for (const e of list.getEntries() as PerformanceResourceTiming[]) {
          store.entries.push({ name: e.name, startTime: e.startTime, responseEnd: e.responseEnd, encodedBodySize: e.encodedBodySize, transferSize: e.transferSize })
        }
        if (store.entries.length > MAX_ENTRIES) store.entries.splice(0, store.entries.length - MAX_ENTRIES)
        changed()
      })
      observer.observe({ type: 'resource', buffered: true })
    } catch { /* an old browser: in-flight names only */ }
  }
}

export function getLoadSnapshot(): LoadSnapshot {
  return store.snapshot
}

export function subscribeLoad(fn: () => void): () => void {
  installLoadInsight()
  store.listeners.add(fn)
  return () => { store.listeners.delete(fn) }
}
