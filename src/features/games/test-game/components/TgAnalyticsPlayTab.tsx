import { usePlayData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID } from './tgAnalyticsFormat'
import { TgAnalyticsMostPlayed } from './TgAnalyticsPlayed'

/** Play: how much of the library gets played, where the hours go, and the libraries side by side. */
export function TgAnalyticsPlayTab({ base }: { base: TgaBase }) {
  const d = usePlayData(base)
  return (
    <div className={TGA_GRID}>
      <TgAnalyticsMostPlayed items={d.mostPlayed} />
    </div>
  )
}
