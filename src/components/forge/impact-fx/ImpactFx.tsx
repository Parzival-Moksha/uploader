'use client'

// ░▒▓ IMPACT FX — hit effects ported from SquigglyFish's "Godot 4 Hit & Impact VFX + SFX" sampler (CC0 1.0) ▓▒░
// critical: gold comic star burst, shards, sparks, twinkles (a firebolt landing)
// energy:   cyan plasma burst with electric arcs (a lightning bolt landing)
// groundslam: shock ring, glowing ground cracks, rocks, dust wall (a conjuration: an object placed)
// Each layer of the Godot scene is one InstancedMesh with a shared material (impact-fx-shaders.ts), and its
// particles are simulated here the way Godot's CPUParticles3D does: one burst, a direction within a spread,
// initial speed, gravity, linear damping, a random scale and angle, lifetime randomness. Billboarding is
// done on the CPU per instance. One frame loop per effect; it removes itself when every layer is done.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { impactMaterial, type ShaderId, type ShaderParams } from './impact-fx-shaders'

type Range = [number, number]
type Facing = 'billboard' | 'upright' | 'velocity' | 'ground' | 'free'

interface LayerSpec {
  shader: ShaderId
  params?: ShaderParams
  mesh: { quad: Range } | { plane: number } | { rock: Range }
  amount: number
  lifetime: number
  lifetimeRandomness?: number
  offsetY?: number
  facing: Facing
  /** Degrees: a quad's turn about the view axis (or a ground plane's about Y). */
  angle?: Range
  emitRadius?: number
  direction?: [number, number, number]
  /** Degrees around `direction`; 180 = every way. */
  spread?: number
  /** 1 = the spread lies flat on the ground plane. */
  flatness?: number
  gravityY?: number
  velocity?: Range
  damping?: Range
  scale?: Range
  angularVelocity?: Range
}

export type ImpactFxKind = 'critical' | 'energy' | 'groundslam'

const UP: [number, number, number] = [0, 1, 0]

export const IMPACT_FX: Record<ImpactFxKind, LayerSpec[]> = {
  critical: [
    { shader: 'flash', params: { color: [1, 0.72, 0.2, 0.85], ray_count: 0, core_size: 0.5 }, mesh: { quad: [3.4, 3.4] }, amount: 1, lifetime: 0.25, facing: 'billboard' },
    { shader: 'lines', params: { color: [1, 0.72, 0.22, 1], count: 44, width: 0.022 }, mesh: { quad: [3.8, 3.8] }, amount: 1, lifetime: 0.3, facing: 'billboard', angle: [0, 360] },
    { shader: 'ring', params: { color: [1, 0.85, 0.45, 1], thickness: 0.06, start_radius: 0.3 }, mesh: { quad: [3, 3] }, amount: 1, lifetime: 0.3, facing: 'billboard' },
    { shader: 'star', mesh: { quad: [2.9, 2.9] }, amount: 1, lifetime: 0.4, facing: 'billboard', angle: [80, 100] },
    { shader: 'shard', mesh: { quad: [0.13, 0.4] }, amount: 16, lifetime: 0.6, lifetimeRandomness: 0.35, facing: 'velocity', direction: UP, spread: 180, gravityY: -9, velocity: [4, 9], damping: [4, 7], scale: [0.6, 1.4] },
    { shader: 'spark', params: { hot: [1, 1, 0.85, 1], cool: [1, 0.6, 0.1, 1] }, mesh: { quad: [0.04, 0.5] }, amount: 24, lifetime: 0.4, facing: 'velocity', direction: UP, spread: 180, gravityY: -5, velocity: [6, 12], damping: [6, 10], scale: [0.6, 1.2] },
    { shader: 'twinkle', mesh: { quad: [0.34, 0.34] }, amount: 12, lifetime: 0.75, lifetimeRandomness: 0.5, facing: 'billboard', emitRadius: 0.5, direction: UP, spread: 180, gravityY: 0.5, velocity: [1, 4], damping: [3, 5], angle: [0, 45], scale: [0.5, 1.3] },
  ],
  energy: [
    { shader: 'flash', params: { color: [0.1, 0.55, 1, 0.9], ray_count: 0, core_size: 0.55 }, mesh: { quad: [3, 3] }, amount: 1, lifetime: 0.35, facing: 'billboard' },
    { shader: 'ring', params: { color: [0.25, 0.8, 1, 1], thickness: 0.16, start_radius: 0.35 }, mesh: { quad: [2.5, 2.5] }, amount: 1, lifetime: 0.55, facing: 'billboard' },
    { shader: 'plasma', mesh: { quad: [2.5, 2.5] }, amount: 1, lifetime: 0.42, facing: 'upright' },
    { shader: 'arcs', mesh: { quad: [2.9, 2.9] }, amount: 1, lifetime: 0.4, facing: 'billboard', angle: [0, 360] },
    { shader: 'spark', params: { hot: [0.9, 1, 1, 1], cool: [0.1, 0.5, 1, 1] }, mesh: { quad: [0.04, 0.45] }, amount: 18, lifetime: 0.35, facing: 'velocity', direction: UP, spread: 180, gravityY: 0, velocity: [5, 11], damping: [8, 12], scale: [0.6, 1.2] },
    { shader: 'twinkle', params: { color: [0.3, 0.85, 1, 1] }, mesh: { quad: [0.3, 0.3] }, amount: 16, lifetime: 0.7, lifetimeRandomness: 0.5, facing: 'billboard', emitRadius: 0.5, direction: UP, spread: 180, gravityY: 0.8, velocity: [1.5, 4.5], damping: [3, 5], angle: [0, 90], scale: [0.5, 1.3] },
  ],
  groundslam: [
    { shader: 'groundCracks', mesh: { plane: 4.2 }, amount: 1, lifetime: 1, offsetY: 0.02, facing: 'ground', angle: [0, 360] },
    { shader: 'groundRing', mesh: { plane: 5 }, amount: 1, lifetime: 0.45, offsetY: 0.04, facing: 'ground', angle: [0, 360] },
    { shader: 'chunk', mesh: { rock: [0.11, 0.17] }, amount: 18, lifetime: 0.95, offsetY: 0.15, facing: 'free', emitRadius: 0.35, direction: UP, spread: 55, gravityY: -16, velocity: [4, 8.5], angularVelocity: [-720, 720], angle: [0, 360], scale: [0.5, 1.6] },
    { shader: 'puff', mesh: { quad: [1.25, 1.25] }, amount: 20, lifetime: 0.95, lifetimeRandomness: 0.3, offsetY: 0.3, facing: 'upright', emitRadius: 0.25, direction: [1, 0, 0], spread: 180, flatness: 1, gravityY: 1.2, velocity: [4, 9], damping: [5, 8], angle: [0, 360], scale: [0.6, 1.2] },
    { shader: 'spark', params: { hot: [1, 0.95, 0.75, 1], cool: [1, 0.4, 0.08, 1] }, mesh: { quad: [0.04, 0.4] }, amount: 22, lifetime: 0.45, offsetY: 0.1, facing: 'velocity', direction: UP, spread: 75, gravityY: -12, velocity: [5, 12], damping: [3, 6], scale: [0.6, 1.3] },
    { shader: 'flash', params: { color: [1, 0.7, 0.3, 1], ray_count: 0, core_size: 0.5 }, mesh: { quad: [3, 3] }, amount: 1, lifetime: 0.16, offsetY: 0.35, facing: 'billboard' },
    { shader: 'star', params: { body: [1, 0.62, 0.18, 1], rim: [0.85, 0.25, 0.05, 1], points: 6, short_points: 0.7 }, mesh: { quad: [2.6, 3.2] }, amount: 1, lifetime: 0.2, offsetY: 0.55, facing: 'billboard', angle: [85, 95] },
  ],
}

/** How long an effect lasts (its longest layer). */
export function impactFxDuration(kind: ImpactFxKind): number {
  return Math.max(...IMPACT_FX[kind].map(layer => layer.lifetime))
}

const rand = (r: Range | undefined, fallback = 0) => (r ? r[0] + Math.random() * (r[1] - r[0]) : fallback)
const DEG = Math.PI / 180

function makeGeometry(mesh: LayerSpec['mesh']): THREE.BufferGeometry {
  if ('quad' in mesh) return new THREE.PlaneGeometry(mesh.quad[0], mesh.quad[1])
  if ('plane' in mesh) return new THREE.PlaneGeometry(mesh.plane, mesh.plane).rotateX(-Math.PI / 2)
  // Godot's SphereMesh(radius, height, radial_segments 5, rings 2): a squashed low-poly rock.
  return new THREE.SphereGeometry(mesh.rock[0], 5, 2).scale(1, mesh.rock[1] / (mesh.rock[0] * 2), 1).toNonIndexed()
}

/** A direction within `spread` degrees of `dir` (flatness 1: within the ground plane). */
function spreadDirection(dir: THREE.Vector3, spreadDeg: number, flatness: number, out: THREE.Vector3): THREE.Vector3 {
  if (flatness >= 1) {
    const base = Math.atan2(dir.z, dir.x)
    const a = base + (Math.random() * 2 - 1) * spreadDeg * DEG
    return out.set(Math.cos(a), 0, Math.sin(a))
  }
  const cosMax = Math.cos(Math.min(180, spreadDeg) * DEG)
  const cosT = 1 - Math.random() * (1 - cosMax)
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
  const phi = Math.random() * Math.PI * 2
  out.set(Math.cos(phi) * sinT, cosT, Math.sin(phi) * sinT) // around +Y
  return out.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
}

interface Particle {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  damping: number
  scale: number
  angle: number
  spin: THREE.Vector3
  angVel: number
}

class Layer {
  readonly mesh: THREE.InstancedMesh
  private readonly ages: Float32Array
  private readonly particles: Particle[]
  readonly lifetime: number

  constructor(private readonly spec: LayerSpec, scale: number) {
    const geometry = makeGeometry(spec.mesh)
    this.ages = new Float32Array(spec.amount)
    const seeds = new Float32Array(spec.amount)
    for (let i = 0; i < spec.amount; i++) seeds[i] = Math.random()
    geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(this.ages, 1))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    this.mesh = new THREE.InstancedMesh(geometry, impactMaterial(spec.shader, spec.params), spec.amount)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = spec.facing === 'ground' ? 1 : 2
    const dir = new THREE.Vector3(...(spec.direction ?? [1, 0, 0])).normalize()
    this.particles = Array.from({ length: spec.amount }, () => {
      const pos = new THREE.Vector3(0, (spec.offsetY ?? 0) * scale, 0)
      if (spec.emitRadius) {
        const r = spec.emitRadius * scale * Math.cbrt(Math.random())
        pos.add(new THREE.Vector3().randomDirection().multiplyScalar(r))
      }
      const speed = rand(spec.velocity) * scale
      const vel = speed > 0 ? spreadDirection(dir, spec.spread ?? 45, spec.flatness ?? 0, new THREE.Vector3()).multiplyScalar(speed) : new THREE.Vector3()
      return {
        pos, vel,
        life: spec.lifetime * (1 - Math.random() * (spec.lifetimeRandomness ?? 0)),
        damping: rand(spec.damping) * scale,
        scale: rand(spec.scale, 1) * scale,
        angle: rand(spec.angle) * DEG,
        spin: new THREE.Vector3().randomDirection(),
        angVel: rand(spec.angularVelocity) * DEG,
      }
    })
    this.lifetime = spec.lifetime
  }

  private static readonly _m = new THREE.Matrix4()
  private static readonly _q = new THREE.Quaternion()
  private static readonly _q2 = new THREE.Quaternion()
  private static readonly _s = new THREE.Vector3()
  private static readonly _x = new THREE.Vector3()
  private static readonly _y = new THREE.Vector3()
  private static readonly _z = new THREE.Vector3()
  private static readonly _zAxis = new THREE.Vector3(0, 0, 1)
  private static readonly _yAxis = new THREE.Vector3(0, 1, 0)

  /** Moves the particles to time `t` (s since the effect began, stepped by `dt`); false once every one is gone. */
  update(t: number, dt: number, camera: THREE.Camera, gravityScale: number): boolean {
    const { _m, _q, _q2, _s, _x, _y, _z, _zAxis, _yAxis } = Layer
    let alive = false
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      const age = t / p.life
      if (age >= 1) {
        this.ages[i] = 1
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0))
        continue
      }
      alive = true
      this.ages[i] = Math.max(0, age)
      // Godot: gravity adds, damping takes speed off linearly.
      if (dt > 0) {
        p.vel.y += (this.spec.gravityY ?? 0) * gravityScale * dt
        if (p.damping > 0) {
          const speed = p.vel.length()
          const next = Math.max(0, speed - p.damping * dt)
          if (speed > 0) p.vel.multiplyScalar(next / speed)
        }
        p.pos.addScaledVector(p.vel, dt)
      }
      _s.setScalar(p.scale)
      switch (this.spec.facing) {
        case 'billboard':
          _q.copy(camera.quaternion).multiply(_q2.setFromAxisAngle(_zAxis, p.angle))
          break
        case 'upright':
          _q.copy(camera.quaternion)
          break
        case 'ground':
          _q.setFromAxisAngle(_yAxis, p.angle)
          break
        case 'free':
          _q.setFromAxisAngle(p.spin, p.angle + p.angVel * t)
          break
        case 'velocity': {
          // Face the camera with the quad's Y along the on-screen flight (Godot's FX_ALIGN_VELOCITY).
          _z.set(0, 0, 1).applyQuaternion(camera.quaternion)
          _y.copy(p.vel).addScaledVector(_z, -_z.dot(p.vel))
          if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0).applyQuaternion(camera.quaternion)
          _y.normalize()
          _x.crossVectors(_y, _z).normalize()
          _m.makeBasis(_x, _y, _z)
          _q.setFromRotationMatrix(_m)
          break
        }
      }
      _m.compose(p.pos, _q, _s)
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    ;(this.mesh.geometry.getAttribute('aAge') as THREE.InstancedBufferAttribute).needsUpdate = true
    return alive
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

/**
 * One hit effect at `position`. Plays once and calls onDone. `scale` sizes it (1 = the Godot sizes, in metres).
 * `hold` freezes it at that time (s) and never ends it: the shader warm-up keeps one of each.
 */
export function ImpactFx({ kind, position, scale = 1, hold, onDone }: {
  kind: ImpactFxKind
  position: [number, number, number]
  scale?: number
  hold?: number
  onDone?: () => void
}) {
  const camera = useThree(state => state.camera)
  const layers = useMemo(() => IMPACT_FX[kind].map(spec => new Layer(spec, scale)), [kind, scale])
  const group = useMemo(() => {
    const g = new THREE.Group()
    for (const layer of layers) g.add(layer.mesh)
    return g
  }, [layers])
  const time = useRef(0)
  const done = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => () => { for (const layer of layers) layer.dispose() }, [layers])

  useFrame((_, rawDelta) => {
    if (done.current) return
    if (hold !== undefined) {
      for (const layer of layers) layer.update(hold, 0, camera, scale)
      return
    }
    // Tests can slow it down to look at it frame by frame (window.__impactFxTimeScale, e.g. 0.15).
    const timeScale = (globalThis as { __impactFxTimeScale?: number }).__impactFxTimeScale ?? 1
    const dt = Math.min(rawDelta, 0.05) * timeScale
    time.current += dt
    let alive = false
    for (const layer of layers) alive = layer.update(time.current, dt, camera, scale) || alive
    if (!alive) {
      done.current = true
      group.visible = false
      onDoneRef.current?.()
    }
  })

  return <primitive object={group} position={position} />
}
