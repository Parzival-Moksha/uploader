'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// MISC TAB — RP1 toggle, console control, and any other advanced/odd settings.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext, useMemo } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import type { SharedTabProps } from '../types'
import { AppWindowSection } from '../AppWindowSection'
import { MenuFeelSettings } from '@/components/game-menu/GameMenuExperiment'
import { KitToggle } from '@/components/ui-kit'
import { ServicesSettings } from './ServicesSettings'
import { OnlyWhatShipsSection } from '../OnlyWhatShipsSection'
import { OasisUpdateSection } from '../OasisUpdateSection'

export function MiscTab({ consoleControl }: SharedTabProps) {
  const { settings, effectiveRp1Mode, rp1Locked, updateSetting } = useContext(SettingsContext)
  const docsHref = useMemo(() => {
    if (typeof window === 'undefined') return '/docs/getting-started/first-minutes'
    const host = window.location.host
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    return isLocal ? `http://${host}/docs/getting-started/first-minutes` : '/docs/getting-started/first-minutes'
  }, [])

  return (
    <div className="space-y-3">
      {/* The agent engine and the page server: a light each, since when, and Restart (scripts/oasis-supervisor.mjs). */}
      <ServicesSettings />
      {/* The copy you run, how many commits are past it, and Build the new version (src/lib/oasis-update-client.ts).
          Where no update route answers, a packaged Oasis shows its version and how to update by hand, as before. */}
      <OasisUpdateSection fallback={process.env.NEXT_PUBLIC_OASIS_VERSION ? (
        <section data-setting="oasis-version">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Version</div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[11px] font-medium text-gray-200">The Oasis {process.env.NEXT_PUBLIC_OASIS_VERSION}</div>
            <div className="text-[9px] text-gray-400">To update: <span className="font-mono">node scripts/oasis.mjs update</span> in the Oasis folder (with the Claude Code plugin: <span className="font-mono">/oasis update</span>). Your worlds and agents stay.</div>
          </div>
        </section>
      ) : null} />
      <AppWindowSection />
      <MenuFeelSettings />
      {consoleControl && (
        <section>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Console</div>
          <div className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-2">
            {consoleControl}
          </div>
        </section>
      )}

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Modes</div>
        <KitToggle
          checked={effectiveRp1Mode}
          disabled={rp1Locked}
          onChange={() => { if (!rp1Locked) updateSetting('rp1Mode', !settings.rp1Mode) }}
          label="Ready Player 1"
          hint={rp1Locked ? 'Locked for this world — exploration-only.' : effectiveRp1Mode ? 'Hide all editing UI — exploration mode.' : 'Builder mode — full editing UI visible.'}
          data-setting="rp1-mode"
        />
        <KitToggle
          checked={settings.loadingDebugger}
          onChange={() => updateSetting('loadingDebugger', !settings.loadingDebugger)}
          label="Loading debugger"
          hint="While a world loads: what is loading, megabytes done of the total, and the slowest files."
          data-setting="loading-debugger"
        />
      </section>

      <OnlyWhatShipsSection />

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Resources</div>
        <a
          href={docsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all duration-200 border border-teal-500/30 bg-teal-500/5 hover:border-teal-500/50 hover:bg-teal-500/10 w-full"
        >
          <span className="text-lg">📖</span>
          <div>
            <div className="text-[11px] font-medium text-teal-400">Oasis Documentation</div>
            <div className="text-[9px] text-gray-400">Guides, API reference, architecture</div>
          </div>
        </a>
      </section>
    </div>
  )
}
