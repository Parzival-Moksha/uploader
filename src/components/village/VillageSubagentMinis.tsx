'use client'

// ░▒▓ HELPERS — an agent's subagents as half-size copies of it, in a semicircle about 2 m behind it ▓▒░
//
// Body: a clone of the parent's own loaded VRM (SkeletonUtils.clone). Geometry, textures and materials are
// shared with the parent, so there is no second download and almost no extra memory. It has no animation of its
// own: every frame it copies its parent's pose, bone by bone (the owner, 25 Nov: helpers should "inherit the
// movements of their main agents"), so it walks when the parent walks and works, talks or idles as it does. A
// finished one stays for a minute, then goes.
// Click one (or press E next to it) for its work in the parent's panel.

import { Component, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'
import { useFrameWhen } from '../../lib/use-frame-when'
import { hideUndrawnSubtrees } from '../../lib/forge/undrawn-subtrees'
import { stationLocalToWorld } from '../../lib/village/village-layout'
import { miniSeats, subagentLook, visibleSubagents, type SubagentLook } from '../../lib/village/village-subagents'
import { helperStatusLine } from '../../lib/village/running-subagents'
import { requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import {
  focusVillageSubagent,
  getNearbyVillageMini,
  getVillageMiniList,
  isVillageFocusBlocked,
  setVillageMinis,
  subscribeNearbyVillageMini,
  type VillageStationPlacement,
} from './village-actions'
import { VILLAGE_STATUS_COLOR } from './village-status'

const MINI_SCALE = 0.5
const NO_RAYCAST = () => {}

// Dev-only console helpers (like window.__oasisVillage): list the minis, stand the player next to one.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisVillageMinis = {
    list: () => getVillageMiniList().map(mini => ({ ...mini, position: mini.position.map(v => Number(v.toFixed(2))) })),
    standBy: (index = 0) => {
      const mini = getVillageMiniList()[index]
      if (!mini) return false
      const [x, y, z] = mini.position
      requestPlayerAvatarTeleport({ position: [x + 0.7, y, z], yaw: -Math.PI / 2, forward: [-1, 0, 0] })
      return true
    },
  }
}

export const SUBAGENT_LOOK_COLOR: Record<SubagentLook, string> = {
  running: VILLAGE_STATUS_COLOR.working,
  done: VILLAGE_STATUS_COLOR.waiting,
  failed: VILLAGE_STATUS_COLOR.error,
  stopped: VILLAGE_STATUS_COLOR.idle,
}
const LOOK_WORD: Record<SubagentLook, string> = { running: 'working', done: 'done', failed: 'failed', stopped: 'stopped' }

interface MiniInfo {
  key: string
  look: SubagentLook
  description: string
  /** What it does now, in a few words (its latest tool; running-subagents.ts helperStatusLine). */
  doing: string
}

function useTick(active: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [active, everyMs])
  return now
}

function hashPhase(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return (Math.abs(hash) % 628) / 100
}

/** The parent's body, cloned once its own renderer has loaded, turned and dressed it (its effects run first). */
function MiniBody({ avatarUrl }: { avatarUrl: string }) {
  // Same cache entry as VillageStation's VRMCatalogRenderer (path `${url}#village`, which adds `#vrm`).
  const gltf = useLoader(GLTFLoader, `${avatarUrl}#village#vrm`, loader => {
    loader.register(parser => new VRMLoaderPlugin(parser))
  })
  const [clone, setClone] = useState<THREE.Object3D | null>(null)
  const pairs = useRef<Array<[THREE.Object3D, THREE.Object3D]>>([])
  useEffect(() => {
    const source = ((gltf.userData as { vrm?: { scene: THREE.Object3D } }).vrm?.scene ?? gltf.scene) as THREE.Object3D
    const copy = SkeletonUtils.clone(source)
    copy.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.raycast = NO_RAYCAST // the hit box below takes the clicks
      mesh.castShadow = false
      mesh.receiveShadow = false
    })
    // No culling walk through its ~140 skeleton nodes (the bones are not drawn; their matrices still update).
    hideUndrawnSubtrees(copy)
    pairs.current = bonePairs(source, copy)
    setClone(copy)
  }, [gltf])
  // Its parent's pose, every frame: the clone has the same skeleton, so bone i takes bone i's rotation and place.
  useFrameWhen(Boolean(clone), () => {
    for (const [from, to] of pairs.current) {
      to.quaternion.copy(from.quaternion)
      to.position.copy(from.position)
    }
  })
  return clone ? <primitive object={clone} /> : null
}

/** The bones of a skeleton and of its clone, side by side (SkeletonUtils.clone keeps the hierarchy's order). */
function bonePairs(source: THREE.Object3D, copy: THREE.Object3D): Array<[THREE.Object3D, THREE.Object3D]> {
  const out: Array<[THREE.Object3D, THREE.Object3D]> = []
  const walk = (a: THREE.Object3D, b: THREE.Object3D) => {
    if ((a as THREE.Bone).isBone && (b as THREE.Bone).isBone) out.push([a, b])
    const n = Math.min(a.children.length, b.children.length)
    for (let i = 0; i < n; i++) walk(a.children[i], b.children[i])
  }
  walk(source, copy)
  return out
}

function MiniPlaceholder({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.26, 0.9, 6, 12]} />
        <meshStandardMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 1.62, 0]}>
        <sphereGeometry args={[0.2, 14, 10]} />
        <meshStandardMaterial color="#e5e7eb" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

class MiniBoundary extends Component<{ color: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <MiniPlaceholder color={this.props.color} /> : this.props.children
  }
}

function MiniLabel({ info, near }: { info: MiniInfo; near: boolean }) {
  const color = SUBAGENT_LOOK_COLOR[info.look]
  return (
    <div className="pointer-events-none flex w-[150px] select-none flex-col items-center gap-0.5">
      <div
        className="flex items-center gap-1 rounded-full bg-slate-950/85 px-1.5 py-[1px] text-[9px] font-black uppercase tracking-[0.12em]"
        style={{ color, border: `1px solid ${color}99` }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${info.look === 'running' ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        {LOOK_WORD[info.look]}
      </div>
      <div className="whitespace-normal break-words rounded-md bg-slate-950/80 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-tight text-white">
        {info.description || 'helper'}
      </div>
      {info.doing && <div className="rounded bg-slate-950/70 px-1.5 text-[9px] italic leading-tight text-white/80">{info.doing}</div>}
      {near && (
        <div className="rounded border border-white/25 bg-black/75 px-1.5 py-[1px] text-[9px] font-bold text-white">
          <span className="mr-1 rounded bg-white/20 px-1 font-mono">E</span>see its work
        </div>
      )}
    </div>
  )
}

function Mini({ agentId, info, position, avatarUrl, labelVisible, near, overlayZ }: {
  agentId: string
  info: MiniInfo
  position: [number, number, number]
  avatarUrl: string
  labelVisible: boolean
  near: boolean
  overlayZ: [number, number]
}) {
  const running = info.look === 'running'
  const blocked = useInputManager(s => isVillageFocusBlocked(s.inputState))
  const color = SUBAGENT_LOOK_COLOR[info.look]
  // A helper moves as its parent does (MiniBody copies the parent's pose every frame): it walks along when the
  // parent walks. Its ring on the ground says whether it works.
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    // After the canvas click has finished dismissing other panels (as with the desks).
    window.setTimeout(() => focusVillageSubagent(agentId, info.key), 0)
  }
  return (
    <group position={position}>
      <group>
        <group scale={MINI_SCALE}>
          <MiniBoundary key={avatarUrl} color={color}>
            <Suspense fallback={<MiniPlaceholder color={color} />}>
              <MiniBody avatarUrl={avatarUrl} />
            </Suspense>
          </MiniBoundary>
        </group>
      </group>
      {/* status ring on the ground: green working, blue done, red failed */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} raycast={NO_RAYCAST}>
        <ringGeometry args={[0.3, near ? 0.4 : 0.36, 36]} />
        <meshBasicMaterial color={color} transparent opacity={running ? 0.85 : 0.5} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        position={[0, 0.48, 0]}
        raycast={blocked ? NO_RAYCAST : THREE.Mesh.prototype.raycast}
        onClick={onClick}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (!useInputManager.getState().pointerLocked) event.nativeEvent.stopImmediatePropagation()
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          if (!useInputManager.getState().pointerLocked) document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <boxGeometry args={[0.7, 0.96, 0.7]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} visible={false} />
      </mesh>
      {(labelVisible || near) && (
        <Html position={[0, 1.08, 0]} center distanceFactor={9} zIndexRange={overlayZ} style={{ pointerEvents: 'none' }}>
          <MiniLabel info={info} near={near} />
        </Html>
      )}
    </group>
  )
}

/**
 * Every helper of one agent that works now or finished in the last minute. Rendered inside the agent's
 * station group, so positions are station-local (miniSeats); world positions go to the proximity check.
 */
export function VillageSubagentMinis({ agentId, placement, avatarUrl, labelsVisible, overlayZ }: {
  agentId: string
  placement: VillageStationPlacement
  avatarUrl: string
  labelsVisible: boolean
  overlayZ: [number, number]
}) {
  const hasAny = useOasisStore(s => (s.agentEngine.agents[agentId]?.subagents.length || 0) > 0)
  // Finished helpers leave after a minute: look again every few seconds while there are any.
  const now = useTick(hasAny, 5000)
  const key = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    if (!agent || !agent.subagents.length) return ''
    return visibleSubagents(agent, now).map(sub => [sub.key, subagentLook(sub), sub.description, subagentLook(sub) === 'running' ? helperStatusLine(sub.lastToolName) : ''].join('\u0001')).join('\u0002')
  })
  const infos = useMemo<MiniInfo[]>(() => (key ? key.split('\u0002').map(item => {
    const [subKey, look, description, doing] = item.split('\u0001')
    return { key: subKey, look: look as SubagentLook, description, doing: doing || '' }
  }) : []), [key])
  const layout = useMemo(() => miniSeats(infos.length), [infos.length])
  const nearby = useSyncExternalStore(subscribeNearbyVillageMini, getNearbyVillageMini, () => null)

  useEffect(() => {
    setVillageMinis(agentId, layout.seats.map((seat, index) => ({
      agentId,
      key: infos[index].key,
      description: infos[index].description,
      position: stationLocalToWorld(placement, [seat.x, 0, seat.z]),
      // Its place behind the parent: the proximity check follows a parent that walks with the owner.
      local: [seat.x, 0, seat.z] as [number, number, number],
    })))
    return () => setVillageMinis(agentId, null)
  }, [agentId, infos, layout, placement])

  if (!infos.length) return null
  return (
    <group name="village-helpers">
      {layout.seats.map((seat, index) => {
        const info = infos[index]
        return (
          <Mini
            key={info.key}
            agentId={agentId}
            info={info}
            position={[seat.x, 0, seat.z]}
            avatarUrl={avatarUrl}
            labelVisible={labelsVisible}
            near={nearby?.agentId === agentId && nearby.key === info.key}
            overlayZ={overlayZ}
          />
        )
      })}
      {layout.overflowAt && (
        <Html position={[layout.overflowAt.x, 0.6, layout.overflowAt.z]} center distanceFactor={7} zIndexRange={overlayZ} style={{ pointerEvents: 'none' }}>
          <div className="select-none whitespace-nowrap rounded-full border border-violet-300/50 bg-slate-950/85 px-2 py-0.5 text-[11px] font-black text-violet-100">
            +{layout.overflow} more helper{layout.overflow === 1 ? '' : 's'}
          </div>
        </Html>
      )}
    </group>
  )
}
