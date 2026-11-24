// ░▒▓ LOAD TRACKER — what is loading now, bytes done of total, by kind (for the loading bar) ▓▒░
// One snapshot the loading bar reads (Hipster's shape, agreed 24 Nov): what is in flight (newest first),
// what finished in this load (with its end time), bytes done of total, the phase, and the scene
// warm-up's progress. Sources, installed once by installLoadTracker():
// - fetch (world data, models, avatars, animations, sounds, skies fetched as files): bytes counted as
//   they arrive. The same model or avatar file asked for twice (a second loader cache key such as
//   `#vrm-player` or `?copy=2`, or two at once) is downloaded once and handed out as separate copies,
//   (measured 24 Nov: 26 avatars, 189 MB, three fetched twice; after, 163 MB in 26).
// - three's DefaultLoadingManager: what is in flight for loaders that do not use fetch (images).
// - resource timing: bytes of images, stylesheets and script chunks once they are in.
// - the scene warm-up (src/lib/forge/scene-warmup.ts): reportWarm().

import * as THREE from 'three'

export type LoadKind = 'world' | 'model' | 'texture' | 'sky' | 'avatar' | 'animation' | 'audio' | 'code' | 'data' | 'ui' | 'other'
export type LoadPhase = 'page' | 'world' | 'assets' | 'warming' | 'ready'

export interface LoadItem {
  id: number
  url: string
  name: string
  kind: LoadKind
  /** The whole size when known (null: not known yet). */
  bytes: number | null
  /** Bytes in so far (equal to bytes once done). Images report only when done. */
  bytesDone: number
  /** performance.now() */
  startMs: number
  endMs: number | null
}

export interface LoadSnapshot {
  active: boolean
  phase: LoadPhase
  startedMs: number
  /** Started, not done; newest first. */
  inFlight: LoadItem[]
  /** Finished in this load, in the order they finished. */
  done: LoadItem[]
  bytesDone: number
  /** null while an item in flight has no known size. */
  bytesTotal: number | null
  itemsDone: number
  itemsTotal: number
  /** The scene warm-up: objects ready of those waiting, while it works. */
  warm: { done: number; total: number } | null
}

/** A load ends after this long with nothing in flight; the next item starts a new one. */
export const LOAD_IDLE_MS = 3000
/** A ceiling, not a queue in practice: the dev server serves each file at about 1 MB/s, so fewer at once was slower (24 Nov). */
export const MAX_PARALLEL_BINARY = 32
const NOTIFY_MS = 100

// ── Pure parts ──────────────────────────────────────────────────────────────────────────────────

function pathOf(url: string): string {
  return url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('#')[0].split('?')[0].toLowerCase()
}

export function kindOfUrl(url: string): LoadKind {
  const p = pathOf(url)
  if (/^\/api\/worlds?\//.test(p) || p === '/api/worlds') return 'world'
  if (p.startsWith('/_next/')) return 'code'
  if (p.startsWith('/api/')) return 'data'
  if (/\.vrm$/.test(p)) return 'avatar'
  if (p.startsWith('/animations/') || /\.vrma$/.test(p)) return 'animation'
  if (/\.(glb|gltf|fbx|obj|bin|ply|stl)$/.test(p)) return 'model'
  if (p.startsWith('/hdri/') || p.startsWith('/skies/') || /\.(hdr|exr)$/.test(p)) return 'sky'
  if (/\.(png|jpe?g|webp|gif|avif|svg|ktx2|basis)$/.test(p)) return p.startsWith('/ui/') ? 'ui' : 'texture'
  if (/\.(mp3|ogg|wav|m4a|aac|opus)$/.test(p)) return 'audio'
  if (/\.(json)$/.test(p)) return 'data'
  return 'other'
}

export function nameOfUrl(url: string): string {
  const p = url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('#')[0].split('?')[0]
  const last = p.split('/').filter(Boolean).pop() || p
  try { return decodeURIComponent(last) } catch { return last }
}

/** The file a request is for: no fragment, no `copy` parameter (a loader cache key, not a different file). */
export function fileKeyOf(url: string): string {
  const [base, query = ''] = url.split('#')[0].split('?')
  const kept = query.split('&').filter(part => part && !/^copy=/.test(part))
  return kept.length ? `${base}?${kept.join('&')}` : base
}

function localKey(url: string): string {
  return fileKeyOf(url.replace(/^[a-z]+:\/\/[^/]+/i, ''))
}

/** Files worth downloading once and sharing: big binaries parsed into separate copies. */
export function isSharedBinary(kind: LoadKind): boolean {
  return kind === 'avatar' || kind === 'model' || kind === 'animation'
}

export class LoadTracker {
  private nextId = 1
  private inFlight = new Map<number, LoadItem>()
  private done: LoadItem[] = []
  private startedMs = 0
  private lastEndMs = -Infinity
  private warm: { done: number; total: number } | null = null
  private pageDone = false
  /** Picture sizes that arrived before their item was seen. */
  private pendingBytes = new Map<string, number>()

  /** The page's own script and first data are in (the world can start). */
  markPageDone() { this.pageDone = true }

  begin(url: string, now: number, kind = kindOfUrl(url)): number {
    if (this.inFlight.size === 0 && now - this.lastEndMs > LOAD_IDLE_MS && this.done.length) {
      this.done = []
      this.startedMs = now
    } else if (this.inFlight.size === 0 && this.done.length === 0) {
      this.startedMs = now
    }
    const id = this.nextId++
    this.inFlight.set(id, { id, url, name: nameOfUrl(url), kind, bytes: null, bytesDone: 0, startMs: now, endMs: null })
    return id
  }

  progress(id: number, bytesDone: number, bytes: number | null) {
    const item = this.inFlight.get(id)
    if (!item) return
    item.bytesDone = bytesDone
    if (bytes !== null) item.bytes = Math.max(bytes, bytesDone)
  }

  end(id: number, now: number, bytes?: number | null) {
    const item = this.inFlight.get(id)
    if (!item) return
    this.inFlight.delete(id)
    const pending = this.pendingBytes.get(localKey(item.url))
    if (bytes == null && pending !== undefined) { bytes = pending; this.pendingBytes.delete(localKey(item.url)) }
    if (bytes != null) { item.bytes = bytes; item.bytesDone = bytes } else if (item.bytes === null) item.bytes = item.bytesDone; else item.bytesDone = item.bytes
    item.endMs = now
    this.done.push(item)
    this.lastEndMs = now
  }

  /** Something that finished without being seen in flight (resource timing). */
  addFinished(url: string, startMs: number, endMs: number, bytes: number, kind = kindOfUrl(url)) {
    const id = this.begin(url, startMs, kind)
    this.end(id, endMs, bytes)
  }

  /** The size of a picture, from resource timing: given to its item, in flight or done, or kept until the item shows up. */
  fillBytes(url: string, bytes: number) {
    const key = localKey(url)
    for (const item of this.inFlight.values()) {
      if (localKey(item.url) === key && !item.bytes) { item.bytes = bytes; return }
    }
    for (let i = this.done.length - 1; i >= 0; i--) {
      const item = this.done[i]
      if (localKey(item.url) === key && !item.bytes) { item.bytes = bytes; item.bytesDone = bytes; return }
    }
    this.pendingBytes.set(key, bytes)
  }

  setWarm(done: number, total: number) {
    this.warm = total > 0 && done < total ? { done, total } : null
  }

  snapshot(): LoadSnapshot {
    const inFlight = [...this.inFlight.values()].sort((a, b) => b.startMs - a.startMs).map(item => ({ ...item }))
    const done = this.done.map(item => ({ ...item }))
    const all = [...done, ...inFlight]
    const bytesDone = all.reduce((sum, item) => sum + item.bytesDone, 0)
    const unknown = inFlight.some(item => item.bytes === null)
    const bytesTotal = unknown ? null : all.reduce((sum, item) => sum + (item.bytes ?? item.bytesDone), 0)
    const phase: LoadPhase = !this.pageDone ? 'page'
      : inFlight.some(item => item.kind === 'world') ? 'world'
      : inFlight.length ? 'assets'
      : this.warm ? 'warming'
      : 'ready'
    return {
      active: phase !== 'ready', phase, startedMs: this.startedMs, inFlight, done, bytesDone, bytesTotal,
      itemsDone: done.length, itemsTotal: all.length, warm: this.warm ? { ...this.warm } : null,
    }
  }
}

// ── The page's tracker ──────────────────────────────────────────────────────────────────────────

const tracker = new LoadTracker()
const listeners = new Set<() => void>()
let cached: LoadSnapshot = tracker.snapshot()
let notifyTimer: ReturnType<typeof setTimeout> | null = null

function changed() {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    cached = tracker.snapshot()
    listeners.forEach(listener => listener())
  }, NOTIFY_MS)
}

export function getLoadSnapshot(): LoadSnapshot { return cached }

/** Called at most ten times a second. */
export function subscribeLoad(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The scene warm-up's progress (done of total objects); 0 of 0 when it has nothing to do. */
let lastWarm = ''
export function reportWarm(done: number, total: number) {
  const key = `${done}/${total}`
  if (key === lastWarm) return
  lastWarm = key
  tracker.setWarm(done, total)
  changed()
}

// ── Shared downloads ─────────────────────────────────────────────────────────────────────────────

interface Download { buffer: ArrayBuffer; status: number; statusText: string; headers: Headers }
const downloads = new Map<string, Promise<Download | Response>>()
/** How long a finished download stays shareable (a second copy asked for a little later). */
const SHARE_MS = 20_000
let running = 0
const queue: Array<() => void> = []

function slot(): Promise<void> {
  if (running < MAX_PARALLEL_BINARY) { running++; return Promise.resolve() }
  return new Promise(resolve => queue.push(() => { running++; resolve() }))
}
function release() {
  running--
  const next = queue.shift()
  if (next) next()
}

async function readCounting(response: Response, id: number): Promise<ArrayBuffer> {
  const length = Number(response.headers.get('content-length'))
  const total = response.headers.get('content-encoding') || !Number.isFinite(length) || length <= 0 ? null : length
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    tracker.progress(id, buffer.byteLength, buffer.byteLength)
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    tracker.progress(id, received, total)
    changed()
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out.buffer
}

function countingStream(response: Response, id: number): Response {
  if (!response.body) return response
  const length = Number(response.headers.get('content-length'))
  const total = response.headers.get('content-encoding') || !Number.isFinite(length) || length <= 0 ? null : length
  let received = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      tracker.progress(id, received, total)
      changed()
      controller.enqueue(chunk)
    },
    flush() {
      tracker.end(id, performance.now(), received)
      changed()
    },
  })
  return new Response(response.body.pipeThrough(counter), { status: response.status, statusText: response.statusText, headers: response.headers })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase()
}

const TRACKED: ReadonlySet<LoadKind> = new Set<LoadKind>(['world', 'model', 'avatar', 'animation', 'sky', 'audio'])

/** Pictures go through three's manager (and resource timing for their size), never the fetch count, so none counts twice. */
export function isPicture(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|svg|ktx2|basis)$/.test(pathOf(url))
}

function wrapFetch(original: typeof fetch): typeof fetch {
  return async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input)
    const kind = kindOfUrl(url)
    if (requestMethod(input, init) !== 'GET' || !TRACKED.has(kind) || isPicture(url) || url.startsWith('data:') || url.startsWith('blob:')) {
      return original(input, init)
    }
    if (!isSharedBinary(kind)) {
      const id = tracker.begin(url, performance.now(), kind)
      changed()
      try {
        return countingStream(await original(input, init), id)
      } catch (error) {
        tracker.end(id, performance.now())
        changed()
        throw error
      }
    }
    const key = new URL(fileKeyOf(url), location.href).href
    let shared = downloads.get(key)
    const first = !shared
    if (!shared) {
      shared = (async () => {
        await slot()
        const id = tracker.begin(url, performance.now(), kind)
        changed()
        try {
          const response = await original(input, init)
          if (!response.ok) { tracker.end(id, performance.now()); return response }
          const buffer = await readCounting(response, id)
          tracker.end(id, performance.now(), buffer.byteLength)
          return { buffer, status: response.status, statusText: response.statusText, headers: response.headers }
        } catch (error) {
          tracker.end(id, performance.now())
          throw error
        } finally {
          release()
          changed()
        }
      })()
      downloads.set(key, shared)
      shared.then(
        result => { if (result instanceof Response) downloads.delete(key); else setTimeout(() => downloads.delete(key), SHARE_MS) },
        () => downloads.delete(key),
      )
    }
    const result = await shared
    if (result instanceof Response) return first ? result : original(input, init)
    // Every caller gets its own bytes: a parser may write into what it is given.
    const buffer = first ? result.buffer : result.buffer.slice(0)
    if (first) result.buffer = result.buffer.slice(0)
    return new Response(buffer, { status: result.status, statusText: result.statusText, headers: result.headers })
  }
}

// ── Install ─────────────────────────────────────────────────────────────────────────────────────

let installed = false

export function installLoadTracker() {
  if (installed || typeof window === 'undefined') return
  installed = true
  // A hot reload runs this again with a new tracker: wrap the page's own fetch and hooks, never the last wrapper.
  const host = window as unknown as {
    __oasisBaseFetch?: typeof fetch
    __oasisManagerOwn?: { start: (url: string) => void; end: (url: string) => void; error: (url: string) => void }
    __oasisLoadObserver?: PerformanceObserver
  }
  const baseFetch = host.__oasisBaseFetch ?? (host.__oasisBaseFetch = window.fetch.bind(window))
  window.fetch = wrapFetch(baseFetch)

  // Loaders that do not fetch (images): in flight by three's manager, sizes from resource timing.
  const manager = THREE.DefaultLoadingManager
  const managed = new Map<string, number[]>()
  const own = host.__oasisManagerOwn ?? (host.__oasisManagerOwn = {
    start: manager.itemStart.bind(manager), end: manager.itemEnd.bind(manager), error: manager.itemError.bind(manager),
  })
  const ownStart = own.start
  const ownEnd = own.end
  const ownError = own.error
  const finish = (url: string) => {
    const ids = managed.get(url)
    const id = ids?.shift()
    if (ids && !ids.length) managed.delete(url)
    if (id !== undefined) { tracker.end(id, performance.now()); changed() }
  }
  manager.itemStart = (url: string) => {
    const kind = kindOfUrl(url)
    // Fetched files are counted by the fetch wrapper; the manager covers pictures only.
    if (isPicture(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      const id = tracker.begin(url, performance.now(), kind)
      managed.set(url, [...(managed.get(url) || []), id])
      changed()
    }
    ownStart(url)
  }
  manager.itemEnd = (url: string) => { finish(url); ownEnd(url) }
  manager.itemError = (url: string) => { finish(url); ownError(url) }

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        const bytes = entry.encodedBodySize || entry.transferSize || entry.decodedBodySize || 0
        const kind = kindOfUrl(entry.name)
        if (entry.name.startsWith('data:') || entry.name.startsWith('blob:')) continue
        if (isPicture(entry.name) && kind !== 'code') { tracker.fillBytes(entry.name, bytes); continue }
        if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') continue
        if (kind === 'code' || kind === 'audio') {
          tracker.addFinished(entry.name, entry.startTime, entry.responseEnd || entry.startTime + entry.duration, bytes, kind)
        }
      }
      changed()
    })
    host.__oasisLoadObserver?.disconnect()
    host.__oasisLoadObserver = observer
    observer.observe({ type: 'resource', buffered: true })
  } catch { /* no resource timing: images report without sizes */ }

  tracker.markPageDone()
  changed()
  if (process.env.NODE_ENV !== 'production') {
    ;(window as unknown as Record<string, unknown>).__oasisLoad = { snapshot: () => tracker.snapshot() }
  }
}
