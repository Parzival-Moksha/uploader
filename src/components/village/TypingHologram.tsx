'use client'

// The laptop of an agent that works by typing (the owner, 24 Nov: "add one more animation to working, which is like
// typing on a computer", then "now let's make the laptop look real, and let's have zero four five one five display
// on the screen"). A thin aluminium base with its keyboard and trackpad, a hinge, a lid with a black bezel and a
// screen showing 04515 in the Pixels intro's dot matrix, cyan on near-black, with a soft glow in front of it. Shown
// only while the agent plays the standing typing clip (authored-clips.ts); it follows the body's own hand bones every
// frame, so it sits under the hands of any avatar, and without hand bones it does not show.
//
// Cost: the deck and the screen are drawn once into two canvas textures shared by every laptop; geometries and
// materials are shared too. No lights: the glow is an additive plane.

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { useFrameWhen } from '../../lib/use-frame-when'
import { textCells, textHeight, textWidth } from '../forge/splash/intro-overlay'

const LEFT_HAND = /(^|[^a-z])(l|left)[^a-z]*hand$|lefthand$|hand[._ ]?l$/i
const RIGHT_HAND = /(^|[^a-z])(r|right)[^a-z]*hand$|righthand$|hand[._ ]?r$/i

function findHands(root: THREE.Object3D): [THREE.Object3D, THREE.Object3D] | null {
  let left: THREE.Object3D | null = null
  let right: THREE.Object3D | null = null
  root.traverse(object => {
    if (!(object as THREE.Bone).isBone) return
    const name = object.name.replace(/^normalized_/i, '')
    if (!left && LEFT_HAND.test(name)) left = object
    else if (!right && RIGHT_HAND.test(name)) right = object
  })
  return left && right ? [left, right] : null
}

// ── Sizes (metres): a 13-inch laptop ──
const BASE = { w: 0.31, h: 0.013, d: 0.215 }
const LID = { w: 0.31, h: 0.205, d: 0.006 }
const SCREEN = { w: 0.276, h: 0.172 }
/** Lid tilted back past upright, as a laptop sits open. */
const LID_TILT = 0.3

interface LaptopParts {
  base: THREE.BufferGeometry
  lid: THREE.BufferGeometry
  hinge: THREE.BufferGeometry
  deckPlane: THREE.BufferGeometry
  bezelPlane: THREE.BufferGeometry
  screenPlane: THREE.BufferGeometry
  glowPlane: THREE.BufferGeometry
  metal: THREE.Material
  hingeMetal: THREE.Material
  deck: THREE.Material
  bezel: THREE.Material
  screen: THREE.Material
  glow: THREE.Material
}

let parts: LaptopParts | null = null

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return [element, element.getContext('2d') as CanvasRenderingContext2D]
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** The deck seen from above: aluminium, a dark keyboard well with its keys, the trackpad below it. Back edge on top. */
function drawDeck(): THREE.CanvasTexture {
  const [element, g] = canvas(512, 356)
  const grad = g.createLinearGradient(0, 0, 0, 356)
  grad.addColorStop(0, '#9aa0a8')
  grad.addColorStop(1, '#8a9099')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 356)
  // Keyboard well
  g.fillStyle = '#5e646c'
  roundRect(g, 34, 26, 444, 176, 10)
  g.fill()
  // Keys: five rows, a space bar
  const rows = [13, 13, 12, 11, 10]
  const key = 30
  const gap = 4
  rows.forEach((count, row) => {
    const width = count * key + (count - 1) * gap
    let x = 256 - width / 2
    const y = 36 + row * (key + gap)
    for (let i = 0; i < count; i++) {
      g.fillStyle = '#15171b'
      roundRect(g, x, y, key, key - 2, 4)
      g.fill()
      x += key + gap
    }
  })
  g.fillStyle = '#15171b'
  roundRect(g, 256 - 90, 36 + 5 * (key + gap), 180, key - 6, 4)
  g.fill()
  // Trackpad
  g.fillStyle = '#7f858e'
  roundRect(g, 176, 236, 160, 100, 10)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.18)'
  g.lineWidth = 2
  g.stroke()
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The screen: 04515 in the intro's dot matrix, cyan on near-black, with the intro's line under it. */
function drawScreen(): THREE.CanvasTexture {
  const [element, g] = canvas(512, 320)
  const grad = g.createRadialGradient(256, 150, 20, 256, 160, 320)
  grad.addColorStop(0, '#0b1d2a')
  grad.addColorStop(1, '#03070b')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 320)
  const text = '04515'
  const cell = 15
  const x0 = (512 - textWidth(text, cell)) / 2
  const y0 = (320 - textHeight(cell)) / 2 - 18
  g.shadowColor = 'rgba(80,220,255,0.9)'
  g.shadowBlur = 10
  g.fillStyle = '#7fe8ff'
  for (const glyph of textCells(text, x0, y0, cell)) {
    for (const dot of glyph) g.fillRect(dot.x + 1.5, dot.y + 1.5, cell - 3, cell - 3)
  }
  g.shadowBlur = 0
  g.fillStyle = 'rgba(127,232,255,0.55)'
  g.fillRect(x0, y0 + textHeight(cell) + 22, textWidth(text, cell), 3)
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function drawGlow(): THREE.CanvasTexture {
  const [element, g] = canvas(128, 128)
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(120,225,255,0.55)')
  grad.addColorStop(1, 'rgba(120,225,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(element)
}

/** Everything every laptop shares, made the first time one shows. */
function laptopParts(): LaptopParts {
  if (parts) return parts
  const metal = new THREE.MeshStandardMaterial({ color: '#a7adb5', metalness: 0.55, roughness: 0.38 })
  parts = {
    base: new RoundedBoxGeometry(BASE.w, BASE.h, BASE.d, 2, 0.006),
    lid: new RoundedBoxGeometry(LID.w, LID.h, LID.d, 2, 0.003),
    hinge: new THREE.CylinderGeometry(0.005, 0.005, BASE.w * 0.86, 10).rotateZ(Math.PI / 2),
    deckPlane: new THREE.PlaneGeometry(BASE.w - 0.012, BASE.d - 0.012).rotateX(-Math.PI / 2),
    bezelPlane: new THREE.PlaneGeometry(LID.w - 0.01, LID.h - 0.01).rotateY(Math.PI),
    screenPlane: new THREE.PlaneGeometry(SCREEN.w, SCREEN.h).rotateY(Math.PI),
    glowPlane: new THREE.PlaneGeometry(0.62, 0.42).rotateY(Math.PI),
    metal,
    hingeMetal: new THREE.MeshStandardMaterial({ color: '#4a4f56', metalness: 0.6, roughness: 0.4 }),
    deck: new THREE.MeshStandardMaterial({ map: drawDeck(), metalness: 0.45, roughness: 0.45 }),
    bezel: new THREE.MeshBasicMaterial({ color: '#07080a' }),
    screen: new THREE.MeshBasicMaterial({ map: drawScreen(), toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ map: drawGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  }
  return parts
}

export function TypingHologram({ active, bodyRoot }: { active: boolean; color?: string; bodyRoot: React.RefObject<THREE.Object3D> }) {
  const group = useRef<THREE.Group>(null)
  const hands = useRef<[THREE.Object3D, THREE.Object3D] | null>(null)
  const searched = useRef<THREE.Object3D | null>(null)
  const lastSearch = useRef(0)
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])

  useFrameWhen(active, () => {
    const g = group.current
    const root = bodyRoot.current
    if (!g || !root || !g.parent) return
    // The body may load (or change) after this mounts: look for its hands, again at most once a second until found.
    const now = performance.now()
    if (searched.current !== root || (!hands.current && now - lastSearch.current > 1000)) {
      searched.current = root
      lastSearch.current = now
      hands.current = findHands(root)
    }
    const pair = hands.current
    if (!pair) { g.visible = false; return }
    pair[0].getWorldPosition(a)
    pair[1].getWorldPosition(b)
    a.add(b).multiplyScalar(0.5)
    g.parent.worldToLocal(a)
    // The hand bones are the wrists: the fingers rest on the keys a little forward and below them.
    g.position.set(a.x, a.y - 0.045, a.z + 0.02)
    g.visible = true
  })

  if (!active) return null
  const p = laptopParts()
  // Local frame: the agent faces +Z, so the laptop's front edge (the trackpad) is toward the agent (-Z) and its
  // hinge away from it (+Z); the screen faces back at the agent.
  return (
    <group ref={group} visible={false}>
      <group position={[0, 0, BASE.d / 2 - 0.05]}>
        <mesh geometry={p.base} material={p.metal} />
        {/* The deck texture's top edge is the back (the hinge side): turned so it reads from the agent's side. */}
        <mesh geometry={p.deckPlane} material={p.deck} position={[0, BASE.h / 2 + 0.0006, 0]} rotation-y={Math.PI} />
        <mesh geometry={p.hinge} material={p.hingeMetal} position={[0, BASE.h / 2, BASE.d / 2 - 0.006]} />
        <group position={[0, BASE.h / 2, BASE.d / 2 - 0.006]} rotation-x={LID_TILT}>
          <mesh geometry={p.lid} material={p.metal} position={[0, LID.h / 2, 0]} />
          <mesh geometry={p.bezelPlane} material={p.bezel} position={[0, LID.h / 2, -LID.d / 2 - 0.0005]} />
          <mesh geometry={p.screenPlane} material={p.screen} position={[0, LID.h / 2 + 0.006, -LID.d / 2 - 0.001]} />
          {/* The screen's light on the hands and the keys: an additive glow just in front of it. */}
          <mesh geometry={p.glowPlane} material={p.glow} position={[0, LID.h / 2 - 0.04, -0.09]} rotation-x={-0.5} />
        </group>
      </group>
    </group>
  )
}
