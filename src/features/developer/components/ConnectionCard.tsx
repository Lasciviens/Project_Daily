import type { ReactNode } from 'react'
import { Card, ToneDot, TonePill, type Tone } from '../../../shared/ui'
import { CardSubscriptions } from '../../settings/components/SubscriptionBits'

// One integration's card on Settings → Subscriptions (ConnectionsTab).

// 'expired' is its own state, distinct from both: a credential IS stored, so
// "Not connected" would be wrong, but the provider no longer honours it, so
// "Connected" is a lie. 'expiring' = still works, renew soon. Only the
// integrations whose credential the provider can revoke behind our back
// (PlayStation today) ever report either.
export type Status = 'connected' | 'expiring' | 'disconnected' | 'expired' | 'unknown'

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

export function ConnectionCard({ icon, name, kind, description, status, statusNote, details, children, footer, service, account }: {
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
