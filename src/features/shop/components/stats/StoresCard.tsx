import { useState } from 'react'
import { Truncate, useChartColors } from '../../../../shared/ui'
import { complete } from '../../ownModel'
import type { StoreRow } from '../../statsModel'
import { AmountText } from '../shopKit'
import { HBar, StatsCard } from './statsKit'
import { plural, shortReason } from './statsFormat'

const SHOWN = 6

/** "2 in NOK · 1 in TRY" when it was not all NOK, else null. */
function currencyMix(currencies: Record<string, number>): string | null {
  const list = Object.entries(currencies).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!list.length || (list.length === 1 && list[0][0] === 'NOK')) return null
  return list.length === 1 ? `in ${list[0][0]}` : list.map(([cur, n]) => `${n} in ${cur}`).join(' · ')
}

/** Where you buy: stores by what you spent there in the period (in NOK at each day's rate). A store opens its purchases. */
export function StoresCard({ rows, year, onPick }: { rows: StoreRow[]; year: string | null; onPick: (key: string) => void }) {
  const c = useChartColors()
  const [all, setAll] = useState(false)
  const max = Math.max(1, ...rows.map(r => r.spent.nok))
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <StatsCard title="Where you buy" subtitle={`${year ?? 'All time'} · by what you spent`}>
      {rows.length === 0
        ? <p className="text-body text-fg-muted">No purchase in this period has a store written on it.</p>
        : (
          <>
            <ul className="-mx-3 flex flex-col">
              {shown.map(r => (
                <li key={r.key}>
                  <button type="button" onClick={() => onPick(r.key)} className="row row-interactive w-full flex-col items-stretch gap-1 py-2 text-left">
                    <span className="flex items-baseline gap-2">
                      <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{r.title}</Truncate>
                      <AmountText amount={r.spent} unknown={shortReason(r.spent)} className="shrink-0 text-meta font-semibold text-fg-2" />
                    </span>
                    <HBar value={complete(r.spent) ? r.spent.nok : 0} max={max} color={c.series[0]} />
                    <span className="text-micro tabular-nums text-fg-muted">{[plural(r.count, 'purchase'), currencyMix(r.currencies)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > SHOWN && (
              <button type="button" onClick={() => setAll(v => !v)} className="mt-1 self-start text-meta font-semibold text-accent-600 [@media(pointer:coarse)]:min-h-[44px]">
                {all ? 'Show fewer' : `Show all ${rows.length} stores`}
              </button>
            )}
          </>
        )}
    </StatsCard>
  )
}
