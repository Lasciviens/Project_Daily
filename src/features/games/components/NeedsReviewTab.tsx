import { useGamesNeedingReview } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { CoverImg, SystemChip } from './gameCardKit'
import type { Game } from '../types'

// New feature — replaces RP5's 18-rule, 5-view audit-scoring system with the
// much smaller thing this app actually needs day to day: a plain filtered
// list of games missing something real (a cover, any genre, a release year,
// a platform, a primary variant) or explicitly flagged needs_review (set by
// a future ScreenScraper/ES-DE sync when a match is uncertain). See migration
// 089's header note for why the full audit view wasn't ported — it was
// one-time cataloguing QA, not an ongoing personal-use feature.
function reasonsFor(g: Game): string[] {
  const reasons: string[] = []
  if (g.needs_review) reasons.push('Flagged for review')
  if (!g.primary_cover_url) reasons.push('No cover art')
  if (!g.genres?.length) reasons.push('No genres')
  if (!g.release_year) reasons.push('No release year')
  if (g.platforms.length === 0) reasons.push('No platform/system set')
  else if (!g.platforms.some(p => p.is_primary_variant)) reasons.push('No primary platform chosen')
  return reasons
}

export interface ReviewItem { game: Game; reasons: string[]; cover: string | null }

/**
 * `items` given (the Games page): the list it computed from rows it already
 * holds — no fetch, no failure mode. Absent (the legacy page): its own query,
 * with a real error state instead of "Nothing needs attention" on a failure.
 */
export function NeedsReviewTab({ onOpenDetail, items }: { onOpenDetail: (id: string) => void; items?: ReviewItem[] }) {
  const query = useGamesNeedingReview(!items)
  const list: ReviewItem[] = items ?? (query.data ?? []).map(g => ({ game: g, reasons: reasonsFor(g), cover: g.primary_cover_url }))
  const games = list.map(x => x.game)

  if (!items && query.isLoading) return <div className="text-sm text-ink-400 py-8 text-center">Checking your library…</div>
  if (!items && query.error) return (
    <div className="text-center py-12 text-ink-500 space-y-3">
      <p className="text-sm font-medium text-ink-700">Could not check your library</p>
      <p className="text-xs break-words">{(query.error as Error).message}</p>
      <button onClick={() => query.refetch()} className="min-h-[44px] px-4 rounded-lg bg-ink-100 hover:bg-ink-200 text-sm font-medium">Try again</button>
    </div>
  )

  if (games.length === 0) return (
    <div className="text-center py-16 text-ink-400">
      <p className="text-3xl mb-3">✅</p>
      <p className="text-sm font-medium text-ink-700">Nothing needs attention</p>
      <p className="text-xs mt-1">Every game has a cover, genres, a release year and a primary platform.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-ink-400">{games.length} game{games.length !== 1 ? 's' : ''} could use a closer look.</p>
        <InfoBubble label="What does this check?">
          A game shows up here if it's missing a cover, genres, a release year, a platform, or a chosen primary platform — or if a future sync explicitly flagged it as an uncertain match. Nothing here is auto-fixed; it's just a pointer to what's incomplete.
        </InfoBubble>
      </div>
      {/* Each row's open-detail button and its scrape button are SIBLINGS
          inside the <li>, never nested: a <button> inside a <button> is
          invalid HTML and the parser silently hoists the inner one out — the
          same trap FoodTile's corner buttons already documented. */}
      <ul className="flex flex-col gap-2">
        {list.map(({ game: g, reasons, cover }) => (
          <li key={g.id}
            className="flex items-center gap-2 p-3 bg-cream-50 rounded-xl border border-orange-200 hover:border-orange-400 transition-colors">
            <button onClick={() => onOpenDetail(g.id)}
              className="flex-1 min-w-0 flex items-center gap-3 text-left">
              <div className="flex-shrink-0 w-10 rounded-lg overflow-hidden border border-ink-100 bg-ink-100" style={{ aspectRatio: '3/4' }}>
                <CoverImg url={cover} title={g.title} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-800 truncate">{g.title}</p>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <SystemChip game={g} size="sm" />
                  {reasons.map(r => (
                    <span key={r} className="text-[10px] font-medium bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">{r}</span>
                  ))}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
