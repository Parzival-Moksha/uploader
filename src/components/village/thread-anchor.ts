// ░▒▓ THREAD ANCHOR — where the owner was in an agent's thread, kept across a reload ▓▒░
// The owner (2026-11-24, through Debugger and Anorak): after a reload he is back where he was, the panel that was open
// opens again (Debugger's reload-resume.ts), and its thread is where it was (this). Kept per agent in this tab's
// sessionStorage, for 3 hours: the entry at the top of the view and how far below the top it was; at the newest
// line nothing is kept (the thread opens at the newest, as always). The session view saves while it scrolls and,
// when it mounts, loads older history until that entry is there and scrolls to it.

const KEY = 'oasis.village.threadAnchor.v1'
const KEEP_MS = 3 * 3600_000

export interface ThreadAnchor {
  /** The thread item's key (data-thread-key). */
  key: string
  /** Its top, in pixels below the top of the thread's view. */
  offset: number
  at: number
}

function readAll(): Record<string, ThreadAnchor> {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const data = raw ? JSON.parse(raw) as Record<string, ThreadAnchor> : {}
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, ThreadAnchor>): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(data)) } catch { /* storage full or blocked */ }
}

export function readThreadAnchor(agentId: string, now = Date.now()): ThreadAnchor | null {
  const anchor = readAll()[agentId]
  if (!anchor || typeof anchor.key !== 'string' || now - anchor.at > KEEP_MS) return null
  return anchor
}

/** null: at the newest line (nothing to keep). */
export function writeThreadAnchor(agentId: string, anchor: ThreadAnchor | null): void {
  const all = readAll()
  if (anchor) all[agentId] = anchor
  else delete all[agentId]
  writeAll(all)
}

/**
 * The anchor of a column-reverse thread as it stands: null at the newest (scrollTop counts from the bottom, 0 is the
 * newest), else the first item whose bottom is below the view's top.
 */
export function anchorOf(scroller: HTMLElement, now = Date.now()): ThreadAnchor | null {
  if (scroller.scrollTop > -8) return null
  const top = scroller.getBoundingClientRect().top
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-thread-key]')) {
    const box = el.getBoundingClientRect()
    if (box.bottom > top + 1) return { key: el.dataset.threadKey || '', offset: Math.round(box.top - top), at: now }
  }
  return null
}

/** Scroll so the anchored item sits where it was. False when it is not in the thread (yet). */
export function scrollToAnchor(scroller: HTMLElement, anchor: ThreadAnchor): boolean {
  const el = scroller.querySelector<HTMLElement>(`[data-thread-key="${CSS.escape(anchor.key)}"]`)
  if (!el) return false
  const top = scroller.getBoundingClientRect().top
  scroller.scrollTop += el.getBoundingClientRect().top - top - anchor.offset
  return true
}
