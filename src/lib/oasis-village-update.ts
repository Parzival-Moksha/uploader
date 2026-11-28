// What the Upgrade button shows for his own village (route: src/app/api/oasis/update/route.ts), from the build
// script's status (scripts/oasis-village-build.mjs status). Pure, so it is tested without a server.

export interface VillageStatus {
  mode: string
  serving: { dist: string; commit: string | null; at: string | null } | null
  ready: { dist: string; commit: string; at: string } | null
  head: string
  newerThanServing: number | null
  phase: string
  step: string | null
  startedAt: number | null
  error: string | null
}

function when(iso: string | null): string {
  if (!iso) return 'built at an unknown time'
  const d = new Date(iso)
  return `built ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toTimeString().slice(0, 5)}`
}

export function villageView(s: VillageStatus) {
  const running = s.serving
    ? { label: `${s.serving.commit || 'unknown commit'}, ${when(s.serving.at)}`, commit: s.serving.commit, at: s.serving.at, dist: s.serving.dist }
    : s.mode === 'built' ? null : { label: 'the dev server (hot reload)', commit: null, at: null, dist: null }
  const n = s.newerThanServing
  return {
    kind: 'village' as const,
    running,
    newer: n && n > 0 ? { label: `${n} newer commit${n === 1 ? '' : 's'}`, count: n } : null,
    head: s.head,
    busy: ['building', 'proving', 'swapping'].includes(s.phase),
    phase: s.phase,
    step: s.step,
    startedAt: s.startedAt,
    ready: s.ready ? { commit: s.ready.commit, at: s.ready.at, dist: s.ready.dist } : null,
    error: s.error,
  }
}
