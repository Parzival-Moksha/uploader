// ░▒▓ CARBON, SERVER SIDE — the questions folder, its board, and telling an agent through the engine ▓▒░
// Shared by /api/village/questions (his answers) and the work book (his own missions, work-vow-server.ts).

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { missionsDir } from '../oasis-settings'
import { askingAgent } from './carbon-missions'

/** OASIS_QUESTIONS_DIR, else `questions` next to the missions folder. */
export function questionsDir(): string {
  // A test run without its own redirect fails here instead of reaching his list (src/test-utils/data-fence.ts).
  if (!process.env.OASIS_QUESTIONS_DIR && (process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test')) throw new Error('a test run must set OASIS_QUESTIONS_DIR (the data fence does)')
  return process.env.OASIS_QUESTIONS_DIR || path.join(path.dirname(missionsDir()), 'questions')
}

/**
 * open.md is written from these files by the questions board script. It refuses to overwrite an
 * open.md someone typed into below its end marker; that is fine: the answer is in the file either way.
 */
export function rewriteBoard(): Promise<string> {
  const script = path.join(path.dirname(path.dirname(questionsDir())), 'scripts', 'questions_board.py')
  return new Promise(resolve => {
    fs.access(script).then(() => {
      execFile(process.env.OASIS_PYTHON || 'python', [script], { timeout: 15_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, _out, stderr) => {
        resolve(error ? `board not rewritten: ${(stderr || error.message).trim().split(/\r?\n/).pop()}` : 'board rewritten')
      })
    }, () => resolve('no board script'))
  })
}

export type EngineAgent = { id: string; name: string }
export type Engine = { base: string; headers: Record<string, string>; agents: EngineAgent[]; error?: string }

/** The engine's address, its key, and who is in the village now. Never throws: no engine is an empty village. */
export async function engine(): Promise<Engine> {
  const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  try {
    const tokenFile = process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token')
    const token = (await fs.readFile(tokenFile, 'utf8').catch(() => '')).trim()
    if (token) headers['x-oasis-token'] = token
    const list = await (await fetch(`${base}/api/agents`, { headers, signal: AbortSignal.timeout(4000) })).json() as Array<{ id: string; name?: string }> | { agents?: Array<{ id: string; name?: string }> }
    return { base, headers, agents: (Array.isArray(list) ? list : list.agents || []).map(a => ({ id: a.id, name: a.name || '' })) }
  } catch (error) {
    return { base, headers, agents: [], error: `engine not reached: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function send(e: Engine, agent: EngineAgent, text: string): Promise<boolean> {
  try {
    const response = await fetch(`${e.base}/api/cmd`, { method: 'POST', headers: e.headers, body: JSON.stringify({ cmd: 'send', agentId: agent.id, text, priority: 'later', source: 'Mindcraft' }), signal: AbortSignal.timeout(6000) })
    return response.ok
  } catch {
    return false
  }
}

/** Tell the agent named `by` (else Anorak) through the agent engine. Never throws. */
export async function tellAgent(by: string, text: string): Promise<string> {
  const e = await engine()
  if (e.error) return e.error
  const target = askingAgent(by, e.agents)
  if (!target) return 'no such agent, and no Anorak in the village'
  return (await send(e, target, text)) ? `sent to ${target.name}` : 'the engine did not take it'
}
