// "Only what ships": the owner's own Oasis offers and plays exactly what the public package ships (the owner,
// 24 Nov 2026: "I want to feel and use the same Oasis that people are using"). One switch for the whole Oasis,
// on by default, kept in data/only-what-ships.local.json. A browser with the cookie below set to 'off' sees
// everything, one with 'on' only what ships, whatever the switch says (an agent's test, without touching his).
//
// What is left out comes from the cut's own rules (scripts/slim/left-out.mjs), so it cannot drift from the
// package. src/middleware.ts answers a left-out file with its stand-in (scripts/slim/stand-ins.json) or a 404,
// as in a stranger's Oasis; the library and avatar lists leave them out. The package itself, the hosted Oasis and
// any copy without the cut's scripts have nothing to switch: everything they have, they ship.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { isHostedOasis } from './oasis-profile'

export const ONLY_WHAT_SHIPS_COOKIE = 'oasis-only-what-ships'

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, 'scripts', 'slim', 'left-out.mjs')
const STATE = path.join(ROOT, 'data', 'only-what-ships.local.json')
const INPUTS = ['.git/index', 'scripts/slim/stand-ins.json', 'scripts/slim/cut.config.mjs', 'scripts/cut-slim.mjs', 'scripts/slim/left-out.mjs']

export interface ShippedView {
  /** This Oasis has a switch at all (the owner's repository, not the package or the hosted site). */
  applies: boolean
  /** The switch as stored (on unless he turned it off). */
  switchOn: boolean
  /** Whether this request sees only what ships (the switch, unless this browser opted out). */
  on: boolean
  /** Left-out files as addresses ('/models/a b.glb', not URL-encoded). */
  leftOut: string[]
  /** Left-out address -> the shipped address served instead. */
  standIns: Record<string, string>
  problems: string[]
}

type EnvLike = { [key: string]: string | undefined }

export function switchApplies(env: EnvLike = process.env): boolean {
  if (isHostedOasis(env)) return false
  // A test run never follows his switch (the routes' tests would see his choice); a test of the switch sets this.
  if (env.VITEST && env.OASIS_TEST_ONLY_WHAT_SHIPS !== '1') return false
  if (env.OASIS_EDITION === 'slim' || env.NEXT_PUBLIC_OASIS_EDITION === 'slim') return false
  return fs.existsSync(SCRIPT)
}

export function readSwitch(): boolean {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8'))?.on !== false } catch { return true }
}

export function writeSwitch(on: boolean): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  fs.writeFileSync(STATE, `${JSON.stringify({ on, at: new Date().toISOString() })}\n`)
}

/** 'public/models/a b.glb' -> '/models/a b.glb' */
export const addressOf = (file: string): string => file.replace(/^public(?=\/)/, '')

/** An address as asked for (maybe URL-encoded, maybe with a query) -> the plain form the list uses. */
export function plainAddress(url: string): string {
  const bare = url.split(/[?#]/)[0]
  try { return decodeURIComponent(bare) } catch { return bare }
}

interface LeftOutList { leftOut: string[]; standIns: Record<string, string>; problems: string[] }
let cached: { key: string; list: Promise<LeftOutList> } | null = null

function inputsKey(): string {
  return INPUTS.map(f => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs } catch { return 0 } }).join(':')
}

function runScript(): Promise<LeftOutList> {
  return new Promise(resolve => {
    execFile(process.execPath, [SCRIPT], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 60_000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve({ leftOut: [], standIns: {}, problems: [`left-out list failed: ${err.message.slice(0, 200)}`] }); return }
      try {
        const raw = JSON.parse(stdout) as LeftOutList
        const standIns: Record<string, string> = {}
        for (const [from, to] of Object.entries(raw.standIns || {})) standIns[addressOf(from)] = addressOf(to)
        resolve({ leftOut: (raw.leftOut || []).map(addressOf), standIns, problems: raw.problems || [] })
      } catch (e) {
        resolve({ leftOut: [], standIns: {}, problems: [`left-out list unreadable: ${(e as Error).message}`] })
      }
    })
  })
}

/** The left-out list, worked out again only when a commit, a `git add` or the stand-ins changed. */
export function leftOutList(): Promise<LeftOutList> {
  const key = inputsKey()
  if (cached?.key === key) return cached.list
  const list = runScript()
  cached = { key, list }
  // a failed run is not kept: the next ask tries again
  void list.then(l => { if (!l.leftOut.length && l.problems.length && cached?.list === list) cached = null })
  return list
}

/** `browserChoice`: this browser's cookie ('on', 'off', or nothing to follow the switch). */
export async function shippedView(browserChoice: string | undefined | null, env: EnvLike = process.env): Promise<ShippedView> {
  if (!switchApplies(env)) return { applies: false, switchOn: false, on: false, leftOut: [], standIns: {}, problems: [] }
  const switchOn = readSwitch()
  const on = browserChoice === 'on' ? true : browserChoice === 'off' ? false : switchOn
  if (!on) return { applies: true, switchOn, on, leftOut: [], standIns: {}, problems: [] }
  const list = await leftOutList()
  return { applies: true, switchOn, on, ...list }
}

/** This browser's own choice from a request's cookies ('on', 'off' or null), for any Request. */
export function browserChoiceOf(request: { headers: { get(name: string): string | null } }): string | null {
  const match = /(?:^|;\s*)oasis-only-what-ships=(on|off)(?:;|$)/.exec(request.headers.get('cookie') || '')
  return match ? match[1] : null
}

/** A filter for lists of addresses: false for a left-out one while the view is on. */
export function shipsFilter(view: ShippedView): (url: string | undefined | null) => boolean {
  if (!view.on || !view.leftOut.length) return () => true
  const left = new Set(view.leftOut)
  return url => !url || !left.has(plainAddress(url))
}
