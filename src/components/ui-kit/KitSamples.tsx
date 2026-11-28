'use client'

// Settings > Experiments > Menu styles: every kit part in each style, side by side, for the owner to judge
// (2026-11-19, 7:25: "three big buttons… the picture and the icon and the colours rhyme"). "Use this" sets the
// one style of every menu.

import { useEffect, useRef, useState } from 'react'
import { CURSOR_KINDS, CURSOR_SETS, cursorUrl, type CursorKind, type CursorSetId } from '@/lib/ui-kit/cursors'
import { TRIES, setTry, useTries } from '@/lib/ui-kit/tries'
import { MENU_STYLES, TOGGLE_LOOKS, setMenuLook, useMenuLook, type MenuStyleId, type ToggleLookId } from '@/lib/ui-kit/menu-look'
import { KitButton, KitCard, KitPanel, KitToggleOverride, KitPickTile, KitProgress, KitSlider, KitStyleOverride, KitTabs, KitTextField, KitTileButton, KitToggle, kitConfirm } from './index'

const TILES = [
  { picture: '/ui/spellbook/tiles/sky-background.gpt2.webp', icon: '☀', label: 'Background', sub: 'Skies and light', accent: '#ffb35c' },
  { picture: '/ui/spellbook/tiles/text-to-3d.gpt2.webp', icon: '✦', label: 'Create', sub: 'Make anything', accent: '#b48cff' },
  { picture: '/ui/spellbook/tiles/portal-create.gpt2.webp', icon: '◎', label: 'Portal', sub: 'Go somewhere', accent: '#6fe3ff' },
]

function Sample({ style }: { style: MenuStyleId }) {
  const [on, setOn] = useState(true)
  const [pick, setPick] = useState(0)
  const [skyPick, setSkyPick] = useState(1)
  const [level, setLevel] = useState(60)
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one')
  const look = useMenuLook()
  const meta = MENU_STYLES.find(s => s.id === style)!
  return (
    <KitStyleOverride.Provider value={style}>
      <KitPanel title={meta.label} data-kit-sample={style} style={{ minHeight: 0 }}>
        <div className="mb-2 text-[12px] opacity-70">{meta.blurb}</div>
        <div className="grid grid-cols-3 gap-2">
          {TILES.map((tile, i) => <KitTileButton key={tile.label} {...tile} selected={i === pick} onClick={() => setPick(i)} />)}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {['sky-background', 'ground-texture', 'catalog-place', 'brush-wand'].map((id, i) => (
            <KitPickTile key={id} picture={`/ui/spellbook/tiles/${id}.gpt2.webp`} label={id.replace(/-/g, ' ')} selected={i === skyPick} onClick={() => setSkyPick(i)} />
          ))}
        </div>
        <div className="mt-3"><KitTabs tabs={[{ id: 'one', label: 'This world' }, { id: 'two', label: 'My worlds' }, { id: 'three', label: 'Public' }]} active={tab} onChange={setTab} /></div>
        <div className="mt-2 grid grid-cols-2 gap-x-4">
          <KitToggle checked={on} onChange={setOn} label="Name tags" hint="Above every agent" />
          <KitSlider label="Volume" value={level} min={0} max={100} onChange={setLevel} format={v => `${v}%`} />
        </div>
        <div className="mt-2"><KitTextField label="Name" placeholder="Call it something" /></div>
        <KitCard title="Level 7" className="mt-2"><KitProgress label="XP to level 8" value={340} max={500} format={(v, m) => `${v} / ${m}`} accent="#ffd66b" /></KitCard>
        <div className="mt-3 flex flex-wrap gap-2">
          <KitButton variant="primary" onClick={() => setMenuLook({ style })}>{look.style === style ? 'In use' : 'Use this'}</KitButton>
          <KitButton>Cancel</KitButton>
          <KitButton variant="danger" onClick={() => {
            // The dialog wears the style in use; switch first to see it in this one.
            void kitConfirm({ title: 'Dismiss Jerry?', body: 'Jerry leaves the village. His conversation stays in your sessions and can be continued.', confirm: 'Dismiss', danger: true })
          }}>Try the dialog</KitButton>
        </div>
      </KitPanel>
    </KitStyleOverride.Provider>
  )
}

function ToggleSample({ design }: { design: ToggleLookId }) {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const look = useMenuLook()
  const meta = TOGGLE_LOOKS.find(t => t.id === design)!
  return (
    <KitToggleOverride.Provider value={design}>
      <div data-toggle-sample={design}>
        <KitCard title={`${meta.label}${look.toggle === design ? ' · in use' : ''}`}>
          <div className="mb-2 text-[12px] opacity-70">{meta.blurb}</div>
          <KitToggle checked={a} onChange={setA} label="Name tags" hint={a ? 'on' : 'off'} />
          <KitToggle checked={b} onChange={setB} label="Shadows" hint={b ? 'on' : 'off'} />
          <div className="mt-2"><KitButton variant={look.toggle === design ? 'plain' : 'primary'} onClick={() => setMenuLook({ toggle: design })}>{look.toggle === design ? 'In use' : 'Use this everywhere'}</KitButton></div>
        </KitCard>
      </div>
    </KitToggleOverride.Provider>
  )
}

const CURSOR_NAMES: Record<CursorKind, string> = {
  arrow: 'Arrow', hand: 'Click', text: 'Typing', grab: 'Grab', grabbing: 'Holding', move: 'Move',
  'resize-h': 'Resize', 'resize-v': 'Resize', 'resize-d': 'Resize', 'resize-d2': 'Resize', busy: 'Busy', no: 'Not allowed',
}

/** One cursor to try: hovering the square wears it (an inline important cursor, above the set in use). */
function CursorTry({ set, kind }: { set: Exclude<CursorSetId, 'system'>; kind: CursorKind }) {
  const ref = useRef<HTMLDivElement>(null)
  const { hot: [x, y], fallback } = CURSOR_KINDS[kind]
  useEffect(() => {
    ref.current?.style.setProperty('cursor', `image-set(url(${cursorUrl(set, kind)}) 1x, url(${cursorUrl(set, kind, true)}) 2x) ${x} ${y}, ${fallback}`, 'important')
  }, [set, kind, x, y, fallback])
  return (
    <div ref={ref} title={`${CURSOR_NAMES[kind]}: hover to try`} className="flex flex-col items-center gap-0.5 rounded border border-white/10 bg-black/25 p-1 hover:border-white/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cursorUrl(set, kind, true)} alt="" width={32} height={32} draggable={false} className="pointer-events-none" />
      <span className="pointer-events-none text-[9px] opacity-60">{CURSOR_NAMES[kind]}</span>
    </div>
  )
}

/** Hipster's tries: one switch each, flip it and look; keep or kill (src/lib/ui-kit/tries.ts). */
export function HipsterTries() {
  const on = useTries()
  return (
    <section data-experiment="hipster-tries">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Hipster&apos;s tries</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">Small changes to how the Oasis looks, moves and sounds. Flip one, look at the world and the menus, then tell Hipster: keep or kill.</p>
      <KitPanel className="mt-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6">
          {TRIES.map(t => (
            <KitToggle
              key={t.id}
              checked={on.includes(t.id)}
              onChange={next => setTry(t.id, next)}
              label={<><span className="kit-label !mb-0 mr-2 inline-block">{t.axis}</span>{t.label}</>}
              hint={t.line}
              data-try={t.id}
            />
          ))}
        </div>
      </KitPanel>
    </section>
  )
}

export function KitCursorSamples() {
  const look = useMenuLook()
  return (
    <section data-experiment="cursors">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Cursors</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">The mouse in every part of the Oasis. Hover a square to try that cursor; &quot;Use this&quot; wears the set everywhere. Also at the top right of Settings.</p>
      <KitPanel className="mt-3">
        <div className="flex flex-col gap-3">
          {CURSOR_SETS.map(set => (
            <div key={set.id} data-cursor-sample={set.id} className="flex items-center gap-3">
              <div className="w-[150px] shrink-0">
                <div className="text-[13px] font-semibold">{set.label}{look.cursor === set.id ? ' · in use' : ''}</div>
                <div className="text-[10px] leading-snug opacity-60">{set.blurb}</div>
              </div>
              <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
                {set.id !== 'system' && (Object.keys(CURSOR_KINDS) as CursorKind[]).map(kind => <CursorTry key={kind} set={set.id as Exclude<CursorSetId, 'system'>} kind={kind} />)}
              </div>
              <KitButton variant={look.cursor === set.id ? 'plain' : 'primary'} onClick={() => setMenuLook({ cursor: set.id })}>{look.cursor === set.id ? 'In use' : 'Use this'}</KitButton>
            </div>
          ))}
        </div>
      </KitPanel>
    </section>
  )
}

export function KitToggleSamples() {
  return (
    <section data-experiment="switches">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Switches</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">Every on/off switch in the Oasis wears one of these. Click them to feel them; &quot;Use this everywhere&quot; picks one.</p>
      <KitPanel className="mt-3"><div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{TOGGLE_LOOKS.map(t => <ToggleSample key={t.id} design={t.id} />)}</div></KitPanel>
    </section>
  )
}

export function KitSamples() {
  return (
    <>
    <HipsterTries />
    <div className="mt-6" />
    <KitCursorSamples />
    <div className="mt-6" />
    <KitToggleSamples />
    <section data-experiment="menu-styles" className="mt-6">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Menu styles</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        One style for every menu built with the Oasis kit (Settings, World, Summon, the dialogs, more as they move over).
        Glass follows the see-through, blur and colour at the top right. &quot;Use this&quot; switches every menu at once.
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-4">
        {MENU_STYLES.map(style => <Sample key={style.id} style={style.id} />)}
      </div>
    </section>
    </>
  )
}
