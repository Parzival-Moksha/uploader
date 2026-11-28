// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PVP OVERLAY — death/respawn UX + slain/slew toasts.
//
// Subscribes to the pvp-bridge for `death` and `respawn` events. When the
// local player dies, mounts a black-with-red-vignette overlay with a 5s
// countdown. When a remote player dies to a bolt from THIS client, shows a
// transient "You slew X" toast. v1 — physics ragdoll is v2.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useRef, useState } from 'react'

import { getLocalSessionId, onDeath, onPlayerState, onRespawn, sendPvpStandUp, type PvpDeathEvent } from '@/lib/pvp-bridge'
import { requestPlayerAvatarTeleport } from '@/lib/player-avatar-runtime'

interface DeadState {
  slainBy: string
  respawnAt: number  // ms wall-clock
  /** Party rules: knocked down, not slain (no blackout, up where you fell). */
  soft?: boolean
}

interface KillToast {
  id: number
  victimName: string
  fadingAt: number
  soft?: boolean
}

const KILL_TOAST_DURATION_MS = 2600

export function PvPOverlay({ visible }: { visible: boolean }) {
  const [dead, setDead] = useState<DeadState | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [killToasts, setKillToasts] = useState<KillToast[]>([])
  const toastIdRef = useRef(0)

  // ─═̷─ Death event ─═̷─
  useEffect(() => {
    // Listened to even outside play mode: a guest in build mode can still be knocked down (party rules).
    const unsubscribe = onDeath((event: PvpDeathEvent) => {
      const localId = getLocalSessionId()
      // Two cases:
      //   1) Local player is the victim — mount blackout.
      //   2) Local player is the caster — show kill toast.
      if (event.victimId === localId) {
        setDead({
          slainBy: event.casterName || 'Unknown',
          respawnAt: Date.now() + (event.soft ? 6000 : 5000),
          soft: event.soft === true,
        })
      } else if (event.casterId === localId) {
        const id = ++toastIdRef.current
        const fadingAt = Date.now() + KILL_TOAST_DURATION_MS
        setKillToasts(prev => [...prev.slice(-3), { id, victimName: event.victimName || 'Unknown', fadingAt, soft: event.soft === true }])
      }
    })
    return unsubscribe
  }, [visible])

  // ─═̷─ Respawn event ─═̷─
  // Teleport the local avatar to the world spawn (room sends 0,1,0; if the
  // world has a custom spawnPoint we could later thread that through — for
  // v1, origin is fine since worlds with custom spawns can override later).
  useEffect(() => {
    // Listened to even outside play mode: a guest in build mode can still be knocked down (party rules).
    const unsubscribe = onRespawn(event => {
      const localId = getLocalSessionId()
      if (event.sessionId === localId) {
        setDead(null)
        // Party rules: up where you fell.
        if (event.soft) return
        requestPlayerAvatarTeleport({
          position: [0, 1, 0],
          yaw: 0,
          forward: [0, 0, 1],
        })
      }
    })
    return unsubscribe
  }, [visible])

  // ─═̷─ Fallback: clear dead state if player state shows we're alive again ─═̷─
  // The 'respawn' broadcast can race with the state diff; if the state diff
  // arrives first showing alive=true, the overlay should still clear.
  useEffect(() => {
    // Listened to even outside play mode: a guest in build mode can still be knocked down (party rules).
    const unsubscribe = onPlayerState(players => {
      const localId = getLocalSessionId()
      const me = players.find(player => player.sessionId === localId)
      if (me && me.alive) {
        setDead(prev => prev ? null : prev)
      }
    })
    return unsubscribe
  }, [visible])

  // ─═̷─ Countdown ticker — runs only while dead or while toasts are visible. ─═̷─
  useEffect(() => {
    if (!dead && killToasts.length === 0) return
    const interval = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [dead, killToasts.length])

  // ─═̷─ Space gets a knocked-down player up (party rules) ─═̷─
  useEffect(() => {
    if (!dead?.soft) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const el = event.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      sendPvpStandUp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dead?.soft])

  // ─═̷─ GC expired toasts ─═̷─
  useEffect(() => {
    if (killToasts.length === 0) return
    setKillToasts(prev => prev.filter(toast => toast.fadingAt > now))
  }, [now, killToasts.length])

  // Outside play mode only the party knock-down line shows (you can be shot while building).
  if (!visible && !dead?.soft) return null

  const remainingMs = dead ? Math.max(0, dead.respawnAt - now) : 0
  const remainingSec = Math.ceil(remainingMs / 1000)

  return (
    <>
      {/* Party knock-down: a line at the top, the world stays visible (you watch yourself get up). */}
      {dead?.soft && (
        <div className="fixed left-1/2 top-16 z-[calc(var(--z-hud)_+_30)] flex -translate-x-1/2 items-center gap-3 rounded-md border border-rose-300/40 bg-black/70 px-4 py-2 text-center text-[13px] font-black uppercase tracking-[0.16em] text-rose-100 shadow-[0_0_18px_rgba(248,113,113,0.35)]">
          <span className="pointer-events-none">Knocked down by {dead.slainBy} · up in <span className="font-mono text-amber-200">{remainingSec}</span></span>
          {/* Get up now: Space, or this button (the phone). The room allows it a second after the fall. */}
          <button
            type="button"
            data-get-up
            onClick={() => sendPvpStandUp()}
            className="pointer-events-auto rounded border border-amber-200/60 bg-amber-300/15 px-3 py-1 text-[12px] font-black uppercase tracking-[0.14em] text-amber-100 hover:bg-amber-300/30"
            title="Get up now (Space)"
          >
            Get up <span className="ml-1 rounded border border-amber-100/40 px-1 text-[10px]">Space</span>
          </button>
        </div>
      )}

      {/* Blackout overlay — fades in over 0.4s via CSS animation. */}
      {dead && !dead.soft && (
        <div
          className="pointer-events-none fixed inset-0 z-[calc(var(--z-hud)_+_30)] flex items-center justify-center"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(80,0,0,0.55) 0%, rgba(0,0,0,0.92) 70%)',
            animation: 'pvpDeathFadeIn 400ms ease-out forwards',
          }}
        >
          <style>{`
            @keyframes pvpDeathFadeIn {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }
            @keyframes pvpKillToast {
              0% { opacity: 0; transform: translate(-50%, 24px); }
              15% { opacity: 1; transform: translate(-50%, 0); }
              85% { opacity: 1; transform: translate(-50%, 0); }
              100% { opacity: 0; transform: translate(-50%, -16px); }
            }
          `}</style>
          <div className="text-center">
            <div className="mb-3 text-[12px] font-black uppercase tracking-[0.32em] text-rose-200/70">
              You were slain
            </div>
            <div className="mb-6 text-[28px] font-black uppercase tracking-[0.18em] text-rose-100"
              style={{ textShadow: '0 0 18px rgba(248,113,113,0.55)' }}
            >
              by {dead.slainBy}
            </div>
            <div className="text-[14px] font-black uppercase tracking-[0.18em] text-white/65">
              Respawning in <span className="font-mono text-amber-200">{remainingSec}</span>
            </div>
          </div>
        </div>
      )}

      {/* Kill toasts — bottom-center stack, fade in/out. */}
      {killToasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-32 left-1/2 z-[calc(var(--z-hud)_+_29)] flex -translate-x-1/2 flex-col items-center gap-2">
          {killToasts.map(toast => (
            <div
              key={toast.id}
              className="rounded-md border border-amber-300/40 bg-black/75 px-4 py-2 text-center text-[12px] font-black uppercase tracking-[0.16em] text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.35)]"
              style={{ animation: `pvpKillToast ${KILL_TOAST_DURATION_MS}ms ease-out forwards` }}
            >
              {toast.soft ? `You knocked down ${toast.victimName}` : `You slew ${toast.victimName}`}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
