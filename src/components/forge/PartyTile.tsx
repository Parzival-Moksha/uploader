'use client'

// ░▒▓ PARTIES ON THIS WI-FI ▓▒░  (top of the World menu; owner, 2026-11-22: "a button to all Oases that just leads to
// the common server... they'll just see the local server and join it in one click instead of typing that IP address")
// Found: "Join <host>'s party on this Wi-Fi · 3 inside", opening it in its own tab with this player's name and body.
// None found: "Host a party on this Wi-Fi", which starts the party server from this install (src/lib/party/host.ts).
// At a party (its tab): "Back to my Oasis". Built from the UI kit only.

import { useCallback, useEffect, useState } from 'react'
import { KitButton, KitCard, KitTextField, KitTileButton, KitToggle, kitConfirm } from '@/components/ui-kit'

interface Party { host: string; world: string; players: number; url: string; version: string; spells: boolean }
interface HostState { running: boolean; url?: string; host?: string; canHost: boolean; hostingAvailable?: boolean; reason?: string; firewallLine?: string }

const TEXT = 'text-[11px] leading-snug opacity-80'
const SAFETY = 'A party is another person’s computer: join only parties of people you know.'

function partyHostFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const m = /(?:^|;\s*)oasis_party=([^;]*)/.exec(document.cookie)
  return m ? decodeURIComponent(m[1]) || 'a friend' : null
}

export function PartyTile() {
  const [atParty] = useState(partyHostFromCookie)
  const [parties, setParties] = useState<Party[]>([])
  const [version, setVersion] = useState('')
  const [host, setHost] = useState<HostState | null>(null)
  const [me, setMe] = useState<{ name: string; avatar: string }>({ name: '', avatar: '' })
  const [hosting, setHosting] = useState(false)
  const [hostName, setHostName] = useState('')
  const [paidSpells, setPaidSpells] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showFirewall, setShowFirewall] = useState(false)
  const [closeFailed, setCloseFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const nearby = await (await fetch('/api/party/nearby', { cache: 'no-store' })).json()
      setParties(Array.isArray(nearby.parties) ? nearby.parties : [])
      setVersion(nearby.version || '')
    } catch { setParties([]) }
    try {
      const res = await fetch('/api/party/host', { cache: 'no-store' })
      setHost(res.ok ? await res.json() : null)
    } catch { setHost(null) }
  }, [])

  useEffect(() => {
    if (atParty) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4000)
    fetch('/api/profile', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(p => {
      if (!p) return
      setMe({ name: p.displayName || '', avatar: p.avatar_3d_url || '' })
      setHostName(current => current || p.displayName || '')
    }).catch(() => {})
    return () => window.clearInterval(timer)
  }, [atParty, refresh])

  if (atParty) {
    return (
      <div className="mb-3" data-party-tile="at-party">
        <KitTileButton
          icon="🏠"
          label="Back to my Oasis"
          sub={`You are at ${atParty}'s party. This tab closes; your own Oasis is still open in the other one.`}
          accent="#34d399"
          onClick={() => { window.close(); window.setTimeout(() => setCloseFailed(true), 300) }}
          className="w-full"
          style={{ minHeight: 84 }}
        />
        {closeFailed && <div className={`mt-1 ${TEXT}`}>This browser keeps the tab open: close it yourself, your Oasis is in the other tab.</div>}
      </div>
    )
  }

  const join = (party: Party) => {
    const q = new URLSearchParams()
    if (me.name) q.set('name', me.name)
    if (me.avatar.startsWith('/avatars/')) q.set('avatar', me.avatar)
    window.open(`${party.url}/?${q.toString()}`, '_blank', 'noopener')
  }

  const ownUrl = host?.running ? host.url : undefined
  const others = parties.filter(p => !ownUrl || !p.url.startsWith(ownUrl))

  const start = async () => {
    const ok = await kitConfirm({
      title: 'Host a party on this Wi-Fi?',
      body: `Everyone on this Wi-Fi will see "${hostName || 'your'} party" in their World menu and can walk in. They share one sandbox world on this computer, made fresh for parties: not your worlds, no agents, no files (they do see this Oasis's catalog, including models you added to it)${paidSpells ? ', and paid spells on your keys within a budget' : ', no keys'}.`,
      confirm: 'Start the party',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/party/host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', hostName, paidSpells }) })
      setHost(await res.json())
      setShowFirewall(true)
      setHosting(false)
    } finally { setBusy(false) }
    window.setTimeout(() => { void refresh() }, 5000)
  }

  const stop = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/party/host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })
      setHost(await res.json())
    } finally { setBusy(false) }
    void refresh()
  }

  return (
    <div className="mb-3 space-y-2" data-party-tile>
      {others.map(party => (
        <div key={party.url}>
          <KitTileButton
            icon="🎉"
            label={`Join ${party.host}'s party on this Wi-Fi`}
            sub={`${party.world || 'A shared world'} · ${party.players} inside${party.spells ? ' · paid spells on' : ''}`}
            badge={party.players > 0 ? `${party.players} inside` : undefined}
            accent="#f5c96a"
            onClick={() => join(party)}
            title={party.url}
            className="w-full"
            style={{ minHeight: 92 }}
          />
          {version && party.version && party.version !== version && (
            <div className={`mt-1 ${TEXT}`}>This party runs Oasis {party.version}, yours is {version}: some things may look or work differently.</div>
          )}
        </div>
      ))}

      {host?.running ? (
        <KitCard title="Your party is on">
          <div className={TEXT}>Friends on this Wi-Fi see it in their World menu, or open <b>{host.url}</b>.</div>
          <div className="mt-2 flex gap-2">
            <KitButton variant="primary" onClick={() => host.url && window.open(`${host.url}/?${new URLSearchParams({ ...(me.name ? { name: me.name } : {}), ...(me.avatar.startsWith('/avatars/') ? { avatar: me.avatar } : {}) })}`, '_blank', 'noopener')}>Open it</KitButton>
            <KitButton variant="danger" disabled={busy} onClick={stop}>Stop the party</KitButton>
          </div>
          {showFirewall && host.firewallLine && (
            <div className={`mt-2 ${TEXT}`}>
              If friends do not see it: Windows may block it on a public Wi-Fi. Once, in an admin PowerShell:
              <code className="mt-1 block select-all break-all rounded bg-black/40 p-1 text-[10px]">{host.firewallLine}</code>
            </div>
          )}
        </KitCard>
      ) : others.length === 0 && host?.hostingAvailable === true && (
        hosting ? (
          <KitCard title="Host a party on this Wi-Fi">
            <div className="space-y-2">
              <KitTextField label="Your name, as friends will see it" value={hostName} onChange={e => setHostName(e.target.value)} maxLength={40} />
              <KitToggle checked={paidSpells} onChange={setPaidSpells} label="Paid spells on my keys" hint="Pictures, 3D, music for everyone, on your keys, within an evening's budget. Off: free building only." />
              <div className={TEXT}>Opens one sandbox world on this computer to this Wi-Fi (port 4680). No agents, no files, nothing else of yours.</div>
              <div className="flex gap-2">
                <KitButton variant="primary" disabled={busy || !host?.canHost} onClick={start}>Start the party</KitButton>
                <KitButton onClick={() => setHosting(false)}>Cancel</KitButton>
              </div>
              {host && !host.canHost && <div className={TEXT}>{host.reason}</div>}
            </div>
          </KitCard>
        ) : (
          <KitTileButton
            icon="🎉"
            label="Host a party on this Wi-Fi"
            sub="Friends in the same room join your world in one click."
            accent="#a78bfa"
            onClick={() => setHosting(true)}
            className="w-full"
            style={{ minHeight: 84 }}
          />
        )
      )}
      <div className={TEXT}>{SAFETY}</div>
    </div>
  )
}
