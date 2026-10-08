import { useMemo, useState } from 'react'
import { Truncate, useChartColors } from '../../../../shared/ui'
import { complete, type Amount } from '../../ownModel'
import { ownedByCategory, type CategoryLevel } from '../../statsModel'
import { AmountText } from '../shopKit'
import { CardFilter, HBar, StatsCard, Swatch } from './statsKit'
import { plural, shortReason } from './statsFormat'
import type { StatsData } from './drillTypes'

const LEVELS = [{ value: 'top' as const, label: 'Categories' }, { value: 'sub' as const, label: 'Subcategories' }]

/**
 * What you own today by top category or by subcategory: how many things,
 * what they cost and what the valued ones could sell for, as a pair of bars
 * on one scale. A row opens its things.
 */
export function CategoriesCard({ data, onPick }: { data: StatsData; onPick: (key: string, level: CategoryLevel) => void }) {
  const c = useChartColors()
  const [level, setLevel] = useState<CategoryLevel>('top')
  const rows = useMemo(() => ownedByCategory(data.items, data.categories, data.ctx, level), [data, level])
  const max = Math.max(1, ...rows.flatMap(r => [r.paid.nok, r.worth.nok]))
  return (
    <StatsCard
      title="By category"
      subtitle="What you own today: paid, and could sell for"
      action={<span className="flex gap-3"><Swatch color={c.series[0]} label="Paid" /><Swatch color={c.series[1]} label="Could sell for" /></span>}
    >
      {rows.length === 0
        ? <p className="text-body text-fg-muted">Nothing is yours right now.</p>
        : (
          <>
            <CardFilter label="Group by" options={LEVELS} value={level} onChange={setLevel} />
            <ul className="-mx-3 flex flex-col">
              {rows.map(r => (
                <li key={r.key}>
                  <button type="button" onClick={() => onPick(r.key, level)} className="row row-interactive w-full flex-col items-stretch gap-1 py-2 text-left">
                    <span className="flex items-baseline gap-2">
                      <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{r.title}</Truncate>
                      <span className="shrink-0 text-meta tabular-nums text-fg-muted">{plural(r.count, 'thing')}</span>
                    </span>
                    <Pair amount={r.paid} max={max} color={c.series[0]} />
                    {r.valued > 0
                      ? <Pair amount={r.worth} max={max} color={c.series[1]} note={`${r.valued} valued`} />
                      : <span className="text-micro text-fg-muted">No &quot;Could sell for&quot; yet</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
    </StatsCard>
  )
}

function Pair({ amount, max, color, note }: { amount: Amount; max: number; color: string; note?: string }) {
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <HBar value={complete(amount) ? amount.nok : 0} max={max} color={color} />
      <span className="min-w-[5.5rem] text-right text-meta tabular-nums text-fg-2">
        <AmountText amount={amount} unknown={shortReason(amount)} />
        {note && <span className="text-fg-muted"> · {note}</span>}
      </span>
    </span>
  )
}
