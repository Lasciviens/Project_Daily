import { useCollectionData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID } from './tgAnalyticsFormat'
import { collectionLayout } from './tgAnalyticsCollection'
import { TgAnalyticsScores } from './TgAnalyticsScores'
import { TgAnalyticsWorthNext } from './TgAnalyticsWorthNext'
import { TgAnalyticsGenres, TgAnalyticsPlatforms } from './TgAnalyticsBreakdowns'
import { TgAnalyticsStudios } from './TgAnalyticsStudios'
import { TgAnalyticsDecades } from './TgAnalyticsDecades'
import { TgAnalyticsPlayers } from './TgAnalyticsPlayers'
import { TgAnalyticsSeriesCard } from './TgAnalyticsSeriesCard'

/** Collection: what the library is made of — scores, platforms, genres, studios, eras, players and series. */
export function TgAnalyticsCollectionTab({ base }: { base: TgaBase }) {
  const d = useCollectionData(base)
  // The rows each layout makes are drawn in collectionLayout.
  const at = collectionLayout(d.series.rows.length > 0)
  return (
    <div className={TGA_GRID}>
      <TgAnalyticsScores ratings={d.ratings} scores={d.scores} className={at.ratings} />
      <TgAnalyticsWorthNext items={d.worthNext} windowed={base.start != null} />
      <TgAnalyticsPlatforms scoped={base.scoped} platforms={d.platformCount} />
      <TgAnalyticsGenres
        rows={d.genres.rows} total={d.genres.total} tagged={d.genres.tagged} games={base.scoped.length} library={base.library}
      />
      <TgAnalyticsStudios developers={d.developers} publishers={d.publishers} library={base.library} />
      <TgAnalyticsDecades decades={d.decades} className={at.decades} />
      <TgAnalyticsPlayers players={d.players} className={at.players} />
      <TgAnalyticsSeriesCard series={d.series} className={at.series} />
    </div>
  )
}
