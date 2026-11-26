// ░▒▓ WORK BOOK GUARD — the owner's work book must not be lost again ▓▒░
// On 24 Nov at 23:37 and 23:45 a test run wrote its own throwaway book over data/work-vow.local.json: the vow week, the
// record days and most of Tuesday were gone (Anorak, 25 Nov). From then on:
//   · under a test runner, the book is never written outside the system's temp folder (the test then fails loudly);
//   · the live book (data/work-vow.local.json) is written only by the page server (NEXT_RUNTIME) or by a process that
//     says so on purpose (OASIS_WORK_VOW_WRITER=1, e.g. the rebuild of lost days);
//   · a write that would drop a day the file already holds is refused and logged;
//   · a copy is kept every day and at each start of the page server, outside the repository, thirty kept.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Env = Record<string, string | undefined>

export function liveBookPath(cwd = process.cwd()): string {
  return path.join(cwd, 'data', 'work-vow.local.json')
}

export function isTestRun(env: Env = process.env): boolean {
  return Boolean(env.VITEST || env.VITEST_WORKER_ID || env.JEST_WORKER_ID || env.NODE_ENV === 'test')
}

function inside(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target))
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Why this process may not write the book at `target`; null: it may. */
export function bookWriteRefusal(target: string, env: Env = process.env, cwd = process.cwd(), tmp = os.tmpdir()): string | null {
  if (isTestRun(env) && !inside(tmp, target)) return `a test run may not write the work book outside the temp folder (${target})`
  const live = path.resolve(target) === path.resolve(liveBookPath(cwd))
  if (live && !env.NEXT_RUNTIME && env.OASIS_WORK_VOW_WRITER !== '1') return `only the page server writes the live work book (${target}); set OASIS_WORK_VOW_WRITER=1 to write it on purpose`
  return null
}

/** Days in `before` that `after` would lose (a write that drops them is refused). */
export function droppedDays(before: { days?: Record<string, unknown> } | null, after: { days?: Record<string, unknown> }): string[] {
  if (!before?.days) return []
  return Object.keys(before.days).filter(date => !(date in (after.days || {})))
}

export function backupDir(env: Env = process.env): string {
  return env.OASIS_WORK_BACKUP_DIR || path.join(os.homedir(), 'oasis-backups', 'work-book')
}

const KEEP = 30
const holder = globalThis as unknown as { __oasisWorkBackupDay?: string; __oasisWorkBackupStart?: boolean }

function stamp(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`
}

/**
 * A copy of the live book before a write: at the first write of each day and at the first write after the page server
 * started. Only for the live book, never in a test. Never throws (a failed copy is logged; the write goes on).
 */
/**
 * The owner's private brain folder, if this machine has one that is a git repository: the folder above the missions
 * folder (Settings or OASIS_MISSIONS_DIR), or OASIS_WORK_GIT_BACKUP_DIR. Null on a machine without one
 * (the packaged Oasis never writes outside itself).
 */
export async function brainBackupDir(env: Env = process.env, missions?: string, cwd = process.cwd()): Promise<string | null> {
  if (env.OASIS_WORK_GIT_BACKUP_DIR) return env.OASIS_WORK_GIT_BACKUP_DIR
  if (!missions) return null
  const root = path.resolve(missions, '..', '..')
  // Never the Oasis's own folder: a packaged Oasis keeps its missions in <app>/data/missions, and a clone has a .git there
  // (Merge Goat, 25 Nov): the copy would land inside the newcomer's own repository.
  const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (same(path.resolve(root), path.resolve(cwd))) return null
  try {
    await fs.access(path.join(root, '.git'))
    return path.join(root, 'data-backups', 'work-book')
  } catch {
    return null
  }
}

/**
 * One copy a day into the brain folder's git repository (the owner, 2026-11-25: "I thought we were using Git... so this is
 * like a backup"): work-vow.YYYY-MM-DD.json, refreshed at most once an hour so the day's file holds its latest state when
 * the folder is committed; thirty days kept. Never throws.
 */
export async function brainCopy(target: string, dir: string, now = new Date()): Promise<string | null> {
  try {
    const two = (n: number) => String(n).padStart(2, '0')
    const name = `work-vow.${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(target, path.join(dir, name))
    const copies = (await fs.readdir(dir)).filter(f => /^work-vow\.\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    for (const old of copies.slice(0, Math.max(0, copies.length - KEEP))) await fs.rm(path.join(dir, old), { force: true })
    return name
  } catch (error) {
    console.error(`[work book] copy into the brain folder failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const brainHolder = globalThis as unknown as { __oasisWorkBrainCopyAt?: number }

export async function backupBeforeWrite(target: string, env: Env = process.env, cwd = process.cwd(), missions?: string): Promise<string | null> {
  if (isTestRun(env) || path.resolve(target) !== path.resolve(liveBookPath(cwd))) return null
  // Into the brain folder's git history, at most once an hour.
  if (!brainHolder.__oasisWorkBrainCopyAt || Date.now() - brainHolder.__oasisWorkBrainCopyAt >= 3600_000) {
    brainHolder.__oasisWorkBrainCopyAt = Date.now()
    const dir = await brainBackupDir(env, missions)
    if (dir) await brainCopy(target, dir)
  }
  const today = stamp().slice(0, 8)
  if (holder.__oasisWorkBackupStart && holder.__oasisWorkBackupDay === today) return null
  try {
    const dir = backupDir(env)
    await fs.mkdir(dir, { recursive: true })
    const name = `work-vow.${stamp()}${holder.__oasisWorkBackupStart ? '' : '.start'}.json`
    await fs.copyFile(target, path.join(dir, name)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    holder.__oasisWorkBackupStart = true
    holder.__oasisWorkBackupDay = today
    const copies = (await fs.readdir(dir)).filter(f => /^work-vow\.\d{8}-\d{4}.*\.json$/.test(f)).sort()
    for (const old of copies.slice(0, Math.max(0, copies.length - KEEP))) await fs.rm(path.join(dir, old), { force: true })
    return name
  } catch (error) {
    console.error(`[work book] backup failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
