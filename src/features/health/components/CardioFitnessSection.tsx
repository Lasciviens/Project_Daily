import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { TonePill, useChartColors } from '../../../shared/ui'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useHealthProfile } from '../../training/hooks/useAthleteProfile'
import { contextFor, vo2Explain } from '../benchmarks/healthBenchmarks'
import { daysBetweenIso } from '../healthWindowStats'
import { useHealthDaily, useLatestHealthValue } from '../hooks/useHealthExport'
import { DailyTrend } from './overview/DailyTrend'
import { MetricExplainer } from './overview/MetricExplainer'
import { MetricMiniGrid } from './MetricMiniGrid'
import { CARDIO_EXTRA_METRICS } from './miniMetrics'
import { useRangeWindow } from './dateNav'
import type { HealthRange } from './sectionTypes'
import { SectionCard } from './sectionKit'
import { fmtDayMonth } from './healthFormat'

// Cardio fitness, led by VO₂ max — deliberately NOT a hero tile (owner
// correction): Apple only estimates it on outdoor walks, runs and hikes, it
// reads 4.5–6.3 ml/kg/min low in validation studies, and it arrives a few
// times a month. So it always shows its date, the ± watch band and a year of
// dots, never a daily number.
/** `extras`: the recovery grid at the card's foot (off when the page gives it a card of its own). */
export function CardioFitnessSection({ range, extras = true }: { range: HealthRange; extras?: boolean }) {
  const { anchor, setAnchor, setPeriod, period } = range
  const c = useChartColors()
  const win = useRangeWindow(range)
  const { data: profile } = useHealthProfile()
  const ctx = contextFor(profile, win.today)
  const latest = useLatestHealthValue('vo2_max', anchor).data
  const history = useHealthDaily('vo2_max', shiftDateStr(anchor, -364), anchor)
  const [planOpen, setPlanOpen] = useState(false)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }

  const ex = latest ? vo2Explain(latest.value, ctx) : null
  const ago = latest ? daysBetweenIso(latest.date, anchor) : null
  const refLines = [
    ...(ex?.average != null ? [{ y: ex.average, label: 'average for your age' }] : []),
    ...(ex?.good != null ? [{ y: ex.good, label: 'good (75th pct)' }] : []),
  ]

  return (
    <SectionCard>
      {!latest ? (
        <p className="text-meta text-fg-muted">
          No VO₂ max estimate yet. Apple only estimates it from outdoor walks, runs and hikes recorded with the Watch.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="section-label">VO₂ max · latest estimate</p>
              <p className="text-kpi font-bold leading-tight tabular-nums text-fg">
                {latest.value.toFixed(1)}<span className="text-body font-normal text-fg-muted"> ml/kg/min</span>
              </p>
              <p className="text-meta text-fg-muted">
                {fmtDayMonth(latest.date)} · {ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}
                {ex && <> · watch error about ± 7 ({ex.watchBand.low.toFixed(1)}–{ex.watchBand.high.toFixed(1)})</>}
              </p>
            </div>
            {ex && <TonePill tone={ex.classification.tone}>{ex.category}</TonePill>}
          </div>
          {ex && (
            <p className="text-meta text-fg-2">
              {ex.ageGroup && ex.average != null
                ? <>{ex.ageGroup}: average {ex.average.toFixed(1)}, good (75th percentile) {ex.good?.toFixed(1)} — you’re around the {ex.percentile}th percentile (FRIEND 2015).</>
                : ex.classification.referenceText}
              {ex.norwegianAverage && <> {ex.norwegianAverage.label}.</>}
            </p>
          )}
          <DailyTrend series={history.data ?? []} from={shiftDateStr(anchor, -364)} to={anchor} kind="dots" label="VO₂ max" unit="ml/kg/min"
            ariaLabel="VO₂ max estimates over the last 12 months" color={c.series[2]} formatValue={v => v.toFixed(1)}
            refLines={refLines} yDomain={['auto', 'auto']} onViewDay={viewDay} />
          {ex && (
            <div>
              <button type="button" aria-expanded={planOpen} onClick={() => setPlanOpen(o => !o)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
                <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${planOpen ? 'rotate-180' : ''}`} />
                What it means and how to raise it
              </button>
              {planOpen && (
                <div className="mt-2 flex flex-col gap-3 text-meta">
                  <p className="text-fg-2"><span className="font-semibold text-fg">Plan:</span> {ex.plan}</p>
                  <p className="text-fg-2"><span className="font-semibold text-fg">Time frame:</span> {ex.timeFrame}</p>
                  <p className="text-fg-muted">{ex.expectedGain.text}</p>
                  <p className="text-fg-muted">{ex.watchCaveat}</p>
                  <MetricExplainer metric="vo2_max" ctx={ctx} value={latest.value} cls={ex.classification} extraSources={ex.sources} />
                </div>
              )}
            </div>
          )}
        </>
      )}
      {extras && <MetricMiniGrid title="Recovery and effort" metrics={CARDIO_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} hideWhenEmpty />}
    </SectionCard>
  )
}
