import { useEffect } from 'react'
import { RefreshCw, Unplug } from 'lucide-react'
import { useStravaStatus, useSyncStrava, useDisconnectStrava, useConnectStrava } from '../hooks/useTrainingSessions'
import { buildStravaOAuthUrl } from '../api/stravaApi'
import { Button, IconButton } from '../../../shared/ui'
import { STRAVA_ORANGE } from '../stravaMeta'
import { StravaLogo } from './StravaIcons'

export function StravaWidget() {
  const { data: status, isLoading } = useStravaStatus()
  const sync       = useSyncStrava()
  const disconnect = useDisconnectStrava()
  const connect    = useConnectStrava()
  const connectWithCode = connect.mutate

  // Handle OAuth redirect — HashRouter puts Strava's ?code= inside the hash:
  // e.g. /#/training?code=abc&scope=...  → parsed from window.location.hash
  useEffect(() => {
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : ''
    const params = new URLSearchParams(hashQuery)
    const code   = params.get('code')
    const scope  = params.get('scope')
    if (!code || !scope) return

    // Strip the query string from the hash without a reload
    const cleanHash = window.location.hash.split('?')[0]
    window.history.replaceState({}, '', window.location.pathname + cleanHash)
    connectWithCode(code)
  }, [connectWithCode])

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
