// ░▒▓ HELD KEYS — a movement key is never left down after its release was lost ▓▒░
// The owner, 28 Nov, on the deployed Oasis: "my avatar is gliding now. I'm not pushing W. If I push S, it stops."
// drei's KeyboardControls (Scene.tsx) sets a key on keydown and clears it only on a keyup that reaches window. Some
// never do: the page loses the focus while W is held (Alt-Tab, the tab hidden, a click into a 3D browser window or
// an agent's page, which are iframes), or a field stops the keyup on its way (React's stopPropagation keeps it from
// window: the 3D browser's address bar does). Then W stays down and the avatar walks by itself until W is pressed again;
// S held only cancels it.
// This watches the movement keys from the capture phase (before anything can stop them) and, for each one still down,
// sends the keyup drei missed (a plain keyup on window): when the page loses the focus or is hidden, and when a keyup
// was seen but did not reach window. The phone's stick is let go too when the page loses the focus.

export interface HeldKeysWindow {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void
  dispatchEvent(event: Event): boolean
  setTimeout(handler: () => void, ms?: number): unknown
}

export interface HeldKeysOptions {
  /** The document, for visibilitychange (hidden: let go). */
  doc?: { addEventListener: HeldKeysWindow['addEventListener']; removeEventListener: HeldKeysWindow['removeEventListener']; visibilityState?: string }
  /** The keyup sent for a key still down (a KeyboardEvent in the browser). */
  makeKeyup?: (code: string, key: string) => Event
  /** Also let go of whatever else holds a direction (the phone's stick). */
  onLetGo?: () => void
}

type KeyLike = Event & { code?: string; key?: string; repeat?: boolean }

/** Watch `codes` on `win`; returns the function that stops watching. */
export function installHeldKeysRelease(win: HeldKeysWindow, codes: readonly string[], options: HeldKeysOptions = {}): () => void {
  const watched = new Set(codes)
  const held = new Map<string, string>() // code -> key as pressed
  const sent = new WeakSet<Event>()
  const reachedWindow = new Set<string>()
  const makeKeyup = options.makeKeyup ?? ((code: string, key: string) => new KeyboardEvent('keyup', { code, key, bubbles: true }))

  const release = (code: string) => {
    const key = held.get(code) ?? ''
    held.delete(code)
    const event = makeKeyup(code, key)
    sent.add(event)
    win.dispatchEvent(event)
  }
  const letGoOfAll = () => {
    for (const code of [...held.keys()]) release(code)
    options.onLetGo?.()
  }

  const onDownCapture = (event: Event) => {
    const e = event as KeyLike
    if (!e.code || !watched.has(e.code) || sent.has(event)) return
    held.set(e.code, e.key ?? '')
  }
  const onUpCapture = (event: Event) => {
    const e = event as KeyLike
    if (!e.code || !watched.has(e.code) || sent.has(event)) return
    const code = e.code
    if (!held.has(code)) return
    held.delete(code)
    // Did it get to window (drei listens there)? The bubbling listener below says so; if not, it was stopped.
    reachedWindow.delete(code)
    const key = e.key ?? ''
    win.setTimeout(() => {
      if (reachedWindow.has(code)) { reachedWindow.delete(code); return }
      if (held.has(code)) return // pressed again meanwhile
      held.set(code, key)
      release(code)
    }, 0)
  }
  const onUpBubble = (event: Event) => {
    const e = event as KeyLike
    if (e.code && watched.has(e.code) && !sent.has(event)) reachedWindow.add(e.code)
  }
  const onBlur = () => letGoOfAll()
  const onVisibility = () => { if (options.doc?.visibilityState === 'hidden') letGoOfAll() }

  win.addEventListener('keydown', onDownCapture, true)
  win.addEventListener('keyup', onUpCapture, true)
  win.addEventListener('keyup', onUpBubble)
  win.addEventListener('blur', onBlur)
  options.doc?.addEventListener('visibilitychange', onVisibility)
  return () => {
    win.removeEventListener('keydown', onDownCapture, true)
    win.removeEventListener('keyup', onUpCapture, true)
    win.removeEventListener('keyup', onUpBubble)
    win.removeEventListener('blur', onBlur)
    options.doc?.removeEventListener('visibilitychange', onVisibility)
  }
}
