#!/usr/bin/env node
// ░▒▓ THE PARTY SERVER ▓▒░  friends on the same Wi-Fi in one Oasis world, building together.
//
//   node scripts/party-server.mjs            (Ctrl+C stops all three parts)
//
// Three parts, and only the first is reachable from the network (plus the discovery answer, UDP 4599):
//   1. a proxy on <this PC's Wi-Fi address>:4680 (PARTY_PORT)   pages + a short list of world APIs + the room
//      socket (/rooms) + one profile per guest
//   2. a page server (next start) on 127.0.0.1:4602 (PARTY_WEB_PORT)   an installed Oasis's build (PARTY_APP) with
//      its own database holding one world (PARTY_DATABASE: created and seeded on first start), its own data folder,
//      no API keys (unless PARTY_SPELLS=1), no agent engine, agent routes off (OASIS_LAN=1)
//   3. the Colyseus room server on 127.0.0.1:4603 (PARTY_ROOM_PORT)   live avatars and world changes; it loads and
//      saves the world through part 2, never through this machine's own Oasis
// Started by hand, or from the World menu's "Host a party on this Wi-Fi" (src/lib/party/host.ts).
// Builds before 22 Nov 19:30 dial the room on the default port, so tonight's first party ran on 80 (PARTY_PORT=80).

import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import dgram from 'node:dgram'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The installed Oasis to serve: by default the one this launcher belongs to.
const APP = path.resolve(process.env.PARTY_APP || REPO)
// The party's own data (guests, budget, its folder and database): the same place the World menu uses.
const DATA_DIR = path.resolve(process.env.PARTY_DATA_DIR || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'party'))
// 4680: any user may open it (80 needs root on macOS and Linux; 4600 is a packaged copy's page). Tonight's first party ran on 80.
const PUBLIC_PORT = Number(process.env.PARTY_PORT || 4680)
const HOST_NAME = (process.env.PARTY_HOST_NAME || os.userInfo().username || 'Someone').replace(/[<>\u0000-\u001f]/g, '').slice(0, 40)
/** Set when the party runs from an ordinary install (World menu > Host a party): its own sandbox database here. */
const PARTY_DATABASE = process.env.PARTY_DATABASE ? path.resolve(process.env.PARTY_DATABASE) : null
const DISCOVERY_PORT = Number(process.env.PARTY_DISCOVERY_PORT || 4599)
/** Where the party's page server runs: its own folder for an install's party, so nothing of the host's is in reach. */
let PARTY_DIR = APP
const PARTY_QUERY = 'OASIS-PARTY?1'
const WEB_PORT = Number(process.env.PARTY_WEB_PORT || 4602)
const ROOM_PORT = Number(process.env.PARTY_ROOM_PORT || 4603)
const DEAD = 'http://127.0.0.1:9' // where anything that looks for the agent engine is sent: nothing answers

/** This PC's address on the local network (Wi-Fi first), read now: it changes between networks. */
export function lanAddress() {
  if (process.env.PARTY_HOST) return process.env.PARTY_HOST
  const nets = os.networkInterfaces()
  const candidates = []
  for (const [name, list] of Object.entries(nets)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue
      candidates.push({ name, address: a.address, wifi: /wi-?fi|wlan|wireless/i.test(name) })
    }
  }
  candidates.sort((a, b) => Number(b.wifi) - Number(a.wifi))
  return candidates[0]?.address || null
}

// ─── THE DOORMAN'S LIST: every API a guest's browser may call, with its methods and what it can touch ──────
// Everything else under /api answers 403. Pages and the build's files pass. In an install's party (PARTY_DATABASE)
// "party" below means the party's own folder (prepareIsolatedApp): its database, data/ and generated files, never
// the host's. Read: GET/HEAD. Paid spells only with PARTY_SPELLS=1, under the budget below.
export const API_ALLOW = [
  { route: 'health', methods: ['GET'], touches: 'nothing (up or not)' },
  { route: 'session', methods: ['GET', 'POST'], touches: 'a session cookie for this browser' },
  { route: 'profile', methods: ['GET', 'PATCH'], touches: 'answered by the doorman: this guest\'s name and body (party-guests.json)' },
  { route: 'profile/avatar3d', methods: ['POST'], touches: 'answered by the doorman: a gallery body for this guest; uploads refused' },
  { route: 'player', methods: ['GET', 'POST'], touches: 'party database: progression of the one shared local player' },
  { route: 'xp', methods: ['GET', 'POST'], touches: 'party database: XP' },
  { route: 'stats', methods: ['GET'], touches: 'party database: counts' },
  { route: 'analytics', methods: ['POST'], touches: 'party data/: event counters' },
  { route: 'viewer', methods: ['GET'], touches: 'nothing (who is this browser)' },
  { route: 'pricing', methods: ['GET'], touches: 'nothing (static prices)' },
  { route: 'avatars', methods: ['GET'], touches: 'the install\'s avatar gallery (read)' },
  { route: 'avatar-thumbs', methods: ['GET', 'POST', 'PUT'], touches: 'party public/avatars/gallery/thumbs (a copy)' },
  { route: 'catalog', methods: ['GET', 'PUT'], touches: 'party public/thumbs (a copy of the catalog pictures)' },
  { route: 'portal-thumbnails', methods: ['GET', 'POST'], touches: 'party public/portal-thumbs (a copy)' },
  { route: 'library/list', methods: ['GET'], touches: 'party data/: the party\'s own conjured and crafted things' },
  { route: 'terrain', methods: ['GET', 'POST', 'PUT'], touches: 'party database: the party world\'s ground' },
  { route: 'worlds', methods: ['GET', 'POST', 'PUT', 'PATCH'], touches: 'party database: worlds (no deleting)' },
  { route: 'world-active', methods: ['GET', 'POST'], touches: 'party prisma/data: which party world is open' },
  { route: 'world-events', methods: ['GET'], touches: 'nothing (a stream of the party world\'s changes)' },
  { route: 'presence', methods: ['GET', 'POST'], touches: 'memory: who is here' },
  { route: 'rooms', methods: ['GET', 'POST'], touches: 'nothing (a pass for the room server)' },
  { route: 'mcp/oasis', methods: ['GET', 'POST', 'DELETE'], touches: 'the party world only: tools on MCP_ALLOWED, the rest refused' },
  // Paid spells (PARTY_SPELLS=1), budget and one-at-a-time per guest below.
  ...(process.env.PARTY_SPELLS === '1' ? [
    { route: 'imagine', methods: ['GET', 'POST'], touches: 'party public/generated-images; OpenRouter on the host\'s key' },
    { route: 'conjure', methods: ['GET', 'POST', 'PATCH', 'DELETE'], touches: 'party data/conjured-registry.json and public/conjured; Tripo on the host\'s key' },
    { route: 'media/music', methods: ['GET', 'POST'], touches: 'party public/generated-music; ElevenLabs on the host\'s key' },
    { route: 'media/list', methods: ['GET'], touches: 'party public/images (the party\'s own media)' },
    { route: 'craft', methods: ['POST'], exact: true, touches: 'nothing stored; OpenRouter on the host\'s key (never Claude Code)' },
    { route: 'craft/stream', methods: ['POST'], touches: 'nothing stored; OpenRouter on the host\'s key (never Claude Code)' },
    { route: 'craft/thumbnail', methods: ['PUT', 'POST'], touches: 'party public/crafted-thumbs' },
  ] : []),
]
export function apiAllowed(pathname, method = 'GET') {
  if (!pathname.startsWith('/api/')) return true
  if (pathname === '/api/keys/status') return method === 'GET' // answered by the doorman (yes or no per spell)
  const rest = pathname.slice(5)
  const m = method === 'HEAD' ? 'GET' : method
  // The most specific entry decides (profile/avatar3d before profile; profile/avatar, the 2D upload, is on none).
  const entry = API_ALLOW
    .filter(e => rest === e.route || (!e.exact && rest.startsWith(`${e.route}/`)))
    .sort((x, y) => y.route.length - x.route.length)[0]
  if (!entry) return false
  if (entry.route === 'profile' && rest !== 'profile') return false
  return entry.methods.includes(m)
}

/** A clean environment: no keys or tokens from this shell reach the party. */
function cleanEnv(extra) {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP',
    'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE', 'ProgramFiles', 'ProgramData', 'LANG']
  const env = {}
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]
  // The page server's own home: not the owner's ~/.oasis.
  env.USERPROFILE = DATA_DIR
  env.APPDATA = path.join(DATA_DIR, 'AppData', 'Roaming')
  env.LOCALAPPDATA = path.join(DATA_DIR, 'AppData', 'Local')
  return { ...env, ...extra }
}

function run(name, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const tag = `[${name}]`
  child.stdout.on('data', d => process.stdout.write(String(d).split('\n').filter(Boolean).map(l => `${tag} ${l}\n`).join('')))
  child.stderr.on('data', d => process.stderr.write(String(d).split('\n').filter(Boolean).map(l => `${tag} ${l}\n`).join('')))
  child.on('exit', code => { console.log(`${tag} stopped (${code})`); shutdown(1) })
  return child
}

const children = []
let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) { try { c.kill() } catch { /* gone */ } }
  setTimeout(() => process.exit(code), 500)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// ─── the paid spells: the owner's keys, a budget for the evening, one spell at a time per guest ─────

const SPELLS_ON = process.env.PARTY_SPELLS === '1'
let spellKeys = {}
/** Only the keys these spells need, read from the workshop's .env at start; never written anywhere. */
const SPELL_KEYS = ['OPENROUTER_API_KEY', 'MESHY_API_KEY', 'TRIPO_API_KEY', 'ELEVENLABS_API_KEY']
function readSpellKeys() {
  const out = {}
  try {
    const text = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
    for (const key of SPELL_KEYS) {
      const m = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(text)
      if (m && m[1].trim()) out[key] = m[1].trim()
    }
  } catch { /* no .env: no spells */ }
  return out
}

export const BUDGET = {
  picture: { cap: Number(process.env.PARTY_CAP_PICTURES || 40), label: 'pictures' },
  model: { cap: Number(process.env.PARTY_CAP_MODELS || 15), label: '3D models' },
  character: { cap: Number(process.env.PARTY_CAP_CHARACTERS || 10), label: 'characters' },
  music: { cap: Number(process.env.PARTY_CAP_MUSIC || 10), label: 'music clips' },
  process: { cap: Number(process.env.PARTY_CAP_PROCESS || 20), label: 'rigging and texturing' },
  craft: { cap: Number(process.env.PARTY_CAP_CRAFT || 60), label: 'crafted scenes' },
}
const SPEND_FILE = path.join(DATA_DIR, 'party-spend.json')
let spend = {}
try { spend = JSON.parse(fs.readFileSync(SPEND_FILE, 'utf8')) } catch { spend = {} }
const saveSpend = () => { try { fs.writeFileSync(SPEND_FILE, JSON.stringify(spend, null, 2)) } catch { /* next time */ } }
/** guest → until when they are busy (a 3D job runs on after its request returns). */
const busy = new Map()

const MCP_SPELLS = {
  generate_image: 'picture', text_to_pic: 'picture', text_to_pic_building: 'picture', conjure_framed_picture: 'picture',
  conjure_asset: 'model', process_conjured_asset: 'process', text_to_music: 'music',
}
/** The MCP tools a guest's agent may call: they read or change the party world only. Every other tool is refused. */
export const MCP_ALLOWED = new Set([
  'get_world_state', 'get_world_info', 'query_objects', 'search_assets', 'get_asset_catalog', 'get_craft_guide', 'list_ground_presets',
  'list_avatar_animations', 'place_object', 'modify_object', 'remove_object', 'self_craft_scene', 'set_sky', 'set_ground_preset',
  'paint_ground_tiles', 'add_light', 'modify_light', 'set_behavior', 'create_spatial_web_object', 'walk_avatar_to', 'play_avatar_animation',
])
/** With paid spells on: the spells, and the party's own conjured models (its own registry, never the host's). */
export const MCP_SPELL_TOOLS = new Set(['text_to_pic', 'text_to_pic_building', 'generate_image', 'conjure_framed_picture', 'conjure_asset',
  'process_conjured_asset', 'text_to_music', 'list_conjured_assets', 'get_conjured_asset', 'place_conjured_asset', 'get_craft_job'])
export function mcpToolAllowed(name) {
  return MCP_ALLOWED.has(name) || (process.env.PARTY_SPELLS === '1' && MCP_SPELL_TOOLS.has(name))
}

/** Which budget a request spends, from its route and body; null: free. */
export function spellKind(method, pathname, body) {
  if (method !== 'POST') return null
  if (pathname === '/api/imagine') return 'picture'
  if (pathname === '/api/conjure') return body?.characterMode ? 'character' : 'model'
  if (/^\/api\/conjure\/[^/]+\/process$/.test(pathname)) return 'process'
  if (pathname === '/api/media/music') return 'music'
  if (pathname === '/api/craft' || pathname === '/api/craft/stream') return 'craft'
  if (pathname === '/api/mcp/oasis' && body?.method === 'tools/call') {
    const tool = body?.params?.name
    if (tool === 'conjure_asset' && body?.params?.arguments?.characterMode) return 'character'
    return MCP_SPELLS[tool] || null
  }
  return null
}

function spellPrompt(body) {
  const a = body?.params?.arguments || body || {}
  return String(a.prompt || a.text || a.description || '').replace(/\s+/g, ' ').slice(0, 70)
}

/** Answers here when the spell may not run (budget used up, the guest already casting, a closed tool); else null. */
function spellRefusal(kind, guestKey, body, isMcp) {
  // A batch would carry calls past this check one by one: a party takes one call per request.
  if (isMcp && (Array.isArray(body) || body === null)) return 'At the party, one MCP call per request.'
  if (isMcp && body?.method === 'tools/call' && !mcpToolAllowed(body?.params?.name)) {
    return `${body.params.name} is not available at the party.`
  }
  if (!kind) return null
  if (!SPELLS_ON) return 'Not available at the party.'
  const used = spend[kind] || 0
  if (used >= BUDGET[kind].cap) return `The party's budget for ${BUDGET[kind].label} is used up (${used} of ${BUDGET[kind].cap}).`
  const until = busy.get(guestKey) || 0
  if (kind !== 'process' && until > Date.now()) return 'One spell at a time: your last one is still being made.'
  return null
}

// ─── files made during the party: next start serves only what existed at build time ─────────────
const RUNTIME_DIRS = new Set(['generated-images', 'generated-music', 'conjured', 'thumbs', 'crafted-thumbs', 'images'])
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.json': 'application/json', '.fbx': 'application/octet-stream' }
function serveRuntimeFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  let rel
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, '') } catch { return false }
  if (!RUNTIME_DIRS.has(rel.split('/')[0])) return false
  const root = path.join(PARTY_DIR, 'public')
  const file = path.resolve(root, rel)
  if (!file.startsWith(root + path.sep)) return false
  let stat
  try { stat = fs.statSync(file) } catch { return false }
  if (!stat.isFile()) return false
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' })
  if (req.method === 'HEAD') { res.end(); return true }
  fs.createReadStream(file).pipe(res)
  return true
}

// ─── a profile per guest: a cookie names the guest, their name and avatar live here ───────────────

const GUEST_COOKIE = 'party_guest'
const GUESTS_FILE = path.join(DATA_DIR, 'party-guests.json')
let guests = {}
try { guests = JSON.parse(fs.readFileSync(GUESTS_FILE, 'utf8')) } catch { guests = {} }
let saveTimer = null
function saveGuests() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; try { fs.writeFileSync(GUESTS_FILE, JSON.stringify(guests, null, 2)) } catch { /* next time */ } }, 500)
}

export function guestOf(req) {
  const raw = req.headers.cookie || ''
  const match = raw.match(new RegExp(`(?:^|;\\s*)${GUEST_COOKIE}=([a-z0-9]{8,32})`))
  if (match) return { id: match[1], fresh: false }
  return { id: Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8), fresh: true }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function upstreamJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: WEB_PORT, path: pathname, headers: { host: `127.0.0.1:${WEB_PORT}` } }, up => {
      let s = ''
      up.on('data', d => { s += d })
      up.on('end', () => { try { resolve(JSON.parse(s)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

function sendJson(res, status, body, extra) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

/** true when answered here. GET /api/profile is the shared one with this guest's name and avatar on top. */
async function guestProfile(req, res, pathname, guestId, cookie) {
  const g = guests[guestId] || {}
  const overlay = async () => {
    const shared = await upstreamJson('/api/profile')
    return { ...shared, displayName: g.displayName || `Guest ${guestId.slice(0, 4).toUpperCase()}`, ...(g.avatar3dUrl ? { avatar_3d_url: g.avatar3dUrl } : {}) }
  }
  if (pathname === '/api/profile' && req.method === 'GET') { sendJson(res, 200, await overlay(), cookie); return true }
  if (pathname === '/api/profile' && req.method === 'PATCH') {
    const body = JSON.parse(await readBody(req) || '{}')
    const name = typeof body.display_name === 'string' ? body.display_name.replace(/[<>]/g, '').trim().slice(0, 30) : ''
    if (name.length >= 2) { guests[guestId] = { ...g, displayName: name }; saveGuests() }
    Object.assign(g, guests[guestId] || {})
    sendJson(res, 200, await overlay(), cookie)
    return true
  }
  if (pathname === '/api/profile/avatar3d' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 12 * 1024 * 1024) || '{}')
    if (body.urlType === 'remove') { const { avatar3dUrl: _gone, ...rest } = g; guests[guestId] = rest; saveGuests(); sendJson(res, 200, { avatar_3d_url: (await upstreamJson('/api/profile')).avatar_3d_url }, cookie); return true }
    if (body.urlType !== 'localPath' || typeof body.url !== 'string' || !body.url.startsWith('/avatars/') || body.url.includes('..')) {
      sendJson(res, 400, { error: 'At the party, pick an avatar from the gallery.' }, cookie)
      return true
    }
    guests[guestId] = { ...g, avatar3dUrl: body.url }
    saveGuests()
    sendJson(res, 200, { avatar_3d_url: body.url }, cookie)
    return true
  }
  return false
}

function startProxy(host) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://party')
    if (!apiAllowed(url.pathname, req.method)) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not available at the party.' }))
      return
    }
    const { id: guestId, fresh } = guestOf(req)
    const cookie = fresh ? { 'set-cookie': `${GUEST_COOKIE}=${guestId}; Path=/; Max-Age=31536000; SameSite=Lax` } : {}
    // http://<host>/?name=Alice: the guest's name (the Character menu has no name field).
    const wanted = url.pathname === '/' ? (url.searchParams.get('name') || '').replace(/[<>]/g, '').trim().slice(0, 30) : ''
    if (wanted.length >= 2) { guests[guestId] = { ...(guests[guestId] || {}), displayName: wanted }; saveGuests() }
    const avatar = url.pathname === '/' ? (url.searchParams.get('avatar') || '') : ''
    if (avatar.startsWith('/avatars/') && !avatar.includes('..') && avatar.length < 200) { guests[guestId] = { ...(guests[guestId] || {}), avatar3dUrl: avatar }; saveGuests() }
    // The page knows it is a party (World menu: "Back to my Oasis") from this cookie.
    const partyCookie = `oasis_party=${encodeURIComponent(HOST_NAME)}; Path=/; SameSite=Lax`
    // The packaged build is the village edition; at the party everyone gets the plain world.
    if (url.pathname === '/' && (!url.searchParams.has('profile') || wanted || avatar)) {
      res.writeHead(302, { location: '/?profile=local', 'set-cookie': [partyCookie, ...(cookie['set-cookie'] ? [cookie['set-cookie']] : [])] })
      res.end()
      return
    }
    // Each guest has their own name and avatar (the page server has one shared local profile).
    if (url.pathname === '/api/profile' || url.pathname === '/api/profile/avatar3d') {
      try {
        if (await guestProfile(req, res, url.pathname, guestId, cookie)) return
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e?.message || e) }))
        return
      }
    }
    // The page asks this every few seconds for agents' screenshot requests; no party tool can ask for one.
    if (url.pathname === '/api/oasis-tools' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJson(res, 200, { tools: [], screenshotPending: false, screenshotRequest: null }, cookie)
      return
    }
    // Which spells work here: yes or no per spell, never a key (the page server's own answer is loopback-only).
    if (url.pathname === '/api/keys/status') {
      const has = k => SPELLS_ON && Boolean(spellKeys[k])
      const state = (ready, name, service, keychainKey) => ({ ready, line: ready ? '' : `${name} is not available at the party.`, keychainKey })
      sendJson(res, 200, { features: {
        'text-to-pic': state(has('OPENROUTER_API_KEY'), 'Text to Pic', 'OpenRouter', 'openrouter'),
        'text-to-pic-building': state(has('OPENROUTER_API_KEY'), 'Text to Pic Building', 'OpenRouter', 'openrouter'),
        'text-to-3d': state(has('MESHY_API_KEY') || has('TRIPO_API_KEY'), 'Text to 3D', 'Meshy or Tripo', 'meshy'),
        'text-to-music': state(has('ELEVENLABS_API_KEY'), 'Text to Music', 'ElevenLabs', 'elevenlabs'),
        'text-to-video': state(false, 'Text to Video', 'fal.ai', 'fal'),
      } }, cookie)
      return
    }
    if (serveRuntimeFile(req, res, url.pathname)) return

    // A paid spell (or an MCP call): read the body, check the budget and the guest, log, then pass it on.
    const isMcp = url.pathname === '/api/mcp/oasis'
    const maybeSpell = req.method === 'POST' && (isMcp || url.pathname === '/api/imagine' || url.pathname === '/api/conjure' || url.pathname === '/api/media/music' || url.pathname === '/api/craft' || url.pathname === '/api/craft/stream' || /^\/api\/conjure\/[^/]+\/process$/.test(url.pathname))
    let bodyBuf = null
    let kind = null
    let guestKey = guestId
    if (maybeSpell) {
      try { bodyBuf = Buffer.from(await readBody(req, 16 * 1024 * 1024)) } catch { sendJson(res, 413, { error: 'Too large.' }, cookie); return }
      let body = null
      try { body = JSON.parse(bodyBuf.toString('utf8') || 'null') } catch { body = null }
      kind = spellKind(req.method, url.pathname, body)
      // 3D at the party is Tripo v3.1: the Meshy key is on the free plan (it can no longer create), and Tripo's
      // old "turbo" version is retired (2026-11-22, both answered with errors).
      const tripo = target => { if (target && typeof target === 'object') { target.provider = 'tripo'; if (!['standard', 'premium'].includes(target.tier)) target.tier = 'premium' } }
      if (url.pathname === '/api/conjure' && body) { tripo(body); bodyBuf = Buffer.from(JSON.stringify(body)) }
      // Craft: the spell book's Text to 3D. Its default model is Claude Code on this PC; at the party it is OpenRouter.
      if ((url.pathname === '/api/craft' || url.pathname === '/api/craft/stream') && body) { if (!String(body.model || '').includes('/')) body.model = 'google/gemini-3.8-flash'; bodyBuf = Buffer.from(JSON.stringify(body)) }
      if (isMcp && body?.params?.name === 'conjure_asset' && body.params.arguments) { tripo(body.params.arguments); bodyBuf = Buffer.from(JSON.stringify(body)) }
      if (isMcp) guestKey = `mcp@${req.socket.remoteAddress || '?'}`
      const who = isMcp ? `Claude Code at ${req.socket.remoteAddress}` : (guests[guestId]?.displayName || `Guest ${guestId.slice(0, 4).toUpperCase()}`)
      const refusal = spellRefusal(kind, guestKey, body, isMcp)
      if (refusal) {
        if (kind) console.log(`[spell] refused ${who}: ${kind} (${refusal})`)
        if (isMcp) sendJson(res, 200, { jsonrpc: '2.0', id: body?.id ?? null, result: { content: [{ type: 'text', text: refusal }], isError: true } }, cookie)
        else sendJson(res, 429, { error: refusal }, cookie)
        return
      }
      if (kind) {
        spend[kind] = (spend[kind] || 0) + 1
        saveSpend()
        busy.set(guestKey, Date.now() + (kind === 'model' || kind === 'character' ? 90_000 : 10 * 60_000))
        console.log(`[spell] ${new Date().toLocaleTimeString()} ${who}: ${kind} ${spend[kind]}/${BUDGET[kind].cap} "${spellPrompt(body)}"`)
      }
    }
    const release = (ok) => {
      if (!kind) return
      if (!ok) { spend[kind] = Math.max(0, (spend[kind] || 1) - 1); saveSpend() }
      // Pictures and music are done when the request is; a 3D job keeps its 90 s.
      if (kind !== 'model' && kind !== 'character') busy.delete(guestKey)
    }
    const upstream = http.request({
      host: '127.0.0.1', port: WEB_PORT, method: req.method, path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${WEB_PORT}`, 'x-forwarded-for': req.socket.remoteAddress || '', ...(bodyBuf ? { 'content-length': String(bodyBuf.length) } : {}) },
    }, up => {
      res.writeHead(up.statusCode || 502, { ...up.headers, ...cookie })
      up.pipe(res)
      up.on('end', () => release((up.statusCode || 500) < 400))
    })
    upstream.on('error', () => { release(false); if (!res.headersSent) res.writeHead(502); res.end('The party page server is not up yet.') })
    if (bodyBuf) upstream.end(bodyBuf)
    else req.pipe(upstream)
  })
  // WebSocket upgrades: only the room socket, /rooms/... → the room server without the prefix.
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/'
    if (!url.startsWith('/rooms')) { socket.destroy(); return }
    const target = net.connect(ROOM_PORT, '127.0.0.1', () => {
      const pathPart = url.slice('/rooms'.length) || '/'
      const lines = [`${req.method} ${pathPart} HTTP/${req.httpVersion}`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? `127.0.0.1:${ROOM_PORT}` : req.rawHeaders[i + 1]}`)
      }
      target.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) target.write(head)
      target.pipe(socket)
      socket.pipe(target)
    })
    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
  })
  // Plain HTTP to the room server (matchmaking: /rooms/matchmake/...).
  const roomHttp = (req, res) => {
    const pathPart = (req.url || '/').slice('/rooms'.length) || '/'
    const upstream = http.request({ host: '127.0.0.1', port: ROOM_PORT, method: req.method, path: pathPart, headers: { ...req.headers, host: `127.0.0.1:${ROOM_PORT}` } },
      up => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res) })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(upstream)
  }
  const pageHandler = server.listeners('request')[0]
  server.removeAllListeners('request')
  server.on('request', (req, res) => ((req.url || '').startsWith('/rooms/') ? roomHttp(req, res) : pageHandler(req, res)))
  server.listen(PUBLIC_PORT, host, () => console.log(`[party] guests open http://${host}${PUBLIC_PORT === 80 ? '' : `:${PUBLIC_PORT}`}`))
  server.on('error', e => { console.error(`[party] cannot listen on ${host}:${PUBLIC_PORT}: ${e.message}`); shutdown(1) })
}

/** An install's party gets its own database: created once with the install's Prisma, seeded with its first world. */
// ─── the party's own folder (an install's party) ──────────────────────────────────────────────────────────────────
// The page server works in process.cwd(): data/ (registries, library), prisma/data (the open world), public/ (what
// spells make, uploads, thumbnails). Run from the install, a guest would reach the host's own. So it runs here:
//   own (empty, the party's): data/ (only the catalog's two config files copied in), prisma/data, and in public/
//     conjured, crafted-thumbs, generated-images, generated-music, generated-videos, generated-voices, images, merlin
//   own copies (allowed routes write into them): public/thumbs, public/portal-thumbs, public/avatars/gallery/thumbs
//   linked from the install, read-only for a guest (no allowed route writes there): .next, node_modules, plugins,
//     packages, and every other public/ folder (models, skies, ui, audio, the avatar gallery's bodies, ...)
const PARTY_OWN_DIRS = new Set(['conjured', 'crafted-thumbs', 'generated-images', 'generated-music', 'generated-videos', 'generated-voices', 'images', 'merlin', 'uploads'])
const PARTY_COPIED_DIRS = new Set(['thumbs', 'portal-thumbs'])
const CATALOG_CONFIG = ['asset-catalog-extras.json', 'ground-presets-extras.json']

function linkDir(target, link) {
  // A link from before an update points at the previous app folder (or at nothing, once it is pruned): it is made
  // again to this install's folder. A real folder or file there is left alone.
  let stat = null
  try { stat = fs.lstatSync(link) } catch { /* nothing there */ }
  if (stat && !stat.isSymbolicLink()) return
  if (stat) {
    let current = ''
    try { current = fs.realpathSync(link) } catch { /* dangling */ }
    if (current && path.resolve(current) === path.resolve(fs.realpathSync(target))) return
    try { fs.unlinkSync(link) } catch { fs.rmdirSync(link) }
  }
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

export function prepareIsolatedApp(root = path.join(DATA_DIR, 'app')) {
  fs.mkdirSync(root, { recursive: true })
  for (const dir of ['.next', 'node_modules', 'plugins', 'packages']) {
    if (fs.existsSync(path.join(APP, dir))) linkDir(path.join(APP, dir), path.join(root, dir))
  }
  for (const file of ['package.json', 'next.config.mjs', 'next.config.js']) {
    if (fs.existsSync(path.join(APP, file))) fs.copyFileSync(path.join(APP, file), path.join(root, file))
  }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  for (const file of CATALOG_CONFIG) {
    const from = path.join(APP, 'data', file)
    if (fs.existsSync(from) && !fs.existsSync(path.join(root, 'data', file))) fs.copyFileSync(from, path.join(root, 'data', file))
  }
  fs.mkdirSync(path.join(root, 'prisma', 'data'), { recursive: true })
  if (fs.existsSync(path.join(APP, 'prisma', 'schema.prisma'))) fs.copyFileSync(path.join(APP, 'prisma', 'schema.prisma'), path.join(root, 'prisma', 'schema.prisma'))
  const pub = path.join(root, 'public')
  fs.mkdirSync(pub, { recursive: true })
  for (const entry of fs.readdirSync(path.join(APP, 'public'), { withFileTypes: true })) {
    const from = path.join(APP, 'public', entry.name)
    const to = path.join(pub, entry.name)
    if (!entry.isDirectory()) { if (!fs.existsSync(to)) fs.copyFileSync(from, to); continue }
    if (PARTY_OWN_DIRS.has(entry.name)) { fs.mkdirSync(to, { recursive: true }); continue }
    if (PARTY_COPIED_DIRS.has(entry.name)) { if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true }); continue }
    if (entry.name === 'avatars') {
      // The bodies are read; uploads and the gallery's thumbnails are written: those two are the party's.
      fs.mkdirSync(to, { recursive: true })
      for (const sub of fs.readdirSync(from, { withFileTypes: true })) {
        const subFrom = path.join(from, sub.name)
        const subTo = path.join(to, sub.name)
        if (sub.name === 'gallery' && sub.isDirectory()) {
          fs.mkdirSync(subTo, { recursive: true })
          for (const g of fs.readdirSync(subFrom, { withFileTypes: true })) {
            const gTo = path.join(subTo, g.name)
            if (fs.existsSync(gTo)) continue
            if (g.isDirectory()) { if (g.name === 'thumbs') fs.cpSync(path.join(subFrom, g.name), gTo, { recursive: true }); else linkDir(path.join(subFrom, g.name), gTo) }
            else fs.copyFileSync(path.join(subFrom, g.name), gTo)
          }
        } else if (sub.isDirectory()) {
          fs.mkdirSync(subTo, { recursive: true }) // uploads and the like: the party's own, empty
        }
        // Loose files here are profile photos (local-user.jpg, ...): the host's, never copied. The build ships none.
      }
      continue
    }
    linkDir(from, to)
  }
  console.log(`[party] the party's own folder: ${root}`)
  return root
}

function prepareSandboxDatabase() {
  if (fs.existsSync(PARTY_DATABASE)) return
  fs.mkdirSync(path.dirname(PARTY_DATABASE), { recursive: true })
  const env = { ...process.env, DATABASE_URL: `file:${PARTY_DATABASE.split(path.sep).join('/')}` }
  const prisma = path.join(APP, 'node_modules', 'prisma', 'build', 'index.js')
  const push = spawnSync(process.execPath, [prisma, 'db', 'push', '--skip-generate', '--schema', path.join(APP, 'prisma', 'schema.prisma')], { cwd: APP, env, windowsHide: true, encoding: 'utf8' })
  if (push.status !== 0) { console.error('[party] could not create the party database:', (push.stderr || push.stdout || '').slice(-400)); process.exit(1) }
  const seed = path.join(APP, 'scripts', 'slim', 'seed-first-world.mjs')
  if (fs.existsSync(seed)) spawnSync(process.execPath, [seed], { cwd: APP, env: { ...env, OASIS_SEED_DATABASE_URL: env.DATABASE_URL }, windowsHide: true, stdio: 'inherit' })
  console.log(`[party] a fresh party world in ${PARTY_DATABASE}`)
}

/** The host's Oasis version, for the guests' "versions differ" line. */
function oasisVersion() {
  for (const file of [path.join(APP, 'plugins', 'oasis', 'scripts', 'release.json'), path.join(APP, 'package.json')]) {
    try { const v = JSON.parse(fs.readFileSync(file, 'utf8')).version; if (v) return String(v) } catch { /* next */ }
  }
  return ''
}

/** Answer "OASIS-PARTY?1" on UDP 4599 (src/lib/party/discovery.ts asks it) with who, which world, how many. */
/** Is this address on the same network as the one the party serves? (Questions via WSL/VPN adapters get no answer.) */
function onPartyNetwork(address, host) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.address !== host || !a.netmask) continue
      const n = x => x.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0)
      return ((n(address) & n(a.netmask)) >>> 0) === ((n(host) & n(a.netmask)) >>> 0)
    }
  }
  return false
}

function startDiscoveryAnswer(host) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const version = oasisVersion()
  socket.on('error', e => console.error(`[party] discovery: ${e.message} (friends must type the address)`))
  socket.on('message', async (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== PARTY_QUERY) return
    // Answer only from the address friends can open: a question that came in through another adapter is ignored.
    if (!onPartyNetwork(rinfo.address, host)) return
    let players = 0
    let world = ''
    try { players = (await (await fetch(`http://127.0.0.1:${ROOM_PORT}/health`)).json()).roster?.totalPlayers || 0 } catch { /* 0 */ }
    try {
      const active = await (await fetch(`http://127.0.0.1:${WEB_PORT}/api/world-active`)).json()
      const list = await (await fetch(`http://127.0.0.1:${WEB_PORT}/api/worlds`)).json()
      const worlds = Array.isArray(list) ? list : (list.worlds || [])
      world = worlds.find(w => w.id === active.worldId)?.name || ''
    } catch { /* unnamed */ }
    const answer = Buffer.from(JSON.stringify({ oasisParty: 1, host: HOST_NAME, world, players, address: host, port: PUBLIC_PORT, version, spells: SPELLS_ON }))
    socket.send(answer, rinfo.port, rinfo.address)
  })
  socket.bind(DISCOVERY_PORT, () => console.log(`[party] answering "who has a party?" on UDP ${DISCOVERY_PORT} as ${HOST_NAME}`))
}

function main() {
  const host = lanAddress()
  if (!host) { console.error('[party] no Wi-Fi/LAN address found (set PARTY_HOST)'); process.exit(1) }
  if (!fs.existsSync(path.join(APP, '.next', 'BUILD_ID'))) { console.error(`[party] no built Oasis in ${APP}`); process.exit(1) }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  spellKeys = SPELLS_ON ? readSpellKeys() : {}
  if (SPELLS_ON) console.log(`[party] spells on: ${Object.keys(spellKeys).map(k => k.replace(/_API_KEY|_KEY/, '')).join(', ') || 'no keys found'}; budget ${Object.entries(BUDGET).map(([k, v]) => `${k} ${v.cap}`).join(', ')}`)

  if (PARTY_DATABASE) { prepareSandboxDatabase(); PARTY_DIR = prepareIsolatedApp() }
  const webEnv = cleanEnv({
    NODE_ENV: 'production',
    ...(PARTY_DATABASE ? { DATABASE_URL: `file:${PARTY_DATABASE.split(path.sep).join('/')}` } : {}),
    OASIS_LAN: '1',
    OASIS_DATA_DIR: DATA_DIR,
    OASIS_URL: `http://127.0.0.1:${WEB_PORT}`,
    NEXT_PUBLIC_OASIS_URL: `http://127.0.0.1:${WEB_PORT}`,
    OASIS_ENGINE_HTTP_URL: DEAD,
    OASIS_PORT: '9',
    OASIS_TELEGRAM: '0',
    OASIS_THUMBNAIL_QUEUE: '0',
    ...spellKeys,
  })
  children.push(run('page', process.execPath, [path.join(APP, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(WEB_PORT), '-H', '127.0.0.1'], { cwd: PARTY_DIR, env: webEnv }))

  const roomEnv = cleanEnv({
    OASIS_ROOM_PORT: String(ROOM_PORT),
    OASIS_ROOM_HOST: '127.0.0.1',
    OASIS_WEB_INTERNAL_URL: `http://127.0.0.1:${WEB_PORT}`,
    OASIS_ROOM_MAX_CLIENTS: '12',
    OASIS_ROOM_FRESH_JOIN_SNAPSHOT: '1',
    // Party combat: bolts and the machine gun hit other players, everyone sees the gore, a lethal hit
    // knocks them down for six seconds and they get up where they fell (WorldRoom.ts, PARTY_COMBAT).
    OASIS_ROOM_PARTY_COMBAT: '1',
  })
  // The room server from source (the workshop) or its compiled copy (a release ships packages/oasis-room-server/dist).
  const roomDir = path.join(REPO, 'packages', 'oasis-room-server')
  const tsx = path.join(roomDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const roomArgs = fs.existsSync(tsx) && fs.existsSync(path.join(roomDir, 'src', 'server.ts'))
    ? [tsx, path.join(roomDir, 'src', 'server.ts')]
    : [path.join(roomDir, 'dist', 'server.js')]
  if (!fs.existsSync(roomArgs[roomArgs.length - 1])) { console.error(`[party] no room server in ${roomDir}`); shutdown(1); return }
  children.push(run('room', process.execPath, roomArgs, { cwd: roomDir, env: roomEnv }))

  startProxy(host)
  startDiscoveryAnswer(host)
  // Who to stop (World menu > Stop the party): this launcher and its two servers.
  try { fs.writeFileSync(path.join(DATA_DIR, 'party.pids.json'), JSON.stringify({ launcher: process.pid, page: children[0]?.pid, room: children[1]?.pid, url: `http://${host}${PUBLIC_PORT === 80 ? '' : `:${PUBLIC_PORT}`}`, host: HOST_NAME, startedAt: Date.now() })) } catch { /* the stop button falls back to the ports */ }
  process.on('exit', () => { try { fs.unlinkSync(path.join(DATA_DIR, 'party.pids.json')) } catch { /* gone */ } })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
