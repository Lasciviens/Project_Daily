import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, TonePill, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useSubscriptions } from '../hooks/useSubscriptions'
import {
  formatDayGB, formatMoney, monthlyTotals, needsAttention, nextRenewal, otherSubscriptions,
  priceLabel, renewalState, serviceLabel, subscriptionsFor, type ServiceSubscription,
} from '../subscriptionRules'
import { SubscriptionSheet } from './SubscriptionSheet'

// Subscriptions shown with the connection cards (Settings → Integrations):
// a summary strip, each card's own subscriptions, and the ones for services
// without a card. The sheet is mounted only while open, so each open starts
// from the row it edits.

type Editing = { sub: ServiceSubscription | null; service?: string } | null

function useEditor() {
  const [editing, setEditing] = useState<Editing>(null)
  const sheet = editing && (
    <SubscriptionSheet open sub={editing.sub} service={editing.service} onClose={() => setEditing(null)} />
  )
  return { sheet, edit: setEditing }
}

function SubscriptionRow({ sub, today, onEdit, showService }: {
  sub: ServiceSubscription; today: string; onEdit: () => void; showService?: boolean
}) {
  const renew = renewalState(sub.renews_on, today)
  const price = priceLabel(sub)
  const title = [showService ? serviceLabel(sub.service) : null, sub.plan ?? sub.name].filter(Boolean).join(' · ') || serviceLabel(sub.service)
  return (
    <li>
      <button type="button" onClick={onEdit} className="row row-interactive w-full flex-col items-start gap-1 text-left">
        <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{title}</Truncate>
          <TonePill tone={needsAttention(sub, today) ? 'warn' : sub.requirement === 'required' ? 'info' : 'neutral'}>
            {sub.requirement === 'required' ? 'Required for this integration' : 'Info only'}
          </TonePill>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-fg-muted">
          {price && <span className="tabular-nums">{price}</span>}
          {sub.account && <span className="break-all">{sub.account}</span>}
          {!sub.active && <span>Inactive</span>}
          {sub.renews_on && (
            <span className={renew.state === 'past' ? 'text-danger' : renew.state === 'soon' ? 'text-warn' : undefined}>
              {renew.state === 'past' ? 'Renewal passed' : 'Renews'} {formatDayGB(sub.renews_on)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/** A connection card's own subscriptions + an Add button. */
export function CardSubscriptions({ service }: { service: string }) {
  const { data = [] } = useSubscriptions()
  const { sheet, edit } = useEditor()
  const today = todayStr()
  const mine = subscriptionsFor(data, service)
  return (
    <div className="mt-3 border-t border-line pt-2">
      {mine.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {mine.map(s => <SubscriptionRow key={s.id} sub={s} today={today} onEdit={() => edit({ sub: s })} />)}
        </ul>
      )}
      <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => edit({ sub: null, service })}>
        {mine.length ? 'Add another subscription' : 'Add subscription'}
      </Button>
      {sheet}
    </div>
  )
}

/** Monthly total (per currency) and the next renewal, over every active subscription. */
export function SubscriptionSummary() {
  const { data = [], isLoading } = useSubscriptions()
  const { sheet, edit } = useEditor()
  const today = todayStr()
  const totals = monthlyTotals(data)
  const next = nextRenewal(data, today)
  const attention = data.filter(s => needsAttention(s, today)).length
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <p className="text-micro text-fg-faint">Subscriptions · per month</p>
        <p className="text-lead font-semibold tabular-nums text-fg">
          {isLoading ? '…' : totals.length ? totals.map(t => formatMoney(t.amount, t.currency)).join(' + ') : '0 NOK'}
        </p>
      </div>
      <div>
        <p className="text-micro text-fg-faint">Next renewal</p>
        <p className="text-body font-medium text-fg-2">
          {next ? `${serviceLabel(next.service)} · ${formatDayGB(next.renews_on!)}` : 'None scheduled'}
        </p>
      </div>
      {attention > 0 && <TonePill tone="warn">{attention} required {attention === 1 ? 'subscription needs' : 'subscriptions need'} attention</TonePill>}
      <Button size="sm" className="ml-auto" icon={<Plus />} onClick={() => edit({ sub: null })}>Add subscription</Button>
      {sheet}
    </Card>
  )
}

/** Subscriptions for services without a connection card. */
export function OtherSubscriptions({ cardKeys }: { cardKeys: readonly string[] }) {
  const { data = [] } = useSubscriptions()
  const { sheet, edit } = useEditor()
  const today = todayStr()
  const other = otherSubscriptions(data, cardKeys)
  return (
    <section aria-label="Other subscriptions">
      <h2 className="section-label mb-2">Other subscriptions</h2>
      <Card>
        {other.length === 0
          ? <p className="text-meta text-fg-muted">Services without an integration here (ScreenScraper, Supabase, Gemini…) are listed once you add one.</p>
          : <ul className="space-y-0.5">{other.map(s => <SubscriptionRow key={s.id} sub={s} today={today} showService onEdit={() => edit({ sub: s })} />)}</ul>}
        <Button size="sm" variant="ghost" className="mt-1" icon={<Plus />} onClick={() => edit({ sub: null })}>Add subscription</Button>
      </Card>
      {sheet}
    </section>
  )
}
