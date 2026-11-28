// Which file under public/ a request names (src/app/api/public-file/[...path]/route.ts): never outside public/.
import fs from 'node:fs'
import path from 'node:path'

/** The file under public/ this request names, or null (outside it, hidden tricks, or not a file). */
export function publicFileFor(segments: string[], publicDir = process.env.OASIS_PUBLIC_DIR || path.join(process.cwd(), 'public')): string | null {
  if (!segments.length || segments.some(s => !s || s === '.' || s === '..' || s.includes('\0') || /[\\/]/.test(s))) return null
  const base = path.resolve(publicDir)
  const target = path.resolve(base, ...segments)
  if (!target.startsWith(base + path.sep)) return null
  try { return fs.statSync(target).isFile() ? target : null } catch { return null }
}

/** Sent with every file /api/public-file serves: an HTML or SVG file opens sandboxed, never with the Oasis's origin and key. */
export const PUBLIC_FILE_CSP = 'sandbox allow-scripts allow-forms allow-popups'
