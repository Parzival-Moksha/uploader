import { access, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import { NextResponse } from 'next/server'

import { DOCS_NAV, docsHref, docsPageFor, stripFrontMatter, type DocsPage } from '@/lib/docs-pages'
import { escapeHtml, markdownToHtml } from '@/lib/docs-markdown'
import { isHostedOasis } from '@/lib/oasis-profile'

const docsRoot = resolve(process.cwd(), 'public', 'docs-site')

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

function safeResolve(...segments: string[]) {
  const target = resolve(docsRoot, ...segments)
  if (target !== docsRoot && !target.startsWith(`${docsRoot}${sep}`)) {
    return null
  }
  return target
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveDocsTarget(slug: string[]) {
  if (slug.length === 0) {
    return safeResolve('index.html')
  }

  const candidate = safeResolve(...slug)
  if (!candidate) {
    return null
  }

  const lastSegment = slug[slug.length - 1]
  if (lastSegment.includes('.') && await pathExists(candidate)) {
    return candidate
  }

  const nestedIndex = safeResolve(...slug, 'index.html')
  if (nestedIndex && await pathExists(nestedIndex)) {
    return nestedIndex
  }

  const htmlFile = `${candidate}.html`
  if (await pathExists(htmlFile)) {
    return htmlFile
  }

  if (await pathExists(candidate)) {
    return candidate
  }

  return null
}

function contentTypeFor(path: string) {
  return CONTENT_TYPES[extname(path).toLowerCase()] || 'application/octet-stream'
}

function notBuiltResponse() {
  return new NextResponse(
    [
      '<!doctype html>',
      '<html><head><meta charset="utf-8"><title>Docs not built</title></head>',
      '<body style="font-family: system-ui, sans-serif; padding: 32px; background: #08111b; color: #e7f0f8;">',
      '<h1 style="margin-top: 0;">Local docs are not built yet.</h1>',
      '<p>Run <code>pnpm docs:local</code>, then refresh <code>/docs</code>.</p>',
      '</body></html>',
    ].join(''),
    {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

function firstHeaderValue(value: string | null | undefined) {
  return (value ?? '').split(',')[0]?.trim() ?? ''
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase()
  return normalized === 'localhost'
    || normalized.startsWith('localhost:')
    || normalized === '127.0.0.1'
    || normalized.startsWith('127.0.0.1:')
    || normalized === '[::1]'
    || normalized.startsWith('[::1]:')
}

function publicOriginFromEnv() {
  const configured = firstHeaderValue(process.env.NEXT_PUBLIC_OASIS_URL)
    || firstHeaderValue(process.env.OASIS_PUBLIC_URL)

  if (!configured) {
    return null
  }

  try {
    const url = new URL(configured)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url
    }
  } catch {
    return null
  }

  return null
}

function docsQuickstartUrl(request: Request) {
  const requestUrl = new URL(request.url)
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const host = forwardedHost
    || firstHeaderValue(request.headers.get('host'))
    || requestUrl.host
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  const protocol = forwardedProto || requestUrl.protocol.replace(':', '')
  const envOrigin = publicOriginFromEnv()
  const base = envOrigin && isLoopbackHost(host) && protocol === 'https'
    ? envOrigin
    : new URL(`${protocol || 'http'}://${host}`)
  const url = new URL('/docs/getting-started/first-minutes', base)

  if (isLoopbackHost(url.host)) {
    url.protocol = 'http:'
  } else if (url.hostname.endsWith('04515.xyz')) {
    url.protocol = 'https:'
  }

  return url
}

export async function GET(
  request: Request,
  { params }: { params: { slug?: string[] } },
) {
  const slug = params.slug ?? []
  // A local or packaged Oasis: the pages as they are on disk (website/docs), never an old build.
  if (!isHostedOasis()) return localDocsResponse(slug)
  const docsIndex = safeResolve('index.html')

  if (!docsIndex || !await pathExists(docsIndex)) {
    return notBuiltResponse()
  }

  if (slug.length === 0 || (slug.length === 1 && slug[0] === 'index.html')) {
    return NextResponse.redirect(docsQuickstartUrl(request), 307)
  }

  const target = await resolveDocsTarget(slug)
  if (!target) {
    return new NextResponse('Not found', { status: 404 })
  }

  const body = await readFile(target)
  const isHtml = extname(target).toLowerCase() === '.html'

  return new NextResponse(body, {
    headers: {
      'content-type': contentTypeFor(target),
      'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
    },
  })
}

// ─── a local or packaged Oasis: website/docs rendered as it is ───────────────────────────────────────────

const LOCAL_DOCS_CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#0b0f17;color:#e6ebf2;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{display:flex;min-height:100vh}
nav{flex:0 0 250px;padding:28px 20px;border-right:1px solid #1d2635;background:#0e1420}
nav .brand{font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:13px;color:#c4b5fd;margin-bottom:18px;display:block;text-decoration:none}
nav h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7d8aa0;margin:20px 0 6px}
nav a{display:block;color:#cfd8e6;text-decoration:none;padding:4px 8px;border-radius:6px;font-size:14px}
nav a:hover{background:#18212f}nav a.on{background:#241b3f;color:#fff}
main{flex:1;max-width:820px;padding:36px 44px 80px}
h1{font-size:30px;margin:0 0 18px}h2{font-size:21px;margin:34px 0 10px;border-bottom:1px solid #1d2635;padding-bottom:6px}
a{color:#a5b4fc}code{background:#162030;padding:1px 5px;border-radius:4px;font-size:14px}
pre{background:#111a27;border:1px solid #1d2635;padding:12px 14px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14.5px}th,td{border:1px solid #1d2635;padding:6px 10px;text-align:left;vertical-align:top}th{background:#111a27}
.back{display:inline-block;margin-bottom:22px;font-size:13px;color:#7d8aa0}
@media (max-width:760px){.wrap{display:block}nav{border-right:0;border-bottom:1px solid #1d2635}main{padding:24px 18px 60px}}
`

function localDocsHtml(page: DocsPage, markdown: string) {
  const body = markdownToHtml(markdown, href => docsHref(href, page.slug))
  const nav = DOCS_NAV.map(group => `<h3>${escapeHtml(group.title)}</h3>${group.pages.map(p => `<a href="/docs/${p.slug}"${p.slug === page.slug ? ' class="on"' : ''}>${escapeHtml(p.title)}</a>`).join('')}`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.title)} · The Oasis</title><style>${LOCAL_DOCS_CSS}</style></head><body><div class="wrap"><nav><a class="brand" href="/docs">The Oasis · docs</a>${nav}</nav><main><a class="back" href="/?profile=village">← back to the village</a>${body}</main></div></body></html>`
}

async function localDocsResponse(slug: string[]) {
  const page = docsPageFor(slug)
  if (!page) return new NextResponse('Not found', { status: 404 })
  let markdown: string
  try {
    markdown = await readFile(resolve(process.cwd(), 'website', 'docs', `${page.slug}.md`), 'utf8')
  } catch {
    return new NextResponse('This page is missing from this copy of the Oasis.', { status: 404 })
  }
  return new NextResponse(localDocsHtml(page, stripFrontMatter(markdown)), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
