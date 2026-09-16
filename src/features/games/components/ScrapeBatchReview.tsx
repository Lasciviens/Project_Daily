import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { scrapeBatch, type ScrapeResult } from '../api/screenscraperApi'
import { systemMeta } from '../systemMeta'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import type { Game } from '../types'

// Batch scraping with a human in the middle.
//
// The old panel ran a dry run, printed a summary, and then ran the real thing
// over the SAME candidates — so approving meant approving all of them at once,
// sight unseen. Here a batch is fetched as a dry run, every match is listed
// with what it matched to and what it would fill, and only the rows still
// ticked are written.
//
// Candidates are chosen HERE, not by the edge function, for one reason: a
// skipped game still has no description, so a server-side "next N missing
// metadata" pick would hand back the same rows forever. The client already has
// the whole library, so it can skip what has been seen this session.

const BATCH = 6

export function ScrapeBatchReview({ games }: { games: Game[] }) {
  const qc = useQueryClient()
  const [systems, setSystems] = useState<string[]>([])
  const [batch, setBatch] = useState<ScrapeResult[] | null>(null)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const systemOptions = useMemo(
    () => [...new Set(games.flatMap(g => g.platforms.map(p => p.esde_system ?? p.system)))].filter(Boolean).sort() as string[],
    [games],
  )

  // Still missing the one field the scraper is here to fill, not already dealt
  // with in this session, and inside the chosen systems.
  const candidates = useMemo(() => games.filter(g =>
    !g.description
    && !seen.has(g.id)
    && (!systems.length || g.platforms.some(p => systems.includes(p.esde_system ?? p.system))),
  ), [games, seen, systems])

  async function fetchBatch() {
    const next = candidates.slice(0, BATCH)
    if (!next.length) { toast.warning('Nothing left to review with these systems.'); return }
    setBusy(true)
    const tid = toast.loading(`Looking up ${next.length} games…`)
    try {
      const res = await scrapeBatch({ limit: BATCH, gameIds: next.map(g => g.id), dryRun: true, media: true })
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? `Cannot scrape right now (${res.status})`); return }
      const results = res.results ?? []
      setBatch(results)
      // Pre-tick the matches only. A no-match has nothing to approve, and it is
      // marked seen so the next batch moves on instead of re-offering it.
      setApproved(new Set(results.filter(r => r.outcome === 'matched').map(r => r.id)))
      setSeen(prev => new Set([...prev, ...results.filter(r => r.outcome !== 'matched').map(r => r.id)]))
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_batch_preview: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  async function applyApproved() {
    const ids = [...approved]
    if (!ids.length) return
    setBusy(true)
    const tid = toast.loading(`Saving ${ids.length} games…`)
    try {
      const res = await scrapeBatch({ limit: BATCH, gameIds: ids, dryRun: false, media: true })
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? `Cannot scrape right now (${res.status})`); return }
      const saved = (res.results ?? []).filter(r => r.outcome === 'matched').length
      toast.success(`${saved} game${saved === 1 ? '' : 's'} updated ✓`)
      qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_batch_apply: ${msg}`)
      toast.error(msg)
    } finally {
      setBusy(false)
      // Everything in this batch has now been decided either way.
      setSeen(prev => new Set([...prev, ...(batch ?? []).map(r => r.id)]))
      setBatch(null); setApproved(new Set())
    }
  }

  function toggle(id: string) {
    setApproved(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Batch — {BATCH} at a time, you approve each one</h3>
        <p className="text-xs text-ink-500 mt-0.5">
          Nothing is written until you press Save. Only fields your game is missing get filled.
        </p>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">
          Systems {systems.length ? `(${systems.length} selected)` : '(all)'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {systemOptions.map(sys => {
            const on = systems.includes(sys)
            return (
              <button key={sys} type="button"
                onClick={() => setSystems(prev => on ? prev.filter(x => x !== sys) : [...prev, sys])}
                className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                  on ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
                }`}>
                {systemMeta(sys).label}
              </button>
            )
          })}
          {systems.length > 0 && (
            <button type="button" onClick={() => setSystems([])}
              className="min-h-[36px] px-2.5 text-xs text-ink-500 underline">Clear</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={fetchBatch} disabled={busy || !candidates.length}
          className="min-h-[44px] px-3 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-40 transition-colors">
          {busy ? 'Working…' : `Look up next ${Math.min(BATCH, candidates.length)}`}
        </button>
        <span className="text-xs text-ink-500">{candidates.length} still missing metadata</span>
      </div>

      {batch && (
        <div className="space-y-2">
          {batch.map(r => {
            const ok = r.outcome === 'matched'
            const on = approved.has(r.id)
            return (
              <div key={r.id} className={`rounded-lg border p-2.5 ${on ? 'border-accent-300 bg-accent-50/40' : 'border-ink-200 bg-cream-50'}`}>
                <div className="flex items-start gap-2">
                  {ok && (
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)}
                      className="mt-1 w-4 h-4 accent-current text-accent-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-800 truncate">{r.title}</p>
                    {ok ? (
                      <>
                        <p className="text-xs text-ink-600 truncate">
                          → matched to <span className="font-medium">{r.matched_title ?? '—'}</span>
                          {r.system && <span className="text-ink-400"> · searched as {r.system}</span>}
                        </p>
                        <p className="text-[11px] text-ink-400 mt-0.5">
                          {r.would_fill?.length ? `Would fill: ${r.would_fill.join(', ')}` : 'Would fill nothing new'}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {r.outcome === 'no_match' ? 'No match on ScreenScraper' : r.outcome === 'unmatchable' ? 'Cannot be matched' : 'Failed'}
                        {r.reason ? ` — ${r.reason}` : ''}
                        {' · try the search below'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={applyApproved} disabled={busy || approved.size === 0}
              className="min-h-[44px] px-3 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-40 transition-colors">
              Save {approved.size} approved
            </button>
            <button type="button" onClick={() => { setSeen(prev => new Set([...prev, ...batch.map(r => r.id)])); setBatch(null); setApproved(new Set()) }}
              disabled={busy}
              className="min-h-[44px] px-3 text-sm text-ink-500 rounded-lg border border-ink-200 disabled:opacity-40">
              Skip all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
