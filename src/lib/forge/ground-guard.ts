// ░▒▓ GROUND GUARD — no walking off a world that has no ground ▓▒░
// Worlds without a ground preset (Floating Isle, Neon Harbor) are walked on their crafted surfaces, whose tops are
// at y = 0; everywhere else the player stood on an invisible floor at 0, so they could walk off the island and on
// over the sky (owner, 20 Nov; a newcomer's first worlds must not drop them into nothing). Here a step from solid
// footing onto a spot with nothing under the feet is refused; the player slides along the edge instead (the part
// of the step that stays on ground is kept). Worlds with a ground preset walk as before.
// "Under the feet": a ray from STEP_UP above the feet to STEP_DOWN below them hits a visible crafted mesh (tagged
// userData.oasisCraftedScene by CraftedSceneRenderer): the floor, or something standing on it (a ray starting inside a
// bench or a plinth would not hit it, and boxed the player in at Neon Harbor's spawn). Off the edge nothing is in
// that band; water a little lower (Neon Harbor, -1.4) is not ground. Answers are cached per CELL metres, so walking costs a few rays a second.

import * as THREE from 'three'

export const CELL = 0.5
export const STEP_UP = 3
export const STEP_DOWN = 0.6

const ray = new THREE.Raycaster()
const origin = new THREE.Vector3()
const down = new THREE.Vector3(0, -1, 0)

interface Guard {
  key: string
  roots: THREE.Object3D[]
  cells: Map<string, boolean>
}

let guard: Guard = { key: '', roots: [], cells: new Map() }

function visibleMesh(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false
  const mesh = object as THREE.Mesh
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.some(m => m && m.visible !== false && !(m.transparent && m.opacity < 0.05))
}

/** Is there ground under (x, z) at feet height? null: this world can't tell (nothing crafted found yet). */
export function groundUnder(scene: THREE.Object3D, key: string, x: number, z: number, feetY: number): boolean | null {
  if (guard.key !== key) {
    const roots: THREE.Object3D[] = []
    scene.traverse(object => { if (object.userData?.oasisCraftedScene) roots.push(object) })
    guard = { key, roots, cells: new Map() }
  }
  if (!guard.roots.length) return null
  const cell = `${Math.floor(x / CELL)},${Math.floor(z / CELL)},${Math.round(feetY)}`
  const known = guard.cells.get(cell)
  if (known !== undefined) return known
  origin.set((Math.floor(x / CELL) + 0.5) * CELL, feetY + STEP_UP, (Math.floor(z / CELL) + 0.5) * CELL)
  ray.set(origin, down)
  ray.near = 0
  ray.far = STEP_UP + STEP_DOWN
  const hit = ray.intersectObjects(guard.roots, true).some(h => visibleMesh(h.object))
  guard.cells.set(cell, hit)
  return hit
}

// ░▒▓ HOW HIGH IS THE GROUND HERE ▓▒░
// The one question everything that stands asks (agreed with Perf, 27 Nov, his physics note): the highest crafted top
// surface under (x, z) within a step of the feet, or null where nothing crafted is (then the terrain). The plaza's
// top is 2 cm above the terrain at the agents' ring and 6-8 cm at its centre, the stone paths 5 cm; bodies stood at
// 0, sunk into them. Rays only against the kept list of crafted roots (rebuilt when the key changes), one per 0.5 m
// cell, cached. The key carries a geometry version (geometryVersion: a world switch, a crafted scene added, moved or
// edited). Ease the answer where it is used: cells step 1-2 cm at the plaza's layers. Perf's footprint grid can
// replace the inside of groundHeightAt later; no caller changes.

/** The window a floor is looked for in, around the feet: up to a step above, a little below. */
export const FLOOR_ABOVE = 0.35
export const FLOOR_BELOW = 0.6

/** The cache cell of (x, z) at feet height feetY (half-metre cells, feet in half-metre bands). */
export function floorCellKey(x: number, z: number, feetY: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)},${Math.round(feetY * 2)}`
}

/** Of the heights a downward ray met, the floor: the highest within the window around the feet; null if none. */
export function pickFloor(hitHeights: number[], feetY: number): number | null {
  let best: number | null = null
  for (const y of hitHeights) {
    if (y > feetY + FLOOR_ABOVE || y < feetY - FLOOR_BELOW) continue
    if (best === null || y > best) best = y
  }
  return best
}

const versions = new WeakMap<object, number>()
let nextVersion = 1
/** A version for the world's geometry: changes whenever one of these objects is replaced (the store replaces its
 *  crafted scenes and transforms on every add, move or edit). */
export function geometryVersion(...parts: object[]): string {
  return parts.map(part => {
    let version = versions.get(part)
    if (version === undefined) { version = nextVersion++; versions.set(part, version) }
    return version
  }).join('.')
}

interface Floors { key: string; roots: THREE.Object3D[]; cells: Map<string, number | null> }
let floors: Floors = { key: '', roots: [], cells: new Map() }

/** The ground height under (x, z) for feet at feetY: a crafted floor within a step, or null (use the terrain). */
export function groundHeightAt(scene: THREE.Object3D, key: string, x: number, z: number, feetY: number): number | null {
  if (floors.key !== key) {
    const roots: THREE.Object3D[] = []
    scene.traverse(object => { if (object.userData?.oasisCraftedScene) roots.push(object) })
    floors = { key, roots, cells: new Map() }
  }
  if (!floors.roots.length) return null
  const cell = floorCellKey(x, z, feetY)
  const known = floors.cells.get(cell)
  if (known !== undefined) return known
  origin.set((Math.floor(x / CELL) + 0.5) * CELL, feetY + FLOOR_ABOVE, (Math.floor(z / CELL) + 0.5) * CELL)
  ray.set(origin, down)
  ray.near = 0
  ray.far = FLOOR_ABOVE + FLOOR_BELOW
  const heights = ray.intersectObjects(floors.roots, true).filter(hit => visibleMesh(hit.object)).map(hit => hit.point.y)
  const floor = pickFloor(heights, feetY)
  floors.cells.set(cell, floor)
  return floor
}

/**
 * The step from (fromX, fromZ) to (toX, toZ), kept on the ground: the whole step if it lands on ground (or the
 * player is not on ground now: nothing traps them), else only its x or its z part, else no step. Pure apart from
 * `under`, so it is tested with a fake one.
 */
export function guardStep(
  fromX: number, fromZ: number, toX: number, toZ: number,
  under: (x: number, z: number) => boolean | null,
): { x: number; z: number; blocked: boolean } {
  const here = under(fromX, fromZ)
  if (here !== true) return { x: toX, z: toZ, blocked: false }
  if (under(toX, toZ) !== false) return { x: toX, z: toZ, blocked: false }
  if (under(toX, fromZ) === true) return { x: toX, z: fromZ, blocked: true }
  if (under(fromX, toZ) === true) return { x: fromX, z: toZ, blocked: true }
  return { x: fromX, z: fromZ, blocked: true }
}
