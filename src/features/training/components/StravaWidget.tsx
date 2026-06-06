import { useEffect } from 'react'
import { useStravaStatus, useSyncStrava, useDisconnectStrava } from '../hooks/useTrainingSessions'
import { buildStravaOAuthUrl, exchangeStravaCode } from '../api/stravaApi'
import { useQueryClient } from '@tanstack/react-query'

export function StravaWidget() {
  const { data: status, isLoading } = useStravaStatus()
  const sync       = useSyncStrava()
  const disconnect = useDisconnectStrava()
  const qc         = useQueryClient()

  // Handle OAuth redirect — Strava sends ?code= after approval
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const scope  = params.get('scope')

    if (!code || !scope) return

    // Clear the query params from URL without reload
    const clean = window.location.pathname + window.location.hash.replace(/\?.*$/, '')
    window.history.replaceState({}, '', clean)

    exchangeStravaCode(code)
      .then(() => qc.invalidateQueries({ queryKey: ['training'] }))
      .catch(console.error)
  }, [qc])

  if (isLoading) {
    return <div className="h-10 w-48 bg-cream-200 animate-pulse rounded-lg" />
  }

  if (!status?.connected) {
    return (
      <a
        href={buildStravaOAuthUrl()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-sm font-medium hover:bg-[#e04400] transition-colors duration-150"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        Connect Strava
      </a>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-ink-100 bg-white">
      {status.athlete_avatar && (
        <img
          src={status.athlete_avatar}
          alt={status.athlete_name ?? ''}
          className="w-7 h-7 rounded-full object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-800 truncate">{status.athlete_name}</p>
        <p className="text-[10px] text-[#FC4C02] font-medium">Strava connected</p>
      </div>
      <div className="flex gap-1.5 ml-auto flex-shrink-0">
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="text-xs px-2.5 py-1 rounded bg-ink-100 text-ink-600 hover:bg-ink-200 transition-colors duration-150"
          title="Sync recent activities"
        >
          {sync.isPending ? '…' : '↻ Sync'}
        </button>
        <button
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-50 transition-colors duration-150"
          title="Disconnect Strava"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
