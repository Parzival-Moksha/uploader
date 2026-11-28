// ░▒▓ COMBAT STANCE — how the player's own body and camera change while a weapon is armed ▓▒░
// The owner, 25 Nov: the crosshair sat on (behind) his big avatar's head; "in Fortnite... it's slightly shifted
// to the right"; "there's a machine gun spell, but there's no machine gun in my hand".
// - Height: the avatar's measured height (head bone) scales the third-person camera and the cast origin, so a
//   tall or a small avatar frames the same.
// - Armed (a combat spell or the machine gun): the camera slides over the right shoulder (Fortnite's framing:
//   the crosshair to the right of the head, not on it) and the body turns to where the camera looks. Unarmed it
//   stays centred, as the owner asked on 9 Nov.
// - The machine gun: a rifle (Quaternius Sci-Fi Essentials, CC0) in the right hand. It hangs on the raw hand bone
//   (the one the animations move), turned by the rest-pose difference between the raw bone and the VRM's
//   normalised one, so the grip is written once in the normalised frame (the same on every VRM: fingers along
//   -X, palm down). Its barrel tip is the muzzle the tracers start from.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'

import { useOasisStore } from '@/store/oasisStore'

// ── height ──
/** The height the camera constants were tuned for (top of the head, metres). */
export const REFERENCE_AVATAR_HEIGHT = 1.65
let avatarHeight = REFERENCE_AVATAR_HEIGHT

/** Top of the head above the feet, in the rest pose (head bone + a little for the skull). */
export function measureAvatarHeight(vrm: VRM): number {
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  if (!head) return REFERENCE_AVATAR_HEIGHT
  vrm.scene.updateMatrixWorld(true)
  const headY = head.getWorldPosition(new THREE.Vector3()).y - vrm.scene.getWorldPosition(new THREE.Vector3()).y
  const height = headY + 0.14
  return Number.isFinite(height) && height > 0.4 && height < 6 ? height : REFERENCE_AVATAR_HEIGHT
}

export function setPlayerAvatarHeight(height: number): void { avatarHeight = height }
export function getPlayerAvatarHeight(): number { return avatarHeight }
/** The player's height over the reference, clamped: camera heights and offsets are multiplied by it. */
export function playerHeightScale(): number { return Math.max(0.6, Math.min(1.8, avatarHeight / REFERENCE_AVATAR_HEIGHT)) }

// ── armed ──
export type ArmedKind = 'bolt' | 'gun' | null

export function armedWeapon(): ArmedKind {
  const spell = useOasisStore.getState().selectedSpellId
  if (spell === 'machine-gun') return 'gun'
  if (spell === 'firebolt' || spell === 'lightning-bolt' || spell === 'ice-bolt') return 'bolt'
  return null
}

/** The body's gesture for a cast: a hurled fireball, a lightning thrust, an ice punch; the gun's recoil. */
export function castGestureFor(spell: string | null): { clip: string; loop: boolean } {
  switch (spell) {
    case 'firebolt': return { clip: 'ual-throw', loop: false }
    case 'ice-bolt': return { clip: 'ual-punch-cross', loop: false }
    case 'machine-gun': return { clip: 'ual-pistol-shoot', loop: true }
    default: return { clip: 'ual-spell-shoot', loop: true }
  }
}
/** Held while the machine gun is armed and the player stands still. */
export const GUN_AIM_CLIP = 'ual-pistol-aim'

// ── the gun ──
const RIFLE_URL = '/models/scifi-essentials/Gun_Rifle.gltf'
/** The rifle's barrel tip in its own space (its barrel runs along -X; the grip is at the origin). */
const RIFLE_MUZZLE: [number, number, number] = [-0.75, 0.13, 0]
/** In the normalised right hand: the hand's rest axes are the world's, fingers along -X, palm down. */
const GRIP_POSITION: [number, number, number] = [-0.06, -0.035, 0.01]
const GRIP_ROTATION: [number, number, number] = [0, 0, 0]
const RIFLE_SCALE = 0.85

let rifle: Promise<THREE.Object3D | null> | null = null
function loadRifle(): Promise<THREE.Object3D | null> {
  rifle ??= new Promise(resolve => {
    new GLTFLoader().load(RIFLE_URL, gltf => resolve(gltf.scene), undefined, () => { rifle = null; resolve(null) })
  })
  return rifle
}

let muzzle: THREE.Object3D | null = null
const _muzzle = new THREE.Vector3()

/** Where the held gun's barrel ends, in the world; null when no gun is in hand. */
export function getPlayerMuzzleWorld(out = _muzzle): THREE.Vector3 | null {
  if (!muzzle || !muzzle.parent) return null
  let visible = true
  for (let o: THREE.Object3D | null = muzzle; o; o = o.parent) if (!o.visible) { visible = false; break }
  if (!visible) return null
  muzzle.updateWorldMatrix(true, false)
  return muzzle.getWorldPosition(out)
}

/** A gun on the avatar's right hand; `set(true|false)` shows or hides it (the model loads once, on first show). */
/** Call while the VRM is still in its rest pose (before the first animation frame). */
export function createHeldGun(vrm: VRM): { set: (held: boolean) => void; dispose: () => void } {
  const holder = new THREE.Group()
  holder.name = 'held-gun'
  holder.visible = false
  const tip = new THREE.Object3D()
  tip.position.set(...RIFLE_MUZZLE)
  holder.add(tip)
  const hand = vrm.humanoid?.getRawBoneNode('rightHand') ?? null
  const normHand = vrm.humanoid?.getNormalizedBoneNode('rightHand') ?? null
  if (hand) {
    // In the rest pose the normalised hand's frame is the one the grip is written in; the raw bone's differs per
    // model (axes, and a scale on some). Express the grip in the raw bone's frame once.
    vrm.scene.updateMatrixWorld(true)
    const rawQ = hand.getWorldQuaternion(new THREE.Quaternion())
    const normQ = normHand ? normHand.getWorldQuaternion(new THREE.Quaternion()) : vrm.scene.getWorldQuaternion(new THREE.Quaternion())
    const rawScale = hand.getWorldScale(new THREE.Vector3())
    const toRaw = rawQ.clone().invert().multiply(normQ)
    holder.quaternion.copy(toRaw).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...GRIP_ROTATION)))
    holder.position.set(...GRIP_POSITION).applyQuaternion(toRaw).divide(rawScale)
    holder.scale.set(RIFLE_SCALE / rawScale.x, RIFLE_SCALE / rawScale.y, RIFLE_SCALE / rawScale.z)
    hand.add(holder)
  }
  let loading = false
  return {
    set(held) {
      holder.visible = held
      muzzle = held ? tip : (muzzle === tip ? null : muzzle)
      if (!held || loading || holder.children.length > 1) return
      loading = true
      void loadRifle().then(model => {
        if (!model) { loading = false; return }
        const copy = model.clone(true)
        copy.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
        holder.add(copy)
      })
    },
    dispose() {
      hand?.remove(holder)
      if (muzzle === tip) muzzle = null
    },
  }
}
