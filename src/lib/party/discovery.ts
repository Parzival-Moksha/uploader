// ░▒▓ FINDING A PARTY ON THIS WI-FI ▓▒░
// A party server (scripts/party-server.mjs) answers a UDP question on port 4599. To find parties, an Oasis's own page
// server (a browser cannot use UDP) sends the question to every local broadcast address and to itself, then
// collects the answers for under a second. Why a broadcast question with a direct answer, not mDNS: nothing to
// install, no clash with the mDNS responder Windows already runs on 5353, and Windows Firewall lets the answer
// to one's own broadcast back in for three seconds by default (Public networks too), so whoever joins needs no
// admin step. The host's computer must let UDP 4599 and its party port in (node.exe's own rule, or one rule).

import dgram from 'node:dgram'
import os from 'node:os'

export const PARTY_DISCOVERY_PORT = 4599
export const PARTY_QUERY = 'OASIS-PARTY?1'

export interface PartyAnnouncement {
  /** The host's chosen name. */
  host: string
  /** The world the party is in. */
  world: string
  /** How many people are in it now. */
  players: number
  /** Where to open it. Made from the answer's own address, never taken from the answer's text. */
  url: string
  /** The host's Oasis version. */
  version: string
  /** Paid spells on (the host's keys and budget). */
  spells: boolean
}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : ''

/** A valid answer, or null. The address comes from the packet, so an answer cannot send people elsewhere. */
export function parseAnnouncement(payload: string, fromAddress: string): PartyAnnouncement | null {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(payload) } catch { return null }
  if (!raw || typeof raw !== 'object' || raw.oasisParty !== 1) return null
  const port = Number(raw.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(fromAddress)) return null
  // A host with several addresses names the one its party listens on; taken only inside the sender's own /24.
  const named = typeof raw.address === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(raw.address) ? raw.address : ''
  const address = named && named.split('.').slice(0, 3).join('.') === fromAddress.split('.').slice(0, 3).join('.') ? named : fromAddress
  const players = Number(raw.players)
  return {
    host: clean(raw.host, 40) || 'Someone',
    world: clean(raw.world, 60) || 'a world',
    players: Number.isFinite(players) ? Math.max(0, Math.min(999, Math.floor(players))) : 0,
    url: `http://${address}${port === 80 ? '' : `:${port}`}`,
    version: clean(raw.version, 24),
    spells: raw.spells === true,
  }
}

/** Every IPv4 broadcast address of this machine's networks, the all-ones broadcast, and this machine itself. */
export function partyQueryTargets(nets: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const out = new Set<string>(['255.255.255.255', '127.0.0.1'])
  for (const list of Object.values(nets)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      if (ip.length !== 4 || mask.length !== 4) continue
      out.add(ip.map((octet, i) => (octet & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return [...out]
}

/** Ask the local networks for parties; answers within `waitMs`. Same URL twice counts once. */
export function findParties(waitMs = 800): Promise<PartyAnnouncement[]> {
  return new Promise(resolve => {
    const found = new Map<string, PartyAnnouncement>()
    let socket: dgram.Socket
    try { socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }) } catch { resolve([]); return }
    const done = () => { try { socket.close() } catch { /* closed */ } resolve([...found.values()]) }
    socket.on('error', done)
    socket.on('message', (msg, rinfo) => {
      const party = parseAnnouncement(msg.toString('utf8'), rinfo.address)
      if (!party) return
      // The same party answers on 127.0.0.1 and on its Wi-Fi address: keep the Wi-Fi one, which friends can open.
      const key = `${party.host}|${party.world}|${party.url.split(':').pop()}`
      const prev = found.get(key)
      if (!prev || prev.url.includes('127.0.0.1')) found.set(key, party)
    })
    socket.bind(0, () => {
      try { socket.setBroadcast(true) } catch { /* some systems refuse; the direct targets still work */ }
      const query = Buffer.from(PARTY_QUERY)
      for (const target of partyQueryTargets()) socket.send(query, PARTY_DISCOVERY_PORT, target, () => {})
      setTimeout(done, waitMs)
    })
  })
}
