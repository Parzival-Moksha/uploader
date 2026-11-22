// ░▒▓ HOSTING A PARTY FROM THIS OASIS ▓▒░  (server side of World menu > Host a party on this Wi-Fi)
// Starts scripts/party-server.mjs from this very install, with a sandbox database of its own (one world, never this
// Oasis's own), no agents, no files and no keys unless the host turns paid spells on. Only an installed Oasis can
// host: the party serves the install's production build (next start), so a workshop running `next dev` cannot.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PARTY_PUBLIC_PORT = 4680
const PARTY_WEB_PORT = 4685
const PARTY_ROOM_PORT = 4686

const appDir = () => process.cwd()
export const partyDataDir = () => path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'party')
const pidsFile = () => path.join(partyDataDir(), 'party.pids.json')

/** The install's Oasis version (a release's release.json, else package.json). */
export function oasisVersion(dir = appDir()): string {
  for (const file of [path.join(dir, 'plugins', 'oasis', 'scripts', 'release.json'), path.join(dir, 'package.json')]) {
    try { const v = JSON.parse(fs.readFileSync(file, 'utf8')).version; if (v) return String(v) } catch { /* next */ }
  }
  return ''
}

/** Why this install cannot host, or null when it can. */
export function cannotHostReason(dir = appDir()): string | null {
  if (!fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) return 'Hosting needs the installed Oasis (this one runs from source).'
  if (!fs.existsSync(path.join(dir, 'scripts', 'party-server.mjs'))) return 'This Oasis has no party server; update it.'
  const room = path.join(dir, 'packages', 'oasis-room-server')
  if (!fs.existsSync(path.join(room, 'dist', 'server.js')) && !fs.existsSync(path.join(room, 'src', 'server.ts'))) return 'This Oasis has no room server; update it.'
  return null
}

export interface PartyHostState {
  running: boolean
  url?: string
  host?: string
  startedAt?: number
  canHost: boolean
  /** false: this Oasis has no party server at all (a package without one): the World menu offers no hosting. */
  hostingAvailable: boolean
  reason?: string
  /** One line for Windows, shown once: what to run if friends do not see the party. */
  firewallLine?: string
}

function alive(pid: unknown): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function readPids(): { launcher?: number; page?: number; room?: number; url?: string; host?: string; startedAt?: number } | null {
  try { return JSON.parse(fs.readFileSync(pidsFile(), 'utf8')) } catch { return null }
}

export const WINDOWS_FIREWALL_LINE = `New-NetFirewallRule -DisplayName "Oasis party" -Direction Inbound -Protocol TCP -LocalPort ${PARTY_PUBLIC_PORT} -RemoteAddress LocalSubnet -Action Allow; New-NetFirewallRule -DisplayName "Oasis party discovery" -Direction Inbound -Protocol UDP -LocalPort 4599 -RemoteAddress LocalSubnet -Action Allow`

export function partyHostState(): PartyHostState {
  const reason = cannotHostReason()
  const dir = appDir()
  const hostingAvailable = fs.existsSync(path.join(dir, 'scripts', 'party-server.mjs')) && fs.existsSync(path.join(dir, 'packages', 'oasis-room-server'))
  const pids = readPids()
  const running = Boolean(pids && alive(pids.launcher))
  return {
    running,
    ...(running ? { url: pids?.url, host: pids?.host, startedAt: pids?.startedAt } : {}),
    canHost: !reason,
    hostingAvailable,
    ...(reason ? { reason } : {}),
    ...(process.platform === 'win32' ? { firewallLine: WINDOWS_FIREWALL_LINE } : {}),
  }
}

const cleanName = (value: unknown): string =>
  (typeof value === 'string' ? value : '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40)

export function startParty(opts: { hostName: unknown; paidSpells?: boolean }): PartyHostState {
  const state = partyHostState()
  if (state.running || !state.canHost) return state
  const dir = partyDataDir()
  fs.mkdirSync(dir, { recursive: true })
  const log = fs.openSync(path.join(dir, 'party.log'), 'a')
  const child = spawn(process.execPath, [path.join(appDir(), 'scripts', 'party-server.mjs')], {
    cwd: appDir(),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PARTY_APP: appDir(),
      PARTY_DATA_DIR: dir,
      PARTY_DATABASE: path.join(dir, 'party.db'),
      PARTY_HOST_NAME: cleanName(opts.hostName) || os.userInfo().username,
      PARTY_PORT: String(PARTY_PUBLIC_PORT),
      PARTY_WEB_PORT: String(PARTY_WEB_PORT),
      PARTY_ROOM_PORT: String(PARTY_ROOM_PORT),
      PARTY_SPELLS: opts.paidSpells ? '1' : '',
    },
  })
  child.unref()
  fs.closeSync(log)
  return { ...partyHostState(), running: true }
}

export function stopParty(): PartyHostState {
  const pids = readPids()
  for (const pid of [pids?.page, pids?.room, pids?.launcher]) {
    if (alive(pid)) { try { process.kill(pid as number) } catch { /* gone */ } }
  }
  try { fs.unlinkSync(pidsFile()) } catch { /* gone */ }
  return { ...partyHostState(), running: false }
}
