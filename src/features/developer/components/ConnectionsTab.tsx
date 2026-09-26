import { useState, useEffect, type ReactNode } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../../app/store'
import { CalendarDays, Bike, Gamepad2, Monitor, Dumbbell, HeartPulse, RefreshCw, Unplug } from 'lucide-react'
import { exchangeGoogleCode, disconnectGoogle } from '../api/connectionsApi'
import { Button, Card, ToneDot, type Tone } from '../../../shared/ui'
import { GoogleTasksSyncButtons } from '../../todo/components/GoogleTasksSyncButtons'
import { StravaWidget } from '../../training/components/StravaWidget'
import { useStravaStatus } from '../../training/hooks/useTrainingSessions'
import { usePsnStatus, useDisconnectPsn, usePsnProfile } from '../../games/hooks/usePlayStation'
import { PsnNpssoForm } from '../../games/components/PsnNpssoForm'
import { isPsnReauthRequired } from '../../games/api/psnApi'
import { npssoLifetime, npssoLifetimeLabel } from '../../games/api/psnTokenLifetime'
import { useSteamProfile } from '../../games/hooks/useSteam'
import { GOOGLE_SCOPES } from '../../calendar/googleScopes'

// ─────────────────────────────────────────────────────────────────────────────
//  CONNECTIONS — the ONE place every external integration is connected,
//  disconnected and inspected. Before this, the same job was scattered across
//  three unrelated surfaces (Google in the ⚙ Settings menu, Strava inside the
//  Training tab, PlayStation inside the Games tab), so "is X connected?" had
//  no single answer and a reconnect meant remembering which page owned it.
//
//  Rule for anything added later: a feature page shows DATA, never the
//  connect/disconnect control. It may link here; it must not duplicate this.
//
//  Two kinds of integration live side by side and are labelled differently:
//    · user-authorized (Google, Strava, PlayStation) — a real per-user token,
//      connected and revoked from here;
//    · server-configured (Steam, Hevy, Apple Health) — a single-user secret in
//      Supabase Vault with no browser consent step at all, so the card is a
//      read-only status readout, never a button that pretends to connect.
// ─────────────────────────────────────────────────────────────────────────────

// 'expired' is its own state, distinct from both: a credential IS stored, so
// "Not connected" would be wrong, but the provider no longer honours it, so
// "Connected" is a lie. Only the integrations whose credential the provider
// can revoke behind our back (PlayStation today) ever report it.
type Status = 'connected' | 'disconnected' | 'expired' | 'unknown'

const STATUS_TONE: Record<Status, Tone> = {
  connected: 'success',
  disconnected: 'neutral',
  expired: 'warn',
  unknown: 'neutral',
}
const STATUS_TEXT: Record<Status, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  expired: 'Session expired',
  unknown: 'Checking…',
}

function ConnectionCard({ icon, name, scope, status, statusNote, children, footer }: {
  icon: ReactNode
  name: string
  /** What this connection actually gives the app. */
  scope: string
  status: Status
  statusNote?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-2 [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
          <div className="min-w-0">
            <p className="text-lead font-semibold text-fg">{name}</p>
            <p className="mt-0.5 text-meta text-fg-muted">{scope}</p>
          </div>
        </div>
        <span data-tone={STATUS_TONE[status]} className="flex shrink-0 items-center gap-2">
          <ToneDot tone={STATUS_TONE[status]} />
          <span className="text-meta font-medium text-fg-2">{statusNote ?? STATUS_TEXT[status]}</span>
        </span>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {footer && <p className="mt-3 text-meta text-fg-muted">{footer}</p>}
    </Card>
  )
}

function GoogleCard() {
  const { accessToken, expiresAt, setAccessToken } = useCalendarStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `Date.now()` is impure, so it can't be read during render (it would also
  // go stale — nothing re-renders this card when a token simply expires).
  // A tick recomputes it on a timer instead.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const connected = !!accessToken && (!expiresAt || now < expiresAt - 60_000)

  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: GOOGLE_SCOPES.join(' '),
    ux_mode: 'popup',
    onSuccess: async ({ code }) => {
      setBusy(true); setError(null)
      try {
        const { access_token, expires_in } = await exchangeGoogleCode(code)
        setAccessToken(access_token, expires_in)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Connection failed'
        setError(msg === 'no_refresh_token' ? 'Please reconnect and allow access again.' : msg)
      } finally { setBusy(false) }
    },
    onError: () => setError('Sign-in was cancelled or failed'),
  })

  async function handleDisconnect() {
    setBusy(true)
    setAccessToken(null)   // clear immediately so the UI reacts at once
    try { await disconnectGoogle() } catch { /* server cleanup is best-effort */ }
    setBusy(false)
  }

  return (
    <ConnectionCard icon={<CalendarDays />} name="Google" scope="Calendar · Tasks — one consent, one refresh token"
      status={connected ? 'connected' : 'disconnected'}>
      <div className="flex items-center gap-2 flex-wrap">
        {connected ? (
          <Button size="sm" icon={<Unplug />} onClick={handleDisconnect} loading={busy}>Disconnect</Button>
        ) : (
          <Button variant="primary" onClick={() => { setError(null); login() }} loading={busy}>Connect Google</Button>
        )}
        {connected && <GoogleTasksSyncButtons />}
      </div>
      {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
    </ConnectionCard>
  )
}

function StravaCard() {
  const { data: status, isLoading } = useStravaStatus()
  return (
    <ConnectionCard icon={<Bike />} name="Strava" scope="Activities (runs, rides, walks)"
      status={isLoading ? 'unknown' : status?.connected ? 'connected' : 'disconnected'}>
      {/* The widget owns the OAuth redirect handling, sync and disconnect —
          reused whole rather than reimplemented, so there is still one
          Strava code path, just one home for it. */}
      <StravaWidget />
    </ConnectionCard>
  )
}

function PlayStationCard() {
  const status = usePsnStatus()
  const disconnect = useDisconnectPsn()
  // `status` only proves a psn_tokens ROW exists — it never asked Sony whether
  // that session still works. A dead one therefore read as "connected" here
  // and offered nothing but Disconnect, so the one action the user actually
  // needed (paste a fresh token) was unreachable from the page that owns
  // connections. The profile query is the first call that touches Sony, so it
  // is what distinguishes a live session from a stored one.
  const hasRow = !!status.data?.connected
  const profile = usePsnProfile(hasRow)
  const expired = isPsnReauthRequired(profile.error)
  const connected = hasRow && !expired
  // The npsso's own countdown. Renewing is a manual, desktop-browser-only
  // chore, so the point of showing it is to let the user do it at a moment
  // they choose rather than the moment Sony picks.
  const life = npssoLifetime(status.data?.npssoExpiresAt)
  const lifeLabel = npssoLifetimeLabel(life)
  const [renewing, setRenewing] = useState(false)
  const showForm = !connected || renewing || life.state === 'soon'

  return (
    <ConnectionCard icon={<Gamepad2 />} name="PlayStation" scope="Playtime library · trophies · PS Plus provenance"
      status={status.isLoading ? 'unknown' : connected ? 'connected' : expired ? 'expired' : 'disconnected'}
      footer="Sony has no official API, so this uses the community npsso token flow. Sony's login now has a reCAPTCHA that blocks scripted refresh — expect to paste a fresh token every month or two.">
      {connected ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" icon={<Unplug />} onClick={() => disconnect.mutate()} loading={disconnect.isPending}>Disconnect</Button>
            {/* Renewing EARLY is the whole point of tracking the expiry — the
                old token is simply replaced, so there is never a reason to
                wait for it to die first. */}
            {!showForm && (
              <Button size="sm" icon={<RefreshCw />} onClick={() => setRenewing(true)}>Renew token</Button>
            )}
            {status.data?.connectedAt && (
              <span className="text-meta tabular-nums text-fg-muted">
                since {new Date(status.data.connectedAt).toLocaleDateString('en-GB')}
              </span>
            )}
            {lifeLabel && (
              <span className={`text-meta font-semibold tabular-nums ${life.state === 'soon' ? 'text-warn' : 'text-fg-muted'}`}>
                PSN token expires in {lifeLabel}
              </span>
            )}
            {/* A row written before migration 101, or a bare-token paste,
                has no expiry to show. Say so plainly rather than implying
                the token is fine. */}
            {!lifeLabel && (
              <span className="text-meta text-fg-faint" title="Paste the full ssocookie response next time and the app can count down to the expiry.">
                token expiry unknown
              </span>
            )}
          </div>
          {showForm && (
            <div className="rounded-row border border-line bg-surface-2 p-3">
              {life.state === 'soon' && (
                <p className="mb-2 text-meta text-warn">
                  PSN token expires in {lifeLabel}. Renew it now — the old one is replaced and nothing
                  else changes.
                </p>
              )}
              <PsnNpssoForm onConnected={() => setRenewing(false)} />
            </div>
          )}
        </div>
      ) : (
        <div>
          {expired && (
            <p className="mb-2 rounded-row border border-warn/30 bg-warn-soft px-3 py-2 text-meta text-warn">
              Sony stopped accepting the stored session
              {profile.error instanceof Error && profile.error.message ? ` (“${profile.error.message}”)` : ''}.
              Paste a fresh token to restore it — the old one is replaced, nothing else changes.
            </p>
          )}
          <PsnNpssoForm />
        </div>
      )}
    </ConnectionCard>
  )
}

/**
 * Server-configured integrations. There is no browser consent step for these —
 * the credential is a single-user secret in Supabase Vault — so the card
 * reports what the app can actually see and never offers a fake Connect button.
 */
function SteamCard() {
  const profile = useSteamProfile()
  const notConfigured = (profile.error as Error | null)?.message === 'not_configured'
  return (
    <ConnectionCard icon={<Monitor />} name="Steam" scope="Owned games · playtime · achievements"
      status={profile.isLoading ? 'unknown' : notConfigured ? 'disconnected' : profile.data ? 'connected' : 'unknown'}
      statusNote={notConfigured ? 'Not configured' : undefined}
      footer={notConfigured
        ? 'Add STEAM_API_KEY and STEAM_ID64 to Supabase Vault, then deploy the steam-api function. No browser sign-in is involved.'
        : 'Configured server-side in Supabase Vault — nothing to connect or revoke from here.'}>
      {profile.data?.personaname && (
        <p className="text-body text-fg-2">Signed in as <strong>{profile.data.personaname}</strong></p>
      )}
    </ConnectionCard>
  )
}

function ServerSideCard({ icon, name, scope, note }: { icon: ReactNode; name: string; scope: string; note: string }) {
  return <ConnectionCard icon={icon} name={name} scope={scope} status="connected" statusNote="Server-side" footer={note} />
}

export function ConnectionsTab() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-meta text-fg-muted">
        Every external integration lives here. Feature pages show the data; they never carry
        their own connect or disconnect control.
      </p>

      <GoogleCard />
      <StravaCard />
      <PlayStationCard />
      <SteamCard />

      <ServerSideCard icon={<Dumbbell />} name="Hevy" scope="Workouts · routines · body measurements"
        note="Authenticated by HEVY_API_KEY in Supabase Vault, plus a webhook for new workouts. Sync is triggered from the Training page." />
      <ServerSideCard icon={<HeartPulse />} name="Apple Health" scope="Metrics · workouts, via Health Auto Export"
        note="The phone pushes to the health-export-webhook function with a bearer secret. Nothing to connect here — check the Health Auto Export app on the phone if data stops arriving." />
    </div>
  )
}
