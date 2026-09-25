import type { ReactNode } from 'react'
import { detailSections, platformVariants, type DetailRow, type PlatformVariant } from './tgDetailFields'
import type { TgGame } from '../testGameModel'

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

function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map(row => row.long ? (
        <div key={row.label} className="flex flex-col gap-0.5 text-[12.5px]">
          <dt className="text-[var(--tg-muted)]">{row.label}</dt>
          <dd className="whitespace-pre-line break-words leading-[1.5] text-[var(--tg-text-2)]">{row.value}</dd>
        </div>
      ) : (
        <div key={row.label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-2.5 text-[12.5px] leading-[1.45]">
          <dt className="truncate text-[var(--tg-muted)]">{row.label}</dt>
          <dd className="break-words font-medium text-[var(--tg-text)]"><Value row={row} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-[var(--tg-border)] pt-3.5">
      <h3 className="tg-section-label">{title}</h3>
      {children}
    </section>
  )
}

function Variant({ v }: { v: PlatformVariant }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--tg-text)]">{v.name}</span>
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
    <div className="flex flex-col gap-3.5">
      {before.map(s => <Section key={s.key} title={s.title}><Rows rows={s.rows} /></Section>)}
      {variants.length > 0 && (
        <Section title={variants.length === 1 ? 'Platform' : `Platforms · ${variants.length}`}>
          <div className="flex flex-col gap-2">{variants.map(v => <Variant key={v.id} v={v} />)}</div>
        </Section>
      )}
      {source && <Section title={source.title}><Rows rows={source.rows} /></Section>}
    </div>
  )
}
