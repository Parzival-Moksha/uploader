#!/usr/bin/env node
// The Oasis's launcher, for Windows, macOS and Linux. /oasis in Claude Code runs this (hooks/register.ts);
// `npx` runs the same file from the npm package.
//
// What it does, in order:
//   1. Finds the Oasis on this machine: --home, then OASIS_HOME, then the checkout this folder sits in,
//      then ~/.oasis/app (where step 2 puts it).
//   2. Not there yet: installs it. One file is downloaded, the packaged Oasis, at the one version and checksum
//      pinned in release.json beside this file, from the Oasis's own GitHub releases, and unpacked to
//      ~/.oasis/app: the full Oasis, every feature and asset, about 570 MB (one edition since 24 Nov 2026; an old
//      --lite is ignored). Then the Oasis's own start script installs its packages from its
//      lockfile and builds it. Nothing else is downloaded by this file.
//      From /oasis this runs in the background (a mod may wait ten minutes at most): the first /oasis says that
//      the install began, each later /oasis says how far it is, and the browser opens by itself at the end.
//      From a terminal (--wait, what npx uses) it runs in front of you with its progress.
//   3. Hands over to the Oasis's start script (<home>/scripts/oasis.mjs start), which starts the page server
//      and the agent engine if they are not running, and opens the village in the browser.
//
//   node oasis-launch.mjs [--session <id>] [--home <folder>] [--wait] [--from <file.tar.gz>]
//                         [--no-install] [--where] [--token]
//
// --token prints the Oasis's local key (~/.oasis/token) and nothing else: the plugin's hooks send it with their
// requests to the Oasis on this machine, which refuses requests without it. It is sent nowhere else.
//
// Exit codes: 0 opened, 2 not installed and not installing, 3 it did not come up in time,
//             4 the download or its checksum failed, 5 Node is too old, 7 installing in the background.
// OASIS_NO_OPEN=1: everything but the browser tab (tests).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const arg = (name) => (has(name) ? args[args.indexOf(name) + 1] : '')
const say = (line) => process.stdout.write(`${line}\n`)
const MB = 1024 * 1024

export const dataDir = () => process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis')
const stateFile = () => path.join(dataDir(), 'install.json')
const logFile = () => path.join(dataDir(), 'install.log')

/** A folder is an Oasis when it has the start script and a package.json that names the engine. */
export function isOasis(dir) {
  try {
    if (!dir || !fs.existsSync(path.join(dir, 'scripts', 'oasis.mjs'))) return false
    return /"dev:engine"|"oasis:engine"/.test(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return false
  }
}

/** The main Oasis repository (the owner's own checkout) has no package marker; on Windows it keeps its two-window launcher. */
const isMainRepository = (dir) => !fs.existsSync(path.join(dir, '.oasis-slim'))

export function findHome({ home = arg('--home'), env = process.env } = {}) {
  const candidates = [home, env.OASIS_HOME, path.resolve(HERE, '..', '..', '..'), path.join(dataDir(), 'app')]
  return candidates.find((dir) => dir && isOasis(dir)) || ''
}

/**
 * release.json: { repo, version, editions: { full: { asset, sha256, megabytes }, lite: { … } } }.
 * (An older file with one `asset` and `sha256` at the top is read as the lite edition.)
 */
export function readRelease(file = path.join(HERE, 'release.json'), edition = 'full') {
  const release = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!/^[\w.-]+\/[\w.-]+$/.test(release.repo || '')) throw new Error('release.json: repo')
  if (!/^\d+\.\d+\.\d+$/.test(release.version || '')) throw new Error('release.json: version')
  const editions = release.editions || { lite: { asset: release.asset, sha256: release.sha256 } }
  const chosen = editions[edition] || editions.full || editions.lite
  if (!chosen || !/^[\w.-]+\.tar\.gz$/.test(chosen.asset || '')) throw new Error('release.json: asset')
  return { repo: release.repo, version: release.version, edition: editions[edition] ? edition : Object.keys(editions).find((k) => editions[k] === chosen), ...chosen }
}

export const releaseUrl = (r) => `https://github.com/${r.repo}/releases/download/v${r.version}/${r.asset}`

function sha256(file) {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(4 * MB)
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (!read) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

// --- the state of an install, for whoever asks next ---------------------------------------------------------

export function readState(file = stateFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeState(patch) {
  const next = { ...(readState() || {}), ...patch, at: Date.now() }
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2))
  return next
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * The start script's latest progress in the install log, as { step, of, words, left }, or null. Its lines:
 * "Step 5 of 5: building the Oasis (about 3 minutes left in all) …" and, every 25 s,
 * "  … step 5 of 5, building the Oasis: 1 min 15 s so far, about 2 minutes left in all".
 */
export function lastProgress(logText) {
  let found = null
  for (const line of String(logText || '').split(/\r?\n/)) {
    const head = /^Step (\d+) of (\d+): (.+?) \((.+?) left in all\)/.exec(line)
    const tick = /^\s+… step (\d+) of (\d+), (.+?): .+? so far, (.+?)(?: left in all)?$/.exec(line)
    const m = head || tick
    if (m) found = { step: Number(m[1]), of: Number(m[2]), words: m[3], left: /longer than usual/.test(m[4]) ? 'longer than usual, still working' : `${m[4]} left` }
  }
  return found
}

function readLogTail(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return text.slice(-20000)
  } catch {
    return ''
  }
}

/** One plain line on a running or finished install; '' when there is none to speak of. */
export function describeState(state, now = Date.now(), logText = state?.log ? readLogTail(state.log) : '') {
  if (!state) return ''
  const minutes = Math.max(0, Math.round((now - (state.startedAt || now)) / 60000))
  const since = minutes ? `, ${minutes} minute${minutes === 1 ? '' : 's'} so far` : ''
  if (state.state === 'failed') return state.kind === 'update' ? (state.error || 'The update stopped; see the log.') : `The install stopped: ${state.error || 'see the log'} (${state.log || ''}). Type /oasis to try again.`
  if (state.state !== 'running') return ''
  const what = state.kind === 'update' ? `Updating the Oasis from ${state.from} to ${state.to}` : 'Installing the Oasis'
  if (state.step === 'download') {
    const got = Math.round((state.bytes || 0) / MB)
    const of = state.total ? ` of ${Math.round(state.total / MB)}` : ''
    return `${what}: downloading and checking, ${got}${of} MB${since}${state.kind === 'update' ? '; the Oasis you have keeps running' : ''}. The browser opens by itself when it is ready.`
  }
  const updateSteps = { carry: 'stopping the old one and carrying your data over', swap: 'swapping in the new version', start: 'starting the new version' }
  if (state.kind === 'update' && updateSteps[state.step]) return `${what}: ${updateSteps[state.step]}${since}.`
  const progress = state.step === 'setup' ? lastProgress(logText) : null
  if (progress) return `${what}${since}: step ${progress.step} of ${progress.of}, ${progress.words}, ${progress.left}. The browser opens by itself when it is ready; /oasis again in a minute or two says how far it is.`
  const steps = { unpack: 'unpacking', setup: 'installing its packages and building (the long part, a few minutes)', start: 'starting' }
  return `${what}: ${steps[state.step] || state.step}${since}. The browser opens by itself when it is ready; /oasis again in a minute or two says how far it is.`
}

// --- install -----------------------------------------------------------------------------------------------

async function download(release, archive, progress) {
  if (!/^[0-9a-f]{64}$/.test(release.sha256 || '')) throw new Error('This version has no published Oasis to download yet. Get the Oasis from its repository and set OASIS_HOME to its folder.')
  const res = await fetch(releaseUrl(release), { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}.`)
  const total = Number(res.headers.get('content-length')) || 0
  const out = fs.openSync(archive, 'w')
  let bytes = 0
  let told = 0
  try {
    for await (const chunk of res.body) {
      fs.writeSync(out, chunk)
      bytes += chunk.length
      if (Date.now() - told > 1500) { told = Date.now(); progress(bytes, total) }
    }
  } finally {
    fs.closeSync(out)
  }
  progress(bytes, total)
}

/** Downloads (or takes --from) the release and checks its pinned checksum. Returns the archive's path. */
async function fetchChecked(release, { from, onStep = () => {}, onBytes = () => {} }) {
  const root = dataDir()
  fs.mkdirSync(root, { recursive: true })
  const archive = path.join(root, release.asset)
  onStep('download')
  if (from) fs.copyFileSync(from, archive)
  else await download(release, archive, onBytes)
  if (release.sha256 && sha256(archive) !== release.sha256) {
    fs.rmSync(archive, { force: true })
    throw new Error('the downloaded file does not match the checksum this version was published with')
  }
  return archive
}

/** Unpacks a checked archive into a new folder beside the others. Returns { fresh, inner } (inner: the Oasis itself). */
function unpackBeside(archive, release) {
  const fresh = path.join(dataDir(), `app-${release.version}-${process.pid}-unpack`)
  fs.mkdirSync(fresh, { recursive: true })
  // On Windows: the system's own tar. A GNU tar from Git Bash on the PATH reads "C:" as a remote host.
  const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const tarCommand = process.platform === 'win32' && fs.existsSync(systemTar) ? systemTar : 'tar'
  const tar = spawnSync(tarCommand, ['-xzf', archive, '-C', fresh], { stdio: 'ignore', windowsHide: true })
  if (tar.status !== 0) {
    fs.rmSync(fresh, { recursive: true, force: true })
    throw new Error('Could not unpack the download (the `tar` command failed).')
  }
  // An archive may hold its files directly or inside one top folder.
  const entries = fs.readdirSync(fresh)
  const inner = entries.length === 1 && fs.statSync(path.join(fresh, entries[0])).isDirectory() ? path.join(fresh, entries[0]) : fresh
  if (!isOasis(inner)) {
    fs.rmSync(fresh, { recursive: true, force: true })
    throw new Error('the download does not look like the Oasis')
  }
  return { fresh, inner }
}

/** Downloads (or takes --from), checks the checksum, unpacks to ~/.oasis/app. Returns the folder. */
async function install({ from, edition, onStep = () => {}, onBytes = () => {} }) {
  const release = readRelease(undefined, edition)
  const root = dataDir()
  let archive
  try {
    archive = await fetchChecked(release, { from, onStep, onBytes })
  } catch (error) {
    throw new Error(`${String(error?.message || error).replace(/^./, (c) => c.toUpperCase())}. Nothing was installed.`)
  }
  onStep('unpack')
  const target = path.join(root, 'app')
  const { fresh, inner } = unpackBeside(archive, release)
  if (fs.existsSync(target)) fs.renameSync(target, path.join(root, `app-old-${Date.now()}`))
  fs.renameSync(inner, target)
  if (inner !== fresh) fs.rmSync(fresh, { recursive: true, force: true })
  fs.rmSync(archive, { force: true })
  return target
}

function run(command, argv, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: 'inherit', windowsHide: true, ...options })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

// --- update in place (only on /oasis update) ---------------------------------------------------------------
// Anorak's rulings and Merge Goat's read (24 Nov): plain /oasis never updates; /oasis update does, like this:
//   1. download the release and check its pinned checksum, with the Oasis that runs today untouched;
//   2. unpack it into a folder of its own beside the old one (it is never moved: Windows keeps absolute links in
//      node_modules), with only the person's .env copied in, and build it there; the old one keeps running;
//   3. stop the old one, copy the person's data (a short named list) into the new one, each file checked byte for
//      byte, and swap: `app` becomes a link to the new folder; the old folder stays whole beside it;
//   4. start the new one; only when it answers on its port is the update done.
// Any failure, at any step, puts the old one back and starts it, and says what happened. A journal (update.json)
// lets the next /oasis finish or undo an update that was killed halfway. Before the first update of an install,
// a copy of the person's data is put aside and never touched again.

/**
 * The person's data: these places in the app folder, named from where the Oasis writes (a file a release ships
 * there is the release's). "dir/" is everything under it; "dir/*" only the files directly in it (profile pictures
 * sit beside the shipped avatar gallery, which is not theirs).
 */
export const DATA_PLACES = ['.env', '.env.local', 'data/', 'prisma/data/', 'logs/', 'public/conjured/', 'public/images/',
  'public/generated-images/', 'public/generated-music/', 'public/generated-voices/', 'public/generated-videos/',
  'public/thumbs/', 'public/crafted-thumbs/', 'public/merlin/', 'public/portal-thumbs/', 'public/avatars/*', 'public/avatars/gallery/thumbs/*']
/** Files that were neither the person's nor a release's are kept aside this many days after an update. */
export const LEFT_OVER_DAYS = 30
/** Never carried, never left over: what a build or an install makes again. */
const REMADE = new Set(['node_modules', '.next', '.next-previous', '.git'])
/** For an install from before the release's file list (.oasis-files.json): the folders and top files that are the release's. */
const RELEASE_AREAS = new Set(['src', 'scripts', 'packages', 'plugins', 'skills', 'prisma', 'public', 'website', 'mcp', 'docs'])
const RELEASE_TOP = /^(.env.example|.env.production|.env.development|.oasis-slim|.oasis-files.json|.gitignore|[A-Z][A-Z_-]*.md|LICENSE|package.json|pnpm-lock.yaml|next.config.mjs|next-env.d.ts|tsconfig.json|tailwind.config.js|postcss.config.js|instrumentation.ts|oasis.(cmd|command|sh))$/

export const inDataPlace = (rel) => DATA_PLACES.some((place) => {
  if (place.endsWith('/*')) return rel.startsWith(place.slice(0, -1)) && !rel.slice(place.length - 1).includes('/')
  return place.endsWith('/') ? rel.startsWith(place) : rel === place
})

/** The version an installed Oasis says it is (its own release file), or ''. */
export function installedVersion(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'oasis', 'scripts', 'release.json'), 'utf8')).version || '' } catch { return '' }
}

/** true when version a is newer than b (x.y.z). */
export function isNewer(a, b) {
  const pa = String(a || '').split('.').map(Number)
  const pb = String(b || '').split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

/** Every file in a folder, as forward-slash paths relative to it, without what a build or install makes again. */
export function listRelative(dir) {
  const out = []
  const walk = (rel) => {
    let entries
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (REMADE.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(r)
      else if (e.isFile()) out.push(r)
    }
  }
  walk('')
  return out
}

/** The release's own list of its files, when the package has one. */
function releaseFiles(home) {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(home, '.oasis-files.json'), 'utf8'))) } catch { return null }
}

/**
 * Sorts the old install's files: theirs (in a data place and not shipped by the new release: carried over),
 * left over (neither theirs nor any release's: copied aside, never into the build), the rest is the old release's.
 * @param {string[]} oldFiles
 * @param {Set<string>} newShipped
 * @param {Set<string> | null} [oldShipped]
 */
export function sortFiles(oldFiles, newShipped, oldShipped = null) {
  const theirs = []
  const leftOver = []
  for (const rel of oldFiles) {
    if (newShipped.has(rel)) continue // the new release's
    if (oldShipped && oldShipped.has(rel)) continue // the old release's, dropped by the new one: gone
    if (inDataPlace(rel)) { theirs.push(rel); continue }
    const oldRelease = oldShipped ? false : rel.includes('/') ? RELEASE_AREAS.has(rel.split('/')[0]) : RELEASE_TOP.test(rel)
    if (!oldRelease) leftOver.push(rel)
  }
  return { theirs, leftOver }
}

/** Copies files from one folder to another, each checked by size and SHA-256 (or the copy stops). */
export function copyChecked(fromHome, toHome, files) {
  for (const rel of files) {
    const source = path.join(fromHome, rel)
    const target = path.join(toHome, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    if (fs.statSync(source).size !== fs.statSync(target).size || sha256(source) !== sha256(target)) throw new Error(`${rel} did not copy byte for byte`)
  }
  return files.length
}

/** In the new folder, the data places hold exactly the person's files (a build or a seed may have made others). */
function clearDataPlaces(home, shipped) {
  for (const rel of listRelative(home)) if (inDataPlace(rel) && !shipped.has(rel)) fs.rmSync(path.join(home, rel), { force: true })
}

const journalFile = () => path.join(dataDir(), 'update.json')
function readJournal() { try { return JSON.parse(fs.readFileSync(journalFile(), 'utf8')) } catch { return null } }
/** A new update's journal: nothing of an earlier update's record (its folders) may be read as this one's. */
function freshJournal(record) {
  fs.writeFileSync(journalFile(), JSON.stringify({ ...record, at: Date.now() }, null, 2))
  return readJournal()
}

function writeJournal(patch) {
  const next = { ...(readJournal() || {}), ...patch, at: Date.now() }
  fs.writeFileSync(journalFile(), JSON.stringify(next, null, 2))
  return next
}

/** A test can make the update fail (OASIS_TEST_FAIL_AT) or be killed (OASIS_TEST_EXIT_AT) at a named point. */
function testPoint(name) {
  if (process.env.OASIS_TEST_FAIL_AT === name) throw new Error(`a test made it fail at "${name}"`)
  if (process.env.OASIS_TEST_EXIT_AT === name) process.exit(9)
}

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink() } catch { return false } }
function makeLink(target, link) { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir') }
function removeLink(link) { try { fs.unlinkSync(link) } catch { fs.rmdirSync(link) } }

/** A folder move, tried for up to ten seconds: Windows keeps files locked for a moment after a process ends. */
async function moveFolder(from, to) {
  for (let i = 0; ; i += 1) {
    try { fs.renameSync(from, to); return } catch (error) {
      if (i >= 10) throw new Error(`could not move ${from} (${error.code || error.message}); a terminal or an editor open in it keeps it busy`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

/** Free bytes where the Oasis lives (OASIS_TEST_FREE_MB stands in for a full disk in tests), or Infinity. */
function freeBytes(dir) {
  if (process.env.OASIS_TEST_FREE_MB) return Number(process.env.OASIS_TEST_FREE_MB) * MB
  try { const st = fs.statfsSync(dir); return st.bavail * st.bsize } catch { return Infinity }
}

/** The app folder behind `app` (a link after the first update), or the path itself. */
const realHome = (home) => { try { return fs.realpathSync(home) } catch { return home } }
const runScript = (home, argv, env) => run(process.execPath, [path.join(realHome(home), 'scripts', 'oasis.mjs'), ...argv], { cwd: realHome(home), env: { ...process.env, ...env } })

/**
 * This Oasis answers: its /api/health, asked with the local key, says ok (and, when given, the expected version).
 * Another server on the port does not count (Merge Goat); a version from before the health route said its version
 * is taken by "ok" alone (that is the old one coming back after a failed update).
 */
async function oasisAnswers({ version = '', ms = 30_000 } = {}) {
  const port = Number(process.env.OASIS_WEB_PORT || 4516)
  let token = ''
  try { token = fs.readFileSync(process.env.OASIS_TOKEN_FILE || path.join(dataDir(), 'token'), 'utf8').trim() } catch { /* an Oasis without a key */ }
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: token ? { 'x-oasis-token': token } : {}, signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.status === 'ok' && (!version || body.version === version)) return true
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/**
 * Puts the old app back as `app` (a moved folder back in place, or the link back to it) and starts it.
 * Returns a line on what state the person is in.
 */
async function giveBackOld(journal, session) {
  const app = path.join(dataDir(), 'app')
  const appNext = path.join(dataDir(), 'app.next')
  if (isLink(appNext)) removeLink(appNext)
  if (journal.oldDir && fs.existsSync(journal.oldDir) && path.resolve(journal.oldDir) !== path.resolve(app)) {
    if (isLink(app)) removeLink(app)
    else if (fs.existsSync(app)) await moveFolder(app, path.join(dataDir(), `app-failed-${journal.to}-${Date.now()}`))
    if (journal.oldWasFolder) await moveFolder(journal.oldDir, app)
    else makeLink(journal.oldDir, app)
  }
  // The new version's folder goes (it never became the Oasis the person has).
  if (journal.newDir && fs.existsSync(journal.newDir) && realHome(app) !== path.resolve(journal.newDir)) {
    try { fs.rmSync(journal.newDir, { recursive: true, force: true }) } catch { /* a file still held: the next update prunes it */ }
  }
  const code = await run(process.execPath, startArgs(app, session), { cwd: realHome(app) })
  return code === 0 && (await oasisAnswers()) ? `your Oasis ${journal.from} is running again` : `your Oasis ${journal.from} is back in its place but did not start by itself: type /oasis`
}

/**
 * The next /oasis after an update that was killed halfway: finishes it if the new one had answered, otherwise puts
 * the old one back. Returns a line to say, or ''.
 */
export async function recoverUpdate(session = '') {
  const journal = readJournal()
  if (!journal || journal.phase === 'done' || journal.phase === 'rolled back') return ''
  // Still running (the "/oasis again in two minutes" the update itself invites): never touched. A pid the system
  // has given to another process long after is not taken for the update (an hour without a step is no update).
  if (alive(journal.pid) && Date.now() - (journal.at || 0) < 60 * 60 * 1000) return ''
  // A kill while unpacking leaves its unpack folder: gone with the rest of the half-made update.
  for (const name of fs.readdirSync(dataDir())) if (/^app-\d+\.\d+\.\d+-\d+-unpack$/.test(name)) fs.rmSync(path.join(dataDir(), name), { recursive: true, force: true })
  if (journal.phase === 'started') {
    writeJournal({ phase: 'done' })
    return `The update to ${journal.to} had finished; it is the Oasis you have now.`
  }
  const swapped = ['swapping', 'swapped'].includes(journal.phase)
  let state
  if (swapped) state = await giveBackOld(journal, session)
  else {
    if (journal.newDir && fs.existsSync(journal.newDir)) fs.rmSync(journal.newDir, { recursive: true, force: true })
    state = `your Oasis ${journal.from} is as it was`
  }
  writeJournal({ phase: 'rolled back' })
  return `An update to ${journal.to} was stopped halfway (at "${journal.phase}"); ${state}.`
}

/** /oasis update: the update itself (see the head of this section). */
async function updateAndStart({ quiet }) {
  const root = dataDir()
  const app = path.join(root, 'app')
  const oldReal = fs.realpathSync(app)
  const have = installedVersion(app)
  const edition = readState()?.edition || 'full'
  const release = readRelease(undefined, edition)
  const session = arg('--session')
  const stamp = Date.now()
  const newDir = path.join(root, `app-${release.version}-${stamp}`)
  let journal = freshJournal({ phase: 'begun', pid: process.pid, from: have, to: release.version, oldDir: oldReal, oldWasFolder: !isLink(app), newDir, startedAt: stamp, error: '' })
  writeState({ state: 'running', kind: 'update', step: 'download', from: have, to: release.version, pid: process.pid, startedAt: stamp, edition, bytes: 0, total: 0, error: '', log: logFile() })
  say(`Updating the Oasis from ${have} to ${release.version} …`)
  const steps = ['download and check', 'unpack', 'build', 'stop and carry your data', 'swap', 'start']
  let at = 0
  let oldStopped = false
  try {
    // Left-over folders from earlier updates are kept 30 days, then removed here (the notes say so).
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('left-over-')) continue
      const full = path.join(root, name)
      if (Date.now() - fs.statSync(full).mtimeMs > LEFT_OVER_DAYS * 24 * 60 * 60 * 1000) fs.rmSync(full, { recursive: true, force: true })
    }
    // 1. Room and the release, with the old Oasis untouched.
    const need = (release.megabytes || 600) * MB * 4 + 1024 * MB
    if (freeBytes(root) < need) throw new Error(`there is not enough free disk space (about ${Math.ceil(need / 1024 / MB)} GB is needed)`)
    testPoint('download')
    const archive = await fetchChecked(release, {
      from: arg('--from'),
      onStep: (step) => writeState({ step }),
      onBytes: (bytes, total) => { writeState({ bytes, total }); if (!quiet && process.stdout.isTTY) process.stdout.write(`\r  ${Math.round(bytes / MB)}${total ? ` of ${Math.round(total / MB)}` : ''} MB `) },
    })
    // 2. Its own folder, never moved.
    at = 1
    writeState({ step: 'unpack' })
    const { fresh, inner } = unpackBeside(archive, release)
    fs.rmSync(archive, { force: true })
    if (inner !== fresh) {
      fs.renameSync(inner, newDir)
      fs.rmSync(fresh, { recursive: true, force: true })
    } else fs.renameSync(fresh, newDir)
    journal = writeJournal({ phase: 'unpacked' })
    testPoint('unpacked')
    const shipped = new Set(listRelative(newDir))
    const { theirs, leftOver } = sortFiles(listRelative(oldReal), shipped, releaseFiles(oldReal))
    // The person's data aside, once, before the first update of this install.
    if (!fs.readdirSync(root).some((name) => name.startsWith('data-before-first-update'))) {
      const aside = path.join(root, `data-before-first-update-${have || 'unknown'}`)
      copyChecked(oldReal, aside, theirs)
      say(`A copy of your data (${theirs.length} files) is in ${aside}, made once, before the first update.`)
    }
    if (leftOver.length) {
      const aside = path.join(root, `left-over-${new Date(stamp).toISOString().slice(0, 10)}-${have}`)
      copyChecked(oldReal, aside, leftOver)
      say(`${leftOver.length} files were neither your data nor the release's; they are copied to ${aside} (kept ${LEFT_OVER_DAYS} days, then removed at the next update) and not taken into the new version.`)
    }
    // 3. Build beside, with their .env (the build reads its settings); the old Oasis keeps running.
    at = 2
    copyChecked(oldReal, newDir, theirs.filter((rel) => rel === '.env' || rel === '.env.local'))
    writeState({ step: 'setup' })
    testPoint('build')
    if (await runScript(newDir, ['setup'], { OASIS_UPDATE_FROM: have || 'an earlier version' }) !== 0) throw new Error('the new version did not install or build')
    journal = writeJournal({ phase: 'built' })
    // 4. Stop the old one; their data into the new one, all of it, checked.
    at = 3
    writeState({ step: 'carry' })
    await runScript(oldReal, ['stop'])
    oldStopped = true
    journal = writeJournal({ phase: 'stopped' })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    testPoint('carry')
    clearDataPlaces(newDir, shipped)
    const carried = copyChecked(oldReal, newDir, sortFiles(listRelative(oldReal), shipped, releaseFiles(oldReal)).theirs)
    say(`Carried over ${carried} files of yours, each checked byte for byte.`)
    // 5. The swap: app.next first, so that `app` is missing for no longer than one rename.
    at = 4
    writeState({ step: 'swap' })
    const appNext = path.join(root, 'app.next')
    if (isLink(appNext)) removeLink(appNext)
    makeLink(newDir, appNext)
    journal = writeJournal({ phase: 'swapping', oldDir: journal.oldWasFolder ? path.join(root, `app-${have || 'old'}-${stamp}`) : oldReal })
    if (journal.oldWasFolder) await moveFolder(app, journal.oldDir)
    else removeLink(app)
    testPoint('swap')
    await moveFolder(appNext, app)
    journal = writeJournal({ phase: 'swapped' })
    // 6. Start the new one: done only when it answers.
    at = 5
    writeState({ step: 'start' })
    testPoint('start')
    if (await run(process.execPath, startArgs(app, session), { cwd: realHome(app) }) !== 0 || !(await oasisAnswers({ version: release.version }))) throw new Error(`the new version did not answer on its port as ${release.version}`)
    writeJournal({ phase: 'started' })
    writeJournal({ phase: 'done' })
    writeState({ state: 'done', step: 'done', home: app, kind: 'update' })
    // Only the version before stays beside (an update's own folders; anything else in the folder is left alone).
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name)
      if (/^app-\d+\.\d+\.\d+-\d+$/.test(name) && path.resolve(full) !== path.resolve(newDir) && path.resolve(full) !== path.resolve(journal.oldDir)) fs.rmSync(full, { recursive: true, force: true })
    }
    say(`The Oasis is updated to ${release.version}. The version before (${have}) is kept in ${journal.oldDir} until the next update.`)
    return 0
  } catch (error) {
    const reason = String(error?.message || error)
    const where = `at step ${at + 1} of 6 (${steps[at]})`
    let state
    if (['swapping', 'swapped'].includes(journal.phase)) {
      await runScript(path.join(root, 'app'), ['stop']).catch(() => {})
      state = await giveBackOld(journal, session)
    } else {
      if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true })
      if (oldStopped) {
        const code = await run(process.execPath, startArgs(app, session), { cwd: realHome(app) })
        state = code === 0 && (await oasisAnswers()) ? `your Oasis ${have} is running again` : `your Oasis ${have} is in its place but did not start by itself: type /oasis`
      } else state = `nothing was changed; your Oasis ${have} is as it was`
    }
    writeJournal({ phase: 'rolled back', error: reason })
    const message = `The update to ${release.version} failed ${where}: ${reason}. ${state.charAt(0).toUpperCase()}${state.slice(1)}. The log is ${logFile()}.`
    writeState({ state: 'failed', kind: 'update', error: message })
    say(message)
    return 4
  }
}

/** Starts the update as its own process, which outlives this one; its output goes to the install log. */
function updateInBackground() {
  fs.mkdirSync(dataDir(), { recursive: true })
  // (returns the worker's pid)
  const log = fs.openSync(logFile(), 'w')
  const pass = ['--update-worker', ...(arg('--session') ? ['--session', arg('--session')] : []), ...(arg('--from') ? ['--from', arg('--from')] : [])]
  const child = spawn(process.execPath, [SELF, ...pass], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env })
  child.unref()
  fs.closeSync(log)
  return child.pid
}

const startArgs = (home, session) => [path.join(realHome(home), 'scripts', 'oasis.mjs'), 'start', ...(session ? ['--session', session] : [])]

/** The whole first install, to the open browser: download, unpack, packages and build, start. */
async function installAndStart({ quiet }) {
  const edition = 'full' // one edition since 24 Nov 2026; an old --lite is ignored
  const session = arg('--session')
  writeState({ state: 'running', step: 'download', pid: process.pid, startedAt: Date.now(), edition, bytes: 0, total: 0, error: '', log: logFile() })
  try {
    const home = await install({
      from: arg('--from'),
      edition,
      onStep: (step) => { writeState({ step }); if (!quiet) say(step === 'download' ? 'Downloading the Oasis …' : 'Unpacking …') },
      onBytes: (bytes, total) => { writeState({ bytes, total }); if (!quiet && process.stdout.isTTY) process.stdout.write(`\r  ${Math.round(bytes / MB)}${total ? ` of ${Math.round(total / MB)}` : ''} MB `) },
    })
    if (!quiet) say(`\nInstalled the Oasis in ${home}.`)
    writeState({ step: 'setup' })
    const setup = await run(process.execPath, [path.join(home, 'scripts', 'oasis.mjs'), 'setup'], { cwd: home })
    if (setup !== 0) throw new Error('installing its packages or building failed')
    writeState({ step: 'start' })
    const code = await run(process.execPath, startArgs(home, session), { cwd: home })
    if (code !== 0) throw new Error('it was installed, but did not start')
    writeState({ state: 'done', step: 'done', home })
    return 0
  } catch (error) {
    const message = String(error?.message || error)
    writeState({ state: 'failed', error: message })
    say(message)
    return 4
  }
}

/** Starts the install as its own process, which outlives this one; its output goes to ~/.oasis/install.log. */
function installInBackground() {
  fs.mkdirSync(dataDir(), { recursive: true })
  const log = fs.openSync(logFile(), 'w')
  const pass = ['--install-worker', ...(arg('--session') ? ['--session', arg('--session')] : []), ...(arg('--from') ? ['--from', arg('--from')] : [])]
  const child = spawn(process.execPath, [SELF, ...pass], { detached: true, windowsHide: true, stdio: ['ignore', log, log] })
  child.unref()
  fs.closeSync(log)
  writeState({ state: 'running', step: 'download', pid: child.pid, startedAt: Date.now(), edition: 'full', bytes: 0, total: 0, error: '', log: logFile() })
}

export async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`The Oasis needs Node.js 20 or later (this is ${process.versions.node}).`)
    return 5
  }
  if (has('--token')) {
    try { say(fs.readFileSync(process.env.OASIS_TOKEN_FILE || path.join(dataDir(), 'token'), 'utf8').trim()) } catch { /* no key: the Oasis runs without one */ }
    return 0
  }
  if (has('--install-worker')) return installAndStart({ quiet: true })
  if (has('--update-worker')) return updateAndStart({ quiet: true })
  // An update that was stopped halfway (killed, the machine off) is finished or undone before anything else.
  const recovered = await recoverUpdate(arg('--session'))
  if (recovered) say(recovered)

  const home = findHome()
  if (has('--where')) {
    say(home || 'not installed')
    return home ? 0 : 2
  }
  if (!home) {
    const state = readState()
    const running = state?.state === 'running' && alive(state.pid)
    if (running) {
      say(describeState(state))
      return 7
    }
    if (has('--no-install')) {
      say('The Oasis is not installed on this machine. /oasis installs it.')
      return 2
    }
    if (has('--wait')) return installAndStart({ quiet: false })
    let size = ''
    try {
      const release = readRelease(undefined, 'full')
      size = release.megabytes ? ` (${release.megabytes} MB, then its packages and a build: about ten minutes)` : ''
    } catch {
      // said by the worker
    }
    installInBackground()
    say(`Installing the Oasis in the background${size}. The browser opens by itself when it is ready. Type /oasis again in two minutes to see how far it is.`)
    return 7
  }
  // Installed, but the first build may still be running in the background.
  const state = readState()
  if (state?.state === 'running' && alive(state.pid) && path.resolve(home) === path.resolve(dataDir(), 'app')) {
    say(describeState(state))
    return 7
  }
  // A newer Oasis than the one installed: plain /oasis only says so; /oasis update installs it.
  const managed = path.resolve(home) === path.resolve(dataDir(), 'app')
  if (managed) {
    const have = installedVersion(home)
    let want = ''
    let size = ''
    try {
      const r = readRelease(undefined, state?.edition || 'full')
      want = r.version
      size = r.megabytes ? ` (${r.megabytes} MB, then a build: a few minutes)` : ''
    } catch { /* no release file: nothing to update to */ }
    if (have && want && isNewer(want, have)) {
      if (has('--update')) {
        if (has('--wait')) return updateAndStart({ quiet: false })
        const pid = updateInBackground()
        writeState({ state: 'running', kind: 'update', step: 'download', pid, from: have, to: want, startedAt: Date.now(), bytes: 0, total: 0, error: '', log: logFile() })
        say(`Updating the Oasis from ${have} to ${want} in the background${size}. The Oasis you have keeps running until the new one is downloaded, checked and built; then it stops for a moment and the new one starts, with your worlds and agents. If anything fails, the one you have comes back. Type /oasis again in two minutes to see how far it is.`)
        return 7
      }
      say(`The Oasis ${want} is available; you have ${have}. To update: /oasis update`)
    } else if (has('--update')) say(`The Oasis ${have || ''} you have is the newest one.`.replace('  ', ' '))
  } else if (has('--update')) {
    say(`This Oasis was not installed by /oasis (${home}). To update it: in that folder, git pull, then node scripts/oasis.mjs update.`)
  }
  const session = arg('--session')
  // The main repository on Windows keeps the launcher its owner knows: two titled windows, one per server.
  const ps1 = path.join(HERE, 'oasis-launch.ps1')
  if (process.platform === 'win32' && isMainRepository(home) && fs.existsSync(ps1)) {
    const url = `http://localhost:4516/?profile=village${session ? `&session=${encodeURIComponent(session)}` : ''}`
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Url', url, '-OasisHome', home])
  }
  return run(process.execPath, startArgs(home, session), { cwd: home })
}

/** The real path of a file (through links), or the path itself. */
const realOf = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
if (process.argv[1] && realOf(process.argv[1]) === realOf(SELF)) {
  main().then((code) => process.exit(code))
}
