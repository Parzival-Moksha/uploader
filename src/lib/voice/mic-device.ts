// ░▒▓ MICROPHONE — which input voice typing and voice messages listen to ▓▒░
// The owner, 27 Nov: "I want the Steinberg to be the recording device, but can we even choose it? It's actually the
// browser tab that chooses it." Settings > Sound > Microphone picks one of the inputs the browser offers; it is kept
// per browser and asked for by its id (live-dictation.ts for voice typing, VoiceMessage.tsx for voice messages).
// "System default" (nothing chosen) is the browser's own pick, as before. A chosen input that is gone (his Steinberg
// has dropped off USB before) is looked for under its name (the browser can give it a new id), else the system
// default is used and a notice says so: never a silent switch. The browser's own speech recognition (the fallback
// when the engine has no ears) always hears the system default: a page cannot choose its microphone.

export interface MicChoice {
  deviceId: string
  /** Its name when chosen ("Steinberg UR22C"), to say which one is missing and to find it again under a new id. */
  label: string
}

const STORAGE_KEY = 'oasis.voice.microphone.v1'
const listeners = new Set<() => void>()
let cached: { raw: string | null; value: MicChoice | null } | null = null

function parse(raw: string | null): MicChoice | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<MicChoice>
    return typeof data.deviceId === 'string' && data.deviceId ? { deviceId: data.deviceId, label: typeof data.label === 'string' ? data.label : '' } : null
  } catch {
    return null
  }
}

/** The chosen input; null: the system default. (The same object while unchanged, for useSyncExternalStore.) */
export function getMicChoice(): MicChoice | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try { raw = window.localStorage.getItem(STORAGE_KEY) } catch { /* private mode */ }
  if (cached && cached.raw === raw) return cached.value
  cached = { raw, value: parse(raw) }
  return cached.value
}

export function setMicChoice(choice: MicChoice | null): void {
  try {
    if (choice) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode: this tab only */ }
  listeners.forEach(listener => listener())
}

export function subscribeMicChoice(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The caller's audio constraints, asking for this input exactly. */
export function withMic(audio: MediaTrackConstraints, deviceId: string | null): MediaTrackConstraints {
  return deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio
}

/** A chosen input that cannot be opened because it is not there (or busy elsewhere): fall back. Not a refused permission. */
function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError'
}

function noticeOnPage(text: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('oasis:notice', { detail: { message: text, tone: 'warn' } }))
}

export interface OpenMicOptions {
  devices?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>
  choice?: MicChoice | null
  notice?: (text: string) => void
}

/**
 * Open the chosen microphone with these constraints. Gone: the same name under a new id (and that id is kept), else
 * the system default with a notice. Refused permission and the like are thrown as before.
 */
export async function openMicrophone(audio: MediaTrackConstraints, options: OpenMicOptions = {}): Promise<MediaStream> {
  const devices = options.devices ?? navigator.mediaDevices
  const choice = options.choice !== undefined ? options.choice : getMicChoice()
  if (!choice) return devices.getUserMedia({ audio })
  try {
    return await devices.getUserMedia({ audio: withMic(audio, choice.deviceId) })
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  if (choice.label) {
    const list = await devices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    const same = list.find(device => device.kind === 'audioinput' && device.label === choice.label && device.deviceId !== choice.deviceId)
    if (same) {
      try {
        const stream = await devices.getUserMedia({ audio: withMic(audio, same.deviceId) })
        if (options.choice === undefined) setMicChoice({ deviceId: same.deviceId, label: choice.label })
        return stream
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }
  const stream = await devices.getUserMedia({ audio })
  ;(options.notice ?? noticeOnPage)(`${choice.label || 'The chosen microphone'} is not connected: listening with the system default (Settings > Sound > Microphone).`)
  return stream
}
