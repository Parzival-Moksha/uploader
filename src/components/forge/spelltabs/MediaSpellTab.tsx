'use client'
// ░▒▓ MEDIA SPELLS — Spells > Media: MP3, MP4, JPEG ▓▒░
// One window per kind (the owner, 27 Nov: the Own spells become Media; an upload button and the library under it).
// The spell ids stay own-*-upload so a player's learned spells and achievements carry over.

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { MEDIA_KIND_INFO, MediaLibraryBody, type MediaKind } from './bodies/MediaLibraryBody'

export const MEDIA_SPELL_KIND: Record<string, MediaKind> = {
  'own-audio-upload': 'audio',
  'own-video-upload': 'video',
  'own-image-upload': 'image',
}

export function MediaSpellTab({ spellId }: { spellId: 'own-audio-upload' | 'own-video-upload' | 'own-image-upload' }) {
  const kind = MEDIA_SPELL_KIND[spellId]
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
    <SpellTabFrame isOpen={isOpen} title={MEDIA_KIND_INFO[kind].title} spellId={spellId} accentColor="#F472B6" onClose={() => setIsOpen(false)}>
      {isOpen && <MediaLibraryBody kind={kind} />}
    </SpellTabFrame>
  )
}
