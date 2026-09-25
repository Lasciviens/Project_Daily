import { useState } from 'react'
import { STATUS_TEXT } from '../testGameModel'
import type { TgaStatus } from './tgAnalyticsModel'
import { fmtInt, fmtPct } from './tgAnalyticsFormat'
import { TgStatusIcon } from './TgStatusIcon'
import { TgAnalyticsCard } from './TgAnalyticsCard'

/**
 * Part-to-whole in one bar: each status's share of the games in view, in the
 * page's status colours, separated by 2px of the card's own surface. Colour
 * never works alone — every segment has its glyph, name, count and share in
 * the legend, and pointing at either one highlights both.
 */
export function TgAnalyticsStatusMix({ mix, total }: { mix: { status: TgaStatus; count: number }[]; total: number }) {
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
        {mix.map(m => (
          <li
            key={m.status}
            onPointerEnter={() => setHot(m.count ? m.status : null)}
            className={`flex min-h-[34px] items-center gap-3 rounded-[10px] px-2 -mx-2 transition-colors ${hot === m.status ? 'bg-[var(--tg-hover)]' : ''}`}
          >
            <TgStatusIcon status={m.status} size={15} />
            <span className={`min-w-0 flex-1 truncate text-[13px] ${m.count ? 'text-[var(--tg-text-2)]' : 'text-[var(--tg-faint)]'}`}>
              {STATUS_TEXT[m.status]}
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(m.count)}</span>
            <span className="w-10 text-right text-[12px] tabular-nums text-[var(--tg-muted)]">{fmtPct(m.count, total)}</span>
          </li>
        ))}
      </ul>
    </TgAnalyticsCard>
  )
}
