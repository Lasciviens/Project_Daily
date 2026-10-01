import { useEffect, useMemo, useState } from 'react'
import { CheckCheck, RefreshCw, Search, Square, Wand2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useIgdbBatch, type IgdbFilter, type IgdbLibraryFilter } from '../../../igdb/igdbBatchStore'
import { useIgdbRunner } from '../../../igdb/useIgdbRunner'
import { useIgdbStatus, useRefreshIgdb } from '../../../igdb/useIgdb'
import { TgDropdown } from '../TgDropdown'
import { TgScrapeCard } from '../scrape/TgScrapeParts'
import { TgIgdbRow } from './TgIgdbRow'
import { TgIgdbSetup } from './TgIgdbSetup'
import { igdbCandidates, igdbCoverage, igdbRowMatches, isIgdbMatched, libraryMatches, needsReview, toLookUp } from './tgIgdbModel'

const FILTERS: { key: IgdbFilter; label: string }[] = [
  { key: 'todo', label: 'Not matched' }, { key: 'review', label: 'To review' }, { key: 'matched', label: 'Matched' },
  { key: 'no_length', label: 'No length' }, { key: 'all', label: 'All' },
]
const LIBRARIES: { value: IgdbLibraryFilter; label: string }[] = [
  { value: 'all', label: 'All libraries' }, { value: 'retro', label: 'Retro' }, { value: 'steam', label: 'Steam' }, { value: 'playstation', label: 'PlayStation' },
]
const PAGE = 100
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—')

/**
 * The IGDB page: bulk-match the library to IGDB for game length, ratings and a
 * link to each game's page. "Match" looks games up 25 at a time; Steam games
 * match by app id and an exact title + platform match saves by itself, the
 * rest wait here with their best result until you tick (or pick another).
 */
export function TgIgdbView({ games, loading }: { games: TgGame[]; loading: boolean }) {
  const status = useIgdbStatus()
  const { filter, library, rows, ticked, running, looking, progress, focusId, set } = useIgdbBatch()
  const runner = useIgdbRunner()
  const refresh = useRefreshIgdb()
  // null → follow the focused game; '' → nothing open.
  const [openId, setOpenId] = useState<string | null>(null)
  const open = openId === null ? focusId : openId || null
  const [shown, setShown] = useState(PAGE)

  const pool = useMemo(() => igdbCandidates(games).filter(g => libraryMatches(g, library)), [games, library])
  const cover = useMemo(() => igdbCoverage(pool), [pool])
  const list = useMemo(() => {
    const l = pool.filter(g => g.id === focusId || igdbRowMatches(g, filter, rows[g.id]))
      .sort((a, b) => a.title.localeCompare(b.title))
    const f = focusId ? l.findIndex(g => g.id === focusId) : -1
    if (f > 0) l.unshift(...l.splice(f, 1))
    return l
  }, [pool, filter, rows, focusId])
  const pending = useMemo(() => toLookUp(list, rows), [list, rows])
  const reviewCount = pool.filter(g => needsReview(g, rows[g.id])).length
  const tickedGames = list.filter(g => ticked[g.id] && rows[g.id]?.pick && !rows[g.id]?.saved && !isIgdbMatched(g))
  const likely = list.filter(g => needsReview(g, rows[g.id]) && rows[g.id]?.pick?.confidence === 'likely' && !ticked[g.id])

  // A game sent here from its detail ("Find on IGDB") opens, and is looked up once.
  useEffect(() => {
    if (!focusId || !status.data?.configured) return
    const g = games.find(x => x.id === focusId)
    if (g && !isIgdbMatched(g) && !useIgdbBatch.getState().rows[g.id]?.decision) void runner.run([g])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per focus
  }, [focusId, status.data?.configured])

  // Leaving the page drops the focus, so the next visit is the plain list.
  useEffect(() => () => useIgdbBatch.getState().set({ focusId: null }), [])

  if (status.isLoading) return <p className="py-6 text-[13px] tg-muted">Checking IGDB…</p>
  if (!status.data?.configured) return <div className="flex max-w-3xl flex-col gap-4 pb-6"><TgIgdbSetup error={status.error ? (status.error as Error).message : null} /></div>

  return (
    <div className="flex max-w-4xl flex-col gap-4 pb-6">
      <TgScrapeCard title="Which games" aside={
        <TgDropdown value={library} options={LIBRARIES} onChange={v => { set({ library: v }); setShown(PAGE) }}
          buttonLabel={LIBRARIES.find(l => l.value === library)!.label} ariaLabel="Library" align="end" />
      }>
        <div role="group" aria-label="Show" className="tg-scroll-x -mx-1 flex gap-1.5 px-1">
          {FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => { set({ filter: f.key, focusId: null }); setShown(PAGE) }}
              className={`tg-tab min-h-[44px] shrink-0 !px-3 !text-[12.5px] ${filter === f.key ? 'is-active' : 'bg-[var(--tg-panel-2)]'}`}>
              {f.label}{f.key === 'review' && reviewCount ? <span className="tg-tab-count ml-1">{reviewCount}</span> : null}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-snug tg-muted">
          {loading ? 'Loading…' : <>
            <b className="font-semibold text-[var(--tg-text)]">{cover.matched.toLocaleString('en-GB')} of {cover.total.toLocaleString('en-GB')}</b> matched ({pct(cover.matched, cover.total)})
            {' · '}{cover.withLength.toLocaleString('en-GB')} with a length · {cover.rated.toLocaleString('en-GB')} with a score.
          </>}{' '}
          Steam games match by their app id; others by title, platform and year. Exact matches save by themselves; nothing you set (title, cover, notes) is changed.
        </p>

        {running && progress && (
          <div className="mt-3" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--tg-panel-2)]">
              <div className="h-full rounded-full bg-[var(--tg-accent)] transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <p className="mt-1 text-[12px] tg-muted">Looked up {progress.done} of {progress.total} · {progress.saved} saved as exact</p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {running && progress ? (
            <button type="button" onClick={runner.stop} className="tg-btn tg-btn-secondary"><Square className="h-4 w-4" aria-hidden /> Stop after this batch</button>
          ) : (
            <button type="button" onClick={() => void runner.run(pending)} disabled={!pending.length || running} className="tg-btn tg-btn-secondary">
              <Search className="h-4 w-4" aria-hidden />
              {pending.length ? `Match ${pending.length.toLocaleString('en-GB')} game${pending.length === 1 ? '' : 's'}` : 'All shown games looked up'}
            </button>
          )}
          <button type="button" onClick={() => void runner.saveTicked(list)} disabled={!tickedGames.length || running} className="tg-btn tg-btn-primary">
            <Wand2 className="h-4 w-4" aria-hidden /> Save {tickedGames.length} ticked
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {likely.length > 0 && (
            <button type="button" onClick={() => set({ ticked: { ...ticked, ...Object.fromEntries(likely.map(g => [g.id, true])) } })}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] font-semibold text-[var(--tg-accent)]">
              <CheckCheck className="h-4 w-4" aria-hidden /> Tick all {likely.length} likely
            </button>
          )}
          {cover.matched > 0 && (
            <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending || running}
              title="Ratings and lengths change as IGDB members submit them"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] font-semibold text-[var(--tg-accent)] disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} aria-hidden /> Refresh scores and lengths
            </button>
          )}
        </div>
      </TgScrapeCard>

      {list.length === 0 ? (
        <p className="py-4 text-center text-[13px] tg-muted">{filter === 'review' ? 'Nothing waiting for review.' : 'No games here.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.slice(0, shown).map(g => (
            <TgIgdbRow key={g.id} game={g} row={rows[g.id]} ticked={!!ticked[g.id]} busy={!!looking[g.id]}
              open={open === g.id} onToggle={() => setOpenId(open === g.id ? '' : g.id)}
              onLookUp={() => void runner.run([g])} onSavePick={c => runner.savePick(g, c)} />
          ))}
          {list.length > shown && (
            <li className="py-2 text-center">
              <button type="button" onClick={() => setShown(n => n + PAGE)} className="tg-btn tg-btn-secondary">Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}</button>
            </li>
          )}
        </ul>
      )}
      <p className="text-[11.5px] tg-muted">Game data from <a href="https://www.igdb.com" target="_blank" rel="noreferrer" className="font-semibold text-[var(--tg-accent)]">IGDB.com</a>. Lengths and member scores are submitted by IGDB members.</p>
    </div>
  )
}
