'use client'

// ░▒▓ CLAUDE PLAN LIMITS — the week, the week per model (Fable…), the 5-hour session, at a glance ▓▒░
// From Claude Code's own /usage (GET /api/claude-plan, lib/claude-plan-usage.ts), with the account that CLI is
// logged into, so a switched login can't be mistaken for the other one. A number Claude Code doesn't give is
// said so, never shown as zero. Rechecks every minute while the Profile is open; ↻ asks right away.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getCachedStatus, loadCachedJson, persistCachedJson, subscribeCachedJson, useCachedJson } from '@/lib/cached-json'

interface PlanWindow { key: string; label: string; percent: number; resetsText: string | null; timeZone: string | null; resetsAt: number | null }
interface PlanUsage {
  ok: boolean
  account: { email: string | null; name: string | null; plan: string | null; organization: string | null; configDir: string } | null
  windows: PlanWindow[]
  subscription: boolean | null
  checkedAt: number
  error?: string
}

/** Fill colours: the plain series blue, the status warning and critical steps (validated dark palette). */
const FILL_OK = '#3987e5'
const FILL_WARN = '#fab219'
const FILL_CRITICAL = '#d03b3b'

function untilText(at: number | null, now: number): string | null {
  if (!at) return null
  const ms = at - now
  if (ms <= 0) return 'any moment'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `in ${h}h ${m}m` : `in ${m}m`
}

function Meter({ window: w, now }: { window: PlanWindow; now: number }) {
  const level = w.percent >= 90 ? 'critical' : w.percent >= 75 ? 'warning' : 'ok'
  const fill = level === 'critical' ? FILL_CRITICAL : level === 'warning' ? FILL_WARN : FILL_OK
  const until = untilText(w.resetsAt, now)
  return (
    <div data-plan-window={w.key}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-white/85">{w.label}</span>
        <span className="font-mono text-sm font-bold text-white">
          {w.percent}%
          {level !== 'ok' && <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-white/70">{level === 'critical' ? '▲ almost out' : '▲ getting close'}</span>}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-sm" style={{ background: '#2c2c2a' }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.percent} aria-label={`${w.label}: ${w.percent}% used`}>
        <div className="h-full" style={{ width: `${Math.min(100, Math.max(1, w.percent))}%`, background: fill, borderRadius: '0 2px 2px 0' }} />
      </div>
      <div className="mt-0.5 text-[10px] text-white/50">
        {w.resetsText ? `resets ${w.resetsText}${until ? ` · ${until}` : ''}` : 'reset time not given'}
      </div>
    </div>
  )
}

const PLAN_URL = '/api/claude-plan'
persistCachedJson(PLAN_URL)

export function ClaudePlanLimits() {
  // Kept for the page's life (src/lib/cached-json.ts): asking Claude Code takes ~10 s the first time, so the
  // menu shows the last answer at once and asks again behind it, every minute while shown.
  const usage = useCachedJson<PlanUsage>(PLAN_URL, 60_000, 60_000) || null
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const missing = useSyncExternalStore(listener => subscribeCachedJson(PLAN_URL, listener), () => [403, 404].includes(getCachedStatus(PLAN_URL)), () => false)
  useEffect(() => { setNow(Date.now()) }, [usage])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback((fresh = false) => {
    setLoading(true)
    const ask = fresh ? fetch(`${PLAN_URL}?fresh=1`).catch(() => null).then(() => loadCachedJson(PLAN_URL)) : loadCachedJson(PLAN_URL)
    void ask.finally(() => setLoading(false))
  }, [])

  // Hosted (no local Claude Code): nothing to show.
  if (missing) return null

  const account = usage?.account
  const session = usage?.windows.some(w => /session/i.test(w.key))
  return (
    <div className="border-b border-white/10 px-4 py-3" data-plan-limits>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Plan limits · Claude Code</p>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          title="Ask Claude Code again (its /usage, no cost)"
          className="text-[11px] text-white/55 hover:text-white disabled:opacity-40"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="mt-0.5 truncate text-[10.5px] text-white/60" title={account ? `Claude Code's login on this machine (${account.configDir}): the terminal, the desktop app and the village's agents use it unless started with another CLAUDE_CONFIG_DIR.` : undefined}>
        {account?.email
          ? <>logged in as <span className="text-white/90">{account.email}</span>{account.plan ? ` · ${account.plan}` : ''}{usage?.subscription === false ? ' · API key' : ''}</>
          : usage ? 'account: not found in Claude Code’s config' : 'reading the login…'}
      </div>
      <div className="mt-2 space-y-2">
        {!usage && <div className="text-[11px] text-white/45">asking Claude Code for its limits…</div>}
        {usage && !usage.ok && <div className="text-[11px] leading-snug text-amber-200/90">Limits not available: {usage.error || 'Claude Code did not answer'}</div>}
        {usage?.windows.map(w => <Meter key={w.key} window={w} now={now} />)}
        {usage?.ok && !session && <div className="text-[10px] text-white/45">Session (5 h): not listed by Claude Code right now</div>}
      </div>
      {usage && (
        <div className="mt-1.5 text-[9.5px] text-white/35">
          checked {new Date(usage.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · Claude Code /usage
        </div>
      )}
    </div>
  )
}
