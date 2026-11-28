// The local key at the page server's door (see src/lib/local-token.ts). Without OASIS_LOCAL_TOKEN in the
// server's environment this does nothing at all: the workshop and the hosted Oasis run as they always did.
// Then "only what ships" (src/lib/only-what-ships-server.ts): in the owner's own Oasis a model, avatar,
// animation or sound the package leaves out gets its shipped stand-in or a 404, as in a stranger's.
import { NextResponse, type NextRequest } from 'next/server'

import { LOCAL_TOKEN_COOKIE, localGate, localhostRedirect } from '@/lib/local-token'
import { gateVerdict, isGatedPath, prepareGate, type GateList, type PreparedGate } from '@/lib/only-what-ships-gate'

// Nothing to switch in the package or the hosted Oasis (they serve all they have); the route says so too.
const GATE_POSSIBLE = process.env.NEXT_PUBLIC_OASIS_MODE !== 'hosted' && process.env.NEXT_PUBLIC_OASIS_EDITION !== 'slim'
const GATE_TTL_MS = 3000
const gateCache = new Map<string, { at: number; gate: Promise<PreparedGate> }>()

/** The list as the route gives it for this browser's choice ('on' forces it on; '' follows the switch). */
function shippedGate(request: NextRequest, token: string, choice: string): Promise<PreparedGate> {
  const hit = gateCache.get(choice)
  if (hit && Date.now() - hit.at < GATE_TTL_MS) return hit.gate
  const headers: Record<string, string> = {}
  if (token) headers['x-oasis-token'] = token
  if (choice) headers.cookie = `oasis-only-what-ships=${choice}`
  const gate = fetch(new URL('/api/oasis/shipped', request.nextUrl.origin), { headers, cache: 'no-store' })
    .then(r => (r.ok ? r.json() as Promise<GateList> : null))
    .then(prepareGate, () => prepareGate(null))
  gateCache.set(choice, { at: Date.now(), gate })
  return gate
}

async function onlyWhatShips(request: NextRequest, token: string): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const choice = request.cookies.get('oasis-only-what-ships')?.value === 'on' ? 'on' : request.cookies.get('oasis-only-what-ships')?.value === 'off' ? 'off' : ''
  if (!GATE_POSSIBLE || !isGatedPath(pathname) || choice === 'off') return NextResponse.next()
  const verdict = gateVerdict(pathname, await shippedGate(request, token, choice))
  if (verdict.action === 'stand-in') return NextResponse.rewrite(new URL(verdict.to, request.url))
  if (verdict.action === 'missing') return new NextResponse('Not in the package (Settings > Misc > Only what ships)', { status: 404 })
  return NextResponse.next()
}

export const config = {
  // Not the build's own files; everything else, pages and /api alike.
  matcher: ['/((?!_next/static|_next/image).*)'],
}

export async function middleware(request: NextRequest) {
  const required = (process.env.OASIS_LOCAL_TOKEN || '').trim()
  if (!required) return onlyWhatShips(request, '')
  // 127.0.0.1 has no key cookie (it lives on localhost): a page visit there goes to localhost instead.
  const moveTo = localhostRedirect({
    host: request.headers.get('host'), pathname: request.nextUrl.pathname, search: request.nextUrl.search,
    key: request.nextUrl.searchParams.get('key'), cookieToken: request.cookies.get(LOCAL_TOKEN_COOKIE)?.value || null,
    isDocument: request.headers.get('sec-fetch-dest') === 'document' || (!request.headers.get('sec-fetch-dest') && (request.headers.get('accept') || '').includes('text/html')),
  })
  if (moveTo) return NextResponse.redirect(moveTo)
  const auth = request.headers.get('authorization') || ''
  const verdict = localGate({
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    pathname: request.nextUrl.pathname,
    key: request.nextUrl.searchParams.get('key'),
    cookieToken: request.cookies.get(LOCAL_TOKEN_COOKIE)?.value || null,
    headerToken: request.headers.get('x-oasis-token') || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null),
  }, required)
  if (verdict.action === 'deny') return NextResponse.json({ error: verdict.error }, { status: verdict.status })
  if (verdict.action === 'set-cookie') {
    // Keep the key out of the address bar and the history: store it, then show the same page without it.
    // Back to the very address that was asked for (localhost and 127.0.0.1 keep separate cookies).
    const clean = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `http://${request.headers.get('host')}`)
    clean.searchParams.delete('key')
    const response = NextResponse.redirect(clean)
    response.cookies.set(LOCAL_TOKEN_COOKIE, required, { sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 365 })
    return response
  }
  return onlyWhatShips(request, required)
}
