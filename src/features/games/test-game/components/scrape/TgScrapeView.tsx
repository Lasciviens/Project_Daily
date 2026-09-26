import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useTestGameStore } from '../../testGameStore'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import type { SsCandidate } from '../../../scraper/ssTypes'
import { useMutationWithFeedback } from '../../../../../shared/hooks/useMutationWithFeedback'
import { useHistoryDismiss } from '../../../../../shared/hooks/useHistoryDismiss'
import { searchScreenScraper, type FindResult } from '../../../scraper/ssApi'
import { modeCounts } from '../../../scraper/ssPlan'
import { useScrapePrefs } from '../../../scraper/useScrape'
import { formForGame, formProblem, formToRequest, type SearchForm } from './tgScrapeModel'
import { TgScrapeTarget } from './TgScrapeTarget'
import { TgScrapeSearchForm } from './TgScrapeSearchForm'
import { TgScrapeResults } from './TgScrapeResults'
import { TgScrapeReview } from './TgScrapeReview'
import { TgScrapeSettings } from './TgScrapeSettings'
import { TgScrapeBatch } from './TgScrapeBatch'
import { TgScrapeRecent } from './TgScrapeRecent'
import { TgScrapeEmpty } from './TgScrapeParts'

/**
 * The Scrape page: pick a game, search ScreenScraper by name and/or ROM, read
 * the results, open one, choose field by field and file by file what to save.
 * The detail's Scrape button lands here with the game already picked and the
 * search already running — one search, everywhere.
 *
 * The last search (with the game and the exact form that made it) and the
 * batch session live in the page store, so switching modes or leaving the
 * page never throws away lookups that cost ScreenScraper requests.
 * Phone: steps (search → review; Back returns). Tablet and wider: side by side.
 */
export function TgScrapeView({ games, loading, layout }: { games: TgGame[]; loading: boolean; layout: 'desktop' | 'mobile' }) {
  const bp = useTgBreakpoint()
  // Results and review side by side only with real width for both; a tablet
  // (even landscape, beside the sidebar) gets the step flow — a 130–390px
  // review pane was unusable.
  const wide = layout === 'desktop' && bp === 'desktop'
  const targetId = useTestGameStore(s => s.scrapeTargetId)
  const setTarget = useTestGameStore(s => s.setScrapeTarget)
  const mode = useTestGameStore(s => s.scrapeMode)
  const setMode = useTestGameStore(s => s.setScrapeMode)
  const search = useTestGameStore(s => s.scrapeSearch)
  const setSearch = useTestGameStore(s => s.setScrapeSearch)
  const review = useTestGameStore(s => s.scrapeReview)
  const setReview = useTestGameStore(s => s.setScrapeReview)
  const settingsOpen = useTestGameStore(s => s.scrapeSettingsOpen)
  const setSettingsOpen = useTestGameStore(s => s.setScrapeSettingsOpen)
  const { prefs } = useScrapePrefs()

  const retro = useMemo(() => games.filter(g => g.library === 'retro'), [games])
  const target = useMemo(() => retro.find(g => g.id === targetId) ?? null, [retro, targetId])

  // The form being edited — seeded from the target, or from the last search
  // when it was made for this target.
  const [form, setForm] = useState<SearchForm>(() => (search && search.targetId === targetId ? search.form : formForGame(target)))
  const [formOpen, setFormOpen] = useState(() => !(search && search.targetId === targetId))
  const [seenTarget, setSeenTarget] = useState<string | null | undefined>(targetId)
  if (seenTarget !== targetId && (!targetId || target || !loading)) {
    setSeenTarget(targetId)
    setForm(search && search.targetId === targetId ? search.form : formForGame(target))
    setFormOpen(!(search && search.targetId === targetId))
  }

  // Only the latest search may land, and only for the game it was made for:
  // a slow earlier answer must never fill the list under another game.
  const seq = useRef(0)
  const runSearchMut = useMutationWithFeedback({
    action: 'screenscraper_search',
    mutationFn: async (v: { f: SearchForm; targetId: string | null; id: number }) => ({ ...v, response: await searchScreenScraper(formToRequest(v.f)) }),
    onSuccess: ({ f, targetId: tid, id, response }) => {
      // Only the latest search, and only while its game is still the one
      // picked — even from an unmounted page (the store is the truth).
      if (id !== seq.current || tid !== useTestGameStore.getState().scrapeTargetId) return
      setSearch({ targetId: tid, form: f, response })
      setReview(null)
      if (!wide) setFormOpen(false)
    },
  })
  const searching = runSearchMut.isPending
  const doSearch = useCallback((f: SearchForm) => {
    if (formProblem(f)) return
    seq.current += 1
    runSearchMut.mutate({ f, targetId, id: seq.current })
  }, [runSearchMut, targetId])

  // A new target runs its own search once — never on a mode switch, a remount
  // or a return to the page when the stored results are already for it.
  const autoFor = useRef<string | null>(search?.targetId ?? null)
  useEffect(() => {
    if (!target || mode !== 'search' || autoFor.current === target.id) return
    autoFor.current = target.id
    seq.current += 1 // anything in flight for the previous game is now stale
    if (search?.targetId === target.id) return
    const f = formForGame(target)
    if (!formProblem(f)) runSearchMut.mutate({ f, targetId: target.id, id: seq.current })
  }, [target, mode, search?.targetId, runSearchMut])

  const results = search && search.targetId === targetId ? search.response : null
  const searchForm = search && search.targetId === targetId ? search.form : form
  const picked: SsCandidate | null = review ? results?.candidates.find(c => c.jeu_id === review.jeuId) ?? null : null

  // Phone/tablet: a review is a step of its own — it opens at the top, Back
  // (hardware, edge swipe, the Results link) returns to the results at the
  // spot you left them, instead of leaving Games.
  const topRef = useRef<HTMLDivElement>(null)
  const resultsTop = useRef(0)
  const scroller = () => topRef.current?.closest('.tg-scroll-y') as HTMLElement | null
  const pick = (c: SsCandidate | null) => {
    if (c && !wide) resultsTop.current = scroller()?.scrollTop ?? 0
    setReview(c ? { jeuId: c.jeu_id, title: String(c.values.title ?? `#${c.jeu_id}`) } : null)
  }
  const reviewId = picked?.jeu_id ?? null
  useLayoutEffect(() => {
    if (wide) return
    scroller()?.scrollTo({ top: reviewId ? 0 : resultsTop.current })
  }, [reviewId, wide])
  useHistoryDismiss(!wide && !!picked, () => setReview(null))

  const counts = modeCounts(prefs)
  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 text-[12px] leading-snug tg-muted">
        Saves: {counts.store} copied · {counts.on_demand} online · {counts.skip} skipped{prefs.snapshot ? ' · raw answer kept' : ''}
      </p>
      <button type="button" onClick={() => setSettingsOpen(true)} className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[13px]">
        <Settings2 aria-hidden className="h-4 w-4" strokeWidth={2} />
        What to save
      </button>
    </div>
  )

  // From Many games: a game with a found match opens straight into its review
  // (the lookup is reused as a one-result search — no new request).
  const openFromBatch = (id: string, found: FindResult | null) => {
    const game = retro.find(g => g.id === id) ?? null
    if (found?.candidate) {
      autoFor.current = id
      setSearch({
        targetId: id, form: formForGame(game),
        response: { status: 'ok', candidates: [found.candidate], outcomes: [], system: found.system ?? null, requests: 0, remaining_today: null },
      })
    }
    setTarget(id)
    setMode('search')
    if (found?.candidate) pick(found.candidate)
  }

  const settings = <TgScrapeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  const batch = (
    // Kept mounted (a batch in progress survives a switch to One game) but
    // really hidden — a bare `hidden` attribute would lose to `flex`.
    <div hidden={mode !== 'batch'} className={`${mode === 'batch' ? 'flex' : 'hidden'} min-h-0 flex-col gap-4 ${wide ? 'flex-1' : 'pb-6'}`}>
      {wide && toolbar}
      <div className={wide ? 'tg-scroll-y min-h-0 flex-1 pb-6 pr-1' : ''}>
        <TgScrapeBatch games={retro} loading={loading} onOpenGame={openFromBatch} />
      </div>
    </div>
  )

  const reviewEl = picked ? (
    <TgScrapeReview
      key={`${target?.id ?? 'none'}:${picked.jeu_id}:${picked.matched_by.join(',')}:${picked.rom_id ?? ''}`}
      game={target}
      candidate={picked}
      prefs={prefs}
      searchForm={searchForm}
      wide={wide}
      onBack={wide ? undefined : () => setReview(null)}
      backInline={!wide && bp !== 'mobile'}
    />
  ) : null

  const folded = !formOpen && results
    ? <TgScrapeSearchForm form={searchForm} onChange={setForm} onSearch={() => doSearch(form)} searching={searching} hasTarget={!!target} open={false} onOpen={() => setFormOpen(true)} />
    : null
  const left = (
    <div className="flex flex-col gap-4">
      <TgScrapeTarget
        games={retro} target={target} loading={loading} onPick={(id) => setTarget(id)}
        footer={target ? folded : null}
      />
      {/* Browsing without a game: the folded search (with Edit) sits on its own. */}
      {!target && folded && <div className="tg-panel p-3">{folded}</div>}
      {(formOpen || !results) && (
        <TgScrapeSearchForm form={form} onChange={setForm} onSearch={() => doSearch(form)} searching={searching} hasTarget={!!target} open onOpen={() => setFormOpen(true)} />
      )}
      <TgScrapeResults
        response={results} searching={searching} error={runSearchMut.error?.message ?? null}
        pickedId={picked?.jeu_id ?? null} onPick={pick} canApply={!!target} systemHint={results?.system ?? null}
      />
      <TgScrapeRecent />
    </div>
  )

  if (wide) {
    return (
      <div ref={topRef} className="flex h-full min-h-0 flex-col gap-4">
        {mode === 'search' && toolbar}
        {batch}
        {mode === 'search' && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)]">
            <div className="tg-scroll-y min-h-0 pb-6 pr-1">{left}</div>
            <div className="flex min-h-0 flex-col">
              {reviewEl ?? <div className="tg-scroll-y min-h-0 pb-6"><TgScrapeEmpty hasTarget={!!target} hasResults={!!results?.candidates.length} /></div>}
            </div>
          </div>
        )}
        {settings}
      </div>
    )
  }

  return (
    <div ref={topRef} className="flex flex-col gap-4 pb-6">
      {batch}
      {mode === 'search' && (reviewEl ?? left)}
      {settings}
    </div>
  )
}
