'use client'

// A trip to another world from the World menu (or "Go there"): the camera goes to him in third person, a portal opens
// one step ahead with the active placement effect, his controls are held while he steps in, the travel view holds
// until the new world has loaded, and he rolls out of a portal at the new world's middle, which then closes.
// The rules (world-travel.ts) and the exit (world-travel-exit.ts) are shared with portals placed in a world.
//
// Never a trap: Escape skips (controls back at once, the switch carries on and he lands at the spawn); a world that
// doesn't load brings him back out where he stood, with a notice; after 30 s of loading he gets his controls back
// whatever happens; and a hard limit of 45 s ends any trip. Settings, World VFX, "Walk through a portal" off: a cut.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, type InputState } from '../../lib/input-manager'
import {
  getPlayerAvatarPose,
  requestPlayerAvatarTeleport,
  setPlayerCinematic,
  type PlayerAvatarPose,
} from '../../lib/player-avatar-runtime'
import {
  PORTAL_TRANSITION_ABORT_EVENT,
  PORTAL_TRANSITION_READY_EVENT,
  PORTAL_TRANSITION_START_EVENT,
  preloadPortalRevealRoll,
  readPortalTransitionSettings,
} from '../../lib/portal-transition-settings'
import { arrivalPose, departurePortal, returnPose, TRAVEL, waitForTravelOutcome, type TravelOutcome } from '../../lib/world-travel'
import {
  closeTravelPortal,
  isWorldTravelActive,
  openTravelExit,
  openTravelPortal,
  setWorldTravelActive,
  setWorldTravelDirectorMounted,
  WORLD_TRAVEL_EVENT,
  type WorldTravelRequest,
} from '../../lib/world-travel-exit'
import { animatePortalCameraSwallow, settlePortalArrivalCamera } from './PortalGateLayer'
import { showNotice } from './GlobalNotice'
import { getWorldLoadState } from '../../lib/world-load-progress'

const BASE_CAMERAS: InputState[] = ['orbit', 'noclip', 'third-person']
/** Part of the tunnel still shown after the new world is in (the rest of the travel view was the load itself). */
const TUNNEL_TAIL_MS = 700

const note = (phase: string) => console.info(`[WorldTravel] ${phase}`)
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))
const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))

async function runTrip(camera: THREE.Camera, request: WorldTravelRequest): Promise<void> {
  const store = useOasisStore.getState()
  const origin = store.activeWorldId
  const { worldId, worldName } = request
  if (isWorldTravelActive() || !worldId || worldId === origin) {
    note(`request for ${worldId} not taken (${isWorldTravelActive() ? 'a trip is on' : 'already there'})`)
    return
  }
  note(`request for ${worldId} from ${origin}`)
  setWorldTravelActive(true)

  // The menu that asked closes first and hands the input back.
  await nextFrame()
  await sleep(60)
  const input = useInputManager.getState()
  const departure = getPlayerAvatarPose()
  if (!departure || input.hasActiveUILayer()) {
    // No body to walk, or a panel still holds the screen: the plain switch.
    note(`plain switch: ${!departure ? 'no body to walk' : `a panel is open (${input._uiLayerStack.join(', ')})`}`)
    setWorldTravelActive(false)
    store.switchWorld(worldId)
    return
  }

  const settings = readPortalTransitionSettings()
  const baseBefore: InputState = BASE_CAMERAS.includes(input.inputState)
    ? input.inputState
    : (input._previousCameraState && BASE_CAMERAS.includes(input._previousCameraState) ? input._previousCameraState : 'third-person')
  const outboundId = `travel-out-${Date.now().toString(36)}`
  let skipped = false
  let finished = false
  let uiFocused = false
  let switched = false
  const wakers = new Set<() => void>()
  const wake = () => { for (const w of [...wakers]) w() }
  /** A pause that a skip (Escape) cuts short. */
  const pause = (ms: number) => new Promise<void>(resolve => {
    if (skipped) { resolve(); return }
    const done = () => { window.clearTimeout(timer); wakers.delete(done); resolve() }
    const timer = window.setTimeout(done, ms)
    wakers.add(done)
  })

  // His controls are held: keys (Escape skips), clicks and the wheel do nothing during the trip.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !skipped) { skipped = true; wake() }
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onPointer = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', onKey, true)
  for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'contextmenu']) window.addEventListener(type, onPointer, { capture: true, passive: false })

  const finish = (outcome: TravelOutcome | 'skipped' | 'limit') => {
    if (finished) return
    finished = true
    note(`done (${outcome}): controls back`)
    window.clearTimeout(hardLimit)
    window.removeEventListener('keydown', onKey, true)
    for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'contextmenu']) window.removeEventListener(type, onPointer, { capture: true } as EventListenerOptions)
    setPlayerCinematic(null)
    const im = useInputManager.getState()
    if (uiFocused && im.inputState === 'ui-focused') im.returnToPrevious()
    if (baseBefore !== 'third-person' && useInputManager.getState().inputState === 'third-person') useInputManager.getState().transition(baseBefore)
    if (outcome !== 'arrived') window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_ABORT_EVENT))
    // The portal he left by belongs to the world he left: gone either way (if he came back, it closes after him).
    window.setTimeout(() => closeTravelPortal(outboundId), outcome === 'failed' ? TRAVEL.exitCloseMs : 0)
    setWorldTravelActive(false)
  }
  // Whatever happens, never longer than this.
  const hardLimit = window.setTimeout(() => {
    console.warn('[WorldTravel] the trip hit its hard limit: controls back')
    skipped = true
    wake()
    finish('limit')
  }, TRAVEL.hardLimitMs)

  /** How the trip ends; with `escapable`, Escape ends the wait at once ('skipped'). */
  const waitForOutcome = (issuedAt: number, escapable: boolean) => waitForTravelOutcome({
    read: () => useOasisStore.getState(),
    target: worldId,
    origin,
    skipped: () => escapable && skipped,
    now: () => performance.now(),
    wait: sleep,
    issuedAt,
  })
  const worldNameOf = (id: string | null) => useOasisStore.getState().worldRegistry.find(entry => entry.id === id)?.name || 'another world'
  /** Skipped: his controls are back already; he lands at the spawn once the world is in, without the show. */
  const landAfterSkip = async (issuedAt: number) => {
    const outcome = await waitForOutcome(issuedAt, false)
    if (outcome === 'arrived') requestPlayerAvatarTeleport(arrivalPose())
    else if (outcome === 'failed') showNotice(`${worldName || 'That world'} did not open. You are still here.`, 'warn')
    else if (outcome === 'elsewhere') showNotice(`${worldNameOf(useOasisStore.getState().activeWorldId)} opened instead of ${worldName || 'the world you chose'}: an agent changed the world while you travelled.`, 'info')
  }

  try {
    if (settings.rollReveal) void preloadPortalRevealRoll()
    // 1. The camera to him, his controls held.
    if (input.inputState !== 'third-person') input.transition('third-person')
    setPlayerCinematic({ target: null, speed: TRAVEL.stepSpeed })

    // 2. A portal opens one step ahead.
    const gate = departurePortal(departure, origin, outboundId)
    openTravelPortal(gate)
    note('portal open')
    await pause(TRAVEL.openMs)

    // 3. He steps in.
    if (!skipped) {
      setPlayerCinematic({ target: [gate.position[0], gate.position[2]], speed: TRAVEL.stepSpeed })
      const stepStart = performance.now()
      while (!skipped && performance.now() - stepStart < TRAVEL.stepTimeoutMs) {
        const pose = getPlayerAvatarPose()
        if (pose && Math.hypot(pose.position[0] - gate.position[0], pose.position[2] - gate.position[2]) < TRAVEL.inDistance) break
        await sleep(30)
      }
    }
    setPlayerCinematic({ target: null, speed: 0 })
    note(skipped ? 'skipped before the step ended' : 'stepped in')

    // 4. Inside: the camera is swallowed, the travel view starts, the new world loads (as long as it takes).
    if (!skipped && settings.enabled) {
      window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_START_EVENT, {
        detail: { settings, gateLabel: worldName ? `To ${worldName}` : 'Travel', targetWorldName: worldName, variant: gate.variant },
      }))
      useInputManager.getState().enterUIFocus()
      uiFocused = true
      void animatePortalCameraSwallow(camera, gate, settings)
      await pause(settings.swallowSeconds * 1000)
    }
    const issuedAt = performance.now()
    switched = true
    useOasisStore.getState().switchWorld(worldId)
    note(`switching to ${worldId}`)

    if (skipped) {
      finish('skipped')
      await landAfterSkip(issuedAt)
      return
    }

    // Escape during the load gives the controls back at once (Merge Goat, 23 Nov); the switch goes on.
    const outcome = await waitForOutcome(issuedAt, true)
    note(`outcome ${outcome} after ${Math.round(performance.now() - issuedAt)} ms`)
    if (finished) return
    if (outcome === 'skipped') {
      finish('skipped')
      await landAfterSkip(issuedAt)
      return
    }
    if (outcome === 'arrived') {
      // 5. Out at the new world's middle: the travel view ends, a portal at his back, the roll, it closes.
      const arrival = arrivalPose()
      requestPlayerAvatarTeleport(arrival)
      settlePortalArrivalCamera(camera, arrival)
      window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_READY_EVENT))
      // The travel view holds while the new world's assets come in (the overlay follows the same loading flag), but
      // that flag counts every asset in the scene and can stay up: past TRAVEL.assetWaitMs the view ends anyway.
      const assetsUntil = performance.now() + TRAVEL.assetWaitMs
      while (!skipped && getWorldLoadState().isLoading && performance.now() < assetsUntil) await sleep(60)
      if (skipped) { finish('skipped'); return }
      if (getWorldLoadState().isLoading) {
        note('assets still loading at the limit: the travel view ends anyway')
        window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_ABORT_EVENT))
      }
      await pause(TUNNEL_TAIL_MS)
      if (uiFocused && useInputManager.getState().inputState === 'ui-focused') useInputManager.getState().returnToPrevious()
      uiFocused = false
      if (settings.rollReveal) openTravelExit(arrival, worldId, { targetWorldName: worldName })
      await pause(TRAVEL.exitCloseMs)
      const after = getPlayerAvatarPose()
      if (after) note(`out: ${Math.hypot(after.position[0] - arrival.position[0], after.position[2] - arrival.position[2]).toFixed(2)} m from where he appeared`)
      finish('arrived')
      return
    }

    // 6. It didn't open (or is still loading after 30 s, or another world came in): controls back, and words for it.
    window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_ABORT_EVENT))
    if (outcome === 'elsewhere') {
      // An agent switched the world (load_world) while he travelled: he comes out at the middle of that one.
      const there = useOasisStore.getState().activeWorldId
      const arrival = arrivalPose()
      requestPlayerAvatarTeleport(arrival)
      settlePortalArrivalCamera(camera, arrival)
      if (uiFocused && useInputManager.getState().inputState === 'ui-focused') useInputManager.getState().returnToPrevious()
      uiFocused = false
      if (settings.rollReveal) openTravelExit(arrival, there)
      showNotice(`${worldNameOf(there)} opened instead of ${worldName || 'the world you chose'}: an agent changed the world while you travelled.`, 'info')
    } else if (outcome === 'failed') {
      const back: PlayerAvatarPose = returnPose(departure)
      requestPlayerAvatarTeleport(back)
      settlePortalArrivalCamera(camera, back)
      if (uiFocused && useInputManager.getState().inputState === 'ui-focused') useInputManager.getState().returnToPrevious()
      uiFocused = false
      if (settings.rollReveal) openTravelExit(back, origin)
      showNotice(`${worldName || 'That world'} did not open. You are back where you were.`, 'warn')
    } else {
      showNotice(`${worldName || 'The world'} is taking long to load: your controls are back, you will be there when it is in.`, 'info')
    }
    finish(outcome)
    if (outcome === 'timeout') {
      // Still loading: when it does come in (within a minute more), he comes out at its middle all the same.
      const lateUntil = performance.now() + 60_000
      for (;;) {
        const state = useOasisStore.getState()
        if (state._worldReady && state.activeWorldId === worldId) {
          const arrival = arrivalPose()
          requestPlayerAvatarTeleport(arrival)
          if (settings.rollReveal) openTravelExit(arrival, worldId, { targetWorldName: worldName })
          note('arrived late: out at the middle')
          break
        }
        if ((state._worldReady && state.activeWorldId !== worldId) || performance.now() > lateUntil) break
        await sleep(200)
      }
    }
  } catch (error) {
    console.error('[WorldTravel] trip failed', error)
    if (!switched) useOasisStore.getState().switchWorld(worldId)
    finish('limit')
  }
}

export function WorldTravelDirector() {
  const { camera } = useThree()
  useEffect(() => {
    setWorldTravelDirectorMounted(true)
    document.documentElement.dataset.worldTravel = 'ready'
    const onTravel = (event: Event) => {
      const detail = (event as CustomEvent<WorldTravelRequest>).detail
      if (detail?.worldId) void runTrip(camera, detail)
    }
    window.addEventListener(WORLD_TRAVEL_EVENT, onTravel)
    return () => {
      setWorldTravelDirectorMounted(false)
      delete document.documentElement.dataset.worldTravel
      window.removeEventListener(WORLD_TRAVEL_EVENT, onTravel)
    }
  }, [camera])
  return null
}
