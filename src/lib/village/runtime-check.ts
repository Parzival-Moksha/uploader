// Which agent runtimes this machine can summon, read from disk (no process started): the summon menu's Claude Code,
// Codex and Hermes tiles go live from this, and say in one line what to install when one is missing.
//
// It mirrors where the agent engine looks (packages/oasis-agent-engine/src/claude.js resolveClaude, hermes.js
// ACP_RUNTIMES and hermesCommand); keep the two in step. Codex runs through the Apache-2.0 adapter
// @agentclientprotocol/codex-acp (it carries its own Codex CLI) on the person's own Codex login (~/.codex/auth.json,
// written by `codex login`) or an API key; the engine hides the adapter's browser sign-in, so a login must exist.

import fs from 'fs'
import os from 'os'
import path from 'path'

export type RuntimeId = 'claude' | 'codex' | 'hermes'

export interface RuntimeState {
  /** Ready to summon from the circle. */
  ready: boolean
  /** One line for the tile when it is not ready (what to install or do), '' when ready. */
  missing: string
  /** A step the Oasis can do itself (POST /api/local/runtime-setup), when that is all that is missing. */
  setup?: 'codex-adapter'
  /** Shown under the name when ready: where it signs in, for example. */
  detail?: string
}

export type RuntimeReport = Record<RuntimeId, RuntimeState>

/** The adapter version the Oasis installs (the one checked against the engine, 28 Nov 2026). */
export const CODEX_ADAPTER = '@agentclientprotocol/codex-acp@2.12.1'
/** Where the Oasis installs it (the engine looks here first). */
export function codexAdapterHome(home = os.homedir()): string {
  return path.join(home, '.oasis', 'runtimes', 'codex-acp')
}

interface Env { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; exists: (file: string) => boolean; read: (file: string) => string }

const realEnv = (): Env => ({
  platform: process.platform,
  home: os.homedir(),
  env: process.env,
  exists: (file) => { try { return fs.existsSync(file) } catch { return false } },
  read: (file) => { try { return fs.readFileSync(file, 'utf8') } catch { return '' } },
})

function onPath(e: Env, names: string[]): string {
  const dirs = (e.env.PATH || e.env.Path || '').split(e.platform === 'win32' ? ';' : ':').filter(Boolean)
  for (const dir of dirs) for (const name of names) {
    const file = path.join(dir, name)
    if (e.exists(file)) return file
  }
  return ''
}

function appData(e: Env): string {
  return e.env.APPDATA || path.join(e.home, 'AppData', 'Roaming')
}

export function claudeState(e: Env = realEnv()): RuntimeState {
  const names = e.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const found = Boolean(e.env.OASIS_CLAUDE_BIN) || Boolean(onPath(e, names))
    || e.exists(path.join(e.home, '.local', 'bin', e.platform === 'win32' ? 'claude.exe' : 'claude'))
  if (!found) return { ready: false, missing: 'Install Claude Code (`npm install -g @anthropic-ai/claude-code`), then run `claude` once to sign in.' }
  return { ready: true, missing: '' }
}

function codexAdapterFound(e: Env): boolean {
  if (e.env.OASIS_CODEX_BIN) return true
  const inside = ['node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js']
  return e.exists(path.join(codexAdapterHome(e.home), ...inside)) || e.exists(path.join(appData(e), 'npm', ...inside))
}

/** The Codex login the adapter will use: ChatGPT (~/.codex/auth.json) or an API key, '' when there is none. */
export function codexLogin(e: Env = realEnv()): string {
  if (e.env.CODEX_API_KEY || e.env.OPENAI_API_KEY) return 'an OpenAI API key'
  const codexHome = e.env.CODEX_HOME || path.join(e.home, '.codex')
  const text = e.read(path.join(codexHome, 'auth.json'))
  if (!text) return ''
  try {
    const auth = JSON.parse(text) as { auth_mode?: string; OPENAI_API_KEY?: string | null; tokens?: unknown }
    if (auth.tokens) return 'your ChatGPT login'
    if (auth.OPENAI_API_KEY) return 'an OpenAI API key'
  } catch { /* not JSON: no usable login */ }
  return ''
}

export function codexState(e: Env = realEnv()): RuntimeState {
  const login = codexLogin(e)
  const cli = Boolean(onPath(e, e.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex']))
  if (!login) {
    return { ready: false, missing: cli ? 'Sign in to Codex once: run `codex login` in a terminal.' : 'Install Codex (`npm install -g @openai/codex`), then run `codex login` once.' }
  }
  if (!codexAdapterFound(e)) {
    return { ready: false, missing: 'One step left: the Oasis installs its Codex bridge (about 540 MB, a few minutes).', setup: 'codex-adapter', detail: login }
  }
  return { ready: true, missing: '', detail: `on ${login}` }
}

export function hermesState(e: Env = realEnv()): RuntimeState {
  if (e.env.OASIS_HERMES_BIN) return { ready: true, missing: '' }
  const local = e.env.LOCALAPPDATA || path.join(e.home, 'AppData', 'Local')
  const candidates = e.platform === 'win32'
    ? [path.join(local, 'hermes', 'bin', 'hermes.exe'), path.join(local, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')]
    : [path.join(e.home, '.hermes', 'bin', 'hermes'), path.join(e.home, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes')]
  const found = candidates.some(e.exists) || Boolean(onPath(e, e.platform === 'win32' ? ['hermes.exe', 'hermes.cmd'] : ['hermes']))
  // The installer lines from Hermes Agent's own README (Quick Install), read 28 Nov 2026.
  const install = e.platform === 'win32'
    ? 'iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)'
    : 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'
  if (!found) return { ready: false, missing: `Install Hermes Agent (\`${install}\`), then run \`hermes setup\` once.` }
  return { ready: true, missing: '' }
}

export function runtimeReport(e: Env = realEnv()): RuntimeReport {
  return { claude: claudeState(e), codex: codexState(e), hermes: hermesState(e) }
}
