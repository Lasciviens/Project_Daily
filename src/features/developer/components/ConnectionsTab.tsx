import { useState, useEffect, type ReactNode } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import { exchangeCalendarCode, disconnectCalendar } from '../../calendar/api/calendarApi'
import { GoogleTasksSyncButtons } from '../../todo/components/GoogleTasksSyncButtons'
import { StravaWidget } from '../../training/components/StravaWidget'
import { useStravaStatus } from '../../training/hooks/useTrainingSessions'
import { usePsnStatus, useDisconnectPsn, usePsnProfile } from '../../games/hooks/usePlayStation'
import { PsnNpssoForm } from '../../games/components/PsnNpssoForm'
import { isPsnReauthRequired } from '../../games/api/psnApi'
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

const DOT: Record<Status, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-ink-300',
  expired: 'bg-amber-500',
  unknown: 'bg-amber-400',
}
const STATUS_TEXT: Record<Status, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  expired: 'Session expired',
  unknown: 'Checking…',
}

function ConnectionCard({ icon, name, scope, status, statusNote, children, footer }: {
  icon: string
  name: string
  /** What this connection actually gives the app. */
  scope: string
  status: Status
  statusNote?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900">{icon} {name}</p>
          <p className="text-xs text-ink-400 mt-0.5">{scope}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${DOT[status]}`} />
          <span className="text-xs text-ink-600">{statusNote ?? STATUS_TEXT[status]}</span>
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {footer && <p className="text-[11px] text-ink-400 mt-2 leading-snug">{footer}</p>}
    </div>
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
        const { access_token, expires_in } = await exchangeCalendarCode(supabase, code)
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
    try { await disconnectCalendar(supabase) } catch { /* server cleanup is best-effort */ }
    setBusy(false)
  }

  return (
    <ConnectionCard icon="🗓" name="Google" scope="Calendar · Tasks — one consent, one refresh token"
      status={connected ? 'connected' : 'disconnected'}>
      <div className="flex items-center gap-2 flex-wrap">
        {connected ? (
          <button onClick={handleDisconnect} disabled={busy}
            className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50">
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button onClick={() => { setError(null); login() }} disabled={busy}
            className="min-h-[44px] px-4 text-sm font-semibold rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-50">
            {busy ? 'Connecting…' : 'Connect Google'}
          </button>
        )}
        {connected && <GoogleTasksSyncButtons />}
      </div>
      {error && <p className="text-xs text-red-500 mt-2 leading-snug">{error}</p>}
    </ConnectionCard>
  )
}

function StravaCard() {
  const { data: status, isLoading } = useStravaStatus()
  return (
    <ConnectionCard icon="🏃" name="Strava" scope="Activities (runs, rides, walks)"
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

  return (
    <ConnectionCard icon="🎮" name="PlayStation" scope="Playtime library · trophies · PS Plus provenance"
      status={status.isLoading ? 'unknown' : connected ? 'connected' : expired ? 'expired' : 'disconnected'}
      footer="Sony has no official API, so this uses the community npsso token flow. Sony's login now has a reCAPTCHA that blocks scripted refresh — expect to paste a fresh token every month or two.">
      {connected ? (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
            className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-40">
            Disconnect
          </button>
          {status.data?.connectedAt && (
            <span className="text-xs text-ink-400">
              since {new Date(status.data.connectedAt).toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
      ) : (
        <div>
          {expired && (
            <p className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 mb-2">
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
    <ConnectionCard icon="🖥" name="Steam" scope="Owned games · playtime · achievements"
      status={profile.isLoading ? 'unknown' : notConfigured ? 'disconnected' : profile.data ? 'connected' : 'unknown'}
      statusNote={notConfigured ? 'Not configured' : undefined}
      footer={notConfigured
        ? 'Add STEAM_API_KEY and STEAM_ID64 to Supabase Vault, then deploy the steam-api function. No browser sign-in is involved.'
        : 'Configured server-side in Supabase Vault — nothing to connect or revoke from here.'}>
      {profile.data?.personaname && (
        <p className="text-sm text-ink-700">Signed in as <strong>{profile.data.personaname}</strong></p>
      )}
    </ConnectionCard>
  )
}

function ServerSideCard({ icon, name, scope, note }: { icon: string; name: string; scope: string; note: string }) {
  return <ConnectionCard icon={icon} name={name} scope={scope} status="connected" statusNote="Server-side" footer={note} />
}

export function ConnectionsTab() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <p className="text-xs text-ink-400 leading-snug">
        Every external integration lives here. Feature pages show the data; they never carry
        their own connect or disconnect control.
      </p>

      <GoogleCard />
      <StravaCard />
      <PlayStationCard />
      <SteamCard />

      <ServerSideCard icon="🏋️" name="Hevy" scope="Workouts · routines · body measurements"
        note="Authenticated by HEVY_API_KEY in Supabase Vault, plus a webhook for new workouts. Sync is triggered from the Training page." />
      <ServerSideCard icon="❤️" name="Apple Health" scope="Metrics · workouts, via Health Auto Export"
        note="The phone pushes to the health-export-webhook function with a bearer secret. Nothing to connect here — check the Health Auto Export app on the phone if data stops arriving." />
    </div>
  )
}
