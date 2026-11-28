// ░▒▓ VOICE MESSAGE KEEP — a recording survives a reload, a crash or a closed tab ▓▒░
// The owner (26 Nov, "angry and rightly"): he talked to Hustler for about 15 minutes by voice message, the Oasis
// hot-reloaded, and the recording was gone (it lived only in the page's memory). Now every piece of a recording goes
// into IndexedDB as it arrives (MediaRecorder hands one over each second), with the agent and the time; after a
// reload the agent's thread offers it back ("a voice message of 14:32 was interrupted: send it, listen, or
// discard"). A recording is only forgotten when it was sent or he discards it.
// The pure part (durations, the line he reads, which one comes back first) is tested; the IndexedDB part is thin.

export type KeptState = 'recording' | 'unsent'

export interface KeptRecording {
  id: string
  agentId: string
  startedAt: number
  /** When the last piece arrived (a recording cut off by a reload ends there). */
  lastChunkAt: number
  mime: string
  priority?: 'now' | 'later'
  /** recording: it was still being recorded when the page went (interrupted); unsent: stopped, not sent yet. */
  state: KeptState
  durationMs: number
}

/** Its length: a stopped one knows; one cut off ends at its last piece. */
export function keptDuration(r: Pick<KeptRecording, 'state' | 'durationMs' | 'startedAt' | 'lastChunkAt'>): number {
  if (r.state === 'unsent' && r.durationMs > 0) return r.durationMs
  return Math.max(0, r.lastChunkAt - r.startedAt)
}

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function length(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** The line he reads after a reload. */
export function keptLine(r: KeptRecording, agentName: string): string {
  const what = `A voice message of ${clock(r.startedAt)} for ${agentName} (${length(keptDuration(r))})`
  return r.state === 'recording'
    ? `${what} was interrupted by a reload. It is kept: send it, listen, or discard (bottom left, or in ${agentName}'s panel).`
    : `${what} was not sent yet. It is kept: send it, listen, or discard.`
}

/** One per agent comes back at a time (the newest); the others wait in the keep until that one is sent or discarded. */
export function nextPerAgent(list: KeptRecording[], skip: (agentId: string) => boolean = () => false): KeptRecording[] {
  const byAgent = new Map<string, KeptRecording>()
  for (const r of list) {
    if (skip(r.agentId)) continue
    const had = byAgent.get(r.agentId)
    if (!had || r.startedAt > had.startedAt) byAgent.set(r.agentId, r)
  }
  return [...byAgent.values()].sort((a, b) => a.startedAt - b.startedAt)
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'oasis-voice-messages'
const DB_VERSION = 1
const RECORDINGS = 'recordings'
const CHUNKS = 'chunks'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['id', 'seq'] })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB would not open'))
  })
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'))
  })
}

// Writes for one recording go in order (a piece is never stored before its recording, or after it was forgotten).
const queues = new Map<string, Promise<unknown>>()
function inOrder<T>(id: string, job: () => Promise<T>): Promise<T> {
  const before = queues.get(id) || Promise.resolve()
  const next = before.catch(() => undefined).then(job)
  queues.set(id, next)
  next.finally(() => { if (queues.get(id) === next) queues.delete(id) }).catch(() => undefined)
  return next
}

export function keepBegin(r: KeptRecording): Promise<void> {
  return inOrder(r.id, async () => {
    const db = await openDb()
    const tx = db.transaction(RECORDINGS, 'readwrite')
    tx.objectStore(RECORDINGS).put(r)
    await done(tx)
  })
}

export function keepChunk(id: string, seq: number, data: Blob, at: number): Promise<void> {
  return inOrder(id, async () => {
    const db = await openDb()
    const tx = db.transaction([RECORDINGS, CHUNKS], 'readwrite')
    tx.objectStore(CHUNKS).put({ id, seq, data, at })
    const store = tx.objectStore(RECORDINGS)
    const get = store.get(id)
    get.onsuccess = () => { if (get.result) store.put({ ...get.result, lastChunkAt: at }) }
    await done(tx)
  })
}

export function keepUpdate(id: string, patch: Partial<Pick<KeptRecording, 'state' | 'durationMs'>>): Promise<void> {
  return inOrder(id, async () => {
    const db = await openDb()
    const tx = db.transaction(RECORDINGS, 'readwrite')
    const store = tx.objectStore(RECORDINGS)
    const get = store.get(id)
    get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }) }
    await done(tx)
  })
}

export function keepForget(id: string): Promise<void> {
  return inOrder(id, async () => {
    const db = await openDb()
    const tx = db.transaction([RECORDINGS, CHUNKS], 'readwrite')
    tx.objectStore(RECORDINGS).delete(id)
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
    await done(tx)
  })
}

export async function keepList(): Promise<KeptRecording[]> {
  const db = await openDb()
  const tx = db.transaction(RECORDINGS, 'readonly')
  const req = tx.objectStore(RECORDINGS).getAll()
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve((req.result || []) as KeptRecording[])
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'))
  })
}

/** The recording as one file, its pieces in order (null when no piece arrived). */
export async function keepBlob(r: Pick<KeptRecording, 'id' | 'mime'>): Promise<Blob | null> {
  const db = await openDb()
  const tx = db.transaction(CHUNKS, 'readonly')
  const req = tx.objectStore(CHUNKS).getAll(IDBKeyRange.bound([r.id, 0], [r.id, Number.MAX_SAFE_INTEGER]))
  const rows = await new Promise<Array<{ seq: number; data: Blob }>>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'))
  })
  const parts = rows.sort((a, b) => a.seq - b.seq).map(row => row.data).filter(part => part && part.size > 0)
  return parts.length ? new Blob(parts, { type: r.mime || parts[0].type || 'audio/webm' }) : null
}
