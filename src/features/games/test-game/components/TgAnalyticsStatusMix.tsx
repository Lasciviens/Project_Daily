import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { STATUS_TEXT } from '../testGameModel'
import type { TgaLibrary, TgaStatus } from './tgAnalyticsModel'
import { TGA_ROW_H, fmtInt, fmtPct } from './tgAnalyticsFormat'
import { openLibrary } from './tgAnalyticsNav'
import { TgStatusIcon } from './TgStatusIcon'
import { TgAnalyticsCard } from './TgAnalyticsCard'

const ROW = `-mx-2 grid w-[calc(100%+1rem)] grid-cols-[15px_minmax(0,1fr)_auto_2.5rem_14px] items-center gap-x-3 rounded-[10px] px-2 text-left transition-colors ${TGA_ROW_H}`

/**
 * Part-to-whole in one bar: each status's share of the games in view, in the
 * page's status colours, separated by 2px of the card's own surface. Colour
 * never works alone — every segment has its glyph, name, count and share in
 * the legend, and pointing at either one highlights both. A status with games
 * opens them in the Library.
 */
export function TgAnalyticsStatusMix({ mix, total, library }: {
  mix: { status: TgaStatus; count: number }[]
  total: number
  library: TgaLibrary
}) {
  const [hot, setHot] = useState<TgaStatus | null>(null)
  const present = mix.filter(m => m.count > 0)

  return (
    <TgAnalyticsCard label="Status mix" meta={`${fmtInt(total)} ${total === 1 ? 'game' : 'games'}`}>
      <div aria-hidden className="flex h-[14px] gap-[2px] overflow-hidden rounded-[5px]" onPointerLeave={() => setHot(null)}>
        {present.map(m => (
          <span
            key={m.status}
            data-status={m.status}
            onPointerEnter={() => setHot(m.status)}
            className="h-full min-w-[4px] bg-[var(--st)] transition-opacity duration-150"
            style={{ flexGrow: m.count, flexBasis: 0, opacity: hot && hot !== m.status ? 0.28 : 1 }}
          />
        ))}
      </div>

      <ul className="mt-5 flex flex-col gap-0.5" onPointerLeave={() => setHot(null)}>
        {mix.map(m => {
          const body = (
            <>
              <TgStatusIcon status={m.status} size={15} />
              <span className={`min-w-0 truncate text-[13px] ${m.count ? 'text-[var(--tg-text-2)]' : 'text-[var(--tg-faint)]'}`}>
                {STATUS_TEXT[m.status]}
              </span>
              <span className="text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(m.count)}</span>
              <span className="text-right text-[12px] tabular-nums text-[var(--tg-muted)]">{fmtPct(m.count, total)}</span>
              <span className="grid place-items-center text-[var(--tg-faint)]">
                {m.count > 0 && <ChevronRight size={14} strokeWidth={2.2} aria-hidden />}
              </span>
            </>
          )
          return (
            <li key={m.status} onPointerEnter={() => setHot(m.count ? m.status : null)}>
              {m.count > 0 ? (
                <button
                  type="button"
                  onClick={() => openLibrary({ library, status: m.status })}
                  aria-label={`Show ${fmtInt(m.count)} ${STATUS_TEXT[m.status]} ${m.count === 1 ? 'game' : 'games'} in the library, ${fmtPct(m.count, total)}`}
                  className={`${ROW} ${hot === m.status ? 'bg-[var(--tg-hover)]' : ''} [@media(hover:none)]:active:bg-[var(--tg-hover)]`}
                >
                  {body}
                </button>
              ) : (
                <div className={ROW}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </TgAnalyticsCard>
  )
}
