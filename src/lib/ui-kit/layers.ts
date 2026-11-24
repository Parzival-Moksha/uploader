// One order for everything that draws over the world. Owned by Hipster (the UI kit).
//
// The owner, 2026-11-22: "Mindcraft draws behind the agent panel... what is supposed to draw over what, and how that
// compares to a triple-A game?" Games keep a few named layers, not a number per window (Epic's CommonUI: Game,
// GameMenu, Menu, Modal; loading screens, notices and the cursor above them). So here, from the bottom:
//
//   world   the 3D view and what is in it: desk screens, the F screen, name tags, 3D agent windows (drei Html ranges)
//   hud     the counter, lights, hints, the vow, chat, the crosshair, the rail (Menu / World / Spells / Agents)
//   panel   windows during play: agent panels (E), Mindcraft, the Wizard console, the Joystick, brushes, Anorak Pro
//           (Mindcraft is here, not with the places: the later opened of it and an agent panel is on top, his wish)
//   place   full-screen places he opened: the spell book, Settings, World, the character menu
//   menu    the main menu (M) and its pages
//   dialog  a question that must be answered (kitConfirm, delete, onboarding)
//   notice  toasts, "resting", portal and sky transitions, drop veils
//   splash  the intro and the loading screen
//   tip     tooltips and what hangs on the cursor
//
// Each layer is a band of 1000. Inside a band, the later opened (or clicked) is on top, and never leaves the band.
// Esc closes the topmost open thing that registered a close, then the one under it. The bands are also CSS
// variables in globals.css (--z-hud …), for Tailwind classes: z-[var(--z-place)], z-[calc(var(--z-hud)+10)].
// Which overlay is where (the rest follow their kind):
//   world   desk screens, the F screen, name tags, 3D agent windows, conjure labels: zIndexRange={WORLD_Z_RANGE}
//   hud     counter, services lights, key hints, crosshair, vow, chat, vitals, mobile controls, own missions, the rail
//           (+50; the rail rises to the place layer while Settings, World or Profile, which open inside it, is open)
//   panel   agent panel, Mindcraft, the Wizard console, the Joystick, brushes, Anorak Pro, the picker, the animation browser
//   place   spell book, Settings, World, the character menu (K), the vow menu, the avatar gallery, spell tabs
//   menu    the main menu, Help (+10)
//   dialog  kitConfirm / KitDialog, delete, onboarding, fork welcome, the folder browser, World's QR and delete
//   notice  toasts, resting, the portal transition, drop veils, the loading bar
//   splash  the intro, the loader;  tip: tooltips, the mic bubble

import { useEffect, useRef, useSyncExternalStore } from 'react'

export type UiLayer = 'world' | 'hud' | 'panel' | 'place' | 'menu' | 'dialog' | 'notice' | 'splash' | 'tip'
export const UI_LAYERS: readonly UiLayer[] = ['world', 'hud', 'panel', 'place', 'menu', 'dialog', 'notice', 'splash', 'tip']
export const LAYER_BAND = 1000
/** Where a layer's stacked windows start (below it: fixed pieces at layerZ(layer, 0..99)). */
const STACK_START = 100
const STACK_STEP = 2
const STACK_MAX = 800

/** A fixed spot in a layer: its base plus an offset 0..999. */
export function layerZ(layer: UiLayer, offset = 0): number {
  return UI_LAYERS.indexOf(layer) * LAYER_BAND + Math.max(0, Math.min(LAYER_BAND - 1, Math.round(offset)))
}

/** For drei <Html zIndexRange>: things in the 3D view never rise above the HUD. Desk screens and tags sort by distance inside it. */
export const WORLD_Z_RANGE: [number, number] = [layerZ('world', 900), layerZ('world', 0)]

// ── the open stack (on globalThis: a hot reload must not split it; see menu-look.ts) ──────────────────────────

/** A close read when Esc comes (a ref, so a close that comes and goes never moves the entry in the stack). */
export type CloseRef = { current?: (() => void) | undefined }
/**
 * open: registered by useLayer while it shows (counts for Esc). Not open: only clicked (a store panel's
 * bringPanelToFront): it orders z, but nobody tells us when it closes, so it never counts for Esc.
 */
interface Entry { id: string; layer: UiLayer; seq: number; open: boolean; close: CloseRef }
interface Store { entries: Map<string, Entry>; seq: number; version: number; listeners: Set<() => void>; escHooked: boolean }
const KEY = '__oasisUiLayers'
const g = globalThis as Record<string, unknown>
const store: Store = (g[KEY] as Store | undefined) ?? (g[KEY] = { entries: new Map(), seq: 0, version: 0, listeners: new Set(), escHooked: false } as Store)

function changed() {
  store.version += 1
  store.listeners.forEach(fn => fn())
}

/** Something opened on a layer (or its close changed). Opening again keeps its place; raiseLayer brings it up. */
export function openLayer(id: string, layer: UiLayer, close?: (() => void) | CloseRef): void {
  const ref: CloseRef = typeof close === 'function' ? { current: close } : (close ?? {})
  const had = store.entries.get(id)
  if (had && had.layer === layer && had.open) {
    had.close = ref
    return
  }
  store.seq += 1
  store.entries.set(id, { id, layer, seq: store.seq, open: true, close: ref })
  changed()
}

export function closeLayer(id: string): void {
  if (store.entries.delete(id)) changed()
}

/** Is it open (registered by useLayer and not closed)? */
export function isLayerOpen(id: string): boolean {
  return store.entries.get(id)?.open === true
}

/** A click on it: to the front of its own layer. Unknown ids are put on the panel layer. */
export function raiseLayer(id: string, layer: UiLayer = 'panel'): void {
  const e = store.entries.get(id)
  const top = Math.max(0, ...[...store.entries.values()].filter(x => x.layer === (e?.layer ?? layer)).map(x => x.seq))
  if (e && e.seq === top) return
  store.seq += 1
  if (e) e.seq = store.seq
  else store.entries.set(id, { id, layer, seq: store.seq, open: false, close: {} })
  changed()
}

/** The z-index of an open thing: its layer's base, plus its rank in that layer. Not open: the bottom of the stack. */
export function zFor(id: string, layer?: UiLayer): number {
  const e = store.entries.get(id)
  const l = e?.layer ?? layer ?? 'panel'
  if (!e) return layerZ(l, STACK_START)
  const rank = [...store.entries.values()].filter(x => x.layer === l && x.seq < e.seq).length
  return layerZ(l, Math.min(STACK_MAX, STACK_START + STACK_STEP * (rank + 1)))
}

/** The topmost open thing (highest layer, then the last raised), or null. Only-clicked entries don't count. */
export function topmostLayer(): { id: string; layer: UiLayer; closes: boolean } | null {
  let best: Entry | null = null
  for (const e of store.entries.values()) {
    if (!e.open) continue
    if (!best || UI_LAYERS.indexOf(e.layer) > UI_LAYERS.indexOf(best.layer) || (e.layer === best.layer && e.seq > best.seq)) best = e
  }
  return best ? { id: best.id, layer: best.layer, closes: Boolean(best.close.current) } : null
}

export function subscribeLayers(fn: () => void): () => void {
  store.listeners.add(fn)
  return () => { store.listeners.delete(fn) }
}
export function getLayersVersion(): number { return store.version }

/**
 * An overlay on a layer: returns its z-index while it is open. With close, Esc closes it when it is the topmost
 * thing (and the key goes no further). Call raiseLayer(id) on pointer-down to bring it to the front of its layer.
 */
export function useLayer(id: string, layer: UiLayer, open = true, close?: () => void): number {
  const closeRef = useRef<CloseRef>({})
  closeRef.current.current = close
  useEffect(() => {
    if (!open) return
    openLayer(id, layer, closeRef.current)
    return () => closeLayer(id)
  }, [id, layer, open])
  useSyncExternalStore(subscribeLayers, getLayersVersion, () => 0)
  return open ? zFor(id, layer) : layerZ(layer, STACK_START)
}

// ── Esc: the topmost closes first ─────────────────────────────────────────────────────────────────────────────

function isTyping(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!t) return false
  return t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

type EscEvent = { key: string; repeat?: boolean; target?: unknown; defaultPrevented?: boolean; preventDefault: () => void; stopImmediatePropagation: () => void }

/**
 * Registered on window in the capture phase when this module is first loaded, so before the overlays' own Esc
 * listeners. It acts only when the topmost open thing has a close and the key is not typed into a field (a field's
 * Esc is its own: cancel an edit, stop dictation); otherwise the key goes on as before.
 */
function onEscape(event: EscEvent) {
  if (event.key !== 'Escape' || event.repeat) return
  const s = g[KEY] as Store | undefined
  if (!s) return
  const top = topmostLayer()
  if (!top || !top.closes) return
  if (isTyping(event.target) && top.layer !== 'dialog') {
    // The field's own Esc first (cancel an edit, stop dictation). If it had none, the key leaves the field, so the
    // next Esc closes the window (a dead key otherwise: Hustler, 23 Nov).
    const field = event.target as { blur?: () => void }
    setTimeout(() => {
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (!event.defaultPrevented && active === (event.target as unknown)) field.blur?.()
    }, 0)
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  s.entries.get(top.id)?.close.current?.()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !store.escHooked) {
  store.escHooked = true
  window.addEventListener('keydown', (event: KeyboardEvent) => onEscape(event), { capture: true })
}
