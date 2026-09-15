import { useState } from 'react'
import { usePsnStatus, usePsnProfile, usePsnTitles, useConnectPsn, useDisconnectPsn } from '../hooks/usePlayStation'
import type { PsnTrophyTitle } from '../api/psnApi'

// PlayStation integration — the community npsso-cookie flow (Sony has no
// official API; see CLAUDE.md's Games Feature Detail research note).
// UNVERIFIED against a real account in this authoring session — the
// profile/presence/titles response shapes below are read defensively with
// fallbacks, and this genuinely needs a live pass with a real npsso once
// deployed. Expect to adjust field paths after the first real connect.

function ConnectForm() {
  const [npsso, setNpsso] = useState('')
  const connect = useConnectPsn()

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="text-center mb-6">
        <p className="text-4xl mb-3">🎮</p>
        <h2 className="text-base font-bold text-ink-900 mb-1">Connect PlayStation</h2>
        <p className="text-sm text-ink-500">
          Sony has no official API — this uses the community <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">npsso</code> token flow.
          You'll need to repeat this every couple of months when the token expires.
        </p>
      </div>

      <ol className="text-sm text-ink-700 space-y-2 mb-5 list-decimal list-inside bg-cream-50 border border-ink-200 rounded-xl p-4">
        <li>Log into <a href="https://my.playstation.com" target="_blank" rel="noreferrer" className="text-accent-600 underline">my.playstation.com</a> in this browser.</li>
        <li>Open <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noreferrer" className="text-accent-600 underline">the ssocookie endpoint</a> in a new tab — it returns JSON like <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">{'{"npsso":"…"}'}</code>.</li>
        <li>Copy the value between the quotes and paste it below.</li>
      </ol>

      <textarea value={npsso} onChange={e => setNpsso(e.target.value)} rows={3} placeholder="Paste your npsso token here…"
        className="w-full px-3 py-2.5 text-xs font-mono rounded-xl border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none" />

      <button onClick={() => connect.mutate(npsso.trim())} disabled={!npsso.trim() || connect.isPending}
        className="mt-3 w-full min-h-[44px] px-4 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-xl disabled:opacity-40 transition-colors">
        {connect.isPending ? 'Connecting…' : '🔌 Connect'}
      </button>
    </div>
  )
}

function TitleCard({ title }: { title: PsnTrophyTitle }) {
  const [imgOk, setImgOk] = useState(true)
  const t = title.earnedTrophies ?? { bronze: 0, silver: 0, gold: 0, platinum: 0 }
  return (
    <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col">
      <div className="bg-ink-100" style={{ aspectRatio: '1/1' }}>
        {imgOk && title.trophyTitleIconUrl
          ? <img src={title.trophyTitleIconUrl} alt={title.trophyTitleName} onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🏆</div>}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{title.trophyTitleName}</p>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-ink-500">
          {t.platinum > 0 && <span title="Platinum">🏆{t.platinum}</span>}
          <span title="Gold">🥇{t.gold}</span>
          <span title="Silver">🥈{t.silver}</span>
          <span title="Bronze">🥉{t.bronze}</span>
        </div>
        {title.progress != null && (
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-green-500" style={{ width: `${title.progress}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectedView() {
  const profile = usePsnProfile(true)
  const titles = usePsnTitles(true)
  const disconnect = useDisconnectPsn()

  const onlineId = (profile.data?.profile as { onlineId?: string } | undefined)?.onlineId
    ?? (profile.data?.profile as { profile?: { onlineId?: string } } | undefined)?.profile?.onlineId

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="text-sm font-bold text-ink-900">{onlineId ?? (profile.isLoading ? 'Loading…' : 'PlayStation')}</p>
          <p className="text-xs text-ink-400">Best-effort integration — reconnect with a fresh npsso if this ever stops updating.</p>
        </div>
        <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
          className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-40">
          Disconnect
        </button>
      </div>

      {titles.isLoading && <div className="text-sm text-ink-400 py-8 text-center">Loading trophy titles…</div>}
      {titles.error && <div className="text-sm text-red-600 py-8 text-center">Couldn't load games: {(titles.error as Error).message}</div>}
      {!titles.isLoading && (titles.data?.length ?? 0) === 0 && !titles.error && (
        <div className="text-center py-12 text-ink-400 text-sm">No trophy titles found for this account.</div>
      )}
      {(titles.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {titles.data!.map(t => <TitleCard key={t.npCommunicationId} title={t} />)}
        </div>
      )}
    </div>
  )
}

export function PlayStationTab() {
  const status = usePsnStatus()
  if (status.isLoading) return <div className="text-sm text-ink-400 py-12 text-center">Checking connection…</div>
  return status.data?.connected ? <ConnectedView /> : <ConnectForm />
}
