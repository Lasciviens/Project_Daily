import { useMemo, useState, type CSSProperties } from 'react'
import { Truncate, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { formatDayMonth } from '../../../../shared/utils/dateFormat'
import type { ShopCategory, ShopItem } from '../../types'
import { accessoriesByItem, DISPOSAL_LABEL, durationLabel, type OwnedShow } from '../../ownModel'
import { timelineAxis, timelineRows, timelineSpan, yearAxis, yearLabelEvery, type Period, type TimelineAxis, type TimelineRow } from '../../statsModel'
import { CardFilter, StatsCard, Swatch } from './statsKit'
import { dayOf, join } from './drillTypes'
import { plural } from './statsFormat'

/** From this own width (rem) the names sit in a column beside the bars. */
const WIDE_REM = 34
/** The name column beside the bars when wide (rem) — the bars' width is measured from it. */
const LABEL_REM = 12
const LABEL_COLS = 'grid-cols-[12rem_minmax(0,1fr)]'
const SHOWS = [{ value: 'mine' as const, label: 'Mine' }, { value: 'gone' as const, label: 'Sold or gone' }, { value: 'all' as const, label: 'All' }]

/** A mark on the axis: a year (all time) or a quarter (one year), where it starts as a fraction of the axis. */
interface Mark { key: string; label: string; at: number }

/**
 * One bar per thing — bought → sold or gone, or today — grouped by top
 * category (accessories ride with their item). All time: on a years axis.
 * A year: the things you had in it, on that year's axis (1 January to 31
 * December, or today), cut to it; a thing that went later was still yours at
 * the year's end, so its bar runs on. Still yours is coloured, gone muted; a
 * day added from memory (≈) fades in. A bar opens the thing.
 */
export function OwnershipTimeline({ items, categories, period: p, onOpen }: { items: ShopItem[]; categories: ShopCategory[]; period: Period; onOpen: (id: string) => void }) {
  const [show, setShow] = useState<OwnedShow>('all')
  const ever = useMemo(() => timelineRows(items, categories).rows.length > 0, [items, categories])
  const any = useMemo(() => timelineRows(items, categories, 'all', p).rows.length > 0, [items, categories, p])
  const { rows, start } = useMemo(() => timelineRows(items, categories, show, p), [items, categories, show, p])
  const acc = useMemo(() => accessoriesByItem(items), [items])
  const { ref, width } = useElementWidthRem()
  const groups = useMemo(() => {
    const out: { name: string; rows: TimelineRow[] }[] = []
    for (const r of rows) {
      const last = out[out.length - 1]
      if (last?.name === r.group) last.rows.push(r)
      else out.push({ name: r.group, rows: [r] })
    }
    return out
  }, [rows])
  if (!ever) return null
  const title = p.year ? `Your things in ${p.year}` : 'Your things over the years'
  const ends = p.past ? 'the year\'s end' : 'today'
  const filter = <CardFilter label="Show" options={SHOWS} value={show} onChange={setShow} />
  if (!start) {
    return (
      <StatsCard title={title} subtitle={`Bought to sold or gone, or ${ends}`}>
        {any && filter}
        <p className="text-body text-fg-muted">
          {!any ? `Nothing was yours in ${p.year}.` : show === 'mine' ? `Nothing was still yours at ${ends}.` : `Nothing sold or gone${p.year ? ` in ${p.year}` : ' yet'}.`}
        </p>
      </StatsCard>
    )
  }

  const axis = p.from ? yearAxis({ ...p, from: p.from }) : timelineAxis(start, p.today)
  const wide = (width ?? 0) >= WIDE_REM
  // The bars' own width: the card body less the row padding (and the name column when wide).
  const trackRem = Math.max(4, (width ?? 20) - 1.5 - (wide ? LABEL_REM + 0.75 : 0))
  const every = yearLabelEvery(axis, trackRem)
  const marks: Mark[] = axis.quarters
    ? axis.quarters.map(q => ({ key: q.day, label: formatDayMonth(q.day), at: q.at }))
    : axis.years.filter(y => y.year % every === 0 || every === 1).map(y => ({ key: String(y.year), label: String(y.year), at: y.at }))
  const legend = <span className="flex gap-3"><Swatch className="bg-info" label="Still yours" /><Swatch className="bg-neutral/50" label="Sold or gone" /></span>

  return (
    <StatsCard
      title={title} action={legend}
      subtitle={`${plural(rows.length, 'thing')}${p.year ? ' you had' : ''} · bought to sold or gone, or ${ends} · ≈ a day from memory`}
    >
      {filter}
      <div ref={ref} className="flex flex-col gap-2">
        <div aria-hidden className={cx('px-3', wide && `grid gap-3 ${LABEL_COLS}`)}>
          {wide && <span />}
          <AxisLabels marks={marks} trackRem={trackRem} end={p.past ? null : 'Today'} />
        </div>
        {groups.map(g => (
          <section key={g.name} aria-label={g.name}>
            <h4 className="section-label px-3 pb-0.5 pt-1">{g.name} · {g.rows.length}</h4>
            <ul className="flex flex-col">
              {g.rows.map(r => (
                <li key={r.item.id}>
                  <Bar row={r} axis={axis} marks={marks} wide={wide} today={p.today} trackRem={trackRem} accessories={acc.get(r.item.id)?.length ?? 0} onOpen={() => onOpen(r.item.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </StatsCard>
  )
}

/** Labels at the start of each (labelled) year or quarter; one too close to the right edge ends at its mark instead. */
function AxisLabels({ marks, trackRem, end }: { marks: Mark[]; trackRem: number; end: string | null }) {
  return (
    <span className="relative block h-4 text-micro tabular-nums text-fg-muted">
      {marks.map(m => {
        const style: CSSProperties = (1 - m.at) * trackRem >= 2.4 ? { left: `${m.at * 100}%` } : { right: 0 }
        return <span key={m.key} className="absolute top-0 whitespace-nowrap pl-1" style={style}>{m.label}</span>
      })}
      {end && marks.length > 0 && (1 - marks[marks.length - 1].at) * trackRem >= 5.2 && <span className="absolute right-0 top-0">{end}</span>}
    </span>
  )
}

function Bar({ row, axis, marks, wide, today, trackRem, accessories, onOpen }: {
  row: TimelineRow; axis: TimelineAxis; marks: Mark[]; wide: boolean; today: string; trackRem: number; accessories: number; onOpen: () => void
}) {
  const { item } = row
  const span = timelineSpan(axis, row.from, row.to)
  // How long it was yours, all of it (a past year's bar shows only that year's part).
  const duration = durationLabel(row.from, item.disposed_on ?? today)
  const facts = join([
    `Bought ${dayOf(item, row.from)}`,
    item.disposal ? `${DISPOSAL_LABEL[item.disposal]} ${item.disposed_on ? dayOf(item, item.disposed_on) : '(day unknown)'}` : 'still yours',
    duration,
    accessories > 0 && plural(accessories, 'accessory', 'accessories'),
  ])
  // Anchored at its end, so a very short bar grows back from it instead of past today.
  const right = Math.max(0, 1 - span.left - span.width)
  // A day from memory fades in — when that day is on the axis.
  const fade = row.approx && row.from >= axis.from && span.width * trackRem >= 2.5
  const bar: CSSProperties = {
    right: `${right * 100}%`, width: `max(${span.width * 100}%, 0.375rem)`,
    ...(fade ? { maskImage: 'linear-gradient(to right, transparent, black 1rem)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 1rem)' } : {}),
  }
  return (
    <button type="button" onClick={onOpen} title={`${item.title} — ${facts}`} aria-label={`${item.title}: ${facts}`}
      className={cx('row row-interactive w-full text-left', wide ? `grid gap-3 ${LABEL_COLS}` : 'flex-col items-stretch gap-1 py-1.5')}>
      <span className={cx('flex min-w-0', wide ? 'flex-col' : 'items-baseline gap-2')}>
        <Truncate className={cx('min-w-0 flex-1 text-body font-medium', row.gone ? 'text-fg-2' : 'text-fg')}>{`${row.approx ? '≈ ' : ''}${item.title}`}</Truncate>
        <span className="shrink-0 text-micro tabular-nums text-fg-muted">{duration}</span>
      </span>
      <span className="relative block h-3 w-full">
        {marks.filter(m => m.at > 0).map(m => <span key={m.key} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: `${m.at * 100}%` }} />)}
        <span aria-hidden className={cx('absolute top-0.5 h-2 rounded-full', row.gone ? 'bg-neutral/50' : 'bg-info')} style={bar} />
      </span>
    </button>
  )
}
