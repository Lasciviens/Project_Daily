import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { scrapeBatch, type ScrapeResult } from '../api/screenscraperApi'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'

// One game, one scrape. Separate from the panel's bulk loop because the
// reaching-for-it is different: the panel is "go fill everything", this is
// "this one row is wrong, fix it now".
//
// It lives in the detail modal, which is the ONE surface both the library grid
// and the Needs-Review list open — so a row anywhere in the app is one tap away
// from it, and there is no second copy of this behaviour to keep in sync.

const OUTCOME_TEXT: Record<ScrapeResult['outcome'], string> = {
  matched: 'Updated ✓',
  no_match: 'No match on ScreenScraper',
  unmatchable: 'Cannot be matched',
  error: 'Failed',
}

export function ScrapeGameButton({ gameId, title, className = '' }: {
  gameId: string
  title: string
  className?: string
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ScrapeResult['outcome'] | null>(null)

  async function run() {
    setBusy(true); setOutcome(null)
    const tid = toast.loading(`Scraping ${title}…`)
    try {
      const batch = await scrapeBatch({ limit: 1, gameIds: [gameId], dryRun: false, media: true })
      toast.dismiss(tid)

      // The function answers its own refusals (no credentials, no cached system
      // ids, daily quota spent) instead of throwing, so those get their real
      // reason rather than a generic failure.
      if (batch.status !== 'ok') {
        setOutcome('error')
        toast.warning(batch.message ?? `Cannot scrape right now (${batch.status})`)
        return
      }

      const r = batch.results?.[0]
      if (!r) { setOutcome('error'); toast.warning('Nothing came back for this game'); return }
      setOutcome(r.outcome)

      if (r.outcome === 'matched') {
        const bits = [
          r.filled?.length ? `${r.filled.length} field${r.filled.length === 1 ? '' : 's'}` : null,
          r.media?.length ? `${r.media.length} image${r.media.length === 1 ? '' : 's'}` : null,
        ].filter(Boolean)
        toast.success(bits.length ? `${title}: ${bits.join(' + ')} ✓` : `${title}: already complete`)
        qc.invalidateQueries({ queryKey: ['games'] })
      } else {
        // A miss is a real answer, not a failure — say which kind it was.
        toast.warning(`${title}: ${OUTCOME_TEXT[r.outcome]}${r.reason ? ` — ${r.reason}` : ''}`)
      }
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_scrape_one: ${msg}`)
      toast.error(msg)
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  const tone = outcome === 'matched' ? 'border-green-400 text-green-700 dark:text-green-400'
    : outcome ? 'border-amber-400 text-amber-700 dark:text-amber-400'
    : 'border-ink-200 text-ink-600 hover:border-accent-400 hover:text-accent-700'

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={`Fetch metadata and artwork for ${title} from ScreenScraper`}
      className={`flex-shrink-0 min-h-[44px] px-3 text-xs rounded-lg border bg-cream-50 transition-colors disabled:opacity-50 ${tone} ${className}`}
    >
      {busy ? 'Scraping…' : outcome ? OUTCOME_TEXT[outcome] : '🎲 Scrape'}
    </button>
  )
}
