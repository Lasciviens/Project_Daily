import type { ReactNode } from 'react'
import { Clock, Gauge, Package, TrendingUp, Wallet } from 'lucide-react'
import { StatTile } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { complete } from '../../ownModel'
import { monthsLabel, type OwnedAt, type Period, type ResaleSummary, type UseIn, type YearTotals } from '../../statsModel'
import { countReason, num, plural, shortSum, signedNum } from './statsFormat'
import { atEnd, type Drill } from './drillTypes'

interface Props {
  period: Period
  totals: YearTotals
  /** What you had at the period's end. */
  owned: OwnedAt
  /** Cost of use in the period. */
  use: UseIn
  resale: ResaleSummary | null
  /** The things that went in the period: how long they were kept on average. */
  kept: { months: number | null; count: number }
  onDrill: (d: Drill) => void
}

/**
 * The four headline numbers of the picked period, each naming it: net spend,
 * what you owned at its end (today for this year and all time), what using
 * your things cost in it, and the resale result of the sales made in it (or,
 * without things bought to sell, how long the things that went were kept).
 * Each opens the things behind it.
 */
export function StatsTiles({ period: p, totals: t, owned, use, resale, kept, onDrill }: Props) {
  const netKnown = complete(t.net)
  const when = p.year ?? 'all time'
  const paid = shortSum(owned.paid)
  // A tile under ~15rem (two across a phone) gets the short label and hint, and no icon: the label names
  // the period on one line ("Net spend · all time" needs 141 of a 402px phone tile's 147px; the icon takes 20).
  const { ref, width } = useElementWidthRem()
  const short = width != null && (width - (width >= 44 ? 3 : 1) * 0.75) / (width >= 44 ? 4 : 2) < 15
  const icon = (node: ReactNode) => (short ? undefined : node)
  const perMonth = p.year && use.months >= 1 ? use.nok / use.months : null
  const counted = `${use.rows.length} of ${plural(use.things.length, 'thing')}`
  return (
    <div ref={ref} className="@container">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 @[44rem]:grid-cols-4">
        <StatTile
          icon={icon(<Wallet />)} label={`Net spend · ${when}`}
          value={netKnown ? num(t.net.nok) : 'Unknown'} unit={netKnown ? 'NOK' : undefined}
          hint={netKnown ? (short ? `−${num(t.spent.nok)} · +${num(t.got.nok)}` : `Spent ${num(t.spent.nok)} · got back ${num(t.got.nok)}`) : countReason(t.net)}
          onClick={() => onDrill({ kind: 'period', year: p.year })}
        />
        <StatTile
          icon={icon(<Package />)} label={p.past ? (short ? `Owned ${formatDate(p.to)}` : `You owned · ${atEnd(p)}`) : 'You own · today'}
          value={owned.things} unit={owned.things === 1 ? 'thing' : 'things'}
          hint={p.past
            // "Could sell for" keeps no history: a past year's value is known only for what is still yours (in its drill-down).
            ? (short ? `Paid ${paid} by then` : `Paid ${paid} by then · ${owned.stillYours} still yours`)
            : !owned.valued ? `Paid ${paid} · none valued yet`
              : short ? `${owned.valued} valued: ${shortSum(owned.worth)}` : `Paid ${paid} · could sell for ${shortSum(owned.worth)} (${owned.valued} valued)`}
          onClick={() => onDrill({ kind: 'own' })}
        />
        <StatTile
          icon={icon(<Gauge />)} label={short && !p.year ? 'Total cost of use' : `Cost of use · ${when}`}
          value={use.rows.length ? `≈ ${num(Math.abs(use.nok))}` : '—'} unit={use.rows.length ? (use.nok < 0 ? 'NOK gained' : 'NOK') : undefined}
          tone={use.rows.length && Math.round(use.nok) < 0 ? 'success' : undefined}
          hint={!use.things.length ? (p.year ? `Nothing was yours in ${p.year}` : 'Nothing bought yet')
            : perMonth != null && use.rows.length ? (short ? `≈ ${num(perMonth)} a month` : `≈ ${num(perMonth)} a month · from ${counted}`)
              : `From ${counted}`}
          onClick={() => onDrill({ kind: 'use' })}
        />
        {resale ? (
          <StatTile
            icon={icon(<TrendingUp />)} label={`${short ? 'Resale' : 'Resale result'} · ${when}`}
            value={complete(resale.result) ? signedNum(resale.result.nok) : 'Unknown'} unit={complete(resale.result) ? 'NOK' : undefined}
            tone={complete(resale.result) && Math.round(resale.result.nok) !== 0 ? (resale.result.nok > 0 ? 'success' : 'danger') : undefined}
            hint={[`${resale.sold} of ${resale.bought} sold${p.year && !short ? ` in ${p.year}` : ''}`, !short && resale.avgDaysToSell != null && `≈ ${plural(resale.avgDaysToSell, 'day')} to sell`].filter(Boolean).join(' · ')}
            onClick={() => onDrill({ kind: 'resale' })}
          />
        ) : (
          <StatTile
            icon={icon(<Clock />)} label={`Kept for · ${when}`}
            value={kept.months == null ? '—' : kept.months < 24 ? Math.max(1, Math.round(kept.months)) : (kept.months / 12).toFixed(1)}
            unit={kept.months == null ? undefined : kept.months < 24 ? 'months' : 'years'}
            hint={kept.months == null ? (p.year ? `Nothing went in ${p.year}` : 'Nothing sold or gone yet')
              : short ? `Average of ${plural(kept.count, 'thing')}` : `≈ ${monthsLabel(kept.months)} on average · ${plural(kept.count, 'thing')} went${p.year ? ` in ${p.year}` : ''}`}
            onClick={() => onDrill({ kind: 'kept' })}
          />
        )}
      </div>
    </div>
  )
}
