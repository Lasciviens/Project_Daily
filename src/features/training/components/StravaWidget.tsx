import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Unplug } from 'lucide-react'
import { useStravaStatus, useSyncStrava, useDisconnectStrava, useConnectStrava } from '../hooks/useTrainingSessions'
import { buildStravaOAuthUrl } from '../api/stravaApi'
import { Button, IconButton } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { STRAVA_CALLBACK_KEYS, STRAVA_ORANGE, parseStravaCallback } from '../stravaMeta'
import { StravaLogo } from './StravaIcons'

export function StravaWidget() {
  const { data: status, isLoading } = useStravaStatus()
  const sync       = useSyncStrava()
  const disconnect = useDisconnectStrava()
  const connect    = useConnectStrava()
  const connectWithCode = connect.mutate
  const [, setSearchParams] = useSearchParams()
  // StrictMode runs effects twice; a Strava code can be exchanged only once.
  const handledRef = useRef(false)

  // Finish the OAuth redirect. Strava sends the user back to
  // #/developer?tab=connections (stravaApi's REDIRECT_URI — this widget only
  // renders on that tab, so the redirect and the exchange live together).
  useEffect(() => {
    if (handledRef.current) return
    const callback = parseStravaCallback(window.location.search, window.location.hash)
    if (!callback) return
    handledRef.current = true

    // Drop Strava's params without a reload: first a real query Strava may
    // have put before the hash, then the hash query (keeping ?tab=).
    if (window.location.search) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash)
    }
    setSearchParams(p => {
      for (const k of STRAVA_CALLBACK_KEYS) p.delete(k)
      return p
    }, { replace: true })

    if (callback.error) {
      toast.warning(callback.error === 'access_denied' ? 'Strava connection cancelled' : `Strava connection failed: ${callback.error}`)
      return
    }
    if (callback.code) connectWithCode(callback.code)
  }, [connectWithCode, setSearchParams])

  if (isLoading || connect.isPending) {
    return (
      <div className="card flex min-h-[44px] items-center gap-2 px-3 py-2 text-meta text-fg-muted">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {connect.isPending ? 'Connecting to Strava…' : 'Loading…'}
      </div>
    )
  }

  if (!status?.connected) {
    return (
      <a
        href={buildStravaOAuthUrl()}
        style={{ backgroundColor: STRAVA_ORANGE }}
        className="btn border border-transparent text-white hover:brightness-95"
      >
        <StravaLogo />
        Connect Strava
      </a>
    )
  }

  return (
    <div className="card flex items-center gap-3 py-2 pl-3 pr-1">
      {status.athlete_avatar && (
        <img src={status.athlete_avatar} alt={status.athlete_name ?? ''} className="h-7 w-7 shrink-0 rounded-full object-cover" />
      )}
      <div className="min-w-0">
        <p className="truncate text-body font-semibold text-fg">{status.athlete_name}</p>
        <p className="flex items-center gap-1 text-micro font-medium" style={{ color: STRAVA_ORANGE }}>
          <StravaLogo size={10} /> Strava connected
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="sm" icon={<RefreshCw />} loading={sync.isPending} onClick={() => sync.mutate()}>Sync</Button>
        <IconButton
          label="Disconnect Strava"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="text-fg-faint hover:!bg-danger-soft hover:!text-danger"
        >
          <Unplug />
        </IconButton>
      </div>
    </div>
  )
}
