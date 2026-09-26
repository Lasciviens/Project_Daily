import { HardDrive } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { useGameStorage } from '../../scraper/useScrape'
import type { GameStorageCategory } from '../../scraper/ssApi'
import { formatBytes } from './scrape/tgScrapeModel'

const LABEL: Record<GameStorageCategory, string> = {
  screenscraper: 'ScreenScraper copies',
  esde_original: 'Handheld originals',
  esde_cover: 'Handheld cover',
  database: 'Database rows',
}
const ORDER: GameStorageCategory[] = ['screenscraper', 'esde_original', 'esde_cover', 'database']

/**
 * What this one game keeps: its files in the game-media bucket (by source) and
 * the size of its own database rows. Online pictures cost nothing and are not
 * counted. Read for the open game only, once the selection has rested.
 */
export function TgDetailStorage({ game, settled = true }: { game: TgGame; settled?: boolean }) {
  const q = useGameStorage(settled ? game.id : null)
  if (!settled || q.isLoading || q.error || !q.data) return null
  const groups = ORDER.map(c => q.data!.groups.find(g => g.category === c)).filter(g => g && g.bytes > 0)
  const files = groups.filter(g => g!.category !== 'database').reduce((s, g) => s + g!.files, 0)

  return (
    <section className="flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-3.5">
      <h3 className="tg-section-label flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" aria-hidden /> Storage</h3>
      <p className="text-[13px] tabular-nums">
        <strong className="text-[15px]">{formatBytes(q.data.total)}</strong>
        <span className="tg-muted"> · {files} file{files === 1 ? '' : 's'} stored</span>
      </p>
      {groups.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[12.5px] tabular-nums">
          {groups.map(g => (
            <li key={g!.category} className="flex justify-between gap-3">
              <span className="tg-muted">{LABEL[g!.category]}{g!.category !== 'database' ? ` · ${g!.files}` : ''}</span>
              <span>{formatBytes(g!.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] tg-muted">Pictures shown online are not stored and cost nothing.</p>
    </section>
  )
}
