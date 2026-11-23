'use client'

// ░▒▓ SCENE WARM-UP + CAMERA RANGE — inside the Canvas ▓▒░
// SceneWarmup runs src/lib/forge/scene-warmup.ts between frames: a few milliseconds after a frame
// while there is something not yet drawn, a look once a second otherwise, nothing while resting.
// CameraRange sets the camera's near plane from its height and the far plane from
// Settings → Graphics → View distance (src/lib/forge/camera-range.ts).

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'

import { SceneWarmer, WARM_BUDGET_MS, WARM_IDLE_MS } from '../../lib/forge/scene-warmup'
import { farFor, nearForHeight } from '../../lib/forge/camera-range'
import { getAwayState } from '../../lib/away-mode'
import { useSavedGraphicsPrefs } from '../../lib/use-graphics-prefs'
import { useFlopCaps } from '../../lib/use-flop-caps'

export function SceneWarmup() {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const camera = useThree(s => s.camera)

  useEffect(() => {
    const warmer = new SceneWarmer(gl, scene)
    const unwatch = warmer.watchTarget()
    let timer = 0
    let frame = 0
    let stopped = false
    const run = () => {
      if (stopped) return
      let more = false
      if (!getAwayState().resting && document.visibilityState === 'visible') {
        try { more = warmer.tick(camera, WARM_BUDGET_MS) } catch (error) { console.warn('[scene-warmup]', error); warmer.setEnabled(false) }
      }
      // Right after the next frame while there is more, else a second from now.
      if (more) frame = requestAnimationFrame(() => { timer = window.setTimeout(run, 0) })
      else timer = window.setTimeout(run, WARM_IDLE_MS)
    }
    timer = window.setTimeout(run, WARM_IDLE_MS)
    const host = window as unknown as { __oasisWarmup?: unknown }
    if (process.env.NODE_ENV !== 'production') {
      host.__oasisWarmup = { stats: () => warmer.getStats(), setEnabled: (on: boolean) => warmer.setEnabled(on) }
    }
    return () => {
      stopped = true
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      unwatch()
      warmer.dispose()
      delete host.__oasisWarmup
    }
  }, [gl, scene, camera])

  return null
}

export function CameraRange() {
  const { viewDistance } = useSavedGraphicsPrefs()
  const { drawDistance } = useFlopCaps()
  const far = farFor(viewDistance, drawDistance)
  const farRef = useRef(far)
  farRef.current = far

  useFrame(({ camera }) => {
    const cam = camera as PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const near = nearForHeight(cam.position.y)
    if (cam.near === near && cam.far === farRef.current) return
    cam.near = near
    cam.far = farRef.current
    cam.updateProjectionMatrix()
  })

  return null
}
