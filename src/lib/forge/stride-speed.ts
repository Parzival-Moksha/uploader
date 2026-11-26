// How fast a walk or run clip carries a body over the ground, measured on that body.
//
// The clips play in place (or with their travel taken out, see hips-motion.ts), so while a foot is planted it
// slides backwards under the body at exactly the speed the body should move. We sample the clip once on the
// avatar it was retargeted for and read that speed. Playing the clip at (real speed ÷ this) then keeps the feet
// from skating, for a short body and a tall one alike, with any clip (Quaternius or Mixamo).

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

const SAMPLES = 96
interface StrideReading { speed: number | null; contacts: number[] }
const cache = new WeakMap<THREE.AnimationClip, StrideReading>()

/**
 * When the feet come down in a loop, as fractions of it (0..1, sorted): one per foot, the start of its stance, i.e.
 * of its longest stretch in the lowest quarter of its height range (a run's ankle dips twice, heel then toe; only the
 * stance counts). `heights[f][i]` is foot f's height at sample i, higher = up.
 * The owner, 2026-11-25: footstep sounds "out of sync" with the steps; they now play at these moments.
 */
export function footContactsFromHeights(heights: number[][]): number[] {
  const out: number[] = []
  for (const track of heights) {
    const n = track.length
    if (n < 4) continue
    const low = Math.min(...track)
    const high = Math.max(...track)
    if (!(high - low > 1e-4)) continue
    const line = low + (high - low) * 0.25
    const down = track.map(h => h <= line)
    if (down.every(Boolean)) continue
    // Walk the loop from a sample that is up, so a stretch that wraps round the end is seen whole.
    const from = down.indexOf(false)
    let best = -1
    let bestLength = 0
    let start = -1
    let length = 0
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n
      if (down[i]) {
        if (length === 0) start = i
        length++
        if (length > bestLength) { bestLength = length; best = start }
      } else length = 0
    }
    if (best >= 0) out.push(best / n)
  }
  out.sort((a, b) => a - b)
  // Two feet take turns evenly: a pair read uneven (the threshold catches one foot later than the other) is set half
  // a loop apart around its own average.
  if (out.length === 2 && Math.abs(out[1] - out[0] - 0.5) > 0.06) {
    const mid = ((out[0] + (out[1] - 0.5) + 1) / 2) % 1
    return [mid, (mid + 0.5) % 1].sort((a, b) => a - b)
  }
  return out
}

type BoneName = Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]

/** Metres a second, or null when it can't be read (no feet, a clip that doesn't step). Cached per clip. */
export function measureStrideSpeed(vrm: VRM, clip: THREE.AnimationClip): number | null {
  return reading(vrm, clip).speed
}

/** When its feet come down (fractions of the loop); empty when it can't be read. Same measure, same cache. */
export function strideContacts(vrm: VRM, clip: THREE.AnimationClip): number[] {
  return reading(vrm, clip).contacts
}

function reading(vrm: VRM, clip: THREE.AnimationClip): StrideReading {
  const known = cache.get(clip)
  if (known) return known
  const result = measure(vrm, clip)
  cache.set(clip, result)
  return result
}

function measure(vrm: VRM, clip: THREE.AnimationClip): StrideReading {
  const none: StrideReading = { speed: null, contacts: [] }
  const feet = (['leftFoot', 'rightFoot'] as BoneName[]).map(name => vrm.humanoid.getNormalizedBoneNode(name)).filter(Boolean) as THREE.Object3D[]
  const hips = vrm.humanoid.getNormalizedBoneNode('hips' as BoneName)
  if (feet.length < 2 || !hips || !(clip.duration > 0.1)) return none
  // A mixer of its own: the avatar's real mixer writes every bound bone again on its next update.
  const mixer = new THREE.AnimationMixer(vrm.scene)
  const action = mixer.clipAction(clip)
  action.play()
  const inverse = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const tracks: { x: number; y: number; z: number }[][] = [[], []]
  const hipsY: number[] = []
  try {
    vrm.scene.updateWorldMatrix(true, true)
    inverse.copy(vrm.scene.matrixWorld).invert()
    for (let i = 0; i < SAMPLES; i++) {
      mixer.setTime((clip.duration * i) / SAMPLES)
      vrm.scene.updateMatrixWorld(true)
      hipsY.push(hips.getWorldPosition(p).applyMatrix4(inverse).y)
      feet.forEach((foot, f) => {
        foot.getWorldPosition(p).applyMatrix4(inverse)
        tracks[f].push({ x: p.x, y: p.y, z: p.z })
      })
    }
  } catch {
    return none
  } finally {
    action.stop()
    mixer.uncacheAction(clip)
    mixer.uncacheRoot(vrm.scene)
  }
  const dt = clip.duration / SAMPLES
  // In a loop played in place a foot goes back and forth along the walking line: backwards while it is on the
  // ground (at the body's speed), forwards through the air. So: split each sample step by which way the foot moves,
  // call the lower of the two ways the stance (measured from the hips, along the body's own up), and take its
  // distance over its time.
  // Up is from the feet to the hips, whatever way this rig's frame reads y; heights are taken from the hips, so
  // the body's bob doesn't count either.
  const meanFoot = tracks.flat().reduce((sum, s) => sum + s.y, 0) / (tracks[0].length * 2)
  const up = hipsY.reduce((sum, y) => sum + y, 0) / hipsY.length >= meanFoot ? 1 : -1
  const speeds: number[] = []
  for (const track of tracks) {
    const range = (pick: (s: { x: number; z: number }) => number) => Math.max(...track.map(pick)) - Math.min(...track.map(pick))
    const along = range(s => s.z) >= range(s => s.x) ? (s: { x: number; z: number }) => s.z : (s: { x: number; z: number }) => s.x
    const ways = [{ distance: 0, time: 0, height: 0 }, { distance: 0, time: 0, height: 0 }]
    for (let i = 0; i < track.length; i++) {
      const next = (i + 1) % track.length
      const a = track[i]
      const b = track[next]
      const step = along(b) - along(a)
      const way = ways[step >= 0 ? 0 : 1]
      way.distance += Math.abs(step)
      way.time += dt
      way.height += up * ((a.y - hipsY[i]) + (b.y - hipsY[next])) / 2 * dt
    }
    const moving = ways.filter(w => w.time > clip.duration * 0.15)
    if (moving.length < 2) continue
    const stance = moving[0].height / moving[0].time <= moving[1].height / moving[1].time ? moving[0] : moving[1]
    speeds.push(stance.distance / stance.time)
    if (typeof window !== 'undefined' && (window as unknown as { __strideDebug?: boolean }).__strideDebug) {
      console.info(`[stride] ${clip.name} dur ${clip.duration.toFixed(2)} ` + moving.map(w => `[t ${(w.time / clip.duration).toFixed(2)} d ${w.distance.toFixed(2)} h ${(w.height / w.time).toFixed(3)}]`).join(' '))
    }
  }
  const contacts = footContactsFromHeights(tracks.map(track => track.map((s, i) => up * (s.y - hipsY[i]))))
  if (!speeds.length) return { speed: null, contacts }
  const speed = speeds.reduce((sum, s) => sum + s, 0) / speeds.length
  return { speed: speed > 0.2 && speed < 15 ? speed : null, contacts }
}

/** Playback rate that matches a clip's steps to the body's real speed, kept within what still looks like that gait. */
export function strideTimeScale(realSpeed: number, naturalSpeed: number | null, fallback = 1): number {
  if (!naturalSpeed || !(realSpeed > 0)) return fallback
  return Math.max(0.35, Math.min(3.2, realSpeed / naturalSpeed))
}

export type Gait = 'walk' | 'run' | 'sprint'

/** How far past its own stride speed a gait may be played before the next one looks better (and back, a bit lower). */
const UP = { walk: 2.1, run: 1.9 }
const DOWN = { walk: 1.9, run: 1.7 }

/**
 * Which gait fits a speed, from the clips' measured speeds on this body (walk ~0.8 m/s, jog ~2.4, sprint ~3.8 for the
 * free pack on a 1.7 m avatar). A slow walk can be sped up about twice before it looks hurried; past that the jog,
 * and past about twice the jog the sprint. A little lower on the way down, so a speed on the line doesn't flicker.
 * Null when the walk's speed is unknown: the caller keeps its own thresholds.
 */
export function pickGait(speed: number, current: Gait | null, natural: { walk?: number | null; run?: number | null }): Gait | null {
  const walk = natural.walk
  if (!walk) return null
  const run = natural.run || walk * 3
  const walkTop = walk * (current === 'run' || current === 'sprint' ? DOWN.walk : UP.walk)
  const runTop = run * (current === 'sprint' ? DOWN.run : UP.run)
  if (speed <= walkTop) return 'walk'
  if (speed <= runTop) return 'run'
  return 'sprint'
}

let lastMeasureAt = -Infinity

/**
 * The same, but at most one new measure per frame across the page (Perf, 2026-11-20: a measure is 2-4 ms, and 24
 * agents told to follow at once would each measure on the same frame). Undefined: not measured yet, ask again next
 * frame and keep the pace you have meanwhile.
 */
export function strideSpeedThisFrame(vrm: VRM, clip: THREE.AnimationClip): number | null | undefined {
  const known = cache.get(clip)
  if (known) return known.speed
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - lastMeasureAt < 12) return undefined
  lastMeasureAt = now
  return measureStrideSpeed(vrm, clip)
}
