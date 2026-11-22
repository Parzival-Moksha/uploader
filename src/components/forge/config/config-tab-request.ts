// Open Settings on a given tab (the main menu's service lights open it on Misc). ConfigMenu takes the request when it
// mounts, or at once when it is already open.

import type { ConfigTabId } from './types'

export const CONFIG_TAB_EVENT = 'oasis:config-tab'
let requested: ConfigTabId | null = null

export function requestConfigTab(tab: ConfigTabId): void {
  requested = tab
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONFIG_TAB_EVENT, { detail: { tab } }))
}

/** The tab asked for, once. */
export function takeRequestedConfigTab(): ConfigTabId | null {
  const tab = requested
  requested = null
  return tab
}
