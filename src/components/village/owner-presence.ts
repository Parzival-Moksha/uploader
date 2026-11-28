// ░▒▓ OWNER PRESENCE — is he in the Oasis right now (the page shown, and he did something lately)? ▓▒░
// For the agents that walk to him by themselves (blocked-walk.ts): with the page hidden, or no key, click, wheel or
// mouse move from him for ten minutes, he is not here and nobody sets off. Read only; it takes nothing from him.

import { useSyncExternalStore } from 'react'
import { ownerPresent } from '../../lib/village/blocked-walk'

let lastInputAt: number | null = null
let present = false
let started = false
const listeners = new Set<() => void>()

function recompute(): void {
  const next = ownerPresent(typeof document !== 'undefined' && document.visibilityState === 'visible', lastInputAt, Date.now())
  if (next === present) return
  present = next
  listeners.forEach(listener => listener())
}

function onInput(): void {
  lastInputAt = Date.now()
  if (!present) recompute()
}

function start(): void {
  if (started || typeof window === 'undefined') return
  started = true
  // Passive and capturing: it only notes the time; every key and click goes on exactly as before.
  for (const type of ['keydown', 'pointerdown', 'wheel', 'mousemove'] as const) window.addEventListener(type, onInput, { capture: true, passive: true })
  document.addEventListener('visibilitychange', recompute)
  window.setInterval(recompute, 15_000)
}

export function isOwnerPresent(): boolean {
  start()
  return present
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** True while he is in the Oasis (re-renders when that changes). */
export function useOwnerPresent(): boolean {
  return useSyncExternalStore(subscribe, isOwnerPresent, () => false)
}
