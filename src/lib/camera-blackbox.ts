// ░▒▓ CAMERA BLACK BOX — what the camera did, frame by frame, when it spun ▓▒░
// The owner (20-21 Nov): coming back to the Oasis, the camera spins very fast, slows to a spiral over ~10 s and
// lands in third person; "the Oasis was resting", nobody touched the mouse. Headless runs (F8 rest, 11 min idle
// rest, wake by key or mouse, locked or not) woke calmly, and nobody may drive his browser. So the page keeps the
// last FRAMES frames (yaw, pitch, position, input state, mouse lock, drag look, menu, rest, focus) and, when it sees
// a spin, saves them once to data/camera-blackbox/<time>.json on this PC (POST /api/debug/camera-blackbox, local
// only). The next time it happens, the file says what moved the camera and who owned it.

export interface BlackboxFrame {
  t: number
  dt: number
  yaw: number
  pitch: number
  x: number
  y: number
  z: number
  input: string
  prevCam: string | null
  locked: boolean
  dragLook: boolean
  menu: string
  resting: boolean
  focus: boolean
  visible: boolean
}

export const FRAMES = 900
/** A spin: more than SPIN_TURN_RAD of yaw within SPIN_WINDOW frames, or more than SPIN_STEP_RAD in one frame. */
export const SPIN_TURN_RAD = 4 * Math.PI
export const SPIN_WINDOW = 90
export const SPIN_STEP_RAD = 1
/** After a spin is saved, the next one is saved at the earliest this long after. */
export const SAVE_GAP_MS = 60_000

/** Shortest signed difference between two angles. */
export function angleStep(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Does the end of this history look like a spin? Pure, tested. */
export function detectSpin(frames: Pick<BlackboxFrame, 'yaw'>[]): { spin: boolean; turned: number; maxStep: number } {
  const from = Math.max(1, frames.length - SPIN_WINDOW)
  let turned = 0
  let maxStep = 0
  for (let i = from; i < frames.length; i += 1) {
    const step = Math.abs(angleStep(frames[i - 1].yaw, frames[i].yaw))
    if (!Number.isFinite(step)) return { spin: true, turned: Infinity, maxStep: Infinity }
    turned += step
    if (step > maxStep) maxStep = step
  }
  return { spin: turned > SPIN_TURN_RAD || maxStep > SPIN_STEP_RAD, turned, maxStep }
}

interface Box {
  frames: BlackboxFrame[]
  lastSave: number
  saving: boolean
}

const g = globalThis as unknown as { __oasisCameraBlackbox?: Box }
const box: Box = g.__oasisCameraBlackbox ??= { frames: [], lastSave: -Infinity, saving: false }

export function blackboxFrames(): BlackboxFrame[] {
  return box.frames.slice()
}

/** One frame. Returns true when this frame set off a save. */
export function recordFrame(frame: BlackboxFrame, save: (frames: BlackboxFrame[], why: string) => Promise<unknown> = postBlackbox): boolean {
  box.frames.push(frame)
  if (box.frames.length > FRAMES) box.frames.splice(0, box.frames.length - FRAMES)
  if (box.saving || frame.t - box.lastSave < SAVE_GAP_MS) return false
  const spin = detectSpin(box.frames)
  if (!spin.spin) return false
  box.lastSave = frame.t
  box.saving = true
  const why = `spin: ${spin.turned.toFixed(1)} rad in ${Math.min(SPIN_WINDOW, box.frames.length)} frames, max ${spin.maxStep.toFixed(2)} rad in one`
  // Let the spin play out a little, so the file shows how it ends too.
  setTimeout(() => {
    void save(box.frames.slice(), why).finally(() => { box.saving = false })
  }, 3000)
  return true
}

async function postBlackbox(frames: BlackboxFrame[], why: string): Promise<unknown> {
  try {
    const res = await fetch('/api/debug/camera-blackbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ why, userAgent: navigator.userAgent, size: [window.innerWidth, window.innerHeight, window.devicePixelRatio], frames }),
    })
    console.warn(`[camera] ${why}: the last ${frames.length} frames ${res.ok ? 'were saved to data/camera-blackbox' : `could not be saved (HTTP ${res.status})`}`)
  } catch (error) {
    console.warn(`[camera] ${why}: saving the frames failed`, error)
  }
  return null
}
