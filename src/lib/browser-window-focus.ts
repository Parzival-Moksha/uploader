// ░▒▓ BROWSER WINDOW FOCUS — a browser window in the world holds focus the way an agent's screen does ▓▒░
// The owner (26 Nov): the browser window was broken to use: in play he could not select it, the wheel zoomed the
// camera, Page Up / Down did nothing, Enter focused it once, double-click and E nothing, and once in he got out only
// with Esc after many tries (reproduced: with the page clicked, five Esc presses in a row did nothing; the page had
// the keyboard). The village's grammar instead: E focuses and zooms it, in play, no build mode; while focused the
// wheel scrolls the page, Page Up / Down and typing go to the page; Esc leaves on the first press (E too, while the
// Oasis has the keys), back where he stood with the mouse as it was.
// Pure: which window E means, and what a key does while one is focused. components/forge/BrowserWindowFocus.tsx
// does the rest (the listeners, the page's own Esc, the wheel).

import * as THREE from 'three'

export type Vec3 = [number, number, number]

/** px of a window's page to metres (AgentWindow3D's PX_TO_WORLD), before the window's own scale. */
export const WINDOW_PX_TO_WORLD = 0.02
/** E means the window at the middle of the screen when it is this close to him (metres, to the point looked at). */
export const AIM_REACH_M = 10
/** Or the one he stands right in front of, with no agent near (metres, to the window's lower edge line). */
export const NEAR_REACH_M = 3.5

export interface BrowserWindowShape {
  id: string
  position: Vec3
  rotation: Vec3
  /** The page's size in px (AgentWindow width / height). */
  width: number
  height: number
  /** The window's scale times its transform's (resolveAgentWindowRenderScale). */
  scale: number
}

interface Frame { center: THREE.Vector3; normal: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; halfW: number; halfH: number }

function frameOf(w: BrowserWindowShape): Frame {
  const euler = new THREE.Euler(w.rotation[0], w.rotation[1], w.rotation[2])
  return {
    center: new THREE.Vector3(...w.position),
    normal: new THREE.Vector3(0, 0, 1).applyEuler(euler).normalize(),
    right: new THREE.Vector3(1, 0, 0).applyEuler(euler).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyEuler(euler).normalize(),
    halfW: (w.width * WINDOW_PX_TO_WORLD * w.scale) / 2,
    halfH: (w.height * WINDOW_PX_TO_WORLD * w.scale) / 2,
  }
}

/** The window the view's middle points at (from its front), within `reach` of him; the nearest such. */
export function aimedWindow(windows: BrowserWindowShape[], origin: Vec3, direction: Vec3, actor: Vec3, reach = AIM_REACH_M): string | null {
  return aimedWindowHit(windows, origin, direction, actor, reach)?.id ?? null
}

/** The same, with how far from him the point looked at is (metres). */
export function aimedWindowHit(windows: BrowserWindowShape[], origin: Vec3, direction: Vec3, actor: Vec3, reach = AIM_REACH_M): { id: string; distance: number } | null {
  const o = new THREE.Vector3(...origin)
  const d = new THREE.Vector3(...direction).normalize()
  const a = new THREE.Vector3(...actor)
  let best: { id: string; t: number; distance: number } | null = null
  for (const w of windows) {
    const f = frameOf(w)
    if (f.halfW <= 0 || f.halfH <= 0) continue
    if (o.clone().sub(f.center).dot(f.normal) <= 0) continue // looking at its back
    const denom = d.dot(f.normal)
    if (Math.abs(denom) < 1e-4) continue
    const t = f.center.clone().sub(o).dot(f.normal) / denom
    if (!(t > 0)) continue
    const hit = o.clone().addScaledVector(d, t)
    const local = hit.clone().sub(f.center)
    if (Math.abs(local.dot(f.right)) > f.halfW || Math.abs(local.dot(f.up)) > f.halfH) continue
    const distance = hit.distanceTo(a)
    if (distance > reach) continue
    if (!best || t < best.t) best = { id: w.id, t, distance }
  }
  return best ? { id: best.id, distance: best.distance } : null
}

/**
 * Looking at a browser window takes the village's keys from an agent only when the window is the nearer of the two
 * (27 Nov: looking past an agent at a window 8 m away took its T / E / F keys away; the owner: 'I come close to you,
 * and I don't see E, F and T appear').
 */
export function windowBeatsAgent(windowDistance: number | null, agentDistance: number | null): boolean {
  if (windowDistance === null) return false
  return agentDistance === null || windowDistance < agentDistance
}

/**
 * The window he faces: the view's direction on the ground, from where he stands, crosses the window's width from its
 * front within `reach` (the walking camera looks down at him, so its middle meets the ground before a window that
 * hangs at head height; this is "turned towards it"). The nearest such.
 */
export function facedWindow(windows: BrowserWindowShape[], actor: Vec3, direction: Vec3, reach = AIM_REACH_M): string | null {
  const d = new THREE.Vector3(direction[0], 0, direction[2])
  if (d.lengthSq() < 1e-6) return null
  d.normalize()
  let best: { id: string; t: number } | null = null
  for (const w of windows) {
    const f = frameOf(w)
    const nFlat = new THREE.Vector3(f.normal.x, 0, f.normal.z)
    const rFlat = new THREE.Vector3(f.right.x, 0, f.right.z)
    if (nFlat.lengthSq() < 1e-6 || rFlat.lengthSq() < 1e-6) continue
    nFlat.normalize(); rFlat.normalize()
    const rel = new THREE.Vector3(actor[0] - f.center.x, 0, actor[2] - f.center.z)
    if (rel.dot(nFlat) <= 0) continue // behind it
    const denom = d.dot(nFlat)
    if (denom >= -1e-4) continue // not turned towards it
    const t = -rel.dot(nFlat) / denom
    if (t > reach) continue
    const hit = rel.clone().addScaledVector(d, t)
    if (Math.abs(hit.dot(rFlat)) > f.halfW) continue
    if (!best || t < best.t) best = { id: w.id, t }
  }
  return best?.id ?? null
}

/** The window he stands right in front of (on the ground, by its width), within `reach`; the nearest such. */
export function nearWindow(windows: BrowserWindowShape[], actor: Vec3, reach = NEAR_REACH_M): string | null {
  let best: { id: string; d: number } | null = null
  for (const w of windows) {
    const f = frameOf(w)
    const rel = new THREE.Vector3(actor[0] - f.center.x, 0, actor[2] - f.center.z)
    const nFlat = new THREE.Vector3(f.normal.x, 0, f.normal.z)
    if (nFlat.lengthSq() < 1e-6 || rel.dot(nFlat.normalize()) <= 0) continue // behind it
    const rFlat = new THREE.Vector3(f.right.x, 0, f.right.z)
    const along = rFlat.lengthSq() > 1e-6 ? rel.dot(rFlat.normalize()) : 0
    const clamped = Math.max(-f.halfW, Math.min(f.halfW, along))
    const d = rel.clone().sub(rFlat.clone().multiplyScalar(clamped)).length()
    if (d > reach) continue
    if (!best || d < best.d) best = { id: w.id, d }
  }
  return best?.id ?? null
}

/**
 * E's choice: the window the view's middle is on wins, even over an agent near (he is looking at it). One he faces or
 * stands right in front of only when no agent is near (E stays the agent's at its desk).
 */
export function browserWindowForE(aimed: string | null, facedOrNear: string | null, agentNear: boolean): string | null {
  return aimed ?? (agentNear ? null : facedOrNear)
}

export type FocusedWindowKey = 'leave' | 'page-down' | 'page-up' | 'line-down' | 'line-up' | 'top' | 'bottom'

/**
 * A key that reached the Oasis (not the page) while a browser window is focused. Esc leaves from anywhere, the
 * address bar too; E leaves like it closes an agent's view; the paging keys scroll the page (Page Down would
 * otherwise turn the pictures' slides). Typing in a field keeps its keys.
 */
export function focusedWindowKey(k: { code: string; typing: boolean; ctrl: boolean; alt: boolean; meta: boolean; shift: boolean; repeat?: boolean }): FocusedWindowKey | null {
  if (k.code === 'Escape') return 'leave'
  if (k.ctrl || k.alt || k.meta || k.typing) return null
  switch (k.code) {
    case 'KeyE': return k.repeat ? null : 'leave'
    case 'PageDown': return 'page-down'
    case 'PageUp': return 'page-up'
    case 'Space': return k.shift ? 'page-up' : 'page-down'
    case 'ArrowDown': return 'line-down'
    case 'ArrowUp': return 'line-up'
    case 'Home': return 'top'
    case 'End': return 'bottom'
    default: return null
  }
}

/**
 * A key inside the focused page (this Oasis's own page, which tells the Oasis its keys): Esc leaves, and E leaves
 * too unless he is typing in one of its fields (the owner, 27 Nov: "E enters a browser, but if I hit E again, it
 * doesn't exit... so if E enters, could we do E for exiting?").
 */
export function pageKeyLeaves(k: { code: string; typing: boolean; ctrl: boolean; alt: boolean; meta: boolean; repeat?: boolean }): boolean {
  if (k.code === 'Escape') return true
  return k.code === 'KeyE' && !k.typing && !k.ctrl && !k.alt && !k.meta && !k.repeat
}

/** Enter leaves a picture or an agent window that Enter zoomed into (a browser window's Enter is its page's). */
export function enterLeavesFocus(k: { code: string; typing: boolean; ctrl: boolean; alt: boolean; meta: boolean; shift: boolean; repeat?: boolean }, focused: { image: boolean; agentWindow: boolean; browser: boolean }): boolean {
  if (k.code !== 'Enter' && k.code !== 'NumpadEnter') return false
  if (k.typing || k.ctrl || k.alt || k.meta || k.shift || k.repeat) return false
  return focused.image || (focused.agentWindow && !focused.browser)
}

/** How far a paging key scrolls, in px, for a page `viewHeight` tall (a page is 90 % of it, a line 40 px). */
export function scrollFor(key: Exclude<FocusedWindowKey, 'leave'>, viewHeight: number, pageLength: number): { by?: number; to?: number } {
  const page = Math.max(40, Math.round(viewHeight * 0.9))
  switch (key) {
    case 'page-down': return { by: page }
    case 'page-up': return { by: -page }
    case 'line-down': return { by: 40 }
    case 'line-up': return { by: -40 }
    case 'top': return { to: 0 }
    case 'bottom': return { to: Math.max(0, pageLength) }
  }
}

/** A wheel event's travel in px (deltaMode 0 px, 1 lines, 2 pages). */
export function wheelPixels(deltaY: number, deltaMode: number, viewHeight: number): number {
  if (!Number.isFinite(deltaY)) return 0
  if (deltaMode === 1) return deltaY * 40
  if (deltaMode === 2) return deltaY * Math.max(40, viewHeight * 0.9)
  return deltaY
}

/**
 * The page's address made same-origin when it points at this Oasis under another of its names (localhost /
 * 127.0.0.1 / [::1], same port): then the Oasis can hear Esc inside it and scroll it. Anything else unchanged.
 */
export function sameOasisPath(url: string, here: { protocol: string; hostname: string; port: string }): string {
  let parsed: URL
  try { parsed = new URL(url) } catch { return url }
  const local = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
  if (parsed.protocol !== here.protocol || !local(parsed.hostname) || !local(here.hostname)) return url
  if ((parsed.port || '') !== (here.port || '')) return url
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

// ── which window E would open now (its "HIT E" prompt; BrowserWindowFocus sets it four times a second) ─────────
let underE: string | null = null
const underEListeners = new Set<() => void>()
export function setBrowserWindowUnderE(next: string | null): void {
  if (next === underE) return
  underE = next
  underEListeners.forEach(listener => listener())
}
export function getBrowserWindowUnderE(): string | null {
  return underE
}
export function subscribeBrowserWindowUnderE(listener: () => void): () => void {
  underEListeners.add(listener)
  return () => { underEListeners.delete(listener) }
}
