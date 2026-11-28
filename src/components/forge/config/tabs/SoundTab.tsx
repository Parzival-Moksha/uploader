'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// SOUND TAB — master/SFX/music/ambient volumes, spatial audio, per-event Sound
// Lab, and the per-spell Spell Sounds selector.
// ═══════════════════════════════════════════════════════════════════════════════

import { KitSelectField, KitToggle } from '@/components/ui-kit'
import { useContext, useState, useSyncExternalStore } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { useAudioManager, SOUND_OPTIONS, type SoundEvent, getFootstepVolume, setFootstepVolume, subscribeFootstepVolume } from '@/lib/audio-manager'
import { SpellSoundsSelector } from './SpellSoundsSelector'
import { MenuSoundSettings } from '@/components/game-menu/GameMenuExperiment'
import {
  DEFAULT_VOICE_TYPING_ENGINE,
  getVoiceTypingEngine,
  setVoiceTypingEngine,
  subscribeVoiceTypingEngine,
  type VoiceTypingEngine,
} from '@/lib/voice/voice-typing-engine'
import {
  DEFAULT_VOICE_MESSAGE_ENGINE,
  getVoiceMessageEngine,
  setVoiceMessageEngine,
  subscribeVoiceMessageEngine,
} from '@/lib/voice/voice-message-engine'
import { VoiceTypingSetup } from './VoiceTypingSetup'
import { MicrophoneSetting } from './MicrophoneSetting'
import { VoiceOutSection } from '@/components/village/VoiceOutSection'
import { hasMusic, musicCreditLine } from '@/lib/music'
import { AMBIENCES, AMBIENCE_SETTINGS, ambienceId, ambienceSetting, ambienceSettingHint } from '@/lib/ambience'
import { useOasisStore } from '@/store/oasisStore'

/** This world's own ambience (saved with the world, like its sky); only a world you may change can be changed. */
function WorldAmbienceField() {
  const worldAmbience = useOasisStore(s => s.worldAmbience)
  const setWorldAmbience = useOasisStore(s => s.setWorldAmbience)
  const canWrite = useOasisStore(s => s.worldRegistry.find(w => w.id === s.activeWorldId)?.canWrite !== false)
  return (
    <KitSelectField
      label="This world's ambience"
      value={ambienceId(worldAmbience)}
      onChange={e => setWorldAmbience(ambienceId(e.target.value))}
      options={AMBIENCES.map(a => ({ value: a.id, label: a.label }))}
      hint={canWrite ? 'Saved with this world; everyone who visits it hears it.' : 'Set by whoever made this world.'}
      disabled={!canWrite}
      data-setting="world-ambience"
    />
  )
}

/** Your own footsteps (0 = silent; the default is a third of the old, too-loud level). */
function FootstepSlider() {
  const value = useSyncExternalStore(subscribeFootstepVolume, getFootstepVolume, () => 0.17)
  return (
    <VolumeSlider
      label="Footsteps"
      accent="rgba(190,170,140,0.85)"
      value={value}
      onChange={v => setFootstepVolume(v)}
    />
  )
}

function VolumeSlider({
  label,
  accent,
  value,
  onChange,
}: {
  label: string
  accent: string
  value: number
  onChange: (next: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <label className="block rounded-lg border p-2" style={{ borderColor: `${accent.replace('0.85', '0.3')}`, background: 'rgba(0,0,0,0.35)' }}>
      <div className="mb-1 flex items-center justify-between text-[10px] font-mono">
        <span className="text-white/65">{label}</span>
        <span className="font-bold" style={{ color: accent }}>{pct}%</span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1 w-full"
        style={{ accentColor: accent }}
      />
    </label>
  )
}

const EVENT_LABELS: Record<string, string> = {
  missionEnd: 'Mission time is up (Mindcraft)',
  select: 'Select Object', deselect: 'Deselect', place: 'Place Object', delete: 'Delete Object',
  // Button clicks and hovers are chosen under Clicks (MenuSoundSettings), not here.
  panelOpen: 'Panel Open', panelClose: 'Panel Close',
  modeSwitch: 'Camera Mode', conjureStart: 'Conjure Start', conjureDone: 'Conjure Done',
  anorakDone: 'Anorak Done', notification: 'Notification', undo: 'Undo', redo: 'Redo',
  connected: 'Agent Connected', levelUp: 'Level Up', chooseCharacter: 'Choose Character',
  agentFocus: 'Agent Focus', agentUnfocus: 'Agent Unfocus', tilePaint: 'Tile Paint',
  error: 'Error',
}

function PerEventSoundLab() {
  const { volume, muted, selections, setVolume, toggleMute, selectSound, preview } = useAudioManager()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
          <span>{expanded ? '▼' : '▸'}</span>
          <span className="text-[11px] font-bold">More UI sounds</span>
        </button>
        <button onClick={toggleMute} className="text-[10px] cursor-pointer px-1.5 py-0.5 rounded" style={{ background: muted ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)', color: muted ? '#ef4444' : '#22c55e' }}>
          {muted ? '🔇 Muted' : '🔊 On'}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-gray-500">UI Vol</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)}
          onChange={e => setVolume(parseInt(e.target.value) / 100)}
          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
        />
        <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{Math.round(volume * 100)}%</span>
      </div>

      {expanded && (
        <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {Object.entries(EVENT_LABELS).map(([event, label]) => {
            const options = (SOUND_OPTIONS as Record<string, Array<{ id: string; label: string }>>)[event]
            if (!options) return null
            return (
              <div key={event} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-gray-500 w-24 truncate flex-shrink-0">{label}</span>
                <select
                  value={(selections as Record<string, string>)[event] || options[0]?.id}
                  onChange={e => {
                    selectSound(event as SoundEvent, e.target.value)
                    preview(event as SoundEvent, e.target.value)
                  }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 cursor-pointer outline-none text-[10px]"
                >
                  {options.map((opt: { id: string; label: string }) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button onClick={() => preview(event as SoundEvent, (selections as Record<string, string>)[event])}
                  className="rounded border border-sky-300/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-gray-500 hover:border-sky-300/45 hover:text-sky-300 cursor-pointer">Test</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** What each choice runs, in a few words (the owner, 27 Nov: two switches, "don't overcomplicate it"). */
const VOICE_CHOICES: Array<{ id: VoiceTypingEngine; label: string; runs: string }> = [
  { id: 'local', label: 'Local', runs: 'Moonshine, on this PC, free' },
  { id: 'elevenlabs', label: 'Cloud', runs: 'ElevenLabs, costs credits' },
]

/** One local/cloud switch: two halves, the chosen one lit, and one line saying what runs. */
function VoiceSwitch({ title, value, onChange }: { title: string; value: VoiceTypingEngine; onChange: (next: VoiceTypingEngine) => void }) {
  const chosen = VOICE_CHOICES.find(choice => choice.id === value) || VOICE_CHOICES[1]
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-bold text-white/80">{title}</div>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10" role="radiogroup" aria-label={title}>
        {VOICE_CHOICES.map(choice => {
          const active = value === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(choice.id)}
              className={`px-2 py-1 text-[11px] font-bold transition ${active ? 'bg-emerald-500/20 text-emerald-200' : 'bg-black/30 text-white/55 hover:bg-white/5'}`}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-white/50">{chosen.runs}</div>
    </div>
  )
}

/**
 * Who turns his voice into text, twice over (the owner, 27 Nov: "voice typing ... local and cloud, and also the voice
 * messages, separately ... We need two switches"): voice typing (T, and the mic on text fields) and recorded voice
 * messages. Local is the same Moonshine Medium helper for both (the engine: ears.py; scribe.js for messages).
 */
function VoiceTypingSection() {
  const typing = useSyncExternalStore(subscribeVoiceTypingEngine, getVoiceTypingEngine, () => DEFAULT_VOICE_TYPING_ENGINE)
  const messages = useSyncExternalStore(subscribeVoiceMessageEngine, getVoiceMessageEngine, () => DEFAULT_VOICE_MESSAGE_ENGINE)
  return (
    <section>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Your voice to text</div>
      <div className="grid grid-cols-2 gap-3">
        <VoiceSwitch title="Voice typing" value={typing} onChange={setVoiceTypingEngine} />
        <VoiceSwitch title="Voice messages" value={messages} onChange={setVoiceMessageEngine} />
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-white/40">
        What you voice-type and send is kept with its sound, on this PC only.
      </div>
      <VoiceTypingSetup />
    </section>
  )
}

export function SoundTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  // Two fixed halves (the owner, 26 Nov: the sections "fight for space"): in the Settings body's flowing columns,
  // opening a section or a longer hint moved the others from one column to the other. Each half is one block that
  // does not break, so the left column is what you hear and the right one voices and the finer UI sounds.
  return (
    <div data-sound-layout="two-fixed">
      <div className="min-w-0 space-y-3 [break-inside:avoid]">
      <MenuSoundSettings />
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Volume Mixers</div>
        <div className="space-y-2">
          <VolumeSlider
            label="Master"
            accent="rgba(167,139,250,0.85)"
            value={settings.masterVolume}
            onChange={v => updateSetting('masterVolume', v)}
          />
          <VolumeSlider
            label="SFX (spells, UI)"
            accent="rgba(251,146,60,0.85)"
            value={settings.sfxVolume}
            onChange={v => updateSetting('sfxVolume', v)}
          />
          <FootstepSlider />
          {/* Only where there is music to play (the package ships none for now: src/lib/music.ts). */}
          {hasMusic() && (
            <KitToggle
              checked={settings.musicEnabled === true}
              onChange={next => updateSetting('musicEnabled', next)}
              label="Music"
              hint={settings.musicEnabled === true ? `Plays ${musicCreditLine()}.` : 'Off. Switch it on to hear the background music.'}
              data-setting="music-enabled"
            />
          )}
          {hasMusic() && settings.musicEnabled === true && (
            <VolumeSlider
              label="Music volume"
              accent="rgba(244,114,182,0.85)"
              value={settings.musicVolume}
              onChange={v => updateSetting('musicVolume', v)}
            />
          )}
          <KitSelectField
            label="Ambience"
            value={ambienceSetting(settings.ambience)}
            onChange={e => updateSetting('ambience', ambienceSetting(e.target.value))}
            options={AMBIENCE_SETTINGS.map(a => ({ value: a.id, label: a.label }))}
            hint={ambienceSettingHint(settings.ambience)}
            data-setting="ambience"
          />
          {ambienceSetting(settings.ambience) === 'world' && <WorldAmbienceField />}
          {ambienceSetting(settings.ambience) !== 'off' && (
            <VolumeSlider
              label="Ambience volume"
              accent="rgba(125,211,252,0.85)"
              value={settings.ambientVolume}
              onChange={v => updateSetting('ambientVolume', v)}
            />
          )}
          <KitToggle
            checked={settings.spatialAudioEnabled}
            onChange={next => updateSetting('spatialAudioEnabled', next)}
            label="3D spatial audio"
            hint="Bolts emit positional sound; volume falls off with distance from the camera"
            data-setting="spatial-audio"
          />
        </div>
      </section>

      <section className="border-t border-white/10 pt-3">
        <SpellSoundsSelector />
      </section>
      </div>

      <div className="min-w-0 space-y-3 [break-inside:avoid]">
      {/* Which input both voice switches hear (the owner, 27 Nov: "I want the Steinberg to be the recording device"). */}
      <MicrophoneSetting />
      <VoiceTypingSection />
      {/* How the agents' spoken lines are made, and the month's ElevenLabs credits (VoiceOutSection.tsx). */}
      <VoiceOutSection />
      <section className="border-t border-white/10 pt-3">
        <PerEventSoundLab />
      </section>
      </div>
    </div>
  )
}
