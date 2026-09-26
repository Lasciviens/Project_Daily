import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useCleanupStorage, useScraperStatus, useStorageUsage } from '../../../scraper/useScrape'
import { formatBytes } from './tgScrapeModel'

const PLAN_BYTES = 1024 * 1024 * 1024
const CATEGORY: Record<string, { label: string; note: string; color: string }> = {
  esde_original: { label: 'ES-DE originals', note: 'full-size cover images uploaded by the handheld — it keeps them on its SD card too', color: 'var(--tg-purple)' },
  esde_cover: { label: 'ES-DE covers', note: 'the small covers the library shows', color: 'var(--tg-blue)' },
  screenscraper: { label: 'ScreenScraper', note: 'copies saved by Scrape', color: 'var(--tg-green)' },
  pending: { label: 'Old previews', note: "left over from the old scraper's review", color: 'var(--tg-grey)' },
}
const ORDER = ['esde_original', 'esde_cover', 'screenscraper', 'pending']

/**
 * How full the artwork bucket is, by what fills it, against the budget and
 * the plan's 1 GB — plus today's ScreenScraper allowance, and a way to free
 * ScreenScraper copies nothing uses any more. Reads Storage from one SQL query
 * on the server (migration 104), not the ScreenScraper API.
 */
export function TgScrapeStorage({ budgetMb, enabled }: { budgetMb: number; enabled: boolean }) {
  const storage = useStorageUsage(enabled)
  const status = useScraperStatus(enabled)
  const cleanup = useCleanupStorage()
  const [preview, setPreview] = useState<{ files: number; bytes: number } | null>(null)
  const budget = Math.min(budgetMb, storage.data?.hard_cap_mb ?? 950) * 1024 * 1024

  if (storage.isLoading) return <div className="tg-skeleton h-24 rounded-xl" aria-label="Loading storage" />
  if (storage.error || !storage.data) {
    return (
      <p className="rounded-xl bg-[var(--tg-red-soft)] p-3 text-[12.5px] leading-snug text-[var(--tg-red)]">
        {storage.error ? storage.error.message : 'Storage usage cannot be read until migration 104 is applied — and until then nothing is copied to storage (images are shown online instead).'}
      </p>
    )
  }
  const { total, groups } = storage.data
  const byCat = new Map(groups.map(g => [g.category, g]))
  const account = status.data?.account

  const findLeftovers = () => cleanup.mutate(true, { onSuccess: r => setPreview(r.status === 'ok' ? { files: r.files, bytes: r.bytes } : null) })
  const deleteLeftovers = () => cleanup.mutate(false, { onSuccess: () => setPreview(null) })

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
      {(byCat.get('esde_original')?.bytes ?? 0) > 100 * 1024 * 1024 && (
        <p className="rounded-xl bg-[var(--tg-panel-2)] px-3 py-2 text-[12px] leading-snug tg-muted">
          The biggest win is the ES-DE originals: they duplicate the small covers and live on the handheld's SD card anyway. Stop uploading them from the RP6 widget (covers-only sync) and they can be cleared — that is the handheld's setting, not this page's.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!preview ? (
          <button type="button" onClick={findLeftovers} disabled={cleanup.isPending} className="tg-btn tg-btn-secondary !px-3 !text-[12.5px]">
            <Trash2 className="h-4 w-4" aria-hidden /> {cleanup.isPending ? 'Checking…' : 'Find unused ScreenScraper copies'}
          </button>
        ) : preview.files === 0 ? (
          <p className="text-[12.5px] tg-muted">Nothing unused to delete.</p>
        ) : (
          <>
            <p className="text-[12.5px]">{preview.files} unused cop{preview.files === 1 ? 'y' : 'ies'} · {formatBytes(preview.bytes)}</p>
            <button type="button" onClick={deleteLeftovers} disabled={cleanup.isPending} className="tg-btn !px-3 !text-[12.5px] bg-[var(--tg-red)] text-white">
              {cleanup.isPending ? 'Deleting…' : 'Delete them'}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="tg-btn tg-btn-secondary !px-3 !text-[12.5px]">Cancel</button>
          </>
        )}
      </div>
      {account && (
        <p className="text-[12px] tabular-nums tg-muted">
          ScreenScraper today: {account.used.toLocaleString('en-GB')} of {account.max.toLocaleString('en-GB')} requests
          {account.ko_max ? ` · ${(account.ko_used ?? 0).toLocaleString('en-GB')} of ${account.ko_max.toLocaleString('en-GB')} misses` : ''}
          {account.premium ? ` · ${account.threads} threads` : ' · not premium'} (shared with the handheld).
        </p>
      )}
    </div>
  )
}
