import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchScreenScraperStatus, refreshScreenScraperSystems, scrapeBatch,
  type ScrapeResult,
} from '../api/screenscraperApi'
import { useAllGames } from '../hooks/useGames'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import type { Game } from '../types'

// Drives the ScreenScraper sync. The edge function deliberately handles a few
// games per call, so the loop that walks a whole library lives here — which is
// also what makes "stop after this batch" and real progress possible.
//
// Built for the run AFTER the first one as much as for the first: the same
// panel scrapes the whole library today, twenty games next month, or five
// named ones when a match turns out wrong. Scope, count and selection are
// separate controls rather than one "Scrape everything" button.

type Scope = 'missing' | 'all' | 'selected'
const BATCH = 5

const OUTCOME_STYLE: Record<ScrapeResult['outcome'], string> = {
  matched:     'text-green-700 dark:text-green-400',
  no_match:    'text-amber-700 dark:text-amber-400',
  unmatchable: 'text-ink-500',
  error:       'text-red-600 dark:text-red-400',
}
const OUTCOME_LABEL: Record<ScrapeResult['outcome'], string> = {
  matched: 'matched', no_match: 'no match', unmatchable: 'cannot match', error: 'error',
}

export function ScreenScraperPanel() {
  const qc = useQueryClient()
  const { data: allGames = [] } = useAllGames()

  const [scope, setScope] = useState<Scope>('missing')
  const [limitText, setLimitText] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [withMedia, setWithMedia] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')

  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const [done, setDone] = useState(0)
  const [results, setResults] = useState<ScrapeResult[]>([])
  const [note, setNote] = useState<string | null>(null)

  const status = useQuery({
    queryKey: ['screenscraper', 'status'],
    queryFn: fetchScreenScraperStatus,
    staleTime: 60_000,
    retry: false,
  })

  // Candidates come from the library already in memory — no extra round trip,
  // and the count updates as games get filled in.
  const candidates = useMemo(() => {
    if (scope === 'all') return allGames
    if (scope === 'selected') return allGames.filter(g => picked.has(g.id))
    return allGames.filter(g => !g.description)
  }, [allGames, scope, picked])

  const limit = Number(limitText)
  const plannedTotal = Number.isFinite(limit) && limit > 0
    ? Math.min(limit, candidates.length)
    : candidates.length

  const pickerList = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q ? allGames.filter(g => g.title.toLowerCase().includes(q)) : allGames
    return base.slice(0, 200)
  }, [allGames, search])

  const togglePick = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const run = useCallback(async () => {
    setRunning(true); stopRef.current = false
    setDone(0); setResults([]); setNote(null)

    const queue = candidates.slice(0, plannedTotal).map((g: Game) => g.id)
    let processed = 0
    try {
      for (let i = 0; i < queue.length; i += BATCH) {
        if (stopRef.current) { setNote(`Stopped after ${processed} game${processed === 1 ? '' : 's'}.`); break }
        const chunk = queue.slice(i, i + BATCH)
        const batch = await scrapeBatch({ limit: chunk.length, gameIds: chunk, dryRun, media: withMedia })

        // The function reports its own refusals rather than throwing, so a run
        // ends on the reason it gives instead of on a generic failure.
        if (batch.status !== 'ok') {
          setNote(batch.message ?? `Stopped: ${batch.status}`)
          break
        }
        const got = batch.results ?? []
        setResults(prev => [...prev, ...got])
        processed += got.length
        setDone(processed)
        if (batch.done) break
      }
    } catch (e) {
      const msg = (e as Error).message
      logError(`screenscraper_scrape: ${msg}`)
      toast.error(msg)
      setNote(msg)
    } finally {
      setRunning(false)
      if (!dryRun) {
        // A real run rewrote games and platforms — everything reading them is stale.
        qc.invalidateQueries({ queryKey: ['games'] })
        qc.invalidateQueries({ queryKey: ['screenscraper'] })
      }
    }
  }, [candidates, plannedTotal, dryRun, withMedia, qc])

  async function handleRefreshSystems() {
    const tid = toast.loading('Fetching ScreenScraper system ids…')
    try {
      const r = await refreshScreenScraperSystems()
      toast.dismiss(tid)
      toast.success(`${r.systems} systems, ${r.with_retropie_name} with a folder name ✓`)
      status.refetch()
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_refresh_systems: ${msg}`)
      toast.error(msg)
    }
  }

  const s = status.data
  const notConfigured = s?.status === 'not_configured'
  const tally = results.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc },
    {} as Record<string, number>)

  return (
    <div className="max-w-4xl space-y-3">
      {/* ── Account + what is left to do ── */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-ink-900">🎲 ScreenScraper</p>
            <p className="text-xs text-ink-400 mt-0.5">Fills metadata ES-DE never scraped, and mirrors artwork into our own storage.</p>
          </div>
          <button onClick={() => status.refetch()} disabled={status.isFetching}
            className="text-xs min-h-[44px] px-3 rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 transition-colors disabled:opacity-50">
            {status.isFetching ? 'Checking…' : '↻ Check'}
          </button>
        </div>

        {status.isError && (
          <p className="text-xs text-red-600 mt-3">{(status.error as Error).message}</p>
        )}
        {notConfigured && (
          <p className="text-xs text-amber-700 mt-3">
            Credentials are not in Vault yet — add <code>SCREENSCRAPER_DEVID</code>, <code>DEVPASSWORD</code>,{' '}
            <code>SSID</code> and <code>SSPASSWORD</code>, then deploy the function.
          </p>
        )}
        {s?.status === 'ok' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <Stat label="Membership" value={s.premium ? 'Premium ✓' : 'Anonymous'} warn={!s.premium} />
              <Stat label="Threads" value={String(s.account?.threads ?? '—')} />
              <Stat label="Left today" value={String(s.remaining_today ?? '—')} />
              <Stat label="Systems known" value={String(s.systems_known ?? 0)} warn={(s.systems_known ?? 0) === 0} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Stat label="Missing metadata" value={String(s.games_missing_metadata ?? 0)} />
              <Stat label="Missing cover" value={String(s.games_missing_cover ?? 0)} />
            </div>
            {!s.premium && (
              <p className="text-xs text-amber-700 mt-2">
                Only the dev credentials are being recognised. The member pair (<code>SSID</code>/<code>SSPASSWORD</code>)
                is what switches the paid membership on — without it this runs at 1 thread and 128 KB/s.
              </p>
            )}
            {(s.systems_known ?? 0) === 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  No ScreenScraper system ids are cached yet. Scraping matches an ES-DE folder name
                  (<code>snes</code>) to their numeric id, so this has to run once before anything else.
                </p>
                <button onClick={handleRefreshSystems}
                  className="mt-2 min-h-[44px] px-3 text-sm font-semibold rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors">
                  Fetch system ids
                </button>
              </div>
            )}
            {(s.systems_known ?? 0) > 0 && (
              <button onClick={handleRefreshSystems}
                className="mt-2 text-xs text-ink-500 hover:text-accent-700 transition-colors min-h-[44px]">
                Re-fetch system ids
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Scope ── */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Scrape</span>
          {([
            ['missing',  `Missing metadata (${allGames.filter(g => !g.description).length})`],
            ['all',      `Whole library (${allGames.length})`],
            ['selected', `Chosen games (${picked.size})`],
          ] as [Scope, string][]).map(([key, label]) => (
            <button key={key} onClick={() => { setScope(key); if (key === 'selected') setPickerOpen(true) }}
              className={`text-xs min-h-[44px] px-3 rounded-lg border transition-colors ${
                scope === key ? 'border-accent-400 bg-accent-50 text-accent-700 font-semibold dark:bg-accent-500/10'
                              : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {scope === 'selected' && (
          <div className="rounded-lg border border-ink-200 p-2">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a game…"
                className="flex-1 min-w-[12rem] max-w-md min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
              <button onClick={() => setPicked(new Set())} disabled={picked.size === 0}
                className="text-xs min-h-[44px] px-3 rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 transition-colors disabled:opacity-40">
                Reset
              </button>
              <button onClick={() => setPickerOpen(o => !o)}
                className="text-xs min-h-[44px] px-3 rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 transition-colors">
                {pickerOpen ? 'Hide list' : 'Show list'}
              </button>
            </div>
            {pickerOpen && (
              <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {pickerList.map(g => (
                  <label key={g.id} className={`flex items-center gap-2 min-h-[44px] px-2 rounded-md border cursor-pointer transition-colors ${
                    picked.has(g.id) ? 'border-accent-400 bg-accent-50 dark:bg-accent-500/10' : 'border-ink-200/70 hover:border-ink-300'}`}>
                    <input type="checkbox" checked={picked.has(g.id)} onChange={() => togglePick(g.id)}
                      className="w-3.5 h-3.5 flex-shrink-0 accent-accent-500" />
                    <span className="text-[11px] truncate text-ink-700" title={g.title}>{g.title}</span>
                  </label>
                ))}
                {pickerList.length === 0 && <p className="text-xs text-ink-400 p-2">No game matches that.</p>}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-ink-600 min-h-[44px]">
            <span>Stop after</span>
            <input value={limitText} onChange={e => setLimitText(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric" placeholder="all"
              className="w-20 min-h-[44px] px-2 text-sm rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
            <span>games</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-600 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
              className="w-4 h-4 accent-accent-500" />
            Dry run — report matches, write nothing
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-600 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={withMedia} onChange={e => setWithMedia(e.target.checked)}
              disabled={dryRun} className="w-4 h-4 accent-accent-500 disabled:opacity-40" />
            Mirror artwork
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={run} disabled={running || plannedTotal === 0 || notConfigured || (s?.systems_known ?? 0) === 0}
            className="min-h-[44px] px-4 text-sm font-semibold rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-40">
            {running ? `Scraping… ${done}/${plannedTotal}` : `${dryRun ? 'Dry run' : 'Scrape'} ${plannedTotal} game${plannedTotal === 1 ? '' : 's'}`}
          </button>
          {running && (
            <button onClick={() => { stopRef.current = true }}
              className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 text-ink-600 hover:border-red-300 hover:text-red-600 transition-colors">
              Stop
            </button>
          )}
          {plannedTotal === 0 && !running && (
            <span className="text-xs text-ink-400">Nothing selected to scrape.</span>
          )}
        </div>

        {running && (
          <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-accent-500 transition-all"
              style={{ width: `${plannedTotal ? Math.round((done / plannedTotal) * 100) : 0}%` }} />
          </div>
        )}
        {note && <p className="text-xs text-amber-700">{note}</p>}
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-cream-50 p-4">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Result</span>
            {(['matched', 'no_match', 'unmatchable', 'error'] as ScrapeResult['outcome'][]).map(o => (
              tally[o] ? <span key={o} className={`text-xs font-semibold ${OUTCOME_STYLE[o]}`}>{tally[o]} {OUTCOME_LABEL[o]}</span> : null
            ))}
            {dryRun && <span className="text-xs text-ink-400">(dry run — nothing was written)</span>}
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-ink-100">
            {results.map(r => (
              <div key={r.id} className="py-1.5 flex items-start gap-2 text-xs">
                <span className={`font-semibold flex-shrink-0 w-24 ${OUTCOME_STYLE[r.outcome]}`}>{OUTCOME_LABEL[r.outcome]}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-ink-800">{r.title}</span>
                  {r.matched_title && r.matched_title !== r.title && (
                    <span className="text-ink-400"> → {r.matched_title}</span>
                  )}
                  {(r.would_fill?.length || r.filled?.length) ? (
                    <span className="text-ink-400"> · {(r.would_fill ?? r.filled)!.join(', ')}</span>
                  ) : null}
                  {r.media?.length ? <span className="text-green-700 dark:text-green-400"> · {r.media.length} image{r.media.length === 1 ? '' : 's'}</span> : null}
                  {r.reason && <span className="text-ink-400"> · {r.reason}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${warn ? 'border-amber-300 bg-amber-50 dark:bg-amber-500/10' : 'border-ink-200'}`}>
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className={`text-sm font-bold ${warn ? 'text-amber-800 dark:text-amber-300' : 'text-ink-900'}`}>{value}</p>
    </div>
  )
}
