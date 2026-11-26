// Pictures kept for the session. Owned by Hipster (the UI kit).
//
// The owner, 2026-11-24, on the spell book: "I click Spells. And they don't have texture... Why did it take 10 seconds
// for the spell book background texture to load?... I go back to Agents again from Own... the textures are gone again."
// A picture the page stops showing can be dropped by the browser, and the next showing asks the server again (the
// pictures under /ui/ are served with max-age=0, so it must ask); on a slow server that is seconds of empty cards.
// Here each picture is loaded once and its element held for the session, so the browser keeps it decoded and a tab
// change shows it at once. PooledImage shows the kept element itself (no new request, whatever the cache headers say:
// a new <img> with the same address asks the server again when the browser's cache is off or has dropped it), with a
// plain face until it is ready. isImageReady / useImageReady for the rest.

import { Fragment, createElement, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

interface Entry { img: HTMLImageElement; state: 'loading' | 'ready' | 'failed'; listeners: Set<() => void> }
interface Pool { entries: Map<string, Entry> }
const KEY = '__oasisImagePool'
const g = globalThis as Record<string, unknown>
const pool: Pool = (g[KEY] as Pool | undefined) ?? (g[KEY] = { entries: new Map() } as Pool)

function settle(entry: Entry, state: 'ready' | 'failed') {
  entry.state = state
  entry.listeners.forEach(fn => fn())
}

/** Load these pictures once each and keep them for the session. A failed one is not asked for again. */
export function keepImages(urls: readonly string[], priority: 'high' | 'auto' = 'auto'): void {
  if (typeof Image === 'undefined') return
  for (const url of urls) {
    if (!url || pool.entries.has(url)) continue
    const img = new Image()
    img.decoding = 'async'
    if (priority === 'high') (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
    img.src = url
    const entry: Entry = { img, state: 'loading', listeners: new Set() }
    pool.entries.set(url, entry)
    img.decode().then(() => settle(entry, 'ready'), () => settle(entry, 'failed'))
  }
}

export function isImageReady(url: string): boolean {
  return pool.entries.get(url)?.state === 'ready'
}

/** Called when the picture's state changes (ready or failed). Returns an unsubscribe. */
export function onImageChange(url: string, fn: () => void): () => void {
  const entry = pool.entries.get(url)
  if (!entry) return () => {}
  entry.listeners.add(fn)
  return () => { entry.listeners.delete(fn) }
}

/** Ready to draw at once? (Asks for the picture if nobody has.) */
export function useImageReady(url: string): boolean {
  return useSyncExternalStore(
    fn => { keepImages([url]); return onImageChange(url, fn) },
    () => isImageReady(url),
    () => false,
  )
}

/**
 * The kept picture itself, put in place while this is on screen and handed back to the pool when it goes: a tab
 * change costs no request. `fallback` shows until the picture is ready (and stays if it fails).
 */
export function PooledImage({ url, className, alt, fallback }: { url: string; className?: string; alt?: string; fallback?: ReactNode }) {
  const ready = useImageReady(url)
  const host = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = host.current
    const entry = pool.entries.get(url)
    if (!ready || !box || !entry) return
    // One element per address: if it is already shown elsewhere, a copy (the browser may ask again for that one).
    const img = entry.img.parentNode ? (entry.img.cloneNode() as HTMLImageElement) : entry.img
    img.className = className ?? ''
    img.alt = alt ?? ''
    box.appendChild(img)
    return () => { if (img.parentNode === box) box.removeChild(img) }
  }, [ready, url, className, alt])
  if (!ready) return createElement(Fragment, null, fallback ?? null)
  return createElement('span', { ref: host, style: { display: 'contents' }, 'data-pooled-image': url })
}
