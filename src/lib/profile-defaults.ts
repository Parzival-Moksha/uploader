export const DEFAULT_PROFILE_DISPLAY_NAME = 'Player 1'

// A hosted visitor's first body is the small CC0 Cool Alien (1.75 MB; the local default is 5.4 MB). The server reads
// OASIS_MODE; the browser NEXT_PUBLIC_OASIS_MODE, set from it at build time (next.config.mjs).
const HOSTED = process.env.OASIS_MODE === 'hosted' || process.env.NEXT_PUBLIC_OASIS_MODE === 'hosted'
export const HOSTED_PROFILE_AVATAR_3D_URL = '/avatars/gallery/CoolAlien.vrm'
export const DEFAULT_PROFILE_AVATAR_3D_URL = HOSTED ? HOSTED_PROFILE_AVATAR_3D_URL : '/avatars/gallery/UnicornPerson.vrm'

// A hosted visitor's first body is dealt in turn from small bodies the package ships (each under 1.9 MB, so the
// first load stays small), so a room of strangers is not a room of identical aliens (the owner, 27 Nov). They can
// change it in the Character menu. Locally every new profile keeps the default.
export const HOSTED_STARTER_BODIES = [
  '/avatars/gallery/CoolAlien.vrm',
  '/avatars/gallery/UnicornPerson.vrm',
  '/avatars/gallery/Hacker.vrm',
  '/avatars/gallery/EYEWizard.vrm',
  '/avatars/gallery/Witch.vrm',
  '/avatars/gallery/CoolCow.vrm',
  '/avatars/gallery/CuteMoth.vrm',
  '/avatars/gallery/CoolGuitar.vrm',
  '/avatars/gallery/Mushy.vrm',
  '/avatars/gallery/HodlerKing.vrm',
] as const

/**
 * The body a new profile starts with. On the hosted Oasis the bodies are dealt in turn (the owner, 28 Nov: "the next
 * guy is going to spawn with a different avatar, otherwise you don't know who you are"): pass how many profiles
 * exist already. Locally it is the default.
 */
export function starterAvatar3dUrl(profilesSoFar = 0): string {
  if (!HOSTED) return DEFAULT_PROFILE_AVATAR_3D_URL
  const n = HOSTED_STARTER_BODIES.length
  const i = ((Math.floor(Number(profilesSoFar) || 0) % n) + n) % n
  return HOSTED_STARTER_BODIES[i]
}
