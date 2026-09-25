import { useEffect, useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useTestGameStore } from '../../testGameStore'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import type { SsCandidate } from '../../../scraper/ssTypes'
import { useMutationWithFeedback } from '../../../../../shared/hooks/useMutationWithFeedback'
import { searchScreenScraper, type SearchResponse } from '../../../scraper/ssApi'
import { modeCounts } from '../../../scraper/ssPlan'
import { useScrapePrefs } from '../../../scraper/useScrape'
import { formForGame, formProblem, formToRom, type SearchForm } from './tgScrapeModel'
import { TgScrapeTarget } from './TgScrapeTarget'
import { TgScrapeSearchForm } from './TgScrapeSearchForm'
import { TgScrapeResults } from './TgScrapeResults'
import { TgScrapeReview } from './TgScrapeReview'
import { TgScrapeSettings } from './TgScrapeSettings'
import { TgScrapeBatch } from './TgScrapeBatch'
import { TgScrapeEmpty } from './TgScrapeParts'

/**
 * The Scrape page: pick a game, search ScreenScraper by name and/or ROM, read
 * the results, open one, choose field by field and file by file what to save.
 * The detail's Scrape button lands here with the game already picked and the
 * search already running — one search, everywhere.
 *
 * Phone and narrow widths walk it as steps (search → review, Back returns);
 * a wide screen shows results and the review side by side.
 */
export function TgScrapeView({ games, loading, layout }: { games: TgGame[]; loading: boolean; layout: 'desktop' | 'mobile' }) {
  const bp = useTgBreakpoint()
  const wide = layout === 'desktop' && bp === 'desktop'
  const targetId = useTestGameStore(s => s.scrapeTargetId)
  const setTarget = useTestGameStore(s => s.setScrapeTarget)
  const mode = useTestGameStore(s => s.scrapeMode)
  const setMode = useTestGameStore(s => s.setScrapeMode)
  const [formOpen, setFormOpen] = useState(true)
  const { prefs } = useScrapePrefs()

  const retro = useMemo(() => games.filter(g => g.library === 'retro'), [games])
  const target = useMemo(() => retro.find(g => g.id === targetId) ?? null, [retro, targetId])

  const [form, setForm] = useState<SearchForm>(() => formForGame(target))
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [picked, setPicked] = useState<SsCandidate | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const search = useMutationWithFeedback({
    action: 'screenscraper_search',
    mutationFn: (f: SearchForm) => searchScreenScraper({
      name: f.useName ? f.name.trim() : undefined,
      system: f.system || null,
      rom: f.useRom ? formToRom(f) : null,
      jeu_id: f.jeuId.trim() || undefined,
      use_name: f.useName, use_rom: f.useRom,
    }),
    onSuccess: (r) => {
      setResults(r)
      // Phone and narrow screens fold the form into one line once there are
      // results to read; a wide screen has room for both.
      if (!wide) setFormOpen(false)
      // One exact hit on a wide screen opens straight away; on a phone the
      // list stays in front so the choice is still yours.
      setPicked(wide && r.candidates.length === 1 ? r.candidates[0] : null)
    },
  })

  // A new target starts a fresh search with its own name and ROM. Arriving
  // from a game's Scrape button runs it immediately.
  const [seenTarget, setSeenTarget] = useState<string | null | undefined>(undefined)
  if (seenTarget !== targetId && (!targetId || target || !loading)) {
    setSeenTarget(targetId)
    const next = formForGame(target)
    setForm(next)
    setResults(null)
    setPicked(null)
    setFormOpen(true)
  }
  const { mutate: runSearch, isPending: searching } = search
  useEffect(() => {
    if (!target || mode !== 'search') return
    const f = formForGame(target)
    if (!formProblem(f)) runSearch(f)
    // Only when the target changes — not on every form edit.
  }, [target?.id, mode, runSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = () => { if (!formProblem(form)) runSearch(form) }

  const counts = modeCounts(prefs)
  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 text-[12px] leading-snug tg-muted">
        Defaults: {counts.store} image types saved · {counts.on_demand} linked · {counts.skip} skipped{prefs.snapshot ? ' · full record' : ''}
      </p>
      <button type="button" onClick={() => setSettingsOpen(true)} className="tg-btn tg-btn-secondary !min-h-[40px] shrink-0 !px-3 !text-[13px]">
        <Settings2 aria-hidden className="h-4 w-4" strokeWidth={2} />
        What to save
      </button>
    </div>
  )

  const settings = <TgScrapeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

  if (mode === 'batch') {
    return (
      <div className="flex flex-col gap-4 pb-6">
        {toolbar}
        <TgScrapeBatch games={retro} loading={loading} onOpenGame={(id) => { setTarget(id); setMode('search') }} />
        {settings}
      </div>
    )
  }

  const reviewing = picked && target
  const review = reviewing ? (
    <TgScrapeReview
      key={`${target.id}:${picked.jeu_id}`}
      game={target}
      candidate={picked}
      prefs={prefs}
      form={form}
      onBack={wide ? undefined : () => setPicked(null)}
    />
  ) : null

  const left = (
    <div className="flex flex-col gap-4">
      <TgScrapeTarget games={retro} target={target} loading={loading} onPick={(id) => setTarget(id)} />
      <TgScrapeSearchForm
        form={form} onChange={setForm} onSearch={doSearch} searching={searching}
        hasTarget={!!target} open={formOpen || wide} onOpen={() => setFormOpen(true)}
      />
      <TgScrapeResults
        response={results} searching={searching} error={search.error?.message ?? null}
        pickedId={picked?.jeu_id ?? null} onPick={setPicked} canApply={!!target}
      />
    </div>
  )

  if (wide) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)] gap-5">
          <div className="tg-scroll-y min-h-0 pb-6 pr-1">{left}</div>
          <div className="tg-scroll-y min-h-0 pb-6">
            {review ?? <TgScrapeEmpty hasTarget={!!target} hasResults={!!results?.candidates.length} />}
          </div>
        </div>
        {settings}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      {!reviewing && toolbar}
      {review ?? left}
      {settings}
    </div>
  )
}
