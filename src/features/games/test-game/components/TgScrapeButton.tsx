import { Wand2 } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'

/**
 * The detail's Scrape button: opens the Scrape page on this game, where the
 * search runs with its name and ROM filename and the results are chosen from —
 * the same page and the same search as More → Scrape, not a second flow.
 */
export function TgScrapeButton({ gameId, title }: { gameId: string; title: string }) {
  const openScrape = useTestGameStore(s => s.openScrape)
  return (
    <button
      type="button"
      onClick={() => openScrape(gameId)}
      aria-label={`Scrape ${title} on ScreenScraper`}
      className="tg-btn tg-btn-secondary !px-3"
    >
      <Wand2 aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="truncate">Scrape</span>
    </button>
  )
}
