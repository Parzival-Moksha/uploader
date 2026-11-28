// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MUSIC BODY — Text-to-music generation panel body
// ─═̷─ Used by both the Wizard Console's Music tab and the standalone
// Text-to-Music spelltab. Hits POST /api/media/music (ElevenLabs Music API).
// Maintains a local "in-flight" list and a gallery sourced from /api/media/list
// (audio entries) so generated MP3s show up next to anything else uploaded.
// The look is the UI kit's (Hipster): it follows the menu style chosen in Settings. What it offers (the models,
// the lengths, the request) is Wizard's: MUSIC_MODELS, DURATIONS and handleGenerate.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { scrollIntoViewOnFocus } from '../SpellTabFrame'
import { KitButton, KitCard, KitChip, KitSelectField, KitTextField, KitToggle } from '@/components/ui-kit'
import { useOasisStore } from '@/store/oasisStore'
import { buildAudioPlacementPending } from '../../../../lib/forge/placement-builders'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ElevenLabs' music models (their docs, 27 Nov 2026): v1 (deprecated, gone 31 Jan 2027), v2 and v2.5, all at the
// same $0.15 a minute; v2.5 is their best, so it is the one (the owner: "aren't we on V2 already?"). One entry: the
// Model select stays hidden (it shows only for more than one).
const MUSIC_MODELS = [
  { key: 'music_v2_5', label: 'ElevenLabs Music v2.5', desc: 'Their newest music model, $0.15 a minute' },
] as const

const DURATIONS = [
  { ms: 10000, label: '10s' },
  { ms: 20000, label: '20s' },
  { ms: 30000, label: '30s' },
] as const

interface InFlightMusic {
  id: string
  prompt: string
  durationMs: number
  instrumental: boolean
  startedAt: number
  error?: string
}

interface GeneratedMusic {
  id: string
  prompt: string
  url: string
  durationMs: number
  instrumental: boolean
  createdAt: string
}

interface MediaListItem {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
  size: number
  createdAt: string
}

const STORAGE_KEY = 'oasis-music-spelltab-history'

function readHistory(): GeneratedMusic[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 50) : []
  } catch { return [] }
}

function writeHistory(items: GeneratedMusic[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50))) } catch {}
}

export interface MusicBodyProps {
  /** When true, defaults open both sections (NEW + GALLERY). */
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MusicBody({ defaultExpandNew = true, defaultExpandGallery = true }: MusicBodyProps) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(MUSIC_MODELS[0].key)
  const [durationMs, setDurationMs] = useState<number>(30000)
  const [instrumental, setInstrumental] = useState(false)
  const [inFlight, setInFlight] = useState<InFlightMusic[]>([])
  const [history, setHistory] = useState<GeneratedMusic[]>(() => readHistory())
  const [uploaded, setUploaded] = useState<MediaListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)

  // ── Fetch uploaded audio so the gallery shows previously-uploaded MP3s too
  const fetchUploaded = useCallback(async () => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/list`)
      if (!res.ok) return
      const data = await res.json()
      const items: MediaListItem[] = Array.isArray(data.items) ? data.items : []
      setUploaded(items.filter(it => it.type === 'audio'))
    } catch {}
  }, [])

  useEffect(() => { fetchUploaded() }, [fetchUploaded])

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    const flightId = `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setInFlight(prev => [
      ...prev,
      { id: flightId, prompt: text, durationMs, instrumental, startedAt: Date.now() },
    ])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, durationMs, instrumental, model }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Music generation failed' })) as { error?: string; detail?: string; hint?: string; cause?: string }
        // Compose a rich error so the player sees WHY it failed (e.g. DNS,
        // missing API key, fal/elevenlabs outage) instead of a generic
        // "Music generation failed."
        const parts = [data.error || `Error ${res.status}`]
        if (data.detail) parts.push(data.detail)
        if (data.hint) parts.push(`Hint: ${data.hint}`)
        else if (data.cause) parts.push(`(${data.cause})`)
        const msg = parts.join(' — ')
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
        setError(msg)
        return
      }
      const data = await res.json()
      const entry: GeneratedMusic = {
        id: flightId,
        prompt: text,
        url: data.url,
        durationMs: data.durationMs ?? durationMs,
        instrumental: data.instrumental ?? instrumental,
        createdAt: new Date().toISOString(),
      }
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, 50)
        writeHistory(next)
        return next
      })
      setInFlight(prev => prev.filter(f => f.id !== flightId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Music generation failed'
      setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
      setError(msg)
    }
  }, [prompt, durationMs, instrumental, model])

  const handleDelete = useCallback((id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id)
      writeHistory(next)
      return next
    })
  }, [])

  const placeAudioTrack = useCallback((track: GeneratedMusic) => {
    enterPlacementMode(buildAudioPlacementPending({
      name: track.prompt.slice(0, 30) || 'Music speaker',
      defaultScale: 1,
      audioUrl: track.url,
    }))
  }, [enterPlacementMode])

  // Merge history + previously-uploaded audio (de-duplicated by URL).
  const galleryEntries = [
    ...history,
    ...uploaded
      .filter(u => !history.some(h => h.url === u.url))
      .map<GeneratedMusic>(u => ({
        id: u.url,
        prompt: u.name,
        url: u.url,
        durationMs: 0,
        instrumental: false,
        createdAt: u.createdAt,
      })),
  ]

  // One track plays at a time, in the gallery's own player (the browser's grey audio bars were "the gallery looks
  // like shit", the owner, 27 Nov).
  const player = useTrackPlayer()
  const length = DURATIONS.find(d => d.ms === durationMs)

  return (
    <div className="space-y-3" data-music-body>
      <style>{MUSIC_CSS}</style>
      <KitCard title="Compose" data-music-compose>
        <KitTextField
          multiline
          rows={3}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleGenerate() }}
          placeholder="Describe the music: slow lo-fi beats over ambient pads, rain, melancholy…"
        />
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div>
            <span className="kit-label">Length</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Length">
              {DURATIONS.map(d => (
                <KitChip key={d.ms} pressed={durationMs === d.ms} role="radio" aria-checked={durationMs === d.ms} onClick={() => setDurationMs(d.ms)}>{d.label}</KitChip>
              ))}
            </div>
          </div>
          {MUSIC_MODELS.length > 1 && (
            <div className="min-w-[180px] flex-1">
              <KitSelectField label="Model" value={model} onChange={e => setModel(e.target.value)} options={MUSIC_MODELS.map(m => ({ value: m.key, label: m.label }))} />
            </div>
          )}
        </div>
        <div className="mt-2"><KitToggle checked={instrumental} onChange={setInstrumental} label="Instrumental" hint={instrumental ? 'No voice' : 'Voice allowed'} /></div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="kit-hint !mt-0">{MUSIC_MODELS.find(m => m.key === model)?.label || model} · {length?.label ?? `${Math.round(durationMs / 1000)}s`}</span>
          <KitButton variant="primary" onClick={() => void handleGenerate()} disabled={!prompt.trim()} data-music-generate>
            {inFlight.some(f => !f.error) ? `Composing (${inFlight.filter(f => !f.error).length})` : 'Compose'}
          </KitButton>
        </div>
        {error && <div className="kit-hint mt-2" role="alert" style={{ color: '#ff9a8a', opacity: 1 }}>{error}</div>}
      </KitCard>

      {inFlight.length > 0 && (
        <div className="space-y-2">
          {inFlight.map(f => (
            <KitCard key={f.id} data-music-flight>
              <div className="flex items-center gap-3">
                {f.error ? (
                  <>
                    <span className="text-lg" aria-hidden>✕</span>
                    <span className="min-w-0 flex-1 text-[13px]" style={{ color: '#ff9a8a' }}>{f.error}</span>
                    <KitChip onClick={() => setInFlight(prev => prev.filter(x => x.id !== f.id))}>Dismiss</KitChip>
                  </>
                ) : (
                  <>
                    <span className="oasis-music-bars" aria-hidden>{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]" title={f.prompt}>{f.prompt}</span>
                    <span className="kit-label !mb-0">composing {(f.durationMs / 1000).toFixed(0)}s</span>
                  </>
                )}
              </div>
            </KitCard>
          ))}
        </div>
      )}

      <KitCard title={`Your music · ${galleryEntries.length}`} data-music-gallery>
        {galleryEntries.length === 0 ? (
          <div className="py-6 text-center">
            <div className="text-3xl" aria-hidden>♫</div>
            <div className="kit-hint">Nothing composed yet. Describe a mood above and press Compose.</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
            {galleryEntries.map(track => (
              <TrackCard
                key={track.id}
                track={track}
                player={player}
                onPlace={() => placeAudioTrack(track)}
                onForget={history.some(h => h.id === track.id) ? () => handleDelete(track.id) : undefined}
              />
            ))}
          </div>
        )}
      </KitCard>
    </div>
  )
}

// ─── the gallery's player and cards (Hipster) ──────────────────────────────────────────────────

const MUSIC_CSS = `
.oasis-music-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 18px; }
.oasis-music-bars > span { display: block; width: 3px; height: 100%; border-radius: 2px; background: var(--kit-accent, #c4b5fd); animation: oasisMusicBars 680ms ease-in-out infinite; transform-origin: bottom; }
@keyframes oasisMusicBars { 0%, 100% { transform: scaleY(0.3); opacity: 0.5 } 50% { transform: scaleY(1); opacity: 1 } }
.oasis-track { position: relative; display: flex; gap: 10px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); transition: box-shadow 160ms ease-out, background 160ms ease-out; }
.oasis-track:hover { background: rgba(0,0,0,0.36); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); }
.oasis-track[data-playing="1"] { box-shadow: inset 0 0 0 1px var(--track-hue), 0 0 18px -4px var(--track-hue); }
.oasis-track-cover { position: relative; flex: none; width: 64px; height: 64px; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
.oasis-track-play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.8); background: rgba(0,0,0,0.18); transition: background 140ms ease-out, transform 140ms ease-out; cursor: pointer; border: 0; }
.oasis-track-play:hover { background: rgba(0,0,0,0.05); transform: scale(1.06); }
.oasis-track-wave { display: flex; align-items: center; gap: 1px; height: 26px; cursor: pointer; }
.oasis-track-wave > span { flex: 1; border-radius: 1px; background: rgba(255,255,255,0.22); transition: background 120ms linear; }
.oasis-track-wave > span[data-on="1"] { background: var(--track-hue); }
[data-kit-style="parchment"] .oasis-track { background: rgba(255,248,226,0.45); box-shadow: inset 0 0 0 1px rgba(110,74,34,0.4); }
[data-kit-style="parchment"] .oasis-track-wave > span { background: rgba(60,35,10,0.25); }
`

interface TrackPlayer {
  playingUrl: string | null
  progress: number
  toggle: (url: string) => void
  seek: (url: string, share: number) => void
}

/** One Audio element for the whole gallery: pressing play on a track stops the one before. */
function useTrackPlayer(): TrackPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null }, [])
  const audio = () => {
    if (!audioRef.current) {
      const a = new Audio()
      a.preload = 'none'
      a.addEventListener('timeupdate', () => setProgress(a.duration ? a.currentTime / a.duration : 0))
      a.addEventListener('ended', () => { setPlayingUrl(null); setProgress(0) })
      audioRef.current = a
    }
    return audioRef.current
  }
  const toggle = (url: string) => {
    const a = audio()
    if (playingUrl === url && !a.paused) { a.pause(); setPlayingUrl(null); return }
    if (a.src !== new URL(url, window.location.href).href) { a.src = url; setProgress(0) }
    void a.play().then(() => setPlayingUrl(url)).catch(() => setPlayingUrl(null))
  }
  const seek = (url: string, share: number) => {
    const a = audio()
    if (a.src !== new URL(url, window.location.href).href) { toggle(url); return }
    if (a.duration) a.currentTime = share * a.duration
  }
  return { playingUrl, progress, toggle, seek }
}

/** A stable number from a string, for a track's colour and its drawn waveform. */
function hashOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const WAVE_BARS = 36

function TrackCard({ track, player, onPlace, onForget }: { track: GeneratedMusic; player: TrackPlayer; onPlace: () => void; onForget?: () => void }) {
  const seed = hashOf(track.prompt || track.url)
  const hue = seed % 360
  const playing = player.playingUrl === track.url
  const bars = Array.from({ length: WAVE_BARS }, (_, i) => {
    const s = hashOf(`${seed}:${i}`)
    // An envelope (quiet start and end) times a little noise: it reads as a track, not as a random bar chart.
    const envelope = Math.sin(Math.PI * (i + 0.5) / WAVE_BARS) * 0.65 + 0.35
    return Math.max(0.15, envelope * (0.55 + (s % 1000) / 2200))
  })
  const shown = playing ? player.progress : 0
  return (
    <div className="oasis-track" data-playing={playing ? '1' : '0'} data-music-track style={{ ['--track-hue' as string]: `hsl(${hue} 80% 66%)` }}>
      <div className="oasis-track-cover" style={{ background: `radial-gradient(circle at 30% 25%, hsl(${(hue + 40) % 360} 85% 70%), hsl(${hue} 70% 38%) 55%, hsl(${(hue + 300) % 360} 60% 16%))` }}>
        <button type="button" className="oasis-track-play" onClick={() => player.toggle(track.url)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold" title={track.prompt}>{track.prompt}</span>
          {onForget && <button type="button" onClick={onForget} className="shrink-0 text-[13px] opacity-50 hover:opacity-100" title="Forget it from this list" aria-label="Forget">✕</button>}
        </div>
        <div
          className="oasis-track-wave"
          onClick={event => { const r = event.currentTarget.getBoundingClientRect(); player.seek(track.url, (event.clientX - r.left) / r.width) }}
          title="Play from here"
        >
          {bars.map((h, i) => <span key={i} data-on={i / WAVE_BARS < shown ? '1' : '0'} style={{ height: `${Math.round(h * 100)}%` }} />)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="kit-hint !mt-0 truncate">
            {track.durationMs > 0 ? `${(track.durationMs / 1000).toFixed(0)}s · ` : ''}{track.instrumental ? 'instrumental · ' : ''}{new Date(track.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
          <KitChip onClick={onPlace} title="Place it in the world on a speaker">Place</KitChip>
        </div>
      </div>
    </div>
  )
}
