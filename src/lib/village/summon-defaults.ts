// ░▒▓ SUMMON DEFAULTS — the quiet answers the summon menu starts from ▓▒░
// Pure, tested in src/lib/__tests__/summon-defaults.test.ts. The working folder is shown, not asked for: the
// last folder an agent was created in, else the folder of your newest session, else an Oasis folder in your
// home (created on Create). Hermes profiles are only ever real Hermes homes (a config.yaml), the rule the
// engine enforces since 8bc9518 (hermes.js resolveHermesHome).

type PathJoin = { join: (...parts: string[]) => string }

export type FolderSource = 'last' | 'session' | 'workspace'

export interface DefaultFolder {
  path: string
  source: FolderSource
  /** The folder may not exist yet: Create makes it (only the workspace one). */
  create: boolean
}

/** Where a new agent works unless you change it. */
export function pickDefaultFolder(last: string | null | undefined, recent: string[], workspace: string): DefaultFolder {
  const remembered = (last || '').trim()
  if (remembered) return { path: remembered, source: 'last', create: false }
  const newest = recent.map(dir => (dir || '').trim()).find(Boolean)
  if (newest) return { path: newest, source: 'session', create: false }
  return { path: workspace, source: 'workspace', create: true }
}

export const FOLDER_SOURCE_WORD: Record<FolderSource, string> = {
  last: 'where you last summoned',
  session: 'your newest session',
  workspace: 'the Oasis folder, made on Create',
}

/** `~/Oasis`: a newcomer's agents work here until they pick another folder. */
export function oasisWorkspace(home: string, pathApi: PathJoin): string {
  return pathApi.join(home, 'Oasis')
}

export interface HermesProfile {
  /** "main" for the home itself, else the profile folder's name. */
  name: string
  path: string
  /** Its default model, when config.yaml names one. */
  model: string
}

/** The installer's Hermes home: %LOCALAPPDATA%\hermes on Windows, ~/.hermes elsewhere (hermes.js resolveHermesHome). */
export function hermesInstallHome(platform: NodeJS.Platform, home: string, localAppData: string | undefined, pathApi: PathJoin): string {
  if (platform === 'win32') return pathApi.join(localAppData || pathApi.join(home, 'AppData', 'Local'), 'hermes')
  return pathApi.join(home, '.hermes')
}

/** `model:\n  default: gpt-6.1-sol` → "gpt-6.1-sol"; '' when it names none. A line read, not a YAML parser. */
export function hermesModelOf(configYaml: string): string {
  const lines = configYaml.split(/\r?\n/)
  const start = lines.findIndex(line => /^model:\s*$/.test(line))
  if (start === -1) {
    const inline = lines.find(line => /^model:\s*\S/.test(line))
    return inline ? inline.replace(/^model:\s*/, '').replace(/^['"]|['"]$/g, '').trim() : ''
  }
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break
    const match = /^\s+default:\s*(.*)$/.exec(line)
    if (match) return match[1].replace(/^['"]|['"]$/g, '').trim()
  }
  return ''
}

/** Where a spell's agent stands: `distance` in front of the caster, facing back at them (yaw as village-homes' yawToward). */
export function spotInFront(position: [number, number, number], forward: [number, number, number], distance = 2.2): { x: number; z: number; yaw: number } {
  const length = Math.hypot(forward[0], forward[2]) || 1
  const x = position[0] + (forward[0] / length) * distance
  const z = position[2] + (forward[2] / length) * distance
  const dx = position[0] - x
  const dz = position[2] - z
  return { x, z, yaw: Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz) }
}

/**
 * A first run's sessions, in an arc in front of the newcomer so they are the first thing seen: `count` spots at
 * `distance`, spread over `spread` radians, each facing the newcomer.
 */
export function arcInFront(position: [number, number, number], forward: [number, number, number], count: number, distance = 4.5, spread = 1.1): Array<{ x: number; z: number; yaw: number }> {
  const base = Math.atan2(forward[0], forward[2])
  const out: Array<{ x: number; z: number; yaw: number }> = []
  for (let i = 0; i < count; i++) {
    const angle = base + (count === 1 ? 0 : -spread / 2 + (spread * i) / (count - 1))
    const x = position[0] + Math.sin(angle) * distance
    const z = position[2] + Math.cos(angle) * distance
    out.push({ x, z, yaw: Math.atan2(position[0] - x, position[2] - z) })
  }
  return out
}
