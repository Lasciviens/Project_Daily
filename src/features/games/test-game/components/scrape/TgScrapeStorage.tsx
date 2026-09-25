import { useScraperStatus, useStorageUsage } from '../../../scraper/useScrape'
import { formatBytes } from './tgScrapeModel'

const PLAN_BYTES = 1024 * 1024 * 1024
const CATEGORY: Record<string, { label: string; note: string; color: string }> = {
  esde_original: { label: 'ES-DE originals', note: 'full-size images from the handheld (it keeps its own copies too)', color: 'var(--tg-purple)' },
  esde_cover: { label: 'ES-DE covers', note: 'the small covers the library shows', color: 'var(--tg-blue)' },
  screenscraper: { label: 'ScreenScraper', note: 'copies saved by Scrape', color: 'var(--tg-green)' },
  pending: { label: 'Old previews', note: "left over from the old scraper's review — safe to delete", color: 'var(--tg-grey)' },
}
const ORDER = ['esde_original', 'esde_cover', 'screenscraper', 'pending']

/**
 * How full the artwork bucket is, by what fills it, against the budget and
 * the plan's 1 GB — plus today's ScreenScraper allowance. Reads Storage from
 * one SQL query (migration 104), not the ScreenScraper API.
 */
export function TgScrapeStorage({ budgetMb, enabled }: { budgetMb: number; enabled: boolean }) {
  const storage = useStorageUsage(enabled)
  const status = useScraperStatus(enabled)
  const budget = budgetMb * 1024 * 1024

  if (storage.isLoading) return <div className="tg-skeleton h-24 rounded-xl" aria-label="Loading storage" />
  if (storage.error || !storage.data) {
    return (
      <p className="rounded-xl bg-[var(--tg-red-soft)] p-3 text-[12.5px] leading-snug text-[var(--tg-red)]">
        {storage.error ? storage.error.message : 'Storage usage cannot be read until migration 104 is applied — and until then nothing is saved to storage (images are linked instead).'}
      </p>
    )
  }
  const { total, groups } = storage.data
  const byCat = new Map(groups.map(g => [g.category, g]))
  const account = status.data?.account

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[20px] font-bold tabular-nums">{formatBytes(total)}</span>
          <span className="text-[12px] tabular-nums tg-muted">budget {formatBytes(budget)} · plan 1 GB</span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-[var(--tg-panel-2)]" role="img" aria-label={`${formatBytes(total)} of 1 GB used`}>
          <div className="flex h-full">
            {ORDER.map(k => {
              const g = byCat.get(k)
              if (!g?.bytes) return null
              return <span key={k} style={{ width: `${Math.min(100, (g.bytes / PLAN_BYTES) * 100)}%`, background: CATEGORY[k].color }} />
            })}
          </div>
          <span aria-hidden className="absolute inset-y-0 w-[2px] bg-[var(--tg-red)]" style={{ left: `${Math.min(100, (budget / PLAN_BYTES) * 100)}%` }} />
        </div>
        <p className="mt-1 text-[11px] tg-faint">The red line is your budget.</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {ORDER.map(k => {
          const g = byCat.get(k)
          if (!g) return null
          return (
            <li key={k} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2 text-[12.5px]">
              <span aria-hidden className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY[k].color }} />
              <span className="min-w-0"><span className="font-semibold">{CATEGORY[k].label}</span> <span className="tg-muted">— {CATEGORY[k].note}</span></span>
              <span className="tabular-nums tg-muted">{formatBytes(g.bytes)} · {g.files}</span>
            </li>
          )
        })}
      </ul>
      {account && (
        <p className="text-[12px] tabular-nums tg-muted">
          ScreenScraper today: {account.used.toLocaleString('en-GB')} of {account.max.toLocaleString('en-GB')} requests used
          {account.premium ? ` · ${account.threads} threads` : ' · not premium'} (shared with the handheld).
        </p>
      )}
    </div>
  )
}
