'use client'

// The page side of agents casting (src/lib/village/agent-cast.ts has the timeline): watches every agent's tool calls,
// starts a cast when one calls a world tool, plays the owner's incantation from its head, moves the casts on, and
// tells useWorldEvents which world changes to hold until the shoot.

import { useEffect, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { getAudioListener } from '../CameraController'
import { readEmbodiedAgentSettingsFromStorage } from '../../lib/agent-action-settings'
import { shippedPickUrl } from '../../lib/spell-sounds'
import { CastBoard, HELD_EVENT_TYPES, INCANTATION_FALLBACK_URL, INCANTATION_URL, isWorldChangeTool, type CastPhase } from '../../lib/village/agent-cast'
import { villageLipSyncId, villageSoundSource } from './village-companion'
import { createLipSyncController, getLipSync, registerLipSync, resumeLipSyncContext, unregisterLipSync } from '../../lib/lip-sync'

const board = new CastBoard()
const listeners = new Set<() => void>()
let version = 0
let timer: number | null = null

const now = () => performance.now()

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

function ensureTicking() {
  if (timer !== null) return
  timer = window.setInterval(() => {
    const busy = board.tick(now())
    notify()
    if (!busy && !board.active && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }, 40)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** This agent's cast phase now (null: not casting). */
export function useCastPhase(agentId: string): CastPhase | null {
  return useSyncExternalStore(subscribe, () => board.phase(agentId, now()), () => null)
}

/** Is this agent casting (it stays where it stands meanwhile)? */
export function useIsCasting(agentId: string): boolean {
  return useCastPhase(agentId) !== null
}

/**
 * useWorldEvents asks before applying a world event from the server: true means a cast is charging and the event is
 * held; `apply` runs at the shoot's release. Events another agent type made on purpose (an actor) are never held.
 */
export function holdForCast(type: string, data: Record<string, unknown> | undefined, apply: () => void): boolean {
  if (!board.active || !HELD_EVENT_TYPES.has(type)) return false
  if (typeof data?.actorAgentType === 'string' && data.actorAgentType) return false
  const held = board.hold(apply, now())
  if (held) ensureTicking()
  return held
}

// ── the incantation, from the agent's head ──

/** Cast sounds that are a voice (the owner's incantation): the casting avatar's mouth moves with them. */
const VOICE_SOUND = /conjure-owner|conjuration-incantation/i

let incantation: Promise<{ buffer: AudioBuffer; voice: boolean } | null> | null = null

function loadIncantation(context: BaseAudioContext): Promise<{ buffer: AudioBuffer; voice: boolean } | null> {
  if (!incantation) {
    const fetchBuffer = (url: string) => fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => ({ buffer, voice: VOICE_SOUND.test(url) }))
    // One set everywhere: the shipped 'conjure' pick first, then the owner's recording, then the shipped swell.
    const urls = [...new Set([shippedPickUrl('conjure'), INCANTATION_URL, INCANTATION_FALLBACK_URL].filter((u): u is string => Boolean(u)))]
    incantation = urls.slice(1).reduce((chain, url) => chain.catch(() => fetchBuffer(url)), fetchBuffer(urls[0]))
      .catch(error => {
        console.warn('[agent-cast] incantation did not load', error)
        incantation = null
        return null
      })
  }
  return incantation
}

async function speakIncantation(agentId: string) {
  const listener = getAudioListener()
  // Sound is only allowed after a click or a key press: a silent page simply casts in silence.
  if (!listener || listener.context.state !== 'running') return
  const loaded = await loadIncantation(listener.context)
  const head = villageSoundSource(agentId)
  if (!loaded || !head) return
  const { buffer, voice } = loaded
  const audio = new THREE.PositionalAudio(listener)
  audio.setBuffer(buffer)
  // As its voice: full within 3 m, about half at 7 m, a murmur across the plaza.
  audio.setDistanceModel('inverse')
  audio.setRefDistance(3)
  audio.setRolloffFactor(1.3)
  audio.setVolume(0.9)
  // In the scene only while it plays (a PositionalAudio schedules audio work every frame it is there).
  head.add(audio)
  audio.play()
  const mouth = voice ? moveMouthWith(agentId, audio) : null
  window.setTimeout(() => {
    if (audio.isPlaying) audio.stop()
    mouth?.()
    head.remove(audio)
    audio.disconnect()
  }, buffer.duration * 1000 + 300)
}

/**
 * The owner, 25 Nov (recording the release clip): when Anorak cast and said the magic words "his mouth was not
 * moving". The incantation's own sound, taken before the distance falls off, feeds a lip-sync controller under the
 * agent's lip-sync key, the one its body already reads for speech (loudness to mouth shapes, lib/lip-sync.ts). Not
 * while the agent speaks a line: that keeps its mouth. Returns the release.
 */
function moveMouthWith(agentId: string, audio: THREE.PositionalAudio): (() => void) | null {
  const key = villageLipSyncId(agentId)
  if (getLipSync(key)?.isActive) return null
  try {
    const context = audio.context
    const tap = context.createMediaStreamDestination()
    audio.gain.connect(tap)
    const controller = createLipSyncController()
    let released = false
    void resumeLipSyncContext().then(() => {
      if (released || getLipSync(key)?.isActive) return
      controller.attachStream(tap.stream)
      registerLipSync(key, controller)
    })
    return () => {
      released = true
      unregisterLipSync(key, controller) // detaches it too
      if (getLipSync(key) !== controller && controller.isActive) controller.detach()
      try { audio.gain.disconnect(tap) } catch { /* already gone */ }
    }
  } catch (error) {
    console.warn('[agent-cast] the mouth could not follow the incantation', error)
    return null
  }
}

function startCast(agentId: string, toolId: string) {
  if (readEmbodiedAgentSettingsFromStorage().agentActionMode !== 'embodied') return
  // Its body is not on this page (it lives in another world): nothing to show, nothing to hold.
  if (!villageSoundSource(agentId)) return
  if (!board.start(agentId, toolId, now())) return
  ensureTicking()
  notify()
  void speakIncantation(agentId)
}

/**
 * Mounted once by the village: follows each agent's tool calls in the engine state. Only what happens from now on
 * counts (calls already in the log when the page opens are history).
 */
export function useVillageCastWatcher(): void {
  useEffect(() => {
    const seen = new Map<string, string>()
    const lastLogs = new Map<string, unknown>()
    let primed = false
    const scan = (agents: ReturnType<typeof useOasisStore.getState>['agentEngine']['agents']) => {
      for (const [agentId, agent] of Object.entries(agents)) {
        const log = agent?.log
        if (!log || lastLogs.get(agentId) === log) continue
        lastLogs.set(agentId, log)
        for (let i = Math.max(0, log.length - 12); i < log.length; i++) {
          const entry = log[i]
          if (entry.type !== 'tool' || entry.history || !isWorldChangeTool(entry.name)) continue
          const id = entry.toolUseId || entry.key
          const before = seen.get(id)
          if (before === entry.status) continue
          seen.set(id, entry.status)
          if (!primed) continue
          // A quick tool may already be done when first seen: it still casts, ready to shoot.
          if (!before) startCast(agentId, id)
          if (entry.status !== 'running') board.toolEnded(id, entry.status === 'error')
        }
      }
    }
    scan(useOasisStore.getState().agentEngine.agents)
    primed = true
    const unsubscribe = useOasisStore.subscribe(state => scan(state.agentEngine.agents))
    return () => {
      unsubscribe()
      board.clear()
      notify()
    }
  }, [])
}
