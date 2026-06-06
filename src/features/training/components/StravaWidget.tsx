import { useEffect, useState } from 'react'
import { useStravaStatus, useSyncStrava, useDisconnectStrava } from '../hooks/useTrainingSessions'
import { buildStravaOAuthUrl, exchangeStravaCode } from '../api/stravaApi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'

export function StravaWidget() {
  const { data: status, isLoading } = useStravaStatus()
  const sync        = useSyncStrava()
  const disconnect  = useDisconnectStrava()
  const qc          = useQueryClient()
  const [connecting, setConnecting] = useState(false)

  // Handle OAuth redirect — Strava sends ?code= after the user approves
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const scope  = params.get('scope')
    if (!code || !scope) return

    // Clear query params from URL immediately
    const clean = window.location.pathname + window.location.hash.replace(/\?.*$/, '')
    window.history.replaceState({}, '', clean)

    setConnecting(true)
    const loadingId = toast.loading('Connecting to Strava…')

    exchangeStravaCode(code)
      .then(result => {
        toast.dismiss(loadingId)
        toast.success(`Connected as ${result.athlete_name ?? 'Strava athlete'} ✓`)
        qc.invalidateQueries({ queryKey: ['training'] })
      })
      .catch(err => {
        toast.dismiss(loadingId)
        toast.error(`Strava connection failed: ${err.message ?? 'Unknown error'}`)
      })
      .finally(() => setConnecting(false))
  }, [qc])

  function handleSync() {
    const id = toast.loading('Syncing Strava activities…')
    sync.mutate(undefined, {
      onSuccess: (data) => {
        toast.dismiss(id)
        toast.success(`Synced ${data.synced} activities from Strava`)
      },
      onError: (err: Error) => {
        toast.dismiss(id)
        toast.error(`Sync failed: ${err.message}`)
      },
    })
  }

  function handleDisconnect() {
    const id = toast.loading('Disconnecting Strava…')
    disconnect.mutate(undefined, {
      onSuccess: () => {
        toast.dismiss(id)
        toast.success('Strava disconnected')
      },
      onError: () => {
        toast.dismiss(id)
        toast.error('Failed to disconnect Strava')
      },
    })
  }

  if (isLoading || connecting) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ink-100 bg-white text-xs text-ink-500">
        <span className="animate-spin">↻</span>
        {connecting ? 'Connecting to Strava…' : 'Loading…'}
      </div>
    )
  }

  if (!status?.connected) {
    return (
      <a
        href={buildStravaOAuthUrl()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-sm font-medium hover:bg-[#e04400] transition-colors duration-150"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        Connect Strava
      </a>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#FC4C02]/30 bg-[#FC4C02]/5">
      {status.athlete_avatar && (
        <img
          src={status.athlete_avatar}
          alt={status.athlete_name ?? ''}
          className="w-7 h-7 rounded-full object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-800 truncate">{status.athlete_name}</p>
        <p className="text-[10px] text-[#FC4C02] font-medium">● Strava connected</p>
      </div>
      <div className="flex gap-1.5 ml-auto flex-shrink-0">
        <button
          onClick={handleSync}
          disabled={sync.isPending}
          className="text-xs px-2.5 py-1 rounded bg-white border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors duration-150"
        >
          {sync.isPending ? '…' : '↻ Sync'}
        </button>
        <button
          onClick={handleDisconnect}
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
