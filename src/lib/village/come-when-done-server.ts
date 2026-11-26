// ░▒▓ COME WHEN DONE (server) — the file on disk, changed one write at a time ▓▒░
// data/village-come.local.json (git-ignored like the other *.local.json; OASIS_VILLAGE_COME_FILE overrides).
// The rules: lib/village/come-when-done.ts.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { EMPTY_COME, applyComeOp, isComeKey, parseComeFile, type ComeFile, type ComeOp, type ComeResult } from '@/lib/village/come-when-done'

export function comeFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.OASIS_VILLAGE_COME_FILE || path.join(process.cwd(), 'data', 'village-come.local.json')
}

export async function readCome(file = comeFilePath()): Promise<ComeFile> {
  try {
    return parseComeFile(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return { ...EMPTY_COME, asked: {}, coming: {}, calls: {} }
  }
}

// One change at a time: the owner's pages and the agents' scripts never lose each other's change.
let chain: Promise<unknown> = Promise.resolve()

export class ComeError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** A client's op, checked (POST /api/village/come). */
export function cleanComeOp(raw: unknown): ComeOp {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const agent = body.agent
  if (!isComeKey(agent)) throw new ComeError('agent is needed (its session id)')
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  switch (body.op) {
    case 'ask': return { op: 'ask', agent, on: body.on !== false, what: text(body.what) }
    case 'later': return { op: 'later', agent }
    case 'done': {
      const turnAt = Number(body.turnAt)
      if (!Number.isFinite(turnAt)) throw new ComeError('done needs turnAt (ms)')
      return { op: 'done', agent, turnAt, error: body.error === true }
    }
    case 'call': return { op: 'call', agent, why: text(body.why) }
    case 'clear': return { op: 'clear', agent }
    default: throw new ComeError(`unknown op "${String(body.op ?? '')}" (ask, later, done, call, clear)`)
  }
}

/** Applies the ops in order; written only when something changed. */
export async function applyComeOps(ops: ComeOp[], file = comeFilePath()): Promise<{ file: ComeFile; results: ComeResult[] }> {
  const job = chain.then(async () => {
    const before = await readCome(file)
    let next = before
    const results: ComeResult[] = []
    const now = Date.now()
    for (const op of ops) {
      const r = applyComeOp(next, op, now)
      next = r.file
      results.push(r.result)
    }
    if (next !== before) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(temp, `${JSON.stringify(next, null, 1)}\n`, 'utf8')
      await fs.rename(temp, file)
    }
    return { file: next, results }
  })
  chain = job.catch(() => {})
  return job
}
