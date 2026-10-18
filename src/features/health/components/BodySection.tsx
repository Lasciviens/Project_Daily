import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { scaleOnly } from '../bodyweight'
import { useBodyweightSeries } from '../hooks/useBodyweight'
import { BodyCompositionPanel } from './BodyCompositionPanel'
import { BodyweightCharts } from './BodyweightCharts'
import { useRangeWindow } from './dateNavModel'
import type { HealthRange } from './sectionTypes'
import { SectionCard } from './sectionKit'

// The smart scale only (owner: "Body: only show the scale… Apple Health gets
// data from the scale anyway"). The charts span the period picked in the
// range bar, ending at the viewed day; a single day shows that day's
// weigh-in (or the newest one before it, with its date) and no chart. The
// read covers the page's long window, so it is the same download the hero's
// weight tile and the Weekly changes card use. The scale report's other
// fields fold into "More from the scale". The Hevy log ("Logged in Hevy",
// HevyMeasurementsCard) keeps its own card and is never merged in; the page
// places the cards (healthBoards.ts → BODY_BOARD).

/** The scale charts (the Body window's main card). */
export function BodyScaleCard({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, setPeriod } = range
  const win = useRangeWindow(range)
  const series = useBodyweightSeries(win.fetchFrom, anchor)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const scale = scaleOnly(series.data ?? [])
  const days = scale.filter(d => d.date >= win.from && d.date <= anchor)
  const latest = [...scale].reverse().find(d => d.kg != null && d.date <= anchor) ?? null
  const [scaleOpen, setScaleOpen] = useState(false)
  return (
    <SectionCard className="gap-4" dimmed={series.isPlaceholderData}>
      <p className="section-label">Smart scale</p>
      {series.isLoading
        ? <div className="h-[220px] rounded-row skeleton" aria-hidden />
        : <BodyweightCharts days={days} latest={latest} from={win.from} to={anchor} onViewDay={viewDay} />}
      <div className="border-t border-line pt-2">
        <button type="button" aria-expanded={scaleOpen} onClick={() => setScaleOpen(o => !o)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${scaleOpen ? 'rotate-180' : ''}`} />
          More from the scale
        </button>
        {scaleOpen && <BodyCompositionPanel from={win.from} to={anchor} />}
      </div>
    </SectionCard>
  )
}
