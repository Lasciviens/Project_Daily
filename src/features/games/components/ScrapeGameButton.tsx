import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { scrapeBatch, type ScrapeResult } from '../api/screenscraperApi'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'

// One game, one scrape. Separate from the panel's bulk loop because the
// reaching-for-it is different: the panel is "go fill everything", this is
// "this one row is wrong, fix it now".
//
// It lives in the detail modal, which is the ONE surface both the library grid
// and the Needs-Review list open, so a row anywhere in the app is one tap away
// from it, and there is no second copy of this behaviour to keep in sync.
//
// TWO STEPS, never one. The first press is a DRY RUN: nothing is written, and
// the match ScreenScraper found — its title, the system it was searched in,
// and the fields it would fill — is shown for approval first. A wrong match is
// not a rare edge case here (a folder name maps to several ScreenScraper
// systems, and a ROM's filename is all the matcher has), and this app has no
// undo for a write that lands.

const OUTCOME_TEXT: Record<ScrapeResult['outcome'], string> = {
  matched: 'Updated ✓',
  no_match: 'No match on ScreenScraper',
  unmatchable: 'Cannot be matched',
  // Only reachable from the batch path, where the reviewed entry and the one
  // the apply fetched turned out to differ. Listed so the map stays total.
  stale_proposal: 'Their entry changed — look it up again',
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
  const [preview, setPreview] = useState<ScrapeResult | null>(null)

  /** Shared handling for the "the function refused" and "nothing came back"
   *  answers, which both runs can produce. Returns the usable result, or null. */
  function readBatch(batch: Awaited<ReturnType<typeof scrapeBatch>>): ScrapeResult | null {
    // The function answers its own refusals (no credentials, no cached system
    // ids, daily quota spent) instead of throwing, so those get their real
    // reason rather than a generic failure.
    if (batch.status !== 'ok') {
      setOutcome('error')
      toast.warning(batch.message ?? `Cannot scrape right now (${batch.status})`)
      return null
    }
    const r = batch.results?.[0]
    if (!r) { setOutcome('error'); toast.warning('Nothing came back for this game'); return null }
    return r
  }

  async function runPreview() {
    setBusy(true); setOutcome(null)
    const tid = toast.loading(`Looking up ${title}…`)
    try {
      const r = readBatch(await scrapeBatch({ limit: 1, gameIds: [gameId], dryRun: true, media: true }))
      toast.dismiss(tid)
      if (!r) return
      if (r.outcome !== 'matched') {
        // A miss is a real answer, not a failure — say which kind it was, and
        // there is nothing to confirm.
        setOutcome(r.outcome)
        toast.warning(`${title}: ${OUTCOME_TEXT[r.outcome]}${r.reason ? ` — ${r.reason}` : ''}`)
        return
      }
      setPreview(r)
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_preview_one: ${msg}`)
      toast.error(msg)
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  async function applyScrape() {
    setBusy(true)
    const tid = toast.loading(`Scraping ${title}…`)
    try {
      const r = readBatch(await scrapeBatch({ limit: 1, gameIds: [gameId], dryRun: false, media: true }))
      toast.dismiss(tid)
      if (!r) return
      setOutcome(r.outcome)
      if (r.outcome === 'matched') {
        const bits = [
          r.filled?.length ? `${r.filled.length} field${r.filled.length === 1 ? '' : 's'}` : null,
          r.media?.length ? `${r.media.length} image${r.media.length === 1 ? '' : 's'}` : null,
        ].filter(Boolean)
        toast.success(bits.length ? `${title}: ${bits.join(' + ')} ✓` : `${title}: already complete`)
        qc.invalidateQueries({ queryKey: ['games'] })
      } else {
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
      setPreview(null)
    }
  }

  const tone = outcome === 'matched' ? 'border-green-400 text-green-700 dark:text-green-400'
    : outcome ? 'border-amber-400 text-amber-700 dark:text-amber-400'
    : 'border-ink-200 text-ink-600 hover:border-accent-400 hover:text-accent-700'

  const fields = preview?.would_fill ?? []

  return (
    <>
      <button
        type="button"
        onClick={runPreview}
        disabled={busy}
        title={`Look up ${title} on ScreenScraper — you approve the match before anything is saved`}
        className={`flex-shrink-0 min-h-[44px] px-3 text-xs rounded-lg border bg-cream-50 transition-colors disabled:opacity-50 ${tone} ${className}`}
      >
        {busy ? 'Working…' : outcome ? OUTCOME_TEXT[outcome] : '🎲 Scrape'}
      </button>

      <ConfirmDialog
        open={!!preview}
        title="Save this match?"
        confirmLabel="Save"
        message={
          `ScreenScraper matched "${title}" to "${preview?.matched_title ?? '—'}"`
          + (preview?.system ? `, searched as ${preview.system}.` : '.')
          + (fields.length
            ? `\n\nIt would fill: ${fields.join(', ')}.`
            : '\n\nIt would fill no new fields — every one this game is missing is empty on their side too.')
          + '\n\nOnly empty fields are written; anything you have already entered stays. Artwork is downloaded and re-hosted.'
        }
        onConfirm={applyScrape}
        onClose={() => setPreview(null)}
      />
    </>
  )
}
