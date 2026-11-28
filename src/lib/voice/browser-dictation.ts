// ░▒▓ BROWSER DICTATION — the floor under voice typing: the browser's own speech recognition ▓▒░
// The owner (2026-11-22), asked whether voice typing should be optional at install on a Mac: "ALWAYS". So when the
// engine has neither an ElevenLabs key nor the local helper, the mic uses the Web Speech API: Chrome and Edge
// (SpeechRecognition / webkitSpeechRecognition; Chrome sends the audio to Google to recognise it), Safari
// (webkitSpeechRecognition; Apple's recogniser). Firefox has none (switched off in its releases), and Brave's never
// answers (isBraveBrowser): there the mic stays with the engine, which offers to install the local helper.
// Same interface as live-dictation.ts, so village-dictation.ts and every box that shows it (the composer, the T
// window) work unchanged: partial lines while he talks, a final line once he pauses, stop() settles and ends.

import type { DictationLine, LiveDictation, LiveDictationHandlers } from './live-dictation'

/** The bits of SpeechRecognition used here (lib.dom has no types for it in this TypeScript). */
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string; message?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

export function browserRecognition(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * Brave has webkitSpeechRecognition but not the Google service behind it: start() fails at once with "network",
 * every time (found 22 Nov 2026 in the owner's Brave app window of the Uploader, an Oasis with no ElevenLabs key).
 * So Brave counts as a browser without a recogniser, like Firefox: the mic stays with the engine and its helper.
 */
export function isBraveBrowser(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  return Boolean(nav && typeof nav === 'object' && 'brave' in nav && (nav as { brave?: unknown }).brave)
}

export function isBrowserDictationSupported(): boolean {
  return Boolean(browserRecognition()) && !isBraveBrowser()
}

/** Whose servers hear the audio, for the one honest line. */
export function browserRecognizerOwner(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/Edg\//.test(userAgent)) return 'Microsoft'
  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return 'Google'
  if (/Safari\//.test(userAgent)) return 'Apple'
  return 'the browser maker'
}

/** "en" from the boxes becomes the page's own English (en-GB, en-US …); a full tag stays as it is. */
export function recognitionLang(lang: string, pageLang = typeof navigator !== 'undefined' ? navigator.language : ''): string {
  if (lang.includes('-')) return lang
  if (pageLang && pageLang.toLowerCase().startsWith(`${lang.toLowerCase()}-`)) return pageLang
  return lang
}

/** Errors worth saying; "no-speech" and "aborted" are a pause or our own stop, so the mic just listens again. */
export function recognitionErrorText(error: string, owner: string): string | null {
  if (error === 'no-speech' || error === 'aborted') return null
  if (error === 'not-allowed' || error === 'service-not-allowed') return "The browser isn't allowed to use the microphone (click the icon left of the address), or its speech recognition is switched off"
  if (error === 'audio-capture') return 'No microphone found'
  if (error === 'network') return `The browser's speech recognition needs the internet (it runs at ${owner}): check the connection, or install the local helper in Settings → Sound`
  if (error === 'language-not-supported') return "The browser's speech recognition does not know this language"
  return `The browser's speech recognition stopped (${error})`
}

export async function startBrowserDictation(handlers: LiveDictationHandlers): Promise<LiveDictation> {
  const { lang = 'en', onLine, onStatus, onReady, onLevel, onError, onDone, onStream } = handlers
  const Ctor = browserRecognition()
  if (!Ctor) throw new Error("This browser has no speech recognition of its own: install the local helper in Settings → Sound, or use Chrome, Edge or Safari")
  const owner = browserRecognizerOwner()

  // The mic for the level meter and the avatar's mouth (the recogniser opens its own); its prompt comes first. The
  // system default on purpose, not Settings > Sound > Microphone: the recogniser always hears the default, and the
  // meter should show what it hears.
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch {
    throw new Error("No microphone here, or the browser isn't allowed to use it (click the icon left of the address)")
  }
  onStream?.(stream)
  let ctx: AudioContext | null = null
  let meter: number | null = null
  try {
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioCtor) {
      ctx = new AudioCtor()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      meter = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 4))
      }, 100)
    }
  } catch { /* the meter is a nicety */ }

  let done = false
  let stopping = false
  let recognition: Recognition | null = null
  // Line numbers keep growing across the recogniser's own restarts (it ends itself after a pause or a minute).
  let base = 0
  let highest = -1
  const startedAt = performance.now()
  let firstWordsS: number | null = null
  let stopAt: number | null = null

  const finish = () => {
    if (done) return
    done = true
    if (meter !== null) window.clearInterval(meter)
    stream?.getTracks().forEach(track => track.stop())
    ctx?.close().catch(() => {})
    onDone?.({ firstWordsS, settleS: stopAt === null ? null : (performance.now() - stopAt) / 1000, audioS: (performance.now() - startedAt) / 1000 })
  }

  const run = () => {
    const r = new Ctor()
    recognition = r
    r.lang = recognitionLang(lang)
    r.continuous = true
    r.interimResults = true
    r.onstart = () => { onReady?.() }
    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const line: DictationLine = { line: base + i, text: result[0]?.transcript || '', final: result.isFinal }
        if (firstWordsS === null && line.text.trim()) firstWordsS = (performance.now() - startedAt) / 1000
        highest = Math.max(highest, line.line)
        onLine?.(line)
      }
    }
    r.onerror = (event) => {
      const text = recognitionErrorText(event.error, owner)
      if (!text) return
      onError?.(text)
      stopping = true
    }
    r.onend = () => {
      if (recognition !== r) return
      if (stopping || done) { finish(); return }
      // The recogniser ended by itself (a long pause, its time limit): listen on, in new lines.
      base = highest + 1
      try { run() } catch { finish() }
    }
    r.start()
  }

  onStatus?.(`Listening with the browser's speech recognition (${owner})…`)
  try {
    run()
  } catch (error) {
    finish()
    throw error instanceof Error ? error : new Error(String(error))
  }

  return {
    stop() {
      if (stopping || done) return
      stopping = true
      stopAt = performance.now()
      stream?.getTracks().forEach(track => track.stop()) // the mic light goes off at once
      try { recognition?.stop() } catch { finish() }
      window.setTimeout(finish, 4000) // the recogniser always ends; this is in case it does not
    },
    cancel() {
      stopping = true
      try { recognition?.abort() } catch { /* gone */ }
      finish()
    },
  }
}
