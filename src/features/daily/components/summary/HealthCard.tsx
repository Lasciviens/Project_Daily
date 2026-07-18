import { Cell, CellHeader, CellLink } from './cellKit'
import { useHealthMetricSeries } from '../../../training/hooks/useHealthExport'
import {
  computeSleepSummary, extractSleepSessions, computeSleepEfficiency,
  computeDailySeries, computeHeartRateDailySeries,
} from '../../../training/healthAggregate'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'

// A SCROLLABLE health widget (replaces the sleep-only card): one horizontal
// snap-strip you swipe through to browse the day's health at a glance —
// Sleep, Steps, Energy, Heart, Weight — each a compact panel. Every panel
// reuses the SAME aggregation code as Training → Health, so numbers can't
// disagree. Deep-dives live in Training; this is the glance.

function fmtHrs(h: number): string {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}h ${mins}m`
}
const round = (n: number, d = 0) => { const p = 10 ** d; return Math.round(n * p) / p }

function Panel({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    // Fixed-width snap panels — the strip scrolls; each panel is content-sized.
    // No border (the board surface owns borders) — a soft tint is enough.
    <div className="snap-start shrink-0 w-[150px] rounded-lg bg-cream-100/60 p-3 flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{icon} {label}</p>
      {children}
    </div>
  )
}
const Big = ({ children }: { children: React.ReactNode }) => <p className="text-xl font-bold text-ink-900 leading-none tabular-nums">{children}</p>
const Sub = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink-500">{children}</p>
const Empty = () => <p className="text-[11px] text-ink-300 py-1">No data</p>

export function HealthCard({ date }: { date: string }) {
  // Sleep (night that ended on `date`) — 2-day window for midnight attribution.
  const { data: sleepPts = [] } = useHealthMetricSeries('sleep_analysis', shiftDateStr(date, -1), date)
  const sleep = computeSleepSummary(sleepPts).find(s => s.date === date) ?? null
  const sleepEff = sleep ? computeSleepEfficiency(sleep, extractSleepSessions(sleepPts, date)) : null

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
      <CellHeader icon="❤️" title="Health" action={<CellLink to="/training">Details →</CellLink>} />

      {/* Swipeable strip — snap + edge fade signals there's more to the side */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none scroll-fade-x snap-x-mandatory -mx-1 px-1 pb-1">
        <Panel icon="😴" label="Sleep">
          {sleep ? (<><Big>{fmtHrs(sleep.total)}</Big><Sub>{sleepEff != null ? `${sleepEff}% efficiency` : ''}</Sub></>) : <Empty />}
        </Panel>
        <Panel icon="🚶" label="Steps">
          {steps != null ? (<><Big>{round(steps).toLocaleString('en-GB')}</Big><Sub>steps today</Sub></>) : <Empty />}
        </Panel>
        <Panel icon="🔥" label="Energy">
          {energy != null ? (<><Big>{round(energy)}</Big><Sub>active kcal</Sub></>) : <Empty />}
        </Panel>
        <Panel icon="❤️" label="Heart">
          {hr ? (<><Big>{round(hr.avg)}</Big><Sub>avg · {round(hr.min)}–{round(hr.max)} bpm</Sub></>) : <Empty />}
        </Panel>
        <Panel icon="⚖️" label="Weight">
          {weight ? (<><Big>{round(weight.value, 1)}</Big><Sub>kg · {new Date(weight.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Sub></>) : <Empty />}
        </Panel>
      </div>
    </Cell>
  )
}
