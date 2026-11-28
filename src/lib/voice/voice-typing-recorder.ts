// ░▒▓ VOICE TYPING RECORDER — the sound of what he voice-types, kept with the text he sends ▓▒░
// The owner, 27 Nov: "whenever I voice type on the T or that little microphone in this text input field, I want it to
// be recorded and saved together with its text". While a village dictation runs, the browser records the same
// microphone stream (Opus, 32 kbit/s: about 15 MB an hour). The encoder is the browser's media pipeline, off the main
// thread, so it costs no frame; nothing is transcribed again, so it costs no credit. When the text is sent, each
// recording goes to the agent engine on this PC (keepVoiceTyping), which keeps it in <voiceDir>/typing beside a .json
// with the agent, the time and the text as sent. A box cleared without sending drops its sound (village-dictation.ts).

import { getAgentEngineClient } from '../agent-engine-client'

const AUDIO_BITS_PER_SECOND = 32_000
const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']

export interface TypingRecording {
  readonly startedAt: number
  /** The recording, once it has stopped (null when the browser gave nothing). */
  readonly done: Promise<{ blob: Blob; durationMs: number } | null>
  stop(): void
}

export type TypingRecorderFactory = (stream: MediaStream) => TypingRecording | null

function pickMime(): string {
  return MIME_CHOICES.find(type => MediaRecorder.isTypeSupported?.(type)) || ''
}

/** Record a live microphone stream until stop() or until its tracks end. Null where the browser cannot record. */
export function recordTypingStream(stream: MediaStream): TypingRecording | null {
  if (typeof MediaRecorder === 'undefined') return null
  let recorder: MediaRecorder
  try {
    const mime = pickMime()
    recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
  } catch {
    return null
  }
  const startedAt = Date.now()
  const chunks: Blob[] = []
  const done = new Promise<{ blob: Blob; durationMs: number } | null>(resolve => {
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      resolve(blob.size ? { blob, durationMs: Date.now() - startedAt } : null)
    }
    recorder.onerror = () => resolve(null)
  })
  try {
    recorder.start()
  } catch {
    return null
  }
  return {
    startedAt,
    done,
    stop() {
      try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* already stopped */ }
    },
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error || new Error('could not read the recording'))
    reader.readAsDataURL(blob)
  })
}

/** After a send: the recordings behind that text go to the engine on this PC. Quiet on failure (the text went). */
export async function keepTypingRecordings(agentId: string, text: string, recordings: TypingRecording[]): Promise<void> {
  for (const recording of recordings) {
    try {
      const got = await recording.done
      if (!got) continue
      const audio = await blobToBase64(got.blob)
      await getAgentEngineClient().keepVoiceTyping(agentId, audio, got.blob.type, text, got.durationMs)
    } catch (error) {
      console.warn('[voice typing] the recording was not kept:', error)
    }
  }
}
