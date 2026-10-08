import { useMemo, useState, type CSSProperties } from 'react'
import { Truncate, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import type { ShopCategory, ShopItem } from '../../types'
import { accessoriesByItem, DISPOSAL_LABEL, durationLabel, type OwnedShow } from '../../ownModel'
import { timelineAxis, timelineRows, timelineSpan, yearLabelEvery, type TimelineAxis, type TimelineRow } from '../../statsModel'
import { CardFilter, StatsCard, Swatch } from './statsKit'
import { dayOf, join } from './drillTypes'
import { plural } from './statsFormat'

/** From this own width (rem) the names sit in a column beside the bars. */
const WIDE_REM = 34
/** The name column beside the bars when wide (rem) — the bars' width is measured from it. */
const LABEL_REM = 12
const LABEL_COLS = 'grid-cols-[12rem_minmax(0,1fr)]'
const SHOWS = [{ value: 'mine' as const, label: 'Mine' }, { value: 'gone' as const, label: 'Sold or gone' }, { value: 'all' as const, label: 'All' }]

/**
 * One bar per thing — bought → sold or gone, or today — grouped by top
 * category, on a years axis (accessories ride with their item). Things still
 * yours are coloured, gone ones muted; a day added from memory (≈) fades in.
 * A bar opens the thing.
 */
export function OwnershipTimeline({ items, categories, today, onOpen }: { items: ShopItem[]; categories: ShopCategory[]; today: string; onOpen: (id: string) => void }) {
  const [show, setShow] = useState<OwnedShow>('all')
  const any = useMemo(() => timelineRows(items, categories).rows.length > 0, [items, categories])
  const { rows, start } = useMemo(() => timelineRows(items, categories, show), [items, categories, show])
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
  if (!any) return null
  const filter = <CardFilter label="Show" options={SHOWS} value={show} onChange={setShow} />
  if (!start) {
    return (
      <StatsCard title="Your things over the years" subtitle="Bought to sold or gone, or today">
        {filter}
        <p className="text-body text-fg-muted">{show === 'mine' ? 'Nothing is yours right now.' : 'Nothing sold or gone yet.'}</p>
      </StatsCard>
    )
  }

  const axis = timelineAxis(start, today)
  const wide = (width ?? 0) >= WIDE_REM
  // The bars' own width: the card body less the row padding (and the name column when wide).
  const trackRem = Math.max(4, (width ?? 20) - 1.5 - (wide ? LABEL_REM + 0.75 : 0))
  const every = yearLabelEvery(axis, trackRem)
  const marks = axis.years.filter(y => y.year % every === 0 || every === 1)
  const legend = <span className="flex gap-3"><Swatch className="bg-info" label="Still yours" /><Swatch className="bg-neutral/50" label="Sold or gone" /></span>

  return (
    <StatsCard title="Your things over the years" subtitle={`${plural(rows.length, 'thing')} · bought to sold or gone, or today · ≈ a day from memory`} action={legend}>
      {filter}
      <div ref={ref} className="flex flex-col gap-2">
        <div aria-hidden className={cx('px-3', wide && `grid gap-3 ${LABEL_COLS}`)}>
          {wide && <span />}
          <YearLabels marks={marks} trackRem={trackRem} />
        </div>
        {groups.map(g => (
          <section key={g.name} aria-label={g.name}>
            <h4 className="section-label px-3 pb-0.5 pt-1">{g.name} · {g.rows.length}</h4>
            <ul className="flex flex-col">
              {g.rows.map(r => (
                <li key={r.item.id}>
                  <Bar row={r} axis={axis} marks={marks} wide={wide} today={today} trackRem={trackRem} accessories={acc.get(r.item.id)?.length ?? 0} onOpen={() => onOpen(r.item.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </StatsCard>
  )
}

/** Year labels at the start of each (labelled) year; one too close to the right edge ends at its mark instead. */
function YearLabels({ marks, trackRem }: { marks: TimelineAxis['years']; trackRem: number }) {
  return (
    <span className="relative block h-4 text-micro tabular-nums text-fg-muted">
      {marks.map(m => {
        const style: CSSProperties = (1 - m.at) * trackRem >= 2.4 ? { left: `${m.at * 100}%` } : { right: 0 }
        return <span key={m.year} className="absolute top-0 whitespace-nowrap pl-1" style={style}>{m.year}</span>
      })}
      {marks.length > 0 && (1 - marks[marks.length - 1].at) * trackRem >= 5.2 && <span className="absolute right-0 top-0">Today</span>}
    </span>
  )
}

function Bar({ row, axis, marks, wide, today, trackRem, accessories, onOpen }: {
  row: TimelineRow; axis: TimelineAxis; marks: TimelineAxis['years']; wide: boolean; today: string; trackRem: number; accessories: number; onOpen: () => void
}) {
  const { item } = row
  const gone = !!item.disposal
  const end = row.to ?? today
  const span = timelineSpan(axis, row.from, row.to)
  const duration = durationLabel(row.from, end)
  const facts = join([
    `Bought ${dayOf(item, row.from)}`,
    gone ? `${DISPOSAL_LABEL[item.disposal as NonNullable<typeof item.disposal>]} ${row.to ? dayOf(item, row.to) : '(day unknown)'}` : 'still yours',
    duration,
    accessories > 0 && plural(accessories, 'accessory', 'accessories'),
  ])
  // Anchored at its end, so a very short bar grows back from it instead of past today.
  const right = Math.max(0, 1 - span.left - span.width)
  const fade = row.approx && span.width * trackRem >= 2.5
  const bar: CSSProperties = {
    right: `${right * 100}%`, width: `max(${span.width * 100}%, 0.375rem)`,
    ...(fade ? { maskImage: 'linear-gradient(to right, transparent, black 1rem)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 1rem)' } : {}),
  }
  return (
    <button type="button" onClick={onOpen} title={`${item.title} — ${facts}`} aria-label={`${item.title}: ${facts}`}
      className={cx('row row-interactive w-full text-left', wide ? `grid gap-3 ${LABEL_COLS}` : 'flex-col items-stretch gap-1 py-1.5')}>
      <span className={cx('flex min-w-0', wide ? 'flex-col' : 'items-baseline gap-2')}>
        <Truncate className={cx('min-w-0 flex-1 text-body font-medium', gone ? 'text-fg-2' : 'text-fg')}>{`${row.approx ? '≈ ' : ''}${item.title}`}</Truncate>
        <span className="shrink-0 text-micro tabular-nums text-fg-muted">{duration}</span>
      </span>
      <span className="relative block h-3 w-full">
        {marks.filter(m => m.at > 0).map(m => <span key={m.year} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: `${m.at * 100}%` }} />)}
        <span aria-hidden className={cx('absolute top-0.5 h-2 rounded-full', gone ? 'bg-neutral/50' : 'bg-info')} style={bar} />
      </span>
    </button>
  )
}
