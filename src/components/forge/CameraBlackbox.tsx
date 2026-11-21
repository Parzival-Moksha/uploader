'use client'

// Records every drawn frame of the main camera into the camera black box (lib/camera-blackbox.ts), which saves the
// last frames to this PC when it sees a spin. Mounted last inside the Canvas, so it sees where the others left it.
//
// The Alt-Tab spin (owner, 21 Nov, six reports): with an agent's panel or screen open, coming back after the window
// lost focus put the camera kilometres away (5 km, then 13 km), and it flew back tumbling. Two more things here:
// - whoever writes a far camera position is caught: position.set / copy / lerpVectors / add... are wrapped, and the
//   first write more than FAR_M from the origin (or not a number) notes the caller's stack, which saves a file;
// - while an agent is focused (its panel or screen), a camera thrown further than FOCUS_FAR_M from that agent goes
//   back to the last good pose, so nothing spins while the cause is found.

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { noteCameraEvent, recordFrame } from '../../lib/camera-blackbox'
import { useInputManager } from '../../lib/input-manager'
import { isDragLookOn } from '../../lib/drag-look'
import { getAwayState } from '../../lib/away-mode'
import { useGameMenu } from '../../lib/game-menu/menu-store'
import { useOasisStore } from '../../store/oasisStore'
import { getVillageStation } from '../village/village-actions'

const dir = new THREE.Vector3()
const FAR_M = 1000
const FOCUS_FAR_M = 300

function farOrBroken(v: THREE.Vector3): boolean {
  return !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || Math.hypot(v.x, v.y, v.z) > FAR_M
}

/** Wrap the camera position's writers: the first far write notes who did it (once every 10 s). */
function watchWriters(position: THREE.Vector3): () => void {
  const names = ['set', 'copy', 'lerp', 'lerpVectors', 'add', 'addScaledVector', 'setFromMatrixPosition', 'applyMatrix4', 'fromArray', 'setFromSpherical'] as const
  const originals = new Map<string, unknown>()
  let lastNote = 0
  for (const name of names) {
    const own = (position as unknown as Record<string, (...args: unknown[]) => unknown>)[name]
    if (typeof own !== 'function') continue
    originals.set(name, Object.prototype.hasOwnProperty.call(position, name) ? own : undefined)
    ;(position as unknown as Record<string, unknown>)[name] = function (this: THREE.Vector3, ...args: unknown[]) {
      const result = own.apply(this, args)
      if (farOrBroken(this) && performance.now() - lastNote > 10_000) {
        lastNote = performance.now()
        const stack = (new Error().stack || '').split('\n').slice(2, 9).map(line => line.trim().replace(/\(.*[\\/]/, '(')).join(' < ')
        noteCameraEvent(`camera put at (${this.x.toFixed(0)}, ${this.y.toFixed(0)}, ${this.z.toFixed(0)}) by position.${name}, input ${useInputManager.getState().inputState}: ${stack}`)
      }
      return result
    }
  }
  return () => {
    for (const [name, own] of originals) {
      if (own === undefined) delete (position as unknown as Record<string, unknown>)[name]
      else (position as unknown as Record<string, unknown>)[name] = own
    }
  }
}

export function CameraBlackbox() {
  const camera = useThree(s => s.camera)
  const good = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null)

  useEffect(() => watchWriters(camera.position), [camera])

  useFrame((state, delta) => {
    const cam = state.camera
    const input = useInputManager.getState()

    // Agent focus: a camera thrown far from the focused agent goes back to the last good pose.
    const focused = useOasisStore.getState().agentEngine.focusedAgentId
    if (focused && input.inputState === 'agent-focus') {
      const station = getVillageStation(focused)
      const far = station
        ? Math.hypot(cam.position.x - station.anchor[0], cam.position.z - station.anchor[2]) > FOCUS_FAR_M || Math.abs(cam.position.y - station.anchor[1]) > FOCUS_FAR_M
        : farOrBroken(cam.position)
      const broken = !Number.isFinite(cam.position.x + cam.position.y + cam.position.z + cam.quaternion.x + cam.quaternion.w)
      if ((far || broken) && good.current) {
        noteCameraEvent(`agent focus: camera was ${broken ? 'broken (NaN)' : `at (${cam.position.x.toFixed(0)}, ${cam.position.y.toFixed(0)}, ${cam.position.z.toFixed(0)})`}, put back`)
        cam.position.copy(good.current.position)
        cam.quaternion.copy(good.current.quaternion)
        cam.updateMatrixWorld()
      }
    }
    if (!farOrBroken(cam.position) && Number.isFinite(cam.quaternion.w)) {
      if (!good.current) good.current = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
      good.current.position.copy(cam.position)
      good.current.quaternion.copy(cam.quaternion)
    }

    cam.getWorldDirection(dir)
    recordFrame({
      t: Math.round(performance.now()),
      dt: +delta.toFixed(4),
      yaw: +Math.atan2(dir.x, dir.z).toFixed(4),
      pitch: +Math.asin(Math.max(-1, Math.min(1, dir.y))).toFixed(4),
      x: +cam.position.x.toFixed(2),
      y: +cam.position.y.toFixed(2),
      z: +cam.position.z.toFixed(2),
      input: input.inputState,
      prevCam: input._previousCameraState ?? null,
      locked: input.pointerLocked,
      dragLook: isDragLookOn(),
      menu: useGameMenu.getState().phase,
      resting: getAwayState().resting,
      focus: document.hasFocus(),
      visible: document.visibilityState === 'visible',
    })
  })
  return null
}
