import { useMemo } from 'react'
import { Truncate, useChartColors } from '../../../../shared/ui'
import { add, complete, minus, type Amount } from '../../ownModel'
import { moneyEvents, type MonthRow } from '../../statsModel'
import { AmountText } from '../shopKit'
import { StatsCard, Swatch } from './statsKit'
import { shortReason } from './statsFormat'
import { MoneyChart } from './MoneyChart'
import type { StatsData } from './drillTypes'

/**
 * Money in and out by month. On a wide card (two tracks) the chart keeps its
 * cap and the months' totals and largest purchases sit beside it.
 */
export function MoneyCard({ rows, year, data, onMonth, onOpen }: {
  rows: MonthRow[]; year: string | null; data: StatsData; onMonth: (month: string) => void; onOpen: (id: string) => void
}) {
  const c = useChartColors()
  const spent = add(...rows.map(r => r.spent))
  const got = add(...rows.map(r => r.got))
  const largest = useMemo(() => {
    if (!rows.length) return []
    return moneyEvents(data.items, data.ctx, rows[0].month, rows[rows.length - 1].month)
      .filter(e => e.kind === 'bought' && complete(e.amount) && e.amount.nok > 0)
      .sort((a, b) => b.amount.nok - a.amount.nok)
      .slice(0, 3)
  }, [rows, data])
  return (
    <StatsCard
      title="Money in and out"
      subtitle={`${year ?? 'Last 24 months'} · in NOK at each day's rate`}
      action={<span className="flex gap-3"><Swatch color={c.series[0]} label="Spent" /><Swatch color={c.series[1]} label="Got back" /></span>}
    >
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @[62rem]:grid-cols-[minmax(0,56rem)_minmax(14rem,20rem)]">
          <MoneyChart rows={rows} withYear={year == null} onMonth={onMonth} />
          <aside aria-label="Totals" className="hidden min-w-0 flex-col gap-3 border-l border-line pl-4 @[62rem]:flex">
            <dl className="flex flex-col gap-1 text-body">
              <Total label="Spent" amount={spent} />
              <Total label="Got back" amount={got} />
              <Total label="Net" amount={minus(spent, got)} strong />
            </dl>
            {largest.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="section-label">Largest purchases</h4>
                <ul className="-mx-3 flex flex-col">
                  {largest.map(e => (
                    <li key={e.key}>
                      <button type="button" onClick={() => onOpen(e.id)} className="row row-interactive w-full text-left">
                        <Truncate className="min-w-0 flex-1 text-body text-fg-2">{data.byId.get(e.id)?.title ?? ''}</Truncate>
                        <AmountText amount={e.amount} className="shrink-0 text-body font-semibold text-fg" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </StatsCard>
  )
}

function Total({ label, amount, strong }: { label: string; amount: Amount; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={strong ? 'font-bold text-fg' : 'font-semibold text-fg-2'}><AmountText amount={amount} unknown={shortReason(amount)} /></dd>
    </div>
  )
}
