'use client'

// Settings > Misc > Oasis services (moved from Agents on 22 Nov, where the owner did not find it): a green or red light
// for the agent engine and the page server, since when each runs, and a Restart button for
// each (the owner's click only; /api/oasis/services asks the supervisor, scripts/oasis-supervisor.mjs). Without the
// supervisor (the old two-window launcher) it says how to get it. The red warning when one is down is
// ConnectionWarning's; this is where to act on it. What it shows comes from useServicesView (services-view.ts): the
// supervisor's status as the engine relays it, at once, not a probe of the busy dev server.

import { useState } from 'react'
import { kitConfirm } from '@/components/ui-kit'
import { ageText, useServicesView, type ServiceView } from './services-view'


const STATE_TEXT: Record<ServiceView['state'], string> = {
  running: 'running',
  starting: 'starting…',
  down: 'down: starting it again shortly',
  stopping: 'restarting…',
  'gave-up': 'down: it crashed five times in ten minutes; Restart tries again',
  unknown: '…',
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** "08:54" today, "Fri 08:54" another day. */
export function sinceText(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  return d.toDateString() === new Date(now).toDateString() ? clock(ms) : `${d.toLocaleDateString('en', { weekday: 'short' })} ${clock(ms)}`
}

/** Green running, amber on its way, red down. */
export function lightColor(state: string | null | undefined): string {
  if (state === 'running') return '#22c55e'
  if (state === 'starting' || state === 'stopping') return '#f59e0b'
  return '#ef4444'
}

export function Light({ color, title }: { color: string; title?: string }) {
  return <span aria-hidden title={title} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
}

export function ServicesSettings() {
  const { data, slow, error: readError } = useServicesView()
  const [restartError, setError] = useState<string | null>(null)
  const error = restartError || readError
  const [asked, setAsked] = useState<string | null>(null)

  const restart = async (service: ServiceView) => {
    // The Oasis's own dialog, not the browser's (the owner, 2026-11-24).
    const page = service.name === 'world'
    // An engine restart ends every agent's process, and with it what runs under it (subagents, a render, an encode):
    // name them first (27 Nov: Tyler's final encode was cut off by a restart).
    let lost = ''
    if (!page) {
      const helpers = await fetch('/api/oasis/services?helpers=1', { cache: 'no-store' }).then(r => r.json()).then(j => j.helpers as Record<string, string[]> | null).catch(() => null)
      const lines = helpers ? Object.entries(helpers).map(([agent, list]) => `${agent}: ${list.join(', ')}`) : []
      lost = lines.length ? ` These are running now and would be stopped: ${lines.join('; ')}. Wait for them, or restart anyway.` : ''
    }
    const ok = await kitConfirm({
      title: page ? 'Restart the page server?' : lost ? 'Restart the agent engine? Work would be lost' : 'Restart the agent engine?',
      body: page
        ? 'This window goes blank for about half a minute, then reloads by itself. Agents keep working.'
        : `Agents in the middle of a turn are stopped and told to carry on when it is back (about ten seconds).${lost}`,
      confirm: 'Restart',
      danger: true,
    })
    if (!ok) return
    setAsked(service.name)
    fetch('/api/oasis/services', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: service.name }) })
      .then(async res => { if (!res.ok) setError((await res.json().catch(() => ({}))).error || `Restart failed (${res.status})`) })
      .catch(() => { /* the page server's own restart ends this request: expected */ })
      .finally(() => window.setTimeout(() => setAsked(null), 4000))
  }

  return (
    <section data-services-settings>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Oasis services</div>
      {error && <div className="flex items-center gap-2 text-[11px] text-amber-300 mb-1"><Light color={lightColor('down')} />{error}</div>}
      {data && data.services.map(service => (
        <div key={service.name} className="flex items-center justify-between gap-2 py-1" data-service={service.name} data-service-state={service.state}>
          <div className="flex min-w-0 items-center gap-2">
            <Light color={lightColor(service.state)} />
            <div className="min-w-0">
            <div className="text-sm text-gray-300">{service.label}</div>
            <div className={`text-[10px] ${service.state === 'running' ? 'text-gray-500' : 'text-amber-300'}`} title={service.log ? `Log: ${service.log}` : undefined}>
              {STATE_TEXT[service.state] || service.state}
              {service.state === 'running' && (service.startedAt || service.since) ? ` since ${sinceText((service.startedAt || service.since)!)}` : ''}
              {service.bytes ? ` · ${(service.bytes / 1024 ** 3).toFixed(1)} GB` : ''}
              {data.supervisor ? (service.managed ? ' · no window' : ' · in its own window') : ''}
              {service.restarts ? ` · restarted ${service.restarts}×` : ''}
            </div>
            {service.tired && <div className="text-[10px] text-amber-300" data-service-tired>restart me: {service.tired}. A restart takes about half a minute; a page open on it reloads by itself.</div>}
            </div>
          </div>
          <button
            type="button"
            disabled={!data.supervisor || asked === service.name || service.state === 'stopping'}
            onClick={() => restart(service)}
            data-service-restart={service.name}
            className="shrink-0 rounded border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-xs font-bold text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {asked === service.name ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      ))}
      {/* The third one: this tab itself (the owner, 27 Nov: "what do we call the page itself? The restart would be
          equivalent to hitting F5"; F5 cured a one-to-two-second freeze on E and F that evening). */}
      <div className="flex items-center justify-between gap-2 py-1" data-service="page">
        <div className="flex min-w-0 items-center gap-2">
          <Light color={lightColor('running')} />
          <div className="min-w-0">
            <div className="text-sm text-gray-300">This page</div>
            <div className="text-[10px] text-gray-500">the view in this tab; reload it if it feels slow or stale (the same as F5)</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          data-service-restart="page"
          className="shrink-0 rounded border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-xs font-bold text-cyan-50 transition hover:bg-cyan-500/30"
        >
          Reload
        </button>
      </div>
      {data && data.source === 'cache' && <div className="text-[10px] text-gray-500" data-services-age>as last seen, {ageText(data.at)}{slow ? ' · slow to answer' : ''}</div>}
      {!data && !error && <div className="text-[11px] text-gray-500" data-services-waiting>{slow ? 'slow to answer…' : 'reading…'}</div>}
      {data && <div className="text-[10px] text-gray-500 mt-1">
        {data.supervisor
          ? 'The supervisor runs both without windows, keeps their logs in C:\\af_oasis\\logs and starts one again if it stops.'
          : 'The servers run in windows of their own (the OASIS launcher). Start the Oasis from the "Oasis app" desktop icon to run them hidden and restart them from here.'}
      </div>}
    </section>
  )
}
