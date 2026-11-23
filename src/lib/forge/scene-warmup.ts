// ░▒▓ SCENE WARM-UP — nothing should be drawn for the first time while the owner turns around ▓▒░
// The first time the renderer draws a thing it compiles that thing's shader, uploads its textures
// and its geometry to the graphics card. three does all of it lazily, inside the frame that first
// shows the thing: in Oasis Dusk, turning around at spawn froze single frames for 250 to 1700 ms
// (measured headless, 23 Nov). The warmer does that work ahead, in slices of a few milliseconds
// between frames: shaders through compile() and a wait for the browser to finish them on its own
// threads (KHR_parallel_shader_compile),
// textures through initTexture, and geometry by drawing the not-yet-drawn objects once into a
// 1x1 target that nobody sees. Objects added later (an agent arrives, a world object loads) are
// picked up the same way.

import {
  PerspectiveCamera, WebGLRenderTarget,
  type BufferGeometry, type Camera, type Light, type Material, type Object3D, type Scene, type Texture, type WebGLRenderer,
} from 'three'

/** The layer the warm draw uses: only the slice being warmed (and the lights) are on it. */
export const WARM_LAYER = 31
/** Milliseconds of warming per slot between frames. */
export const WARM_BUDGET_MS = 4
/** Vertices per warm draw: one draw uploads at most about this much geometry. */
export const WARM_CHUNK_VERTICES = 60_000
/** Objects per warm draw: the graphics driver readies each object's first draw too (17 at once took 211 ms, 23 Nov). */
export const WARM_CHUNK_OBJECTS = 4
/** How often to look for new things once everything is warm. */
export const WARM_IDLE_MS = 1000

type Drawable = Object3D & { geometry: BufferGeometry; material: Material | Material[] }

export function isDrawable(object: Object3D): object is Drawable {
  const o = object as Partial<Drawable> & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean }
  return !!(o.isMesh || o.isPoints || o.isLine || o.isSprite) && !!o.geometry && !!o.material
}

export function materialsOf(object: Drawable): Material[] {
  return Array.isArray(object.material) ? object.material : [object.material]
}

/** Every texture a material holds: its own maps and, for shader materials, the uniforms' values. */
export function texturesOf(material: Material): Texture[] {
  const found = new Set<Texture>()
  const take = (value: unknown) => { if (value && (value as Texture).isTexture) found.add(value as Texture) }
  for (const key of Object.keys(material)) take((material as unknown as Record<string, unknown>)[key])
  const uniforms = (material as unknown as { uniforms?: Record<string, { value?: unknown }> }).uniforms
  if (uniforms) for (const key of Object.keys(uniforms)) take(uniforms[key]?.value)
  return [...found]
}

export function vertexCountOf(geometry: BufferGeometry): number {
  const index = geometry.index
  if (index) return index.count
  const position = geometry.attributes?.position
  return position ? position.count : 0
}

/** Splits items into consecutive chunks of at most `maxVertices` and `maxItems` each (a bigger item gets a chunk of its own). */
export function planChunks(vertexCounts: number[], maxVertices: number, maxItems = Infinity): number[][] {
  const chunks: number[][] = []
  let current: number[] = []
  let sum = 0
  vertexCounts.forEach((count, i) => {
    if (current.length && (sum + count > maxVertices || current.length >= maxItems)) { chunks.push(current); current = []; sum = 0 }
    current.push(i)
    sum += count
  })
  if (current.length) chunks.push(current)
  return chunks
}

export interface WarmStats {
  enabled: boolean
  /** Objects waiting to be drawn once. */
  waiting: number
  warmedObjects: number
  compiledMaterials: number
  uploadedTextures: number
  warmDraws: number
  /** Longest single slice so far, in ms, and the step it was. */
  longestSliceMs: number
  longestStep: string
}

export class SceneWarmer {
  private warmed = new WeakMap<Object3D, BufferGeometry>()
  private compiled = new WeakSet<Material>()
  /** Texture → the version uploaded (a texture whose image arrives later has a new version). */
  private uploaded = new WeakMap<Texture, number>()
  private compiling: Promise<unknown> | null = null
  private target: WebGLRenderTarget | null | undefined = undefined
  private tiny: WebGLRenderTarget | null = null
  private warmCamera = new PerspectiveCamera()
  private drawing = false
  private stats: WarmStats = { enabled: true, waiting: 0, warmedObjects: 0, compiledMaterials: 0, uploadedTextures: 0, warmDraws: 0, longestSliceMs: 0, longestStep: '' }

  constructor(private renderer: WebGLRenderer, private scene: Scene) {}

  setEnabled(on: boolean) { this.stats.enabled = on }
  getStats(): WarmStats { return { ...this.stats } }

  /** Records which target the real frames draw the world into (the composer's buffer or the screen): shaders differ between the two. */
  watchTarget(): () => void {
    const scene = this.scene
    // three calls a Scene's onBeforeRender(renderer, scene, camera, renderTarget); the type is Object3D's.
    type SceneHook = (...args: unknown[]) => void
    const host = scene as unknown as { onBeforeRender: SceneHook }
    const own = host.onBeforeRender
    host.onBeforeRender = (...args: unknown[]) => {
      if (!this.drawing) this.target = (args[3] as WebGLRenderTarget | null | undefined) ?? null
      own.apply(scene, args)
    }
    return () => { host.onBeforeRender = own }
  }

  dispose() {
    this.tiny?.dispose()
    this.tiny = null
  }

  /** One slice of warming. Returns true while there is more to do. */
  tick(camera: Camera, budgetMs = WARM_BUDGET_MS): boolean {
    if (!this.stats.enabled || this.target === undefined) return false
    if (this.compiling) return true
    const start = performance.now()
    const lights: Light[] = []
    const waiting: Drawable[] = []
    this.scene.traverseVisible(object => {
      if ((object as Light).isLight) { lights.push(object as Light); return }
      if (!isDrawable(object) || !object.frustumCulled || !object.layers.test(camera.layers)) return
      if (this.warmed.get(object) === object.geometry) return
      waiting.push(object)
    })
    this.stats.waiting = waiting.length
    if (!waiting.length) return false

    // 1. Shaders: compile what has not been compiled, then wait for the browser to finish them.
    const uncompiled = waiting.filter(o => materialsOf(o).some(m => !this.compiled.has(m)))
    if (uncompiled.length) {
      const batch: Drawable[] = []
      for (const object of uncompiled) {
        batch.push(object)
        for (const material of materialsOf(object)) if (!this.compiled.has(material)) { this.compiled.add(material); this.stats.compiledMaterials++ }
        if (performance.now() - start > budgetMs / 2 || batch.length >= 8) break
      }
      this.compiling = this.compile(batch, camera, lights).catch(() => undefined).finally(() => { this.compiling = null })
      this.note(start, `compile ${batch.length}`)
      return true
    }

    // 2. Textures.
    for (const object of waiting) {
      for (const material of materialsOf(object)) {
        for (const texture of texturesOf(material)) {
          if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) continue
          if (texture.version === 0 || !texture.image || this.uploaded.get(texture) === texture.version) continue
          this.uploaded.set(texture, texture.version)
          this.renderer.initTexture(texture)
          this.stats.uploadedTextures++
          if (performance.now() - start > budgetMs) { this.note(start, `texture ${texture.image?.width ?? '?'}px`); return true }
        }
      }
    }

    // 3. Geometry: draw one chunk once, unseen. With the world drawn straight to the screen there is no
    // unseen target with the same shaders, so the geometry then uploads on first sight as before.
    const chunk = planChunks(waiting.map(o => vertexCountOf(o.geometry)), WARM_CHUNK_VERTICES, WARM_CHUNK_OBJECTS)[0].map(i => waiting[i])
    if (this.target) this.drawUnseen(chunk, camera, lights)
    for (const object of chunk) { this.warmed.set(object, object.geometry); this.stats.warmedObjects++ }
    this.note(start, `draw ${chunk.length} objects, ${chunk.reduce((n, o) => n + vertexCountOf(o.geometry), 0)} vertices`)
    return waiting.length > chunk.length
  }

  private note(start: number, step: string) {
    const ms = Math.round(performance.now() - start)
    if (ms > this.stats.longestSliceMs) { this.stats.longestSliceMs = ms; this.stats.longestStep = step }
  }

  /** Compiles a few objects' shaders under the same lights, fog, environment and target as the real frame;
   *  resolves once the browser has finished them (not three's compileAsync: that throws inside a timer when a
   *  material is disposed before its shader is ready, and never resolves). */
  private compile(batch: Drawable[], camera: Camera, lights: Light[]): Promise<unknown> {
    const scene = this.scene
    // compile() walks `group` for its materials and (as it is not the target) for lights too: the lights come from `lit`.
    const group = { traverse: (visit: (o: Object3D) => void) => batch.forEach(visit), traverseVisible: () => {} } as unknown as Object3D
    const lit = {
      isScene: true,
      get fog() { return scene.fog },
      get environment() { return scene.environment },
      get environmentRotation() { return (scene as Scene & { environmentRotation?: unknown }).environmentRotation },
      traverseVisible: (visit: (o: Object3D) => void) => lights.forEach(visit),
    } as unknown as Scene
    const renderer = this.renderer
    const before = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target ?? null)
    try {
      const materials = renderer.compile(group, camera, lit)
      return waitReady(renderer, materials)
    } finally {
      renderer.setRenderTarget(before)
    }
  }

  private drawUnseen(chunk: Drawable[], camera: Camera, lights: Light[]) {
    const renderer = this.renderer
    const scene = this.scene
    if (!this.tiny) this.tiny = new WebGLRenderTarget(1, 1)
    const cam = this.warmCamera
    if ((camera as PerspectiveCamera).isPerspectiveCamera) cam.copy(camera as PerspectiveCamera, false)
    else cam.projectionMatrix.copy(camera.projectionMatrix)
    camera.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale)
    cam.layers.set(WARM_LAYER)
    cam.updateMatrixWorld(true)
    for (const light of lights) light.layers.enable(WARM_LAYER)
    const marked = chunk.map(o => ({ o, had: o.layers.isEnabled(WARM_LAYER) }))
    for (const { o } of marked) { o.layers.enable(WARM_LAYER); o.frustumCulled = false }
    const shadowMap = renderer.shadowMap
    const autoUpdate = shadowMap.autoUpdate
    const needsUpdate = shadowMap.needsUpdate
    const sceneAuto = scene.matrixWorldAutoUpdate
    const before = renderer.getRenderTarget()
    this.drawing = true
    try {
      shadowMap.autoUpdate = false
      shadowMap.needsUpdate = false
      scene.matrixWorldAutoUpdate = false
      renderer.setRenderTarget(this.tiny)
      renderer.render(scene, cam)
      this.stats.warmDraws++
    } finally {
      renderer.setRenderTarget(before)
      shadowMap.autoUpdate = autoUpdate
      shadowMap.needsUpdate = needsUpdate
      scene.matrixWorldAutoUpdate = sceneAuto
      this.drawing = false
      for (const { o, had } of marked) { if (!had) o.layers.disable(WARM_LAYER); o.frustumCulled = true }
    }
  }
}

/** Longest wait for the browser to finish a batch of shaders. */
const READY_TIMEOUT_MS = 10_000

function waitReady(renderer: WebGLRenderer, materials: Set<Material>): Promise<void> {
  const started = performance.now()
  return new Promise(resolve => {
    const check = () => {
      let pending = false
      for (const material of materials) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady?: () => boolean } }).currentProgram
        if (program?.isReady && !program.isReady()) { pending = true; break }
      }
      if (!pending || performance.now() - started > READY_TIMEOUT_MS) resolve()
      else window.setTimeout(check, 10)
    }
    check()
  })
}
