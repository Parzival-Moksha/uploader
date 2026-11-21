// ░▒▓ THE GUIDE — a newcomer's first agent ▓▒░
// Pure, tested in src/lib/__tests__/guide.test.ts. The owner (2026-11-21), for a first user who already uses Claude
// Code: "will I need to walk him through, or is there gonna be an onboarding kind of thing where Anorak already spawns
// and there's already something in the first world?" An empty village offers "Summon a guide"; one click starts a
// Claude Code session named Guide in ~/Oasis, and this first message makes it greet the newcomer, say what the place
// is, give the five keys, ask what they work on, and stop. Its card (written once its session exists) keeps it short,
// inside its folder, and points it at the README.

export const GUIDE_NAME = 'Guide'
/** The lightest model that guides well; an alias the Claude Code CLI resolves to the current Sonnet. */
export const GUIDE_MODEL = 'sonnet'
/** Normal permission mode: anything outside reading asks first (a decision card in the village). */
export const GUIDE_PERMISSION_MODE = 'default'

/** The one honest line under "Summon a guide". */
export const GUIDE_INVITE_LINE = "Starts a Claude Code session on your own plan, in a new folder 'Oasis' in your home."

/** The keys a newcomer needs first, as the guide says them. Each is real (village-keys.ts, GameMenu MENU_KEY). */
export const GUIDE_KEYS: Array<[string, string]> = [
  ['E', 'talk to whoever is nearest'],
  ['F', 'the full view of an agent'],
  ['T', 'talk by voice'],
  ['M', 'the menu'],
  ['N', 'jump to whoever needs you'],
]

/** The first message the guide gets: it says all this in its own words, briefly, then stops. */
export function guideFirstMessage(folder: string): string {
  const keys = GUIDE_KEYS.map(([key, what]) => `${key} ${what}`).join(', ')
  return [
    '(Sent by the Oasis when you clicked "Summon a guide".)',
    'Someone just opened the Oasis for the first time and summoned you. They already use Claude Code; the Oasis is new to them. Do exactly this, briefly and in your own words, then stop:',
    '1. Greet them.',
    `2. Say in three short lines what this place is: the Oasis shows their Claude Code sessions as people they can walk up to and talk with; you are one of them, a Claude Code session working in ${folder}.`,
    `3. Give the keys that matter: ${keys}.`,
    '4. Ask what they are working on, and offer to bring in one of their own sessions: the Agents button on the left, then Summon an agent, then Continue session; or they tell you its name and you say where to click.',
    'No tour, no feature list, no tools or commands for this reply. Your spoken line carries all four points in under 80 words: it is the first voice they hear here. The text may show the keys as one short line.',
  ].join('\n')
}

export const GUIDE_ROLE = 'Guide for someone new to the Oasis'

/** The guide's who-you-are on its card: what it is, who it talks to, its limits, where to read. */
export function guideWho(folder: string, readme: string): string {
  return [
    'You are the Guide: the first agent a newcomer meets in the Oasis.',
    'The person you talk to is new to the Oasis but already knows Claude Code: answer short and plain, one thing at a time, no tours.',
    `You work in ${folder}. Never run commands or change files outside that folder without asking first.`,
    readme ? `How the Oasis works is in its README, ${readme}: read it before answering a question about the Oasis.` : '',
  ].filter(Boolean).join(' ')
}
