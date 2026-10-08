import { Clock, Gauge, Package, TrendingUp, Wallet } from 'lucide-react'
import { StatTile } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { complete, type OwnedSummary } from '../../ownModel'
import { monthsLabel, type ResaleSummary, type UseNow, type YearTotals } from '../../statsModel'
import { countReason, num, plural, signedNum } from './statsFormat'
import type { Drill } from './drillTypes'

interface Props {
  year: string | null
  totals: YearTotals
  owned: OwnedSummary
  /** Things still yours with a "Could sell for" (accessories ride with their item). */
  valuedThings: number
  use: UseNow
  resale: ResaleSummary | null
  kept: { months: number | null; count: number }
  onDrill: (d: Drill) => void
}

/**
 * The four headline numbers: net spend of the period, what you own now, what
 * owning it costs per month, and the resale result (or, without things bought
 * to sell, how long things are kept). Each opens the things behind it.
 */
export function StatsTiles({ year, totals: t, owned, valuedThings, use, resale, kept, onDrill }: Props) {
  const netKnown = complete(t.net)
  const paid = complete(owned.paid) ? num(owned.paid.nok) : 'unknown'
  const worth = complete(owned.worth) ? num(owned.worth.nok) : 'unknown'
  const things = owned.mine
  // A tile under ~15rem (two across a phone) gets the short hint; the rest is in its drill-down.
  const { ref, width } = useElementWidthRem()
  const short = width != null && (width - (width >= 44 ? 3 : 1) * 0.75) / (width >= 44 ? 4 : 2) < 15
  return (
    <div ref={ref} className="@container">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 @[44rem]:grid-cols-4">
        <StatTile
          icon={<Wallet />} label={`Net spend · ${year ?? 'all time'}`}
          value={netKnown ? num(t.net.nok) : 'Unknown'} unit={netKnown ? 'NOK' : undefined}
          hint={netKnown ? `Spent ${num(t.spent.nok)} · ${short ? 'back' : 'got back'} ${num(t.got.nok)}` : countReason(t.net)}
          onClick={() => onDrill({ kind: 'period', year })}
        />
        <StatTile
          icon={<Package />} label="You own"
          value={things} unit={things === 1 ? 'thing' : 'things'}
          hint={!valuedThings ? `Paid ${paid} · none valued yet`
            : short ? `${valuedThings} of ${things} valued: ${worth}` : `Paid ${paid} · could sell for ${worth} (${valuedThings} of ${things})`}
          onClick={() => onDrill({ kind: 'own' })}
        />
        <StatTile
          icon={<Gauge />} label="Cost of use"
          value={use.rows.length ? `≈ ${num(use.nok)}` : '—'} unit={use.rows.length ? 'NOK/month' : undefined}
          hint={!use.things.length ? 'Nothing is yours right now'
            : short ? `From ${use.rows.length} of ${plural(use.things.length, 'thing')}` : `${use.rows.length} of ${plural(use.things.length, 'thing')} have a Could sell for`}
          onClick={() => onDrill({ kind: 'use' })}
        />
        {resale ? (
          <StatTile
            icon={<TrendingUp />} label="Resale result"
            value={complete(resale.result) ? signedNum(resale.result.nok) : 'Unknown'} unit={complete(resale.result) ? 'NOK' : undefined}
            tone={complete(resale.result) && Math.round(resale.result.nok) !== 0 ? (resale.result.nok > 0 ? 'success' : 'danger') : undefined}
            hint={[`${resale.sold} of ${resale.bought} sold`, !short && resale.avgDaysToSell != null && `≈ ${plural(resale.avgDaysToSell, 'day')} to sell`].filter(Boolean).join(' · ')}
            onClick={() => onDrill({ kind: 'resale' })}
          />
        ) : (
          <StatTile
            icon={<Clock />} label="Kept for"
            value={kept.months == null ? '—' : kept.months < 24 ? Math.max(1, Math.round(kept.months)) : (kept.months / 12).toFixed(1)}
            unit={kept.months == null ? undefined : kept.months < 24 ? 'months' : 'years'}
            hint={kept.months == null ? 'Nothing sold or gone yet' : short ? `Average of ${plural(kept.count, 'thing')}` : `≈ ${monthsLabel(kept.months)} on average · ${plural(kept.count, 'thing')}`}
            onClick={() => onDrill({ kind: 'kept' })}
          />
        )}
      </div>
    </div>
  )
}
