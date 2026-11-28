'use client'

import { useState, useCallback, Suspense, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import {
  extractModelStats,
  StudioBackdrop,
  useSharedBackdrop,
  DEFAULT_BACKDROP,
  type ModelStats,
} from './ModelPreview'
import { AGENT_AVATAR_CATALOG } from '@/lib/agent-avatar-catalog'
import { useUILayer } from '@/lib/input-manager'
import { isProbablyMobileDevice } from '@/lib/mobile-controls'
import {
  ANIMATION_LIBRARY,
  ANIM_CATEGORIES,
  isUALAnimation,
  loadAnimationClip,
  retargetClipForVRM,
  retargetUALClipForVRM,
  type AnimCategory,
} from '@/lib/forge/animation-library'
import { buildAuthoredClip, isAuthoredClip } from '@/lib/forge/authored-clips'
import { currentGaitClip, GAIT_CHOICES, setGaitPick, type GaitState } from '@/lib/forge/locomotion-set'
import {
  createLipSyncController,
  resumeLipSyncContext,
  type LipSyncController,
} from '@/lib/lip-sync'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ═══════════════════════════════════════════════════════════════════════════════
// AVATAR SOURCE OF TRUTH
// ─═̷─═̷─ॐ─═̷─═̷─ catalog (typed) + runtime disk scan (drop-ins) ─═̷─═̷─ॐ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

export interface AvatarEntry {
  id: string
  file: string
  name: string
  sizeBytes?: number
}

const CATALOG_AVATARS: AvatarEntry[] = AGENT_AVATAR_CATALOG.map(a => ({
  id: a.id.replace(/^av_/, ''),
  file: a.path.split('/').pop() || '',
  name: a.name,
}))

function formatVrmSize(sizeBytes: number | undefined): string {
  if (!Number.isFinite(sizeBytes)) return '-'
  const mb = Number(sizeBytes) / (1024 * 1024)
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`
}

// ░▒▓ Hyperstition payload — 3 pre-baked voices, random per press ▓▒░
const VOICE_LINE = 'Moksha, please help us find each other.'
const VOICE_TRACKS = [
  '/audio/moksha-1-clyde.mp3',
  '/audio/moksha-2-drew.mp3',
  '/audio/moksha-3-paul.mp3',
] as const

// ═══════════════════════════════════════════════════════════════════════════════
// VRM PREVIEW — loads, fits, animates, lipsyncs
// ═══════════════════════════════════════════════════════════════════════════════

// ░▒▓ VRMPreview: the avatar, idle until a clip is picked, framed whole from a little above and to the side. ▓▒░
// Clips go through the retarget that fits them (the free packs' rig, Mixamo's, or a clip made in code), as in the
// worlds; before 25 Nov every clip went through Mixamo's, and the free packs' clips left the body in its T-pose.
// The pivot is the body's middle; a right drag moves it up and down (the face, the feet), the wheel zooms to it.

/** A dance waiting for the owner's rating (/api/dance-review): 1 to 5, 0 = no, null = not rated yet. */
interface ReviewClip { id: string; filename: string; label: string; rating: number | null }

/** Where the camera looks from: in front, a little to the right and above (the thumbnails use the same). */
const VIEW_DIRECTION = new THREE.Vector3(0.42, 0.32, 1).normalize()

/** The clip `animId` made for this body (null when it cannot be). */
async function clipForBody(animId: string, vrm: VRM, cacheKey: string): Promise<THREE.AnimationClip | null> {
  if (isAuthoredClip(animId)) return buildAuthoredClip(animId, vrm)
  const clip = await loadAnimationClip(animId)
  if (!clip) return null
  const retargeted = isUALAnimation(animId)
    ? retargetUALClipForVRM(clip, vrm, `${cacheKey}::${animId}`)
    : retargetClipForVRM(clip, vrm, `${cacheKey}::${animId}`)
  return retargeted.tracks.length > 0 ? retargeted : null
}

/** Camera distance at which a box of this height and width fills about 85% of the view. */
function fitDistance(camera: THREE.PerspectiveCamera, height: number, width: number): number {
  const vertical = THREE.MathUtils.degToRad(camera.fov) / 2
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
  return Math.max((height / 2) / Math.tan(vertical), (width / 2) / Math.tan(horizontal)) / 0.85
}

function VRMPreview({
  url,
  onStats,
  animationId,
  lipSyncController,
}: {
  url: string
  onStats?: (stats: ModelStats) => void
  animationId: string | null
  lipSyncController: LipSyncController | null
}) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } | null }
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const heightRef = useRef(1.6)

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  const vrm = gltf.userData.vrm as VRM | undefined

  // Ref-stable onStats — prevents effect re-fire on parent re-render
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // One-shot framing + mixer init (runs on VRM/camera change, not every render)
  useEffect(() => {
    if (!vrm || !groupRef.current) return
    VRMUtils.rotateVRM0(vrm)
    vrmRef.current = vrm
    mixerRef.current = new THREE.AnimationMixer(vrm.scene)

    // RAF so geometry is in the scene graph before Box3 reads
    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return
      const box = new THREE.Box3().setFromObject(groupRef.current)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      // The body's middle at the origin, once: animations move bones, not the group, so the pivot stays put.
      groupRef.current.position.sub(center)
      heightRef.current = size.y
      // Arms out in the T-pose widen the box; idle they hang, so the height decides (a little width kept).
      const distance = fitDistance(camera, size.y, Math.min(size.x, size.y * 0.7))
      camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      if (controls) { controls.target.set(0, 0, 0); controls.update() }

      onStatsRef.current?.(extractModelStats(vrm.scene, gltf.animations || []))
    })

    return () => {
      cancelAnimationFrame(raf)
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      currentActionRef.current = null
      vrmRef.current = null
    }
  }, [vrm, camera, controls, gltf.animations])

  // A right drag moves the pivot up and down the body only: whatever the drag did sideways is given back.
  useEffect(() => {
    if (!controls) return
    const keepOnAxis = () => {
      const target = controls.target
      if (target.x === 0 && target.z === 0 && Math.abs(target.y) <= heightRef.current * 0.55) return
      const dx = target.x
      const dz = target.z
      const y = THREE.MathUtils.clamp(target.y, -heightRef.current * 0.55, heightRef.current * 0.55)
      const dy = target.y - y
      target.set(0, y, 0)
      camera.position.x -= dx
      camera.position.y -= dy
      camera.position.z -= dz
    }
    controls.addEventListener('change', keepOnAxis)
    return () => controls.removeEventListener('change', keepOnAxis)
  }, [controls, camera])

  // The clip picked, or the idle when none is.
  useEffect(() => {
    const v = vrmRef.current
    const mixer = mixerRef.current
    if (!v || !mixer) return
    let cancelled = false
    ;(async () => {
      try {
        const clip = await clipForBody(animationId || 'idle', v, url)
        if (!clip || cancelled || !vrmRef.current || !mixerRef.current) return
        const nextAction = mixerRef.current.clipAction(clip)
        nextAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play()
        const prev = currentActionRef.current
        if (prev && prev !== nextAction) prev.crossFadeTo(nextAction, 0.3, false)
        currentActionRef.current = nextAction
      } catch (err) {
        console.warn('[AvatarGallery] animation load failed:', err)
      }
    })()

    return () => { cancelled = true }
  }, [animationId, url, vrm])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
    vrmRef.current?.update(delta)

    const expr = vrmRef.current?.expressionManager
    if (lipSyncController && lipSyncController.isActive && expr) {
      const { aa, ih, ou, ee, oh } = lipSyncController.update()
      expr.setValue('aa', aa)
      expr.setValue('ih', ih)
      expr.setValue('ou', ou)
      expr.setValue('ee', ee)
      expr.setValue('oh', oh)
    }
  })

  if (!vrm) return null

  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// THUMBNAIL GEN — studio grey bg, ONE renderer rig reused across all thumbs
// (Chrome caps live WebGL contexts at 16 — creating+disposing per-thumb thrashes)
// ═══════════════════════════════════════════════════════════════════════════════

interface ThumbRig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  loader: GLTFLoader
  dispose: () => void
}

/** The tiles' background, and the thumbnails' (one colour for all, 25 Nov: "some have gray, some black"). */
const THUMB_BACKGROUND = '#1d1b27'
/** Bumped when the thumbnails' look changes: part of their address, so a browser does not show the old ones. */
const THUMB_STYLE = 2

function createThumbRig(): ThumbRig {
  const size = 320
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(size, size)
  renderer.setPixelRatio(1)
  renderer.setClearColor(THUMB_BACKGROUND, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(THUMB_BACKGROUND)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100)
  scene.add(new THREE.AmbientLight(0x9a96b0, 1.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
  keyLight.position.set(3, 5, 3)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xaabbff, 0.8)
  fillLight.position.set(-3, 2, -1)
  scene.add(fillLight)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))

  return {
    renderer,
    scene,
    camera,
    loader,
    dispose: () => {
      renderer.dispose()
      scene.clear()
    },
  }
}

/**
 * A thumbnail: the avatar in its idle pose (not the T-pose), whole, from a little above and to the side, looking at
 * its middle (the owner, 25 Nov: the old ones looked at the chin and cut the legs off).
 */
async function renderVrmThumbnailWithRig(rig: ThumbRig, vrmUrl: string): Promise<Blob> {
  const { renderer, scene, camera, loader } = rig

  const gltf = await loader.loadAsync(vrmUrl)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('No VRM data')
  VRMUtils.rotateVRM0(vrm)

  const group = new THREE.Group()
  group.add(vrm.scene)
  scene.add(group)
  let mixer: THREE.AnimationMixer | null = null
  try {
    // The idle pose, a moment into the loop.
    const idle = await clipForBody('idle', vrm, `thumb::${vrmUrl}`).catch(() => null)
    if (idle) {
      mixer = new THREE.AnimationMixer(vrm.scene)
      mixer.clipAction(idle).play()
      mixer.setTime(0.8)
    }
    vrm.update(0)
    group.updateMatrixWorld(true)
    // The posed body's own extent (skinned vertices), so nothing is cut off.
    const box = new THREE.Box3().setFromObject(vrm.scene, true)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    camera.aspect = 1
    camera.updateProjectionMatrix()
    const distance = fitDistance(camera, size.y, Math.max(size.x, size.z))
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance)
    camera.lookAt(center)

    renderer.render(scene, camera)
    const canvas = renderer.domElement
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('toBlob failed')), 'image/jpeg', 0.86)
    })
  } finally {
    // Remove the VRM from the scene so the next thumb renders alone, and free it.
    mixer?.stopAllAction()
    scene.remove(group)
    VRMUtils.deepDispose(vrm.scene)
  }
}

/** Render and save one thumbnail (the gallery's own route). */
async function saveThumbnail(rig: ThumbRig, avatar: { id: string; file: string }): Promise<boolean> {
  const blob = await renderVrmThumbnailWithRig(rig, `${OASIS_BASE}/avatars/gallery/${avatar.file}`)
  const form = new FormData()
  form.append('id', avatar.id)
  form.append('thumbnail', blob, `${avatar.id}.jpg`)
  const response = await fetch(`${OASIS_BASE}/api/avatar-thumbs`, { method: 'PUT', body: form })
  return response.ok
}

// Dev: window.__oasisRedoAvatarThumbs() renders every catalogue avatar's thumbnail again (after a change of look);
// `extra` adds avatars found only on disk ({ id, file }), or `only` limits it to those.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisRedoAvatarThumbs = async (extra: Array<{ id: string; file: string }> = [], only = false) => {
    const rig = createThumbRig()
    const done: string[] = []
    const failed: string[] = []
    try {
      for (const avatar of only ? extra : [...CATALOG_AVATARS, ...extra]) {
        try { if (await saveThumbnail(rig, avatar)) done.push(avatar.id); else failed.push(avatar.id) } catch { failed.push(avatar.id) }
      }
    } finally {
      rig.dispose()
    }
    return { done: done.length, failed }
  }
}

// YOUR WALK: compare the walks, runs and sprints on the avatar shown, and pick yours (25 Nov)
// ═══════════════════════════════════════════════════════════════════════════════

const GAIT_ROWS: Array<[GaitState, string]> = [['walk', 'Walk'], ['run', 'Run'], ['sprint', 'Sprint']]

function GaitPicker({ previewing, onPreview }: { previewing: string | null; onPreview: (id: string) => void }) {
  const [, setVersion] = useState(0)
  // Mixamo's files stay on this PC (not in the package): offered only where they are.
  const [mixamoHere, setMixamoHere] = useState(false)
  useEffect(() => {
    let live = true
    fetch(`${OASIS_BASE}/animations/${encodeURIComponent('Unarmed Walk Forward.fbx')}`, { method: 'HEAD' })
      .then(r => { if (live) setMixamoHere(r.ok) })
      .catch(() => { if (live) setMixamoHere(false) })
    return () => { live = false }
  }, [])
  return (
    <div data-gait-picker style={{ marginTop: 18, padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.12)' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>
        Your walk, run and sprint
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10, lineHeight: 1.4 }}>
        Click one: it plays here, and your own avatar walks that way from now on. Steps and footstep sounds follow your speed with any of them.
      </div>
      {GAIT_ROWS.map(([state, label]) => {
        const inUse = currentGaitClip(state)
        return (
          <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ width: 52, fontSize: 10, color: '#cbd5e1', fontWeight: 700 }}>{label}</span>
            {GAIT_CHOICES[state].filter(choice => !choice.mixamo || mixamoHere).map(choice => {
              const active = inUse === choice.id
              const playing = previewing === choice.id
              return (
                <button
                  key={choice.id}
                  type="button"
                  data-gait-choice={choice.id}
                  onClick={() => { setGaitPick(state, choice.id); setVersion(v => v + 1); onPreview(choice.id) }}
                  title={choice.mixamo ? 'Mixamo: fine on your PC, not in the package' : 'Quaternius, CC0: ships with the Oasis'}
                  style={{
                    fontSize: 10, padding: '4px 8px', borderRadius: 6, fontFamily: 'monospace', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: active ? 'rgba(34,197,94,0.16)' : playing ? 'rgba(14,165,233,0.16)' : 'rgba(255,255,255,0.02)',
                    color: active ? '#86efac' : '#cbd5e1',
                    border: `1px solid ${active ? 'rgba(34,197,94,0.45)' : playing ? 'rgba(14,165,233,0.4)' : 'rgba(148,163,184,0.15)'}`,
                  }}
                >
                  {active ? '✓ ' : ''}{choice.label}
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '0 3px', borderRadius: 3, border: `1px solid ${choice.mixamo ? 'rgba(252,211,77,0.55)' : 'rgba(110,231,183,0.5)'}`, color: choice.mixamo ? '#fcd34d' : '#6ee7b7' }}>
                    {choice.mixamo ? 'Mixamo' : 'CC0'}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AVATAR GALLERY — shared selector for user + all agents
// ═══════════════════════════════════════════════════════════════════════════════

interface AvatarGalleryProps {
  currentAvatarUrl: string | null
  onSelect: (avatarUrl: string | null) => void
  onClose: () => void
}

function useAvatarGalleryMobileLayout(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const query = window.matchMedia('(max-width: 700px)')
    const update = () => setIsMobile(query.matches || isProbablyMobileDevice())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => {
        query.removeEventListener('change', update)
        window.removeEventListener('resize', update)
        window.removeEventListener('orientationchange', update)
      }
    }

    query.addListener(update)
    return () => {
      query.removeListener(update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return isMobile
}

export function AvatarGallery({ currentAvatarUrl, onSelect, onClose }: AvatarGalleryProps) {
  useUILayer('avatar-gallery', true)
  const mobileLayout = useAvatarGalleryMobileLayout()
  const [diskAvatars, setDiskAvatars] = useState<AvatarEntry[]>([])
  const [diskScanCompleted, setDiskScanCompleted] = useState(false)
  const allAvatars = useMemo<AvatarEntry[]>(() => {
    const diskFiles = new Set(diskAvatars.map(d => d.file))
    const diskByFile = new Map(diskAvatars.map(d => [d.file, d]))
    // After scan resolves, hide catalog entries whose VRMs aren't on disk
    // (renamed/deleted). Before scan resolves, show full catalog to avoid flash.
    const usableCatalog = diskScanCompleted
      ? CATALOG_AVATARS.filter(c => diskFiles.has(c.file))
      : CATALOG_AVATARS
    const enrichedCatalog = usableCatalog.map(c => ({
      ...c,
      sizeBytes: diskByFile.get(c.file)?.sizeBytes ?? c.sizeBytes,
    }))
    const catalogFiles = new Set(usableCatalog.map(a => a.file))
    const extras = diskAvatars.filter(d => !catalogFiles.has(d.file))
    return [...enrichedCatalog, ...extras]
  }, [diskAvatars, diskScanCompleted])

  const [previewAvatar, setPreviewAvatar] = useState<AvatarEntry | null>(null)
  const [previewStats, setPreviewStats] = useState<ModelStats | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [backdropImage, setBackdropImage] = useSharedBackdrop()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [thumbIds, setThumbIds] = useState<Set<string>>(new Set())
  const [thumbsLoaded, setThumbsLoaded] = useState(false)
  const [autoGen, setAutoGen] = useState<{ done: number; total: number; active: boolean }>({ done: 0, total: 0, active: false })

  const [animationId, setAnimationId] = useState<string | null>(null)
  const [animCategory, setAnimCategory] = useState<AnimCategory>('dance')
  // Dances waiting for the owner's verdict (/api/dance-review): a Review tab, a rating for each.
  const [reviewClips, setReviewClips] = useState<ReviewClip[]>([])
  useEffect(() => {
    let live = true
    fetch('/api/dance-review').then(r => (r.ok ? r.json() : { clips: [] })).then((data: { clips?: ReviewClip[] }) => {
      if (!live || !Array.isArray(data.clips)) return
      for (const clip of data.clips) {
        if (!ANIMATION_LIBRARY.some(a => a.id === clip.id)) ANIMATION_LIBRARY.push({ id: clip.id, filename: clip.filename, label: clip.label, category: 'review' })
      }
      setReviewClips(data.clips)
    }).catch(() => {})
    return () => { live = false }
  }, [])
  const rateClip = useCallback((id: string, rating: number) => {
    setReviewClips(clips => {
      const next = clips.map(clip => (clip.id === id ? { ...clip, rating } : clip))
      // On to the next one not rated yet (after this one, then from the top).
      const at = next.findIndex(clip => clip.id === id)
      const following = [...next.slice(at + 1), ...next.slice(0, at)].find(clip => clip.rating === null)
      if (following) setAnimationId(following.id)
      return next
    })
    void fetch('/api/dance-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, rating }) }).catch(() => {})
  }, [])

  const [voicePlaying, setVoicePlaying] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  // Track the last-played track index so we never play the same voice twice in a row.
  // Without this, HTMLAudio + random picker means ~33% of presses hit the same voice,
  // which LOOKS like a "voice missing" bug even when all 3 MP3s are distinct on disk.
  const lastTrackIndexRef = useRef<number>(-1)
  // ░▒▓ One lipsync controller for the gallery's lifetime. Hoisted so         ▓▒░
  // ░▒▓ switching avatars (preview re-mount) doesn't force re-attach on       ▓▒░
  // ░▒▓ the same audio element — lip-sync.ts's WeakSet guard bails out        ▓▒░
  // ░▒▓ when a FRESH controller tries to re-attach an already-connected el.   ▓▒░
  const [lipSyncController, setLipSyncController] = useState<LipSyncController | null>(null)

  const currentFile = currentAvatarUrl?.split('/').pop()
  const selectedAvatar = allAvatars.find(avatar => avatar.file === currentFile) || null

  // ░▒▓ Lipsync controller — create once, detach on unmount ▓▒░
  useEffect(() => {
    const ctrl = createLipSyncController()
    setLipSyncController(ctrl)
    return () => ctrl.detach()
  }, [])

  // ░▒▓ Initial thumb list + runtime disk scan ▓▒░
  useEffect(() => {
    fetch(`${OASIS_BASE}/api/avatar-thumbs`)
      .then(r => r.json())
      .then((ids: string[]) => setThumbIds(new Set(ids)))
      .catch(() => {})
      .finally(() => setThumbsLoaded(true))

    fetch(`${OASIS_BASE}/api/avatars/list`)
      .then(r => r.json())
      .then((entries: AvatarEntry[]) => {
        if (Array.isArray(entries)) setDiskAvatars(entries)
      })
      .catch(() => {})
      .finally(() => setDiskScanCompleted(true))
  }, [])

  // ░▒▓ Auto-generate missing thumbs on mount ▓▒░
  // Uses ONE shared renderer rig across all thumbs (creating a WebGLRenderer
  // per-thumb churns the GPU and can exceed Chrome's 16-live-context cap).
  useEffect(() => {
    if (!thumbsLoaded || autoGen.active) return
    const missing = allAvatars.filter(a => !thumbIds.has(a.id))
    if (missing.length === 0) return

    let cancelled = false
    setAutoGen({ done: 0, total: missing.length, active: true })

    ;(async () => {
      const rig = createThumbRig()
      const justGenerated: string[] = []
      try {
        for (let i = 0; i < missing.length; i++) {
          if (cancelled) break
          const avatar = missing[i]
          try {
            const blob = await renderVrmThumbnailWithRig(rig, `${OASIS_BASE}/avatars/gallery/${avatar.file}`)
            const form = new FormData()
            form.append('id', avatar.id)
            form.append('thumbnail', blob, `${avatar.id}.jpg`)
            const response = await fetch(`${OASIS_BASE}/api/avatar-thumbs`, { method: 'PUT', body: form })
            if (response.ok) justGenerated.push(avatar.id)
          } catch (err) {
            console.warn(`[AvatarGallery] Thumb gen failed for ${avatar.name}:`, err)
          }
          if (!cancelled) setAutoGen(prev => ({ ...prev, done: i + 1 }))
        }
      } finally {
        rig.dispose()
        // Always flip active off so the UI doesn't get wedged on a late cancel
        setAutoGen(prev => ({ ...prev, active: false }))
      }
      if (!cancelled && justGenerated.length > 0) {
        setThumbIds(prev => {
          const next = new Set(prev)
          for (const id of justGenerated) next.add(id)
          return next
        })
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbsLoaded, allAvatars.length])

  useEffect(() => {
    if (!previewAvatar) {
      setPreviewAvatar(selectedAvatar || allAvatars[0] || null)
    }
  }, [previewAvatar, selectedAvatar, allAvatars])

  useEffect(() => {
    setPreviewStats(null)
    // Stop voice when switching avatars — audio element + controller persist
    audioElRef.current?.pause()
    setVoicePlaying(false)
  }, [previewAvatar?.id])

  // Audio lifecycle cleanup
  useEffect(() => {
    return () => {
      audioElRef.current?.pause()
      audioElRef.current = null
    }
  }, [])

  const handleSelect = useCallback(async (avatar: AvatarEntry | null) => {
    setSaving(true)
    onSelect(avatar ? `/avatars/gallery/${avatar.file}` : null)
    setSaving(false)
  }, [onSelect])

  const handlePlayVoice = useCallback(async () => {
    if (voicePlaying) {
      audioElRef.current?.pause()
      setVoicePlaying(false)
      return
    }

    setVoiceError(null)
    try {
      // No-repeat random: pick any index except the last played one.
      // Guarantees every press swaps voice, so all 3 rotate quickly.
      const candidates = VOICE_TRACKS
        .map((_, i) => i)
        .filter(i => i !== lastTrackIndexRef.current)
      const pickedIndex = candidates[Math.floor(Math.random() * candidates.length)]
      lastTrackIndexRef.current = pickedIndex
      const track = VOICE_TRACKS[pickedIndex]

      await resumeLipSyncContext()

      if (!audioElRef.current) {
        audioElRef.current = new Audio()
        audioElRef.current.crossOrigin = 'anonymous'
      }
      audioElRef.current.src = `${OASIS_BASE}${track}`
      // .load() forces the audio element to actually fetch the new src.
      // Without this, setting .src alone doesn't guarantee a reload and the
      // element may keep playing the previously-loaded clip.
      audioElRef.current.load()
      audioElRef.current.onended = () => {
        setVoicePlaying(false)
      }
      audioElRef.current.onerror = () => {
        setVoiceError('audio playback failed')
        setVoicePlaying(false)
      }
      // Attach ONCE per controller lifetime. Re-attaching stacks analyser→
      // destination paths, amplifying audio Nx. The source+analyser keep
      // working across audio element src changes.
      if (lipSyncController && !lipSyncController.isActive) {
        lipSyncController.attachAudio(audioElRef.current)
      }
      setVoicePlaying(true)
      await audioElRef.current.play()
    } catch (err) {
      console.warn('[AvatarGallery] voice play failed:', err)
      setVoiceError(err instanceof Error ? err.message : 'voice play failed')
      setVoicePlaying(false)
    }
  }, [voicePlaying, lipSyncController])

  if (typeof document === 'undefined') return null

  const filteredAnims = ANIMATION_LIBRARY.filter(a => a.category === animCategory)
  const reviewing = reviewClips.find(clip => clip.id === animationId) ?? null
  const ratedCount = reviewClips.filter(clip => clip.rating !== null).length
  const previewSizeBytes = allAvatars.find(avatar => avatar.file === previewAvatar?.file)?.sizeBytes ?? previewAvatar?.sizeBytes

  return createPortal(
    <div
      data-ui-panel
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'calc(var(--z-place) + 20)',
        display: 'flex',
        alignItems: mobileLayout ? 'stretch' : 'center',
        justifyContent: mobileLayout ? 'stretch' : 'center',
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(10px)',
        padding: mobileLayout ? 6 : 0,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        data-ui-panel
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: mobileLayout ? 'calc(100vw - 12px)' : 1040,
          maxWidth: mobileLayout ? 'calc(100vw - 12px)' : '95vw',
          height: mobileLayout ? 'calc(100vh - 12px)' : undefined,
          maxHeight: mobileLayout ? 'calc(100vh - 12px)' : '92vh',
          background: 'rgba(7, 10, 18, 0.97)',
          border: '1px solid rgba(94, 234, 212, 0.22)',
          borderRadius: mobileLayout ? 10 : 18,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 30px 120px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            padding: mobileLayout ? '8px 10px' : '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: mobileLayout ? 11 : 16, color: '#67e8f9', fontWeight: 700, letterSpacing: '0.08em' }}>
              OASIS AVATAR SELECTOR
            </h2>
            <p style={{ display: mobileLayout ? 'none' : undefined, margin: '4px 0 0', fontSize: 11, color: '#7dd3fc80', fontFamily: 'monospace' }}>
              Shared selector for user + all agent bodies · {allAvatars.length} avatars
              {autoGen.active && (
                <span style={{ marginLeft: 10, color: '#14b8a6' }}>
                  {'\u{1F4F7}'} rendering {autoGen.done}/{autoGen.total}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              fontSize: mobileLayout ? 18 : 20,
              cursor: 'pointer',
              padding: mobileLayout ? '2px 6px' : '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div
            style={{
              width: mobileLayout ? 96 : 360,
              padding: mobileLayout ? 6 : 16,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: mobileLayout ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
              gap: mobileLayout ? 6 : 10,
              alignContent: 'start',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <button
              onClick={() => { void handleSelect(null) }}
              style={{
                background: !currentAvatarUrl ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${!currentAvatarUrl ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: mobileLayout ? 8 : 12,
                padding: mobileLayout ? 4 : 10,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: mobileLayout ? 4 : 10,
                transition: 'all 0.15s',
                minHeight: mobileLayout ? 88 : 142,
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: mobileLayout ? 7 : 10,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: mobileLayout ? 18 : 28,
                }}
              >
                🚫
              </div>
              <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                <span style={{ fontSize: mobileLayout ? 8 : 10, color: !currentAvatarUrl ? '#EF4444' : '#cbd5e1', lineHeight: 1.2, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  No Avatar
                </span>
                <span style={{ display: mobileLayout ? 'none' : undefined, fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
                  remove shared body
                </span>
              </div>
            </button>

            {allAvatars.map(avatar => {
              const isSelected = currentFile === avatar.file
              const isPreviewing = previewAvatar?.id === avatar.id
              const hasThumb = thumbIds.has(avatar.id)
              return (
                <button
                  key={avatar.id}
                  onClick={() => setPreviewAvatar(avatar)}
                  onDoubleClick={() => { void handleSelect(avatar) }}
                  style={{
                    background: isPreviewing
                      ? 'rgba(168,85,247,0.2)'
                      : isSelected
                        ? 'rgba(34,197,94,0.15)'
                        : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isPreviewing ? 'rgba(168,85,247,0.5)' : isSelected ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: mobileLayout ? 8 : 12,
                    padding: mobileLayout ? 4 : 10,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: mobileLayout ? 4 : 10,
                    transition: 'all 0.15s',
                    minHeight: mobileLayout ? 88 : 142,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: mobileLayout ? 7 : 10,
                      background: THUMB_BACKGROUND,
                      border: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${OASIS_BASE}/avatars/gallery/thumbs/${avatar.id}.jpg?v=${THUMB_STYLE}`}
                        alt={avatar.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: mobileLayout ? 18 : 24, opacity: 0.5 }}>{'\u{1F9D1}'}</span>
                    )}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: mobileLayout ? 4 : 6,
                          left: mobileLayout ? 4 : 6,
                          padding: mobileLayout ? '1px 4px' : '2px 5px',
                          borderRadius: 999,
                          background: 'rgba(15,23,42,0.82)',
                          border: '1px solid rgba(34,197,94,0.32)',
                          color: '#22C55E',
                          fontSize: mobileLayout ? 6 : 8,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                        }}
                      >
                        {mobileLayout ? 'ON' : 'ACTIVE'}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                    {/* The whole name, on two lines when it needs them (25 Nov: long names did not fit). */}
                    <span title={avatar.name} style={{ fontSize: mobileLayout ? 8 : 10, color: isPreviewing ? '#A855F7' : '#e2e8f0', lineHeight: 1.2, fontWeight: isPreviewing ? 700 : 600, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {avatar.name}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            {previewAvatar ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: mobileLayout ? '0 0 38vh' : '0 0 min(58vh, 540px)', position: 'relative', background: '#24262b' }}>
                  <Canvas
                    camera={{ fov: 45, near: 0.01, far: 1000 }}
                    style={{ width: '100%', height: '100%' }}
                    onCreated={({ gl }) => {
                      gl.domElement.style.touchAction = 'none'
                    }}
                  >
                    <StudioBackdrop imageUrl={backdropImage} />
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[3, 5, 2]} intensity={1.0} />
                    <directionalLight position={[-3, 2, -1]} intensity={0.3} color="#b4c6e0" />
                    <OrbitControls
                      makeDefault
                      enableRotate
                      enablePan
                      screenSpacePanning
                      autoRotate={autoRotate}
                      autoRotateSpeed={1.5}
                      rotateSpeed={0.85}
                      minDistance={0.1}
                      maxDistance={100}
                      mouseButtons={{
                        LEFT: THREE.MOUSE.ROTATE,
                        MIDDLE: THREE.MOUSE.DOLLY,
                        // Right drag: the pivot up and down the body (VRMPreview keeps it on the body's axis).
                        RIGHT: THREE.MOUSE.PAN,
                      }}
                      touches={{
                        ONE: THREE.TOUCH.ROTATE,
                        TWO: THREE.TOUCH.DOLLY_PAN,
                      }}
                      onStart={() => setAutoRotate(false)}
                    />
                    <Suspense fallback={null}>
                      <VRMPreview
                        key={previewAvatar.id}
                        url={`${OASIS_BASE}/avatars/gallery/${previewAvatar.file}`}
                        onStats={setPreviewStats}
                        animationId={animationId}
                        lipSyncController={lipSyncController}
                      />
                    </Suspense>
                  </Canvas>
                  {/* ░▒▓ Viewport controls — 1:1 with ModelPreviewPanel ▓▒░ */}
                  <div style={{ position: 'absolute', bottom: mobileLayout ? 6 : 8, right: mobileLayout ? 6 : 8, zIndex: 20, display: 'flex', gap: 4 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) setBackdropImage(URL.createObjectURL(file))
                        e.target.value = ''
                      }}
                    />
                    {backdropImage && backdropImage !== DEFAULT_BACKDROP && (
                      <button
                        onClick={() => setBackdropImage(DEFAULT_BACKDROP)}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: 'rgba(103,232,249,0.18)',
                          border: '1px solid rgba(103,232,249,0.4)',
                          color: '#67e8f9', fontSize: 12, cursor: 'pointer',
                        }}
                        title="Reset backdrop"
                      >✕</button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: 'rgba(40,40,40,0.82)',
                        border: '1px solid rgba(80,80,80,0.5)',
                        color: '#999', fontSize: 12, cursor: 'pointer',
                      }}
                      title="Upload custom backdrop"
                    >{'\u{1F5BC}'}</button>
                    <button
                      onClick={() => setAutoRotate(prev => !prev)}
                      style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: autoRotate ? 'rgba(103,232,249,0.18)' : 'rgba(40,40,40,0.82)',
                        border: `1px solid ${autoRotate ? 'rgba(103,232,249,0.4)' : 'rgba(80,80,80,0.5)'}`,
                        color: autoRotate ? '#67e8f9' : '#999', fontSize: 14, cursor: 'pointer',
                      }}
                      title={autoRotate ? 'Auto-rotate ON' : 'Auto-rotate OFF'}
                    >{autoRotate ? '\u21BB' : '\u23F8'}</button>
                  </div>
                </div>

                <div style={{ padding: mobileLayout ? 8 : 18, borderTop: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: mobileLayout ? 8 : 18 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: mobileLayout ? 13 : 18, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewAvatar.name}</p>
                      <p style={{ display: mobileLayout ? 'none' : undefined, margin: '4px 0 12px', fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                        /avatars/gallery/{previewAvatar.file}
                      </p>

                      {/* The avatar's numbers, a two-column table nothing is cut off in (25 Nov). */}
                      <table data-avatar-facts style={{ width: '100%', borderCollapse: 'collapse', margin: mobileLayout ? '6px 0 8px' : '0 0 14px', fontSize: mobileLayout ? 10 : 12 }}>
                        <tbody>
                          {([
                            ['Triangles', previewStats?.triangles?.toLocaleString()],
                            ['Vertices', previewStats?.vertices?.toLocaleString()],
                            ['Size', previewStats ? `${previewStats.dimensions.w} × ${previewStats.dimensions.h} × ${previewStats.dimensions.d}` : undefined],
                            ['VRM file', formatVrmSize(previewSizeBytes)],
                            ['Bones', previewStats?.boneCount?.toLocaleString()],
                          ] as Array<[string, string | undefined]>).map(([label, value]) => (
                            <tr key={label} style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                              <td style={{ padding: mobileLayout ? '3px 8px 3px 0' : '5px 12px 5px 0', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: mobileLayout ? 8 : 10, whiteSpace: 'nowrap', width: '1%' }}>{label}</td>
                              <td style={{ padding: mobileLayout ? '3px 0' : '5px 0', color: '#f8fafc', fontWeight: 600, wordBreak: 'break-word' }}>{value || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <button
                        onClick={() => { void handleSelect(previewAvatar) }}
                        disabled={saving || currentFile === previewAvatar.file}
                        style={{
                          width: '100%',
                          padding: mobileLayout ? '8px 0' : '10px 0',
                          borderRadius: 6,
                          border: 'none',
                          background: currentFile === previewAvatar.file
                            ? 'rgba(34,197,94,0.2)'
                            : 'linear-gradient(135deg, #0f766e, #164e63)',
                          color: currentFile === previewAvatar.file ? '#22C55E' : '#fff',
                          fontSize: mobileLayout ? 11 : 13,
                          fontWeight: 600,
                          cursor: currentFile === previewAvatar.file ? 'default' : 'pointer',
                        }}
                      >
                        {currentFile === previewAvatar.file ? '✓ Current Avatar' : saving ? 'Saving...' : 'Select Avatar'}
                      </button>
                    </div>

                  </div>

                  {/* ═══ Animation selector (ported from Joystick) ═══ */}
                  {!mobileLayout && (
                    <>
                  <GaitPicker previewing={animationId} onPreview={setAnimationId} />
                  <div style={{ marginTop: 18, padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.12)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                        {'\u{1F3AC}'} Animation
                      </span>
                      {animationId && (
                        <button
                          onClick={() => setAnimationId(null)}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171',
                            fontSize: 9,
                            fontFamily: 'monospace',
                            padding: '2px 8px',
                            borderRadius: 999,
                            cursor: 'pointer',
                          }}
                        >
                          ■ stop
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {[...ANIM_CATEGORIES, ...(reviewClips.length ? [{ id: 'review' as AnimCategory, label: `Review ${ratedCount}/${reviewClips.length}`, icon: '⭐' }] : [])].map(cat => (
                        <button
                          key={cat.id}
                          onClick={() => setAnimCategory(cat.id)}
                          style={{
                            fontSize: 9,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                            background: animCategory === cat.id ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.03)',
                            color: animCategory === cat.id ? '#67e8f9' : '#94a3b8',
                            border: `1px solid ${animCategory === cat.id ? 'rgba(14,165,233,0.4)' : 'rgba(148,163,184,0.15)'}`,
                          }}
                        >
                          {cat.icon} {cat.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                      {filteredAnims.map(anim => {
                        const isActive = animationId === anim.id
                        return (
                          <button
                            key={anim.id}
                            onClick={() => setAnimationId(anim.id)}
                            style={{
                              fontSize: 10,
                              padding: '5px 8px',
                              borderRadius: 6,
                              fontFamily: 'monospace',
                              cursor: 'pointer',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              background: isActive ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.02)',
                              color: isActive ? '#67e8f9' : '#cbd5e1',
                              border: `1px solid ${isActive ? 'rgba(14,165,233,0.4)' : 'rgba(148,163,184,0.12)'}`,
                            }}
                            title={anim.label}
                          >
                            {isActive ? '▶ ' : ''}{anim.label}
                            {anim.category === 'review' && (() => {
                              const rating = reviewClips.find(clip => clip.id === anim.id)?.rating
                              return rating === null || rating === undefined ? null : <span style={{ color: rating ? '#fbbf24' : '#f87171' }}>{rating ? ` ${'★'}${rating}` : ' ✕'}</span>
                            })()}
                          </button>
                        )
                      })}
                    </div>
                    {animCategory === 'review' && (
                      <div style={{ marginTop: 10, fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                        {reviewing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ color: '#e2e8f0', marginRight: 4 }}>Rate {reviewing.label}:</span>
                            {[0, 1, 2, 3, 4, 5].map(value => (
                              <button
                                key={value}
                                onClick={() => rateClip(reviewing.id, value)}
                                title={value === 0 ? 'No: leave it out' : `${value} of 5`}
                                style={{
                                  fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace',
                                  background: reviewing.rating === value ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.03)',
                                  color: value === 0 ? '#f87171' : '#fbbf24',
                                  border: `1px solid ${reviewing.rating === value ? 'rgba(251,191,36,0.6)' : 'rgba(148,163,184,0.15)'}`,
                                }}
                              >
                                {value === 0 ? 'No' : '★'.repeat(value)}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span>Dances from the CMU motion-capture pack (free to ship, never sold). Pick one, rate it 1 to 5 or No; the next one starts. {ratedCount}/{reviewClips.length} rated.</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ═══ Voice + lipsync play button ═══ */}
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.12)' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
                      {'\u{1F399}\uFE0F'} Voice Line · TTS + Lipsync
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        onClick={() => { void handlePlayVoice() }}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: voicePlaying
                            ? 'rgba(239,68,68,0.18)'
                            : 'linear-gradient(135deg, #0891b2, #7c3aed)',
                          color: voicePlaying ? '#fca5a5' : '#fff',
                          border: voicePlaying ? '1px solid rgba(239,68,68,0.4)' : 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {voicePlaying ? '■ stop' : '▶ play voice'}
                      </button>
                      <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic', lineHeight: 1.3 }}>
                        &ldquo;{VOICE_LINE}&rdquo;
                      </div>
                    </div>
                    {voiceError && (
                      <div style={{ marginTop: 8, fontSize: 10, color: '#f87171', fontFamily: 'monospace' }}>
                        {voiceError}
                      </div>
                    )}
                  </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: mobileLayout ? 10 : 20,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: mobileLayout ? 11 : 12, color: '#64748b', lineHeight: 1.6 }}>
                  Click an avatar to preview.
                  <br />
                  Double-click to select instantly.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
