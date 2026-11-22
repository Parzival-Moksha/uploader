// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PVP BRIDGE — adapter between the colyseus.js room connection and
// non-React modules (CombatBoltLayer) that need to send/receive
// PvP-specific messages without holding a React ref to the connection.
//
// Lifecycle:
//   MultiplayerPresenceLayer registers a sender on connect, clears it
//   on disconnect. CombatBoltLayer fires cast/reportHit through the
//   bridge — if no sender is set (no PvP connection), the calls no-op.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface PvpCastPayload {
  spell: 'firebolt' | 'lightning-bolt' | 'ice-bolt'
  /** A|B|C|D — design letter for visual variant. */
  design: string
  /** Origin point at cast time. */
  ox: number; oy: number; oz: number
  /** Unit-vector direction. */
  dx: number; dy: number; dz: number
  speed: number
  damage: number
  seed: number
  /** Client-generated id. Server echoes it back as the canonical bolt id. */
  clientPredictionId: string
}

export interface PvpReportHitPayload {
  /** boltId == clientPredictionId from the cast that landed. */
  boltId: string
  /** Victim's Colyseus sessionId (not playerId). */
  victimSessionId: string
  /** Where it struck (world), for the gore; the room checks it against the victim. */
  x?: number; y?: number; z?: number
}

/** A machine-gun round that hit a player (party rules: the room broadcasts it as a hit). */
export interface PvpShotPayload {
  victimSessionId: string
  x?: number; y?: number; z?: number
}

/** A landed hit on a player, broadcast by the room to everyone under party rules (gore, flinch, knock-down). */
export interface PvpPlayerHitEvent {
  victimId: string
  casterId: string
  at: [number, number, number]
  from: [number, number, number] | null
  damage: number
  hp: number
  lethal: boolean
  weapon: string
  downMs: number
}

export interface PvpVitalsPayload {
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
}

export interface PvpRemoteBolt {
  id: string
  casterSessionId: string
  spell: 'firebolt' | 'lightning-bolt' | 'ice-bolt'
  design: string
  origin: [number, number, number]
  direction: [number, number, number]
  speed: number
  damage: number
  seed: number
}

export interface PvpPlayerSnapshot {
  sessionId: string
  playerId: string
  displayName: string
  hp: number
  maxHp: number
  mana: number
  maxMana: number
  alive: boolean
  respawnAt: number
  lastKilledBy: string
  position: [number, number, number]
}

export interface PvpDeathEvent {
  casterId: string
  casterName: string
  victimId: string
  victimName: string
  spell: string
  /** Party rules: a knock-down, not a death (no blackout, no teleport). */
  soft?: boolean
}

export interface PvpRespawnEvent {
  playerId: string
  sessionId: string
  displayName: string
  /** Party rules: up where they fell. */
  soft?: boolean
}

export interface PvpHitAwardEvent {
  victimId: string
  victimName: string
  damage: number
  xp: number
  position: [number, number, number]
  spell: string
}

interface PvpSender {
  sendCast(payload: PvpCastPayload): void
  sendReportHit(payload: PvpReportHitPayload): void
  sendVitals(payload: PvpVitalsPayload): void
  sendShot?(payload: PvpShotPayload): void
  /** Current room's local sessionId — the local player's id in the room. */
  readonly localSessionId: string
  /** Current room's pvpEnabled flag. */
  readonly pvpEnabled: boolean
}

type RemoteBoltListener = (bolt: PvpRemoteBolt) => void
type PlayerStateListener = (players: PvpPlayerSnapshot[]) => void
type DeathListener = (event: PvpDeathEvent) => void
type RespawnListener = (event: PvpRespawnEvent) => void
type HitAwardListener = (event: PvpHitAwardEvent) => void
type PlayerHitListener = (event: PvpPlayerHitEvent) => void

let activeSender: PvpSender | null = null
const remoteBoltListeners = new Set<RemoteBoltListener>()
const playerStateListeners = new Set<PlayerStateListener>()
const deathListeners = new Set<DeathListener>()
const respawnListeners = new Set<RespawnListener>()
const hitAwardListeners = new Set<HitAwardListener>()

let latestPlayers: PvpPlayerSnapshot[] = []

// ─═̷─ Sender registration (called by MultiplayerPresenceLayer) ─═̷─

export function setPvpSender(sender: PvpSender | null): void {
  activeSender = sender
  if (!sender) {
    latestPlayers = []
    notifyPlayerState([])
  }
}

export function isPvpConnected(): boolean {
  return activeSender !== null
}

export function getPvpEnabled(): boolean {
  return activeSender?.pvpEnabled === true
}

export function getLocalSessionId(): string {
  return activeSender?.localSessionId || ''
}

// ─═̷─ Outgoing messages ─═̷─

export function sendPvpCast(payload: PvpCastPayload): void {
  activeSender?.sendCast(payload)
}

export function sendPvpReportHit(payload: PvpReportHitPayload): void {
  activeSender?.sendReportHit(payload)
}

export function sendPvpVitals(payload: PvpVitalsPayload): void {
  activeSender?.sendVitals(payload)
}

export function sendPvpShot(payload: PvpShotPayload): void {
  activeSender?.sendShot?.(payload)
}

// ─═̷─ Incoming events (called by the room client) ─═̷─

export function notifyRemoteBolt(bolt: PvpRemoteBolt): void {
  for (const listener of remoteBoltListeners) {
    try { listener(bolt) } catch (err) { console.warn('[pvp-bridge] remote bolt listener threw', err) }
  }
}

export function notifyPlayerState(players: PvpPlayerSnapshot[]): void {
  latestPlayers = players
  for (const listener of playerStateListeners) {
    try { listener(players) } catch (err) { console.warn('[pvp-bridge] player state listener threw', err) }
  }
}

export function notifyDeath(event: PvpDeathEvent): void {
  for (const listener of deathListeners) {
    try { listener(event) } catch (err) { console.warn('[pvp-bridge] death listener threw', err) }
  }
}

export function notifyRespawn(event: PvpRespawnEvent): void {
  for (const listener of respawnListeners) {
    try { listener(event) } catch (err) { console.warn('[pvp-bridge] respawn listener threw', err) }
  }
}

const playerHitListeners = new Set<PlayerHitListener>()

export function notifyPlayerHit(event: PvpPlayerHitEvent): void {
  for (const listener of playerHitListeners) {
    try { listener(event) } catch (err) { console.warn('[pvp-bridge] player hit listener threw', err) }
  }
}

export function onPlayerHit(listener: PlayerHitListener): () => void {
  playerHitListeners.add(listener)
  return () => { playerHitListeners.delete(listener) }
}

export function notifyHitAward(event: PvpHitAwardEvent): void {
  for (const listener of hitAwardListeners) {
    try { listener(event) } catch (err) { console.warn('[pvp-bridge] hit award listener threw', err) }
  }
}

// ─═̷─ Subscription (called by HUD / overlays / combat layer) ─═̷─

export function onRemoteBolt(listener: RemoteBoltListener): () => void {
  remoteBoltListeners.add(listener)
  return () => { remoteBoltListeners.delete(listener) }
}

export function onPlayerState(listener: PlayerStateListener): () => void {
  playerStateListeners.add(listener)
  if (latestPlayers.length > 0) {
    try { listener(latestPlayers) } catch {}
  }
  return () => { playerStateListeners.delete(listener) }
}

export function onDeath(listener: DeathListener): () => void {
  deathListeners.add(listener)
  return () => { deathListeners.delete(listener) }
}

export function onRespawn(listener: RespawnListener): () => void {
  respawnListeners.add(listener)
  return () => { respawnListeners.delete(listener) }
}

export function onHitAward(listener: HitAwardListener): () => void {
  hitAwardListeners.add(listener)
  return () => { hitAwardListeners.delete(listener) }
}

export function getLatestPlayers(): PvpPlayerSnapshot[] {
  return latestPlayers
}
