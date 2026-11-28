'use client'
// ░▒▓ CONJURE — the body of Text to 3D Level 2 and Pic to 3D (Meshy or Tripo models) ▓▒░
// The owner, 27 Nov: "Text to 3D" (the crafting from shapes) is level 1; "Text to 3D Level 2" makes a real 3D model
// from words, and "Pic to 3D" from a picture; Text to Character becomes the Character choice inside them, with rig and
// pose. Textured by default ("of course we want textured objects"). Same engine as the Wizard Console's Conjure tab
// (useConjure, /api/conjure), which stays; what is made lands in one gallery shared by both spells.

import { useCallback, useMemo, useRef, useState } from 'react'
import { useOasisStore } from '../../../../store/oasisStore'
import { useConjure } from '../../../../hooks/useConjure'
import { AssetCard } from '../../AssetCard'
import { KitButton, KitChip, KitPickTile, KitSelectField, KitTextField, KitToggle, kitConfirm } from '@/components/ui-kit'
import { PROVIDERS, REMESH_PRESETS, type ConjuredAsset, type ProviderName } from '../../../../lib/conjure/types'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export type ConjureSource = 'text' | 'image'

/** The textured tier a provider starts on (the owner wants textured models by default). */
export function defaultTierFor(provider: ProviderName): string {
  const def = PROVIDERS.find(p => p.name === provider)
  if (!def) return ''
  return def.tiers[0].id // each provider lists its newest textured model first (src/lib/conjure/types.ts)
}

/** A picture from the page's own address, sent inline: Meshy and Tripo cannot reach this machine. */
async function asDataUri(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const res = await fetch(url.startsWith('http') ? url : `${OASIS_BASE}${url}`)
  if (!res.ok) throw new Error(`could not read the picture (${res.status})`)
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('could not read the picture'))
    reader.readAsDataURL(blob)
  })
}

export function ConjureSpellBody({ source }: { source: ConjureSource }) {
  const { conjuredAssets, startConjure, processAsset, deleteAsset } = useConjure()
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const generatedImages = useOasisStore(s => s.generatedImages)

  // Tripo first: cheaper per textured model, and Meshy's API needs a paid Meshy plan (research, 27 Nov).
  const [provider, setProvider] = useState<ProviderName>('tripo')
  const [tier, setTier] = useState(() => defaultTierFor('tripo'))
  const [character, setCharacter] = useState(false)
  const [pose, setPose] = useState<'a-pose' | 't-pose'>('a-pose')
  const [rig, setRig] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [picture, setPicture] = useState<string | null>(null)
  const [casting, setCasting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const providerDef = PROVIDERS.find(p => p.name === provider) || PROVIDERS[0]
  const tierDef = providerDef.tiers.find(t => t.id === tier) || providerDef.tiers[0]
  const ready = source === 'text' ? Boolean(prompt.trim()) : Boolean(picture)

  const chooseProvider = (next: ProviderName) => {
    setProvider(next)
    setTier(defaultTierFor(next))
  }

  const pickFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setPicture(String(reader.result))
    reader.readAsDataURL(file)
  }

  const cast = useCallback(async () => {
    if (!ready || casting) return
    setCasting(true)
    setError(null)
    try {
      const options: Record<string, unknown> = {}
      if (character) {
        options.characterMode = true
        options.characterOptions = { poseMode: pose, topology: 'quad', symmetry: true }
        if (rig) options.autoRig = true
      }
      if (source === 'image' && picture) options.imageUrl = await asDataUri(picture)
      const words = prompt.trim() || (source === 'image' ? 'picture to 3D' : '')
      await startConjure(words, provider, tier, Object.keys(options).length ? options as never : undefined)
      setPrompt('')
      if (source === 'image') setPicture(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The conjuring failed.'
      // Meshy answers 402 to a free-plan key (Animator, 27 Nov: 'Task creation on the free plan is no longer supported').
      setError(/free plan|402/i.test(message) && provider === 'meshy'
        ? 'Meshy refused: a free Meshy plan cannot make models through its API any more. Choose Tripo, or upgrade the Meshy plan.'
        : message)
    } finally {
      setCasting(false)
    }
  }, [ready, casting, character, pose, rig, source, picture, prompt, provider, tier, startConjure])

  const inFlight = conjuredAssets.filter(asset => asset.status !== 'ready' && asset.status !== 'failed')
  const gallery = useMemo(() => conjuredAssets.filter(asset => asset.status === 'ready' && asset.glbPath).slice().reverse(), [conjuredAssets])
  const chosen = gallery.find(asset => asset.id === selected) || null
  const pictures = useMemo(() => generatedImages.slice().reverse().slice(0, 12), [generatedImages])

  const place = (asset: ConjuredAsset) => {
    if (!asset.glbPath) return
    enterPlacementMode({ type: 'conjured', name: (asset.displayName || asset.prompt).slice(0, 24), path: `${OASIS_BASE}${asset.glbPath}`, defaultScale: asset.scale ?? 1 })
    window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
  }
  const run = (work: Promise<unknown>) => { work.catch((e: Error) => setError(e.message)) }
  const remove = async (asset: ConjuredAsset) => {
    const ok = await kitConfirm({ title: `Delete ${asset.displayName || asset.prompt.slice(0, 40)}?`, body: 'The model leaves your gallery and every world it stands in.', confirm: 'Delete', danger: true })
    if (ok) { await deleteAsset(asset.id); if (selected === asset.id) setSelected(null) }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2">
        {source === 'text' ? (
          <KitTextField
            multiline rows={3}
            label="What to make"
            placeholder={character ? 'a stout dwarf blacksmith with a leather apron…' : 'a crystal dragon perched on a floating rock…'}
            value={prompt}
            onChange={event => setPrompt((event.target as HTMLTextAreaElement).value)}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="kit-label">The picture</span>
            <div className="flex items-center gap-2">
              {picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picture} alt="" className="h-16 w-16 rounded object-cover" />
              ) : null}
              <KitButton onClick={() => fileInput.current?.click()}>{picture ? 'Another picture' : 'Upload a picture'}</KitButton>
              {picture && <KitChip tone="danger" onClick={() => setPicture(null)}>Clear</KitChip>}
            </div>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={event => { pickFile(event.target.files?.[0]); event.target.value = '' }} />
            {pictures.length > 0 && (
              <>
                <span className="kit-hint">Or one you made with Text to Pic:</span>
                <div className="grid grid-cols-4 gap-1">
                  {pictures.map(image => (
                    <KitPickTile key={image.id} picture={image.url} selected={picture === image.url} onClick={() => setPicture(image.url)} title={image.prompt} />
                  ))}
                </div>
              </>
            )}
            <KitTextField label="A hint (optional)" placeholder="what it is, if the picture is not obvious" value={prompt} onChange={event => setPrompt((event.target as HTMLInputElement).value)} />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <KitChip pressed={!character} onClick={() => setCharacter(false)}>📦 Object</KitChip>
          <KitChip pressed={character} onClick={() => setCharacter(true)}>🧍 Character</KitChip>
        </div>
        {character && (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              <KitChip pressed={pose === 'a-pose'} onClick={() => setPose('a-pose')} title="Arms down at an angle: the cleaner shoulders for animation">A-pose</KitChip>
              <KitChip pressed={pose === 't-pose'} onClick={() => setPose('t-pose')} title="Arms straight out">T-pose</KitChip>
            </div>
            <KitToggle checked={rig} onChange={setRig} label="Rig it (a skeleton, so it can walk and dance)" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <KitSelectField label="Made by" value={provider} onChange={event => chooseProvider(event.target.value as ProviderName)} options={PROVIDERS.map(p => ({ value: p.name, label: p.displayName }))} />
          <KitSelectField label="Model" value={tier} onChange={event => setTier(event.target.value)} options={providerDef.tiers.map(t => ({ value: t.id, label: t.name }))} />
        </div>
        <span className="kit-hint">{tierDef.description} · about {tierDef.estimatedSeconds < 90 ? `${tierDef.estimatedSeconds} s` : `${Math.round(tierDef.estimatedSeconds / 60)} min`}{character && rig ? ', then rigging' : ''}</span>

        <KitButton variant="primary" disabled={!ready || casting} onClick={() => void cast()}>
          {casting ? 'Casting…' : ready ? `Conjure ${character ? 'the character' : 'it'}` : source === 'text' ? 'Say what to make' : 'Choose a picture'}
        </KitButton>
        {error && <span className="kit-hint" role="alert">{error}</span>}
      </section>

      {inFlight.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="kit-label">Being made</span>
          {inFlight.map(asset => (
            <div key={asset.id} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate">{asset.displayName || asset.prompt}</span>
              <span className="tabular-nums opacity-70">{Math.round(asset.progress || 0)}%</span>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <span className="kit-label">Your models ({gallery.length})</span>
        {gallery.length === 0 ? (
          <span className="kit-hint">Nothing conjured yet: what you make appears here, and in the world in front of you.</span>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gallery.map(asset => (
              <AssetCard
                key={asset.id}
                id={asset.id}
                name={asset.displayName || asset.prompt}
                type="conjured"
                thumbnailUrl={asset.thumbnailUrl}
                modelUrl={asset.glbPath ? `${OASIS_BASE}${asset.glbPath}` : undefined}
                isInWorld={worldConjuredAssetIds.includes(asset.id)}
                accentColor="#F97316"
                subtitle={`${asset.provider}${asset.action && asset.action !== 'conjure' ? ` · ${asset.action}` : ''}${asset.characterMode ? ' · character' : ''}`}
                onClick={() => setSelected(selected === asset.id ? null : asset.id)}
                onPlace={() => place(asset)}
                onDelete={() => void remove(asset)}
              />
            ))}
          </div>
        )}
        {chosen && (
          <div className="flex flex-wrap gap-1.5" aria-label="What to do with it">
            <KitChip onClick={() => place(chosen)}>Place</KitChip>
            {chosen.provider === 'meshy' && chosen.tier === 'preview' && chosen.action !== 'texture' && (
              <KitChip onClick={() => run(processAsset(chosen.id, 'texture'))}>Texture it</KitChip>
            )}
            {(chosen.provider === 'meshy' || chosen.provider === 'tripo') && (
              <KitChip onClick={() => run(processAsset(chosen.id, 'remesh', { targetPolycount: REMESH_PRESETS.low.polycount, topology: 'quad' }))} title={REMESH_PRESETS.low.label}>Lighter mesh</KitChip>
            )}
            {chosen.characterMode && chosen.action !== 'rig' && chosen.action !== 'animate' && (
              <KitChip onClick={() => run(processAsset(chosen.id, 'rig'))}>Rig it</KitChip>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
