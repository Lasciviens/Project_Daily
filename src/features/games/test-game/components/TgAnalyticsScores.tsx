import { useMemo, useState } from 'react'
import { Star, Trophy } from 'lucide-react'
import { formatStars } from '../testGameModel'
import type { scoreSeries } from './tgAnalyticsMore'
import type { ratingSeries } from './tgAnalyticsSeries'
import { fmtInt, plural } from './tgAnalyticsFormat'
import { TGA_RATINGS_VIEWS, defaultRatingsView, scoreColumns, type TgaRatingsView } from './tgAnalyticsCollection'
import { TgAnalyticsColumns } from './TgAnalyticsColumns'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgSegmented } from './scrape/TgScrapeParts'

const HEIGHT = 180
const NOTE = 'mt-3 text-[11.5px] leading-relaxed text-[var(--tg-muted)]'

/**
 * Two views of how games rate: the community's 0–100 score (ES-DE's scraped
 * rating or ScreenScraper's note) in ten-point steps, or your own stars in
 * half-star steps. Opens on the community view until you've rated five games.
 */
export function TgAnalyticsScores({ ratings, scores, className = '' }: {
  ratings: ReturnType<typeof ratingSeries>
  scores: ReturnType<typeof scoreSeries>
  className?: string
}) {
  const [view, setView] = useState<TgaRatingsView>(() => defaultRatingsView(ratings.rated))
  const columns = useMemo(() => scoreColumns(scores.buckets), [scores.buckets])
  const community = view === 'community'
  const meta = community
    ? scores.scored ? `${fmtInt(scores.scored)} scored · median ${scores.median}/100` : undefined
    : ratings.rated ? `${plural(ratings.rated, 'rated game')} · median ${formatStars(ratings.median)}` : undefined

  return (
    <TgAnalyticsCard label="Ratings" meta={meta} className={className}>
      <TgSegmented size="sm" label="Whose ratings" value={view} options={TGA_RATINGS_VIEWS} onChange={setView} />
      <div className="mt-3 flex flex-col">
        {community ? (
          scores.scored ? (
            <TgAnalyticsColumns
              columns={columns} height={HEIGHT} noun={{ one: 'game', many: 'games' }}
              caption="Games per community score, in ten-point steps"
            />
          ) : (
            <TgAnalyticsEmpty
              icon={Trophy} className="min-h-[180px]" title="No community scores yet"
              hint="Scores arrive with ES-DE and ScreenScraper metadata — scrape a game to fill this."
            />
          )
        ) : ratings.rated ? (
          <TgAnalyticsColumns
            columns={ratings.columns} height={HEIGHT} allTicks noun={{ one: 'game', many: 'games' }}
            caption="Games per personal rating, in half-star steps"
          />
        ) : (
          <TgAnalyticsEmpty icon={Star} className="min-h-[180px]" title="No ratings yet" hint="Rate a game with the stars in its detail panel." />
        )}
      </div>
      {/* One line in both views, so switching never makes the card jump. */}
      <p className={NOTE}>
        {community ? 'Community scores come from ES-DE and ScreenScraper (0–100).' : 'Your own ratings, in half-star steps.'}
      </p>
    </TgAnalyticsCard>
  )
}
