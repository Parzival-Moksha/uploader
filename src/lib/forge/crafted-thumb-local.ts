// Crafted-scene thumbnails the server would not keep (the owner, 28 Nov, on the deployed Oasis: "I don't see any
// thumbnails for the gallery of the text-to-3D objects. It's bad."). The thumbnail is rendered in the browser and
// then saved with PUT /api/craft/thumbnail; where that is refused (the deployed Oasis lets no visitor write files),
// the rendered picture stays in this page instead (an object URL), the gallery shows it, and the generator does not
// render the same scene again and again. Page-lifetime only: a reload renders it once more.

const urls = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

export function rememberLocalCraftedThumb(sceneId: string, blob: Blob): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const old = urls.get(sceneId)
  if (old) URL.revokeObjectURL(old)
  urls.set(sceneId, URL.createObjectURL(blob))
  version += 1
  listeners.forEach(listener => listener())
}

export function localCraftedThumb(sceneId: string): string | undefined {
  return urls.get(sceneId)
}

export function hasLocalCraftedThumb(sceneId: string): boolean {
  return urls.has(sceneId)
}

export function subscribeLocalCraftedThumbs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function localCraftedThumbsVersion(): number {
  return version
}
