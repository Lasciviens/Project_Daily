import { Flame, Footprints, Heart, HeartPulse, Moon, Scale } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { useHealthMetricSeries } from '../../../training/hooks/useHealthExport'
import {
  computeSleepSummary,
  computeDailySeries, computeHeartRateDailySeries,
  formatSleepHours as fmtHrs,
} from '../../../training/healthAggregate'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'

// A SCROLLABLE health widget (replaces the sleep-only card): one horizontal
// snap-strip you swipe through to browse the day's health at a glance —
// Sleep, Steps, Energy, Heart, Weight — each a compact panel. Every panel
// reuses the SAME aggregation code as Training → Health, so numbers can't
// disagree. Deep-dives live in Training; this is the glance.

const round = (n: number, d = 0) => { const p = 10 ** d; return Math.round(n * p) / p }

function Panel({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    // Fixed-width snap panels — the strip scrolls; each panel is content-sized.
    <div className="flex w-[150px] shrink-0 snap-start flex-col gap-1 rounded-row bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 section-label [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}{label}</p>
      {children}
    </div>
  )
}
const Big = ({ children }: { children: React.ReactNode }) => <p className="text-title font-bold leading-none tabular-nums text-fg">{children}</p>
const Sub = ({ children }: { children: React.ReactNode }) => <p className="text-meta text-fg-muted">{children}</p>
const Empty = () => <p className="py-1 text-meta text-fg-muted">No data</p>
import { useDragScroll } from '../../../../shared/hooks/useDragScroll'

export function HealthCard({ date }: { date: string }) {
  const drag = useDragScroll<HTMLDivElement>()
  // Sleep (night that ended on `date`) — 2-day window for midnight attribution.
  const { data: sleepPts = [] } = useHealthMetricSeries('sleep_analysis', shiftDateStr(date, -1), date)
  const sleep = computeSleepSummary(sleepPts).find(s => s.date === date) ?? null

  const { data: stepPts = [] }   = useHealthMetricSeries('step_count', date, date)
  const steps = computeDailySeries('step_count', stepPts).find(d => d.date === date)?.value ?? null

  const { data: energyPts = [] } = useHealthMetricSeries('active_energy', date, date)
  const energy = computeDailySeries('active_energy', energyPts).find(d => d.date === date)?.value ?? null

  const { data: hrPts = [] }     = useHealthMetricSeries('heart_rate', date, date)
  const hr = computeHeartRateDailySeries(hrPts).find(d => d.date === date) ?? null

  // Weight is 'latest' — a 30d window, newest wins.
  const { data: wPts = [] }      = useHealthMetricSeries('weight_body_mass', shiftDateStr(date, -30), date)
  const wSeries = computeDailySeries('weight_body_mass', wPts)
  const weight = wSeries.length ? wSeries[wSeries.length - 1] : null

  return (
    <Cell>
      <CellHeader icon={<HeartPulse />} title="Health" action={<CellLink to="/training">Details</CellLink>} />

      {/* Swipeable strip — snap + edge fade signals there's more to the side */}
      <div {...drag} className={`-mx-1 flex gap-2 overflow-x-auto scrollbar-none scroll-fade-x snap-x-mandatory px-1 pb-1 ${drag.className}`}>
        <Panel icon={<Moon aria-hidden />} label="Sleep">
          {sleep ? (<><Big>{fmtHrs(sleep.total)}</Big><Sub>slept</Sub></>) : <Empty />}
        </Panel>
        <Panel icon={<Footprints aria-hidden />} label="Steps">
          {steps != null ? (<><Big>{round(steps).toLocaleString('en-GB')}</Big><Sub>steps today</Sub></>) : <Empty />}
        </Panel>
        <Panel icon={<Flame aria-hidden />} label="Energy">
          {energy != null ? (<><Big>{round(energy)}</Big><Sub>active kcal</Sub></>) : <Empty />}
        </Panel>
        <Panel icon={<Heart aria-hidden />} label="Heart">
          {hr ? (<><Big>{round(hr.avg)}</Big><Sub>avg · {round(hr.min)}–{round(hr.max)} bpm</Sub></>) : <Empty />}
        </Panel>
        <Panel icon={<Scale aria-hidden />} label="Weight">
          {weight ? (<><Big>{round(weight.value, 1)}</Big><Sub>kg · {new Date(weight.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Sub></>) : <Empty />}
        </Panel>
      </div>
    </Cell>
  )
}
