'use client'

// The intro overlay: the title and subtitle drawn over the live world for about three seconds,
// then gone from the page. It never takes a click or a key (pointer-events: none, no focus), and
// it holds no timers once it has left. Data, layout and timing live in intro-overlay.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ASCII_CELL,
  INTRO_CHANGED_EVENT,
  INTRO_EMBLEM_SIZE,
  INTRO_EMBLEM_URL,
  INTRO_FADE_IN_MS,
  INTRO_FADE_OUT_MS,
  INTRO_PREVIEW_EVENT,
  INTRO_SUBTITLE,
  INTRO_TITLE,
  INTRO_VIEW,
  SUBTITLE_CELL,
  TITLE_CELL,
  asciiTitle,
  createEmblemLoader,
  cellsPath,
  introLayout,
  introPhase,
  isIntroChoice,
  readIntroChoice,
  textCells,
  type CellShape,
  type IntroChoice,
  type IntroPhase,
  type IntroVariantId,
} from './intro-overlay'

const L = introLayout()

interface VariantLook {
  titleShape: CellShape
  titleFill: number
  subtitleShape: CellShape
}

const LOOKS: Record<IntroVariantId, VariantLook> = {
  pixels: { titleShape: 'square', titleFill: 0.84, subtitleShape: 'square' },
  ascii: { titleShape: 'square', titleFill: 0.84, subtitleShape: 'square' },
  emblem: { titleShape: 'square', titleFill: 0.84, subtitleShape: 'square' },
}

function usePaths(variant: IntroVariantId) {
  return useMemo(() => {
    const look = LOOKS[variant]
    const title = textCells(INTRO_TITLE, L.titleX, L.titleY, TITLE_CELL)
      .map(cells => cellsPath(cells, TITLE_CELL, look.titleShape, look.titleFill))
    const subtitle = cellsPath(
      textCells(INTRO_SUBTITLE, L.subtitleX, L.subtitleY, SUBTITLE_CELL).flat(),
      SUBTITLE_CELL,
      look.subtitleShape,
      look.subtitleShape === 'diamond' ? 1 : 0.86,
    )
    return { title, subtitle }
  }, [variant])
}

/** The five title glyphs, each arriving a beat after the one before. */
function Title({ paths, ...rest }: { paths: string[] } & React.SVGProps<SVGPathElement>) {
  return (
    <>
      {paths.map((d, i) => (
        <path key={i} d={d} className="oasis-intro-glyph" style={{ animationDelay: `${90 + i * 70}ms` }} {...rest} />
      ))}
    </>
  )
}

/** Sunrise's striped sun (the owner, 19 Nov: keep its sun, in Pixels), rising behind the title to the horizon line. */
function Sun() {
  const cx = L.centerX
  const horizon = L.titleY + L.titleH + 29
  const radius = 330
  // Bands of the sun: thick at the top, thinner and wider apart towards the horizon.
  const bands: Array<{ y: number; h: number }> = []
  let y = horizon - radius
  let i = 0
  while (y < horizon) {
    const t = (y - (horizon - radius)) / radius
    const h = Math.max(5, 34 * (1 - t * 0.85))
    bands.push({ y, h: Math.min(h, horizon - y) })
    y += h + 6 + t * 16
    i += 1
    if (i > 40) break
  }
  return (
    <>
      <defs>
        <clipPath id="oasisIntroSun"><circle cx={cx} cy={horizon} r={radius} /></clipPath>
        <linearGradient id="oasisIntroSunFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffe36b" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff4fb8" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id="oasisIntroHorizon" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#7de3ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#7de3ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath="url(#oasisIntroSun)" className="oasis-intro-rise">
        {bands.map((band, k) => (
          <rect key={k} x={cx - radius} y={band.y} width={radius * 2} height={band.h} fill="url(#oasisIntroSunFill)" />
        ))}
      </g>
      <rect className="oasis-intro-late" x={L.titleX - 120} y={horizon - 1.5} width={L.titleW + 240} height={3} fill="url(#oasisIntroHorizon)" />
    </>
  )
}

function Subtitle({ d }: { d: string }) {
  return (
    <>
      <path className="oasis-intro-late" d={d} fill="rgba(4,10,24,0.4)" transform="translate(2 2)" />
      <path className="oasis-intro-late" d={d} fill="rgba(125,227,255,0.92)" />
    </>
  )
}

function Pixels({ title, subtitle }: { title: string[]; subtitle: string }) {
  return (
    <>
      <Sun />
      <g transform="translate(4 4)"><Title paths={title} fill="rgba(4,10,24,0.38)" /></g>
      <Title paths={title} fill="rgba(255,255,255,0.72)" />
      <Subtitle d={subtitle} />
    </>
  )
}

const ASCII_FONT = "Consolas, 'Cascadia Mono', Menlo, 'DejaVu Sans Mono', 'Courier New', monospace"

/** The title in dense characters (intro-overlay.ts, asciiTitle), each row stretched to the title's width so the letters line up whatever the monospace font. */
function Ascii({ subtitle }: { subtitle: string }) {
  const art = useMemo(() => asciiTitle(INTRO_TITLE), [])
  const rowH = TITLE_CELL / ASCII_CELL.rows
  const rows = (lines: string[], fill: string, dx = 0, dy = 0) => lines.map((line, i) => (
    <text
      key={i}
      className="oasis-intro-row"
      style={{ animationDelay: `${60 + i * 32}ms` }}
      x={L.titleX + dx}
      y={L.titleY + (i + 1) * rowH - rowH * 0.18 + dy}
      textLength={L.titleW}
      lengthAdjust="spacingAndGlyphs"
      xmlSpace="preserve"
      fill={fill}
    >
      {line}
    </text>
  ))
  const cursorX = L.subtitleX + L.subtitleW + SUBTITLE_CELL * 1.4
  return (
    <>
      <g fontFamily={ASCII_FONT} fontSize={rowH * 1.34} fontWeight={700}>
        {rows(art.halo, 'rgba(125,227,255,0.42)')}
        {rows(art.core, 'rgba(4,10,24,0.42)', 3, 3)}
        {rows(art.core, 'rgba(232,255,248,0.9)')}
      </g>
      <Subtitle d={subtitle} />
      <rect className="oasis-intro-cursor" x={cursorX} y={L.subtitleY} width={SUBTITLE_CELL * 3} height={L.subtitleH} fill="rgba(125,227,255,0.85)" />
    </>
  )
}

// The emblem picture is loaded once per page and kept: started as soon as the overlay mounts with it chosen (before
// the world's assets fill the browser's connections), so later showings are instant.
const emblem = createEmblemLoader(() => {
  const img = new Image()
  img.decoding = 'async'
  // Ahead of the world's textures and models in the browser's queue (on HTTP/1.1 they hold every connection).
  ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high'
  img.src = INTRO_EMBLEM_URL
  return img.decode()
})
function preloadEmblem(): void {
  if (typeof window !== 'undefined') emblem.start()
}

/**
 * The generated picture, centred where the title stands; it settles in from slightly larger, a flash on the runes.
 * Until the picture is there (a slow first load), Pixels stands in, so the intro is never an empty frame.
 */
function Emblem({ title, subtitle }: { title: string[]; subtitle: string }) {
  const width = 1360
  const height = Math.round(width * INTRO_EMBLEM_SIZE.height / INTRO_EMBLEM_SIZE.width)
  const [ready, setReady] = useState(emblem.status() === 'ready')
  useEffect(() => {
    preloadEmblem()
    return emblem.onSettled(() => setReady(emblem.status() === 'ready'))
  }, [])
  if (!ready) return <Pixels title={title} subtitle={subtitle} />
  return (
    <image
      className="oasis-intro-emblem"
      href={INTRO_EMBLEM_URL}
      x={(INTRO_VIEW.width - width) / 2}
      y={Math.round((INTRO_VIEW.height - height) / 2) - 10}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
    />
  )
}

/** The drawing alone, for the overlay and for the picker's thumbnails. */
export function IntroArt({ variant }: { variant: IntroVariantId }) {
  const paths = usePaths(variant)
  return (
    <svg
      viewBox={`0 0 ${INTRO_VIEW.width} ${INTRO_VIEW.height}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      aria-hidden
      data-variant={variant}
    >
      {variant === 'pixels' && <Pixels {...paths} />}
      {variant === 'ascii' && <Ascii subtitle={paths.subtitle} />}
      {variant === 'emblem' && <Emblem {...paths} />}
    </svg>
  )
}

const INTRO_CSS = `
.oasis-intro {
  position: fixed; inset: 0; z-index: var(--z-splash);
  pointer-events: none; user-select: none;
  opacity: 1;
  animation: oasisIntroIn ${INTRO_FADE_IN_MS}ms ease-out both;
  transition: opacity ${INTRO_FADE_OUT_MS}ms ease-in;
}
.oasis-intro[data-phase="leaving"] { opacity: 0; }
@keyframes oasisIntroIn { from { opacity: 0; } to { opacity: 1; } }
.oasis-intro-glyph { animation: oasisIntroGlyph 520ms cubic-bezier(0.2, 0.9, 0.25, 1.15) both; }
@keyframes oasisIntroGlyph { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
.oasis-intro-late { animation: oasisIntroLate 600ms ease-out 480ms both; }
@keyframes oasisIntroLate { from { opacity: 0; } to { opacity: 1; } }
.oasis-intro-row { animation: oasisIntroRow 380ms steps(4, end) both; }
@keyframes oasisIntroRow { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
.oasis-intro-cursor { animation: oasisIntroCursor 1060ms steps(1, end) 700ms infinite both; }
@keyframes oasisIntroCursor { 0% { opacity: 1; } 50% { opacity: 0; } }
.oasis-intro-emblem { transform-box: fill-box; transform-origin: center; animation: oasisIntroEmblem 900ms cubic-bezier(0.2, 0.85, 0.25, 1) both; }
@keyframes oasisIntroEmblem { 0% { opacity: 0; transform: scale(1.08); filter: brightness(2.2); } 60% { opacity: 1; filter: brightness(1.25); } 100% { opacity: 1; transform: none; filter: none; } }
.oasis-intro-rise { animation: oasisIntroRise 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes oasisIntroRise { from { opacity: 0; transform: translateY(60px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .oasis-intro-glyph, .oasis-intro-late, .oasis-intro-row, .oasis-intro-cursor, .oasis-intro-rise, .oasis-intro-emblem { animation: none; }
}
`

interface Run { key: number; variant: IntroVariantId; phase: IntroPhase }

function canvasOnScreen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('canvas') !== null
}

export function IntroOverlay() {
  const [run, setRun] = useState<Run | null>(null)
  const nextKeyRef = useRef(1)

  // The first run, on page load, with the saved choice.
  useEffect(() => {
    const choice = readIntroChoice()
    if (choice === 'emblem') preloadEmblem()
    if (choice !== 'off') setRun({ key: nextKeyRef.current++, variant: choice, phase: 'showing' })
  }, [])

  // The picker in Settings plays a variant again without reloading the page.
  useEffect(() => {
    const onPreview = (event: Event) => {
      const choice = (event as CustomEvent<{ choice?: IntroChoice }>).detail?.choice
      if (!isIntroChoice(choice)) return
      if (choice === 'emblem') preloadEmblem()
      setRun(choice === 'off' ? null : { key: nextKeyRef.current++, variant: choice, phase: 'showing' })
    }
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ choice?: IntroChoice }>).detail?.choice === 'off') setRun(null)
    }
    window.addEventListener(INTRO_PREVIEW_EVENT, onPreview)
    window.addEventListener(INTRO_CHANGED_EVENT, onChanged)
    return () => {
      window.removeEventListener(INTRO_PREVIEW_EVENT, onPreview)
      window.removeEventListener(INTRO_CHANGED_EVENT, onChanged)
    }
  }, [])

  // One clock per run: wait for the canvas, count three seconds over it, fade, leave the page.
  const runKey = run?.key ?? 0
  useEffect(() => {
    if (!runKey) return
    const mountedAt = performance.now()
    let sceneAt: number | null = canvasOnScreen() ? mountedAt : null
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (sceneAt === null && canvasOnScreen()) sceneAt = now
      const phase = introPhase(now, mountedAt, sceneAt)
      if (phase === 'gone') {
        window.clearInterval(timer)
        setRun(current => (current && current.key === runKey ? null : current))
      } else {
        setRun(current => (current && current.key === runKey && current.phase !== phase ? { ...current, phase } : current))
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [runKey])

  if (!run) return null
  return (
    <div className="oasis-intro" data-phase={run.phase} data-variant={run.variant} key={run.key} aria-hidden>
      <style dangerouslySetInnerHTML={{ __html: INTRO_CSS }} />
      <IntroArt variant={run.variant} />
    </div>
  )
}
