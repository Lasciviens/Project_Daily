import type { ReactNode } from 'react'
import { detailSections, platformVariants, type DetailRow, type PlatformVariant } from './tgDetailFields'
import type { TgGame } from '../testGameModel'
import { Truncate } from '../../../../shared/ui/Truncate'

// The "Details" block: every non-empty field the row carries, grouped as
// About · Your progress · Platforms · Source (see tgDetailFields). Everything
// the legacy "All details" modal showed, inside the detail card itself.

function Value({ row }: { row: DetailRow }) {
  if (row.chips?.length) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {row.chips.map(c => (
          <span key={c} className="rounded-full border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-2 py-[1px] text-[11.5px] font-medium text-[var(--tg-text-2)]">
            {c}
          </span>
        ))}
      </span>
    )
  }
  return <>{row.value}</>
}

/**
 * A dense label/value grid: one line per fact, labels sized to the longest.
 * Where the block is wide (the bigger popup) short facts sit two to a line;
 * paragraphs and chip lists always take a whole line.
 */
function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px] leading-[1.4] @[34rem]:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
      {rows.map(row => row.long ? (
        <div key={row.label} className="col-span-full flex flex-col gap-0.5 pt-0.5">
          <dt className="text-[var(--tg-muted)]">{row.label}</dt>
          <dd className="whitespace-pre-line break-words leading-[1.5] text-[var(--tg-text-2)]">{row.value}</dd>
        </div>
      ) : (
        <div key={row.label} className="contents">
          <dt className={`max-w-[9rem] text-[var(--tg-muted)] ${row.chips?.length ? 'col-start-1' : ''}`}><Truncate>{row.label}</Truncate></dt>
          <dd className={`min-w-0 break-words font-medium text-[var(--tg-text)] ${row.chips?.length ? '@[34rem]:col-span-3' : ''}`}><Value row={row} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="@container flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-2.5">
      <h3 className="tg-section-label">{title}</h3>
      {children}
    </section>
  )
}

function Variant({ v }: { v: PlatformVariant }) {
  return (
    <div className="@container flex flex-col gap-1 rounded-lg border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Truncate className="flex-1 text-[12.5px] font-semibold text-[var(--tg-text)]">{v.name}</Truncate>
        {v.primary && (
          <span className="shrink-0 rounded-full bg-[var(--tg-accent-soft)] px-2 py-[1px] text-[11px] font-semibold text-[var(--tg-accent)]">Primary</span>
        )}
      </div>
      {v.rows.length > 0 && <Rows rows={v.rows} />}
    </div>
  )
}

export function TgDetailFields({ game }: { game: TgGame }) {
  const sections = detailSections(game)
  const variants = platformVariants(game)
  const before = sections.filter(s => s.key !== 'source')
  const source = sections.find(s => s.key === 'source')

  return (
    <div className="flex flex-col gap-2.5">
      {before.map(s => <Section key={s.key} title={s.title}><Rows rows={s.rows} /></Section>)}
      {variants.length > 0 && (
        <Section title={variants.length === 1 ? 'Platform' : `Platforms · ${variants.length}`}>
          <div className="grid grid-cols-1 gap-1.5 @[40rem]:grid-cols-2">{variants.map(v => <Variant key={v.id} v={v} />)}</div>
        </Section>
      )}
      {source && <Section title={source.title}><Rows rows={source.rows} /></Section>}
    </div>
  )
}
