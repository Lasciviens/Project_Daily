import { ChevronRight, Star } from 'lucide-react'
import type { SsCandidate, SsQueryOutcome } from '../../../scraper/ssTypes'
import type { SearchResponse } from '../../../scraper/ssApi'
import { useScrapePrefs } from '../../../scraper/useScrape'
import { BASIS_LABEL, mediaCount, playersText } from './tgScrapeModel'
import { TgBasisBadges, TgCandidateCover, TgChip, TgFlagChips } from './TgScrapeParts'

function outcomeText(o: SsQueryOutcome): string {
  const what = BASIS_LABEL[o.kind]
  if (o.status === 'ok') return `${what}: ${o.count} result${o.count === 1 ? '' : 's'}`
  if (o.status === 'no_match') return `${what}: nothing`
  if (o.status === 'skipped') return `${what}: ${o.message ?? 'not searched'}`
  return `${what}: ${o.message ?? 'failed'}`
}

function ResultRow({ c, active, onPick, regions, yourSystem }: { c: SsCandidate; active: boolean; onPick: () => void; regions: string[]; yourSystem: number | null }) {
  const onYourSystem = yourSystem != null && c.system.id === yourSystem
  const extras = [
    c.values.genres ? (c.values.genres as string[]).slice(0, 2).join(', ') : null,
    playersText(c.values.players),
    mediaCount(c),
  ].filter(Boolean).join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full items-center gap-3 rounded-[14px] border p-2.5 text-left transition-colors ${
          active ? 'border-[var(--tg-accent)] bg-[var(--tg-accent-soft)]' : 'border-[var(--tg-border)] bg-[var(--tg-panel)] [@media(hover:hover)]:hover:border-[var(--tg-border-strong)]'
        } ${yourSystem != null && !onYourSystem ? 'opacity-90' : ''}`}
      >
        <TgCandidateCover candidate={c} regions={regions} width={120} className="h-[78px] w-[56px] shrink-0 overflow-hidden rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-[14px] font-semibold leading-snug">{String(c.values.title ?? `#${c.jeu_id}`)}</span>
            {c.note20 != null && (
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold tabular-nums text-[var(--tg-text-2)]" title="ScreenScraper's community score, out of 20">
                <Star className="h-3 w-3 fill-[var(--tg-star)]" strokeWidth={0} aria-hidden />{c.note20}/20
              </span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {c.system.name && <TgChip tone={onYourSystem ? 'good' : 'neutral'}>{onYourSystem ? `✓ ${c.system.name}` : c.system.name}</TgChip>}
            {c.values.release_year != null && <TgChip>{String(c.values.release_year)}</TgChip>}
            <TgBasisBadges basis={c.matched_by} />
            <TgFlagChips flags={c.flags} />
          </span>
          <span className="mt-1 block truncate text-[11.5px] tg-muted">{[c.values.publisher, extras].filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 tg-muted" aria-hidden />
      </button>
    </li>
  )
}

/** What the search found: every result (exact ones first, your game's system
 *  marked) and, in one quiet line, how each lookup went. */
export function TgScrapeResults({ response, searching, error, pickedId, onPick, canApply, systemHint }: {
  response: SearchResponse | null
  searching: boolean
  error: string | null
  pickedId: string | null
  onPick: (c: SsCandidate) => void
  canApply: boolean
  systemHint: { id: number; name: string } | null
}) {
  const { prefs } = useScrapePrefs()
  if (searching && !response) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Searching">
        {[0, 1, 2].map(i => <div key={i} className="tg-skeleton h-[100px] rounded-[14px]" />)}
      </div>
    )
  }
  if (error && !response) return <p className="tg-panel p-4 text-[13px] text-[var(--tg-red)]">{error}</p>
  if (!response) return null
  const list = response.candidates
  const errors = response.outcomes.filter(o => o.status === 'error')
  const quiet = response.outcomes.filter(o => o.status !== 'error')
  return (
    <section aria-label="Results" className={`flex flex-col gap-2 ${searching ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-0.5">
        <h2 className="tg-section-label">{list.length} result{list.length === 1 ? '' : 's'}</h2>
        {response.remaining_today != null && (
          <span className="text-[11px] tabular-nums tg-faint">{response.remaining_today.toLocaleString('en-GB')} requests left today</span>
        )}
      </div>
      {quiet.length > 0 && <p className="px-0.5 text-[11.5px] leading-snug tg-muted">{quiet.map(outcomeText).join(' · ')}</p>}
      {errors.map((o, i) => (
        <p key={i} className="rounded-lg bg-[var(--tg-red-soft)] px-2.5 py-1.5 text-[12px] text-[var(--tg-red)]">{outcomeText(o)}</p>
      ))}
      {list.length === 0 ? (
        <p className="tg-panel p-4 text-[13px] leading-relaxed tg-muted">
          Nothing found. Try a shorter name, set the system to "Any system", or add a CRC/MD5 from the ROM — a hash finds the exact dump even under another name.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(c => (
            <ResultRow key={c.jeu_id} c={c} active={c.jeu_id === pickedId} onPick={() => onPick(c)} regions={prefs.regions} yourSystem={systemHint?.id ?? null} />
          ))}
        </ul>
      )}
      {!canApply && list.length > 0 && <p className="px-0.5 text-[11.5px] tg-muted">Pick a game above to save a result to it.</p>}
    </section>
  )
}
