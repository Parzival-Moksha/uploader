'use client'
// ░▒▓ PORTAL CRAFT — the body of the Portal Craft window (Spells > Portal Craft) ▓▒░
// The owner, 27 Nov: "I go to Spells, I go to Portal Craft, I select a portal style, and then there is a question:
// where do you want the portal to go?" Two steps, nothing else: the style (each shown as the real rendered gate,
// public/portal-thumbs/<style>.webp, made by scripts/portal-thumbs/capture.mjs), then New world or Existing world.
// Every portal is two-way: the same style stands in the other world and leads back. No demo router, no
// private/public/free-for-all question: a new world is the owner's own locally and free for all on the hosted Oasis.
// Props in, one choice out (onPlace); PortalCraftSpellTab puts it in the world.

import { useEffect, useMemo, useRef, useState } from 'react'
import { KitButton, KitChip, KitPickTile, KitTextField } from '@/components/ui-kit'
import { PORTAL_GATE_VARIANT_DEFS, type PortalGateVariant } from '@/lib/portal-gates'

export type PortalDestination =
  | { kind: 'new'; name: string }
  | { kind: 'existing'; worldId: string; worldName: string }

export interface PortalCraftChoice {
  variant: PortalGateVariant
  destination: PortalDestination
}

export interface PortalCraftWorld {
  id: string
  name: string
  icon?: string
}

export interface PortalCraftBodyProps {
  /** Worlds a portal may lead to (the current one is left out here). */
  worlds: PortalCraftWorld[]
  activeWorldId: string
  activeWorldName: string
  /** The hosted Oasis: a new world is free for all; locally it is the owner's own. */
  hosted: boolean
  onPlace: (choice: PortalCraftChoice) => void
  /** Thumbnail address for a style (default /portal-thumbs/<style>.webp). */
  thumbFor?: (variant: PortalGateVariant) => string
}

export const portalThumbUrl = (variant: PortalGateVariant, base = process.env.NEXT_PUBLIC_BASE_PATH || '') => `${base}/portal-thumbs/${variant}.webp`

export function PortalCraftBody({ worlds, activeWorldId, activeWorldName, hosted, onPlace, thumbFor = v => portalThumbUrl(v) }: PortalCraftBodyProps) {
  const [variant, setVariant] = useState<PortalGateVariant | null>(null)
  const [kind, setKind] = useState<'new' | 'existing' | null>(null)
  const [newName, setNewName] = useState('')
  const [worldId, setWorldId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const stepTwo = useRef<HTMLElement>(null)
  // The style grid is tall: once a style is picked, bring the question into view.
  useEffect(() => { if (variant) stepTwo.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [variant])

  const others = useMemo(() => worlds.filter(world => world.id !== activeWorldId), [worlds, activeWorldId])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? others.filter(world => world.name.toLowerCase().includes(q)) : others
  }, [others, filter])
  const chosenWorld = others.find(world => world.id === worldId) || null
  const styleLabel = PORTAL_GATE_VARIANT_DEFS.find(def => def.id === variant)?.label
  const ready = Boolean(variant && (kind === 'new' || (kind === 'existing' && chosenWorld)))

  const place = () => {
    if (!variant || !kind) return
    if (kind === 'new') onPlace({ variant, destination: { kind: 'new', name: newName.trim() || 'New World' } })
    else if (chosenWorld) onPlace({ variant, destination: { kind: 'existing', worldId: chosenWorld.id, worldName: chosenWorld.name } })
  }

  return (
    <div className="flex flex-col gap-3" data-portal-craft>
      <section>
        <span className="kit-label">1 · The portal</span>
        <div className="grid grid-cols-2 gap-2">
          {PORTAL_GATE_VARIANT_DEFS.map(def => (
            <KitPickTile
              key={def.id}
              picture={thumbFor(def.id)}
              label={def.label}
              accent={def.accent}
              selected={variant === def.id}
              onClick={() => setVariant(def.id)}
              title={def.desc}
            />
          ))}
        </div>
      </section>

      {variant && (
        <section ref={stepTwo}>
          <span className="kit-label">2 · Where does it lead?</span>
          <div className="flex gap-2">
            <KitChip pressed={kind === 'new'} onClick={() => setKind('new')}>New world</KitChip>
            <KitChip pressed={kind === 'existing'} onClick={() => setKind('existing')}>Existing world</KitChip>
          </div>
          {kind === 'new' && (
            <div className="mt-2">
              <KitTextField
                label="Its name"
                placeholder="New World"
                value={newName}
                maxLength={60}
                onChange={event => setNewName((event.target as HTMLInputElement).value)}
                hint={hosted ? 'A new world, open to everyone (free for all).' : 'A new world of your own.'}
              />
            </div>
          )}
          {kind === 'existing' && (
            <div className="mt-2 flex flex-col gap-1.5">
              {others.length > 8 && (
                <KitTextField placeholder="Find a world…" value={filter} onChange={event => setFilter((event.target as HTMLInputElement).value)} />
              )}
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1" role="listbox" aria-label="Worlds">
                {shown.map(world => (
                  <KitChip key={world.id} role="option" aria-selected={world.id === worldId} pressed={world.id === worldId} onClick={() => setWorldId(world.id)} className="!justify-start !whitespace-normal text-left">
                    <span aria-hidden>{world.icon || '🌐'}</span> {world.name}
                  </KitChip>
                ))}
                {shown.length === 0 && <span className="kit-hint">{others.length ? 'No world by that name.' : 'There is no other world yet: make a new one.'}</span>}
              </div>
            </div>
          )}
        </section>
      )}

      {ready && (
        <span className="kit-hint">
          Two-way: a {styleLabel} also stands in {kind === 'new' ? (newName.trim() || 'the new world') : chosenWorld?.name} and leads back to {activeWorldName}.
        </span>
      )}
      <KitButton variant="primary" disabled={!ready} onClick={place}>
        {ready ? 'Place the portal' : variant ? 'Choose where it leads' : 'Choose a portal'}
      </KitButton>
    </div>
  )
}
