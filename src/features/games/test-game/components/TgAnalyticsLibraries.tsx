import { ChevronRight } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { TgaLibraryRow } from './tgAnalyticsMore'
import { fmtHours } from './tgAnalyticsData'
import { TGA_ROW_H } from './tgAnalyticsFormat'
import { TGA_LIB_META, TGA_LIB_TABLE, libraryCells } from './tgAnalyticsPlay'
import { TgAnalyticsCard } from './TgAnalyticsCard'

const ROW = [
  'grid w-full grid-cols-2 gap-x-3 gap-y-2.5 rounded-[12px] bg-[var(--tg-panel-2)] px-3 py-3 text-left transition-colors',
  '@[18rem]:grid-cols-3 @[26rem]:grid-cols-4',
  '@[40rem]:items-center @[40rem]:gap-x-2 @[40rem]:gap-y-0 @[40rem]:rounded-[10px] @[40rem]:bg-transparent @[40rem]:px-2 @[40rem]:py-1',
  '[@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]',
  TGA_ROW_H, TGA_LIB_TABLE,
].join(' ')

function Row({ row }: { row: TgaLibraryRow }) {
  const meta = TGA_LIB_META[row.library]
  return (
    <li>
      {/* The setter is read at click time: it never changes, so subscribing would only add renders. */}
      <button type="button" onClick={() => useTestGameStore.getState().setAnalyticsLibrary(row.library)} className={ROW}>
        <span className="col-span-full flex min-w-0 items-center gap-2 @[40rem]:col-span-1">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
          <span className="truncate text-[13.5px] font-semibold text-[var(--tg-text)]">{meta.label}</span>
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden className="ml-auto shrink-0 text-[var(--tg-faint)] @[40rem]:hidden" />
        </span>
        {libraryCells(row, fmtHours).map(c => (
          <span key={c.key} className="flex min-w-0 flex-col @[40rem]:block @[40rem]:text-right" title={c.title}>
            <span className="text-[11px] leading-snug text-[var(--tg-muted)] @[40rem]:sr-only">{c.label}</span>
            <span className="block truncate text-[13px] font-semibold tabular-nums text-[var(--tg-text)] @[40rem]:font-medium">{c.value}</span>
            {c.key === 'launches' && c.title && <span className="sr-only"> ({c.title})</span>}
          </span>
        ))}
        <span className="sr-only">. Show only {meta.label} in Analytics</span>
      </button>
    </li>
  )
}

/**
 * Retro, Steam and PlayStation side by side. One markup for both layouts:
 * from 40rem the rows line up under a header as a table; narrower, each
 * library is a block of labelled figures (the labels a table would carry in
 * its header move into the cells, and stay there for screen readers). A row
 * narrows the whole Analytics screen to that library.
 */
export function TgAnalyticsLibraries({ rows, className = '' }: { rows: TgaLibraryRow[]; className?: string }) {
  if (rows.length < 2) return null
  const head = libraryCells(rows[0], fmtHours)
  return (
    <TgAnalyticsCard label="Libraries compared" meta="lifetime figures" className={className}>
      {/* Capped: across a monitor-wide card the columns would drift too far apart to read as rows. */}
      <div className="max-w-[58rem]">
        <div aria-hidden className={`hidden items-end gap-x-2 border-b border-[var(--tg-border)] pb-2 text-[11px] font-medium leading-tight text-[var(--tg-muted)] @[40rem]:grid ${TGA_LIB_TABLE}`}>
          <span>Library</span>
          {head.map(c => <span key={c.key} className="text-right" title={c.key === 'median' ? c.title : undefined}>{c.head}</span>)}
        </div>
        <ul className="flex flex-col gap-2 @[40rem]:-mx-2 @[40rem]:mt-1 @[40rem]:gap-0">
          {rows.map(r => <Row key={r.library} row={r} />)}
        </ul>
      </div>
    </TgAnalyticsCard>
  )
}
