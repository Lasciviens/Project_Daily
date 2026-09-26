import type { TgaTile } from './tgAnalyticsModel'
import { useOverviewData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID, TGA_SPAN_RECENT, TGA_SPAN_WIDE } from './tgAnalyticsFormat'
import { TgAnalyticsKpis } from './TgAnalyticsKpis'
import { TgAnalyticsStatusMix } from './TgAnalyticsStatusMix'
import { TgAnalyticsRecent } from './TgAnalyticsPlayed'

/** Overview: the headline tiles, then activity, the status mix and what's idle. */
export function TgAnalyticsOverviewTab({ base, onDrill }: { base: TgaBase; onDrill: (t: TgaTile) => void }) {
  const d = useOverviewData(base)
  return (
    <>
      <TgAnalyticsKpis k={d.kpis} windowed={base.start != null} onOpen={onDrill} />
      <div className={TGA_GRID}>
        <div className={TGA_SPAN_WIDE} />
        <TgAnalyticsStatusMix mix={d.mix} total={base.scoped.length} />
        <TgAnalyticsRecent items={d.recent} className={TGA_SPAN_RECENT} />
      </div>
    </>
  )
}
