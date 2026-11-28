// A portrait of the body you wear, for your profile picture (the owner, 26 Nov: "I cannot seem to change my profile
// picture. I can change the body."). Head and shoulders, from a little to the side, on the gallery's background,
// rendered once in the browser from the body's own file. Owned by Hipster; used by the Character menu.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'

/** The avatar gallery's tile background, so a portrait sits with the thumbnails. */
const BACKGROUND = '#1d1b27'
/** In front, a little to the right and barely above: a portrait, not the gallery's look from above. */
const VIEW = new THREE.Vector3(0.38, 0.08, 1).normalize()

export async function renderBodyPortrait(bodyUrl: string, size = 512): Promise<Blob> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setSize(size, size)
  renderer.setPixelRatio(1)
  renderer.setClearColor(BACKGROUND, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)
  scene.add(new THREE.AmbientLight(0x9a96b0, 1.3))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(2.5, 3.5, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xffc47a, 1.1)
  rim.position.set(-3, 2.5, -2.5)
  scene.add(rim)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 50)

  const loader = new GLTFLoader()
  loader.register(parser => new VRMLoaderPlugin(parser))
  let root: THREE.Object3D | null = null
  try {
    const gltf = await loader.loadAsync(bodyUrl)
    const vrm = gltf.userData.vrm as VRM | undefined
    root = vrm ? vrm.scene : gltf.scene
    if (vrm) VRMUtils.rotateVRM0(vrm)
    scene.add(root)
    vrm?.update(0)
    root.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(root, true)
    const height = Math.max(0.1, box.max.y - box.min.y)
    // The head: the VRM's head bone, or the top eighth of a plain model.
    const head = new THREE.Vector3()
    const bone = vrm?.humanoid?.getRawBoneNode('head') ?? vrm?.humanoid?.getNormalizedBoneNode('head')
    if (bone) bone.getWorldPosition(head)
    else box.getCenter(head).setY(box.max.y - height / 8)
    // From the shoulders (a little under the head bone) to the top of the head, with room around it.
    const top = box.max.y
    const bottom = head.y - (top - head.y) * 0.9
    const span = Math.max(0.12, top - bottom) * 1.35
    const target = new THREE.Vector3(head.x, (top + bottom) / 2, head.z)
    const distance = (span / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    camera.position.copy(target).addScaledVector(VIEW, distance)
    camera.lookAt(target)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)
    return await new Promise<Blob>((resolve, reject) => {
      renderer.domElement.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The portrait could not be saved'))), 'image/png')
    })
  } finally {
    if (root) { scene.remove(root); VRMUtils.deepDispose(root) }
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
