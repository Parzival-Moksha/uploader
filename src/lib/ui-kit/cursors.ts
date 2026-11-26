// The Oasis's own mouse cursors (the owner, 2026-11-25: "I'm seeing a vanilla mouse… three to five designs, and make
// them selectable with one of them selected by default… the one for typing… all those could get a custom mouse
// pointer"). Owned by Hipster.
//
// Each set is eleven small pictures in public/ui/cursors/<set>/ (32 px, and 64 px for sharp screens), drawn in code by
// the studio script, never generated. They are the browser's own cursor property, so they move with no lag: no element
// follows the mouse. The set in use writes one <style id="oasis-cursors"> with its rules; "system" writes none.
// The rules cover the Tailwind cursor classes, the inline cursor styles (style={{ cursor: 'pointer' }}, and
// document.body.style.cursor from the 3D hover), links, buttons and text fields. Everything else keeps the arrow.

export type CursorSetId = 'forged' | 'glass' | 'parchment' | 'rune' | 'pixel' | 'system'

export const CURSOR_SETS: Array<{ id: CursorSetId; label: string; blurb: string }> = [
  { id: 'forged', label: 'Forged', blurb: 'Polished steel with a gold rim and a cyan gem. The spell book\'s metal.' },
  { id: 'glass', label: 'Glass', blurb: 'Crisp white with a thin dark line and a cyan halo. Reads on any background.' },
  { id: 'parchment', label: 'Parchment', blurb: 'Cream paper in brown ink, a red wax dot.' },
  { id: 'rune', label: 'Rune', blurb: 'A dark bronze tablet with a glowing amber edge.' },
  { id: 'pixel', label: 'Pixel', blurb: '8-bit, like the intro, with a cyan bevel.' },
  { id: 'system', label: 'Your computer\'s', blurb: 'The cursors of your operating system, as before.' },
]

export const DEFAULT_CURSOR_SET: CursorSetId = 'forged'

export type CursorKind = 'arrow' | 'hand' | 'text' | 'grab' | 'grabbing' | 'move' | 'resize-h' | 'resize-v' | 'resize-d' | 'resize-d2' | 'busy' | 'no'

/** Each kind: its hot spot (on the 32 px picture) and the browser cursor it stands in for if the picture fails. */
export const CURSOR_KINDS: Record<CursorKind, { hot: [number, number]; fallback: string }> = {
  arrow: { hot: [3, 2], fallback: 'default' },
  hand: { hot: [13, 2], fallback: 'pointer' },
  text: { hot: [16, 16], fallback: 'text' },
  grab: { hot: [16, 16], fallback: 'grab' },
  grabbing: { hot: [16, 16], fallback: 'grabbing' },
  move: { hot: [16, 16], fallback: 'move' },
  'resize-h': { hot: [16, 16], fallback: 'ew-resize' },
  'resize-v': { hot: [16, 16], fallback: 'ns-resize' },
  'resize-d': { hot: [16, 16], fallback: 'nwse-resize' },
  'resize-d2': { hot: [16, 16], fallback: 'nesw-resize' },
  busy: { hot: [16, 16], fallback: 'wait' },
  no: { hot: [16, 16], fallback: 'not-allowed' },
}

/** An inline style's cursor value, as React and element.style.cursor write it into the style attribute. */
const inline = (...values: string[]) => values.map(v => `[style*="cursor: ${v}"]`)
const tw = (...classes: string[]) => classes.map(c => `.cursor-${c}`)

/**
 * Which elements wear which kind. Later rows win over earlier ones (every selector is wrapped in :where(), so order
 * alone decides), so the specific kinds come after the arrow and the hand.
 */
const RULES: Array<[CursorKind, string[]]> = [
  ['arrow', ['html', 'body', ':disabled', ...tw('default', 'auto'), '[class~="disabled:cursor-default"]:disabled', ...inline('default', 'auto')]],
  ['hand', ['a[href]', 'button:not(:disabled)', '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="menuitem"]', '[role="option"]', 'summary', 'select', 'label[for]',
    'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]', 'input[type="color"]', 'input[type="button"]', 'input[type="submit"]', 'input[type="file"]',
    ...tw('pointer'), ...inline('pointer')]],
  ['text', ['textarea', '[contenteditable=""]', '[contenteditable="true"]', 'input:not([type])',
    ...['text', 'search', 'email', 'password', 'number', 'url', 'tel'].map(t => `input[type="${t}"]`), ...tw('text'), ...inline('text')]],
  ['grab', [...tw('grab'), ...inline('grab')]],
  ['grabbing', [...tw('grabbing'), '[class~="active:cursor-grabbing"]:active', ...inline('grabbing')]],
  ['move', [...tw('move', 'all-scroll'), ...inline('move', 'all-scroll')]],
  ['resize-h', [...tw('col-resize', 'ew-resize', 'e-resize', 'w-resize'), ...inline('col-resize', 'ew-resize', 'e-resize', 'w-resize')]],
  ['resize-v', [...tw('row-resize', 'ns-resize', 'n-resize', 's-resize'), ...inline('row-resize', 'ns-resize', 'n-resize', 's-resize')]],
  ['resize-d', [...tw('nwse-resize', 'se-resize', 'nw-resize'), ...inline('nwse-resize', 'se-resize', 'nw-resize')]],
  ['resize-d2', [...tw('nesw-resize', 'ne-resize', 'sw-resize'), ...inline('nesw-resize', 'ne-resize', 'sw-resize')]],
  ['busy', [...tw('wait', 'progress'), '[class~="disabled:cursor-wait"]:disabled', ...inline('wait', 'progress')]],
  ['no', [...tw('not-allowed', 'no-drop'), '[class~="disabled:cursor-not-allowed"]:disabled', ...inline('not-allowed', 'no-drop')]],
]

export function cursorUrl(set: Exclude<CursorSetId, 'system'>, kind: CursorKind, sharp = false): string {
  return `/ui/cursors/${set}/${kind}${sharp ? '@2x' : ''}.png`
}

/** The CSS of one set: '' for the system's own cursors. */
export function buildCursorCss(set: CursorSetId): string {
  if (set === 'system') return ''
  const lines: string[] = []
  for (const [kind, selectors] of RULES) {
    const { hot: [x, y], fallback } = CURSOR_KINDS[kind]
    const one = cursorUrl(set, kind), two = cursorUrl(set, kind, true)
    // The plain picture first; browsers that know image-set take the sharp one on sharp screens (the hot spot stays in
    // CSS pixels of the 32 px picture).
    lines.push(`:where(${selectors.join(', ')}) { cursor: url(${one}) ${x} ${y}, ${fallback} !important; cursor: image-set(url(${one}) 1x, url(${two}) 2x) ${x} ${y}, ${fallback} !important; }`)
  }
  // Hidden stays hidden (pointer lock, the camera drag), and the help cursor keeps its question mark.
  lines.push(`:where(.cursor-none, [style*="cursor: none"]) { cursor: none !important; }`)
  lines.push(`:where(.cursor-help, [style*="cursor: help"]) { cursor: help !important; }`)
  return lines.join('\n')
}

/** Write the set's rules into the page, and fetch its pictures so the first hover over a button already has its hand. */
export function applyCursorSet(set: CursorSetId): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return
  const root = document.documentElement
  if (root.dataset.cursorSet === set && document.getElementById('oasis-cursors')) return
  root.dataset.cursorSet = set
  const el = document.getElementById('oasis-cursors') ?? document.head.appendChild(document.createElement('style'))
  el.id = 'oasis-cursors'
  el.textContent = buildCursorCss(set)
  if (set === 'system' || typeof Image === 'undefined') return
  const sharp = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) > 1
  for (const kind of Object.keys(CURSOR_KINDS) as CursorKind[]) new Image().src = cursorUrl(set, kind, sharp)
}
