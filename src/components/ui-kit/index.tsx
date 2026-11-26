'use client'

// ░▒▓ THE OASIS UI KIT ▓▒░  (owner: Hipster; the how-to is this header)
//
// Every menu in the Oasis is built from these, so one setting restyles all of them:
//   Settings (top right): the menu style (Glass, Forged, Parchment, Rune) and, for Glass, see-through, blur, colour.
// Use the components; don't style menus yourself. Each element carries data-kit-style; its look lives in kit-css.ts.
//
//   <KitPanel title="Summon" onClose={…}>…</KitPanel>        a menu panel (the frame, the background, a ✕)
//   <KitButton variant="primary|plain|danger">Go</KitButton>  a button
//   <KitTileButton picture="/ui/…webp" icon="⚡" label="Lights" sub="…" accent="#ffd66b" />   a big picture button
//   <KitToggle checked onChange label hint />                 a switch
//   <KitSlider label value min max step onChange format />    a slider
//   <KitTabs tabs={[{id,label}]} active onChange />           tabs
//   <KitPickTile picture label selected />                   a small picture to pick (skies, grounds); tiles take selected too
//   <KitCard title>…</KitCard>  <KitProgress label value max format accent />   a box, a bar that fills
//   <KitTextField label value onChange multiline size="large" />  <KitSelectField label value onChange options />           a text box (title="…" on anything gives the Oasis tooltip)
//   <KitDialog open title onClose actions>…</KitDialog>       a modal dialog;  await kitConfirm({ title, body, confirm, danger })
//   <KitLookControls />                                       the shared style / see-through / blur / colour controls
//   <KitChip pressed tone="danger">Settings</KitChip>          a small header button (a panel's Settings, dismiss, close)
// Layers: never a z-index number of your own. `const z = useLayer(id, 'panel', open, close)` from src/lib/ui-kit/layers.ts,
// or a class z-[var(--z-place)]; with a close, Esc closes your overlay when it is the topmost thing.
// Before calling a menu done: look at it in all four styles (Settings > Experiments), and if it holds a long list or a
// thread, fill it with 100+ lines and check it still scrolls in Glass and a textured style (in a 3D screen too).

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { KIT_CSS } from './kit-css'
import { MENU_BLUR_MAX, MENU_STYLES, MENU_SWATCHES, DEFAULT_MENU_LOOK, setMenuLook, useMenuLook, type MenuStyleId, type ToggleLookId } from '@/lib/ui-kit/menu-look'
import { useLayer } from '@/lib/ui-kit/layers'
import { CURSOR_SETS, type CursorSetId } from '@/lib/ui-kit/cursors'
import { keepImages } from '@/lib/ui-kit/image-pool'

// ── style plumbing ─────────────────────────────────────────────────────────────────────────────

let cssInjected = false
function useKitCss() {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const el = document.getElementById('oasis-ui-kit') ?? document.head.appendChild(document.createElement('style'))
  el.id = 'oasis-ui-kit'
  el.textContent = KIT_CSS
}

/** Show a part of the screen in a style other than the one in use (the samples in Settings > Experiments). */
export const KitStyleOverride = createContext<MenuStyleId | null>(null)

export function useKitStyle(): MenuStyleId {
  useKitCss()
  const look = useMenuLook()
  return useContext(KitStyleOverride) ?? look.style
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

// ── panel ──────────────────────────────────────────────────────────────────────────────────────

export function KitPanel({ title, icon, onClose, headerExtra, children, className, style, ...rest }: {
  title?: ReactNode
  icon?: ReactNode
  onClose?: () => void
  /** Things in the header, right of the title (e.g. <KitLookControls />). */
  headerExtra?: ReactNode
  children?: ReactNode
  className?: string
  style?: React.CSSProperties
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  const kit = useKitStyle()
  return (
    <div {...rest} data-kit-style={kit} className={cx('kit-panel', className)} style={style}>
      {(title || onClose || headerExtra) && (
        <div className="kit-panel-head">
          {icon}
          <div className="kit-panel-title">{title}</div>
          {headerExtra}
          {onClose && <KitCloseButton onClick={onClose} />}
        </div>
      )}
      <div className="kit-panel-body">{children}</div>
    </div>
  )
}

export function KitCloseButton({ onClick, title = 'Close' }: { onClick: () => void; title?: string }) {
  const kit = useKitStyle()
  return <button type="button" data-kit-style={kit} className="kit-close" onClick={onClick} title={title} aria-label={title}>✕</button>
}

// ── buttons ────────────────────────────────────────────────────────────────────────────────────

export function KitButton({ variant = 'plain', className, children, ...rest }: { variant?: 'plain' | 'primary' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const kit = useKitStyle()
  return <button type="button" {...rest} data-kit-style={kit} data-variant={variant} className={cx('kit-btn', className)}>{children}</button>
}

/**
 * A small header button (a panel's "Settings", "dismiss", "F screen"): a word on a plate. pressed = the page it opens
 * is shown; tone danger reddens on hover (stop, dismiss).
 */
export function KitChip({ pressed, tone, className, children, ...rest }: { pressed?: boolean; tone?: 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const kit = useKitStyle()
  return <button type="button" aria-pressed={pressed} {...rest} data-kit-style={kit} data-pressed={pressed ? '1' : undefined} data-tone={tone} className={cx('kit-chip', className)}>{children}</button>
}

export function KitTileButton({ picture, icon, label, sub, badge, accent, selected, className, style, ...rest }: {
  /** A painted picture (e.g. /ui/spellbook/tiles/<spell>.gpt2.webp). */
  picture?: string
  icon?: ReactNode
  label: ReactNode
  sub?: ReactNode
  /** A small corner label, e.g. "under development". */
  badge?: ReactNode
  /** Colour of the icon disc and the hover glow; pick it to rhyme with the picture. */
  accent?: string
  /** The one chosen (each style draws it). */
  selected?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const kit = useKitStyle()
  return (
    <button type="button" {...rest} aria-pressed={selected} data-selected={selected ? '1' : '0'} data-kit-style={kit} className={cx('kit-tile', className)} style={{ ...(accent ? { ['--kit-accent' as string]: accent } : {}), ...style }}>
      {picture && <span className="kit-tile-pic" style={{ backgroundImage: `url(${picture})` }} />}
      {badge && <span className="kit-tile-badge">{badge}</span>}
      <span className="kit-tile-text">
        {icon && <span className="kit-tile-icon">{icon}</span>}
        <span className="block w-full min-w-0">
          <span className="kit-tile-label">{label}</span>
          {sub && <span className="kit-tile-sub">{sub}</span>}
        </span>
      </span>
    </button>
  )
}

/** A small picture to pick from a grid (a sky, a ground texture). */
export function KitPickTile({ picture, label, selected, accent, className, style, ...rest }: { picture: string; label?: ReactNode; selected?: boolean; accent?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const kit = useKitStyle()
  return (
    <button type="button" {...rest} aria-pressed={selected} data-selected={selected ? '1' : '0'} data-kit-style={kit} className={cx('kit-pick', className)} style={{ ...(accent ? { ['--kit-accent' as string]: accent } : {}), ...style }}>
      <span className="kit-pick-pic" style={{ backgroundImage: `url(${picture})` }} />
      {label && <span className="kit-pick-label">{label}</span>}
    </button>
  )
}

/** A box inside a panel (a stat, an account, a list row group). */
export function KitCard({ title, children, className, ...rest }: { title?: ReactNode; children?: ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  const kit = useKitStyle()
  return (
    <div {...rest} data-kit-style={kit} className={cx('kit-card', className)}>
      {title && <span className="kit-card-title">{title}</span>}
      {children}
    </div>
  )
}

/** A bar that fills (XP to the next level, hours of a day). value and max in any unit. */
export function KitProgress({ label, value, max, format, accent }: { label?: ReactNode; value: number; max: number; format?: (value: number, max: number) => ReactNode; accent?: string }) {
  const kit = useKitStyle()
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div data-kit-style={kit} className="kit-progress" style={accent ? { ['--kit-accent' as string]: accent } : undefined} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {(label || format) && <span className="kit-progress-row"><span>{label}</span><span className="tabular-nums opacity-80">{format ? format(value, max) : `${Math.round(share * 100)}%`}</span></span>}
      <span className="kit-progress-track block"><span className="kit-progress-fill block" style={{ width: `${share * 100}%` }} /></span>
    </div>
  )
}

// ── inputs ─────────────────────────────────────────────────────────────────────────────────────

/** Show switches in a design other than the one in use (the samples in Settings > Experiments). */
export const KitToggleOverride = createContext<ToggleLookId | null>(null)

export function KitToggle({ checked, onChange, label, hint, disabled, accent, ...data }: {
  checked: boolean; onChange: (next: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; accent?: string
  /** data-* attributes (what tests and agents find the switch by) go on the row. */
  [attr: `data-${string}`]: string | undefined
}) {
  const kit = useKitStyle()
  const override = useContext(KitToggleOverride)
  const look = useMenuLook()
  const design = override ?? look.toggle
  return (
    <label {...data} data-kit-style={kit} data-toggle={design} data-on={checked ? '1' : '0'} className="kit-toggle" style={accent ? { ['--kit-accent' as string]: accent } : undefined}>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="sr-only" />
      <span className="kit-toggle-track"><span className="kit-toggle-knob" /></span>
      <span className="kit-toggle-text">{label}{hint && <span className="kit-hint">{hint}</span>}</span>
    </label>
  )
}

export function KitSlider({ label, value, min, max, step = 1, onChange, format, hint, width }: {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (value: number) => void
  /** How the value reads, e.g. v => `${v}%`. */
  format?: (value: number) => ReactNode
  hint?: ReactNode
  /** Fixed width in px (default: the full width). */
  width?: number
}) {
  const kit = useKitStyle()
  return (
    <label data-kit-style={kit} className="kit-slider" style={width ? { width } : undefined}>
      <span className="kit-slider-row"><span>{label}</span><span className="tabular-nums opacity-80">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} aria-label={typeof label === 'string' ? label : undefined} />
      {hint && <span className="kit-hint">{hint}</span>}
    </label>
  )
}

export function KitTabs<T extends string>({ tabs, active, onChange }: { tabs: Array<{ id: T; label: ReactNode; title?: string }>; active: T; onChange: (id: T) => void }) {
  const kit = useKitStyle()
  return (
    <div className="kit-tabs" role="tablist">
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} data-kit-style={kit} data-on={tab.id === active ? '1' : '0'} className="kit-tab" title={tab.title} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function KitTextField({ label, hint, multiline, rows = 3, size, ...rest }: { label?: ReactNode; hint?: ReactNode; multiline?: boolean; rows?: number; size?: 'normal' | 'large' } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const kit = useKitStyle()
  return (
    <label data-kit-style={kit} data-size={size ?? 'normal'} className="kit-field">
      {label && <span className="kit-label">{label}</span>}
      {multiline ? <textarea rows={rows} {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} /> : <input {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />}
      {hint && <span className="kit-hint">{hint}</span>}
    </label>
  )
}

/** A choice from a list, in the same field look. */
export function KitSelectField({ label, hint, size, options, children, ...rest }: {
  label?: ReactNode; hint?: ReactNode; size?: 'normal' | 'large'
  /** Shorthand for simple lists; or pass <option> children. */
  options?: Array<{ value: string; label: string }>
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>) {
  const kit = useKitStyle()
  return (
    <label data-kit-style={kit} data-size={size ?? 'normal'} className="kit-field">
      {label && <span className="kit-label">{label}</span>}
      <select {...rest}>{options ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : children}</select>
      {hint && <span className="kit-hint">{hint}</span>}
    </label>
  )
}

// ── dialog ─────────────────────────────────────────────────────────────────────────────────────

export function KitDialog({ open, title, children, actions, onClose, danger }: {
  open: boolean; title: ReactNode; children?: ReactNode
  /** Buttons along the bottom (KitButton). */
  actions?: ReactNode
  /** Esc, a click outside, or ✕. */
  onClose: () => void
  /** A destructive choice: a red edge and a slow red pulse. */
  danger?: boolean
}) {
  const kit = useKitStyle()
  const boxRef = useRef<HTMLDivElement>(null)
  // The dialog layer (src/lib/ui-kit/layers.ts): above every menu and window; Esc closes it first, even from a field.
  const id = `kit-dialog-${useId()}`
  const z = useLayer(id, 'dialog', open, onClose)
  useEffect(() => {
    if (!open) return
    boxRef.current?.querySelector<HTMLElement>('[data-kit-autofocus], button[data-variant="primary"], button[data-variant="danger"]')?.focus()
  }, [open])
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="kit-dialog-backdrop" style={{ zIndex: z }} data-kit-dialog onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={boxRef} role="dialog" aria-modal="true" data-kit-style={kit} data-danger={danger ? '1' : '0'} className="kit-dialog kit-panel" onKeyDown={event => event.stopPropagation()}>
        <div className="kit-panel-head"><div className="kit-panel-title">{title}</div><KitCloseButton onClick={onClose} /></div>
        <div className="kit-dialog-body">{children}</div>
        {actions && <div className="kit-dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

// The Oasis's own dialogs, instead of the browser's grey boxes (the owner, 2026-11-24: "could look cooler, better, like in
// a game, not a browser popup"). One host (KitConfirmHost, mounted in Scene.tsx) shows one at a time on the dialog
// layer: Enter is yes (the focus is on it, or in the field), Esc is no (also from the field).
type DialogRequest =
  | { kind: 'confirm'; title: ReactNode; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'alert'; title: ReactNode; body?: ReactNode; ok?: string; danger?: boolean; resolve: () => void }
  | { kind: 'prompt'; title: ReactNode; body?: ReactNode; label?: ReactNode; defaultValue?: string; placeholder?: string; confirm?: string; cancel?: string; resolve: (value: string | null) => void }
let pending: DialogRequest | null = null
const confirmListeners = new Set<() => void>()

/** The 'no' of a request (a newer one replaces it, or Esc). */
function dismiss(request: DialogRequest) {
  if (request.kind === 'confirm') request.resolve(false)
  else if (request.kind === 'alert') request.resolve()
  else request.resolve(null)
}

function ask(request: DialogRequest) {
  if (pending) dismiss(pending)
  pending = request
  confirmListeners.forEach(fn => fn())
}

/** A yes/no question in the Oasis's own dialog (instead of window.confirm). */
export function kitConfirm(options: { title: ReactNode; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => ask({ kind: 'confirm', ...options, resolve }))
}

/** A message with one OK (instead of window.alert). */
export function kitAlert(options: { title: ReactNode; body?: ReactNode; ok?: string; danger?: boolean }): Promise<void> {
  return new Promise(resolve => ask({ kind: 'alert', ...options, resolve }))
}

/** A line of text to type (instead of window.prompt): the text, or null for Cancel / Esc. */
export function kitPrompt(options: { title: ReactNode; body?: ReactNode; label?: ReactNode; defaultValue?: string; placeholder?: string; confirm?: string; cancel?: string }): Promise<string | null> {
  return new Promise(resolve => ask({ kind: 'prompt', ...options, resolve }))
}

/** Mounted once (Scene.tsx); shows what kitConfirm, kitAlert and kitPrompt ask. */
/** Every picture the kit's styles draw (public/ui/rail). */
const KIT_PICTURES = ['banner', 'divider-1', 'divider-2', 'divider-3', 'divider-4', 'frame-9', 'frame-large', 'frame-ornament-bottom', 'frame-ornament-top', 'parchment-gold', 'parchment-slate', 'parchment-stone', 'parchment-vine', 'parchment-wood', 'plate-blue', 'plate-ember', 'plate-gold', 'plate-green', 'plate-red', 'plate-silver', 'plate-violet'].map(name => `/ui/rail/${name}.png`)

export function KitConfirmHost() {
  const request = useSyncExternalStore(fn => { confirmListeners.add(fn); return () => { confirmListeners.delete(fn) } }, () => pending, () => null)
  const [text, setText] = useState('')
  useEffect(() => { if (request?.kind === 'prompt') setText(request.defaultValue ?? '') }, [request])
  // The kit's plates and frames (the rail, the main menu, Mindcraft, these dialogs) are loaded at page start and kept for
  // the session (image-pool.ts): a CSS picture is otherwise asked for only when first drawn, and can be dropped and asked
  // for again later, which on a slow server shows bare buttons for seconds.
  useEffect(() => { keepImages(KIT_PICTURES) }, [])
  const finish = useCallback((yes: boolean, value?: string) => {
    const current = pending
    pending = null
    confirmListeners.forEach(fn => fn())
    if (!current) return
    if (!yes) { dismiss(current); return }
    if (current.kind === 'confirm') current.resolve(true)
    else if (current.kind === 'alert') current.resolve()
    else current.resolve(value ?? '')
  }, [])
  return (
    <KitDialog
      open={!!request}
      title={request?.title}
      danger={request?.kind !== 'prompt' ? request?.danger : false}
      onClose={() => finish(false)}
      actions={request && (request.kind === 'alert' ? (
        <KitButton variant={request.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{request.ok ?? 'OK'}</KitButton>
      ) : (
        <>
          <KitButton onClick={() => finish(false)}>{request.cancel ?? 'Cancel'}</KitButton>
          <KitButton variant={request.kind === 'confirm' && request.danger ? 'danger' : 'primary'} onClick={() => finish(true, text)}>{request.confirm ?? 'OK'}</KitButton>
        </>
      ))}
    >
      {request?.body}
      {request?.kind === 'prompt' && (
        <div className={request.body ? 'mt-2' : undefined}>
          <KitTextField
            label={request.label ?? ''}
            value={text}
            placeholder={request.placeholder}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(true, text) } }}
            data-kit-autofocus=""
          />
        </div>
      )}
    </KitDialog>
  )
}

// ── the shared look controls ───────────────────────────────────────────────────────────────────

export function KitLookControls({ showStyle = true }: { showStyle?: boolean }) {
  const look = useMenuLook()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  }, [open])
  const label = 'mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] opacity-60'
  return (
    <div className="ml-auto flex shrink-0 items-end gap-3 max-[700px]:hidden" data-kit-look-controls data-settings-look-controls>
      {showStyle && (
        <label className="flex flex-col" data-settings-look="style">
          <span className={label}>Menus</span>
          <select value={look.style} onChange={event => setMenuLook({ style: event.target.value as MenuStyleId })} className="h-[20px] rounded border border-white/25 bg-black/50 px-1 text-[11px] text-white" title="One style for every menu">
            {MENU_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col" data-settings-look="cursor">
        <span className={label}>Cursor</span>
        <select value={look.cursor} onChange={event => setMenuLook({ cursor: event.target.value as CursorSetId })} className="h-[20px] rounded border border-white/25 bg-black/50 px-1 text-[11px] text-white" title="The mouse cursors (all of them side by side in Experiments)">
          {CURSOR_SETS.map(set => <option key={set.id} value={set.id}>{set.label}</option>)}
        </select>
      </label>
      {look.style === 'glass' && (
        <>
          <label className="flex flex-col gap-0.5" data-settings-look="blur">
            <span className={`${label} flex justify-between`}><span>Blur</span><span className="tabular-nums">{look.blur}</span></span>
            <input type="range" min={0} max={MENU_BLUR_MAX} step={1} value={look.blur} onChange={event => setMenuLook({ blur: Number(event.target.value) })} className="h-3 w-[100px] cursor-pointer accent-violet-300" aria-label="Blur" />
          </label>
          <label className="flex flex-col gap-0.5" data-settings-look="transparency">
            <span className={`${label} flex justify-between`}><span>See-through</span><span className="tabular-nums">{look.transparency}%</span></span>
            <input type="range" min={0} max={100} step={1} value={look.transparency} onChange={event => setMenuLook({ transparency: Number(event.target.value) })} className="h-3 w-[100px] cursor-pointer accent-violet-300" aria-label="See-through" />
          </label>
          <div ref={boxRef} className="relative">
            <div className={label}>Colour</div>
            <button type="button" data-settings-look="color" title="The menus' colour" onClick={() => setOpen(value => !value)} className="block h-[18px] w-[34px] rounded border border-white/35" style={{ background: look.color }} />
            {open && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-[176px] rounded-md border border-white/15 bg-[#14161a] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.6)]" data-settings-look-palette>
                <div className="grid grid-cols-5 gap-1.5">
                  {MENU_SWATCHES.map(color => (
                    <button key={color} type="button" title={color} onClick={() => setMenuLook({ color })} className={`h-6 w-6 rounded border ${look.color === color ? 'border-white ring-1 ring-white/70' : 'border-white/20 hover:border-white/60'}`} style={{ background: color }} />
                  ))}
                </div>
                <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/60">
                  Any colour
                  <input type="color" value={look.color} onChange={event => setMenuLook({ color: event.target.value })} className="h-6 w-10 cursor-pointer rounded border border-white/20 bg-transparent p-0" />
                </label>
                <button type="button" onClick={() => { setMenuLook({ blur: DEFAULT_MENU_LOOK.blur, transparency: DEFAULT_MENU_LOOK.transparency, color: DEFAULT_MENU_LOOK.color }); setOpen(false) }} className="mt-2 w-full rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10">
                  Back to the defaults
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
