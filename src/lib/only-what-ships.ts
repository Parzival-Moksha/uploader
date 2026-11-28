// The browser's half of "only what ships" (the server's: src/lib/only-what-ships-server.ts). The page server
// already answers a left-out file with its stand-in or a 404; what it cannot see is code that picks a file by
// name before asking (the Mixamo gaits, the owner's spell-sound list, the music), so that code asks
// packagedView(): true in the package, and in the owner's Oasis while the switch is on.
//
// The switch lives on the server; this browser keeps a copy of the last answer (so the first sounds of a page
// already know), refreshed by syncOnlyWhatShips() when the page starts. A cookie 'oasis-only-what-ships' of 'on'
// or 'off' overrides both for this browser (an agent's test).

const MIRROR_KEY = 'oasis-only-what-ships-view'
export const ONLY_WHAT_SHIPS_CHANGED = 'oasis:only-what-ships-changed'

export interface OnlyWhatShipsState {
  applies: boolean
  switchOn: boolean
  on: boolean
  leftOut: string[]
  standIns: Record<string, string>
  problems: string[]
}

function cookieChoice(): 'on' | 'off' | null {
  if (typeof document === 'undefined') return null
  const match = /(?:^|;\s*)oasis-only-what-ships=(on|off)(?:;|$)/.exec(document.cookie)
  return match ? (match[1] as 'on' | 'off') : null
}

/** Whether this Oasis offers and plays only what the package ships. */
export function packagedView(): boolean {
  if (process.env.NEXT_PUBLIC_OASIS_EDITION === 'slim') return true
  if (process.env.NEXT_PUBLIC_OASIS_MODE === 'hosted') return false
  if (typeof window === 'undefined') return false
  const choice = cookieChoice()
  if (choice) return choice === 'on'
  try { return window.localStorage.getItem(MIRROR_KEY) !== '0' } catch { return true }
}

function mirror(state: OnlyWhatShipsState): void {
  try { window.localStorage.setItem(MIRROR_KEY, state.applies && state.on ? '1' : '0') } catch { /* private mode */ }
}

let syncing: Promise<OnlyWhatShipsState | null> | null = null

/** Ask the server what this browser sees; keeps the copy packagedView() reads. Null where there is no switch. */
export function syncOnlyWhatShips(force = false): Promise<OnlyWhatShipsState | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (process.env.NEXT_PUBLIC_OASIS_EDITION === 'slim' || process.env.NEXT_PUBLIC_OASIS_MODE === 'hosted') return Promise.resolve(null)
  if (syncing && !force) return syncing
  const before = packagedView()
  syncing = fetch('/api/oasis/shipped', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() as Promise<OnlyWhatShipsState> : null))
    .then(state => {
      if (state) mirror(state)
      if (packagedView() !== before) window.dispatchEvent(new CustomEvent(ONLY_WHAT_SHIPS_CHANGED))
      return state
    })
    .catch(() => null)
  return syncing
}

/** Turn the switch on or off for the whole Oasis. The page reloads after it, so every list and sound follows. */
export async function setOnlyWhatShips(on: boolean): Promise<OnlyWhatShipsState> {
  const r = await fetch('/api/oasis/shipped', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) })
  const data = await r.json().catch(() => ({})) as OnlyWhatShipsState & { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  mirror(data)
  return data
}
