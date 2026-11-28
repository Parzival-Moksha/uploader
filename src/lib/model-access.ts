// ░▒▓ MODEL ACCESS — which ways to a model this machine has ▓▒░
// The owner, 27 Nov: "the first thing that Anorak, or whoever welcomes the adventurers in the Oasis, should
// check: do we got Codex, do we got Claude Code", plus an OpenRouter key; models are offered from that and
// greyed out without. One answer, from the Keychain's own scan (keychain-server.ts: `claude auth status`,
// `codex login status`, the Oasis's environment), so the craft model list, the Keychain and onboarding never
// disagree, and the CLIs run once per scan, not once per asker. Names and yes/no only; never a value.

import { keychainFacts, type KeychainPaths, type RunCommand } from './keychain-server'
import type { KeychainFacts } from './village/keychain'

export interface ModelAccess {
  /** Claude Code is installed and signed in (a Claude plan, or its own API key). */
  claudeCode: boolean
  /** Codex is installed and signed in (a ChatGPT plan or an OpenAI key). */
  codex: boolean
  /** How Codex is signed in: 'chatgpt' (a plan), 'api-key', or '' (unknown / not signed in). */
  codexMethod: string
  /** OPENROUTER_API_KEY is set in the Oasis's environment (any model through OpenRouter). */
  openrouter: boolean
  /** Any one of the three: without, model choices are greyed out. */
  any: boolean
  /** When the scan behind this answer ran (ms). */
  checkedAt: number
}

/** The answer from a scan's facts (pure: tested without a machine). */
export function modelAccessFrom(facts: Pick<KeychainFacts, 'logins' | 'environment'>, checkedAt = 0): ModelAccess {
  const claudeCode = facts.logins.claude?.loggedIn === true
  const codex = facts.logins.codex?.loggedIn === true
  const openrouter = facts.environment.includes('OPENROUTER_API_KEY')
  return {
    claudeCode,
    codex,
    codexMethod: codex ? facts.logins.codex?.method || '' : '',
    openrouter,
    any: claudeCode || codex || openrouter,
    checkedAt,
  }
}

/** This machine's answer. `fresh`: look again now (honoured at most every few seconds; a scan starts the CLIs). */
export async function modelAccess(options: { fresh?: boolean; paths?: KeychainPaths; run?: RunCommand; env?: NodeJS.ProcessEnv } = {}): Promise<ModelAccess> {
  const entry = await keychainFacts(options)
  return modelAccessFrom(entry.facts, entry.at)
}
