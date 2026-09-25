import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TgaBarRow } from './tgAnalyticsModel'
import { TGA_ROW_H, fmtInt } from './tgAnalyticsFormat'

/**
 * Horizontal bars, one series: every bar in the accent, length = count,
 * the count in a right-aligned column so the numbers scan as a table. A row
 * with a target opens that shelf; a folded "N more" row only lists its names.
 */
export function TgAnalyticsBarList({ rows, icon, onOpen, openLabel }: {
  rows: TgaBarRow[]
  icon?: (row: TgaBarRow) => ReactNode
  onOpen: (row: TgaBarRow) => void
  /** "Open the PS2 shelf" — the action a row performs, for its accessible name. */
  openLabel: (row: TgaBarRow) => string
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  const cols = icon
    ? 'grid-cols-[20px_minmax(4.5rem,7.5rem)_minmax(0,1fr)_3.25rem_14px]'
    : 'grid-cols-[minmax(5rem,8.5rem)_minmax(0,1fr)_3.25rem_14px]'

  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {rows.map(row => {
        const body = (
          <>
            {icon && <span className="grid place-items-center text-[var(--tg-text-2)]">{icon(row)}</span>}
            <span className={`truncate text-[13px] ${row.target ? 'font-medium text-[var(--tg-text)]' : 'text-[var(--tg-muted)]'}`}>
              {row.label}
              {row.title && <span className="sr-only">: {row.title}</span>}
            </span>
            <span className="flex h-full items-center">
              <span
                className={`h-2.5 rounded-r-[4px] transition-[filter] duration-150 [@media(hover:hover)]:group-hover:brightness-110 ${row.target ? 'bg-[var(--tg-accent)]' : 'bg-[color-mix(in_srgb,var(--tg-accent)_45%,var(--tg-panel))]'}`}
                style={{ width: `max(3px, ${(row.count / max) * 100}%)` }}
              />
            </span>
            <span className="text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(row.count)}</span>
            <span className="grid place-items-center text-[var(--tg-faint)]">
              {row.target && <ChevronRight size={14} strokeWidth={2.2} aria-hidden />}
            </span>
          </>
        )
        const grid = `grid w-full ${cols} items-center gap-x-3 rounded-[10px] px-2 text-left ${TGA_ROW_H}`
        return (
          <li key={row.key}>
            {row.target ? (
              <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={`${openLabel(row)}, ${fmtInt(row.count)}`}
                className={`${grid} group transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]`}
              >
                {body}
              </button>
            ) : (
              <div className={grid} title={row.title}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
