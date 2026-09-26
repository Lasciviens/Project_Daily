import type { TgaPlaytimeBucket } from './tgAnalyticsMore'
import { fmtInt, plural } from './tgAnalyticsFormat'
import { TGA_LIB_META, bucketText, type TgaLib } from './tgAnalyticsPlay'

/**
 * Games per play-time bucket as horizontal bars, each split by library in the
 * libraries' own colours (2px of card between segments). The colours are
 * named in the legend, and every bar's numbers are in its label for screen
 * readers and in its tooltip.
 */
export function TgAnalyticsPlaytimeBars({ buckets, libs, total }: { buckets: TgaPlaytimeBucket[]; libs: TgaLib[]; total: number }) {
  const max = Math.max(1, ...buckets.map(b => b.count))
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-medium text-[var(--tg-text-2)]">{plural(total, 'game')} by lifetime play time</p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {buckets.map(b => (
          <li key={b.key} title={bucketText(b, libs)} className="grid min-h-[30px] grid-cols-[4.5rem_minmax(0,1fr)_2.75rem] items-center gap-x-3">
            <span className="truncate text-[12.5px] text-[var(--tg-text-2)]">
              {b.label}<span className="sr-only">: {bucketText(b, libs)}</span>
            </span>
            <span aria-hidden className="flex h-2.5 items-center">
              {b.count > 0 && (
                <span className="flex h-full gap-[2px] overflow-hidden rounded-r-[4px]" style={{ width: `max(4px, ${(b.count / max) * 100}%)` }}>
                  {libs.filter(l => b.parts[l] > 0).map(l => (
                    <span key={l} className="h-full min-w-[2px]" style={{ flexGrow: b.parts[l], flexBasis: 0, background: TGA_LIB_META[l].color }} />
                  ))}
                </span>
              )}
            </span>
            <span aria-hidden className={`text-right text-[13px] font-semibold tabular-nums ${b.count ? 'text-[var(--tg-text)]' : 'text-[var(--tg-faint)]'}`}>{fmtInt(b.count)}</span>
          </li>
        ))}
      </ul>
      <ul aria-label="Legend" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--tg-muted)]">
        {libs.map(l => (
          <li key={l} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TGA_LIB_META[l].color }} />
            {TGA_LIB_META[l].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
