#!/usr/bin/env node
// Starts the Oasis on Windows, macOS and Linux: the page server and the agent engine, then the village in
// the browser. One file, no shell needed.
//
//   node scripts/oasis.mjs start [--session <id>]   set up if needed, start what is not running, open the village
//   node scripts/oasis.mjs setup                    install packages, make the database, build (first run)
//   node scripts/oasis.mjs open                     open the village in the default browser, with the local key
//   node scripts/oasis.mjs link                     put the village's address with the key on the clipboard, for
//                                                   another browser on this machine (never printed)
//   node scripts/oasis.mjs update                   a git clone: git pull, then start (it rebuilds); a plugin
//                                                   install updates with /oasis update in Claude Code
//   node scripts/oasis.mjs status                   what is running
//   node scripts/oasis.mjs stop                     stop what `start` started (never anything else)
//
// Either server that is already listening is left alone, so running it twice is harmless.
//
// Settings (environment):
//   OASIS_WEB_PORT   the page server's port (default 4516)
//   OASIS_PORT       the agent engine's port (default 4530)
//   OASIS_NO_OPEN=1  do not open the browser
//   OASIS_REQUIRE_TOKEN  1: both servers ask for the local key (always so in the slim edition); 0: never
//   OASIS_TOKEN_FILE     where the key is kept (default ~/.oasis/token)
//   OASIS_PNPM       the pnpm command to use (default: pnpm, else corepack's, else `npx pnpm@<pinned>`)
//
// Two editions run from this one file:
//   - the workshop (a full checkout): `next dev`, exactly what `pnpm dev` + `pnpm dev:engine` do;
//   - the slim Oasis (a cut made by scripts/cut-slim.mjs, marked by a `.oasis-slim` file): built once with
//     `next build`, then `next start`.
// Exit codes: 0 fine, 3 the page server did not come up in time, 6 setup failed.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_PORT = Number(process.env.OASIS_WEB_PORT || 4516)
const ENGINE_PORT = Number(process.env.OASIS_PORT || 4530)
const SLIM = fs.existsSync(path.join(HOME, '.oasis-slim'))
const PNPM_VERSION = '10.26.0'
const LOGS = path.join(HOME, 'logs')
const RUN_FILE = path.join(HOME, 'data', 'oasis-run.local.json')
const FIRST_RUN_FILE = path.join(HOME, 'data', 'first-run.local.json')
const WAIT_MS = Number(process.env.OASIS_WAIT_MS || 150_000)
const WIN = process.platform === 'win32'
const STARTED_AT = Date.now()
let firstStart = false
let update = null
let rolledBack = false

const say = (line) => process.stdout.write(`${line}\n`)
const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '')

export function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (open) => { socket.destroy(); resolve(open) }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForPort(port, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true
    await sleep(500)
  }
  return false
}

/** Runs a command to the end, showing its output, without blocking: the progress lines keep coming while a long step runs. `.cmd` shims on Windows need a shell; the arguments are fixed. */
function runAsync(command, argv, options = {}) {
  const shell = WIN && !/\.exe$/i.test(command) && command !== process.execPath
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd: HOME, stdio: 'inherit', windowsHide: true, shell, ...options })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

// ── the first start's progress ─────────────────────────────────────────────────────────────────────────────
// A first start takes minutes (about 4 to 5 on a Windows laptop, 7 to 8 on GitHub's clean Mac). Without a word for
// minutes a person, or the agent that runs this for them, thinks it hung. So: the steps up front, one line per step,
// and a line every 25 seconds while a long one runs, each with about how long is left.
/** Typical seconds per step, measured in clean installs (Windows, GitHub's Apple Silicon Mac), Nov 2026. */
export const STEP_SECONDS = { packages: 90, client: 15, migrate: 10, database: 20, party: 10, build: process.platform === 'darwin' ? 300 : 200 }
const STEP_WORDS = {
  packages: 'installing the packages',
  client: 'preparing the database client',
  migrate: 'bringing your database up to this version (a copy of it is kept first)',
  database: 'creating the database and the first worlds',
  party: 'installing the party server',
  build: 'building the Oasis',
}
const TICK_MS = Number(process.env.OASIS_TICK_MS || 25_000)

export function aboutTime(seconds) {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`
}

export function minSec(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m} min ${s} s` : `${s} s`
}

/** Seconds left: what is usually left of this step (at least a quarter of it) and the steps after it. */
export function secondsLeft(plan, index, elapsedInStep) {
  const current = STEP_SECONDS[plan[index]] || 30
  const rest = plan.slice(index + 1).reduce((sum, name) => sum + (STEP_SECONDS[name] || 30), 0)
  return Math.max(current * 0.25, current - elapsedInStep) + rest
}

/** One step of the plan: its line, a line every 25 seconds while it runs, then its result. */
async function step(plan, name, work) {
  const index = plan.indexOf(name)
  const began = Date.now()
  say(`Step ${index + 1} of ${plan.length}: ${STEP_WORDS[name]} (${aboutTime(secondsLeft(plan, index, 0))} left in all) ...`)
  const timer = setInterval(() => {
    const elapsed = (Date.now() - began) / 1000
    const late = elapsed > (STEP_SECONDS[name] || 30) * 1.5
    say(`  ... step ${index + 1} of ${plan.length}, ${STEP_WORDS[name]}: ${minSec(elapsed)} so far, ${late ? 'longer than usual, still working' : `${aboutTime(secondsLeft(plan, index, elapsed))} left in all`}`)
  }, TICK_MS)
  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}

function works(command, argv) {
  const shell = WIN && !/\.exe$/i.test(command)
  return spawnSync(command, argv, { stdio: 'ignore', windowsHide: true, shell }).status === 0
}

/** The version a command answers to --version, or '' when it is not there. */
function versionOf(command) {
  const shell = WIN && !/\.exe$/i.test(command)
  const r = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true, shell })
  return r.status === 0 ? String(r.stdout || '').trim().split(/\s+/).pop() : ''
}

/**
 * Which pnpm installs the packages, and why (pure, tested). The PATH's pnpm only when its major version is the
 * pinned one: a newer major reads the project's settings differently (pnpm 11 ignores package.json's "pnpm" field,
 * so its first install stops on ERR_PNPM_IGNORED_BUILDS; the owner's second laptop, 26 Nov). Otherwise corepack's
 * pinned pnpm, else the pinned one through npx. OASIS_PNPM overrides all of it.
 */
export function choosePnpm({ override = '', pathVersion = '', corepack = false, pinned = PNPM_VERSION } = {}) {
  const major = (v) => String(v).split('.')[0]
  // split into words: Mac and Linux spawn without a shell, so "corepack pnpm@10.26.0" must be a program and its argument
  if (override.trim()) return { argv: override.trim().split(/\s+/), label: override.trim(), why: 'OASIS_PNPM is set' }
  if (pathVersion && major(pathVersion) === major(pinned)) return { argv: ['pnpm'], label: `pnpm ${pathVersion}`, why: 'the pnpm on the PATH' }
  const other = pathVersion ? `the PATH has pnpm ${pathVersion}, not ${major(pinned)}.x` : 'no pnpm on the PATH'
  if (corepack) return { argv: ['corepack', `pnpm@${pinned}`], label: `pnpm ${pinned}`, why: `${other}; using pnpm ${pinned} through corepack` }
  return { argv: ['npx', '--yes', `pnpm@${pinned}`], label: `pnpm ${pinned}`, why: `${other}; using pnpm ${pinned} through npx` }
}

let chosenPnpm = null
/** pnpm as [command, ...leading args], chosen once per run (choosePnpm), with one line saying which and why. */
function pnpm() {
  if (!chosenPnpm) {
    chosenPnpm = choosePnpm({ override: process.env.OASIS_PNPM || '', pathVersion: versionOf('pnpm'), corepack: works('corepack', ['--version']) })
    say(`Packages: ${chosenPnpm.label} (${chosenPnpm.why}).`)
  }
  return chosenPnpm.argv
}

/** pnpm's environment for an install nobody may be asked anything in (an agent has no terminal): it never stops to confirm removing node_modules. */
const PNPM_QUIET_ENV = () => ({ ...process.env, CI: 'true', npm_config_confirm_modules_purge: 'false', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' })

const bin = (...parts) => path.join(HOME, 'node_modules', ...parts)

/** Where Prisma keeps the SQLite file: DATABASE_URL is relative to prisma/schema.prisma. */
export function databaseFile(envText) {
  const match = /^\s*DATABASE_URL\s*=\s*"?file:([^"\r\n]+)"?/m.exec(envText || '')
  const rel = match ? match[1].trim() : './data/oasis.db'
  return path.isAbsolute(rel) ? rel : path.join(HOME, 'prisma', rel)
}

function readEnvFile() {
  try { return fs.readFileSync(path.join(HOME, '.env'), 'utf8') } catch { return '' }
}

// ── updates: what was built from what ─────────────────────────────────────────────────────────────────────
// A git pull, or a new release unpacked by the plugin, changes the source under a finished build. Without a record
// of what the build was made from, the old page kept being served (Hustler, 24 Nov). So the build leaves a stamp:
// the version and a fingerprint of everything it was made from; the packages leave the lockfile's hash.
const SOURCE_STAMP = path.join(HOME, '.next', 'oasis-source.json')
const PREVIOUS_BUILD = path.join(HOME, '.next-previous')

/** The version this copy of the Oasis is (its release file), or ''. */
export function oasisVersion(home = HOME) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'oasis', 'scripts', 'release.json'), 'utf8')).version || '' } catch { return '' }
}

function fileSha1(file) {
  try { return createHash('sha1').update(fs.readFileSync(file)).digest('hex') } catch { return '' }
}

function listFiles(dir) {
  const out = []
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

/** Everything the page's build is made from, and the engine port it is built for. */
export function sourceFingerprint(home = HOME, enginePort = ENGINE_PORT) {
  const hash = createHash('sha1').update(`engine:${enginePort}\n`)
  const files = [...listFiles(path.join(home, 'src')), ...['package.json', 'pnpm-lock.yaml', 'next.config.mjs', 'tsconfig.json',
    'tailwind.config.js', 'postcss.config.js', 'instrumentation.ts', 'prisma/schema.prisma', '.env.production'].map((f) => path.join(home, f))]
  for (const file of files) {
    let data
    try { data = fs.readFileSync(file) } catch { continue }
    hash.update(path.relative(home, file).split(path.sep).join('/')).update('\0').update(data).update('\0')
  }
  return hash.digest('hex')
}

function readStamp() {
  try { return JSON.parse(fs.readFileSync(SOURCE_STAMP, 'utf8')) } catch { return null }
}

/** The database was last brought up to which schema (a stamp beside it); a missing stamp counts as different. */
function schemaPushNeeded() {
  const db = databaseFile(readEnvFile())
  const now = fileSha1(path.join(HOME, 'prisma', 'schema.prisma'))
  let seen = ''
  try { seen = fs.readFileSync(`${db}.schema.sha1`, 'utf8').trim() } catch { /* never stamped */ }
  return Boolean(now) && seen !== now
}

const stampFile = (dir, name) => path.join(dir, 'node_modules', `.oasis-${name}.sha1`)
/** true when this folder's lockfile (or the database schema) is not what its packages were installed from. */
function stale(dir, name, source) {
  const now = fileSha1(source)
  if (!now) return false
  let seen = ''
  try { seen = fs.readFileSync(stampFile(dir, name), 'utf8').trim() } catch { /* never stamped: an install from before stamps */ }
  return seen !== now
}
function stamp(dir, name, source) {
  const now = fileSha1(source)
  if (now && fs.existsSync(path.join(dir, 'node_modules'))) fs.writeFileSync(stampFile(dir, name), now)
}

/**
 * Room for the build. Node gives itself about a quarter of the machine's memory by default, and the build needs
 * more than 2 GB: on a Mac with 7 or 8 GB (GitHub's own Macs, a base MacBook Air) it ran out of memory twice and
 * stopped. 60% of the memory, at most 4 GB (what builds it on bigger machines), unless the caller set a size.
 */
export function buildNodeOptions(current = process.env.NODE_OPTIONS || '', totalBytes = os.totalmem()) {
  if (/--max-old-space-size/.test(current)) return current
  const mb = Math.min(4096, Math.max(2048, Math.floor((totalBytes / 1048576) * 0.6)))
  return `${current} --max-old-space-size=${mb}`.trim()
}

const roomDir = () => path.join(HOME, 'packages', 'oasis-room-server')
const roomNeedsPackages = () => SLIM && fs.existsSync(path.join(roomDir(), 'pnpm-lock.yaml')) && !fs.existsSync(path.join(roomDir(), 'node_modules', 'tsx', 'package.json'))

/** The steps a first start still has to take, in order (each is skipped once done). */
function setupPlan(fingerprint = SLIM ? sourceFingerprint() : '') {
  const plan = []
  const packages = !fs.existsSync(bin('next', 'package.json')) || (SLIM && stale(HOME, 'lock', path.join(HOME, 'pnpm-lock.yaml')))
  if (packages) plan.push('packages')
  if (packages || !fs.existsSync(bin('.prisma', 'client', 'index.js')) || (SLIM && stale(HOME, 'schema', path.join(HOME, 'prisma', 'schema.prisma')))) plan.push('client')
  if (!fs.existsSync(databaseFile(readEnvFile()))) plan.push('database')
  else if (SLIM && schemaPushNeeded()) plan.push('migrate')
  if (roomNeedsPackages() || (SLIM && fs.existsSync(path.join(roomDir(), 'node_modules')) && stale(roomDir(), 'lock', path.join(roomDir(), 'pnpm-lock.yaml')))) plan.push('party')
  if (SLIM && (!fs.existsSync(path.join(HOME, '.next', 'BUILD_ID')) || readStamp()?.fingerprint !== fingerprint)) plan.push('build')
  return plan
}

/** An update: a build exists (or the plugin says it is updating) and the plan rebuilds. From which version to which. */
function updateFrom(plan) {
  if (!SLIM || !plan.includes('build')) return null
  const from = process.env.OASIS_UPDATE_FROM || (fs.existsSync(path.join(HOME, '.next', 'BUILD_ID')) ? (readStamp()?.version || 'an earlier version') : '')
  return from ? { from, to: oasisVersion() || 'this version' } : null
}

/** First run: packages, the .env file, the database, and (slim) the build. Each step is skipped once done. */
async function setup() {
  const fingerprint = SLIM ? sourceFingerprint() : ''
  const plan = setupPlan(fingerprint)
  const began = Date.now()
  const done = []
  update = updateFrom(plan)
  firstStart = plan.length > 0 && !update
  if (update) say(update.from === update.to
    ? `Rebuilding the Oasis ${update.to} (its files or its ports changed): ${plan.length} step${plan.length === 1 ? '' : 's'}, ${aboutTime(secondsLeft(plan, 0, 0))} in all.`
    : `Updating the Oasis from ${update.from} to ${update.to}: ${plan.length} step${plan.length === 1 ? '' : 's'}, ${aboutTime(secondsLeft(plan, 0, 0))} in all.`)
  else if (plan.length) say(`First start: ${plan.length} step${plan.length === 1 ? '' : 's'}, ${aboutTime(secondsLeft(plan, 0, 0))} in all. Later starts take seconds.`)
  // Corepack asks before it downloads pnpm; nobody may be there to answer (an agent runs this), so it may not ask.
  process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  if (plan.includes('packages')) {
    const [command, ...lead] = pnpm()
    // The Oasis has no pnpm-workspace.yaml; one here was written by another pnpm (pnpm 11 leaves a stub) and can change the install.
    if (fs.existsSync(path.join(HOME, 'pnpm-workspace.yaml'))) say('Note: a pnpm-workspace.yaml is in this folder; it is not the Oasis\'s own (another pnpm wrote it). If the install fails, delete it and start again.')
    const code = await step(plan, 'packages', () => runAsync(command, [...lead, 'install', '--frozen-lockfile', ...(SLIM ? ['--prod=false'] : [])], { env: PNPM_QUIET_ENV() }))
    if (code !== 0) return fail(`The package install failed (${chosenPnpm.label}: ${chosenPnpm.why}). Next: start again; if it fails the same way, delete the node_modules folder (another pnpm may have made it) and start again, or set OASIS_PNPM="corepack pnpm@${PNPM_VERSION}".`)
    if (SLIM) stamp(HOME, 'lock', path.join(HOME, 'pnpm-lock.yaml'))
    done.push('packages')
  }
  if (!fs.existsSync(path.join(HOME, '.env'))) {
    const lines = ['# Written by scripts/oasis.mjs on first run. Keys are optional; add them here.', 'DATABASE_URL="file:./data/oasis.db"']
    if (SLIM) lines.push('NEXT_PUBLIC_OASIS_PROFILE=village', 'NEXT_PUBLIC_OASIS_EDITION=slim', 'OASIS_EDITION=slim')
    fs.writeFileSync(path.join(HOME, '.env'), `${lines.join('\n')}\n`)
    done.push('.env')
  }
  const prisma = bin('prisma', 'build', 'index.js')
  if (plan.includes('client')) {
    if (await step(plan, 'client', () => runAsync(process.execPath, [prisma, 'generate'])) !== 0) return fail('Preparing the database client failed.')
    if (SLIM) stamp(HOME, 'schema', path.join(HOME, 'prisma', 'schema.prisma'))
    done.push('database client')
  }
  // An existing database is brought up to a changed schema only after a copy of it is kept, and never with
  // --accept-data-loss: Prisma refuses a change that would lose data, and the start stops with what it said.
  if (plan.includes('migrate')) {
    const db = databaseFile(readEnvFile())
    const copy = `${db}.before-${oasisVersion() || 'update'}-${Date.now()}`
    fs.copyFileSync(db, copy)
    const code = await step(plan, 'migrate', () => runAsync(process.execPath, [prisma, 'db', 'push', '--skip-generate']))
    if (code !== 0) return fail(`Your database could not be brought up to this version without losing data, so it was left as it was (a copy is in ${copy}). Nothing else changed in it; report this at https://github.com/Parzival-Moksha/uploader/issues.`)
    fs.writeFileSync(`${db}.schema.sha1`, fileSha1(path.join(HOME, 'prisma', 'schema.prisma')))
    done.push('database update')
  }
  // A new database: created and seeded with the first worlds.
  if (plan.includes('database')) {
    const db = databaseFile(readEnvFile())
    fs.mkdirSync(path.dirname(db), { recursive: true })
    const code = await step(plan, 'database', async () => {
      const pushed = await runAsync(process.execPath, [prisma, 'db', 'push', '--skip-generate'])
      if (pushed !== 0) return pushed
      const seed = path.join(HOME, 'scripts', 'slim', 'seed-first-world.mjs')
      if (fs.existsSync(seed) && (await runAsync(process.execPath, [seed])) !== 0) say('The first world could not be seeded; the Oasis starts with an empty one.')
      return 0
    })
    if (code !== 0) return fail('Creating the database failed.')
    fs.writeFileSync(`${databaseFile(readEnvFile())}.schema.sha1`, fileSha1(path.join(HOME, 'prisma', 'schema.prisma')))
    done.push('database')
  }
  // The party's room server (an experiment: hosted only when the page's local storage has oasis-party-host=1) has packages of its own, from its own lockfile. A failure
  // here leaves everything else working; hosting then says it cannot start.
  if (plan.includes('party')) {
    const [command, ...lead] = pnpm()
    if (await step(plan, 'party', () => runAsync(command, [...lead, 'install', '--frozen-lockfile', '--prod'], { cwd: roomDir(), env: PNPM_QUIET_ENV() })) === 0) { stamp(roomDir(), 'lock', path.join(roomDir(), 'pnpm-lock.yaml')); done.push('party server') }
    else say('The party server packages could not be installed; everything else works, hosting a party does not.')
  }
  if (plan.includes('build')) {
    // The build that runs today stays beside until the new one is built: a failed rebuild gives it back.
    const next = path.join(HOME, '.next')
    const kept = fs.existsSync(path.join(next, 'BUILD_ID'))
    if (kept) {
      fs.rmSync(PREVIOUS_BUILD, { recursive: true, force: true })
      fs.renameSync(next, PREVIOUS_BUILD)
    }
    const build = () => runAsync(process.execPath, [bin('next', 'dist', 'bin', 'next'), 'build'], { env: { ...process.env, ...webEnv(), NODE_OPTIONS: buildNodeOptions() } })
    const code = await step(plan, 'build', async () => {
      if (await build() === 0) return 0
      say('The build failed; trying once more ...')
      return build()
    })
    if (code !== 0) {
      if (kept) {
        fs.rmSync(next, { recursive: true, force: true })
        fs.renameSync(PREVIOUS_BUILD, next)
        say(`The new version did not build (the lines above say why). The build you had is back${readStamp()?.version ? ` (${readStamp().version})` : ''}; the Oasis starts with it.`)
        rolledBack = true
        return true
      }
      return fail('The build failed twice. Look at the lines above for why, and start the Oasis again.')
    }
    fs.writeFileSync(SOURCE_STAMP, JSON.stringify({ version: oasisVersion(), fingerprint, builtAt: new Date().toISOString() }, null, 2))
    fs.rmSync(PREVIOUS_BUILD, { recursive: true, force: true })
    done.push('build')
  }
  if (done.length) say(`Set up: ${done.join(', ')}, in ${minSec((Date.now() - began) / 1000)}.`)
  return true
}

function fail(message) {
  say(message)
  return false
}

/**
 * The local key: made once, kept in a file only its owner can read. Both servers get it and then refuse
 * requests without it; the browser gets it in the address the village is opened with.
 */
const TOKEN_FILE = process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token')
const REQUIRE_TOKEN = process.env.OASIS_REQUIRE_TOKEN === '1' || (SLIM && process.env.OASIS_REQUIRE_TOKEN !== '0')

export function localToken(file = TOKEN_FILE) {
  try {
    const token = fs.readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9_-]{32,}$/.test(token)) return token
  } catch {
    // made below
  }
  const token = randomBytes(32).toString('base64url')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${token}
`, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows: the user's profile folder is already private */ }
  return token
}

const tokenEnv = () => (REQUIRE_TOKEN ? { OASIS_LOCAL_TOKEN: localToken(), OASIS_TOKEN_FILE: TOKEN_FILE } : {})

function webEnv() {
  const env = { OASIS_ENGINE_HTTP_URL: `http://127.0.0.1:${ENGINE_PORT}` }
  if (ENGINE_PORT !== 4530) env.NEXT_PUBLIC_AGENT_ENGINE_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws`
  if (oasisVersion()) env.NEXT_PUBLIC_OASIS_VERSION = oasisVersion()
  if (SLIM) {
    env.NEXT_PUBLIC_OASIS_PROFILE = 'village'
    env.NEXT_PUBLIC_OASIS_EDITION = 'slim'
    env.OASIS_EDITION = 'slim'
  }
  return env
}

/** The engine does not load .env by itself: the few switches a person sets there are handed to it. */
function engineEnvFromFile() {
  const env = SLIM ? { OASIS_EDITION: 'slim' } : {}
  const text = readEnvFile()
  for (const key of ['OASIS_EARS_INSTALL', 'OASIS_LOOKS', 'OASIS_KEEP_API_KEY', 'OASIS_EDITION']) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm').exec(text)
    if (match && process.env[key] === undefined) env[key] = match[1].trim()
  }
  return env
}

function readRun() {
  try { return JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')) } catch { return {} }
}

function writeRun(run) {
  fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true })
  fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2))
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/** Starts a server in the background, with its output in logs/<name>.log. Returns its pid. */
function startServer(name, script, argv, env) {
  fs.mkdirSync(LOGS, { recursive: true })
  const log = fs.openSync(path.join(LOGS, `${name}.log`), 'a')
  const child = spawn(process.execPath, [script, ...argv], {
    cwd: HOME,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  fs.closeSync(log)
  return child.pid
}

function openBrowser(url) {
  if (process.env.OASIS_NO_OPEN) return
  const [command, argv] = WIN
    ? ['cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(command, argv, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: WIN }).unref()
  } catch {
    // no browser opener on this machine: the URL is printed
  }
}

export function villageUrl({ session = '', firstRun = false, port = WEB_PORT, key = '' } = {}) {
  const query = new URLSearchParams({ profile: 'village' })
  if (key) query.set('key', key)
  if (session) query.set('session', session)
  if (firstRun) query.set('firstRun', '1')
  return `http://localhost:${port}/?${query}`
}

/**
 * The last lines of a start: for the person, or for the agent that ran this for them to pass on word for word
 * (a newcomer's agent otherwise guesses: other ports, its own browser, "I can't confirm it's open").
 */
/** Claude Code sessions on this machine (the village brings the newest in on a first run)? A machine with only Codex has none. */
export function hasClaudeSessions(dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) {
  try { return fs.readdirSync(path.join(dir, 'projects'), { withFileTypes: true }).some((d) => d.isDirectory()) } catch { return false }
}

export function handoverLines({ url, opened, seconds, folder, first = false, updatedTo = '', claudeSessions = hasClaudeSessions() }) {
  return [
    '',
    '---- For the user (pass this on word for word) ----',
    opened ? `The Oasis is open in your browser: ${url}` : `The Oasis is running: ${url} (to open it with its key: node scripts/oasis.mjs open)`,
    updatedTo ? `Updated to ${updatedTo} in ${minSec(seconds)}.` : first ? `The first start took ${minSec(seconds)}; later starts take seconds.` : `Started in ${minSec(seconds)}.`,
    // A machine with only Codex has no Claude Code sessions to walk up to (Hermes builder's Codex door run, 28 Nov:
    // Codex passed the Claude line on to a Codex-only person word for word).
    claudeSessions
      ? 'First thing to do: in the village, walk up to one of your own Claude Code sessions standing in front of you and press E to read it (Talk to it here carries it on); or click Agents (top left), then Summon a guide.'
      : 'First thing to do: in the village, click Agents (top left), then Summon a guide: it greets you and shows you around, on your own Codex or Claude Code. Agents, then Summon an agent, starts one in any folder.',
    `To open it again: node scripts/oasis.mjs open (in ${folder}).`,
    '----------------------------------------------------',
  ]
}

async function start() {
  // An update rebuilds the page and may reinstall packages: the servers this script started stop first (never others).
  const pending = setupPlan()
  if ((pending.includes('build') || pending.includes('packages')) && (alive(readRun().web) || alive(readRun().engine))) {
    say('Stopping the running Oasis to update it ...')
    stop()
    await sleep(1500)
  }
  if (!(await setup())) return 6
  const run = readRun()
  const started = []
  if (await portOpen(ENGINE_PORT)) {
    say(`The engine was already running on port ${ENGINE_PORT}.`)
  } else {
    run.engine = startServer('engine', path.join(HOME, 'packages', 'oasis-agent-engine', 'src', 'index.js'), [], {
      OASIS_PORT: String(ENGINE_PORT),
      OASIS_WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
      ...engineEnvFromFile(),
      ...tokenEnv(),
    })
    started.push('engine')
  }
  if (await portOpen(WEB_PORT)) {
    say(`The world was already running on port ${WEB_PORT}.`)
  } else {
    const next = bin('next', 'dist', 'bin', 'next')
    run.web = startServer('world', next, [SLIM ? 'start' : 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'], { ...webEnv(), ...tokenEnv() })
    started.push('world')
  }
  if (started.length) {
    writeRun(run)
    say(`Started the ${started.join(' and the ')} (logs in ${LOGS}).`)
  }
  if (!(await waitForPort(WEB_PORT, WAIT_MS))) {
    say(`The world did not answer on port ${WEB_PORT} within ${Math.round(WAIT_MS / 1000)} seconds. Look at ${path.join(LOGS, 'world.log')}.`)
    return 3
  }
  // The first time on this machine: the page is told, so a welcome can meet the newcomer (the onboarding mission).
  const firstRun = !fs.existsSync(FIRST_RUN_FILE)
  if (firstRun) {
    fs.mkdirSync(path.dirname(FIRST_RUN_FILE), { recursive: true })
    fs.writeFileSync(FIRST_RUN_FILE, JSON.stringify({ at: new Date().toISOString(), node: process.versions.node, platform: `${os.platform()} ${os.arch()}` }, null, 2))
  }
  const url = villageUrl({ session: arg('--session'), firstRun })
  // The key goes to the browser, never to the output (a log or a chat window would keep it).
  openBrowser(REQUIRE_TOKEN ? villageUrl({ session: arg('--session'), firstRun, key: localToken() }) : url)
  for (const line of handoverLines({ url: villageUrl(), opened: !process.env.OASIS_NO_OPEN, seconds: (Date.now() - STARTED_AT) / 1000, folder: HOME, first: firstStart, updatedTo: update && !rolledBack ? update.to : '' })) say(line)
  return 0
}

/**
 * Updates on request only. A git clone: git pull --ff-only (local changes to tracked files stop it, with git's words),
 * then the start script, which rebuilds what changed and keeps the previous build until the new one is built.
 * A plugin install updates with /oasis update in Claude Code (the old app stays beside until the new one answers).
 */
async function updateCommand() {
  if (!fs.existsSync(path.join(HOME, '.git'))) {
    say(`This Oasis (${oasisVersion() || 'its version is unknown'}) was not installed from git. In Claude Code, /oasis update installs the newest one and keeps your worlds and agents.`)
    return 1
  }
  const before = oasisVersion()
  say(`Updating the Oasis${before ? ` (${before})` : ''} from its repository: git pull ...`)
  if (await runAsync('git', ['pull', '--ff-only'], { shell: WIN })) {
    say('git pull did not finish (the lines above say why). Nothing was changed; the Oasis you had is as it was.')
    return 1
  }
  const after = oasisVersion()
  if (after === before && !setupPlan().length) {
    say(`The Oasis is already the newest${after ? ` (${after})` : ''}.`)
    return open()
  }
  process.env.OASIS_UPDATE_FROM = before || 'an earlier version'
  return start()
}

/** Opens the village in the default browser with the key; starts the Oasis first if it is not running. */
async function open() {
  if (!(await portOpen(WEB_PORT))) return start()
  if (process.env.OASIS_NO_OPEN) { say(`The Oasis is running at ${villageUrl()}.`); return 0 }
  openBrowser(REQUIRE_TOKEN ? villageUrl({ key: localToken() }) : villageUrl())
  say(`Opened ${villageUrl()} in your default browser${REQUIRE_TOKEN ? ", with this Oasis's key" : ''}.`)
  return 0
}

/** Copies text to the clipboard with the system's own tool; false when there is none. */
function copyToClipboard(text) {
  // Full paths where the system has a fixed one: on Windows a bare name is searched in the current folder (the
  // Oasis folder) before System32, so a clip.exe dropped there would get the key (Merge Goat, a70a9fd).
  const tools = WIN ? [[path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'clip.exe'), []]]
    : process.platform === 'darwin' ? [['/usr/bin/pbcopy', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]]
  for (const [command, argv] of tools) {
    try {
      if (spawnSync(command, argv, { input: text, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }).status === 0) return true
    } catch {
      // not on this machine: the next one
    }
  }
  return false
}

/**
 * Another browser on this machine, on purpose: the address with the key goes to the clipboard, never to the output
 * (a log or a chat window would keep it). The key only opens this Oasis from this machine.
 */
function link() {
  if (!REQUIRE_TOKEN) { say(`This Oasis asks for no key: open ${villageUrl()} in any browser on this machine.`); return 0 }
  if (copyToClipboard(villageUrl({ key: localToken() }))) {
    say("The village's address, with this Oasis's key, is on the clipboard: paste it into the other browser's address bar, on this machine. It is not printed, so it stays out of logs and chats; a clipboard history keeps it (clear it there if yours is synced to other devices). The key only opens this Oasis from this machine.")
    return 0
  }
  say('No clipboard tool was found (on Linux: wl-copy, xclip or xsel). The default browser can always open it: node scripts/oasis.mjs open')
  return 1
}

async function status() {
  const [engine, web] = await Promise.all([portOpen(ENGINE_PORT), portOpen(WEB_PORT)])
  say(`Engine (port ${ENGINE_PORT}): ${engine ? 'running' : 'not running'}`)
  say(`World  (port ${WEB_PORT}): ${web ? 'running' : 'not running'}`)
  // "slim" was the cut's internal name: say which Oasis this is (a newcomer's agent read "slim" as "not the full one").
  let worlds = 0
  try { worlds = fs.readdirSync(path.join(HOME, 'prisma', 'default-worlds')).filter((f) => f.endsWith('.world.json')).length } catch { /* none */ }
  const edition = SLIM ? `the packaged Oasis${worlds ? (worlds > 1 ? ` (full: ${worlds} worlds)` : ' (small: 1 world)') : ''}` : 'the workshop (a full checkout)'
  say(`Edition: ${edition}${oasisVersion() ? `, version ${oasisVersion()}` : ''}, in ${HOME}`)
  say(`Local key: ${REQUIRE_TOKEN ? 'on (only this machine may talk to the Oasis). `node scripts/oasis.mjs open` opens it with the key; `node scripts/oasis.mjs link` puts the address with the key on the clipboard for another browser' : 'off'}`)
  return 0
}

function killTree(pid) {
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  }
}

function stop() {
  const run = readRun()
  const stopped = []
  for (const name of ['web', 'engine']) {
    if (alive(run[name])) { killTree(run[name]); stopped.push(name === 'web' ? 'world' : 'engine') }
    delete run[name]
  }
  writeRun(run)
  say(stopped.length ? `Stopped the ${stopped.join(' and the ')}.` : 'Nothing that this script started is running.')
  return 0
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`The Oasis needs Node.js 20 or later (this is ${process.versions.node}).`)
    return 6
  }
  const command = args[0] || 'start'
  if (command === 'start') return start()
  if (command === 'setup') return (await setup()) ? 0 : 6
  if (command === 'open') return open()
  if (command === 'update') return updateCommand()
  if (command === 'link') return link()
  if (command === 'status') return status()
  if (command === 'stop') return stop()
  say('Usage: node scripts/oasis.mjs start | open | link | update | setup | status | stop')
  return 1
}

/** The real path of a file (through links), or the path itself. */
const realOf = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
// Started through a link (an updated install's `app` is one), argv[1] is the link's path: compare real paths.
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code))
}
