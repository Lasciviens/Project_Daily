import { useState, useEffect, type ReactNode } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../../app/store'
import { CalendarDays, Bike, Gamepad2, Monitor, Dumbbell, HeartPulse, RefreshCw, Unplug } from 'lucide-react'
import { exchangeGoogleCode, disconnectGoogle } from '../api/connectionsApi'
import { Button, Card, PageBoard, ToneDot, TonePill, type Tone } from '../../../shared/ui'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import { useHevySyncState } from '../../training/hooks/useHevySync'
import { useLatestHealthValue } from '../../health/hooks/useHealthExport'
import { GoogleTasksSyncButtons } from '../../todo/components/GoogleTasksSyncButtons'
import { StravaWidget } from '../../training/components/StravaWidget'
import { useStravaStatus } from '../../training/hooks/useTrainingSessions'
import { usePsnStatus, useDisconnectPsn, usePsnProfile } from '../../games/hooks/usePlayStation'
import { PsnNpssoForm } from '../../games/components/PsnNpssoForm'
import { isPsnReauthRequired } from '../../games/api/psnApi'
import { npssoLifetime, npssoLifetimeLabel } from '../../games/api/psnTokenLifetime'
import { useSteamProfile } from '../../games/hooks/useSteam'
import { GOOGLE_SCOPES } from '../../calendar/googleScopes'
import { CONNECTIONS_BOARD, type ConnectionSection } from '../developerBoards'
import { CardSubscriptions, OtherSubscriptions, SubscriptionSummary } from '../../settings/components/SubscriptionBits'

// ─────────────────────────────────────────────────────────────────────────────
//  CONNECTIONS (Settings → Integrations) — the ONE place every external integration is connected,
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
// "Connected" is a lie. 'expiring' = still works, renew soon. Only the
// integrations whose credential the provider can revoke behind our back
// (PlayStation today) ever report either.
type Status = 'connected' | 'expiring' | 'disconnected' | 'expired' | 'unknown'

const STATUS_TONE: Record<Status, Tone> = {
  connected: 'success',
  expiring: 'warn',
  disconnected: 'neutral',
  expired: 'danger',
  unknown: 'neutral',
}
const STATUS_TEXT: Record<Status, string> = {
  connected: 'Connected',
  expiring: 'Expiring soon',
  disconnected: 'Not connected',
  expired: 'Expired',
  unknown: 'Checking…',
}

// How the app reaches the service, in plain words. `user` = you sign in (or
// paste a token) here; `server` = a key set up once on the server, nothing
// to sign in to.
type Kind = 'user' | 'server'
const KIND_TEXT: Record<Kind, string> = { user: 'Signed in by you', server: 'Set up on the server (API key)' }
const KIND_HINT: Record<Kind, string> = {
  user: 'You connect and disconnect this yourself, from this page.',
  server: 'Uses a key stored on the server (Supabase Vault). There is nothing to sign in to or revoke here.',
}

function ConnectionCard({ icon, name, kind, description, status, statusNote, details, children, footer, service, account }: {
  icon: ReactNode
  /** service_subscriptions key whose subscriptions are listed on this card. */
  service: string
  /** Signed-in username/email, when the status call already returns it. */
  account?: string | null
  name: string
  kind: Kind
  /** One plain sentence: what this integration does for the user. */
  description: string
  status: Status
  statusNote?: string
  /** Short facts already known (last sync, since…), shown in one muted line. */
  details?: (string | null | undefined | false)[]
  children?: ReactNode
  footer?: ReactNode
}) {
  const facts = [account ? `Account: ${account}` : null, ...(details ?? [])].filter(Boolean) as string[]
  return (
    <Card>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-2 [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-lead font-semibold text-fg">{name}</p>
            <TonePill tone={STATUS_TONE[status]}>
              <ToneDot tone={STATUS_TONE[status]} />
              {statusNote ?? STATUS_TEXT[status]}
            </TonePill>
          </div>
          <p className="mt-1 text-meta text-fg-2">{description}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-fg-muted">
            <span title={KIND_HINT[kind]} data-tone={kind === 'user' ? 'info' : 'neutral'} className="inline-flex items-center gap-1">
              <ToneDot tone={kind === 'user' ? 'info' : 'neutral'} />
              {KIND_TEXT[kind]}
            </span>
            {facts.map(f => <span key={f} className="break-all">· {f}</span>)}
          </p>
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {footer && <p className="mt-3 text-meta text-fg-muted">{footer}</p>}
      <CardSubscriptions service={service} />
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
    <ConnectionCard service="google" kind="user" icon={<CalendarDays />} name="Google"
      description="Shows your Google Calendar events in Daily and keeps your tasks in step with Google Tasks — one sign-in covers both."
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
    <ConnectionCard service="strava" kind="user" account={status?.athlete_name} icon={<Bike />} name="Strava"
      description="Imports your runs, rides and walks into Training."
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

  const npssoExpired = connected && life.state === 'expired'
  const psnStatus: Status = status.isLoading ? 'unknown'
    : expired || npssoExpired ? 'expired'
    : connected ? (life.state === 'soon' ? 'expiring' : 'connected')
    : 'disconnected'
  const expiryDate = status.data?.npssoExpiresAt ? formatDate(status.data.npssoExpiresAt) : null

  return (
    <ConnectionCard service="playstation" kind="user" account={profile.data?.profile?.onlineId} icon={<Gamepad2 />} name="PlayStation"
      description="Imports your PlayStation playtime, trophies and PS Plus games into Games."
      status={psnStatus}
      details={[status.data?.connectedAt && `Connected since ${formatDate(status.data.connectedAt)}`]}
      footer="Sony has no official API, so this uses a sign-in token (npsso) you paste from your browser. Sony's login blocks automatic renewal, so expect to paste a fresh one every month or two.">
      {connected ? (
        <div className="flex flex-col gap-2">
          {/* The npsso's own deadline: renewing is a manual, desktop-browser
              chore, so the date lets the user do it when they choose. */}
          {expiryDate && lifeLabel ? (
            <p className={`text-meta tabular-nums ${life.state === 'soon' || life.state === 'expired' ? 'font-semibold text-warn' : 'text-fg-2'}`}>
              {life.state === 'expired'
                ? `Token expired on ${expiryDate}`
                : <>Token expires <strong>{expiryDate}</strong> · in {lifeLabel}</>}
            </p>
          ) : (
            // A bare-token paste (or a row from before migration 101) has
            // no expiry to show. Say so plainly rather than implying the
            // token is fine, and say how to get the countdown back.
            <p className="text-meta text-fg-muted">
              Token expiry unknown — the current token was pasted without its expiry date. When you renew,
              paste Sony's whole ssocookie response and the app will count down to it.
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" icon={<Unplug />} onClick={() => disconnect.mutate()} loading={disconnect.isPending}>Disconnect</Button>
            {/* Renewing EARLY is the whole point of tracking the expiry — the
                old token is simply replaced, so there is never a reason to
                wait for it to die first. */}
            {!showForm && (
              <Button size="sm" icon={<RefreshCw />} onClick={() => setRenewing(true)}>Renew token</Button>
            )}
          </div>
          {showForm && (
            <div className="rounded-row border border-line bg-surface-2 p-3">
              {life.state === 'soon' && (
                <p className="mb-2 text-meta text-warn">
                  The token expires in {lifeLabel}. Renew it now — the old one is replaced and nothing
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
            <p className="mb-2 rounded-row border border-danger/30 bg-danger-soft px-3 py-2 text-meta text-danger">
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
    <ConnectionCard service="steam" kind="server" icon={<Monitor />} name="Steam" account={profile.data?.personaname}
      description="Imports your Steam library, playtime and achievements into Games."
      status={profile.isLoading ? 'unknown' : notConfigured ? 'disconnected' : profile.data ? 'connected' : 'unknown'}
      statusNote={notConfigured ? 'Not set up' : !profile.isLoading && !profile.data ? 'Not checked' : undefined}
      footer={notConfigured
        ? 'Needs a Steam API key and your Steam ID on the server (STEAM_API_KEY and STEAM_ID64 in Supabase Vault), then the steam-api function deployed. No browser sign-in is involved.'
        : undefined} />
  )
}

function HevyCard() {
  const sync = useHevySyncState()
  const last = sync.data?.last_events_since ?? null
  return (
    <ConnectionCard service="hevy" kind="server" icon={<Dumbbell />} name="Hevy"
      description="Imports your workouts, routines and body measurements from Hevy on every sync."
      status={sync.isLoading ? 'unknown' : last ? 'connected' : 'disconnected'}
      statusNote={!sync.isLoading && !last ? 'Never synced' : undefined}
      details={[last && `Last sync ${formatDateTime(last)}`]}
      footer="New workouts arrive by themselves through a webhook; press Sync on the Training page to fetch edits and routines." />
  )
}

function AppleHealthCard() {
  const latest = useLatestHealthValue('step_count')
  const date = latest.data?.date ?? null
  return (
    <ConnectionCard service="apple_health" kind="server" icon={<HeartPulse />} name="Apple Health"
      description="Receives your sleep, steps, heart and workout data from the Health Auto Export app on your phone."
      status={latest.isLoading ? 'unknown' : date ? 'connected' : 'disconnected'}
      statusNote={!latest.isLoading && !date ? 'No data yet' : undefined}
      details={[date && `Latest data ${formatDate(date)}`]}
      footer="Your phone sends the data — there is nothing to sign in to here. If data stops arriving, open Health Auto Export on the phone." />
  )
}

/** service_subscriptions keys that have a card here; the rest go under "Other subscriptions". */
const CARD_SERVICES = ['google', 'strava', 'playstation', 'steam', 'hevy', 'apple_health'] as const

const ACCOUNTS_LABEL = 'Signed in by you'
const SERVER_LABEL = 'Set up on the server'

export function ConnectionsTab() {
  const google = <GoogleCard />
  const strava = <StravaCard />
  const psn = <PlayStationCard />
  const steam = <SteamCard />
  const hevy = <HevyCard />
  const health = <AppleHealthCard />
  // Each step mounts a card once: on its own, or (server-side, from 1920)
  // inside the serverCards grid.
  const sections: Record<ConnectionSection, ReactNode> = {
    intro: (
      <div className="flex flex-col gap-3">
        <p className="text-meta text-fg-muted">
          Every service the app talks to, in one place. “Signed in by you” ones you connect here;
          “Set up on the server” ones use a key stored on the server and need nothing from you.
        </p>
        <SubscriptionSummary />
      </div>
    ),
    otherSubs: <OtherSubscriptions cardKeys={CARD_SERVICES} />,
    google, strava, psn, steam, hevy, health,
    accountsLabel: <h2 className="section-label">{ACCOUNTS_LABEL}</h2>,
    serverLabel: <h2 className="section-label">{SERVER_LABEL}</h2>,
    // Three short read-only cards of about the same height, so a row grid
    // is safe here (W2 card columns, 19–22rem).
    serverCards: (
      <section aria-label={SERVER_LABEL} className="grid grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] items-start gap-4">
        {steam}{hevy}{health}
      </section>
    ),
  }
  // Which card goes where at each width: developerBoards.ts. The one-column
  // list keeps its 42rem cap on tablets.
  return <PageBoard sections={sections} layout={CONNECTIONS_BOARD} stackGap="gap-3" stackClassName="max-w-2xl" />
}
