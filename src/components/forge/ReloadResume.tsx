'use client'

// ░▒▓ RELOAD RESUME — after a reload he stands where he was, and the agent view he had is open again ▓▒░
// What is kept and when it counts: lib/reload-resume.ts. This keeps it (every second, and when the page goes away)
// and puts it back once, when the world is in: the player and the camera, walking / flying, mouse-look (the browser
// gives it back only on a key or a click after a reload, so the first key does), and the agent view (E or F), once
// that agent is in the roster and in this world, through Companion's restoreVillageView (quiet: no spoken line).
// Companion keeps the page of the panel and the place in its thread (components/village/thread-anchor.ts).

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'
import { getPlayerAvatarPose, getPlayerCameraOrbit, requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import { RESUME_KEY, captureResume, readResume, type ResumeState } from '../../lib/reload-resume'
import { currentVillageView, restoreVillageView } from '../village/village-actions'
import { isVillageAgentHere } from '../village/village-worlds'

/** After the world is in, let the spawn pieces (onboarding, rookie, portal arrival) go first. */
const SETTLE_MS = 600
/** How long the open agent may take to come into the roster (the engine connects after the world loads). */
const PANEL_WAIT_MS = 30_000
/** Nothing restored by then (no world came): stop waiting and start keeping. */
const GIVE_UP_MS = 120_000
/** The first key gives mouse-look back for this long after a reload. */
const LOOK_KEY_MS = 10 * 60_000

/** Once per page: a hot update of this file remounts it, and must not put him back a second time. */
const DONE_KEY = '__oasisReloadResumeDone'
const pageFlags = globalThis as unknown as Record<string, boolean | undefined>

function readStored(): string | null {
  try { return window.sessionStorage.getItem(RESUME_KEY) } catch { return null }
}

function writeStored(state: ResumeState): void {
  try { window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(state)) } catch { /* storage full or blocked */ }
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return Boolean(el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Mouse-look back: now if the browser allows, else on the first key in the world (a key counts as a user's ask).
 * The listener lives on its own (a remount of this component must not drop it) and goes after one use or LOOK_KEY_MS.
 */
function giveLookBackAfterReload(): void {
  const input = useInputManager.getState()
  input.requestPointerLock()
  const until = Date.now() + LOOK_KEY_MS
  const onKey = (event: KeyboardEvent) => {
    const now = useInputManager.getState()
    if (Date.now() > until || now.pointerLocked) return stop()
    if (event.repeat || event.key === 'Escape' || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return
    if (now._uiLayerStack.length > 0 || (now.inputState !== 'third-person' && now.inputState !== 'noclip')) return
    stop()
    now.requestPointerLock()
  }
  const stop = () => window.removeEventListener('keydown', onKey, true)
  window.addEventListener('keydown', onKey, true)
}

export function ReloadResume() {
  const camera = useThree(state => state.camera)

  useEffect(() => {
    const mountedAt = Date.now()
    let phase: 'world' | 'panel' | 'done' = pageFlags[DONE_KEY] ? 'done' : 'world'
    let readyAt = 0
    let saved: ResumeState | null = null
    // Remounted by a hot update: carry on from what is kept (the flying camera while a panel is open lives only there).
    let kept: ResumeState | null = phase === 'done' ? readResume(readStored(), mountedAt, useOasisStore.getState().activeWorldId) : null
    let panelSince = 0
    let lockLostAt = -Infinity
    const timers: ReturnType<typeof setTimeout>[] = []

    const unsubscribeLock = useInputManager.subscribe((state, prev) => {
      if (prev.pointerLocked && !state.pointerLocked) lockLostAt = Date.now()
    })

    const keep = () => {
      if (phase !== 'done') return
      const store = useOasisStore.getState()
      const input = useInputManager.getState()
      const pose = getPlayerAvatarPose()
      const next = captureResume(kept, {
        at: Date.now(),
        worldId: store.activeWorldId,
        worldReady: store._worldReady,
        inputState: input.inputState,
        previousCameraState: input._previousCameraState,
        locked: input.pointerLocked || Boolean(document.pointerLockElement),
        lockLostAt,
        lookBeforeFocus: input._lookBeforeFocus,
        player: pose ? { position: pose.position, yaw: pose.yaw } : null,
        orbit: getPlayerCameraOrbit(),
        camera: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
        },
        view: currentVillageView(),
      })
      if (next) { kept = next; writeStored(next) }
    }

    const placeCamera = (state: ResumeState) => {
      if (state.mode !== 'noclip' || !state.camera) return
      camera.position.set(...state.camera.position)
      camera.quaternion.set(...state.camera.quaternion)
      camera.updateMatrixWorld()
    }

    const restorePlace = (state: ResumeState) => {
      if (state.player) {
        const { position, yaw } = state.player
        requestPlayerAvatarTeleport({
          position,
          yaw,
          forward: [Math.sin(yaw), 0, Math.cos(yaw)],
          ...(state.mode === 'third-person' && state.orbit ? { camera: state.orbit } : {}),
        })
      }
      placeCamera(state)
      timers.push(setTimeout(() => placeCamera(state), 150))
    }

    const finish = () => {
      phase = 'done'
      pageFlags[DONE_KEY] = true
      kept = saved
      keep()
    }

    const tick = () => {
      const now = Date.now()
      if (phase === 'done') return
      if (now - mountedAt > GIVE_UP_MS) { finish(); return }
      const store = useOasisStore.getState()
      if (phase === 'world') {
        if (!store._worldReady) { readyAt = 0; return }
        if (!readyAt) readyAt = now
        if (now - readyAt < SETTLE_MS) return
        saved = readResume(readStored(), now, store.activeWorldId)
        if (!saved) { finish(); return }
        restorePlace(saved)
        if (saved.panel) { phase = 'panel'; panelSince = now; return }
        if (saved.look) giveLookBackAfterReload()
        finish()
        return
      }
      // phase 'panel': the open agent comes back when the engine has it here
      const panel = saved?.panel
      if (!panel || now - panelSince > PANEL_WAIT_MS) { finish(); return }
      if (!store.agentEngine.agents[panel.agentId] || !isVillageAgentHere(panel.agentId)) return
      restoreVillageView({ kind: panel.view, agentId: panel.agentId })
      // Leaving the panel gives mouse-look back if it was on (input-manager's look-before-focus).
      if (saved?.look && useInputManager.getState().inputState === 'agent-focus') useInputManager.setState({ _lookBeforeFocus: true })
      finish()
    }

    let beats = 0
    const interval = setInterval(() => {
      tick()
      beats += 1
      if (beats % 4 === 0) keep()
    }, 250)
    const onHide = () => keep()
    const onVisibility = () => { if (document.visibilityState === 'hidden') keep() }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      keep()
      clearInterval(interval)
      timers.forEach(clearTimeout)
      unsubscribeLock()
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [camera])

  return null
}
