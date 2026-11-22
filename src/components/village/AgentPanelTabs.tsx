'use client'

// ░▒▓ AGENT PANEL TABS — the agent's panel has three pages: its thread, its missions for the owner, its settings ▓▒░
// 2026-11-22, the owner: Settings back in the header as a word (next to F screen, dismiss and ✕), and a Mindcraft
// page with the agent's own missions; the thread is the default and needs no button: clicking Settings (or
// Mindcraft) again shows the thread. Same in the side panel (E) and on the full screen (F).
// The owner (2026-11-20 play-through, 0:22 to 1:25): the strip of controls on top (model, mode and the rest) "could
// just become an alternative page, a different tab of the agent panel. Same thing with F screen", with model and mode
// at its top, and a font-size control for the text. The tab chosen is the same in the side panel (E) and on the full
// screen (F). Built from the shared UI kit (Hipster's); the panel's frame and colours are the kit's, not set here.

import { useSyncExternalStore, type ReactNode } from 'react'
import { KitSlider, KitChip } from '@/components/ui-kit'

export type AgentPanelTab = 'thread' | 'settings' | 'mindcraft'

let tab: AgentPanelTab = 'thread'
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setAgentPanelTab(next: AgentPanelTab): void {
  if (tab === next) return
  tab = next
  notify()
}

export function useAgentPanelTab(): AgentPanelTab {
  return useSyncExternalStore(subscribe, () => tab, () => 'thread' as AgentPanelTab)
}

/** A header word: its page, or the thread again when it is the page shown. */
export function toggleAgentPanelTab(next: Exclude<AgentPanelTab, 'thread'>): void {
  setAgentPanelTab(tab === next ? 'thread' : next)
}


/**
 * "Mindcraft" (with how many of its missions wait for him; only when there are some, or while it is shown) and
 * "Settings", in the header of the side panel and of the full screen.
 */
export function AgentPanelHeaderTabs({ missions, large = false }: { missions: number; large?: boolean }) {
  const active = useAgentPanelTab()
  // The kit's header button (KitChip): its look follows the menu style; pressed while its page is shown.
  const big = large ? 'text-[11px]' : undefined
  return (
    <>
      {(missions > 0 || active === 'mindcraft') && (
        <KitChip
          data-panel-tab="mindcraft"
          data-active={active === 'mindcraft' ? '1' : '0'}
          pressed={active === 'mindcraft'}
          onClick={() => toggleAgentPanelTab('mindcraft')}
          title={active === 'mindcraft' ? 'Back to the thread' : 'What it asks you: its missions, answerable here'}
          className={big}
        >
          Mindcraft{missions > 0 ? <span className="text-amber-300">?{missions}</span> : null}
        </KitChip>
      )}
      <KitChip
        data-panel-tab="settings"
        data-active={active === 'settings' ? '1' : '0'}
        pressed={active === 'settings'}
        onClick={() => toggleAgentPanelTab('settings')}
        title={active === 'settings' ? 'Back to the thread' : 'Model, mode, thinking, and how it works with you'}
        className={big}
      >
        Settings
      </KitChip>
    </>
  )
}

// ─── the thread's text size ───────────────────────────────────────────────────────────────────────

const FONT_KEY = 'oasis.village.threadFont.v1'
export const THREAD_FONT = { min: 0.8, max: 1.6, step: 0.05, default: 1 } as const
let fontScale: number | null = null

function clampFont(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : THREAD_FONT.default
  return Math.round(Math.min(THREAD_FONT.max, Math.max(THREAD_FONT.min, n)) * 100) / 100
}

export function getThreadFontScale(): number {
  if (fontScale === null) {
    let raw: unknown = null
    if (typeof window !== 'undefined') {
      try { raw = JSON.parse(window.localStorage.getItem(FONT_KEY) || 'null') } catch { raw = null }
    }
    fontScale = clampFont(raw)
  }
  return fontScale
}

export function setThreadFontScale(value: number): void {
  fontScale = clampFont(value)
  try { window.localStorage.setItem(FONT_KEY, JSON.stringify(fontScale)) } catch { /* storage blocked */ }
  notify()
}

export function useThreadFontScale(): number {
  return useSyncExternalStore(subscribe, getThreadFontScale, () => THREAD_FONT.default)
}

/** The thread at the chosen text size (one scale on the whole thread, so every part grows together). */
export function ThreadFontScale({ children }: { children: ReactNode }) {
  const scale = useThreadFontScale()
  // It must fill the space it is given (the thread inside scrolls): full height, whatever its parent is. Zoom leaves
  // a percentage height as it is (CSS zoom as Chrome 128+ does it), so 100% still ends where the space ends. Dividing
  // it by the zoom, as this did until 2026-11-22, left 60 to 120 px blank above the text box at 120 to 140% text.
  return (
    <div data-thread-font={scale} className="flex h-full min-h-0 flex-1 flex-col" style={scale === 1 ? undefined : { zoom: scale }}>
      {children}
    </div>
  )
}

export function ThreadFontSlider() {
  const scale = useThreadFontScale()
  return (
    <KitSlider
      label="Text size"
      value={Math.round(scale * 100)}
      min={THREAD_FONT.min * 100}
      max={THREAD_FONT.max * 100}
      step={THREAD_FONT.step * 100}
      onChange={value => setThreadFontScale(value / 100)}
      format={value => `${value}%`}
      hint="The thread's text, in the side panel and on the full screen"
    />
  )
}
