export const PLAYER_SKILL_CAP = 5

export const PLAYER_BASE_STATS = {
  hp: 100,
  mana: 20,
  fireboltManaCost: 1,
  fireboltSpeedMetersPerSecond: 24,
  conjureManaCost: 20,
} as const

// The owner, 26 Nov: stat points are Vitality, Focus and Speed. Fire, ice and lightning are basic spells
// every character has from the start (learning more spells is a later design, not stat points); conjuration
// as a stat ("conjures cost less mana") was the same as more mana, so it went. Points anyone had in those four
// come back to spend on their own: unspent = earned - allocated, and they no longer count as allocated.
// Their Profile columns (skillFire, skillIce, skillLightning, skillConjuration) stay in the database, unread.
export const PLAYER_SKILL_KEYS = [
  'vitality',
  'focus',
  'mobility',
] as const

export type PlayerSkillKey = typeof PLAYER_SKILL_KEYS[number]
export type PlayerSkillSet = Record<PlayerSkillKey, number>

export interface PlayerComputedStats {
  maxHp: number
  maxMana: number
  fireboltDamage: number
  fireboltManaCost: number
  fireboltSpeedMetersPerSecond: number
  manaRegenMultiplier: number
  conjureManaCost: number
  moveSpeedMultiplier: number
}

export interface PlayerProgression {
  hp: number
  mana: number
  maxHp: number
  maxMana: number
  unspentSkillPoints: number
  skills: PlayerSkillSet
  stats: PlayerComputedStats
}

export const DEFAULT_PLAYER_SKILLS: PlayerSkillSet = {
  vitality: 0,
  focus: 0,
  mobility: 0,
}

export const PLAYER_SKILL_DEFS: Array<{
  id: PlayerSkillKey
  label: string
  shortLabel: string
  tone: string
  description: string
}> = [
  { id: 'vitality', label: 'Vitality', shortLabel: 'VIT', tone: '#22c55e', description: 'Maximum HP for dangerous quest and PvP worlds.' },
  { id: 'focus', label: 'Focus', shortLabel: 'FOC', tone: '#06b6d4', description: 'More mana, and it refills faster.' },
  { id: 'mobility', label: 'Speed', shortLabel: 'SPD', tone: '#84cc16', description: 'How fast you move in the Oasis: 7% a point.' },
]

export function clampSkillRank(value: unknown): number {
  const rank = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, Math.min(PLAYER_SKILL_CAP, rank))
}

export function normalizePlayerSkills(raw: Partial<Record<string, unknown>> = {}): PlayerSkillSet {
  return {
    vitality: clampSkillRank(raw.vitality),
    focus: clampSkillRank(raw.focus),
    mobility: clampSkillRank(raw.mobility),
  }
}

export function allocatedSkillPoints(skills: PlayerSkillSet): number {
  return PLAYER_SKILL_KEYS.reduce((total, key) => total + skills[key], 0)
}

export function earnedSkillPointsForLevel(level: number): number {
  return Math.max(0, Math.floor(level) - 1)
}

export function computePlayerStats(skills: PlayerSkillSet): PlayerComputedStats {
  return {
    maxHp: PLAYER_BASE_STATS.hp + skills.vitality * 25,
    maxMana: PLAYER_BASE_STATS.mana + skills.focus * 10,
    fireboltDamage: 14,
    fireboltManaCost: PLAYER_BASE_STATS.fireboltManaCost,
    fireboltSpeedMetersPerSecond: PLAYER_BASE_STATS.fireboltSpeedMetersPerSecond,
    manaRegenMultiplier: 1 + skills.focus * 0.35,
    conjureManaCost: PLAYER_BASE_STATS.conjureManaCost,
    moveSpeedMultiplier: 1 + skills.mobility * 0.07,
  }
}

// ░▒▓ Mana regen base rate. The multiplier from PlayerComputedStats defaults
// to 1.0 (focus skill = 0); a base interval of 100ms means default 10
// mana/sec, matching the test-friendly cadence requested. Focus skill scales
// from there: multiplier 1.35 (focus 1) → 13.5 mana/sec, multiplier 2.05
// (focus 3) → 20.5 mana/sec, capped by the 0.1..10 multiplier clamp below
// at 100 mana/sec max. Cast costs (1 mana/spell) are unchanged.
const MANA_REGEN_BASE_INTERVAL_MS = 100

export function computeManaRechargeTicks(elapsedMs: number, manaRegenMultiplier: number): number {
  const safeElapsedMs = Math.max(0, Math.min(5000, Math.floor(elapsedMs)))
  const safeMultiplier = Math.max(0.1, Math.min(10, manaRegenMultiplier))
  const tickIntervalMs = MANA_REGEN_BASE_INTERVAL_MS / safeMultiplier
  return Math.max(0, Math.floor(safeElapsedMs / tickIntervalMs))
}

/** Exposed for client-side parity with the server's tick math (PlayerVitalsHud). */
export const MANA_REGEN_BASE_INTERVAL_MS_EXPORT = MANA_REGEN_BASE_INTERVAL_MS

// ░▒▓ Passive mana: it refills on its own, 2 a second (x the Focus multiplier), counted from the
// profile's last write. No polling: the cast route adds it before it spends, the HUD shows it
// ticking up. Holding M (the mana dance) still refills 10 a second on top.
export const PASSIVE_MANA_INTERVAL_MS = 500

export function passiveManaRegen(mana: number, maxMana: number, elapsedMs: number, manaRegenMultiplier: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || mana >= maxMana) return Math.min(mana, maxMana)
  const safeMultiplier = Math.max(0.1, Math.min(10, manaRegenMultiplier))
  const gained = Math.floor(elapsedMs / (PASSIVE_MANA_INTERVAL_MS / safeMultiplier))
  return Math.min(maxMana, mana + Math.max(0, gained))
}

export function summarizeSkill(skill: PlayerSkillKey, skills: PlayerSkillSet): string {
  const stats = computePlayerStats(skills)
  switch (skill) {
    case 'vitality':
      return `${stats.maxHp} max HP`
    case 'focus':
      return `${stats.maxMana} mana, x${stats.manaRegenMultiplier.toFixed(2)} regen`
    case 'mobility':
      return `x${stats.moveSpeedMultiplier.toFixed(2)} speed`
  }
}

export function profileToPlayerSkills(profile: {
  skillFire?: number | null
  skillIce?: number | null
  skillLightning?: number | null
  skillVitality?: number | null
  skillFocus?: number | null
  skillConjuration?: number | null
  skillMobility?: number | null
}): PlayerSkillSet {
  return normalizePlayerSkills({
    vitality: profile.skillVitality ?? 0,
    focus: profile.skillFocus ?? 0,
    mobility: profile.skillMobility ?? 0,
  })
}

export function buildPlayerProgression(profile: {
  hp?: number | null
  mana?: number | null
  unspentSkillPoints?: number | null
  level?: number | null
  skillFire?: number | null
  skillIce?: number | null
  skillLightning?: number | null
  skillVitality?: number | null
  skillFocus?: number | null
  skillConjuration?: number | null
  skillMobility?: number | null
}): PlayerProgression {
  const skills = profileToPlayerSkills(profile)
  const stats = computePlayerStats(skills)
  const earned = earnedSkillPointsForLevel(profile.level ?? 1)
  const allocated = allocatedSkillPoints(skills)
  const unspent = Math.max(0, profile.unspentSkillPoints ?? Math.max(0, earned - allocated), earned - allocated)
  return {
    hp: Math.max(0, Math.min(stats.maxHp, profile.hp ?? PLAYER_BASE_STATS.hp)),
    mana: Math.max(0, Math.min(stats.maxMana, profile.mana ?? PLAYER_BASE_STATS.mana)),
    maxHp: stats.maxHp,
    maxMana: stats.maxMana,
    unspentSkillPoints: unspent,
    skills,
    stats,
  }
}

export function profileSkillField(skill: PlayerSkillKey): 'skillVitality' | 'skillFocus' | 'skillMobility' {
  switch (skill) {
    case 'vitality': return 'skillVitality'
    case 'focus': return 'skillFocus'
    case 'mobility': return 'skillMobility'
  }
}

/** A profile row with its passive mana added since its last write (read-side; the cast route writes it). */
export function withPassiveMana<T extends {
  mana?: number | null
  updatedAt?: Date | string | null
  skillFire?: number | null
  skillIce?: number | null
  skillLightning?: number | null
  skillVitality?: number | null
  skillFocus?: number | null
  skillConjuration?: number | null
  skillMobility?: number | null
}>(profile: T, nowMs = Date.now()): T {
  const stats = computePlayerStats(profileToPlayerSkills(profile))
  const stamp = profile.updatedAt ? new Date(profile.updatedAt).getTime() : NaN
  const mana = profile.mana ?? PLAYER_BASE_STATS.mana
  if (!Number.isFinite(stamp)) return profile
  return { ...profile, mana: passiveManaRegen(mana, stats.maxMana, nowMs - stamp, stats.manaRegenMultiplier) }
}
