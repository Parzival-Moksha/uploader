'use client'

// ░▒▓ SUMMON AVATAR PICKER — the body a new agent wears, picked in the summon menu ▓▒░
// The owner (2026-11-22): "maybe even the avatar. Actually, an avatar selector would be nice." The gallery's avatars
// as a row of thumbnails (the kit's pick tiles), one picked at random to start; the agent wears it from its first
// moment (summon-arrival.ts → village memory, the same as Settings > Avatar later).

import { useState } from 'react'
import { KitPickTile } from '@/components/ui-kit'
import { AGENT_AVATAR_CATALOG } from '@/lib/agent-avatar-catalog'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export interface SummonAvatar { path: string; name: string; thumb: string }

/** The gallery's avatars with a thumbnail. */
export const SUMMON_AVATARS: SummonAvatar[] = AGENT_AVATAR_CATALOG
  .filter(entry => /\/avatars\/gallery\/.+\.vrm$/i.test(entry.path))
  .map(entry => ({ path: entry.path, name: entry.name, thumb: `${BASE}/avatars/gallery/thumbs/${entry.id.replace(/^av_/, '')}.jpg` }))

export function randomSummonAvatar(): string {
  return SUMMON_AVATARS.length ? SUMMON_AVATARS[Math.floor(Math.random() * SUMMON_AVATARS.length)].path : ''
}

export function SummonAvatarPicker({ value, onChange, accent }: { value: string; onChange: (path: string) => void; accent?: string }) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  if (!SUMMON_AVATARS.length) return null
  const shown = SUMMON_AVATARS.filter(avatar => !broken.has(avatar.path))
  const picked = SUMMON_AVATARS.find(avatar => avatar.path === value)
  return (
    <div data-summon-avatar>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="kit-label">Avatar{picked ? ` · ${picked.name}` : ''}</span>
        <button type="button" className="text-[11px] opacity-60 underline decoration-dotted underline-offset-2 hover:opacity-100" onClick={() => onChange(randomSummonAvatar())} title="Another one at random">
          shuffle
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {shown.map(avatar => (
          <KitPickTile
            key={avatar.path}
            picture={avatar.thumb}
            selected={avatar.path === value}
            accent={accent}
            title={avatar.name}
            aria-label={avatar.name}
            onClick={() => onChange(avatar.path)}
            // Square thumbnails: the picture is square and the tile takes its height (the kit's 16:10 picture in a
            // forced 64 px square showed only the top of each avatar, the owner 2026-11-24).
            className="!w-[72px] shrink-0 [&_.kit-pick-pic]:!aspect-square"
          />
        ))}
      </div>
      {/* Thumbnails that do not exist in this copy are left out. */}
      <div className="hidden">
        {SUMMON_AVATARS.map(avatar => <img key={avatar.path} src={avatar.thumb} alt="" onError={() => setBroken(prev => new Set(prev).add(avatar.path))} />)}
      </div>
    </div>
  )
}
