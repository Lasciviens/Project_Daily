import { HardDrive } from 'lucide-react'
import type { GameStorage } from '../../../scraper/ssApi'
import { formatBytes } from './tgScrapeModel'

/**
 * In the Save bar: what this game keeps now and what this save will store —
 * copies (estimated before download) plus their record in the database.
 * Earlier ScreenScraper copies of the same pictures are replaced, not added.
 */
export function TgScrapeStorageLine({ now, copies, record }: { now: GameStorage | null; copies: number; record: number }) {
  const ssNow = now?.groups.find(g => g.category === 'screenscraper')?.bytes ?? 0
  return (
    <p className="flex items-start gap-1.5 text-[11.5px] leading-snug tabular-nums text-[var(--tg-text-2)]">
      <HardDrive className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {now ? <>This game keeps <strong>{formatBytes(now.total)}</strong> now · </> : null}
        this save stores ≈ <strong>{formatBytes(copies + record)}</strong>
        {' '}({copies ? `copies ≈ ${formatBytes(copies)}, ` : 'no copies, '}record ≈ {formatBytes(record)})
        {ssNow > 0 && <> · replaces its earlier ScreenScraper copies ({formatBytes(ssNow)})</>}
      </span>
    </p>
  )
}
