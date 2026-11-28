// The page server's half of "only what ships" (src/lib/only-what-ships-server.ts): what a request for a model,
// an avatar, an animation or a sound gets while the switch is on. Pure, so the middleware stays small.

/** The folders the switch covers (scripts/slim/left-out.mjs SCOPES, as addresses). */
export const GATED_PREFIXES = ['/models/', '/avatars/', '/animations/', '/audio/']

export interface GateList {
  on: boolean
  leftOut: string[]
  standIns: Record<string, string>
}

export interface PreparedGate {
  on: boolean
  left: Set<string>
  standIns: Map<string, string>
}

export type GateVerdict = { action: 'next' } | { action: 'stand-in'; to: string } | { action: 'missing' }

export function prepareGate(list: GateList | null | undefined): PreparedGate {
  return { on: Boolean(list?.on), left: new Set(list?.leftOut ?? []), standIns: new Map(Object.entries(list?.standIns ?? {})) }
}

export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

/** A request's path (as it arrives, URL-encoded) -> pass it, serve the stand-in, or answer as a stranger's Oasis would. */
export function gateVerdict(pathname: string, gate: PreparedGate): GateVerdict {
  if (!gate.on || !isGatedPath(pathname)) return { action: 'next' }
  let plain = pathname
  try { plain = decodeURIComponent(pathname) } catch { /* keep it as it came */ }
  const to = gate.standIns.get(plain)
  if (to) return { action: 'stand-in', to: encodeURI(to) }
  return gate.left.has(plain) ? { action: 'missing' } : { action: 'next' }
}
