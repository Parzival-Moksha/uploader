// Hipster's tries (the owner, 27 Nov: "make the Oasis better... put them in Settings > Experiments for you to check, and
// tell me which one you think is good taste and which one we should keep and which one we should delete").
// Each try is a switch with a name and one line, on one axis (picture, menus, sound, ...). He flips it, looks, keeps
// or kills it. A kept try becomes the Oasis's own; a killed one is deleted from here with its CSS.
//
// The switches are published as html data-try-<id>="1", so a try that is only CSS needs no code anywhere else
// (its rules are in kit-css.ts under "Hipster's tries"); a try that needs code reads isTryOn(id).

import { useSyncExternalStore } from 'react'

export type TryId = 'cinematic-frame' | 'warm-grade' | 'menus-glide' | 'quiet-hover'

export const TRIES: Array<{ id: TryId; axis: string; label: string; line: string }> = [
  { id: 'cinematic-frame', axis: 'Picture', label: 'Cinematic frame', line: 'A soft dark vignette and a fine film grain over the world, like a game\'s camera, not a web page.' },
  { id: 'warm-grade', axis: 'Picture', label: 'Warm grade', line: 'The world a touch richer and warmer: a little more colour and contrast, a hint of gold.' },
  { id: 'menus-glide', axis: 'Menus', label: 'Menus glide in', line: 'Every kit menu and dialog rises and fades in over a fifth of a second instead of popping.' },
  { id: 'quiet-hover', axis: 'Sound', label: 'Quiet hovers', line: 'No tick when the mouse passes over buttons; only the click sounds. Calmer for long sessions.' },
]

const KEY = 'oasis-hipster-tries'
interface Store { on: Set<TryId> | null; listeners: Set<() => void> }
const STORE_KEY = '__oasisHipsterTries'
const store: Store = ((globalThis as Record<string, unknown>)[STORE_KEY] as Store | undefined)
  ?? ((globalThis as Record<string, unknown>)[STORE_KEY] = { on: null, listeners: new Set() } as Store)

function read(): Set<TryId> {
  if (store.on) return store.on
  let ids: string[] = []
  try { ids = JSON.parse((typeof window !== 'undefined' && window.localStorage.getItem(KEY)) || '[]') } catch { ids = [] }
  store.on = new Set(ids.filter((id): id is TryId => TRIES.some(t => t.id === id)))
  return store.on
}

/** Put the switches on the page root, where the CSS tries read them. */
export function applyTries(): void {
  if (typeof document === 'undefined' || !document.documentElement?.dataset) return
  const on = read()
  for (const t of TRIES) {
    const attr = `try${t.id.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())}`
    if (on.has(t.id)) document.documentElement.dataset[attr] = '1'
    else delete document.documentElement.dataset[attr]
  }
}

export function isTryOn(id: TryId): boolean {
  return read().has(id)
}

export function setTry(id: TryId, on: boolean): void {
  const next = new Set(read())
  if (on) next.add(id); else next.delete(id)
  store.on = next
  try { window.localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* private mode */ }
  applyTries()
  store.listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  store.listeners.add(fn)
  return () => { store.listeners.delete(fn) }
}

let snapshot: { key: string; ids: TryId[] } = { key: '', ids: [] }
function getSnapshot(): TryId[] {
  const ids = [...read()].sort()
  const key = ids.join(',')
  if (key !== snapshot.key) snapshot = { key, ids }
  return snapshot.ids
}

export function useTries(): TryId[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => [])
}
