import { useMemo, useState } from 'react'
import { Truncate, useChartColors } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { complete, type Amount } from '../../ownModel'
import {
  needOrFun, savedIn, valueKeptByCategory, wishToPurchase, yearVsLast, type Between, type CategoryLevel, type Period,
} from '../../statsModel'
import { AmountText } from '../shopKit'
import { CardFilter, HBar, StatsCard, Swatch } from './statsKit'
import { num, plural, shortReason } from './statsFormat'
import { join, type StatsData } from './drillTypes'
import { DrillRowButton } from './StatsDrillSheet'

// Stats, step C (owner's plan 10.11.2026): this year vs last, need or just for fun, saved by watching, days from
// wish to purchase with the impulse buys, and value kept by category. Every card follows the picked period; the
// definitions are statsModel's.

const when = (p: Period) => p.year ?? 'all time'
const pct = (share: number | null) => (share == null ? '—' : `${Math.round(share * 100)} %`)

/** "+12 %" / "−300" against the year before, or null when there is nothing to compare with. */
function change(now: Amount | number, before: Amount | number): string | null {
  const a = typeof now === 'number' ? now : complete(now) ? now.nok : null
  const b = typeof before === 'number' ? before : complete(before) ? before.nok : null
  if (a == null || b == null) return null
  if (Math.round(b) === 0) return Math.round(a) === 0 ? 'same' : null
  const d = Math.round(((a - b) / Math.abs(b)) * 100)
  return d === 0 ? 'same' : `${d > 0 ? '+' : '−'}${Math.abs(d)} %`
}

const YEAR_ROWS: { key: keyof Between; label: string }[] = [
  { key: 'spent', label: 'Spent' }, { key: 'got', label: 'Got back' }, { key: 'net', label: 'Net spend' },
  { key: 'purchases', label: 'Purchases' }, { key: 'saved', label: 'Saved by watching' },
]

/** This year vs last: the picked year against the one before (this year so far: both to the same day). */
export function YearVsCard({ data }: { data: StatsData }) {
  const v = useMemo(() => yearVsLast(data.items, data.ctx, data.period), [data])
  const cell = (x: Amount | number) => (typeof x === 'number' ? num(x) : <AmountText amount={x} bare unknown={shortReason(x)} />)
  return (
    <StatsCard title={`${v.year} vs ${v.last}`} subtitle={v.partial ? `Each to the same day: ${formatDate(`${v.year}-${v.toDay}`)} and ${formatDate(`${v.last}-${v.toDay === '02-29' ? '02-28' : v.toDay}`)} · NOK` : 'The whole of each year · NOK'}>
      <table className="w-full text-body tabular-nums">
        <thead>
          <tr className="text-meta text-fg-muted">
            <th scope="col" className="pb-1 text-left font-medium"><span className="sr-only">What</span></th>
            <th scope="col" className="pb-1 text-right font-medium">{v.year}</th>
            <th scope="col" className="pb-1 text-right font-medium">{v.last}</th>
            <th scope="col" className="pb-1 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {YEAR_ROWS.map(r => (
            <tr key={r.key} className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-medium text-fg-2">{r.label}</th>
              <td className="py-1.5 text-right font-semibold text-fg">{cell(v.now[r.key])}</td>
              <td className="py-1.5 text-right text-fg-muted">{cell(v.before[r.key])}</td>
              <td className="py-1.5 text-right text-meta text-fg-muted">{change(v.now[r.key], v.before[r.key]) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </StatsCard>
  )
}

const WHY_LABEL: Record<string, string> = { need: 'Need it', fun: 'Just for fun', unsaid: 'Not said', high: 'High priority', medium: 'Medium priority', low: 'Low priority' }
const BY = [{ value: 'why' as const, label: 'Why' }, { value: 'priority' as const, label: 'Priority' }]

/** Need it or just for fun: what you bought in the period by why it was on the list, or by the wish's priority. */
export function WhyCard({ data, onOpen }: { data: StatsData; onOpen: (ids: string[], title: string) => void }) {
  const c = useChartColors()
  const [by, setBy] = useState<'why' | 'priority'>('why')
  const w = useMemo(() => needOrFun(data.items, data.period, by), [data, by])
  const max = Math.max(1, ...w.rows.map(r => (complete(r.spent) ? r.spent.nok : 0)))
  return (
    <StatsCard title="Need or just for fun" subtitle={`Bought · ${when(data.period)}${w.leftOut && by === 'priority' ? ` · ${plural(w.leftOut, 'thing')} added as owned left out` : ''}`}>
      <CardFilter label="Group by" options={BY} value={by} onChange={setBy} />
      {w.rows.length === 0
        ? <p className="text-body text-fg-muted">{by === 'priority' ? 'Nothing bought in this period was a wish first.' : 'Nothing bought in this period.'}</p>
        : (
          <ul className="-mx-3 flex flex-col">
            {w.rows.map((r, k) => (
              <li key={r.key}>
                <button type="button" onClick={() => onOpen(r.ids, WHY_LABEL[r.key] ?? r.key)} className="row row-interactive w-full flex-col items-stretch gap-1 py-2 text-left">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-body font-medium text-fg">{WHY_LABEL[r.key] ?? r.key}</span>
                    <span className="shrink-0 text-meta tabular-nums text-fg-muted">{plural(r.count, 'purchase')}</span>
                    <AmountText amount={r.spent} unknown={shortReason(r.spent)} className="w-[6.5rem] shrink-0 text-right text-meta font-semibold text-fg-2" />
                  </span>
                  <HBar value={complete(r.spent) ? r.spent.nok : 0} max={max} color={c.series[k % c.series.length]} />
                </button>
              </li>
            ))}
          </ul>
        )}
    </StatsCard>
  )
}

/** Saved by watching: money back from claims and price matches recorded in the period. */
export function SavedCard({ data, onOpen }: { data: StatsData; onOpen: (id: string) => void }) {
  const s = useMemo(() => savedIn(data.items, data.ctx, data.period), [data])
  const counted = s.rows.filter(r => r.kind !== 'other')
  const other = s.rows.filter(r => r.kind === 'other')
  return (
    <StatsCard title="Saved by watching" subtitle={`Claims and price matches · ${when(data.period)}`}>
      {s.rows.length === 0
        ? <p className="text-body text-fg-muted">No money back yet. A claim or a price match you record on a thing ("Got 500 back") counts here.</p>
        : (
          <div className="flex flex-col gap-2">
            <p className="text-kpi tabular-nums text-fg"><AmountText amount={s.saved} unknown={shortReason(s.saved)} /></p>
            <p className="text-meta text-fg-muted">
              {join([`claims ${complete(s.claims) ? num(s.claims.nok) : shortReason(s.claims)}`, `price matches ${complete(s.matches) ? num(s.matches.nok) : shortReason(s.matches)}`])}
              {other.length > 0 && ` · other money back ${complete(s.other) ? num(s.other.nok) : shortReason(s.other)} (not counted)`}
            </p>
            <ul className="-mx-3 flex flex-col">
              {[...counted, ...other].map(r => {
                const i = data.byId.get(r.id)
                return (
                  <li key={r.costId}>
                    <DrillRowButton onOpen={() => onOpen(r.id)} row={{ key: r.costId, id: r.id, title: i?.title ?? 'A thing', sub: join([r.label, formatDate(r.day)]), amount: r.amount, muted: r.kind === 'other' }} />
                  </li>
                )
              })}
            </ul>
          </div>
        )}
    </StatsCard>
  )
}

/** Days from wish to purchase, and the impulse buys (bought on the day it was added, or the next). */
export function WaitCard({ data, onOpen }: { data: StatsData; onOpen: (id: string) => void }) {
  const c = useChartColors()
  const w = useMemo(() => wishToPurchase(data.items, data.period), [data])
  const max = Math.max(1, ...w.buckets.map(b => b.count))
  return (
    <StatsCard title="From wish to purchase"
      subtitle={w.median == null ? `Bought · ${when(data.period)}` : `Usually ${plural(w.median, 'day')} · ${plural(w.impulse.length, 'impulse buy')} · ${when(data.period)}`}>
      {w.rows.length === 0
        ? <p className="text-body text-fg-muted">Nothing bought in this period was on the wishlist first{w.notWished ? ` (${plural(w.notWished, 'thing')} added as owned)` : ''}.</p>
        : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1.5">
              {w.buckets.map(b => (
                <li key={b.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-meta tabular-nums">
                  <span className="text-fg-2">{b.label}</span>
                  <HBar value={b.count} max={max} color={c.series[0]} />
                  <span className="text-right font-semibold text-fg-2">{b.count}</span>
                </li>
              ))}
            </ul>
            {w.impulse.length > 0 && (
              <section aria-label="Impulse buys">
                <h4 className="section-label pb-0.5">Impulse buys · within a day of adding</h4>
                <ul className="-mx-3 flex flex-col">
                  {w.impulse.map(r => (
                    <li key={r.item.id}>
                      <DrillRowButton onOpen={() => onOpen(r.item.id)} row={{
                        key: r.item.id, id: r.item.id, title: r.item.title, text: r.days === 0 ? 'same day' : 'next day',
                        sub: join([r.item.platform, `added ${formatDate(r.since.slice(0, 10))}`]), muted: true,
                      }} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {w.notWished > 0 && <p className="text-meta text-fg-muted">{plural(w.notWished, 'thing')} added as owned left out.</p>}
          </div>
        )}
    </StatsCard>
  )
}

const LEVELS = [{ value: 'top' as const, label: 'Categories' }, { value: 'sub' as const, label: 'Subcategories' }]

/** Value kept by category: what came back of the price when things left with money, and what yours could sell for. */
export function KeptValueCard({ data, onOpen }: { data: StatsData; onOpen: (ids: string[], title: string) => void }) {
  const c = useChartColors()
  const [level, setLevel] = useState<CategoryLevel>('top')
  const rows = useMemo(() => valueKeptByCategory(data.items, data.categories, data.ctx, data.period, level), [data, level])
  const p = data.period
  return (
    <StatsCard title="Value kept by category"
      subtitle={p.year ? `Sold in ${p.year}, and what you had at its end could sell for today` : 'Sold, and what yours could sell for today'}
      action={<span className="flex gap-3"><Swatch color={c.series[1]} label="Sold" /><Swatch color={c.series[4]} label="Still yours" /></span>}>
      {rows.length === 0
        ? <p className="text-body text-fg-muted">Nothing sold with a price, and no &quot;Could sell for&quot; on what you have{p.year ? ` in ${p.year}` : ''}.</p>
        : (
          <>
            <CardFilter label="Group by" options={LEVELS} value={level} onChange={setLevel} />
            <ul className="-mx-3 flex flex-col">
              {rows.map(r => (
                <li key={r.key}>
                  <button type="button" onClick={() => onOpen([...r.sold.ids, ...r.held.ids], r.title)} className="row row-interactive w-full flex-col items-stretch gap-1 py-2 text-left">
                    <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                    {r.sold.count > 0 && <Share label={`${r.sold.count} sold`} share={r.sold.share} color={c.series[1]} />}
                    {r.held.count > 0 && <Share label={`${r.held.count} still yours`} share={r.held.share} color={c.series[4]} />}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
    </StatsCard>
  )
}

function Share({ label, share, color }: { label: string; share: number | null; color: string }) {
  return (
    <span className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-meta tabular-nums">
      <span className="text-fg-muted">{label}</span>
      <HBar value={Math.min(1, share ?? 0)} max={1} color={color} />
      <span className="text-right font-semibold text-fg-2">{pct(share)}</span>
    </span>
  )
}
