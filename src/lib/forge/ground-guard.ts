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
