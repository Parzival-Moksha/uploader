// ░▒▓ THE CHATGPT PLAN AS A PICTURE MODEL ▓▒░
// The owner's wish (11 Nov 2026): his village's pictures come from his own ChatGPT plan through the Codex CLI
// (src/lib/codex-image.ts, OpenAI's GPT Image 2) instead of Nano Banana on OpenRouter. Whose plan pays is the whole
// question, so it is fenced, and every picture path (the spell tabs, the Wizard console, the agents' tools through
// /api/media/image) goes through /api/imagine, which asks here:
//   - only a request from this machine's own page or its own agents: checkAgentRequest (loopback, never cross-site,
//     never the hosted Oasis, never a party or `pnpm dev:lan`, which run with OASIS_LAN=1), plus the local key that
//     src/middleware.ts asks for on every /api request when the Oasis runs with one;
//   - only when a Codex CLI is installed and signed in on this machine;
//   - only in an edition that carries the Codex path. The package leaves it out (scripts/slim/cut.config.mjs:
//     codex-image.ts excluded, the import line below replaced). Settled, not pending: Anorak's ruling of 27 Nov from
//     OpenAI's own pages (research note 2026-11-27_codex-plan-pictures-terms.md); reopened only by new sentences from OpenAI.
// The default model: the plan in the owner's own workshop, where it is available; Nano Banana 2 everywhere else.
// The package's cut also turns PLAN_IS_DEFAULT_HERE off (belt and braces).

import { checkAgentRequest } from './local-request-guard'
const codexImageHere: CodexImage | null = null, codexReadyHere: (() => boolean) | null = null

type CodexImage = (prompt: string, aspect?: string) => Promise<Buffer>
type EnvLike = { [key: string]: string | undefined }
type RequestLike = { headers: { get(name: string): string | null } }

const codexImage: CodexImage | null = codexImageHere
const codexReady: (() => boolean) | null = codexReadyHere
const PLAN_IS_DEFAULT_HERE = false

export const PLAN_MODEL_KEY = 'chatgpt-plan'
export const PLAN_LABEL = 'ChatGPT plan (GPT Image 2)'
export const OPENROUTER_DEFAULT_KEY = 'nano-banana-2'

export interface PlanVerdict {
  available: boolean
  /** Why not, in one line, when it is not. */
  reason?: string
}

/** May this request make a picture on the ChatGPT plan of the machine the Oasis runs on? */
export function planForRequest(
  request: RequestLike,
  env: EnvLike = process.env,
  ready: () => boolean = codexReady ?? (() => false),
): PlanVerdict {
  if (!codexImage || !codexReady) return { available: false, reason: 'This Oasis has no ChatGPT-plan pictures.' }
  if (checkAgentRequest(request, env)) return { available: false, reason: 'The ChatGPT plan makes pictures only for the Oasis on its own machine.' }
  if (!ready()) return { available: false, reason: 'No Codex CLI signed in to a ChatGPT plan on this machine.' }
  return { available: true }
}

/** The model a request gets when it names none (or the old 'gemini-flash' key the agents' tools still send). */
export function defaultPictureModel(verdict: PlanVerdict, planIsDefault: boolean = PLAN_IS_DEFAULT_HERE): string {
  return verdict.available && planIsDefault ? PLAN_MODEL_KEY : OPENROUTER_DEFAULT_KEY
}

/** One picture on the plan. Call only after planForRequest said available. */
export async function planPicture(prompt: string, aspect: string): Promise<Buffer> {
  if (!codexImage) throw new Error('This Oasis has no ChatGPT-plan pictures.')
  return codexImage(prompt, aspect)
}
