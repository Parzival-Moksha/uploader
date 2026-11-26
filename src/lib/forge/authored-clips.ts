// Clips written in code instead of motion capture: Hipster's test of the owner's question "could the Hipster
// generate motion from a prompt?". Poses are set on the VRM normalized humanoid, where every bone's rest
// rotation is the identity and the axes are the world's (the character faces +Z, its left is +X), so a pose is
// "this segment points that way". Small sine motions on top make it alive. Sitting and typing (Hipster), and
// standing and typing (Animator, 24 Nov: the owner wants working agents "typing on a computer", sitting "or maybe
// standing"; standing needs no chair).

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

export const AUTHORED_CLIPS = [
  { id: 'authored-sit-type', label: 'Sit and type (code)' },
  { id: 'authored-stand-type', label: 'Stand and type (code)' },
] as const

export function isAuthoredClip(id: string): boolean {
  return AUTHORED_CLIPS.some(clip => clip.id === id)
}

type V = [number, number, number]
const v = (a: V) => new THREE.Vector3(...a).normalize()

/** Rest directions of the segments in the normalized T-pose. */
const REST: Record<string, V> = {
  leftUpperArm: [1, 0, 0], leftLowerArm: [1, 0, 0], leftHand: [1, 0, 0],
  rightUpperArm: [-1, 0, 0], rightLowerArm: [-1, 0, 0], rightHand: [-1, 0, 0],
  leftUpperLeg: [0, -1, 0], leftLowerLeg: [0, -1, 0],
  rightUpperLeg: [0, -1, 0], rightLowerLeg: [0, -1, 0],
}

const PARENT: Record<string, string | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftUpperArm: 'chest', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightUpperArm: 'chest', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg',
}

/** World rotations of the sitting, typing pose at time t (seconds) in a 2-second loop. */
function sitTypePose(t: number): Record<string, THREE.Quaternion> {
  const w = 2 * Math.PI / 2 // one loop every 2 s
  const tapL = Math.sin(t * w * 4) * 0.05 // fingers on the keys: a quick alternate patter
  const tapR = Math.sin(t * w * 4 + Math.PI) * 0.05
  const breathe = Math.sin(t * w) * 0.015
  const look = Math.sin(t * w * 0.5) * 0.06 // eyes from one side of the screen to the other
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.16 + breathe)
  const dir = (bone: string, to: V) => new THREE.Quaternion().setFromUnitVectors(v(REST[bone]), v(to))
  const headTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), look)
  const headTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32)
  return {
    hips: new THREE.Quaternion(),
    spine: lean.clone(),
    chest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.04)),
    upperChest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06)),
    neck: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06)),
    head: headTurn.multiply(headTilt),
    leftUpperArm: dir('leftUpperArm', [0.18, -0.88, 0.42]),
    rightUpperArm: dir('rightUpperArm', [-0.18, -0.88, 0.42]),
    leftLowerArm: dir('leftLowerArm', [-0.18, -0.12 + tapL, 1]),
    rightLowerArm: dir('rightLowerArm', [0.18, -0.12 + tapR, 1]),
    leftHand: dir('leftHand', [-0.1, -0.25 + tapL * 2, 1]),
    rightHand: dir('rightHand', [0.1, -0.25 + tapR * 2, 1]),
    leftUpperLeg: dir('leftUpperLeg', [0.06, -0.08, 1]),
    rightUpperLeg: dir('rightUpperLeg', [-0.06, -0.08, 1]),
    leftLowerLeg: dir('leftLowerLeg', [0.02, -1, 0.12]),
    rightLowerLeg: dir('rightLowerLeg', [-0.02, -1, 0.12]),
    leftFoot: new THREE.Quaternion(),
    rightFoot: new THREE.Quaternion(),
  }
}

/** 0 outside [from, from + 1] s, a smooth rise and fall inside it (0 at both ends, so a loop closes). */
function bump(t: number, from: number): number {
  if (t < from || t > from + 1) return 0
  const s = Math.sin(Math.PI * (t - from))
  return s * s
}

/**
 * World rotations of the standing, typing pose at time t in a 4-second loop: three seconds of typing at a keyboard
 * held at elbow height, eyes down on a screen just above it; then a one-second pause, hands a little up off the keys,
 * head up, as if thinking, back to the keys as the loop closes. Weight shifts slowly from foot to foot.
 */
function standTypePose(t: number): Record<string, THREE.Quaternion> {
  const loop = 4
  const pause = bump(t, 3)
  const typing = 1 - pause
  // 14 taps in 4 s (3.5 a second), left and right alternating; whole numbers of cycles keep the loop seamless.
  const tapL = Math.sin(t * 2 * Math.PI * (14 / loop)) * 0.045 * typing
  const tapR = Math.sin(t * 2 * Math.PI * (14 / loop) + Math.PI) * 0.045 * typing
  const sway = Math.sin(t * 2 * Math.PI / loop) * 0.035
  const breathe = Math.sin(t * 2 * Math.PI * (2 / loop)) * 0.012
  const look = Math.sin(t * 2 * Math.PI * (1 / loop)) * 0.07 * typing
  const X = new THREE.Vector3(1, 0, 0)
  const Y = new THREE.Vector3(0, 1, 0)
  const Z = new THREE.Vector3(0, 0, 1)
  const dir = (bone: string, to: V) => new THREE.Quaternion().setFromUnitVectors(v(REST[bone]), v(to))
  const hipsTurn = new THREE.Quaternion().setFromAxisAngle(Y, sway * 0.6).multiply(new THREE.Quaternion().setFromAxisAngle(Z, sway * 0.4))
  const lean = hipsTurn.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.07 + breathe))
  const up = 0.12 * pause
  return {
    hips: hipsTurn.clone(),
    spine: lean.clone(),
    chest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.03)),
    upperChest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.04)),
    neck: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.05)),
    // Eyes down on the screen, across it while typing; up while thinking.
    head: new THREE.Quaternion().setFromAxisAngle(Y, look).multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.34 - 0.42 * pause)),
    leftUpperArm: dir('leftUpperArm', [0.14, -0.9, 0.3]),
    rightUpperArm: dir('rightUpperArm', [-0.14, -0.9, 0.3]),
    leftLowerArm: dir('leftLowerArm', [-0.2, 0.02 + tapL + up, 1]),
    rightLowerArm: dir('rightLowerArm', [0.2, 0.02 + tapR + up, 1]),
    leftHand: dir('leftHand', [-0.08, -0.22 + tapL * 2 + up, 1]),
    rightHand: dir('rightHand', [0.08, -0.22 + tapR * 2 + up, 1]),
    leftUpperLeg: dir('leftUpperLeg', [0.05, -1, 0.01]),
    rightUpperLeg: dir('rightUpperLeg', [-0.05, -1, 0.01]),
    leftLowerLeg: dir('leftLowerLeg', [0.03, -1, -0.02]),
    rightLowerLeg: dir('rightLowerLeg', [-0.03, -1, -0.02]),
    leftFoot: new THREE.Quaternion(),
    rightFoot: new THREE.Quaternion(),
  }
}

/**
 * Fingers resting on keys (the owner, 24 Nov: "your fingers look crooked": the clips left them in whatever rest pose
 * the body has): every finger curled down from the knuckle, index and middle tapping with the keys. Local rotations:
 * in the normalized rig a finger points along its hand (+X on the left, -X on the right), so curling it down towards
 * the palm is a turn about Z, negative on the left, positive on the right. The thumb is left as it is.
 */
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const
const CURL = { Proximal: 0.42, Intermediate: 0.5, Distal: 0.32 } as const
function typingFingers(t: number, period: number, taps: number): Record<string, THREE.Quaternion> {
  const out: Record<string, THREE.Quaternion> = {}
  const Z = new THREE.Vector3(0, 0, 1)
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1
    FINGERS.forEach((finger, index) => {
      const phase = (side === 'left' ? 0 : Math.PI) + index * 1.3
      const tap = finger === 'Index' || finger === 'Middle' ? Math.max(0, Math.sin(t * 2 * Math.PI * (taps / period) + phase)) * 0.22 : 0
      for (const joint of ['Proximal', 'Intermediate', 'Distal'] as const) {
        const angle = CURL[joint] + (joint === 'Proximal' ? tap : tap * 0.5)
        out[`${side}${finger}${joint}`] = new THREE.Quaternion().setFromAxisAngle(Z, sign * angle)
      }
    })
  }
  return out
}

const AUTHORED: Record<string, { pose: (t: number) => Record<string, THREE.Quaternion>; fingers?: (t: number) => Record<string, THREE.Quaternion>; duration: number; keys: number; seated: boolean }> = {
  'authored-sit-type': { pose: sitTypePose, fingers: t => typingFingers(t, 2, 8), duration: 2, keys: 25, seated: true },
  'authored-stand-type': { pose: standTypePose, fingers: t => typingFingers(t, 4, 14), duration: 4, keys: 61, seated: false },
}

/** Build the clip for one avatar (bone names differ between VRM files). */
export function buildAuthoredClip(id: string, vrm: VRM): THREE.AnimationClip | null {
  const spec = AUTHORED[id]
  if (!spec) return null
  const { duration, keys } = spec
  const times = Array.from({ length: keys }, (_, i) => (i / (keys - 1)) * duration)
  const poses = times.map(t => spec.pose(t))
  const vrm0 = (vrm.meta as { metaVersion?: string } | undefined)?.metaVersion === '0'
  const tracks: THREE.KeyframeTrack[] = []
  for (const bone of Object.keys(PARENT)) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    if (!node) continue
    const values: number[] = []
    for (const pose of poses) {
      // local = (world rotation of the nearest present parent)^-1 * world rotation of this bone
      let parent = PARENT[bone]
      while (parent && !vrm.humanoid.getNormalizedBoneNode(parent as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])) parent = PARENT[parent]
      const world = pose[bone] ?? new THREE.Quaternion()
      const local = parent ? (pose[parent] ?? new THREE.Quaternion()).clone().invert().multiply(world) : world.clone()
      if (vrm0) { local.x = -local.x; local.z = -local.z }
      values.push(local.x, local.y, local.z, local.w)
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  }
  // Finger bones: their own local rotations (the rig's finger rest is the identity, as for every normalized bone).
  if (spec.fingers) {
    const fingerPoses = times.map(t => spec.fingers!(t))
    for (const bone of Object.keys(fingerPoses[0])) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
      if (!node) continue
      const values: number[] = []
      for (const pose of fingerPoses) {
        const local = pose[bone].clone()
        if (vrm0) { local.x = -local.x; local.z = -local.z }
        values.push(local.x, local.y, local.z, local.w)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
    }
  }
  // Seated: hips down to chair height and a little back. Standing: the hips stay where the rest pose has them.
  const hips = vrm.humanoid.getNormalizedBoneNode('hips' as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
  const rest = (vrm.humanoid as unknown as { normalizedRestPose?: { hips?: { position?: number[] } } }).normalizedRestPose?.hips?.position
  if (spec.seated && hips && rest) {
    const sign = vrm0 ? -1 : 1
    const values: number[] = []
    for (let i = 0; i < keys; i++) values.push(rest[0], rest[1] * 0.56, rest[2] - sign * rest[1] * 0.12)
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, values))
  }
  return new THREE.AnimationClip(id, duration, tracks)
}
