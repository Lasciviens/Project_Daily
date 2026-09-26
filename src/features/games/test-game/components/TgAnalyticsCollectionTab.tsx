import { useCollectionData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID } from './tgAnalyticsFormat'
import { TgAnalyticsRatings } from './TgAnalyticsCharts'
import { TgAnalyticsGenres } from './TgAnalyticsBreakdowns'

/** Collection: what the library is made of — scores, platforms, genres, studios, eras. */
export function TgAnalyticsCollectionTab({ base }: { base: TgaBase }) {
  const d = useCollectionData(base)
  return (
    <div className={TGA_GRID}>
      <TgAnalyticsRatings {...d.ratings} />
      <TgAnalyticsGenres rows={d.genres.rows} total={d.genres.total} tagged={d.genres.tagged} games={base.scoped.length} />
    </div>
  )
}
