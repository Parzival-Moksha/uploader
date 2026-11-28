// Background music: the tracks this Oasis plays (none in the package for now) and how loud they play.
// Settings > Sound > Music (settings.musicVolume) and Master (settings.masterVolume) set the level; the player is
// src/components/BackgroundMusic.tsx. Licences and sources: public/audio/music/manifest.json (CC0 1.0).

import { packagedView } from './only-what-ships'

export interface MusicTrack {
  url: string
  title: string
  artist: string
}

/** The tracks in this repository (CC0), played in turn, each to its end, then the next. */
export const OWN_TRACKS: readonly MusicTrack[] = [
  { url: '/audio/music/komiku-village-2018.mp3', title: 'Village, 2018', artist: 'Komiku' },
  { url: '/audio/music/komiku-sweet-night-and-friends.mp3', title: 'Sweet night and friends', artist: 'Komiku' },
]

/**
 * What this Oasis plays. The package (NEXT_PUBLIC_OASIS_EDITION=slim) ships no music for now: the owner found these
 * two tracks lame (24 Nov), so the cut leaves public/audio/music/ out and better ones are picked after the release.
 * With no tracks the Music switch is hidden and the player does nothing.
 */
export function musicTracks(edition: string | undefined = process.env.NEXT_PUBLIC_OASIS_EDITION): readonly MusicTrack[] {
  return edition === 'slim' ? [] : OWN_TRACKS
}

// In the owner's Oasis with "only what ships" on, the same as the package (src/lib/only-what-ships.ts).
export const MUSIC_TRACKS: readonly MusicTrack[] = musicTracks(packagedView() ? 'slim' : process.env.NEXT_PUBLIC_OASIS_EDITION)

export const hasMusic = (): boolean => MUSIC_TRACKS.length > 0

/** Music sits under the voices and the spells: at the default sliders (music 0.6, master 0.8) it plays at about 0.2. */
export const MUSIC_BASE = 0.45

const unit = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

/** The gain the music plays at, 0..1. Zero when either slider is at zero (the player then stops). */
export function musicLevel(music: number, master: number): number {
  return unit(music) * unit(master) * MUSIC_BASE
}

export function nextTrackIndex(index: number, count: number = MUSIC_TRACKS.length): number {
  return count > 0 ? (index + 1) % count : 0
}

/** One line for Settings: what plays, by whom, under which licence. */
export function musicCreditLine(tracks: readonly MusicTrack[] = MUSIC_TRACKS): string {
  const artists = Array.from(new Set(tracks.map(t => t.artist)))
  return `${tracks.map(t => `"${t.title}"`).join(' and ')} by ${artists.join(', ')} (CC0)`
}
