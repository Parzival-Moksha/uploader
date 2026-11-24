// ░▒▓ DOCS MARKDOWN — the small markdown of website/docs, to HTML, for the local /docs route ▓▒░
// A Next route may not import react-dom/server, and the remark/rehype packages are not direct dependencies; the docs
// use a small set of markdown, so this renders exactly that: headings, paragraphs, lists (- and 1.), tables, fenced
// code, inline code, bold, italic and links. Everything is escaped first. Pure, tested (docs-markdown.test.ts).

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/**
 * Whether a link may be a link. The docs take pull requests and /docs runs on the Oasis's own address (its local
 * key, its agent routes), so only http, https, mailto, a path on this site, a #anchor or a relative page link pass;
 * javascript:, data: and every other scheme stay plain text, as does anything with a control character (browsers
 * drop those before reading the scheme, which would let "\u0001javascript:" through a scheme check).
 */
export function isSafeHref(href: string): boolean {
  // Control characters, whitespace and backslashes (browsers read "\" as "/") never belong in a docs link.
  if (!href || /[\u0000-\u001F\u007F\s\\]/.test(href)) return false
  if (/^(https?:\/\/|mailto:)/i.test(href)) return true
  if (href.startsWith('//')) return false
  if (href.startsWith('/') || href.startsWith('#')) return true
  // Relative: no scheme before the first / ? or #.
  return !/^[^/?#]*:/.test(href)
}

/** Inline markdown in one line: `code`, **bold**, *italic*, [text](href). `link` maps each href; unsafe ones stay text. */
export function inline(text: string, link: (href: string) => string = h => h): string {
  const codes: string[] = []
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => { codes.push(code); return `\u0000${codes.length - 1}\u0000` })
  s = escapeHtml(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const raw = href.replace(/&amp;/g, '&')
    const to = isSafeHref(raw) ? link(raw) : ''
    if (!to || !isSafeHref(to)) return `[${label}](${href})`
    const external = /^https?:/i.test(to)
    return `<a href="${escapeHtml(to)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${label}</a>`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`)
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

export function markdownToHtml(markdown: string, link: (href: string) => string = h => h): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      out.push(`<h${level} id="${id}">${inline(heading[2], link)}</h${level}>`)
      i++
      continue
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c, link)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, link)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const bullet = /^(\s*)([-*]|\d+\.)\s+/.exec(line)
    if (bullet) {
      const ordered = /\d/.test(bullet[2])
      const items: string[] = []
      while (i < lines.length && /^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^(\s*)([-*]|\d+\.)\s+/, '')
        i++
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`
        items.push(`<li>${inline(item, link)}</li>`)
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim())
    if (!para.length) { out.push(`<p>${inline(line, link)}</p>`); i++; continue }
    out.push(`<p>${inline(para.join(' '), link)}</p>`)
  }
  return out.join('\n')
}
