// ░▒▓ CRAFT MODELS — who writes the primitives for text-to-3D (Craft) ▓▒░
// Claude Code first: Opus 5.5 and Fable 5.2 through the owner's own Claude Code login (craft-claude-code.ts,
// local only). Then OpenRouter (the owner, 27 Nov: "we are November 2026... Gemini 4 Neon, GPT 6.2 Sol, GPT 6.2 Astra,
// DeepSeek V4.1 1017... gemini 3.1, 3.5, Jesus, this is so old, those go"): OpenRouter's newest, each checked on
// 27 Nov 2026 to answer a craft-shaped request with clean JSON. Which ones a machine can use: craftModelAvailability.
// normalizeCraftModelId keeps its old meaning for the OpenRouter-only routes (terrain, vibecode, /api/craft):
// a Claude Code choice falls back to the OpenRouter default there. The picker uses normalizeCraftChoice.

export type CraftModelProvider = 'claude-code' | 'openrouter'

export interface CraftModelOption {
  id: string
  label: string
  provider: CraftModelProvider
  /** Claude Code: the model the CLI runs. */
  cliModel?: string
}

export const CRAFT_MODEL_OPTIONS: readonly CraftModelOption[] = [
  { id: 'cc-opus-5-5', label: 'Claude Code · Opus 5.5', provider: 'claude-code', cliModel: 'claude-opus-5-5' },
  { id: 'cc-fable-5-2', label: 'Claude Code · Fable 5.2', provider: 'claude-code', cliModel: 'claude-fable-5-2' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', provider: 'openrouter' },
  { id: 'anthropic/claude-fable-5.2', label: 'Claude Fable 5.2', provider: 'openrouter' },
  { id: 'openai/gpt-6.2-astra', label: 'GPT-6.2 Astra', provider: 'openrouter' },
  { id: 'openai/gpt-6.2-sol', label: 'GPT-6.2 Sol', provider: 'openrouter' },
  { id: 'google/gemini-4-neon', label: 'Gemini 4 Neon', provider: 'openrouter' },
  { id: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', provider: 'openrouter' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', provider: 'openrouter' },
  { id: 'qwen/qwen4-max', label: 'Qwen4 Max', provider: 'openrouter' },
  { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi K3.1 Pro', provider: 'openrouter' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', provider: 'openrouter' },
  { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', provider: 'openrouter' },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', provider: 'openrouter' },
]

export type CraftModelId = string

/** What the craft picker starts on: Claude Code with Opus 5.5. */
export const DEFAULT_CRAFT_CHOICE = 'cc-opus-5-5'
/** The OpenRouter routes' default (and what a hosted visitor's Claude Code choice crafts with). */
export const DEFAULT_CRAFT_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

/** OpenRouter model ids (what the OpenRouter routes accept). */
export const ALLOWED_CRAFT_MODELS: readonly string[] = CRAFT_MODEL_OPTIONS.filter(option => option.provider === 'openrouter').map(option => option.id)

/** Earlier Claude Code ids: they meant Opus or Sonnet through the CLI. */
const LEGACY_CLAUDE_CODE = new Set(['cc-opus', 'cc-sonnet', 'opus', 'sonnet'])

const REMOVED_CRAFT_MODELS = new Set([
  // Left the list on 27 Nov 2026 (older generations); a saved choice of one crafts with the default.
  'google/gemini-3.8-flash',
  'openai/gpt-5.6-terra',
  'minimax/minimax-m3',
  'deepseek/deepseek-v4.1-flash',
  'google/gemini-3.1-flash-lite',
  'google/gemini-3.5-flash',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4',
  'qwen/qwen3.5-397b-a17b',
  'minimax/minimax-m2.7',
  'google/gemini-3.1-flash-lite-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'x-ai/grok-4.20-beta',
  'liquid/lfm-2-24b-a2b',
  'z-ai/glm-5',
  'nvidia/nemotron-3-super-120b-a12b:free',
])

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** For the OpenRouter routes: an allowed OpenRouter id, else the OpenRouter default. */
export function normalizeCraftModelId(value: unknown): string {
  const requested = clean(value)
  if (!requested || REMOVED_CRAFT_MODELS.has(requested)) return DEFAULT_CRAFT_MODEL
  return ALLOWED_CRAFT_MODELS.includes(requested) ? requested : DEFAULT_CRAFT_MODEL
}

/** For the picker: any listed model (Claude Code included), earlier Claude Code ids as Opus 5.5, else the default. */
export function normalizeCraftChoice(value: unknown): string {
  const requested = clean(value)
  if (LEGACY_CLAUDE_CODE.has(requested)) return DEFAULT_CRAFT_CHOICE
  return CRAFT_MODEL_OPTIONS.some(option => option.id === requested) ? requested : DEFAULT_CRAFT_CHOICE
}

/** The CLI model when this choice crafts through Claude Code, else null. */
export function claudeCodeCraftModel(value: unknown): string | null {
  const requested = clean(value)
  if (LEGACY_CLAUDE_CODE.has(requested)) return 'claude-opus-5-5'
  return CRAFT_MODEL_OPTIONS.find(option => option.id === requested && option.provider === 'claude-code')?.cliModel || null
}

/** The ways to a model this machine has (src/lib/model-access.ts), as the craft list needs them. */
export interface CraftAccess {
  claudeCode: boolean
  openrouter: boolean
}

/** Can this choice craft here, and if not, why (one plain line for the greyed-out entry)? */
export function craftModelAvailability(option: CraftModelOption, access: CraftAccess): { available: boolean; why: string } {
  if (option.provider === 'claude-code') {
    return access.claudeCode ? { available: true, why: '' } : { available: false, why: 'Needs Claude Code signed in on this machine' }
  }
  return access.openrouter ? { available: true, why: '' } : { available: false, why: 'Needs an OpenRouter key (Keychain)' }
}

/** The choice to craft with: the one asked for when it can run here, else the first that can, else the one asked for. */
export function usableCraftChoice(requested: unknown, access: CraftAccess): string {
  const wanted = normalizeCraftChoice(requested)
  const option = CRAFT_MODEL_OPTIONS.find(entry => entry.id === wanted)
  if (option && craftModelAvailability(option, access).available) return wanted
  return CRAFT_MODEL_OPTIONS.find(entry => craftModelAvailability(entry, access).available)?.id || wanted
}
