// What the summon circle may offer: Claude Code, Codex and Hermes, each live or with the one line that says what to
// install. The engine's `runtimes` command (Hermes builder, 28 Nov) is the answer; an engine without it falls back to
// the page server's own look at the disk (src/lib/village/runtime-check.ts via /api/local/summon-defaults).

import { useEffect, useState } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineRuntimeReport } from '../../lib/agent-engine-types'
import type { RuntimeReport } from '../../lib/village/runtime-check'

export type SummonRuntime = 'claude' | 'codex' | 'hermes'

/** A Codex villager's own look (CC0, its VRM says so), so it reads apart from a Claude one at a glance. */
export const CODEX_BODY = '/avatars/gallery/CosmicBot.vrm'

export interface KindState {
  /** null while nobody has answered yet. */
  ready: boolean | null
  /** The tile's second line. */
  line: string
  /** When not ready: the one line saying what to install or do. */
  missing: string
  /** Shown above the Summon button when ready (e.g. Codex's one-time setup on the first summon). */
  hint: string
  models: Array<{ value: string; displayName?: string }>
  /** Its own permission modes, [id, label], when the engine named them (Codex). */
  modes: Array<[string, string]>
  defaultMode: string
}

const LINES: Record<SummonRuntime, string> = {
  claude: 'Codes in a folder, on your Claude plan',
  codex: 'Codes in a folder, on your ChatGPT plan',
  hermes: 'Its own model, soul and memory',
}
/**
 * An engine without `runtimes` is older than 155648f0: it also lacks the fixed world gate (e1b91dab) and Codex's
 * one-time setup, so Codex is never offered on it (Hermes builder, 28 Nov 01:35).
 */
export const OLD_ENGINE_CODEX: Pick<KindState, 'line' | 'missing'> = {
  line: 'Restart the agent engine',
  missing: 'This engine is older than Codex support: restart it (Menu > Settings > Misc, Restart next to the agent engine), then summon Codex.',
}
const CODEX_SETUP_HINT = 'The first Codex summon sets Codex up for the Oasis once (a 540 MB download, a few minutes); it shows as starting until then.'

const checking = (kind: SummonRuntime): KindState => ({ ready: null, line: LINES[kind], missing: '', hint: '', models: [], modes: [], defaultMode: '' })

/**
 * The three tiles from the engine's report, else the page's own, else "checking". Codex comes from the page's own
 * report only once the engine has refused `runtimes` (an old engine); while its first answer is on the way, Codex
 * says "checking" (a new engine's first read takes a few seconds). Pure: tested.
 */
export function kindStates(engine: EngineRuntimeReport | null, page: RuntimeReport | null | undefined, engineRefused = true): Record<SummonRuntime, KindState> {
  const out = { claude: checking('claude'), codex: checking('codex'), hermes: checking('hermes') }
  if (engine && (engine.claude || engine.codex || engine.hermes)) {
    const c = engine.claude
    if (c) out.claude = c.found ? { ...out.claude, ready: true } : { ...out.claude, ready: false, line: 'Not installed', missing: c.install || 'Install Claude Code, then run `claude` once to sign in.' }
    const x = engine.codex
    if (x) {
      if (x.loggedIn) {
        out.codex = {
          ...out.codex,
          ready: true,
          hint: x.adapter && !x.adapter.found ? x.setup || CODEX_SETUP_HINT : '',
          models: (x.models?.list || []).map(model => ({ value: model.id, displayName: model.name })),
          modes: (x.modes || []).map(mode => [mode.id, mode.name || mode.id] as [string, string]),
          defaultMode: x.modes?.find(mode => mode.default)?.id || '',
        }
      }
      else out.codex = { ...out.codex, ready: false, line: x.found ? 'Sign in first' : 'Not installed', missing: (x.found ? x.login : x.install) || x.install || 'Install Codex (`npm install -g @openai/codex`), then run `codex login` once.' }
    }
    const h = engine.hermes
    if (h) out.hermes = h.found ? { ...out.hermes, ready: true } : { ...out.hermes, ready: false, line: 'Not installed', missing: h.install || 'Install Hermes Agent, then run `hermes setup` once.' }
    return out
  }
  if (page) {
    out.claude = page.claude.ready ? { ...out.claude, ready: true } : { ...out.claude, ready: false, line: 'Not installed', missing: page.claude.missing }
    // The engine did not answer `runtimes`: never Codex (see OLD_ENGINE_CODEX). What is missing on this computer
    // still comes first, so a newcomer learns the install line before the restart one.
    const x = page.codex
    if (!engineRefused) out.codex = out.codex
    else out.codex = x.ready || x.setup
      ? { ...out.codex, ready: false, ...OLD_ENGINE_CODEX }
      : { ...out.codex, ready: false, line: /sign in/i.test(x.missing) ? 'Sign in first' : 'Not installed', missing: x.missing }
    out.hermes = page.hermes.ready ? { ...out.hermes, ready: true } : { ...out.hermes, ready: false, line: 'Not installed', missing: page.hermes.missing }
  }
  return out
}

export interface EngineRuntimesView {
  /** The engine's last answer (kept across the polls), null until it answers. */
  report: EngineRuntimeReport | null
  /** The engine said it has no `runtimes` command: an engine older than Codex support. */
  refused: boolean
}

/** An engine's answer to a command it does not have (index.js: `unknown command <name>`). */
export function isUnknownCommand(error: unknown): boolean {
  return /unknown command/i.test(error instanceof Error ? error.message : String(error))
}

/** The engine's report while the menu is open, asked again every few seconds (a login or an install shows up by itself). */
export function useEngineRuntimes(open: boolean, connected: boolean, nonce = 0): EngineRuntimesView {
  const [view, setView] = useState<EngineRuntimesView>({ report: null, refused: false })
  useEffect(() => {
    if (!open || !connected) return
    let live = true
    let timer: number | undefined
    const ask = () => {
      getAgentEngineClient().cmd('runtimes', {}, { timeoutMs: 30_000 })
        .then(result => { if (live && result && typeof result === 'object') setView({ report: result, refused: false }) })
        // An old engine refuses the command; a slow first answer (a timeout) keeps "checking".
        .catch(error => { if (live && isUnknownCommand(error)) setView(current => ({ ...current, refused: true })) })
        .finally(() => { if (live) timer = window.setTimeout(ask, 5000) })
    }
    ask()
    return () => { live = false; window.clearTimeout(timer) }
  }, [open, connected, nonce])
  return view
}

/**
 * The runtime a newcomer's first agent (the Guide) runs on from the page server's own report: Claude Code when it is
 * there, else Codex, else none. (Here, not in runtime-check.ts: that file reads the disk and is server-only.)
 */
export function guideRuntime(report: Pick<RuntimeReport, 'claude' | 'codex'> | null | undefined): 'claude' | 'codex' | null {
  if (!report) return 'claude'
  if (report.claude.ready) return 'claude'
  if (report.codex.ready) return 'codex'
  return null
}
