'use client'

// ░▒▓ MICROPHONE SETTING — which input voice typing and voice messages hear, and a meter that shows it hearing ▓▒░
// Settings > Sound, above the two voice switches (the owner, 27 Nov: "I want the Steinberg to be the recording
// device, but can we even choose it?"; he tapped microphones three times that week to find out which one was live).
// The inputs the browser offers (their names once the microphone is allowed), "System default" first; the choice is
// kept by lib/voice/mic-device.ts and asked for by its id. While this section shows and the microphone is allowed, a
// small meter listens to the chosen input; it stops when Settings closes. A chosen input that is not connected is
// said here, and the voice falls back to the system default with a notice (mic-device.ts openMicrophone).

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getMicChoice, openMicrophone, setMicChoice, subscribeMicChoice } from '@/lib/voice/mic-device'

interface Input { deviceId: string; label: string }

/** Chrome lists the system's own picks as pseudo inputs; "System default" stands for them. */
const PSEUDO = new Set(['default', 'communications'])

export function MicrophoneSetting() {
  const choice = useSyncExternalStore(subscribeMicChoice, getMicChoice, () => null)
  const [inputs, setInputs] = useState<Input[]>([])
  const [systemName, setSystemName] = useState('')
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [level, setLevel] = useState(0)
  const [meterLine, setMeterLine] = useState('')

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) { setAllowed(false); return }
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
    const audio = list.filter(device => device.kind === 'audioinput')
    setInputs(audio.filter(device => !PSEUDO.has(device.deviceId)).map((device, i) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${i + 1}` })))
    setSystemName((audio.find(device => device.deviceId === 'default')?.label || '').replace(/^Default\s*-\s*/i, ''))
    // The browser names its inputs only once this page may use the microphone.
    setAllowed(audio.some(device => device.label))
  }, [])

  useEffect(() => {
    void refresh()
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    devices?.addEventListener?.('devicechange', refresh)
    return () => devices?.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  // The meter: the chosen input, while this shows.
  useEffect(() => {
    if (!allowed) return
    let stopped = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let timer: number | null = null
    setMeterLine('')
    void (async () => {
      try {
        stream = await openMicrophone({ echoCancellation: true, noiseSuppression: true }, { notice: text => { if (!stopped) setMeterLine(text) } })
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return }
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const data = new Float32Array(analyser.fftSize)
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 5))
        }, 80)
      } catch {
        if (!stopped) setMeterLine('The microphone could not be opened here (is the browser allowed to use it?).')
      }
    })()
    return () => {
      stopped = true
      if (timer !== null) window.clearInterval(timer)
      stream?.getTracks().forEach(track => track.stop())
      ctx?.close().catch(() => {})
      setLevel(0)
    }
  }, [allowed, choice?.deviceId])

  const allow = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
    } catch { /* refused: the list keeps its plain names */ }
    void refresh()
  }

  const missing = Boolean(choice && allowed && inputs.length && !inputs.some(input => input.deviceId === choice.deviceId))
  const value = choice && !missing ? choice.deviceId : ''

  return (
    <section>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Microphone</div>
      <div className="flex items-center gap-2">
        <select
          value={value}
          aria-label="Microphone"
          onChange={event => {
            const picked = inputs.find(input => input.deviceId === event.target.value)
            setMicChoice(picked ? { deviceId: picked.deviceId, label: picked.label } : null)
          }}
          className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 cursor-pointer outline-none text-[11px]"
        >
          <option value="">{systemName ? `System default (${systemName})` : 'System default'}</option>
          {inputs.map(input => <option key={input.deviceId} value={input.deviceId}>{input.label}</option>)}
        </select>
        {/* How loud the chosen input hears you, now. */}
        <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-white/10" title="What the chosen microphone hears" data-mic-level={Math.round(level * 100)}>
          <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </div>
      {allowed === false && (
        <button type="button" onClick={() => void allow()} className="mt-1 text-[10.5px] text-sky-300 underline hover:text-sky-200">
          Allow the microphone to see the inputs' names
        </button>
      )}
      {missing && choice && (
        <div role="alert" className="mt-1 text-[10.5px] leading-snug text-amber-200">
          {choice.label || 'The chosen microphone'} is not connected: voice typing and voice messages use the system default until it is back.
        </div>
      )}
      {!missing && meterLine && <div role="alert" className="mt-1 text-[10.5px] leading-snug text-amber-200">{meterLine}</div>}
      <div className="mt-1 text-[10px] leading-snug text-white/40">For voice typing and voice messages. Talk: the bar moves with the one that hears you.</div>
    </section>
  )
}
