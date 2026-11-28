'use client'
// ░▒▓ TEXT TO 3D LEVEL 2 and PIC TO 3D — Meshy or Tripo models in their own spell windows ▓▒░
// The owner, 27 Nov: "Text to 3D" (crafting from shapes) is level 1; Level 2 makes a real model from words, Pic to 3D
// from a picture; Text to Character is the Character choice inside them. The spell id meshy-object is kept for
// Level 2 so learned spells carry over; pic-to-3d is new.

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { ConjureSpellBody, type ConjureSource } from './bodies/ConjureSpellBody'

const SPELLS: Record<'meshy-object' | 'pic-to-3d', { title: string; source: ConjureSource; accent: string }> = {
  'meshy-object': { title: 'Text to 3D Level 2', source: 'text', accent: '#F97316' },
  'pic-to-3d': { title: 'Pic to 3D', source: 'image', accent: '#F472B6' },
}

export function ConjureSpellTab({ spellId }: { spellId: 'meshy-object' | 'pic-to-3d' }) {
  const spell = SPELLS[spellId]
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      setIsOpen(detail.spellId === spellId)
    }
    const onClose = () => setIsOpen(false)
    window.addEventListener('oasis:open-spelltab', onOpen as EventListener)
    window.addEventListener('oasis:close-spelltabs', onClose as EventListener)
    return () => {
      window.removeEventListener('oasis:open-spelltab', onOpen as EventListener)
      window.removeEventListener('oasis:close-spelltabs', onClose as EventListener)
    }
  }, [spellId])

  return (
    <SpellTabFrame isOpen={isOpen} title={spell.title} spellId={spellId} accentColor={spell.accent} onClose={() => setIsOpen(false)}>
      {isOpen && <ConjureSpellBody source={spell.source} />}
    </SpellTabFrame>
  )
}
