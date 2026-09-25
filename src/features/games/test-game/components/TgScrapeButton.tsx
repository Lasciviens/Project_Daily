import { Sparkles } from 'lucide-react'
import { ScrapeGameButton } from '../../components/ScrapeGameButton'
import { TgConfirmDialog } from './TgConfirmDialog'

// Only a real failure is red; "no match" is an answer, not an error.
const OUTCOME_TONE: Record<string, string> = { matched: '!text-[var(--tg-green)]', error: '!text-[var(--tg-red)]', idle: '' }

/**
 * The shared one-game ScreenScraper scrape (dry run → approve → apply) drawn
 * as this page's secondary button, with the approval in the page's tokens.
 */
export function TgScrapeButton({ gameId, title }: { gameId: string; title: string }) {
  return (
    <ScrapeGameButton
      gameId={gameId}
      title={title}
      renderTrigger={({ onClick, busy, outcome, statusText, hint }) => (
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          title={hint}
          aria-label={statusText ? `Scrape — ${statusText}` : `Scrape ${title} on ScreenScraper`}
          className={`tg-btn tg-btn-secondary !px-3 ${OUTCOME_TONE[outcome ?? 'idle'] ?? '!text-[var(--tg-muted)]'}`}
        >
          <Sparkles aria-hidden className={`h-4 w-4 shrink-0 ${busy ? 'animate-pulse' : ''}`} strokeWidth={2} />
          <span className="truncate">{statusText ?? 'Scrape'}</span>
        </button>
      )}
      renderConfirm={c => <TgConfirmDialog {...c} />}
    />
  )
}
