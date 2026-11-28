// ░▒▓ FEET ON THE GROUND ▓▒░
// The owner, 27 Nov: "I'm sunken into the ground and a bunch of agents are sunken into the ground, up to their
// ankles... me personally, I see that I'm floating slightly above... I'm looking at Tyler, and he's sitting, and his
// feet are hanging under zero." A body is placed by its centre point, and where its feet then land depends on the
// body (its leg length against the clips' skeleton, its rest pose, its soles) and on the clip (a ground sit drops
// the hips). So after the animation, each frame: find the lowest sole (the ankles and toes, less how high each sits
// above the sole at rest, read once from the body's own bind data) and ease the whole body up or down so that sole
// stands on the ground under it (the terrain, or the floor a crafted plaza or step puts there: ground-guard.ts).
// A deliberate lift (a jump, a flip, a kick: the lowest sole well above the ground) is left alone, and the
// correction never goes past MAX_SHIFT, so a broken measure can't throw a body into the sky.

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

/** The most a body is ever moved up or down, metres. */
export const MAX_SHIFT = 0.3
/** Lowest sole this far above the ground or more: it is in the air on purpose, nothing is corrected. */
export const AIR = 0.12
/** How fast the correction follows (per second): a constant offset is taken out in a fraction of a second, a step's
 *  toe-off barely moves the body. */
export const RATE = 6

/**
 * One frame of the correction. `offset`: the shift applied now; `gap`: ground height minus the lowest sole as the
 * body stands now (with that shift in it; positive: sunk, negative: above). Returns the next shift.
 */
export function groundingStep(offset: number, gap: number, dt: number): number {
  if (!Number.isFinite(gap) || !(dt > 0)) return offset
  // In the air on purpose: keep the shift as it is.
  if (gap < -AIR) return offset
  const target = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, offset + gap))
  return offset + (target - offset) * Math.min(1, dt * RATE)
}

type Bone = Parameters<VRM['humanoid']['getRawBoneNode']>[0]
const SOLE_BONES: Bone[] = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']

export interface SoleRest {
  /** Raw bone -> how high it sits above the sole at rest (metres, world, at bind). */
  heights: Map<THREE.Object3D, number>
}

/**
 * How high each foot bone sits above the soles at rest, from the body's own bind data (the skinned meshes'
 * vertices and the bones' inverse binds), so it does not matter what the body is playing when this is asked.
 * Null when the body has no feet or no skin.
 */
export function measureSoleRest(vrm: VRM): SoleRest | null {
  let lowest = Infinity
  const bindOf = new Map<THREE.Object3D, THREE.Matrix4>()
  const v = new THREE.Vector3()
  vrm.scene.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix)
      if (v.y < lowest) lowest = v.y
    }
    mesh.skeleton.bones.forEach((bone, index) => {
      if (!bindOf.has(bone)) bindOf.set(bone, new THREE.Matrix4().copy(mesh.skeleton.boneInverses[index]).invert())
    })
  })
  if (!Number.isFinite(lowest)) return null
  const heights = new Map<THREE.Object3D, number>()
  for (const name of SOLE_BONES) {
    const bone = vrm.humanoid.getRawBoneNode(name)
    const bind = bone && bindOf.get(bone)
    if (!bone || !bind) continue
    heights.set(bone, v.setFromMatrixPosition(bind).y - lowest)
  }
  return heights.size ? { heights } : null
}

/** The lowest sole of the body as it stands now (world y), or null without feet. */
export function lowestSole(rest: SoleRest): number | null {
  let low = Infinity
  const p = new THREE.Vector3()
  for (const [bone, height] of rest.heights) {
    bone.getWorldPosition(p)
    low = Math.min(low, p.y - height)
  }
  return Number.isFinite(low) ? low : null
}
