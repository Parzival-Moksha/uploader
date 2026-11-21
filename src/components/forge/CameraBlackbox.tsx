'use client'

// Records every drawn frame of the main camera into the camera black box (lib/camera-blackbox.ts), which saves the
// last frames to this PC when it sees a spin. Mounted last inside the Canvas, so it sees where the others left it.

import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { recordFrame } from '../../lib/camera-blackbox'
import { useInputManager } from '../../lib/input-manager'
import { isDragLookOn } from '../../lib/drag-look'
import { getAwayState } from '../../lib/away-mode'
import { useGameMenu } from '../../lib/game-menu/menu-store'

const dir = new THREE.Vector3()

export function CameraBlackbox() {
  useFrame((state, delta) => {
    const cam = state.camera
    cam.getWorldDirection(dir)
    const input = useInputManager.getState()
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
