'use client'

// The body you wear, turning in the Character menu (the owner, 26 Nov: "the gamer wants to see the literal character,
// the VRM rotating, like in a cool game... people can pick it up and rotate it with the mouse. A showcase window, the
// one that we have for the avatar selector, but smaller."). Owned by Hipster.
//
// Its own small canvas: the body loads here with its own loader (not drei's cached useLoader), so the showcase never
// takes the model the world is drawing. It plays the idle, turns slowly, and a drag turns it by hand (the slow turn
// resumes a moment after). No zoom, no pan: a showcase, not an editor.

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { isUALAnimation, loadAnimationClip, retargetClipForVRM, retargetUALClipForVRM } from '@/lib/forge/animation-library'
import { buildAuthoredClip, isAuthoredClip } from '@/lib/forge/authored-clips'

/** Slightly to the right and above, as in the avatar gallery. */
const VIEW = new THREE.Vector3(0.3, 0.18, 1).normalize()

async function idleFor(vrm: VRM, url: string): Promise<THREE.AnimationClip | null> {
  if (isAuthoredClip('idle')) return buildAuthoredClip('idle', vrm)
  const clip = await loadAnimationClip('idle')
  if (!clip) return null
  const retargeted = isUALAnimation('idle') ? retargetUALClipForVRM(clip, vrm, `showcase::${url}::idle`) : retargetClipForVRM(clip, vrm, `showcase::${url}::idle`)
  return retargeted.tracks.length > 0 ? retargeted : null
}

function Body({ url, onReady, onFail }: { url: string; onReady: () => void; onFail: () => void }) {
  const { camera } = useThree() as unknown as { camera: THREE.PerspectiveCamera }
  const [root, setRoot] = useState<THREE.Group | null>(null)
  const vrmRef = useRef<VRM | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  useEffect(() => {
    let cancelled = false
    let loaded: THREE.Object3D | null = null
    const loader = new GLTFLoader()
    loader.register(parser => new VRMLoaderPlugin(parser))
    loader.loadAsync(url).then(async gltf => {
      if (cancelled) { VRMUtils.deepDispose(gltf.scene); return }
      const vrm = gltf.userData.vrm as VRM | undefined
      loaded = vrm ? vrm.scene : gltf.scene
      if (vrm) VRMUtils.rotateVRM0(vrm)
      const group = new THREE.Group()
      group.add(loaded)
      group.updateMatrixWorld(true)
      // The body's middle at the origin; the camera fits its height (the idle's arms hang, so the height decides).
      const box = new THREE.Box3().setFromObject(group, true)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      loaded.position.sub(center)
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2
      camera.position.copy(VIEW).multiplyScalar((size.y / 2) / Math.tan(vertical) / 0.9)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      // On screen at once; the idle (a large animation file the first time) starts when it has come.
      setRoot(group)
      onReadyRef.current()
      if (vrm) {
        vrmRef.current = vrm
        const mixer = new THREE.AnimationMixer(vrm.scene)
        mixerRef.current = mixer
        const idle = await idleFor(vrm, url).catch(() => null)
        if (idle && !cancelled && mixerRef.current === mixer) mixer.clipAction(idle).play()
      }
    }).catch(err => {
      console.warn('[BodyShowcase] the body did not load:', err)
      if (!cancelled) onFailRef.current()
    })
    return () => {
      cancelled = true
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      vrmRef.current = null
      if (loaded) VRMUtils.deepDispose(loaded)
    }
  }, [url, camera])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
    vrmRef.current?.update(delta)
  })

  return root ? <primitive object={root} /> : null
}

/** A drag turns it; let go and the slow turn comes back after a moment. */
function TurnControls() {
  const controls = useRef<React.ElementRef<typeof OrbitControls>>(null)
  const resumeAt = useRef(0)
  useFrame(() => {
    const c = controls.current
    if (c && !c.autoRotate && performance.now() > resumeAt.current) c.autoRotate = true
  })
  return (
    <OrbitControls
      ref={controls}
      enableZoom={false}
      enablePan={false}
      autoRotate
      autoRotateSpeed={1.6}
      rotateSpeed={0.8}
      // A turn around the body, a little up and down, never under the floor or over the head.
      minPolarAngle={Math.PI * 0.32}
      maxPolarAngle={Math.PI * 0.58}
      onStart={() => { if (controls.current) controls.current.autoRotate = false; resumeAt.current = Number.POSITIVE_INFINITY }}
      onEnd={() => { resumeAt.current = performance.now() + 2500 }}
    />
  )
}

export function BodyShowcase({ url, className }: { url: string; className?: string }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative cursor-grab overflow-hidden active:cursor-grabbing ${className ?? ''}`} data-character-showcase title="Drag to turn">
      {/* A soft pool of light under the body, behind the canvas. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 42% at 50% 62%, rgba(245,201,106,0.16), rgba(0,0,0,0) 70%)' }} />
      <Canvas
        className="!absolute inset-0"
        dpr={[1, 2]}
        camera={{ fov: 28, near: 0.05, far: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        style={{ opacity: ready ? 1 : 0, transition: 'opacity 400ms ease-out' }}
      >
        <ambientLight intensity={1.1} color="#b8b2d0" />
        <directionalLight position={[2.5, 3.5, 4]} intensity={2.1} />
        <directionalLight position={[-3, 2.5, -2.5]} intensity={1.2} color="#ffc47a" />
        <Suspense fallback={null}>
          <Body url={url} onReady={() => setReady(true)} onFail={() => setFailed(true)} />
        </Suspense>
        <TurnControls />
      </Canvas>
      {!ready && <div className="kit-label absolute inset-x-0 bottom-3 text-center opacity-60">{failed ? 'Your body could not be shown here.' : 'Bringing your body…'}</div>}
    </div>
  )
}
