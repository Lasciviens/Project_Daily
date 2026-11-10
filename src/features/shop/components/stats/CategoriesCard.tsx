import { useMemo, useState } from 'react'
import { Truncate, useChartColors } from '../../../../shared/ui'
import { complete, type Amount } from '../../ownModel'
import { ownedByCategory, type CategoryLevel, type CategoryRow, type Period } from '../../statsModel'
import { AmountText } from '../shopKit'
import { CardFilter, HBar, StatsCard, Swatch } from './statsKit'
import { plural, shortReason } from './statsFormat'
import { atEnd, join, type StatsData } from './drillTypes'

const LEVELS = [{ value: 'top' as const, label: 'Categories' }, { value: 'sub' as const, label: 'Subcategories' }]

/**
 * What you own at the period's end (today, or 31 December of a past year) by
 * top category or by subcategory: how many things, what they cost and what
 * the valued ones could sell for, as a pair of bars on one scale — the
 * amounts in a column of one width, so every bar has the same track. A past
 * year's "Could sell for" is today's, for the things still yours: there is no
 * history of it. A row opens its things.
 */
export function CategoriesCard({ data, onPick }: { data: StatsData; onPick: (key: string, level: CategoryLevel) => void }) {
  const c = useChartColors()
  const p = data.period
  const [level, setLevel] = useState<CategoryLevel>('top')
  const rows = useMemo(() => ownedByCategory(data.items, data.categories, data.ctx, level, p), [data, level, p])
  const max = Math.max(1, ...rows.flatMap(r => [r.paid.nok, r.worth.nok]))
  return (
    <StatsCard
      title="By category"
      subtitle={p.past ? `What you owned ${atEnd(p)}: paid by then, and what the ones still yours could sell for today` : 'What you own today: paid, and could sell for'}
      action={<span className="flex gap-3"><Swatch color={c.series[0]} label="Paid" /><Swatch color={c.series[1]} label={p.past ? 'Could sell for today' : 'Could sell for'} /></span>}
    >
      {rows.length === 0
        ? <p className="text-body text-fg-muted">{p.past ? `Nothing was yours ${atEnd(p)}.` : 'Nothing is yours right now.'}</p>
        : (
          <>
            <CardFilter label="Group by" options={LEVELS} value={level} onChange={setLevel} />
            <ul className="-mx-3 flex flex-col">
              {rows.map(r => (
                <li key={r.key}>
                  <button type="button" onClick={() => onPick(r.key, level)} className="row row-interactive w-full flex-col items-stretch gap-1 py-2 text-left">
                    <span className="flex items-baseline gap-2">
                      <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{r.title}</Truncate>
                      <span className="shrink-0 text-meta tabular-nums text-fg-muted">{join([plural(r.count, 'thing'), r.valued > 0 && `${r.valued} valued`])}</span>
                    </span>
                    <Pair amount={r.paid} max={max} color={c.series[0]} />
                    {r.valued > 0
                      ? <Pair amount={r.worth} max={max} color={c.series[1]} />
                      : <span className="text-micro text-fg-muted">{noValue(r, p)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
    </StatsCard>
  )
}

/** Why a row has no "Could sell for" bar. */
function noValue(r: CategoryRow, p: Period): string {
  return p.past && !r.stillYours ? 'All gone since: what they could sell for then is not known' : 'No "Could sell for" yet'
}

function Pair({ amount, max, color }: { amount: Amount; max: number; color: string }) {
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
      <HBar value={complete(amount) ? amount.nok : 0} max={max} color={color} />
      <span className="text-right text-meta tabular-nums text-fg-2"><AmountText amount={amount} pending="unknown" unknown={shortReason(amount)} /></span>
    </span>
  )
}
