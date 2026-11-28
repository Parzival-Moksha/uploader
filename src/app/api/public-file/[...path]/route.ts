// public/ files made after the page server started (27 Nov: on a built copy, `next start` serves only what public/
// held at start; every picture, video, song, voice, model, thumbnail, upload and screenshot made while he played
// answered 404). next.config.mjs sends a request here only when nothing else matched a path with a file extension,
// so startup files keep Next's own serving. Reads the disk on each request: content type by extension, HEAD, single
// byte ranges (206) for audio and video seeking, never a path outside public/ (no "..", no NUL, resolved and checked).
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { PUBLIC_FILE_CSP, publicFileFor } from '@/lib/public-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', vrm: 'model/gltf-binary', fbx: 'application/octet-stream', obj: 'text/plain', bin: 'application/octet-stream', hdr: 'application/octet-stream', ktx2: 'image/ktx2',
  json: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  pdf: 'application/pdf', zip: 'application/zip', csv: 'text/csv; charset=utf-8', vtt: 'text/vtt; charset=utf-8', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function serve(request: NextRequest, params: { path?: string[] }, head: boolean): Promise<Response> {
  const file = publicFileFor(params.path || [])
  if (!file) return notFound()
  const stat = fs.statSync(file)
  const type = TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream'
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=0, must-revalidate',
    'last-modified': stat.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
    // An HTML (or SVG) file made or downloaded while he plays opens as a sandboxed page: its scripts never run in the
    // Oasis's origin with his key (Anorak, 28 Nov 01:05). Pictures, sound and models are untouched by it.
    'content-security-policy': PUBLIC_FILE_CSP,
  }
  const range = request.headers.get('range')
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (range && m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]))
    let end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
    if (!m[1]) end = stat.size - 1
    if (start >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } })
    }
    start = Math.max(0, start)
    const length = end - start + 1
    const body = head ? null : (Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream)
    return new Response(body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(length) } })
  }
  const body = head ? null : (Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream)
  return new Response(body, { status: 200, headers: { ...headers, 'content-length': String(stat.size) } })
}

export async function GET(request: NextRequest, { params }: { params: { path?: string[] } }) {
  return serve(request, params, false)
}

export async function HEAD(request: NextRequest, { params }: { params: { path?: string[] } }) {
  return serve(request, params, true)
}
