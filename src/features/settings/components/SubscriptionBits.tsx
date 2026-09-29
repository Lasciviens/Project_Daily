import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, TonePill, Truncate } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useSubscriptionRates, useSubscriptions } from '../hooks/useSubscriptions'
import {
  approxLine, equivalents, formatDay, formatMoney, monthlyTotalIn, monthlyTotals, needsAttention, nextRenewal,
  normalizeCurrency, otherSubscriptions, priceLabel, renewalState, serviceLabel, subscriptionsFor,
  SUBSCRIPTION_CURRENCIES, type ServiceSubscription, type UsdRates,
} from '../subscriptionRules'
import { SubscriptionSheet } from './SubscriptionSheet'

const RATES_NOTE = 'Converted with Open Exchange Rates (refreshed hourly). The other currencies are approximate.'

/** The small, muted "≈ 1 234 TRY · 32 USD · 29 EUR" line under a price. */
function ApproxLine({ amount, currency, rates, className }: { amount: number | null; currency: string; rates: UsdRates | null; className?: string }) {
  if (!rates || amount == null || amount <= 0) return null
  const line = approxLine(equivalents(amount, currency, rates))
  if (!line) return null
  return <span title={RATES_NOTE} className={`block text-micro font-normal tabular-nums text-fg-faint ${className ?? ''}`}>{line}</span>
}

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

function SubscriptionRow({ sub, today, onEdit, showService, rates }: {
  sub: ServiceSubscription; today: string; onEdit: () => void; showService?: boolean; rates: UsdRates | null
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
          {price && (
            <span className="flex flex-col tabular-nums">
              <span className="font-medium text-fg-2">{price}</span>
              {sub.billing_cycle !== 'free' && <ApproxLine amount={sub.price} currency={normalizeCurrency(sub.currency)} rates={rates} />}
            </span>
          )}
          {sub.account && <span className="break-all">{sub.account}</span>}
          {!sub.active && <span>Inactive</span>}
          {sub.renews_on && (
            <span className={renew.state === 'past' ? 'text-danger' : renew.state === 'soon' ? 'text-warn' : undefined}>
              {renew.state === 'past' ? 'Renewal passed' : 'Renews'} {formatDay(sub.renews_on)}
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
  const { rates } = useSubscriptionRates(mine.some(s => (s.price ?? 0) > 0))
  return (
    <div className="mt-3 border-t border-line pt-2">
      {mine.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {mine.map(s => <SubscriptionRow key={s.id} sub={s} today={today} rates={rates} onEdit={() => edit({ sub: s })} />)}
        </ul>
      )}
      <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => edit({ sub: null, service })}>
        {mine.length ? 'Add another subscription' : 'Add subscription'}
      </Button>
      {sheet}
    </div>
  )
}

/**
 * Monthly total over every active subscription, converted into one currency
 * (NOK unless picked), with the other currencies small underneath. Without
 * rates it falls back to one total per currency — nothing is dropped.
 */
export function SubscriptionSummary() {
  const { data = [], isLoading } = useSubscriptions()
  const { sheet, edit } = useEditor()
  const [target, setTarget] = useState<string>('NOK')
  const today = todayStr()
  const perCurrency = monthlyTotals(data)
  const { rates, date, failed } = useSubscriptionRates(perCurrency.length > 0)
  const converted = rates ? monthlyTotalIn(data, target, rates) : null
  const next = nextRenewal(data, today)
  const attention = data.filter(s => needsAttention(s, today)).length
  const mixed = perCurrency.length > 1 || (perCurrency.length === 1 && perCurrency[0].currency !== target)

  let total: string
  if (isLoading) total = '…'
  else if (!perCurrency.length) total = formatMoney(0, target)
  else if (converted) total = [formatMoney(converted.amount, target), ...converted.unconverted.map(t => formatMoney(t.amount, t.currency))].join(' + ')
  else total = perCurrency.map(t => formatMoney(t.amount, t.currency)).join(' + ')

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-micro text-fg-faint">Subscriptions · per month</p>
          {perCurrency.length > 0 && (
            <InfoBubble label="About the exchange rates">
              {converted
                ? <>Prices in other currencies are converted with <strong>Open Exchange Rates</strong>{date ? ` (rates of ${formatDay(date)})` : ''}, refreshed hourly. They are approximate — your bank's rate will differ a little.</>
                : failed
                  ? 'Exchange rates from Open Exchange Rates could not be loaded, so each currency is totalled on its own.'
                  : 'Loading exchange rates from Open Exchange Rates…'}
            </InfoBubble>
          )}
        </div>
        <p className="text-lead font-semibold tabular-nums text-fg">{total}</p>
        {converted && converted.amount > 0 && (
          <ApproxLine amount={converted.amount} currency={target} rates={rates} />
        )}
        {converted && mixed && (
          <span className="block text-micro text-fg-faint">
            From {perCurrency.map(t => formatMoney(t.amount, t.currency)).join(' + ')}
          </span>
        )}
      </div>
      {perCurrency.length > 0 && rates && (
        <label className="flex items-center gap-2 text-meta text-fg-muted">
          Show in
          <select value={target} onChange={e => setTarget(e.target.value)} className="select w-auto min-h-[44px]">
            {SUBSCRIPTION_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      <div>
        <p className="text-micro text-fg-faint">Next renewal</p>
        <p className="text-body font-medium text-fg-2">
          {next ? `${serviceLabel(next.service)} · ${formatDay(next.renews_on!)}` : 'None scheduled'}
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
  const { rates } = useSubscriptionRates(other.some(s => (s.price ?? 0) > 0))
  return (
    <section aria-label="Other subscriptions">
      <h2 className="section-label mb-2">Other subscriptions</h2>
      <Card>
        {other.length === 0
          ? <p className="text-meta text-fg-muted">Services without an integration here (ScreenScraper, Supabase, Gemini…) are listed once you add one.</p>
          : <ul className="space-y-0.5">{other.map(s => <SubscriptionRow key={s.id} sub={s} today={today} rates={rates} showService onEdit={() => edit({ sub: s })} />)}</ul>}
        <Button size="sm" variant="ghost" className="mt-1" icon={<Plus />} onClick={() => edit({ sub: null })}>Add subscription</Button>
      </Card>
      {sheet}
    </section>
  )
}
