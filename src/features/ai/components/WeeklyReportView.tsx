import { useMemo, type ReactNode } from 'react'
import { Compass, Dumbbell, FileText, HeartPulse, ListChecks, Utensils } from 'lucide-react'
import { StatTile, TonePill, Truncate, cx } from '../../../shared/ui'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { dealByIndex } from '../../projects/projectBoard'
import { reportView, type ReportSectionKey, type ReportSectionView, type ReportTile } from '../claude/reportFigures'
import { ReportChange } from './ReportChange'
import { ReportChartView } from './ReportCharts'

/**
 * The weekly report, one card per section (owner, 25.11.2026): its key figures as tiles from the figures code saved with
 * the report (never read out of the model's text), the change against the week before as a tone on the number's line,
 * a small chart where the week has the data, then the model's words in full (one or two sentences with no numbers). The model's text is drawn as plain text, never
 * as HTML, markdown or a link. One component for every way in: Home's popup (and the push that opens it) and the
 * Batches view. The cards are dealt into column stacks by the view's own width (two from 46rem), never a row grid.
 */

const ICON: Record<ReportSectionKey, ReactNode> = {
  intro: <FileText />, training: <Dumbbell />, health: <HeartPulse />, food: <Utensils />, tasks: <ListChecks />, next: <Compass />, other: <FileText />,
}

/** Two stacks from this view width (rem): a section card needs about 22rem for two tiles a row. */
const TWO_COLUMNS_FROM = 46

/**
 * The tiles (owner-critic, 25.11.2026: as compact as possible on a phone): two a row, four where the card is wide; three
 * tiles are one row of three, so a tile never sits alone in a row.
 */
const tileGrid = (tiles: ReportTile[]) => {
  const n = tiles.length
  // Four bare counts (Tasks: 11, 2, 4, 9) fit one row even on a phone.
  if (n === 4 && tiles.every(t => !t.hint && !t.change && !t.unit && t.value.length <= 5)) return 'grid-cols-4'
  return n === 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-2' : n % 2 === 1 ? 'grid-cols-3' : 'grid-cols-2 @[36rem]:grid-cols-4'
}

function SectionCard({ section }: { section: ReportSectionView }) {
  const words = section.key === 'next' ? null : section.text.join(' ')
  const figures = section.tiles.length > 0 || section.charts.length > 0
  return (
    <section className="card flex min-w-0 flex-col gap-2.5 p-3.5 @container sm:p-4" aria-label={section.title || 'Summary'}>
      {section.title && (
        <header className="flex items-center gap-2.5">
          <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">{ICON[section.key]}</span>
          <h3 className="min-w-0 flex-1 break-words text-lead font-semibold text-fg">{section.title}</h3>
          {section.against && <span className="shrink-0 text-meta text-fg-muted">Changes {section.against}</span>}
        </header>
      )}
      {section.note && <p data-tone="warn" className="tone-text text-meta">{section.note}</p>}
      {section.tiles.length > 0 && (
        <div className={cx('grid gap-1.5', tileGrid(section.tiles))}>
          {section.tiles.map(t => (
            <StatTile key={t.key} inset label={t.label} value={t.value} unit={t.unit}
              change={t.change ? <ReportChange change={t.change} base={section.against} /> : undefined} hint={t.hint} />
          ))}
        </div>
      )}
      {section.lines.length > 0 && (
        <div className="-mt-1 flex flex-col">
          {section.lines.map((line, i) => <Truncate key={i} as="p" className="text-meta text-fg-muted">{line}</Truncate>)}
        </div>
      )}
      {section.charts.length > 0 && (
        <div className={cx('grid gap-4', section.charts.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {section.charts.map(c => <ReportChartView key={c.key} chart={c} />)}
        </div>
      )}
      {section.rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line" aria-label="Key lifts">
          {section.rows.map((r, i) => (
            <li key={`${r.label}-${i}`} className="flex min-w-0 items-center gap-2 py-1 first:pt-0 last:pb-0">
              <Truncate className="min-w-0 flex-1 text-body text-fg-2">{r.label}</Truncate>
              <span className="shrink-0 text-body font-medium tabular-nums text-fg">{r.value}</span>
              {r.badge && <TonePill tone={r.tone} className="shrink-0">{r.badge}</TonePill>}
            </li>
          ))}
        </ul>
      )}
      {/* The model's words, whole: since 25.11.2026 they carry no numbers and are one or two sentences. */}
      {words && <p className={cx('break-words text-body text-fg-2', figures && 'border-t border-line pt-2.5')}>{words}</p>}
      {section.key === 'next' && (
        <div className="flex flex-col gap-1.5">
          {section.text.map((line, i) => <p key={i} className="break-words text-body text-fg-2">{line}</p>)}
        </div>
      )}
    </section>
  )
}

export function WeeklyReportView({ facts, content, weekStart, className }: { facts: Record<string, unknown>; content: string | null; weekStart: string; className?: string }) {
  const sections = useMemo(() => reportView(facts, content, weekStart), [facts, content, weekStart])
  const { ref, width } = useElementWidthRem<HTMLDivElement>()
  const intro = sections.filter(s => s.key === 'intro')
  const cards = sections.filter(s => s.key !== 'intro')
  const columns = dealByIndex(cards, width != null && width >= TWO_COLUMNS_FROM ? 2 : 1)
  return (
    <div ref={ref} className={cx('flex flex-col gap-3', className)}>
      {intro.map(s => <SectionCard key="intro" section={s} />)}
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: `repeat(${columns.length},minmax(0,1fr))` }}>
        {columns.map((column, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-3">
            {column.map(s => <SectionCard key={`${s.key}-${s.title}`} section={s} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
