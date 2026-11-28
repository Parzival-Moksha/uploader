'use client'
// ░▒▓ MEDIA LIBRARY — the body of the Media spells (Spells > Media: MP3, MP4, JPEG) ▓▒░
// The owner, 27 Nov: the Own spells become Media, one spell per kind, each "a beautiful upload button" and the library
// underneath (no drop area: the button is simpler). JPEG is one list: the pictures spells made and the pictures
// uploaded, no longer two tabs. Hovering an MP3 plays it, a picture opens full screen, a click places it in the world.
// Grown from the Wizard Console's Media tab, which stays as it is. Media the Oasis ships with (public/media-library,
// src/lib/media-library.ts) is listed after your own, with its credit, and cannot be deleted; where this Oasis takes
// no uploads (the deployed one), the upload button is not shown.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOasisStore } from '../../../../store/oasisStore'
import { AssetCard } from '../../AssetCard'
import { KitButton, kitConfirm } from '@/components/ui-kit'
import { buildAudioPlacementPending, buildImagePlacementPending, buildVideoPlacementPending } from '../../../../lib/forge/placement-builders'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export type MediaKind = 'audio' | 'video' | 'image'

interface MediaItem { name: string; url: string; type: MediaKind; size: number; createdAt: string; shipped?: boolean; credit?: string; licence?: string }

/** One entry of the library: an upload, or (JPEG) a picture a spell made. */
interface LibraryEntry {
  key: string
  name: string
  url: string
  subtitle: string
  createdAt: number
  /** Removes it: an upload's file, or a made picture from the gallery. Shipped media has none. */
  remove?: () => Promise<void>
}

export const MEDIA_KIND_INFO: Record<MediaKind, { title: string; accept: string; noun: string; icon: string }> = {
  audio: { title: 'MP3', accept: 'audio/*', noun: 'sounds', icon: '🎵' },
  video: { title: 'MP4', accept: 'video/*', noun: 'videos', icon: '🎬' },
  image: { title: 'JPEG', accept: 'image/*', noun: 'pictures', icon: '🖼️' },
}

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[var(--z-dialog)] flex cursor-pointer items-center justify-center bg-black/90" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" onClick={event => event.stopPropagation()} />
      <button className="absolute right-4 top-4 cursor-pointer text-3xl text-white/60 hover:text-white" onClick={onClose} aria-label="Close">&times;</button>
    </div>,
    document.body,
  )
}

export function MediaLibraryBody({ kind }: { kind: MediaKind }) {
  const info = MEDIA_KIND_INFO[kind]
  const [uploads, setUploads] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadsOn, setUploadsOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const generatedImages = useOasisStore(s => s.generatedImages)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const behaviors = useOasisStore(s => s.behaviors)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/list`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setUploads((data.items as MediaItem[]).filter(item => item.type === kind))
        setUploadsOn(data.uploads !== false)
      }
    } catch { /* the list stays as it was */ }
    setLoading(false)
  }, [kind])
  useEffect(() => { void refresh() }, [refresh])

  const upload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`${OASIS_BASE}/api/media/upload`, { method: 'POST', body: form })
        if (!res.ok) setError(`${file.name}: ${(await res.json().catch(() => ({}))).error || `upload failed (${res.status})`}`)
      }
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
      await refresh()
    }
  }, [refresh])

  const placedCount = useCallback((url: string) => {
    let count = placedCatalogAssets.filter(asset => asset.imageUrl === url || asset.videoUrl === url || asset.audioUrl === url).length
    for (const behavior of Object.values(behaviors)) if (behavior?.audioUrl === url) count++
    return count
  }, [placedCatalogAssets, behaviors])

  const entries = useMemo<LibraryEntry[]>(() => {
    const fromUploads = uploads.map((item): LibraryEntry => item.shipped
      ? {
          key: item.url,
          name: item.name,
          url: item.url,
          subtitle: [item.licence, item.credit].filter(Boolean).join(' · ') || 'comes with the Oasis',
          createdAt: 0,
        }
      : {
          key: item.url,
          name: item.name,
          url: item.url,
          subtitle: formatSize(item.size),
          createdAt: Date.parse(item.createdAt) || 0,
          remove: async () => {
            await fetch(`${OASIS_BASE}/api/media/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url }) })
            await refresh()
          },
        })
    const made = kind === 'image'
      ? generatedImages.map(image => ({
          key: image.id,
          name: image.title || image.prompt.slice(0, 40) || 'picture',
          url: image.url,
          subtitle: 'made by a spell',
          createdAt: Date.parse(String(image.createdAt)) || 0,
          remove: async () => { removeGeneratedImage(image.id) },
        }))
      : []
    return [...made, ...fromUploads].sort((a, b) => b.createdAt - a.createdAt)
  }, [uploads, generatedImages, kind, refresh, removeGeneratedImage])

  const place = (entry: LibraryEntry) => {
    const name = entry.name.replace(/\.[^.]+$/, '').slice(0, 40) || info.title
    if (kind === 'image') enterPlacementMode(buildImagePlacementPending({ name, imageUrl: entry.url }))
    else if (kind === 'video') enterPlacementMode(buildVideoPlacementPending({ name, videoUrl: entry.url }))
    else enterPlacementMode(buildAudioPlacementPending({ name: name || 'Loudspeaker', audioUrl: entry.url, defaultScale: 2 }))
    window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
  }

  const remove = async (entry: LibraryEntry) => {
    if (!entry.remove) return
    const inWorld = placedCount(entry.url)
    const ok = await kitConfirm({
      title: `Delete ${entry.name}?`,
      body: inWorld ? `It stands in the world ${inWorld} time${inWorld === 1 ? '' : 's'}; those go dark.` : 'It leaves the library for good.',
      confirm: 'Delete',
      danger: true,
    })
    if (ok) await entry.remove()
  }

  const useAsTile = (entry: LibraryEntry) => {
    const presetId = `custom_media_${entry.url.replace(/[^a-zA-Z0-9]/g, '_').slice(-30)}`
    if (!customGroundPresets.some(preset => preset.id === presetId)) {
      addCustomGroundPreset({ id: presetId, name: entry.name.slice(0, 20), icon: '🎨', color: '#888888', assetName: '', tileRepeat: 8, customTextureUrl: entry.url })
    }
    enterPaintMode(presetId)
    window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
  }

  const cardType = kind === 'image' ? 'media-image' as const : kind === 'video' ? 'media-video' as const : 'media-audio' as const

  return (
    <div className="flex flex-col gap-2" data-media-library={kind}>
      {uploadsOn && (
        <>
          <KitButton variant="primary" disabled={busy} onClick={() => fileInput.current?.click()} title={`Upload ${info.noun} from this computer`}>
            {busy ? 'Uploading…' : `${info.icon} Upload ${info.noun}`}
          </KitButton>
          <input ref={fileInput} type="file" accept={info.accept} multiple className="hidden" onChange={event => void upload(event.target.files)} />
        </>
      )}
      {error && <span className="kit-hint" role="alert">{error}</span>}

      {loading ? (
        <span className="kit-hint">Loading…</span>
      ) : entries.length === 0 ? (
        <span className="kit-hint">No {info.noun} yet.{uploadsOn ? ` Upload some${kind === 'image' ? ', or make one with Text to Pic,' : ''} and they appear here.` : ''}</span>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {entries.map(entry => {
            const count = placedCount(entry.url)
            return (
              <AssetCard
                key={entry.key}
                id={entry.key}
                name={entry.name}
                type={cardType}
                thumbnailUrl={kind === 'image' ? entry.url : undefined}
                mediaUrl={entry.url}
                isInWorld={count > 0}
                accentColor="#EC4899"
                subtitle={entry.subtitle}
                onClick={() => place(entry)}
                onDelete={entry.remove ? () => void remove(entry) : undefined}
                deleteTitle={`Delete ${entry.name}`}
                onViewFullscreen={kind === 'image' ? () => setLightbox(entry.url) : undefined}
                onUseAsTile={kind === 'image' ? () => useAsTile(entry) : undefined}
                onPlaceWithFrame={kind === 'image' ? () => {
                  enterPlacementMode(buildImagePlacementPending({ name: entry.name.slice(0, 40), imageUrl: entry.url, frameStyle: 'gilded' }))
                  window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
                } : undefined}
                badges={count > 0 ? <span className="font-mono text-[8px] text-sky-400">{count} placed</span> : undefined}
              />
            )
          })}
        </div>
      )}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
