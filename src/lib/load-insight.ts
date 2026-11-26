// Display helpers for the loading bar (WorldLoadingBar.tsx). Owned by Hipster. The data itself (what is loading, what
// finished, the phase, the warm-up) is Perf's src/lib/load-tracker.ts; this file only formats it.
//
// The owner, 2026-11-24: "it'd be cool if it was like a 200px wide bar on the bottom center instead. and if it gave max
// info on whats being loaded. in megabytes or in type of asset or stuff, im just curious to see what takes so long".

import type { LoadItem, LoadSnapshot } from './load-tracker'

export function formatMb(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / 1_000_000
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

/** The slowest finished items, longest first. */
export function slowest(s: Pick<LoadSnapshot, 'done'>, n: number): LoadItem[] {
  return s.done.filter(i => i.endMs !== null).slice().sort((a, b) => (b.endMs! - b.startMs) - (a.endMs! - a.startMs)).slice(0, n)
}
