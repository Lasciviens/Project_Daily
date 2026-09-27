import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useBodyweightSeries, useLatestBodyweight } from '../hooks/useBodyweight'
import { MetricMiniGrid } from './MetricMiniGrid'
import { BODY_EXTRA_METRICS } from './miniMetrics'
import { BodyCompositionPanel } from './BodyCompositionPanel'
import { BodyweightCharts } from './BodyweightCharts'
import { useRangeWindow } from './dateNav'
import type { HealthRange } from './sectionTypes'
import { SectionCard } from './sectionKit'

// Weigh-ins are sparse, so the weight charts keep a 90-day window ENDING at
// the viewed day (the page's day control still moves them). The mini cards
// follow the page's own window.
export function BodySection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, setPeriod, period } = range
  const win = useRangeWindow(range)
  const from = shiftDateStr(anchor, -89)
  const series = useBodyweightSeries(from, anchor)
  const latest = useLatestBodyweight(anchor)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }

  return (
    <SectionCard className="gap-4" dimmed={series.isPlaceholderData}>
      <p className="section-label">Body · last 90 days</p>
      {series.isLoading
        ? <div className="h-[220px] rounded-row skeleton" aria-hidden />
        : <BodyweightCharts points={series.data ?? []} latest={latest.data} from={from} to={anchor} onViewDay={viewDay} />}

      <MetricMiniGrid title="Lifestyle & environment" metrics={BODY_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} />

      <BodyCompositionPanel />
    </SectionCard>
  )
}
