// ░▒▓ DICTATION ROUTE — which ears a press of the mic uses ▓▒░
// The order (the owner, 2026-11-22: voice typing "ALWAYS"): ElevenLabs when the engine has its key, the local helper
// when it is installed (both through the agent engine, live-dictation.ts, as before), and otherwise the browser's own
// speech recognition (browser-dictation.ts). A browser without one (Firefox) stays with the engine, which offers to
// install the local helper. So the mic never ends in a dead end. The pure choice is tested (dictation-route.test.ts).

import { getAgentEngineClient } from '../agent-engine-client'
import { isBrowserDictationSupported, startBrowserDictation, browserRecognizerOwner } from './browser-dictation'
import { startLiveDictation, type LiveDictation, type LiveDictationHandlers } from './live-dictation'

export type DictationRoute = 'engine' | 'browser'

export interface EarsFacts {
  /** The agent engine answers. */
  engineOpen: boolean
  /** It has an ElevenLabs key, or its local helper is installed. */
  engineEars: boolean
  /** This browser has speech recognition of its own. */
  browser: boolean
}

export function chooseDictationRoute(facts: EarsFacts): DictationRoute {
  if (facts.engineOpen && facts.engineEars) return 'engine'
  if (facts.browser) return 'browser'
  return 'engine'
}

/**
 * warmEars' answer → the engine can type now: ElevenLabs (its key), or the local helper with its model loaded. A
 * helper still installing, downloading or loading its model does not count: the browser types meanwhile (the owner's
 * first agent, 2026-11-22, had a mic that did nothing while the helper was not there yet).
 */
export function engineHasEars(answer: { ready?: boolean; model?: string } | null | undefined): boolean {
  if (!answer) return false
  if (answer.model?.startsWith('elevenlabs')) return true
  return answer.ready === true
}

const PROBE_MS = 60_000
/** A "not yet" is asked again soon: the helper may be ready a few seconds later, and the mic switches by itself. */
const PROBE_NOT_YET_MS = 8_000
let probe: { at: number; ears: boolean } | null = null

/** Asks the engine once a minute at most (warmEars also warms whichever ears it has, as the composer already does). */
async function engineEars(): Promise<{ open: boolean; ears: boolean }> {
  const client = getAgentEngineClient()
  if (!client.isOpen) return { open: false, ears: false }
  if (probe && Date.now() - probe.at < (probe.ears ? PROBE_MS : PROBE_NOT_YET_MS)) return { open: true, ears: probe.ears }
  try {
    // 'elevenlabs' answers with its model when the key is there, and falls back to the local helper's answer.
    const ears = engineHasEars(await client.warmEars('elevenlabs'))
    probe = { at: Date.now(), ears }
    return { open: true, ears }
  } catch {
    return { open: true, ears: false }
  }
}

/** Forget the last answer (Settings installed the helper, or a key was added). */
export function forgetEarsProbe(): void {
  probe = null
}

const NOTICE_KEY = 'oasis.voiceTyping.browserNotice.v1'

/** The one honest line, the first time the browser's recogniser is used on this browser. */
function noticeOnce(): void {
  try {
    if (window.localStorage.getItem(NOTICE_KEY)) return
    window.localStorage.setItem(NOTICE_KEY, String(Date.now()))
  } catch { /* private mode: say it each time */ }
  const owner = browserRecognizerOwner()
  const where = owner === 'the browser maker' ? "the browser's maker" : owner
  window.dispatchEvent(new CustomEvent('oasis:notice', {
    detail: {
      message: `Voice typing uses your browser's speech recognition: it sends what you say to ${where}. On this computer only, or ElevenLabs: Settings → Sound → Voice typing.`,
      tone: 'info',
    },
  }))
}

/** What the village's mic calls: the engine's ears when it has some, else the browser's. */
export async function startVillageDictation(handlers: LiveDictationHandlers): Promise<LiveDictation> {
  const { open, ears } = await engineEars()
  const route = chooseDictationRoute({ engineOpen: open, engineEars: ears, browser: isBrowserDictationSupported() })
  if (route === 'engine') return startLiveDictation(handlers)
  noticeOnce()
  return startBrowserDictation(handlers)
}
