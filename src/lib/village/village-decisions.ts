// What the owner reviews before approving a tool call. Pure helpers for the decision cards.
//
// Security rule (review 2026-11-03, item 1): an approval must never sit next to a clipped command.
// The panel shows the whole input; the small desk card shows no approve buttons at all.

/** The engine marks clipped strings with "… [+N chars]" (normalize.js clip()). */
const CLIP_MARKER = /… \[\+(\d+) chars\]/g

/** Everything the tool will receive, as the owner should read it. Never shortened here. */
export function permissionReviewText(toolName: string, input: unknown): string {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const parts: string[] = []
  if (typeof value.command === 'string') parts.push(value.command)
  if (typeof value.file_path === 'string') parts.push(`file: ${value.file_path}`)
  if (typeof value.notebook_path === 'string') parts.push(`notebook: ${value.notebook_path}`)
  if (typeof value.url === 'string') parts.push(`url: ${value.url}`)
  if (typeof value.old_string === 'string') parts.push(`replace:\n${value.old_string}`)
  if (typeof value.new_string === 'string') parts.push(`with:\n${value.new_string}`)
  if (typeof value.content === 'string') parts.push(`content:\n${value.content}`)
  const shown = new Set(['command', 'file_path', 'notebook_path', 'url', 'old_string', 'new_string', 'content'])
  const rest = Object.fromEntries(Object.entries(value).filter(([key]) => !shown.has(key)))
  if (Object.keys(rest).length || !parts.length) {
    let json = ''
    try { json = JSON.stringify(parts.length ? rest : input, null, 2) } catch { json = String(input) }
    if (json && json !== '{}') parts.push(parts.length ? `other input:\n${json}` : json)
  }
  return parts.join('\n\n') || `${toolName} (no input)`
}

/** Characters the engine left out of this input (0 = nothing hidden). */
export function clippedCharacters(input: unknown): number {
  let total = 0
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return
    if (typeof value === 'string') {
      for (const match of value.matchAll(CLIP_MARKER)) total += Number(match[1]) || 0
    } else if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(item => visit(item, depth + 1))
    }
  }
  visit(input, 0)
  return total
}

interface PermissionRule { toolName?: string; ruleContent?: string }

/** One "allow always" suggestion from the CLI, in words. */
export function describeSuggestion(suggestion: unknown): string {
  const s = (suggestion && typeof suggestion === 'object' ? suggestion : {}) as Record<string, unknown>
  const where = typeof s.destination === 'string' ? ` (${s.destination})` : ''
  switch (s.type) {
    case 'setMode':
      return `switch to "${String(s.mode)}" mode${where}`
    case 'addRules':
    case 'replaceRules': {
      const rules = Array.isArray(s.rules) ? (s.rules as PermissionRule[]) : []
      const list = rules.map(rule => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : String(rule.toolName))).join(', ')
      return `${String(s.behavior || 'allow')} ${list || 'rules'}${where}`
    }
    case 'addDirectories': {
      const dirs = Array.isArray(s.directories) ? s.directories.map(String).join(', ') : ''
      return `allow access to ${dirs || 'more folders'}${where}`
    }
    default: {
      try { return JSON.stringify(suggestion) } catch { return String(suggestion) }
    }
  }
}

// ─── why Claude Code asks, in plain words (the owner, 26 Nov: prompts in bypass he could not read) ──────────────
// Claude Code's own safety checks (a delete it cannot name in advance, a delete of its working folder) ask even in
// bypass and auto, and cannot be remembered. The request carries decision_reason ("Dangerous rm operation on
// statically-unresolvable target: C:\box\*") and type "safetyCheck". Same words as the engine's
// packages/oasis-agent-engine/src/permission-reason.js (its Telegram ping); a test keeps the two together.

/** The reason in plain words, or null when the request carries none. */
export function plainPermissionReason(reason: unknown, type?: unknown): string | null {
  const text = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : ''
  if (!text) return null
  if (/dangerous rm/i.test(text)) {
    if (/working directory or its ancestor/i.test(text)) return 'wants to delete its working folder or a folder above it'
    if (/statically[- ]unresolvable|cannot be statically resolved|command substitution|cannot be checked/i.test(text)) return 'wants to delete files it cannot name in advance'
    if (/critical system directory/i.test(text)) return 'wants to delete a whole top-level folder'
    return 'wants to delete something Claude Code always asks about'
  }
  const clipped = text.length > 200 ? `${text.slice(0, 199)}…` : text
  return type === 'safetyCheck' ? `Claude Code's safety check asks: ${clipped}` : clipped
}

/** The card's first line: the plain reason, then the whole command on one line; else null (the summary stays). */
export function permissionHeadline(toolName: string, input: unknown, reason: unknown, type?: unknown): string | null {
  const plain = plainPermissionReason(reason, type)
  if (!plain) return null
  const value = input && typeof input === 'object' ? (input as { command?: unknown }) : {}
  const command = typeof value.command === 'string' ? value.command.replace(/\s+/g, ' ').trim() : ''
  return command ? `${plain}: ${command.length > 300 ? `${command.slice(0, 299)}…` : command}` : plain
}

/** What a permission card leads with: Claude Code's reason when it gave one, else the engine's summary (tool and command). */
export function permissionLead(decision: { toolName: string; input?: unknown; summary?: string; decisionReason?: unknown; decisionReasonType?: unknown }): string {
  return permissionHeadline(decision.toolName, decision.input, decision.decisionReason, decision.decisionReasonType) || decision.summary || decision.toolName
}

/** A permission open this long reaches him again (a chime and a notice): one sat 3 h 20 min on 26 Nov. */
export const PERMISSION_REMIND_MS = 10 * 60_000

/** The few words over a waiting agent's head (Companion's sign): what it needs from him, by kind. */
export function permissionSign(decision: { requestKind?: string; toolName?: string; input?: unknown; decisionReason?: unknown }): string {
  if (decision.requestKind === 'question') return 'has a question for you'
  if (decision.requestKind === 'plan') return 'has a plan for you to approve'
  const reason = typeof decision.decisionReason === 'string' ? decision.decisionReason : ''
  if (/dangerous rm/i.test(reason)) {
    if (/working directory or its ancestor/i.test(reason)) return 'needs your yes: delete its working folder'
    if (/critical system directory/i.test(reason)) return 'needs your yes: delete a top-level folder'
    return 'needs your yes: delete files'
  }
  const input = (decision.input && typeof decision.input === 'object' ? decision.input : {}) as { file_path?: unknown }
  const file = typeof input.file_path === 'string' ? input.file_path.split(/[\\/]/).pop() : ''
  switch (decision.toolName) {
    case 'Bash': case 'PowerShell': return 'needs your yes: run a command'
    case 'Write': return file ? `needs your yes: write ${file}` : 'needs your yes: write a file'
    case 'Edit': case 'NotebookEdit': return file ? `needs your yes: edit ${file}` : 'needs your yes: edit a file'
    case 'WebFetch': return 'needs your yes: open a web page'
    case 'WebSearch': return 'needs your yes: search the web'
    default: return decision.toolName ? `needs your yes: ${decision.toolName}` : 'needs your yes'
  }
}
