import { MetaLine } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { formatDate } from '../../../shared/utils/dateFormat'
import { totalsLabel, type Totals } from '../shopModel'
import type { UsdRates } from '../../settings/subscriptionRules'

const things = (n: number) => `${n} thing${n === 1 ? '' : 's'}`

/**
 * One line right above the tiles that sums up what they show (as Owned's,
 * owner 09.11.2026: a card took the phone's first screen and said little):
 * "To buy · 12 things · 44 027–46 027 NOK + 3 200 TRY · 1 without a price".
 * A general wish counts as its range; a price without a rate stays in its own
 * currency, never dropped.
 */
export function WishlistSummaryLine({ totals, shown, all, filtered, rates, ratesDate, failed }: {
  totals: Totals
  shown: number
  all: number
  filtered: boolean
  rates: UsdRates | null
  ratesDate: string | null
  failed: boolean
}) {
  const priced = totals.amount !== 0 || totals.max !== 0 || totals.unconverted.length > 0
  return (
    <p className="text-meta tabular-nums text-fg-muted">
      <MetaLine as="span" items={[
        <span key="h" className="font-semibold text-fg">{filtered ? 'Shown' : 'To buy'}</span>,
        filtered ? `${shown} of ${things(all)}` : things(all),
        priced && <span key="t" className="text-fg-2">{totalsLabel(totals)}</span>,
        totals.unpriced > 0 && `${totals.unpriced} without a price`,
      ]} />
      {' '}
      <InfoBubble label="About the total">
        {rates
          ? <>Prices in another currency are converted with <strong>Open Exchange Rates</strong>{ratesDate ? ` (rates of ${formatDate(ratesDate)})` : ''}. They are approximate — your bank's rate will differ a little.</>
          : failed
            ? 'Exchange rates could not be loaded, so each currency is totalled on its own.'
            : 'Loading exchange rates…'}
        {' '}A general wish counts as its range. Things without a price are counted, but add nothing to the total.
      </InfoBubble>
    </p>
  )
}
