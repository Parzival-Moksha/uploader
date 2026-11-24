// ░▒▓ MIC WAIT — what a press of the mic is waiting for, in one line, with how long, and typing offered ▓▒░
// Hustler's onboarding trip point 5 (2026-11-24): "the microphone's first press... the owner hit the silent first
// press himself on 22 Nov. The mic says in one line what it is waiting for and how long, and offers typing at once."
// The engine's status and error lines (ears.js, live-dictation.ts) are worded for us; these say the same for a
// newcomer. Pure, tested (mic-wait.test.ts). The composer shows the line with a "Type instead" button beside it,
// which is the offer to type: the lines themselves don't repeat it.

/** A status line while the mic starts, in plain words. Unknown lines are shown as they are. */
export function micStatusLine(text: string | null | undefined): string {
  const t = (text || '').trim()
  if (!t || /^Connecting to the voice helper/i.test(t)) return 'Starting the mic…'
  if (/Setting up the voice helper/i.test(t)) return `Setting up voice typing on this computer, once: about a minute.`
  const pct = /Downloading\b.*?(\d{1,3})\s*%/i.exec(t)
  if (pct) return `Downloading the speech model, once (about 260 MB): ${pct[1]}%.`
  if (/Downloading/i.test(t)) return `Downloading the speech model, once (about 260 MB, a minute or two).`
  if (/Waking up|Loading the speech model|loading/i.test(t)) return 'Waking the voice helper: a few seconds.'
  return t
}

/** An error line from the mic, in plain words, with what to do about it ("Type instead" stands beside it). */
export function micErrorLine(error: string | null | undefined): string {
  const e = (error || '').trim()
  if (!e) return ''
  if (/Can't reach the voice helper|agent engine (is not|isn't) running/i.test(e)) {
    return 'The mic needs the Oasis engine, which is not running: start the Oasis again (its start script).'
  }
  if (/Apple-silicon Mac|macOS 15/i.test(e)) {
    return "This computer can't run the local voice helper (it needs an Apple-silicon Mac with macOS 15 or newer). Chrome, Edge or Safari type by voice; or add an ElevenLabs key in Settings > Sound."
  }
  if (/No Python 3 found/i.test(e)) {
    return 'Voice typing needs Python 3 on this computer: install it from python.org (on Windows tick "Add to PATH"), then press the mic again.'
  }
  return e
}
