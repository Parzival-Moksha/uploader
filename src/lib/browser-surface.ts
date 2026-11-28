// What a browser window in a world may show. Only web pages (http, https) and the Oasis's own pages (a relative path).
// Anything else is refused, above all javascript:, which in an iframe runs as the Oasis itself in every visitor's
// page (Merge Goat, 28 Nov 2026), and data:, blob:, file:, vbscript: and the like.

/**
 * The address a browser window may load, or '' when it may load nothing.
 * - '/x', './x', '../x': the Oasis's own pages, kept.
 * - '//host/x' or '/\host/x': another site written without a scheme, made https.
 * - 'localhost:3000/x', '127.0.0.1', '[::1]:8080': http.
 * - 'example.com', 'example.com:8080/x': https.
 * - 'http://...', 'https://...': kept.
 * - any other scheme, or control characters or spaces inside: ''.
 */
export function normalizeBrowserSurfaceUrl(input?: string | null): string {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  if (!trimmed) return ''
  // Tabs, newlines and other control characters inside an address are how "java\tscript:" slips past a check.
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return ''
  // Browsers read "//host" and "/\host" as another site: say so.
  if (/^[\\/]{2}/.test(trimmed)) return `https://${trimmed.replace(/^[\\/]+/, '')}`
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) return `http://${trimmed}`
  // A host with a port looks like a scheme ("example.com:8080"): it is a host.
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*:\d+(?:[/?#]|$)/i.test(trimmed)) return `https://${trimmed}`
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return ''
  return `https://${trimmed}`
}

type WithAgentWindows = { agentWindows?: unknown }

/**
 * A world as stored or loaded, with every browser window's address checked: an address that may not load is
 * dropped (the window stays, showing its welcome page). Returns the same object when nothing changed.
 */
export function sanitizeWorldSurfaceUrls<T extends WithAgentWindows>(state: T): T {
  if (!state || !Array.isArray(state.agentWindows)) return state
  let changed = false
  const windows = state.agentWindows.map((win: unknown) => {
    if (!win || typeof win !== 'object') return win
    const w = win as Record<string, unknown>
    if (!('surfaceUrl' in w)) return win
    const raw = typeof w.surfaceUrl === 'string' ? w.surfaceUrl : ''
    const safe = normalizeBrowserSurfaceUrl(raw)
    if (safe && safe === raw) return win
    changed = true
    const { surfaceUrl: _dropped, ...rest } = w
    return safe ? { ...rest, surfaceUrl: safe } : rest
  })
  return changed ? { ...state, agentWindows: windows } : state
}

/** True when the address is the Oasis's own page (a relative path, or the same origin as `here`). */
export function isSameOriginSurface(url: string, here?: { origin: string } | null): boolean {
  if (!url) return true
  if (url.startsWith('/') && !/^[\\/]{2}/.test(url)) return true
  if (url.startsWith('./') || url.startsWith('../')) return true
  if (!here) return false
  try { return new URL(url, here.origin).origin === here.origin } catch { return false }
}

type WithBehaviors = { behaviors?: unknown }

/**
 * A world as stored or loaded, without object actions that run on one press of F and reach past the world: an API
 * call (any route, with the visitor's session) always, and on the hosted Oasis an HTML overlay too. Merge Goat's
 * second HIGH, 28 Nov. Returns the same object when nothing changed.
 */
export function sanitizeWorldObjectActions<T extends WithBehaviors>(state: T, options: { hosted?: boolean } = {}): T {
  // An API call is stripped everywhere. An HTML overlay only on the hosted Oasis: every overlay frame is sandboxed
  // without this site's origin, and the owner's own worlds hold overlays he made (Merge Goat's MEDIUM, 28 Nov).
  const STRIPPED_ACTIONS = new Set(options.hosted ? ['api_call', 'html_overlay'] : ['api_call'])
  // Only the action types the Oasis knows are kept; anything else is dropped, not stored inert (Anorak, 28 Nov).
  const KNOWN_ACTIONS = new Set(['html_overlay', 'api_call', 'spawn_vfx', 'audio_toggle', 'spell', 'focus_agent_window'])
  if (!state || !state.behaviors || typeof state.behaviors !== 'object' || Array.isArray(state.behaviors)) return state
  let changed = false
  const behaviors: Record<string, unknown> = {}
  for (const [id, behavior] of Object.entries(state.behaviors as Record<string, unknown>)) {
    const b = behavior as { interaction?: { actions?: unknown } } | null
    const actions = b && typeof b === 'object' && b.interaction && Array.isArray(b.interaction.actions) ? b.interaction.actions : null
    if (!actions) { behaviors[id] = behavior; continue }
    const kept = actions.filter((a: unknown) => {
      if (!a || typeof a !== 'object') return false
      const type = (a as { type?: unknown }).type
      return typeof type === 'string' && KNOWN_ACTIONS.has(type) && !STRIPPED_ACTIONS.has(type)
    })
    if (kept.length === actions.length) { behaviors[id] = behavior; continue }
    changed = true
    behaviors[id] = { ...(b as object), interaction: { ...(b as { interaction: object }).interaction, actions: kept } }
  }
  return changed ? { ...state, behaviors } : state
}

/** Everything a stored or loaded world is cleaned of: unsafe window addresses and object actions that reach past it. */
export function sanitizeWorldContent<T extends WithAgentWindows & WithBehaviors>(state: T, options: { hosted?: boolean } = {}): T {
  return sanitizeWorldObjectActions(sanitizeWorldSurfaceUrls(state), options)
}
