import type { ReactNode } from 'react'
import { Card } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { formatDate } from '../../../shared/utils/dateFormat'
import { approxOther, totalsLabel, type Totals } from '../shopModel'
import type { UsdRates } from '../../settings/subscriptionRules'

/**
 * A money summary: the total in NOK with lira beside it, how many rows it
 * covers and how many have no price yet (never counted as 0 silently).
 */
export function ShopTotalsCard({ label, totals, rates, ratesDate, failed, note, children }: {
  label: string
  totals: Totals
  rates: UsdRates | null
  ratesDate: string | null
  failed: boolean
  note?: ReactNode
  children?: ReactNode
}) {
  const approx = approxOther(totals.amount, totals.currency, rates)
  const mixed = totals.unconverted.length > 0
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <p className="text-micro text-fg-faint">{label}</p>
        <InfoBubble label="About the totals">
          {rates
            ? <>Prices in another currency are converted with <strong>Open Exchange Rates</strong>{ratesDate ? ` (rates of ${formatDate(ratesDate)})` : ''}. They are approximate — your bank's rate will differ a little.</>
            : failed
              ? 'Exchange rates could not be loaded, so each currency is totalled on its own.'
              : 'Loading exchange rates…'}
          {' '}Items without a price are counted, but add nothing to the total.
        </InfoBubble>
      </div>
      <p className="text-lead font-semibold tabular-nums text-fg">{totalsLabel(totals)}</p>
      {approx && !mixed && <p className="text-meta tabular-nums text-fg-muted">{approx}</p>}
      <p className="text-meta text-fg-muted">
        {totals.count} item{totals.count === 1 ? '' : 's'}
        {totals.unpriced > 0 && <> · {totals.unpriced} without a price</>}
      </p>
      {note && <p className="text-meta text-fg-muted">{note}</p>}
      {children}
    </Card>
  )
}
