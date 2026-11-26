'use client'

// ░▒▓ FIRST LIGHT — sky colour and light from the first frame, before the world's own have arrived ▓▒░
// Until 24 Nov the sky sat directly under the Canvas's one Suspense boundary: while the world's sky files
// loaded (60-115 s on a busy page server) the whole scene was suspended and the owner saw black for a
// minute. The sky now has its own boundary, with SkyStandIn as its fallback, and FirstLight lights the
// world while it has no lights of its own yet (they come with the world's data).

import { useEffect, useLayoutEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { useOasisStore } from '../../store/oasisStore'

/** A dusk blue, so the ground and the avatars read against it while the real sky loads. */
const STAND_IN_SKY = '#33405c'

/** The background colour while the world's sky is loading (or not known yet). */
export function SkyStandIn() {
  const scene = useThree(s => s.scene)
  // Layout effect: when the real sky mounts, this one's cleanup runs before the sky's own layout effect sets its background.
  useLayoutEffect(() => {
    const before = scene.background
    const color = new THREE.Color(STAND_IN_SKY)
    scene.background = color
    return () => { if (scene.background === color) scene.background = before }
  }, [scene])
  return null
}

const FIRST_LIGHT = 'oasisFirstLight'
const CHECK_MS = 500

/** A sky light and a sun while the world has no lights of its own in the scene (not yet in its data, or still loading). */
export function FirstLight() {
  const hasWorldLights = useOasisStore(s => s.worldLights.length > 0)
  const scene = useThree(s => s.scene)
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!hasWorldLights) { setLit(false); return }
    const check = () => {
      let found = false
      scene.traverseVisible(o => { if (!found && (o as THREE.Light).isLight && !o.userData[FIRST_LIGHT]) found = true })
      if (found) setLit(true)
      return found
    }
    if (check()) return
    const timer = window.setInterval(() => { if (check()) window.clearInterval(timer) }, CHECK_MS)
    return () => window.clearInterval(timer)
  }, [hasWorldLights, scene])
  if (hasWorldLights && lit) return null
  return (
    <>
      <hemisphereLight args={['#c9d8ff', '#5a4632', 1.4]} userData={{ [FIRST_LIGHT]: true }} />
      <directionalLight position={[30, 50, 20]} intensity={1.6} color="#fff1dc" userData={{ [FIRST_LIGHT]: true }} />
    </>
  )
}

// ── The world's look before its data: sky and ground remembered from the last visit ─────────────────

const LOOK_KEY = 'oasis-world-look'
type WorldLook = { sky: string; ground: string }

function readLooks(): Record<string, WorldLook> {
  try { return JSON.parse(window.localStorage.getItem(LOOK_KEY) || '{}') as Record<string, WorldLook> } catch { return {} }
}

/**
 * On a busy page server the world's data (its sky and ground) arrives 20-40 s after the canvas. A world
 * seen before shows the sky and ground it had last time straight away; its data then confirms or
 * corrects them. Nothing is saved meanwhile: saves wait for the world to be ready (world-persistence).
 */
export function WorldLookPrimer() {
  useEffect(() => {
    const prime = () => {
      const s = useOasisStore.getState()
      if (s.isViewMode || !s.activeWorldId) return
      if (s._worldReady) {
        if (!s.worldSkyBackground && s.groundPresetId === 'none') return
        const looks = readLooks()
        const known = looks[s.activeWorldId]
        if (known && known.sky === s.worldSkyBackground && known.ground === s.groundPresetId) return
        looks[s.activeWorldId] = { sky: s.worldSkyBackground, ground: s.groundPresetId }
        const ids = Object.keys(looks)
        if (ids.length > 40) delete looks[ids[0]]
        try { window.localStorage.setItem(LOOK_KEY, JSON.stringify(looks)) } catch { /* full: no priming next time */ }
        return
      }
      const look = readLooks()[s.activeWorldId]
      if (!look) return
      const patch: Partial<{ worldSkyBackground: string; groundPresetId: string }> = {}
      if (!s.worldSkyBackground && look.sky) patch.worldSkyBackground = look.sky
      if (s.groundPresetId === 'none' && look.ground && look.ground !== 'none') patch.groundPresetId = look.ground
      if (Object.keys(patch).length) useOasisStore.setState(patch)
    }
    prime()
    return useOasisStore.subscribe((state, before) => {
      if (state._worldReady !== before._worldReady || state.activeWorldId !== before.activeWorldId
        || state.worldSkyBackground !== before.worldSkyBackground || state.groundPresetId !== before.groundPresetId) prime()
    })
  }, [])
  return null
}
