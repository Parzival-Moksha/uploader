// ░▒▓ PLAY MODE — what a click may select while playing ▓▒░
// A world starts in play (Scene.tsx; the owner, 24 Nov: "the default should be play mode, not build mode"; he kept
// selecting the big ground disc by accident and getting its arrows). In play a click selects only what you use:
// agent windows (select, then Enter zooms), agents placed in the world, pictures and videos (Enter zooms, PgDn
// steps). Decorations, crafted scenes, lights, portals and the like wait for build (a creation spell, the Place
// menu, the Wizard). Scene.tsx keeps the flag; event-bus.ts asks before SELECT_OBJECT.

let playActive = false

export function setPlayModeActive(active: boolean): void {
  playActive = active
}

export function isPlayModeActive(): boolean {
  return playActive
}

export interface SelectableWorld {
  placedAgentWindows: Array<{ id: string }>
  placedAgentAvatars: Array<{ id: string }>
  placedCatalogAssets: Array<{ id: string; imageUrl?: string | null; videoUrl?: string | null }>
}

/** May a click select this object right now? Deselecting (null) always may. */
export function selectableNow(id: string | null, world: SelectableWorld, play = playActive): boolean {
  if (!id || !play) return true
  if (world.placedAgentWindows.some(w => w.id === id)) return true
  if (world.placedAgentAvatars.some(a => a.id === id)) return true
  return world.placedCatalogAssets.some(a => a.id === id && Boolean(a.imageUrl || a.videoUrl))
}
