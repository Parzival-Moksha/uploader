// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GENERATE PIC SPELL TAB — the Text to Pic popup (spell `text-to-pic`), mounted once in Scene.tsx.
// Text to Pic Building left on 27 Nov (the owner: "it is the same as Text to Pic, gets a remove"); a picture still
// goes up as a 4-sided block from the gallery's 3D button.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { GeneratePicBody } from './bodies/GeneratePicBody'

const SPELL_ID = 'text-to-pic'

export function GeneratePicSpellTab() {
  const accent = '#EC4899'
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      setIsOpen(detail.spellId === SPELL_ID)
    }
    const onClose = () => setIsOpen(false)
    window.addEventListener('oasis:open-spelltab', onOpen as EventListener)
    window.addEventListener('oasis:close-spelltabs', onClose as EventListener)
    return () => {
      window.removeEventListener('oasis:open-spelltab', onOpen as EventListener)
      window.removeEventListener('oasis:close-spelltabs', onClose as EventListener)
    }
  }, [])

  return (
    <SpellTabFrame
      isOpen={isOpen}
      title="Text to Pic"
      spellId={SPELL_ID}
      accentColor={accent}
      onClose={() => setIsOpen(false)}
    >
      <GeneratePicBody accentColor={accent} />
    </SpellTabFrame>
  )
}
