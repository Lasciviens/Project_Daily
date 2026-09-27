import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { scaleOnly } from '../bodyweight'
import { buildTrendStats } from '../healthTrendStats'
import { useBodyweightSeries } from '../hooks/useBodyweight'
import { BodyCompositionPanel } from './BodyCompositionPanel'
import { BodyweightCharts } from './BodyweightCharts'
import { LONG_BACK_DAYS } from './dateNav'
import { num, signed } from './overview/heroFormat'
import { TrendCard } from './overview/TrendCard'
import type { HealthRange } from './sectionTypes'
import { SectionCard } from './sectionKit'

// The smart scale only (owner: "Body: only show the scale… Apple Health gets
// data from the scale anyway"). Weigh-ins are sparse, so the charts keep a
// 90-day window ENDING at the viewed day (the page's day control still moves
// them). The read covers the page's long window, so it is the same download
// the hero's weight tile uses, and the headline is the newest scale reading in
// it. The scale report's other fields fold into "More from the scale". The
// trend card below reads the same scale-only readings, so the window never
// mixes in a hand-typed Hevy weight the chart above leaves out.
export function BodySection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, setPeriod } = range
  const from = shiftDateStr(anchor, -89)
  const series = useBodyweightSeries(shiftDateStr(anchor, -LONG_BACK_DAYS), anchor)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const scale = scaleOnly(series.data ?? [])
  const days = scale.filter(d => d.date >= from)
  const latest = [...scale].reverse().find(d => d.kg != null) ?? null
  const [scaleOpen, setScaleOpen] = useState(false)
  const weighIns = scale.flatMap(d => (d.kg != null ? [{ date: d.date, value: d.kg }] : []))

  return (
    <>
      <SectionCard className="gap-4" dimmed={series.isPlaceholderData}>
        <p className="section-label">Smart scale · last 90 days</p>
        {series.isLoading
          ? <div className="h-[220px] rounded-row skeleton" aria-hidden />
          : <BodyweightCharts days={days} latest={latest} from={from} to={anchor} onViewDay={viewDay} />}
        <div className="border-t border-line pt-2">
          <button type="button" aria-expanded={scaleOpen} onClick={() => setScaleOpen(o => !o)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${scaleOpen ? 'rotate-180' : ''}`} />
            More from the scale
          </button>
          {scaleOpen && <BodyCompositionPanel />}
        </div>
      </SectionCard>
      {!series.isLoading && (
        <TrendCard title="Weight trend" stats={buildTrendStats(weighIns, { to: anchor, direction: null, sparse: true })}
          format={v => `${num(v, 1)} kg`} formatDelta={v => `${signed(v, 1)} kg`} direction={null} rateUnit="kg/week" />
      )}
    </>
  )
}
