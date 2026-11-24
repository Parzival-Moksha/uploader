// ░▒▓ DOCS PAGES — what /docs shows in a local or packaged Oasis ▓▒░
// The pages are the markdown files in website/docs (the same source the hosted site builds with Docusaurus); the
// local /docs route renders them as they are on disk, so they cannot lag behind an old build. Only the pages listed
// here are served. Pure, tested in src/lib/__tests__/docs-pages.test.ts.

export interface DocsPage {
  /** Its address under /docs and its file under website/docs, without .md. */
  slug: string
  title: string
}

export interface DocsGroup {
  title: string
  pages: DocsPage[]
}

export const DOCS_NAV: DocsGroup[] = [
  {
    title: 'Getting started',
    pages: [
      { slug: 'getting-started/first-minutes', title: 'Your first minutes' },
      { slug: 'getting-started/installation', title: 'Install' },
      { slug: 'getting-started/for-agents', title: 'For coding agents' },
    ],
  },
  {
    title: 'Playing',
    pages: [
      { slug: 'user-guide/keys', title: 'Keys' },
      { slug: 'user-guide/agents', title: 'Agents' },
      { slug: 'user-guide/building', title: 'Building' },
      { slug: 'user-guide/voice', title: 'Voice' },
    ],
  },
  {
    title: 'Help',
    pages: [
      { slug: 'reference/troubleshooting', title: 'When something is wrong' },
    ],
  },
]

export const DOCS_HOME = 'getting-started/first-minutes'

const ALL = DOCS_NAV.flatMap(group => group.pages)

/** Addresses of the pages these replaced (bookmarks, old links in the app): they open the new page. */
const OLD_ADDRESSES: Record<string, string> = {
  'getting-started/quickstart': 'getting-started/first-minutes',
  'getting-started/first-world': 'getting-started/first-minutes',
  'user-guide/controls': 'user-guide/keys',
  'reference/keybinds': 'user-guide/keys',
  'agents/overview': 'user-guide/agents',
  'agents/claude-code': 'user-guide/agents',
  'agents/hermes': 'user-guide/agents',
  'agents/mcp-tools': 'getting-started/for-agents',
  'user-guide/worlds': 'user-guide/building',
  'user-guide/crafting': 'user-guide/building',
  'user-guide/conjuring': 'user-guide/building',
  'user-guide/terrain': 'user-guide/building',
  'user-guide/sky-and-lighting': 'user-guide/building',
  'user-guide/audio': 'user-guide/voice',
}

/** The page a /docs address asks for, or null (only listed pages; /docs alone is the first page). */
export function docsPageFor(slug: string[] | undefined): DocsPage | null {
  const joined = (slug || []).join('/').replace(/\.md$/, '').replace(/\/+$/, '')
  if (!joined || joined === 'index' || joined === 'index.html') return ALL.find(page => page.slug === DOCS_HOME) || null
  const slugNow = OLD_ADDRESSES[joined] || joined
  return ALL.find(page => page.slug === slugNow) || null
}

/** A markdown file without its front matter (the --- block Docusaurus reads). */
export function stripFrontMatter(markdown: string): string {
  return markdown.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '')
}

/** A link inside a page: "./voice.md" or "../reference/troubleshooting.md#x" → "/docs/…"; anything else unchanged. */
export function docsHref(href: string, fromSlug: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  const [path, hash = ''] = href.split('#')
  if (!path.endsWith('.md')) return href
  const parts = fromSlug.split('/').slice(0, -1)
  for (const piece of path.replace(/\.md$/, '').split('/')) {
    if (piece === '..') parts.pop()
    else if (piece && piece !== '.') parts.push(piece)
  }
  return `/docs/${parts.join('/')}${hash ? `#${hash}` : ''}`
}
