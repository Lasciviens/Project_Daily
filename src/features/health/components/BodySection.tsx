import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useBodyweightSeries, useLatestBodyweight } from '../hooks/useBodyweight'
import { BodyCompositionPanel } from './BodyCompositionPanel'
import { BodyweightCharts } from './BodyweightCharts'
import { LONG_BACK_DAYS } from './dateNav'
import type { HealthRange } from './sectionTypes'
import { SectionCard } from './sectionKit'

// Weigh-ins are sparse, so the weight charts keep a 90-day window ENDING at
// the viewed day (the page's day control still moves them). The read covers
// the page's long window, so it is the same download the hero's weight tile
// uses. The smart scale's other fields fold into "More from the scale".
export function BodySection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, setPeriod } = range
  const from = shiftDateStr(anchor, -89)
  const series = useBodyweightSeries(shiftDateStr(anchor, -LONG_BACK_DAYS), anchor)
  const latest = useLatestBodyweight(anchor)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const points = (series.data ?? []).filter(p => p.date >= from)
  const [scaleOpen, setScaleOpen] = useState(false)

  return (
    <SectionCard className="gap-4" dimmed={series.isPlaceholderData}>
      <p className="section-label">Weight and body fat · last 90 days</p>
      {series.isLoading
        ? <div className="h-[220px] rounded-row skeleton" aria-hidden />
        : <BodyweightCharts points={points} latest={latest.data} from={from} to={anchor} onViewDay={viewDay} />}
      <div className="border-t border-line pt-2">
        <button type="button" aria-expanded={scaleOpen} onClick={() => setScaleOpen(o => !o)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${scaleOpen ? 'rotate-180' : ''}`} />
          More from the scale
        </button>
        {scaleOpen && <BodyCompositionPanel />}
      </div>
    </SectionCard>
  )
}
