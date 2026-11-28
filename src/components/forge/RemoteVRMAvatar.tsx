'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// REMOTE VRM AVATAR — Other players' bodies, seen across the wire
// ─═̷─═̷─ॐ─═̷─═̷─ Same pipeline as PlayerAvatar, but pose-driven ─═̷─═̷─ॐ─═̷─═̷─
//
// MultiplayerPresenceLayer owns the snapshot buffer + interpolation. It hands
// us an interpolated { position, yaw, speed } target each frame; we lerp the
// outer group toward it via the forwarded ref (parent does the lerp) and pick
// an animation state from the velocity magnitude.
//
// If avatarUrl is empty (no profile picture yet) OR the VRM fails to load, we
// fall back to the original pill capsule + sphere head so the remote player
// is always visible.
//
// Memory: each player gets its own VRM parse via a sessionId-keyed URL
// fragment. drei caches by URL; this gives each remote a fresh skeleton +
// expressionManager without us writing a custom VRM clone helper. With an
// expected 8-player ceiling this is fine; if we ever go higher we can swap in
// VRMUtils.deepCloneVrm when @pixiv/three-vrm ships it (3.5 does not).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { forwardRef, Suspense, useEffect, useRef, useState } from 'react'
import { Billboard, Html, Text } from '@react-three/drei'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'

import { AnimationController } from '../../lib/animation-state-machine'
import { normalizeProfileAvatarUrl } from '../../lib/profile-avatar-url'
import { VillageCorpseDrop, useVillageCombatPose } from '../village/VillageCombatHud'
import { REMOTE_CAST_GESTURE_MS, getRemoteCast, isEventDrivenAnim } from '../../lib/remote-cast'
import { WORLD_Z_RANGE } from '@/lib/ui-kit/layers'

// ═══════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════

export interface RemoteVRMAvatarProps {
  /** VRM URL. Empty string -> pill fallback. */
  avatarUrl: string
  /** 2D profile picture shown beside the nameplate. */
  profileAvatarUrl?: string
  /** Stable identifier used to keep the per-player VRM cache entry unique. */
  cacheKey: string
  displayName: string
  /** Ring + nametag tint. */
  color: string
  /** m/s, inferred from position deltas by the parent. */
  speed: number
  /** Network animation state. Custom clips are encoded as custom:<animation-id>. */
  animState: string
  /** Party combat id (`pvp:<sessionId>`): room-decided hits flinch or knock this body down. */
  combatId?: string
  /** What this player said in the chat in the last few seconds: shown over the head. */
  chatBubble?: string
}

// Animation thresholds aligned with PlayerAvatar's TPS speeds:
//   default WASD = 3.0 m/s (TPS_BASE_SPEED), shift = 12.0 (sprint x4),
//   space = 0.75 (walk x0.25). Plain WASD is a walk, the run shows only on the way
//   to a sprint; the controller plays each at the real speed over its measured stride.
const WALK_SPEED = 0.1
const RUN_SPEED = 4.2
const SPRINT_SPEED = 7.5
const CROSSFADE_SECONDS = 0.15

// ═══════════════════════════════════════════════════════════════════════════
// PILL FALLBACK — capsule + sphere head + ring + nametag
// Pulled out of the old RemotePresenceAvatar so both the empty-URL path and
// the VRM-failure path render identically.
// ═══════════════════════════════════════════════════════════════════════════

function PillBody({ color, displayName, profileAvatarUrl, bubble }: { color: string; displayName: string; profileAvatarUrl?: string; bubble?: string }) {
  return (
    <>
      <mesh castShadow position={[0, 0.88, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.22, 0.28, 0.9, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.52} metalness={0.12} />
      </mesh>
      <mesh castShadow position={[0, 1.46, 0]} raycast={() => null}>
        <sphereGeometry args={[0.22, 18, 12]} />
        <meshStandardMaterial color="#f8fafc" emissive={color} emissiveIntensity={0.08} roughness={0.48} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.15, 0.28]} raycast={() => null}>
        <boxGeometry args={[0.42, 0.08, 0.06]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.54} />
      </mesh>
      <NameTag displayName={displayName} profileAvatarUrl={profileAvatarUrl} bubble={bubble} />
    </>
  )
}

function ProfileAvatarThumb({ src, displayName }: { src: string; displayName: string }) {
  const [failed, setFailed] = useState(false)
  const normalizedSrc = normalizeProfileAvatarUrl(src) || src
  useEffect(() => { setFailed(false) }, [normalizedSrc])
  if (failed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          color: '#e0f2fe',
          fontSize: 10,
          fontWeight: 900,
          fontFamily: 'system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          background: 'linear-gradient(135deg, rgba(14,165,233,0.5), rgba(168,85,247,0.48))',
        }}
      >
        {(displayName || '?').trim().slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={normalizedSrc}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/** Above this body's head, not at one height for all (a tall body had the name across its face). Measured once. */
const tagHeights = new WeakMap<object, number>()
function nameTagHeight(vrm: VRM): number {
  const known = tagHeights.get(vrm)
  if (known !== undefined) return known
  const box = new THREE.Box3().setFromObject(vrm.scene)
  const origin = new THREE.Vector3()
  vrm.scene.getWorldPosition(origin)
  const top = box.isEmpty() ? 1.7 : box.max.y - origin.y
  const height = Math.min(3.6, Math.max(1.2, top + 0.22))
  tagHeights.set(vrm, height)
  return height
}

function NameTag({ displayName, profileAvatarUrl, height = 1.86, bubble }: { displayName: string; profileAvatarUrl?: string; height?: number; bubble?: string }) {
  return (
    <Billboard position={[0, height, 0]}>
      {bubble && (
        <Html position={[0, 0.34, 0]} center distanceFactor={9} style={{ pointerEvents: 'none' }} zIndexRange={WORLD_Z_RANGE}>
          <div style={{ maxWidth: 260, width: 'max-content', padding: '6px 10px', borderRadius: 10, background: 'rgba(2,6,23,0.86)', border: '1px solid rgba(245,201,106,0.55)', color: '#fff7e0', font: '600 13px/1.35 system-ui, sans-serif', textAlign: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}>
            {bubble.length > 160 ? `${bubble.slice(0, 157)}…` : bubble}
          </div>
        </Html>
      )}
      {profileAvatarUrl && (
        <Html
          zIndexRange={WORLD_Z_RANGE}
          transform
          position={[-0.22, 0, 0]}
          distanceFactor={7}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              overflow: 'hidden',
              border: '1px solid rgba(224,242,254,0.92)',
              background: 'rgba(2,6,23,0.92)',
              boxShadow: '0 0 10px rgba(56,189,248,0.35)',
            }}
          >
            <ProfileAvatarThumb src={profileAvatarUrl} displayName={displayName} />
          </div>
        </Html>
      )}
      <Text
        position={profileAvatarUrl ? [0.02, 0, 0] : [0, 0, 0]}
        fontSize={0.16}
        anchorX={profileAvatarUrl ? 'left' : 'center'}
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#020617"
      >
        {displayName}
        <meshBasicMaterial color="#e0f2fe" />
      </Text>
    </Billboard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VRM BODY — actual three-vrm rendering + animation
// Suspends on first load via useLoader; the parent wraps us in Suspense with
// a pill fallback.
// ═══════════════════════════════════════════════════════════════════════════

function VRMBody({
  avatarUrl,
  cacheKey,
  displayName,
  profileAvatarUrl,
  color,
  speedRef,
  animStateRef,
  animOnceRef,
  bubble,
}: {
  avatarUrl: string
  cacheKey: string
  displayName: string
  profileAvatarUrl?: string
  color: string
  speedRef: React.MutableRefObject<number>
  animStateRef: React.MutableRefObject<string>
  animOnceRef?: React.MutableRefObject<boolean>
  bubble?: string
}) {
  const vrmRef = useRef<VRM | null>(null)
  const animControllerRef = useRef<AnimationController | null>(null)
  const lastCustomAnimRef = useRef<string | null>(null)
  const lastCastAtRef = useRef<number | null>(null)
  const effectiveStateRef = useRef('idle')
  // Tracks which scene.environment was last baked into the materials. Re-runs
  // the IBL pass when the environment identity changes (e.g. mid-session HDRI
  // swap via SkyPanel's now-live sky_changed mutation). Without this, remote
  // VRMs keep the previous environment cubemap baked into their materials
  // after a sky swap.
  const appliedEnvRef = useRef<THREE.Texture | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)

  // Per-player cache fragment — appended as a URL hash, never sent to server.
  // Forces drei's useLoader to give each remote a fresh parsed GLTF (own
  // skeleton + expressionManager). NOTE: we previously appended a per-mount
  // useId() suffix to defeat the same-sessionId-rejoin race, but that turned
  // drei's URL-keyed cache into an unbounded leak — every remount created a
  // new cache entry the loader never evicts. The cache-stomp race is narrow;
  // the memory leak was the real bug. Stable cacheKey wins.
  const vrmUrl = avatarUrl + '#vrm-remote-' + cacheKey
  const gltf = useLoader(GLTFLoader, vrmUrl, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    const loaded = gltf.userData.vrm as VRM | undefined
    if (!loaded) {
      console.warn('[RemoteVRMAvatar] No VRM data in', avatarUrl)
      return
    }

    VRMUtils.rotateVRM0(loaded)

    // Material fixes — match PlayerAvatar so lighting + shadows look right.
    loaded.scene.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return
      const mesh = child as THREE.Mesh
      mesh.raycast = () => {}
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        const m = mat as unknown as Record<string, unknown>
        if ('giEqualizationFactor' in m) m.giEqualizationFactor = 0.9
        if (mat.type === 'MeshBasicMaterial') {
          const basic = mat as THREE.MeshBasicMaterial
          mesh.material = new THREE.MeshStandardMaterial({
            color: basic.color,
            map: basic.map,
            transparent: basic.transparent,
            opacity: basic.opacity,
            side: basic.side,
            roughness: 0.8,
            metalness: 0.0,
            envMapIntensity: 1.5,
          })
          continue
        }
        if ('envMapIntensity' in m) {
          ;(mat as THREE.MeshStandardMaterial).envMapIntensity = 1.5
        }
        mat.needsUpdate = true
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
    })

    vrmRef.current = loaded
    setVrm(loaded)

    // Cleanup: dispose the parsed VRM + GPU resources when this peer leaves
    // (sessionId churn, world swap, or remount). Without this, drei's
    // useLoader cache balloons across peer joins — each one's geometries,
    // textures, and material maps stay resident. Per-player cache fragment
    // ensures we're not stomping a VRM another peer still uses.
    return () => {
      try {
        VRMUtils.deepDispose(loaded.scene)
      } catch {}
      if (vrmRef.current === loaded) vrmRef.current = null
    }
  }, [gltf, avatarUrl])

  // Animation controller — task spec thresholds. AnimationController accepts
  // them via config so we don't fork the state machine.
  useEffect(() => {
    if (!vrm) return
    const controller = new AnimationController(vrm, {
      crossfadeDuration: CROSSFADE_SECONDS,
      walkSpeedThreshold: WALK_SPEED,
      runSpeedThreshold: RUN_SPEED,
      sprintSpeedThreshold: SPRINT_SPEED,
    })
    animControllerRef.current = controller
    // Kick off idle so the avatar isn't a T-pose while clips stream in. The body stays hidden until its first clip
    // plays (the owner, 28 Nov: "a long T-pose before the first animation"); 8 s at most, then shown anyway.
    vrm.scene.visible = false
    const reveal = window.setTimeout(() => { vrm.scene.visible = true }, 8000)
    controller.preloadClip('idle').then(ok => {
      if (animControllerRef.current === controller && ok) {
        controller.transitionTo('idle')
        // One frame for the mixer to pose the skeleton before it is seen.
        requestAnimationFrame(() => { if (animControllerRef.current === controller) vrm.scene.visible = true })
      }
    })
    return () => {
      window.clearTimeout(reveal)
      controller.dispose()
      if (animControllerRef.current === controller) animControllerRef.current = null
    }
  }, [vrm])

  useFrame((state, rawDelta) => {
    const v = vrmRef.current
    if (!v) return
    const delta = Math.min(rawDelta, 0.05)

    // ── IBL one-shot — mirror PlayerAvatar: swap MToon/Basic → Standard with
    // the scene's HDRI envMap attached so the remote VRM picks up environment
    // lighting. The loader-time material pass couldn't see scene.environment
    // (no R3F state in a useEffect), so without this remote players render
    // as silhouettes against a lit world.
    if (state.scene.environment && appliedEnvRef.current !== state.scene.environment) {
      v.scene.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return
        const mesh = child as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const newMats = mats.map(mat => {
          const m = mat as unknown as Record<string, unknown> & {
            type?: string
            isMToonMaterial?: boolean
            map?: THREE.Texture | null
            normalMap?: THREE.Texture | null
            emissiveMap?: THREE.Texture | null
            emissive?: THREE.Color
            color?: THREE.Color
            side?: THREE.Side
            transparent?: boolean
            opacity?: number
            alphaTest?: number
            uniforms?: Record<string, { value?: THREE.Texture | null } | undefined>
          }
          if (m.type === 'MToonMaterial' || m.type === 'MeshBasicMaterial' || m.isMToonMaterial) {
            const std = new THREE.MeshStandardMaterial({
              map: m.map || m.uniforms?.map?.value || null,
              normalMap: m.normalMap || m.uniforms?.normalMap?.value || null,
              emissiveMap: m.emissiveMap || m.uniforms?.emissiveMap?.value || null,
              emissive: m.emissive || new THREE.Color(0x000000),
              color: m.color || new THREE.Color(0xffffff),
              roughness: 0.8,
              metalness: 0.0,
              envMap: state.scene.environment,
              envMapIntensity: 1.2,
              side: m.side ?? THREE.FrontSide,
              transparent: m.transparent ?? false,
              opacity: m.opacity ?? 1,
              alphaTest: m.alphaTest ?? 0,
            })
            std.needsUpdate = true
            try { (mat as THREE.Material).dispose() } catch {}
            return std
          }
          if ('envMap' in m) {
            ;(m as unknown as THREE.MeshStandardMaterial).envMap = state.scene.environment
            ;(m as unknown as THREE.MeshStandardMaterial).envMapIntensity = 1.2
            ;(m as unknown as THREE.Material).needsUpdate = true
          }
          return mat as THREE.Material
        })
        mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0]
      })
      appliedEnvRef.current = state.scene.environment
    }

    const controller = animControllerRef.current
    controller?.update(delta)
    v.update(delta)
    let networkAnimState = animStateRef.current || 'idle'
    let once = Boolean(animOnceRef?.current)
    // A cast that just arrived from this player (remote-cast.ts) plays its gesture once, unless a hit pose rules.
    if (!once) {
      const cast = getRemoteCast(cacheKey)
      if (cast && performance.now() - cast.at < REMOTE_CAST_GESTURE_MS) {
        networkAnimState = `custom:${cast.clip}`
        once = true
        if (lastCastAtRef.current !== cast.at) {
          // A new cast restarts the gesture, even the same one again.
          lastCastAtRef.current = cast.at
          lastCustomAnimRef.current = null
        }
      }
    }
    effectiveStateRef.current = networkAnimState
    if (controller && networkAnimState.startsWith('custom:')) {
      const animId = networkAnimState.slice('custom:'.length)
      // A hit's flinch or knock-down, and a cast's gesture, play once and hold their last frame.
      const loop = !once
      if (animId && lastCustomAnimRef.current !== animId) {
        lastCustomAnimRef.current = animId
        controller.preloadClip(animId).then(ok => {
          if (ok && animControllerRef.current === controller && effectiveStateRef.current === `custom:${animId}`) {
            controller.transitionTo('custom', animId, { loop })
          }
        })
      } else if (animId && controller.state !== 'custom') {
        controller.transitionTo('custom', animId, { loop })
      }
      return
    }
    // A custom clip just ended (a knock-down got up, a dance stopped): back to idle, not frozen on its last frame.
    if (lastCustomAnimRef.current !== null && controller?.state === 'custom') controller.transitionTo('idle')
    lastCustomAnimRef.current = null
    controller?.updateFromVelocity(speedRef.current)
  })

  if (!vrm) return null

  return (
    <>
      <primitive object={vrm.scene} />
      <NameTag displayName={displayName} profileAvatarUrl={profileAvatarUrl} height={nameTagHeight(vrm)} bubble={bubble} />
      {/* Foot ring stays — tints the floor under the remote player so they
          read as "another presence" even when crowded. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — falls back to the pill if useLoader throws (404, malformed
// VRM, etc.). Without this, a single bad avatarUrl crashes the whole scene.
// ═══════════════════════════════════════════════════════════════════════════

interface VRMBoundaryProps {
  fallback: React.ReactNode
  children: React.ReactNode
  avatarUrl: string
}

class VRMErrorBoundary extends React.Component<VRMBoundaryProps, { hasError: boolean }> {
  constructor(props: VRMBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error) {
    console.warn(`[RemoteVRMAvatar] VRM load failed for ${this.props.avatarUrl}: ${error.message}`)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC COMPONENT — forwardRef so the parent's interpolation can lerp the
// group's position/rotation directly into our ref.
// ═══════════════════════════════════════════════════════════════════════════

export const RemoteVRMAvatar = forwardRef<THREE.Group, RemoteVRMAvatarProps>(function RemoteVRMAvatar(
  { avatarUrl, profileAvatarUrl, cacheKey, displayName, color, speed, animState, chatBubble, combatId },
  ref,
) {
  // Party combat: a hit on this player (decided by the room) flinches or knocks the body down.
  const combatPose = useVillageCombatPose(combatId || '')
  const animOnceRef = useRef(false)
  animOnceRef.current = Boolean(combatPose?.once)
  // Speed mirror — the body's useFrame reads from a ref so we don't re-render
  // the entire VRM subtree on every speed change.
  const speedRef = useRef(0)
  speedRef.current = speed
  const animStateRef = useRef('idle')
  // Hit poses come from this screen's own hit events, casts from the bolts (remote-cast.ts); the same names sent over
  // the network are ignored, so a player stuck in one on their own screen is not shown stuck here.
  animStateRef.current = combatPose ? `custom:${combatPose.animationId}` : (animState && !isEventDrivenAnim(animState) ? animState : 'idle')

  // Empty URL -> straight to pill. No Suspense, no error boundary needed.
  if (!avatarUrl) {
    return (
      <group ref={ref}>
        <PillBody color={color} displayName={displayName} profileAvatarUrl={profileAvatarUrl} bubble={chatBubble} />
      </group>
    )
  }

  const pillFallback = <PillBody color={color} displayName={displayName} profileAvatarUrl={profileAvatarUrl} bubble={chatBubble} />

  return (
    <group ref={ref}>
      <VRMErrorBoundary fallback={pillFallback} avatarUrl={avatarUrl}>
        <Suspense fallback={pillFallback}>
          <VillageCorpseDrop agentId={combatId || ''}>
            <VRMBody
              avatarUrl={avatarUrl}
              cacheKey={cacheKey}
              displayName={displayName}
              profileAvatarUrl={profileAvatarUrl}
              color={color}
              speedRef={speedRef}
              animStateRef={animStateRef}
              animOnceRef={animOnceRef}
              bubble={chatBubble}
            />
          </VillageCorpseDrop>
        </Suspense>
      </VRMErrorBoundary>
    </group>
  )
})
