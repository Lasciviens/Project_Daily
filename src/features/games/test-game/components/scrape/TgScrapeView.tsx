import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useTestGameStore } from '../../testGameStore'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import type { SsCandidate } from '../../../scraper/ssTypes'
import { useMutationWithFeedback } from '../../../../../shared/hooks/useMutationWithFeedback'
import { useHistoryDismiss } from '../../../../../shared/hooks/useHistoryDismiss'
import { searchScreenScraper } from '../../../scraper/ssApi'
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
  const wide = layout === 'desktop' && bp !== 'mobile'
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
      if (id !== seq.current) return
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
    if (search?.targetId === target.id) return
    seq.current += 1 // anything in flight for the previous game is now stale
    const f = formForGame(target)
    if (!formProblem(f)) runSearchMut.mutate({ f, targetId: target.id, id: seq.current })
  }, [target, mode, search?.targetId, runSearchMut])

  const results = search && search.targetId === targetId ? search.response : null
  const searchForm = search && search.targetId === targetId ? search.form : form
  const picked: SsCandidate | null = review ? results?.candidates.find(c => c.jeu_id === review.jeuId) ?? null : null
  const pick = (c: SsCandidate | null) => setReview(c ? { jeuId: c.jeu_id, title: String(c.values.title ?? `#${c.jeu_id}`) } : null)

  // Phone: a review is a step of its own — it opens at the top, and Back
  // (hardware, edge swipe) returns to the results instead of leaving Games.
  const topRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (wide) return
    const scroller = topRef.current?.closest('.tg-scroll-y') as HTMLElement | null
    scroller?.scrollTo({ top: 0 })
  }, [picked?.jeu_id, wide])
  useHistoryDismiss(!wide && !!picked, () => setReview(null))

  const counts = modeCounts(prefs)
  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 text-[12px] leading-snug tg-muted">
        Saves: {counts.store} copied · {counts.on_demand} online · {counts.skip} skipped{prefs.snapshot ? ' · full record' : ''}
      </p>
      <button type="button" onClick={() => setSettingsOpen(true)} className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[13px]">
        <Settings2 aria-hidden className="h-4 w-4" strokeWidth={2} />
        What to save
      </button>
    </div>
  )

  const settings = <TgScrapeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  const batch = (
    // Kept mounted (a batch in progress survives a switch to One game) but
    // really hidden — a bare `hidden` attribute would lose to `flex`.
    <div hidden={mode !== 'batch'} className={`${mode === 'batch' ? 'flex' : 'hidden'} min-h-0 flex-col gap-4 ${wide ? 'flex-1' : 'pb-6'}`}>
      {wide && toolbar}
      <div className={wide ? 'tg-scroll-y min-h-0 flex-1 pb-6 pr-1' : ''}>
        <TgScrapeBatch games={retro} loading={loading} onOpenGame={(id) => { setTarget(id); setMode('search') }} />
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
    />
  ) : null

  const left = (
    <div className="flex flex-col gap-4">
      <TgScrapeTarget
        games={retro} target={target} loading={loading} onPick={(id) => setTarget(id)}
        footer={!formOpen && results ? <TgScrapeSearchForm form={searchForm} onChange={setForm} onSearch={() => doSearch(form)} searching={searching} hasTarget={!!target} open={false} onOpen={() => setFormOpen(true)} /> : null}
      />
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
