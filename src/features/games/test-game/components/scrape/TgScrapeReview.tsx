import { useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Wand2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import type { SsCandidate, SsField, SsMediaChoice, SsPrefs } from '../../../scraper/ssTypes'
import type { MediaMode } from '../../../scraper/ssMediaCatalog'
import { ssGamePage, type ApplyResult } from '../../../scraper/ssApi'
import { useApplyScrape } from '../../../scraper/useScrape'
import {
  applySummary, candidateLine, choiceToPolicy, fieldRows, formToRom, initialChoice, mediaRows, summaryText,
  type FieldChoice, type SearchForm,
} from './tgScrapeModel'
import { TgBasisBadges, TgCandidateCover, TgFlagChips, TgScrapeCard, TgSsAttribution } from './TgScrapeParts'
import { TgScrapeFieldList } from './TgScrapeFieldList'
import { TgScrapeMediaGrid } from './TgScrapeMediaGrid'
import { TgScrapeRecord } from './TgScrapeRecord'
import { TgScrapeApplied } from './TgScrapeApplied'

/**
 * One result against one game: compare every field, choose every file, see
 * everything else they know, then save exactly that. Starts from the saved
 * defaults ("What to save"); every choice here applies to this save only.
 */
export function TgScrapeReview({ game, candidate, prefs, form, onBack }: {
  game: TgGame | null
  candidate: SsCandidate
  prefs: SsPrefs
  form: SearchForm
  onBack?: () => void
}) {
  const rows = useMemo(() => (game ? fieldRows(game, candidate) : []), [game, candidate])
  const mRows = useMemo(() => mediaRows(candidate, prefs), [candidate, prefs])

  const [choices, setChoices] = useState<Partial<Record<SsField, FieldChoice>>>(
    () => Object.fromEntries(rows.map(r => [r.field, initialChoice(r, prefs.fields[r.field])])),
  )
  const [modes, setModes] = useState<Record<string, MediaMode>>(() => Object.fromEntries(mRows.map(r => [r.type, r.mode])))
  const [tokens, setTokens] = useState<Record<string, string>>(() => Object.fromEntries(mRows.map(r => [r.type, r.chosen.token])))
  const [titleRegion, setTitleRegion] = useState<string | null>(null)
  const [descLang, setDescLang] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState(prefs.snapshot)
  const [applied, setApplied] = useState<{ runId: string; result: ApplyResult } | null>(null)
  const apply = useApplyScrape()

  const modeOf = (type: string) => modes[type] ?? 'skip'
  const mediaPlan = mRows.map(r => ({ row: r, mode: modeOf(r.type), entry: r.entries.find(e => e.token === tokens[r.type]) ?? r.chosen }))
  const summary = applySummary(rows, choices, mediaPlan, prefs.imageScale)
  const nothing = summary.fields === 0 && summary.store === 0 && summary.onDemand === 0 && !snapshot

  const save = () => {
    if (!game) return
    const fields = Object.fromEntries(rows.map(r => [r.field, choiceToPolicy(choices[r.field] ?? 'keep')])) as Record<SsField, 'fill' | 'replace' | 'skip'>
    const media: SsMediaChoice[] = mediaPlan
      .filter(m => m.mode !== 'skip')
      .map(m => ({ type: m.row.type, token: m.entry.token, mode: m.mode === 'store' ? 'store' : 'on_demand' }))
    apply.mutate({
      game_id: game.id, jeu_id: candidate.jeu_id, system: form.system || candidate.system.id,
      rom: form.useRom ? formToRom(form) : null, fields, media, matched_by: candidate.matched_by,
      overrides: { title_region: titleRegion, description_lang: descLang },
      // The snapshot switch applies to this save only; the saved default is unchanged.
      ...(snapshot !== prefs.snapshot ? { prefs: { ...prefs, snapshot } } : {}),
    }, {
      onSuccess: (r) => setApplied({ runId: r.run_id, result: r.result }),
    })
  }

  if (applied && game) return <TgScrapeApplied game={game} runId={applied.runId} result={applied.result} onBack={onBack} onAgain={() => setApplied(null)} />

  return (
    <div className="flex flex-col gap-4">
      {onBack && (
        <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-[13.5px] font-semibold text-[var(--tg-accent)]">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} aria-hidden /> Results
        </button>
      )}

      <section className="tg-panel flex gap-4 p-4">
        <TgCandidateCover candidate={candidate} regions={prefs.regions} width={360} className="h-[150px] w-[108px] shrink-0 overflow-hidden rounded-lg sm:h-[190px] sm:w-[136px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-[19px] font-bold leading-tight tracking-[-0.01em]">{String(candidate.values.title ?? `#${candidate.jeu_id}`)}</h2>
          <p className="text-[12.5px] tg-muted">{candidateLine(candidate) || '—'}</p>
          <div className="flex flex-wrap gap-1"><TgBasisBadges basis={candidate.matched_by} /><TgFlagChips flags={candidate.flags} /></div>
          {candidate.rom?.filename && <p className="truncate text-[11.5px] tg-faint" title={candidate.rom.filename}>Matched dump: {candidate.rom.filename}</p>}
          <a href={ssGamePage(candidate.jeu_id)} target="_blank" rel="noreferrer" className="mt-auto inline-flex min-h-[36px] items-center gap-1 self-start text-[12.5px] font-semibold text-[var(--tg-accent)]">
            ScreenScraper #{candidate.jeu_id} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </section>

      {game ? (
        <TgScrapeCard title="Fields" aside={<span className="text-[11.5px] tg-muted">vs. {game.title}</span>}>
          <TgScrapeFieldList
            rows={rows} choices={choices} onChoice={(f, c) => setChoices(s => ({ ...s, [f]: c }))} mediaModeOf={modeOf}
            names={candidate.names} synopses={candidate.synopses}
            titleRegion={titleRegion} descLang={descLang} onTitleRegion={setTitleRegion} onDescLang={setDescLang}
            readOnly={false}
          />
        </TgScrapeCard>
      ) : (
        <p className="tg-panel p-4 text-[13px] tg-muted">Pick a game to compare its fields and save this result to it.</p>
      )}

      <TgScrapeCard title={`Artwork & files · ${candidate.media.length}`} aside={<span className="text-[11.5px] tg-muted">Save · Link · Skip</span>}>
        <TgScrapeMediaGrid
          candidate={candidate} rows={mRows} modes={modes} tokens={tokens}
          onMode={(t, m) => setModes(s => ({ ...s, [t]: m }))} onToken={(t, k) => setTokens(s => ({ ...s, [t]: k }))}
          readOnly={!game}
        />
      </TgScrapeCard>

      <TgScrapeCard
        title="Everything else"
        aside={game ? (
          <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-[12px] font-semibold text-[var(--tg-text-2)]">
            <input type="checkbox" checked={snapshot} onChange={e => setSnapshot(e.target.checked)} className="h-4 w-4 accent-[var(--tg-accent)]" />
            Save their full record
          </label>
        ) : undefined}
      >
        <TgScrapeRecord candidate={candidate} />
      </TgScrapeCard>

      <TgSsAttribution className="px-1" />

      {game && (
        <div className="sticky bottom-0 z-[2] -mx-1 rounded-[16px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] p-3 shadow-[shadow:var(--tg-menu-shadow)]">
          <p className="mb-2 text-center text-[12px] tabular-nums text-[var(--tg-text-2)]">
            {summaryText(summary)}{snapshot ? ' · full record' : ''}
          </p>
          <button type="button" onClick={save} disabled={apply.isPending || nothing} className="tg-btn tg-btn-primary w-full">
            <Wand2 aria-hidden className={`h-4 w-4 ${apply.isPending ? 'animate-pulse' : ''}`} strokeWidth={2.2} />
            {apply.isPending ? 'Saving…' : `Save to ${game.title.length > 28 ? `${game.title.slice(0, 27)}…` : game.title}`}
          </button>
        </div>
      )}
    </div>
  )
}
