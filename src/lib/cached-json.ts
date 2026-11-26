// ░▒▓ CACHED JSON — read once, keep, refresh in the background ▓▒░
// The owner, 2026-11-24: "i hit character menu it loads over 10sec, need to be less than 1sec". A menu that
// fetches its data on every open waits behind whatever the page is loading (six requests at a time per
// host) and a busy dev server: 19 s measured. Here a read is kept per URL for the page's life: a component
// shows the kept answer at once and asks again in the background only when it is older than its max age; one
// request per URL at a time, however many components ask. warmCachedJson reads a few ahead, when the page
// is idle, so the first open finds them too.

import { useEffect, useSyncExternalStore } from 'react'

interface Entry {
  data: unknown
  at: number
  status: number
  inFlight: Promise<void> | null
  listeners: Set<() => void>
}

const entries = new Map<string, Entry>()
/** URLs whose last answer is also kept in localStorage, so the first open after a reload is instant too. */
const persisted = new Set<string>()
const STORE_PREFIX = 'oasis-cache:'
/** A stored answer older than this is not shown. */
export const CACHED_JSON_MAX_STORED_MS = 24 * 60 * 60_000

/**
 * Only an Oasis served from this machine keeps answers across reloads: one person, their own browser. On
 * the hosted site (or a guest's browser at a party) a profile is per person, and a shared browser must not
 * show the last person's (Merge Goat, 25 Nov).
 */
export function canPersistCachedJson(hostname: string | null = typeof window === 'undefined' ? null : window.location.hostname): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

/** A stored { at, data } still good to show (not too old, well formed), else null. */
export function readStoredAnswer(raw: string | null, now = Date.now()): { at: number; data: unknown } | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as { at?: unknown; data?: unknown }
    if (typeof stored?.at !== 'number' || !('data' in stored) || now - stored.at > CACHED_JSON_MAX_STORED_MS || stored.at > now + 60_000) return null
    return { at: stored.at, data: stored.data }
  } catch {
    return null
  }
}

function forgetStored(url: string): void {
  try { window.localStorage.removeItem(STORE_PREFIX + url) } catch { /* storage off */ }
}

function entry(url: string): Entry {
  let found = entries.get(url)
  if (!found) {
    found = { data: undefined, at: 0, status: 0, inFlight: null, listeners: new Set() }
    entries.set(url, found)
  }
  return found
}

/**
 * Keep this URL's last answer across reloads too (never for anything secret: it sits in localStorage).
 * The stored answer is shown until the first read of this page comes back; it counts as old, so it is read
 * again at once.
 */
export function persistCachedJson(url: string): void {
  if (typeof window === 'undefined') return
  if (!canPersistCachedJson()) {
    forgetStored(url)
    return
  }
  if (persisted.has(url)) return
  persisted.add(url)
  const item = entry(url)
  if (item.data !== undefined) return
  let raw: string | null = null
  try { raw = window.localStorage.getItem(STORE_PREFIX + url) } catch { /* storage off */ }
  const stored = readStoredAnswer(raw)
  if (stored) item.data = stored.data
  else if (raw) forgetStored(url)
}

/** The kept answer (undefined before the first one). */
export function getCachedJson<T>(url: string): T | undefined {
  return entries.get(url)?.data as T | undefined
}

/** The HTTP status of the last answer (0 before any; 403/404 mean "not here", e.g. hosted). */
export function getCachedStatus(url: string): number {
  return entries.get(url)?.status ?? 0
}

/** How old the kept answer is, in ms (Infinity before the first). */
export function cachedAge(url: string): number {
  const at = entries.get(url)?.at
  return at ? Date.now() - at : Infinity
}

/** Read it now (joins a read already on its way). A failed read keeps the last good answer, except a 401/403/404, which drops it. */
export function loadCachedJson(url: string): Promise<void> {
  const item = entry(url)
  if (item.inFlight) return item.inFlight
  item.inFlight = (async () => {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      item.status = response.status
      if (response.ok) {
        const data = await response.json()
        item.data = data
        item.at = Date.now()
        if (persisted.has(url)) {
          try { window.localStorage.setItem(STORE_PREFIX + url, JSON.stringify({ at: item.at, data })) } catch { /* full: fine */ }
        }
      } else if (response.status === 401 || response.status === 403 || response.status === 404) {
        // Not yours (signed out, someone else) or not here: nothing kept is shown.
        item.data = undefined
        item.at = 0
        if (persisted.has(url)) forgetStored(url)
      }
    } catch { /* keep the last answer */ } finally {
      item.inFlight = null
      item.listeners.forEach(listener => listener())
    }
  })()
  return item.inFlight
}

/** Read it again only if the kept answer is older than maxAgeMs (or there is none). */
export function refreshCachedJson(url: string, maxAgeMs: number): Promise<void> {
  return cachedAge(url) > maxAgeMs ? loadCachedJson(url) : Promise.resolve()
}

/** Forget a kept answer and read it again (after a change, say a new avatar). */
export function invalidateCachedJson(url: string): Promise<void> {
  const item = entry(url)
  item.at = 0
  return loadCachedJson(url)
}

export function subscribeCachedJson(url: string, listener: () => void): () => void {
  const item = entry(url)
  item.listeners.add(listener)
  return () => { item.listeners.delete(listener) }
}

/**
 * The kept answer for a component, refreshed in the background on mount when older than maxAgeMs and every
 * `everyMs` while mounted (0: never). Never blocks: the first paint shows what is kept.
 */
export function useCachedJson<T>(url: string | null, maxAgeMs: number, everyMs = 0): T | undefined {
  const data = useSyncExternalStore(
    listener => (url ? subscribeCachedJson(url, listener) : () => {}),
    () => (url ? getCachedJson<T>(url) : undefined),
    () => undefined,
  )
  useEffect(() => {
    if (!url) return
    void refreshCachedJson(url, maxAgeMs)
    if (!everyMs) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCachedJson(url)
    }, everyMs)
    return () => window.clearInterval(timer)
  }, [url, maxAgeMs, everyMs])
  return data
}

/**
 * Read these ahead, side by side, when the page is idle (after `delayMs`), so the first open of a menu finds
 * them kept (a slow one, like Claude Code's plan limits, must not wait for the others). Skips any already
 * fresh. Returns a cancel.
 */
export function warmCachedJson(urls: readonly string[], delayMs = 6000, maxAgeMs = 60_000): () => void {
  if (typeof window === 'undefined') return () => {}
  let cancelled = false
  const run = () => {
    if (cancelled) return
    for (const url of urls) void refreshCachedJson(url, maxAgeMs)
  }
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  const timer = window.setTimeout(() => {
    if (idle) idle(run, { timeout: 4000 })
    else run()
  }, delayMs)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
