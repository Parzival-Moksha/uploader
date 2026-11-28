'use client'

import { useEffect, useMemo } from 'react'

import { normalizeBrowserSurfaceUrl } from '@/lib/browser-surface'
import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// What an overlay may show runs in a sandbox that never has this site's origin: scripts, forms and popups only
// (Merge Goat and Anorak, 28 Nov). A page is loaded by its address inside the sandbox; nothing is fetched with the
// visitor's session first.
export const OVERLAY_SANDBOX = 'allow-scripts allow-forms allow-popups'

/** The address an overlay may load, or undefined: only a web page or an Oasis page, never an /api/ route. */
export function resolveOverlayUrl(url?: string, base = OASIS_BASE, here = typeof window !== 'undefined' ? window.location.origin : 'https://oasis.invalid'): string | undefined {
  const safe = normalizeBrowserSurfaceUrl(url)
  if (!safe) return undefined
  let path = safe
  if (!/^https?:\/\//i.test(path) && path.startsWith('/') && base && !path.startsWith(base)) path = `${base}${path}`
  // Where it really points on this site, with ./ and ../ and escapes worked out: never an /api/ route.
  try {
    const parsed = new URL(path, `${here}${base}/`)
    if (parsed.origin === here) {
      const p = decodeURIComponent(parsed.pathname).toLowerCase()
      const rel = base && p.startsWith(base.toLowerCase()) ? p.slice(base.length) : p
      if (/^\/api(\/|$)/.test(rel)) return undefined
    }
  } catch {
    return undefined
  }
  return path
}

export function ObjectHtmlOverlay() {
  const overlay = useOasisStore(state => state.activeObjectOverlay)
  const closeObjectOverlay = useOasisStore(state => state.closeObjectOverlay)
  useUILayer('object-html-overlay', Boolean(overlay))

  const url = useMemo(() => resolveOverlayUrl(overlay?.url), [overlay?.url])

  useEffect(() => {
    if (!overlay) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      closeObjectOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeObjectOverlay, overlay])

  if (!overlay) return null

  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-panel)_+_50)] flex items-center justify-center bg-black/40 p-4 font-mono text-white backdrop-blur-[2px] max-[700px]:p-2"
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeObjectOverlay()
      }}
    >
      <section
        data-ui-panel
        className="flex h-[82vh] w-[82vw] max-w-6xl flex-col overflow-hidden rounded-lg border border-white/18 shadow-[0_0_70px_rgba(0,0,0,0.72)] max-[700px]:h-[86vh] max-[700px]:w-[96vw]"
        style={{ background: `rgba(5, 9, 14, ${overlay.opacity})` }}
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-white/12 bg-black/35 px-4">
          <div className="min-w-0 flex-1 truncate text-[12px] font-black uppercase tracking-[0.16em] text-cyan-50/90">
            {overlay.title}
          </div>
          <button
            type="button"
            onClick={closeObjectOverlay}
            className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/70 transition hover:bg-white/14 hover:text-white"
          >
            Close
          </button>
        </header>
        <div className="relative min-h-0 flex-1 bg-white/90">
          {url ? (
            <iframe
              title={overlay.title}
              src={url}
              className="h-full w-full border-0"
              referrerPolicy="no-referrer"
              sandbox={OVERLAY_SANDBOX}
            />
          ) : (
            <iframe
              title={overlay.title}
              srcDoc={overlay.html || ''}
              className="h-full w-full border-0"
              sandbox={OVERLAY_SANDBOX}
            />
          )}
        </div>
      </section>
    </div>
  )
}
