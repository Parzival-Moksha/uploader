'use client'

// ░▒▓ BROWSER WINDOW FOCUS — E opens a browser window in the world, Esc leaves it on the first press ▓▒░
// What E means and what a key does while one is focused: lib/browser-window-focus.ts. Here:
// - one keydown listener on window, capture, added when this module loads, so it hears E and Esc before the
//   village's and the menu's (they add theirs when they mount): E on a browser window focuses it (the camera
//   zooms, as Enter on a selected window always did); while one is focused, Esc / E / the paging keys that
//   reach the Oasis are this window's.
// - while one is focused: its page gets the keyboard (Page Up / Down and typing go to it); a page of this Oasis
//   (same origin) also tells us its own Esc, so Esc leaves even after a click into the page; the wheel anywhere
//   but another panel scrolls the page instead of the camera. A page from another site keeps its keys to itself
//   (browsers allow no listening in): the keys come back to the Oasis when the mouse leaves the page.
// Leaving is what Esc out of an agent's screen does (handleEscape: back to walking or flying, mouse-look as it
// was); CameraController puts the camera back where it was.

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'
import { dispatch } from '../../lib/event-bus'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { resolveAgentWindowRenderScale } from '../../lib/agent-avatar-utils'
import { canFocusAgentWindowForViewer, type AgentWindow } from '../../lib/agent-window-types'
import { getViewerUserIdClient } from '../../lib/viewer-identity-client'
import { SPATIAL_WEB_INTERACTION_RADIUS, findNearestSpatialWebObject, resolveSpatialWebObjectPosition } from '../../lib/spatial-web'
import {
  aimedWindow, aimedWindowHit, browserWindowForE, enterLeavesFocus, facedWindow, focusedWindowKey, pageKeyLeaves, nearWindow, scrollFor, setBrowserWindowUnderE, wheelPixels, windowBeatsAgent,
  type BrowserWindowShape, type Vec3,
} from '../../lib/browser-window-focus'
import { addVillageProximityRival } from '../village/village-actions'

function frameFor(id: string): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(`iframe[data-browser-window="${CSS.escape(id)}"]`)
}

/** The page's window when it is this Oasis's own page (same origin), else null. */
function samePage(frame: HTMLIFrameElement | null): Window | null {
  try {
    const win = frame?.contentWindow
    if (!win) return null
    void win.document.body // throws for another site
    return win
  } catch { return null }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function focusedBrowserWindow(): AgentWindow | null {
  const store = useOasisStore.getState()
  const id = store.focusedAgentWindowId
  if (!id) return null
  return store.placedAgentWindows.find(w => w.id === id && w.agentType === 'browser') || null
}

function browserWindowShapes(): BrowserWindowShape[] {
  const store = useOasisStore.getState()
  const viewer = getViewerUserIdClient()
  return store.placedAgentWindows
    .filter(w => w.agentType === 'browser' && store.behaviors[w.id]?.visible !== false && canFocusAgentWindowForViewer(w, viewer))
    .map(w => {
      const t = store.transforms[w.id]
      return {
        id: w.id,
        position: (t?.position || w.position) as Vec3,
        rotation: (t?.rotation || w.rotation || [0, 0, 0]) as Vec3,
        width: w.width || 800,
        height: w.height || 600,
        scale: resolveAgentWindowRenderScale(w, t),
      }
    })
}

function actorNow(): Vec3 | null {
  const camera = getCameraSnapshot()
  const pose = getPlayerAvatarPose()
  return useInputManager.getState().inputState === 'third-person' && pose ? pose.position : camera ? camera.position : null
}

/** The browser window the view's middle is on (looked at, within reach), with how far it is, or null. */
function aimedBrowserWindowNow(): { id: string; distance: number } | null {
  const windows = browserWindowShapes()
  const camera = getCameraSnapshot()
  const actor = actorNow()
  if (!windows.length || !camera || !actor) return null
  return aimedWindowHit(windows, camera.position, camera.forward, actor)
}

/**
 * The functional object (Spells > Create > Functional: slider, button...) in reach, and how far it is on the ground.
 * The owner, 27 Nov: "I go close to the slider and I hit F and I can adjust it. But if an agent is close to me, then F
 * goes to the agent." One rule now: the nearer of the two takes the keys (the agent's T / E / F step aside, the object
 * shows its E), and E uses an object as it opens everything else (F still does too).
 */
export function nearestFunctionalObject(actor: Vec3 | null = actorNow()): { id: string; distance: number } | null {
  if (!actor) return null
  const store = useOasisStore.getState()
  const nearest = findNearestSpatialWebObject(store.spatialWebObjects, actor, store.transforms, SPATIAL_WEB_INTERACTION_RADIUS)
  if (!nearest) return null
  const at = resolveSpatialWebObjectPosition(nearest, store.transforms[nearest.id])
  return { id: nearest.id, distance: Math.hypot(at[0] - actor[0], at[2] - actor[2]) }
}

/** The browser window E means now, or null (then E stays the village's / the world's). */
export function browserWindowUnderE(): string | null {
  const windows = browserWindowShapes()
  if (!windows.length) return null
  const input = useInputManager.getState()
  const camera = getCameraSnapshot()
  const base = input.inputState
  const pose = getPlayerAvatarPose()
  const actor: Vec3 | null = base === 'third-person' && pose ? pose.position : camera ? camera.position : null
  if (!actor) return null
  const aimed = camera ? aimedWindow(windows, camera.position, camera.forward, actor) : null
  // Walking: the window he is turned towards (the camera's direction on the ground). Flying: only the one looked at.
  const faced = base === 'third-person' && camera ? facedWindow(windows, actor, camera.forward) : null
  const agentNear = Boolean(useOasisStore.getState().agentEngine.nearbyAgentId)
  return browserWindowForE(aimed, faced ?? nearWindow(windows, actor), agentNear)
}

export function leaveBrowserWindow(): void {
  const win = focusedBrowserWindow()
  const frame = win ? frameFor(win.id) : null
  // The keys come back to the Oasis (a page that kept them would swallow the next E and Esc).
  try { (samePage(frame)?.document.activeElement as HTMLElement | null)?.blur?.() } catch { /* gone */ }
  if (frame && document.activeElement === frame) frame.blur()
  const input = useInputManager.getState()
  if (input.inputState === 'agent-focus') input.handleEscape()
  dispatch({ type: 'UNFOCUS_AGENT_WINDOW' })
}

function scrollPage(id: string, key: Exclude<ReturnType<typeof focusedWindowKey>, 'leave' | null>): void {
  const page = samePage(frameFor(id))
  if (!page) return
  const s = scrollFor(key, page.innerHeight, page.document.documentElement.scrollHeight)
  if (typeof s.to === 'number') page.scrollTo({ top: s.to })
  else page.scrollBy({ top: s.by || 0 })
  // Hand the page the keyboard, so the next keys go straight in.
  page.focus()
}

/** Leave a picture or a (non-browser) agent window: what Esc does (camera and mouse-look back). */
function leaveWorldFocus(): void {
  const input = useInputManager.getState()
  if (input.inputState === 'agent-focus') input.handleEscape()
  dispatch({ type: 'UNFOCUS_AGENT_WINDOW' })
  dispatch({ type: 'UNFOCUS_IMAGE' })
}

function onKeyDown(event: KeyboardEvent): void {
  // The key that zoomed in zooms out: Enter on a picture or an agent window (Enter zoomed into it).
  const store = useOasisStore.getState()
  const focusedWindow = store.focusedAgentWindowId ? store.placedAgentWindows.find(w => w.id === store.focusedAgentWindowId) : null
  if (enterLeavesFocus(
    { code: event.code, typing: isTypingTarget(event.target), ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey, repeat: event.repeat },
    { image: Boolean(store.focusedImageId), agentWindow: Boolean(focusedWindow), browser: focusedWindow?.agentType === 'browser' },
  )) {
    event.preventDefault()
    event.stopImmediatePropagation()
    leaveWorldFocus()
    return
  }
  const win = focusedBrowserWindow()
  if (win) {
    const action = focusedWindowKey({
      code: event.code, typing: isTypingTarget(event.target), ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey,
      shift: event.shiftKey, repeat: event.repeat,
    })
    if (!action) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (action === 'leave') leaveBrowserWindow()
    else scrollPage(win.id, action)
    return
  }
  if (event.code !== 'KeyE' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  if (isTypingTarget(event.target)) return
  const input = useInputManager.getState()
  if (!input.can().enterFocuses || input._uiLayerStack.length > 0) return
  if (useOasisStore.getState().agentEngine.focusedAgentId) return // an agent's view is open: E is its
  // A functional object in reach that is nearer than any agent (no agent holds the keys then): E uses it.
  const thing = useOasisStore.getState().agentEngine.nearbyAgentId ? null : nearestFunctionalObject()
  if (thing) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void useOasisStore.getState().interactSpatialWebObject(thing.id, 'press')
    return
  }
  const id = browserWindowUnderE()
  if (!id) return
  event.preventDefault()
  event.stopImmediatePropagation()
  dispatch({ type: 'FOCUS_AGENT_WINDOW', payload: { id } })
}

// Added once per page, at module load (before the village's and the menu's capture listeners); a hot update swaps it.
const HOOK_KEY = '__oasisBrowserWindowKeys'
if (typeof window !== 'undefined') {
  const holder = window as unknown as Record<string, ((event: KeyboardEvent) => void) | undefined>
  const previous = holder[HOOK_KEY]
  if (previous) window.removeEventListener('keydown', previous, { capture: true })
  holder[HOOK_KEY] = onKeyDown
  window.addEventListener('keydown', onKeyDown, { capture: true })
}

/** While a browser window is focused: its page gets the keyboard, its own Esc, and the wheel. */
export function BrowserWindowFocus() {
  // The prompt: four times a second, which window E would open (none while something holds focus).
  useEffect(() => {
    const tick = () => {
      const input = useInputManager.getState()
      const free = input.can().enterFocuses && input._uiLayerStack.length === 0 && !useOasisStore.getState().agentEngine.focusedAgentId
      setBrowserWindowUnderE(free ? browserWindowUnderE() : null)
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => { clearInterval(timer); setBrowserWindowUnderE(null) }
  }, [])

  // Looking straight at a window takes the village's E and prompt from an agent standing near (a proximity rival,
  // like the mission wall): one E prompt on screen, the one E opens.
  // Only when the window is the nearer of the two: an agent beside him keeps its keys while he looks past it.
  // A functional object nearer than the agent takes them too (its E plate shows instead of the agent's keys).
  useEffect(() => addVillageProximityRival((actor, agentDistance) => actor !== null && (
    windowBeatsAgent(aimedBrowserWindowNow()?.distance ?? null, agentDistance)
    || windowBeatsAgent(nearestFunctionalObject(actor as Vec3)?.distance ?? null, agentDistance)
  )), [])

  const focusedId = useOasisStore(s => {
    const id = s.focusedAgentWindowId
    return id && s.placedAgentWindows.some(w => w.id === id && w.agentType === 'browser') ? id : null
  })

  useEffect(() => {
    if (!focusedId) return
    let stopped = false
    let frame: HTMLIFrameElement | null = null
    let page: Window | null = null
    const onPageKey = (event: KeyboardEvent) => {
      if (!pageKeyLeaves({ code: event.code, typing: isTypingTarget(event.target), ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, repeat: event.repeat })) return
      event.preventDefault()
      event.stopPropagation()
      leaveBrowserWindow()
    }
    // A page of this Oasis: hear its Esc, give it the keyboard. Again after every navigation inside it.
    const attach = () => {
      page?.removeEventListener('keydown', onPageKey, true)
      page = samePage(frame)
      if (!page) return
      page.addEventListener('keydown', onPageKey, true)
      page.focus()
    }
    const onLoad = () => attach()
    // Another site's page keeps its keys while it has focus: the mouse off the page gives them back to the Oasis.
    const onParentMove = () => {
      if (frame && !page && document.activeElement === frame) frame.blur()
    }
    // The wheel anywhere but another panel scrolls the page (not the camera).
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      const own = frame?.closest('[data-ui-panel]') || null
      const panel = target?.closest?.('[data-ui-panel]') || null
      if (panel && panel !== own) return
      event.preventDefault()
      event.stopPropagation()
      const p = samePage(frame)
      if (p) p.scrollBy({ top: wheelPixels(event.deltaY, event.deltaMode, p.innerHeight) })
    }
    const find = () => {
      if (stopped) return
      frame = frameFor(focusedId)
      if (!frame) { timer = setTimeout(find, 100); return }
      frame.addEventListener('load', onLoad)
      if (frame.contentDocument?.readyState === 'complete' || samePage(frame)?.document.readyState === 'complete') attach()
    }
    let timer: ReturnType<typeof setTimeout> = setTimeout(find, 0)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    document.addEventListener('mousemove', onParentMove)
    return () => {
      stopped = true
      clearTimeout(timer)
      frame?.removeEventListener('load', onLoad)
      page?.removeEventListener('keydown', onPageKey, true)
      window.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('mousemove', onParentMove)
    }
  }, [focusedId])

  return null
}
