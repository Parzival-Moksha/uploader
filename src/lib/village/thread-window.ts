// ░▒▓ THREAD WINDOW — how much of an agent's thread is drawn ▓▒░
// Perf, 27 Nov (the owner: "every time I hit E it lags super hard, one to two seconds"): the side panel and the F
// screen drew every loaded group of the thread on each open. A long thread (the history cap is 6,000 entries, and
// a reload loads older pieces to find his place again) was 37,000-66,000 page elements and a 600 ms frame on each E.
// Now the newest THREAD_WINDOW groups are drawn; scrolling near the top draws THREAD_WINDOW_STEP more (and only when
// everything loaded is drawn does the next older piece load from the engine).
// The window starts at an ENTRY's key, fixed when the thread opens, so new lines arriving below never push out the
// older ones he is reading. Not a group's key: a folded tool run is keyed by its first call, and when older history
// lands its last calls join that run, which then has another key (the owner, 28 Nov: "I scroll all the way up and then
// I can't scroll higher up": the window lost its start and fell back to the newest groups on every load; on the ASI
// Piller's real history 3 loads in 6). The entry is always found again, in whichever group holds it. Pure.

export const THREAD_WINDOW = 120
export const THREAD_WINDOW_STEP = 120
/** Groups drawn above a restored place (thread-anchor.ts), so it does not sit at the window's very edge. */
export const THREAD_WINDOW_ANCHOR_MARGIN = 20

/** What the window needs of a thread group (village-thread.ts ThreadItem). */
export type WindowGroup = { kind: 'entry'; key: string } | { kind: 'tools'; key: string; entries: ReadonlyArray<{ key: string }> }

/** The entry a group is found again by: its first (a tool run's own key changes when older calls join it). */
export function pinKeyOf(group: WindowGroup): string {
  return group.kind === 'tools' && group.entries.length ? group.entries[0].key : group.key
}

/** Every entry's group, by the entry's key; a group's own key too (a tool run's "run:…", as anchors kept it). */
export function groupsByEntry(groups: readonly WindowGroup[]): Map<string, number> {
  const map = new Map<string, number>()
  groups.forEach((group, index) => {
    map.set(group.key, index)
    if (group.kind === 'tools') for (const entry of group.entries) map.set(entry.key, index)
  })
  return map
}

/** The group holding this entry (or this group key; "run:<entry>" falls back to the entry). */
export function groupOfKey(byEntry: ReadonlyMap<string, number>, key: string): number | undefined {
  return byEntry.get(key) ?? (key.startsWith('run:') ? byEntry.get(key.slice(4)) : undefined)
}

/**
 * Index of the first drawn group: the one holding `from`; when that is gone (the log cap dropped it), as many groups
 * as were drawn before (`keep`), never fewer; with nothing pinned yet, the newest `size`.
 */
export function threadWindowStart(count: number, from: string | null, byEntry: ReadonlyMap<string, number>, keep: number | null = null, size = THREAD_WINDOW): number {
  if (from !== null) {
    const at = groupOfKey(byEntry, from)
    if (at !== undefined) return at
    if (keep !== null) return Math.max(0, count - Math.max(keep, size))
  }
  return Math.max(0, count - size)
}

/** The first group one step further back; null when every loaded group is drawn already. */
export function threadWindowGrown(start: number, step = THREAD_WINDOW_STEP): number | null {
  return start > 0 ? Math.max(0, start - step) : null
}

/** To draw a loaded group above the window (a restored place): the group to start at. null: drawn, or not loaded. */
export function threadWindowFor(byEntry: ReadonlyMap<string, number>, key: string, start: number, margin = THREAD_WINDOW_ANCHOR_MARGIN): number | null {
  const at = groupOfKey(byEntry, key)
  if (at === undefined || at >= start) return null
  return Math.max(0, at - margin)
}
