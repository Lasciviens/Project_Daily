import { fmtInt, plural } from './tgAnalyticsFormat'
import { TGA_LIB_LABEL, libFill, type TgaActivityRow } from './tgAnalyticsActivity'
import type { TgaLib } from './tgAnalyticsSeries'
import { TgStatusIcon } from './TgStatusIcon'

// The Activity chart's small pieces: its axis label, tooltip, completion
// marker and legend. The marker is the Completed status badge (a blue disc
// with a white check) so it reads the same as everywhere else on the page.

interface TickProps { x?: number | string; y?: number | string; payload?: { value?: unknown } }

/** Two-line axis label: the month (or day), and under it the year (or month) where that changes. */
export function TgActivityAxisTick({ x, y, label }: TickProps & { label?: { line1: string; line2?: string } }) {
  if (!label) return null
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <text textAnchor="middle" dy={11} fontSize={11} fill="var(--tg-muted)">{label.line1}</text>
      {label.line2 && <text textAnchor="middle" dy={25} fontSize={10.5} fontWeight={600} fill="var(--tg-faint)">{label.line2}</text>}
    </g>
  )
}

const Swatch = ({ lib }: { lib: TgaLib }) => (
  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: libFill(lib) }} />
)

/** The column's total first, then each library and the completions finished in it. */
export function TgActivityTip({ row, libraries }: { row?: TgaActivityRow; libraries: TgaLib[] }) {
  if (!row) return null
  const line = 'flex items-center gap-2 text-[12px]'
  return (
    <div className="min-w-[10rem] rounded-[10px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] px-3 py-2 shadow-[shadow:var(--tg-menu-shadow)]">
      <p className="text-[13px] font-semibold text-[var(--tg-text)]">{plural(row.count, 'game')} last played</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--tg-muted)]">{row.full}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {libraries.map(lib => (
          <li key={lib} className={line}>
            <Swatch lib={lib} />
            <span className="flex-1 text-[var(--tg-text-2)]">{TGA_LIB_LABEL[lib]}</span>
            <span className="font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(row[lib])}</span>
          </li>
        ))}
        <li className={`${line} ${libraries.length ? 'mt-1 border-t border-[var(--tg-border)] pt-1.5' : ''}`}>
          <TgStatusIcon status="completed" size={11} />
          <span className="flex-1 text-[var(--tg-text-2)]">Completions</span>
          <span className="font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(row.completed)}</span>
        </li>
      </ul>
    </div>
  )
}

/**
 * Sits just above a column's stack: a numbered pill where the column is wide
 * enough, a plain disc where it isn't (the tooltip and table have the number).
 */
export function TgActivityMarker({ cx, cy, n, pill }: { cx?: number; cy?: number; n: number | null; pill: boolean }) {
  if (n == null || cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g />
  if (!pill) {
    return <circle cx={cx} cy={cy - 7} r={4} fill="var(--tg-blue)" stroke="var(--tg-panel)" strokeWidth={1.5} />
  }
  const text = fmtInt(n)
  const w = 17 + text.length * 6
  return (
    <g transform={`translate(${cx - w / 2},${cy - 20})`} aria-hidden>
      <rect width={w} height={15} rx={7.5} fill="var(--tg-blue)" stroke="var(--tg-panel)" strokeWidth={1.5} />
      <path d="M4.5 7.8 6.9 10.2 11 5.4" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <text x={12.5} y={11} fontSize={10} fontWeight={700} fill="#fff">{text}</text>
    </g>
  )
}

/** Every colour on the chart, named. */
export function TgActivityLegend({ libraries, completions }: { libraries: TgaLib[]; completions: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--tg-text-2)]">
      {libraries.map(lib => (
        <li key={lib} className="flex items-center gap-1.5"><Swatch lib={lib} />{TGA_LIB_LABEL[lib]}</li>
      ))}
      {completions && (
        <li className="flex items-center gap-1.5"><TgStatusIcon status="completed" size={12} />Completions (by finish date)</li>
      )}
    </ul>
  )
}
