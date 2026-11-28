'use client'

// ░▒▓ GUIDE INVITE — what an empty village offers: "Summon a guide" ▓▒░
// Shown in the Agents list when the village has no agent at all (VillageAgentsMenu.tsx). One click starts the Guide
// (summon-guide.ts); bringing in one of your own sessions stays one line below it.

import { useState } from 'react'
import { KitButton } from '@/components/ui-kit'
import { GUIDE_INVITE_LINE } from '../../lib/village/guide'
import { summonGuide } from './summon-guide'
import { openVillagePicker } from './village-actions'

export function GuideInvite() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const start = () => {
    setBusy(true)
    setError('')
    summonGuide()
      .catch(problem => setError(`The guide could not start: ${problem instanceof Error ? problem.message : String(problem)}`))
      .finally(() => setBusy(false))
  }
  return (
    <div className="px-2 py-2 text-[11.5px] leading-snug" data-guide-invite>
      <KitButton variant="primary" className="w-full !py-2.5 !text-[13px]" disabled={busy} onClick={start} title={GUIDE_INVITE_LINE}>
        {busy ? 'Summoning…' : 'Summon a guide'}
      </KitButton>
      <div className="mt-1.5 opacity-70">{GUIDE_INVITE_LINE}</div>
      {error && <div role="alert" className="mt-1.5 text-amber-200">{error}</div>}
      <button type="button" onClick={() => openVillagePicker(true)} className="mt-2 text-left opacity-55 underline decoration-dotted underline-offset-2 hover:opacity-90">
        Or summon one of your own agents (Claude Code or Codex)
      </button>
    </div>
  )
}

/** At the end of a list that has agents: the way to summon another. */
export function SummonMoreLine() {
  return (
    <button type="button" onClick={() => openVillagePicker(true)} data-summon-more className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] opacity-55 transition hover:bg-white/10 hover:opacity-100">
      ＋ Summon an agent
    </button>
  )
}
