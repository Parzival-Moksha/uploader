'use client'

// ░▒▓ CHARACTER MENU — the player's menu: Character, Skills, Keys ▓▒░
// The owner, 2026-11-19: "it's not a profile, man, it's not a social scroller. This is the most badass
// metaverse... a cool looking player menu." Like Diablo's character screen and skill tree, in one menu:
//   · Character: who you are here (name, avatar, level and XP, where the XP comes from), your vitals, your
//     accounts (the logins the keychain found, what Claude Code has used), your agents in training.
//   · Skills: the skill map (academy-map-engine.ts on its own canvas), drag and zoom.
//   · Keys: the keychain. "Needs a key" anywhere opens it here, at that key.
// Opened from the main menu's Character tile, K (Skills), the HUD's Skills button, any "needs a key".
//
// The look is Hipster's UI kit (src/components/ui-kit: KitPanel, KitTabs, KitCard, KitProgress, KitButton), so the
// one menu style in Settings (Glass, Forged, Parchment, Rune) restyles it with no code here; this file adds layout
// and text emphasis only. Closed, it is one key listener.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { isVillageProfileClient } from '../../lib/oasis-profile'
import { CHARACTER_TABS, characterKeyAction, levelProgressNumbers, type CharacterTab } from '../../lib/village/character-menu'
import { KitButton, KitCard, KitPanel, KitProgress, KitTabs, KitTextField } from '../ui-kit'
import {
  CHARACTER_MENU_LAYER,
  clearCharacterFocus,
  closeCharacter,
  getCharacterState,
  openCharacter,
  setCharacterTab,
  useCharacterState,
} from './character-store'
import {
  closeAcademyReader,
  getAcademyState,
  readerContent,
  readerTrainee,
  setAcademyMapShown,
  startAcademyRefresh,
  subscribeAcademy,
  useAcademyEnabled,
} from './academy-store'
import { getKeychainState, refreshKeychainIfOlder, setKeychainShown, subscribeKeychain } from './keychain-store'
import { SkillMapBoard } from './VillageAcademyMap'
import { KeychainPanel } from './VillageAcademyKeychain'
import { AcademySheet } from './VillageAcademyReader'
import { isTypingTarget } from './village-actions'
import { AvatarGallery } from '../forge/AvatarGallery'
import { ClaudeTokenScore } from '../forge/ClaudeTokenScore'
import { shownAccounts, windowText } from '../../lib/village/village-accounts'
import { DEFAULT_PROFILE_AVATAR_3D_URL } from '../../lib/profile-defaults'
import { topmostLayer, useLayer } from '@/lib/ui-kit/layers'
import { useRailMenuExclusion } from '@/hooks/useRailMenuExclusion'
import { invalidateCachedJson, persistCachedJson, useCachedJson } from '@/lib/cached-json'
import { withProfileAvatarBust } from '@/lib/profile-avatar-url'
import { DEFAULT_PLAYER_SKILLS, PLAYER_SKILL_CAP, PLAYER_SKILL_DEFS, summarizeSkill, type PlayerSkillKey, type PlayerSkillSet } from '@/lib/player-progression'
import { renderBodyPortrait } from './body-portrait'
import { BodyShowcase } from './BodyShowcase'

const PROFILE_URL = '/api/profile'
persistCachedJson(PROFILE_URL)

interface Profile {
  xp: number
  level: number
  levelTitle: string
  levelBadge: string
  levelProgress: number
  xpToNext: number
  displayName: string
  bio?: string | null
  avatar_url: string | null
  avatar_3d_url: string | null
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
  unspentSkillPoints?: number
  skills?: PlayerSkillSet
  xpSources?: { oldBalance?: number; mindcraft?: number; foldedAt?: number; since?: string }
}

const number = (value: number) => Math.round(value).toLocaleString('en-US')

/** Text styles inside kit cards: layout and emphasis only (sizes, weight, opacity), so every kit style colours them. */
const TEXT = {
  label: 'kit-label',
  title: 'font-black tracking-wide',
  strong: 'font-bold',
  note: 'text-[13px] opacity-70',
  link: 'kit-label cursor-pointer underline-offset-2 hover:underline',
}

// ─── who you are: picture, name, bio (moved in from the old Profile panel, 26 Nov) ───────────────────

/** Tell the rest of the page (the multiplayer presence, the HUD) that the profile changed. */
function profileChanged() {
  void invalidateCachedJson(PROFILE_URL)
  window.dispatchEvent(new CustomEvent('oasis:profile-updated'))
}

async function uploadPicture(picture: Blob, filename: string): Promise<void> {
  const form = new FormData()
  form.append('avatar', picture, filename)
  const response = await fetch('/api/profile/avatar', { method: 'POST', body: form })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `The picture was not saved (HTTP ${response.status})`)
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function WhoYouAre({ profile, onPickAvatar }: { profile: Profile; onPickAvatar: () => void }) {
  // The picture's address never changes (one file per player), so a new one needs a new ?v= to show.
  const [version, setVersion] = useState(() => Date.now())
  const [busy, setBusy] = useState<null | 'file' | 'body' | 'save'>(null)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const worn = useOasisStore(s => s.avatar3dUrl)
  const body = worn || profile.avatar_3d_url || DEFAULT_PROFILE_AVATAR_3D_URL
  const picture = withProfileAvatarBust(profile.avatar_url, version)

  const done = () => { setVersion(Date.now()); setChoosing(false); profileChanged() }
  const fromFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('That file is not a picture (JPEG, PNG, WebP or GIF).'); return }
    if (file.size > 6 * 1024 * 1024) { setError(`The picture is ${(file.size / 1024 / 1024).toFixed(1)} MB; at most 6 MB.`); return }
    setBusy('file'); setError(null)
    try { await uploadPicture(file, file.name); done() } catch (err) { setError(errorText(err)) } finally { setBusy(null) }
  }
  const fromBody = async () => {
    setBusy('body'); setError(null)
    try { await uploadPicture(await renderBodyPortrait(body), 'portrait.png'); done() } catch (err) { setError(errorText(err)) } finally { setBusy(null) }
  }
  const save = async () => {
    if (name.trim().length < 2) return
    setBusy('save'); setError(null)
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: name.trim(), bio: bio.trim() }) })
      if (!response.ok) {
        const failed = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(failed.error || `Not saved (HTTP ${response.status})`)
      }
      setEditing(false)
      profileChanged()
    } catch (err) { setError(errorText(err)) } finally { setBusy(null) }
  }

  return (
    <KitCard>
      <div className="flex flex-col items-center gap-3">
        <button type="button" title="Change your picture" data-character-picture onClick={() => setChoosing(value => !value)} className="group relative h-36 w-36 overflow-hidden rounded-full" style={{ boxShadow: '0 0 0 2px var(--kit-accent, rgba(201,162,86,0.7)), 0 0 26px rgba(245,201,106,0.3)' }}>
          {/* The first letter underneath; the picture over it, or gone if it does not load. */}
          <span className={`${TEXT.title} absolute inset-0 flex items-center justify-center text-[56px]`}>{(profile.displayName || '?').slice(0, 1).toUpperCase()}</span>
          {picture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={picture} src={picture} alt="" className="relative h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-white opacity-0 transition-opacity group-hover:opacity-100">{busy === 'file' || busy === 'body' ? 'saving…' : 'change'}</span>
        </button>
        {choosing && (
          <div className="flex flex-wrap justify-center gap-2" data-character-picture-choices>
            <KitButton onClick={() => fileRef.current?.click()} disabled={busy !== null}>{busy === 'file' ? 'Saving…' : 'From a file'}</KitButton>
            <KitButton onClick={() => void fromBody()} disabled={busy !== null} title="A head-and-shoulders picture of the body you wear">{busy === 'body' ? 'Drawing…' : 'Portrait of my body'}</KitButton>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={event => { void fromFile(event.target.files?.[0]); event.target.value = '' }} />

        {editing ? (
          <div className="flex w-full flex-col gap-2" data-character-edit>
            <KitTextField label="Name" value={name} maxLength={30} autoFocus onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save() }} />
            <KitTextField label="About you" multiline rows={2} maxLength={200} value={bio} placeholder="optional" onChange={event => setBio(event.target.value)} />
            <div className="flex gap-2">
              <KitButton variant="primary" onClick={() => void save()} disabled={busy !== null || name.trim().length < 2}>{busy === 'save' ? 'Saving…' : 'Save'}</KitButton>
              <KitButton onClick={() => setEditing(false)}>Cancel</KitButton>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className={`${TEXT.title} text-[24px] leading-tight`} data-character-name>{profile.displayName || 'Wanderer'}</div>
            {/* No level title (the owner, 26 Nov: drop them for now): Level 5 and nothing else. */}
            <div className={`${TEXT.label} mt-1`}>Level {profile.level}</div>
            {profile.bio && <div className={`${TEXT.note} mt-1`}>{profile.bio}</div>}
          </div>
        )}
        {error && <div className={`${TEXT.note} text-center`} role="alert">{error}</div>}
        <div className="flex flex-wrap justify-center gap-2">
          {!editing && <KitButton data-character-edit-name onClick={() => { setName(profile.displayName || ''); setBio(profile.bio || ''); setEditing(true) }}>Edit name and bio</KitButton>}
          <KitButton variant="primary" data-character-avatar onClick={onPickAvatar}>
            {profile.avatar_3d_url ? 'Change body' : 'Choose a body'}
          </KitButton>
        </div>
      </div>
    </KitCard>
  )
}

/** Spending skill points on the wizard's stats (moved in from the old Profile panel's Skills tab). */
function WizardStats({ profile }: { profile: Profile }) {
  const [spending, setSpending] = useState<PlayerSkillKey | null>(null)
  const skills = profile.skills ?? DEFAULT_PLAYER_SKILLS
  const unspent = profile.unspentSkillPoints ?? 0
  const spend = async (skill: PlayerSkillKey) => {
    if (spending || unspent <= 0 || (skills[skill] ?? 0) >= PLAYER_SKILL_CAP) return
    setSpending(skill)
    try {
      const response = await fetch('/api/profile/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill }) })
      if (response.ok) profileChanged()
    } finally { setSpending(null) }
  }
  return (
    <KitCard title="Stat points" data-character-stats>
      <div className={`${TEXT.note} mb-2`}>{unspent > 0 ? `${unspent} point${unspent === 1 ? '' : 's'} to spend` : 'No points to spend; a level up brings more.'}</div>
      <div className="flex flex-col gap-2">
        {PLAYER_SKILL_DEFS.map(skill => {
          const rank = skills[skill.id] ?? 0
          const canSpend = unspent > 0 && rank < PLAYER_SKILL_CAP
          return (
            <div key={skill.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={TEXT.strong}>{skill.label} <span className="opacity-60">· {rank >= PLAYER_SKILL_CAP ? 'max' : `rank ${rank}`}</span></div>
                <div className={`${TEXT.note} text-[12px]`}>{summarizeSkill(skill.id, skills)}</div>
              </div>
              <KitButton onClick={() => void spend(skill.id)} disabled={!canSpend || spending !== null} title={canSpend ? `Next: ${summarizeSkill(skill.id, { ...skills, [skill.id]: rank + 1 })}` : undefined}>{spending === skill.id ? '…' : '+1'}</KitButton>
            </div>
          )
        })}
      </div>
    </KitCard>
  )
}

// ─── the Character tab ──────────────────────────────────────────────────────

function CharacterTabView({ profile, onPickAvatar }: { profile: Profile | null; onPickAvatar: () => void }) {
  const subscriptions = shownAccounts(useOasisStore(st => st.agentEngine.connection.server?.accounts || null))
  const keys = useSyncExternalStore(subscribeKeychain, () => getKeychainState().keys, () => getKeychainState().keys)
  const trainees = useSyncExternalStore(subscribeAcademy, () => getAcademyState().trainees, () => getAcademyState().trainees)
  const academy = useAcademyEnabled()
  const worn = useOasisStore(s => s.avatar3dUrl)
  useEffect(() => { void refreshKeychainIfOlder() }, [])

  if (!profile) return <div className={`${TEXT.note} p-8 text-center`}>Reading your character…</div>
  const level = levelProgressNumbers(profile.xp, profile.levelProgress, profile.xpToNext)
  const logins = keys.filter(key => key.kind === 'subscription' && key.state === 'have')
  const held = keys.filter(key => key.state === 'have').length
  const training = trainees.filter(trainee => trainee.training)
  const sources = profile.xpSources
  const body = worn || profile.avatar_3d_url || DEFAULT_PROFILE_AVATAR_3D_URL

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-[minmax(240px,300px)_1fr]" data-character-tab="character">
      {/* Who you are */}
      <div className="flex flex-col gap-3">
        <WhoYouAre profile={profile} onPickAvatar={onPickAvatar} />
        <KitCard title="Vitals">
          <div className="flex flex-col gap-2">
          <KitProgress label="Health" value={profile.hp ?? 100} max={profile.maxHp ?? 100} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#ef4444" />
          <KitProgress label="Mana" value={profile.mana ?? 0} max={profile.maxMana ?? 20} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#60a5fa" />
          </div>
        </KitCard>
        {/* The old quests are not shown: quests are being redesigned with the Academy (the owner, 26 Nov). */}
        <WizardStats profile={profile} />
      </div>

      {/* Level, accounts, agents */}
      <div className="flex min-w-0 flex-col gap-3">
        {/* Level, compact (the owner, 26 Nov: "level stays, smaller"), so the body can turn under it. */}
        <KitCard data-character-xp>
          <div className="flex items-center gap-4">
            <div className="shrink-0 text-center">
              <div className={TEXT.label}>Level</div>
              <div className={`${TEXT.title} text-[34px] leading-none`}>{profile.level}</div>
            </div>
            <div className="min-w-0 flex-1">
              <KitProgress label={`${number(profile.xp)} XP · ${number(level.left)} to level ${profile.level + 1}`} value={level.into} max={level.span} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#ffd66b" />
              {sources && typeof sources.mindcraft === 'number' && (
                <div className={`${TEXT.note} mt-1 text-[12px]`}>
                  {number(Math.round(sources.mindcraft))} XP from your time in the Oasis{sources.since ? ` since ${new Date(`${sources.since}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}: one XP for every minute of counted work, and the bonuses of missions kept.
                </div>
              )}
            </div>
          </div>
        </KitCard>
        {/* The body you wear, turning; drag to turn it (the owner: "like in a cool game... a showcase window"). */}
        <KitCard className="!p-0 overflow-hidden">
          <BodyShowcase url={body} className="h-[420px] w-full" />
        </KitCard>

        <KitCard>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className={TEXT.label}>Accounts</div>
            {academy && <button type="button" className={TEXT.link} onClick={() => setCharacterTab('keys')}>{keys.length ? `${held} of ${keys.length} keys held` : 'keys'} →</button>}
          </div>
          {logins.length
            ? logins.map(key => (
              <div key={key.id} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className={TEXT.strong}>{key.name}</span>
                <span className={`${TEXT.note} text-right`}>{key.found[0]?.label || 'held'}</span>
              </div>
            ))
            : <div className={TEXT.note}>{keys.length ? 'No subscription login found on this machine.' : 'Looking…'}</div>}
          {/* Every Claude subscription the agents run on (the engine's accounts), each with its own week: the owner,
              26 Nov: "in accounts I'm seeing one account". */}
          {subscriptions.length > 0 && (
            <div className="mt-2 border-t border-white/10 pt-1.5" data-character-subscriptions>
              <div className={TEXT.note}>Claude subscriptions the agents run on</div>
              {subscriptions.map(account => {
                const out = Boolean(account.exhaustedUntil && account.exhaustedUntil > Date.now())
                return (
                  <div key={account.id} className="flex items-baseline justify-between gap-3 py-0.5" title={account.email || undefined}>
                    <span className={TEXT.strong}>{account.cli ? 'Command line login' : account.label}{account.plan ? ` · ${account.plan}` : ''}</span>
                    <span className={`${TEXT.note} text-right`}>{out ? `out until ${new Date(account.exhaustedUntil!).toTimeString().slice(0, 5)}` : `${windowText(account, 'five_hour')} · ${windowText(account, 'seven_day')}`}</span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-2 pt-1"><ClaudeTokenScore /></div>
        </KitCard>

        {academy && (
          <KitCard>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div className={TEXT.label}>Your agents in training</div>
              <button type="button" className={TEXT.link} onClick={() => setCharacterTab('skills')}>skill map →</button>
            </div>
            {training.length
              ? training.map(trainee => (
                <div key={trainee.key} className="flex items-baseline justify-between gap-3 py-0.5">
                  <span className={TEXT.strong}>{trainee.name}{trainee.stone ? ' (stone)' : ''}</span>
                  <span className={TEXT.note}>{trainee.level.name} · {number(trainee.xp.score)} XP</span>
                </div>
              ))
              : <div className={TEXT.note}>Nobody yet. On the Skills tab, pick one of your agents under Trainee.</div>}
          </KitCard>
        )}
      </div>
    </div>
  )
}

// ─── the menu ───────────────────────────────────────────────────────────────

function Menu() {
  const { tab, focusKey, focusNonce } = useCharacterState()
  const academy = useAcademyEnabled()
  // Kept for the page's life (src/lib/cached-json.ts): the menu opens on what is known, refreshed behind it.
  const profile = useCachedJson<Profile>(PROFILE_URL, 30_000) || null
  const [picking, setPicking] = useState(false)
  const setAvatar3dUrl = useOasisStore(s => s.setAvatar3dUrl)
  const { reader, readerMap, trainees } = useSyncExternalStore(subscribeAcademy, getAcademyState, getAcademyState)
  const sheetContent = useSyncExternalStore(subscribeAcademy, () => readerContent(), () => null)
  const sheetTrainee = useSyncExternalStore(subscribeAcademy, () => readerTrainee(), () => null)
  const sheetSkill = readerMap && reader ? sheetContent?.skills.find(skill => skill.id === reader) || null : null

  const loadProfile = useCallback(() => { void invalidateCachedJson(PROFILE_URL) }, [])

  // The Academy's data: the village polls it already; elsewhere the menu does while it is open.
  useEffect(() => (isVillageProfileClient() ? undefined : startAcademyRefresh()), [])
  // The map and the keychain run only while their tab is on screen.
  useEffect(() => {
    setAcademyMapShown(academy && tab === 'skills')
    setKeychainShown(academy && tab === 'keys')
    return () => {
      setAcademyMapShown(false)
      setKeychainShown(false)
    }
  }, [tab, academy])
  useEffect(() => { if (focusKey) clearCharacterFocus() }, [focusKey])

  const tabs = CHARACTER_TABS.filter(item => academy || item.id === 'character')
  const shownTab: CharacterTab = academy ? tab : 'character'

  return (
    <div
      // Clear of the HUD rail (Menu, World, Spells, Agents) down the left edge.
      className="fixed inset-0 flex items-center justify-center p-[3vh] md:pl-[180px]"
      style={{ zIndex: 'var(--z-place)', background: 'radial-gradient(ellipse at center, rgba(5,8,18,0.5) 0%, rgba(2,4,10,0.8) 100%)', backdropFilter: 'blur(9px) saturate(0.8)', WebkitBackdropFilter: 'blur(9px) saturate(0.8)', animation: 'characterMenuIn 220ms ease-out' }}
      onMouseDown={event => { if (event.target === event.currentTarget) closeCharacter() }}
      onContextMenu={event => event.preventDefault()}
    >
      <style>{'@keyframes characterMenuIn { from { opacity: 0; transform: scale(0.985) } to { opacity: 1; transform: none } }'}</style>
      <KitPanel
        data-ui-panel="character-menu"
        title={profile?.displayName ? `${profile.displayName} · Level ${profile.level}` : 'Character'}
        onClose={closeCharacter}
        headerExtra={<div className="min-w-[280px]" role="tablist"><KitTabs tabs={tabs.map(item => ({ id: item.id, label: item.label, title: item.hint }))} active={shownTab} onChange={setCharacterTab} /></div>}
        className="h-full max-h-[920px] w-full max-w-[1260px]"
      >
        <div className="relative h-full min-h-[60vh]">
          {shownTab === 'character' && <CharacterTabView profile={profile} onPickAvatar={() => setPicking(true)} />}
          {shownTab === 'skills' && (
            <KitCard className="relative h-[calc(100%-2px)] min-h-[60vh] overflow-hidden !p-0" data-character-tab="skills">
              <SkillMapBoard />
            </KitCard>
          )}
          {shownTab === 'keys' && (
            <div className="h-full min-h-[60vh]" data-character-tab="keys">
              <KeychainPanel focusKey={focusKey} focusNonce={focusNonce} />
            </div>
          )}
        </div>
      </KitPanel>

      {sheetSkill && sheetContent && <AcademySheet skill={sheetSkill} content={sheetContent} trainee={sheetTrainee} trainees={trainees} />}

      {picking && (
        <AvatarGallery
          currentAvatarUrl={profile?.avatar_3d_url || null}
          onSelect={async avatarUrl => {
            setAvatar3dUrl(avatarUrl || DEFAULT_PROFILE_AVATAR_3D_URL)
            setPicking(false)
            try {
              await fetch('/api/profile/avatar3d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: avatarUrl, urlType: avatarUrl ? 'localPath' : 'remove' }),
              })
            } catch { /* the body is on screen already; the profile keeps the old one */ }
            loadProfile()
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** Mounted once in the Scene: the keys, and the menu while it is open. */
/** The topmost open thing is one of the rail's menus, which K replaces. */
function railMenuOnTop(): boolean {
  const top = topmostLayer()
  return Boolean(top && ['spellbook', 'settings', 'world-menu'].includes(top.id))
}

export function CharacterMenu() {
  const { open } = useCharacterState()
  const academy = useAcademyEnabled()
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  useUILayer(CHARACTER_MENU_LAYER, open)
  // The place layer (src/lib/ui-kit/layers.ts). Esc when it is the topmost: an open sheet first, then the menu.
  // One of the rail's menus: opening it (K) closes the spell book, Settings or World, as they close each other.
  useRailMenuExclusion('character', open, closeCharacter)
  useLayer('character-menu', 'place', open, () => {
    const reader = getAcademyState()
    if (reader.reader && reader.readerMap) closeAcademyReader()
    else closeCharacter()
  })

  // The menu needs a free mouse.
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])
  // An agent was opened (N, a notification): its panel takes over.
  useEffect(() => {
    if (focusedAgentId) closeCharacter()
  }, [focusedAgentId])
  // Something popped every UI layer (a click in the world): the menu goes with them.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(CHARACTER_MENU_LAYER) && !state._uiLayerStack.includes(CHARACTER_MENU_LAYER)) closeCharacter()
  }), [])

  // K opens and closes it (on Character). Esc: the open sheet first, then the menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyK' && event.code !== 'Escape') return
      const character = getCharacterState()
      const reader = getAcademyState()
      const action = characterKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        open: character.open,
        tab: character.tab,
        readerOpen: Boolean(reader.reader && reader.readerMap),
        agentOpen: Boolean(useOasisStore.getState().agentEngine.focusedAgentId),
        // K also works over another rail menu (the spell book, Settings, World): it replaces it (Hustler, 23 Nov).
        worldKeysFree: useInputManager.getState().can().enterFocuses || railMenuOnTop(),
      })
      // Esc with a sheet from the map open: the sheet goes (the village's reader does this too; elsewhere it is us).
      if (!action && event.code === 'Escape' && character.open && reader.reader && reader.readerMap && !isTypingTarget(event.target)) {
        closeAcademyReader()
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!action) return
      // K needs the Academy; Esc always closes.
      if (action !== 'close' && !academy) return
      if (action === 'open') openCharacter()
      else closeCharacter()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [academy])

  return open ? <Menu /> : null
}
