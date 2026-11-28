// ░▒▓ RUNNING HELPERS FROM A SNAPSHOT — the helpers an agent has at work, known again after a page reload (pure) ▓▒░
// The owner, 27 Nov, at Tyler's: "I don't see this editor... Where is he? Does he exist?" Tyler's editors were
// background helpers started before his page last reloaded (his built copy switched in): a reload replays recent
// events, and a replayed helper start is not taken as running (it may have ended long ago), so they were invisible
// until they ended. Now the engine's snapshot of each agent lists its helpers that run (runningSubagents, Citizens'
// half), and the page takes it as the truth: one it does not know is added as running, one it thinks runs but the
// engine no longer lists has ended. Without the field (an older engine) nothing changes.

export interface RunningSubagentSnap {
  toolUseId?: string | null
  taskId?: string | null
  description?: string | null
  subagentType?: string | null
  /** When it started (the engine's clock); else the snapshot's time. */
  startedAt?: number | null
}

export interface SubagentLike {
  key: string
  toolUseId: string | null
  taskId: string | null
  description: string
  subagentType: string | null
  status: string
  startedAt: number
  endedAt?: number
  summary?: string
  lastToolName?: string
}

const idOf = (snap: RunningSubagentSnap) => snap.toolUseId || snap.taskId || null
const sameAs = (sub: SubagentLike, snap: RunningSubagentSnap) =>
  sub.key === idOf(snap) || Boolean(snap.taskId && sub.taskId === snap.taskId) || Boolean(snap.toolUseId && sub.toolUseId === snap.toolUseId)

/** The helpers after a snapshot that lists `running`. The same array back when nothing changed. */
export function mergeRunningSubagents<T extends SubagentLike>(current: readonly T[], running: readonly RunningSubagentSnap[], at: number): T[] {
  let changed = false
  const out = current.map(sub => {
    if (sub.status !== 'running') return sub
    if (running.some(snap => sameAs(sub, snap))) return sub
    // It ended while this page did not hear it (a reload, a dropped socket).
    changed = true
    return { ...sub, status: 'completed', endedAt: at }
  })
  for (const snap of running) {
    const id = idOf(snap)
    if (!id) continue
    const known = out.findIndex(sub => sameAs(sub, snap))
    if (known >= 0) {
      if (out[known].status !== 'running') {
        out[known] = { ...out[known], status: 'running', endedAt: undefined, summary: undefined }
        changed = true
      }
      continue
    }
    out.push({
      key: id,
      toolUseId: snap.toolUseId || null,
      taskId: snap.taskId || null,
      description: snap.description || 'helper',
      subagentType: snap.subagentType || null,
      status: 'running',
      startedAt: typeof snap.startedAt === 'number' && Number.isFinite(snap.startedAt) ? snap.startedAt : at,
    } as T)
    changed = true
  }
  return changed ? out : (current as T[])
}

const TOOL_WORDS: Record<string, string> = {
  Bash: 'running a command', PowerShell: 'running a command', Read: 'reading', Edit: 'editing', MultiEdit: 'editing',
  Write: 'writing a file', NotebookEdit: 'editing a notebook', Grep: 'searching', Glob: 'looking for files',
  WebFetch: 'reading a web page', WebSearch: 'searching the web', Agent: 'starting a helper', Task: 'starting a helper',
  TodoWrite: 'planning', Skill: 'using a skill', ToolSearch: 'looking for a tool',
}

/** The line under a working helper's name: what it does now, in a few plain words ("running a command"). */
export function helperStatusLine(lastToolName: string | null | undefined): string {
  const name = (lastToolName || '').trim()
  if (!name) return 'starting'
  if (TOOL_WORDS[name]) return TOOL_WORDS[name]
  // An MCP tool (mcp__oasis__place_object): its own name, in words.
  const bare = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name
  return bare.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}
