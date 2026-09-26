import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ExternalLink, TriangleAlert, Wand2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import type { SsCandidate, SsField, SsMediaChoice, SsPrefs } from '../../../scraper/ssTypes'
import type { MediaMode } from '../../../scraper/ssMediaCatalog'
import { ssGamePage, type ApplyResult } from '../../../scraper/ssApi'
import { withOverrides } from '../../../scraper/ssRules'
import { FIELD_MEDIA, decideMediaModes } from '../../../scraper/ssPlan'
import { useApplyScrape, useStorageUsage } from '../../../scraper/useScrape'
import {
  applySummary, candidateLine, choiceToPolicy, fieldRows, formToRom, handheldCategories, initialChoice, mediaRows, summaryText, writingChoice,
  type FieldChoice, type FieldRow, type SearchForm,
} from './tgScrapeModel'
import { TgBasisBadges, TgCandidateCover, TgFlagChips, TgScrapeCard, TgSsAttribution, TgSwitch } from './TgScrapeParts'
import { TgScrapeFieldList } from './TgScrapeFieldList'
import { TgScrapeMediaGrid } from './TgScrapeMediaGrid'
import { TgScrapeRecord } from './TgScrapeRecord'
import { TgScrapeApplied } from './TgScrapeApplied'

const MEDIA_FIELD: Record<string, SsField> = Object.fromEntries(Object.entries(FIELD_MEDIA).map(([f, t]) => [t, f as SsField]))

/**
 * One result against one game: compare every field, choose every file, see
 * everything else they know, then save exactly that. Starts from the saved
 * defaults ("What to save"); every choice here applies to this save only.
 * The save uses the SEARCH that found the result (its system and ROM info),
 * never a later edit of the form.
 */
export function TgScrapeReview({ game, candidate, prefs, searchForm, wide, onBack, backInline = false }: {
  game: TgGame | null
  /** Show a Back link at the top (tablet — the phone has Back in its header). */
  backInline?: boolean
  candidate: SsCandidate
  prefs: SsPrefs
  searchForm: SearchForm
  wide: boolean
  onBack?: () => void
}) {
  const [titleRegion, setTitleRegion] = useState<string | null>(null)
  const [descLang, setDescLang] = useState<string | null>(null)
  // Compared with the picked title/description variant, as it will be saved.
  const effective = useMemo(() => withOverrides(candidate, { titleRegion, descriptionLang: descLang }), [candidate, titleRegion, descLang])
  const rows = useMemo(() => (game ? fieldRows(game, effective) : []), [game, effective])
  const mRows = useMemo(() => mediaRows(candidate, prefs), [candidate, prefs])

  // The starting point is what "Many games" would save with the same
  // settings: a field-backed type (box front → cover, …) is copied only when
  // its field will be written, any other only when the handheld has not
  // already uploaded that picture (decideMediaModes). Every change after that
  // is the owner's own.
  const [initial] = useState(() => {
    const init = game ? fieldRows(game, candidate) : []
    const ch = Object.fromEntries(init.map(r => [r.field, initialChoice(r, prefs.fields[r.field])])) as Partial<Record<SsField, FieldChoice>>
    const base = Object.fromEntries(mRows.map(r => [r.type, r.mode])) as Record<string, MediaMode>
    if (!game) return { choices: ch, modes: base }
    const fieldWrites = Object.fromEntries(init.filter(r => r.isImage).map(r => [r.field, ch[r.field] !== undefined && ch[r.field] !== 'keep' && !r.theirsEmpty]))
    const decided = decideMediaModes(
      mRows.filter(r => r.mode !== 'skip').map(r => ({ type: r.type, mode: r.mode === 'store' && r.canStore ? 'store' as const : 'on_demand' as const })),
      { explicit: false, fieldWrites, esdeCategories: handheldCategories(game) },
    )
    return { choices: ch, modes: { ...base, ...decided } }
  })
  const [choices, setChoices] = useState<Partial<Record<SsField, FieldChoice>>>(initial.choices)
  const [modes, setModes] = useState<Record<string, MediaMode>>(initial.modes)
  const [tokens, setTokens] = useState<Record<string, string>>(() => Object.fromEntries(mRows.map(r => [r.type, r.chosen.token])))
  const [snapshot, setSnapshot] = useState(prefs.snapshot)
  const [applied, setApplied] = useState<{ runId: string; result: ApplyResult; rows: FieldRow[] } | null>(null)
  const apply = useApplyScrape()
  const storage = useStorageUsage(!!game)
  const rootRef = useRef<HTMLDivElement>(null)

  const modeOf = (type: string) => modes[type] ?? 'skip'
  // One decision per image: choosing to write a cover means copying the box
  // front, and taking the box front off "Copy" means the cover stays yours.
  const setChoice = (field: SsField, c: FieldChoice) => {
    setChoices(s => ({ ...s, [field]: c }))
    const type = FIELD_MEDIA[field]
    if (type && c !== 'keep' && modeOf(type) !== 'store') setModes(s => ({ ...s, [type]: 'store' }))
  }
  const setMode = (type: string, m: MediaMode) => {
    setModes(s => ({ ...s, [type]: m }))
    const field = MEDIA_FIELD[type]
    if (field && m !== 'store') setChoices(s => ({ ...s, [field]: 'keep' }))
  }
  // Picking a variant is picking it to be saved; tapping it off again puts
  // the field back to the choice it had before (a peek never leaves Replace on).
  const [beforeVariant, setBeforeVariant] = useState<Partial<Record<'title' | 'description', FieldChoice>>>({})
  const pickVariant = (field: 'title' | 'description', key: string | null) => {
    const wasPicked = field === 'title' ? titleRegion != null : descLang != null
    if (field === 'title') setTitleRegion(key); else setDescLang(key)
    const row = rows.find(r => r.field === field)
    if (key && row) {
      if (!wasPicked) setBeforeVariant(b => ({ ...b, [field]: choices[field] ?? 'keep' }))
      setChoices(s => ({ ...s, [field]: writingChoice(row) }))
    } else if (!key && wasPicked) {
      setChoices(s => ({ ...s, [field]: beforeVariant[field] ?? 'keep' }))
      setBeforeVariant(b => ({ ...b, [field]: undefined }))
    }
  }

  const mediaPlan = mRows.map(r => ({ row: r, mode: modeOf(r.type), entry: r.entries.find(e => e.token === tokens[r.type]) ?? r.chosen }))
  const summary = applySummary(rows, choices, mediaPlan, prefs.imageScale)
  const nothing = summary.fields === 0 && summary.store === 0 && summary.onDemand === 0 && !snapshot

  // Tell BEFORE saving when copies will not happen — in the Save bar itself,
  // which is the one thing always on screen.
  const budget = (storage.data?.budget_mb ?? prefs.budgetMb) * 1024 * 1024
  const copyBlock: 'migration' | 'budget' | null = !game || summary.store === 0 || storage.isLoading ? null
    : storage.data === null ? 'migration'
    : storage.data && storage.data.total + summary.bytes > budget ? 'budget'
    : null
  const storageNote = copyBlock === 'migration' ? 'Copies need migration 104 — until then these images are shown online instead.'
    : copyBlock === 'budget' && storage.data ? `Storage is at ${Math.round(storage.data.total / 1048576)} of ${Math.round(budget / 1048576)} MB — copies that do not fit are shown online instead.`
    : null

  const save = () => {
    if (!game) return
    const fields = Object.fromEntries(rows.map(r => [r.field, choiceToPolicy(choices[r.field] ?? 'keep')])) as Record<SsField, 'fill' | 'replace' | 'skip'>
    const media: SsMediaChoice[] = mediaPlan
      .filter(m => m.mode !== 'skip')
      .map(m => ({ type: m.row.type, token: m.entry.token, mode: m.mode === 'store' ? 'store' : 'on_demand' }))
    apply.mutate({
      game_id: game.id, jeu_id: candidate.jeu_id, system: searchForm.system || candidate.system.id,
      rom: searchForm.useRom ? formToRom(searchForm) : null, fields, media, matched_by: candidate.matched_by,
      overrides: { title_region: titleRegion, description_lang: descLang },
      // The full-record switch applies to this save only (the budget can
      // never be raised this way — the server reads the saved one).
      ...(snapshot !== prefs.snapshot ? { prefs: { ...prefs, snapshot } } : {}),
    }, {
      onSuccess: (r) => {
        setApplied({ runId: r.run_id, result: r.result, rows })
        // The Saved screen starts at its heading, not at the old scroll depth.
        requestAnimationFrame(() => (rootRef.current?.closest('.tg-scroll-y') as HTMLElement | null)?.scrollTo({ top: 0 }))
      },
    })
  }

  if (applied && game) {
    return (
      <Scroller wide={wide}>
        <div ref={rootRef}>
          <TgScrapeApplied game={game} runId={applied.runId} result={applied.result} rows={applied.rows} onBack={onBack} onAgain={() => setApplied(null)} />
        </div>
      </Scroller>
    )
  }

  const saveBar = game && (
    <div className="flex flex-col gap-1.5">
      {storageNote && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--tg-red)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {storageNote}
        </p>
      )}
    <div className="flex items-center gap-3">
      <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug tabular-nums text-[var(--tg-text-2)]">
        {summaryText(summary, copyBlock)}{snapshot ? ' · raw answer kept' : ''}
      </p>
      <button type="button" onClick={save} disabled={apply.isPending || nothing} className="tg-btn tg-btn-primary shrink-0 !px-5">
        <Wand2 aria-hidden className={`h-4 w-4 ${apply.isPending ? 'animate-pulse' : ''}`} strokeWidth={2.2} />
        {apply.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
    </div>
  )

  const body = (
    <div ref={rootRef} className="flex flex-col gap-4">
      {backInline && onBack && (
        <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-[13.5px] font-semibold text-[var(--tg-accent)]">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} aria-hidden /> Results
        </button>
      )}
      <section className="tg-panel flex gap-4 p-4">
        {/* Compact on wide screens: a laptop's short review pane shows the fields, not a big cover. */}
        <TgCandidateCover candidate={candidate} regions={prefs.regions} width={360} className={`shrink-0 overflow-hidden rounded-lg ${wide ? 'h-[112px] w-[80px]' : 'h-[150px] w-[108px] sm:h-[190px] sm:w-[136px]'}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-[19px] font-bold leading-tight tracking-[-0.01em]">{String(effective.values.title ?? `#${candidate.jeu_id}`)}</h2>
          <p className="text-[12.5px] tg-muted">{[candidateLine(candidate), candidate.values.publisher].filter(Boolean).join(' · ') || '—'}</p>
          <div className="flex flex-wrap gap-1"><TgBasisBadges basis={candidate.matched_by} /><TgFlagChips flags={candidate.flags} /></div>
          {candidate.rom?.filename && (
            <p className="line-clamp-2 break-all font-mono text-[11px] leading-snug tg-muted">Dump: {candidate.rom.filename}</p>
          )}
          <a href={ssGamePage(candidate.jeu_id)} target="_blank" rel="noreferrer" className="mt-auto inline-flex min-h-[44px] items-center gap-1 self-start text-[12.5px] font-semibold text-[var(--tg-accent)]">
            ScreenScraper #{candidate.jeu_id} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </section>

      {game ? (
        <TgScrapeCard title="Fields" aside={<span className="text-[11.5px] tg-muted">yours → theirs</span>}>
          <TgScrapeFieldList
            game={game} candidate={candidate} rows={rows} choices={choices} onChoice={setChoice} mediaModeOf={modeOf} tokens={tokens}
            names={candidate.names} synopses={candidate.synopses}
            titleRegion={titleRegion} descLang={descLang} onTitleRegion={k => pickVariant('title', k)} onDescLang={k => pickVariant('description', k)}
          />
        </TgScrapeCard>
      ) : (
        <p className="tg-panel p-4 text-[13px] tg-muted">Pick a game to compare its fields and save this result to it.</p>
      )}

      <TgScrapeCard title={`Artwork & files · ${candidate.media.length}`}>
        <TgScrapeMediaGrid
          candidate={candidate} rows={mRows} modes={modes} tokens={tokens}
          onMode={setMode} onToken={(t, k) => setTokens(s => ({ ...s, [t]: k }))}
          readOnly={!game} imageScale={prefs.imageScale}
        />
      </TgScrapeCard>

      <TgScrapeCard title="Everything else">
        {game && (
          <div className="-mt-1 mb-2 border-b border-[var(--tg-border)] pb-2">
            <TgSwitch on={snapshot} onChange={setSnapshot} label="Also keep their raw answer" hint="Everything below (titles, dates, rating boards, dumps, hacks, tips) is always kept. This adds ScreenScraper's unprocessed answer too — in the database, not in storage." />
          </div>
        )}
        <TgScrapeRecord candidate={candidate} />
      </TgScrapeCard>

      <TgSsAttribution className="px-1" />
    </div>
  )

  if (wide) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="tg-scroll-y min-h-0 flex-1 pb-4 pr-1">{body}</div>
        {saveBar && <div className="mt-2 shrink-0 rounded-[16px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] p-3 shadow-[shadow:var(--tg-menu-shadow)]">{saveBar}</div>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {body}
      {saveBar && (
        // Full-bleed and opaque, its background reaching down over the
        // scroller's bottom padding, so nothing scrolls visibly beneath it.
        <div className="sticky bottom-0 z-[2] -mx-5 border-t border-[var(--tg-border)] bg-[var(--tg-bg)] px-5 py-2.5 shadow-[0_40px_0_0_var(--tg-bg)]">
          {saveBar}
        </div>
      )}
    </div>
  )
}

function Scroller({ wide, children }: { wide: boolean; children: ReactNode }) {
  return wide ? <div className="tg-scroll-y min-h-0 flex-1 pb-6">{children}</div> : <>{children}</>
}
