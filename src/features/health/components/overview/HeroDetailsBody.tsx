import { TonePill, useChartColors, type Tone } from '../../../../shared/ui'
import { addDaysIso } from '../../healthWindowStats'
import { buildTrendStats, type VitalState } from '../../healthTrendStats'
import { classify } from '../../benchmarks/healthBenchmarks'
import { BODYWEIGHT_SOURCE_LABEL } from '../../bodyweight'
import { fmtDayMonth } from '../healthFormat'
import type { HealthHero } from './useHealthHero'
import { DailyTrend } from './DailyTrend'
import { MetricExplainer } from './MetricExplainer'
import { TrendStatsBlock } from './TrendStatsBlock'
import { Summary } from './HeroDetailsActivity'
import { num, signed } from './heroFormat'

// Detail sheets for the Resting HR, Weight and Overnight vitals hero tiles.

interface Props { hero: HealthHero; onViewDay: (date: string) => void }

export function RhrDetail({ hero, onViewDay }: Props) {
  const { rhr, anchor: A, ctx } = hero
  const c = useChartColors()
  const b = rhr.baseline
  const stats = buildTrendStats(rhr.series, { to: A, direction: 'down' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        Your 7-day average is <b className="text-fg">{num(rhr.avg7)} bpm</b>
        {b && <> against your usual {num(b.median)} bpm over the 60 days before ({signed(rhr.delta ?? 0)} bpm)</>}.
        {' '}A rise of 5 bpm or more above your own baseline is a common fatigue or illness signal; it is a monitoring convention, not a diagnosis.
      </Summary>
      <DailyTrend series={rhr.series} from={addDaysIso(A, -89)} to={A} kind="dots" rolling label="resting HR" unit="bpm"
        ariaLabel="Resting heart rate per day, last 90 days, with your usual range" color={c.series[3]}
        band={b?.sd != null ? { y1: b.mean - b.sd, y2: b.mean + b.sd, label: 'your usual range' } : undefined}
        yDomain={['auto', 'auto']} onViewDay={onViewDay} />
      <TrendStatsBlock stats={stats} format={v => num(v)} formatDelta={v => `${signed(v)} bpm`} direction="down" rateUnit="bpm/week" />
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="resting_heart_rate" ctx={ctx} value={rhr.avg7} cls={rhr.cls} />
      </div>
    </div>
  )
}

export function WeightDetail({ hero, onViewDay }: Props) {
  const { weight: w, anchor: A, ctx } = hero
  const c = useChartColors()
  const stats = buildTrendStats(w.series, { to: A, direction: null, sparse: true })
  const lastSource = w.lastDate ? w.sources.get(w.lastDate) : undefined
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        {w.ma7 != null ? <>7-day average <b className="text-fg">{num(w.ma7, 1)} kg</b>. </> : null}
        {w.lastKg != null && w.lastDate && <>Last weigh-in {num(w.lastKg, 1)} kg on {fmtDayMonth(w.lastDate)}{lastSource ? ` (${BODYWEIGHT_SOURCE_LABEL[lastSource]})` : ''}. </>}
        {w.perWeek != null && <>Over the last 28 days the trend is <b className="text-fg">{signed(w.perWeek, 2)} kg a week</b>.</>}
      </Summary>
      <DailyTrend series={w.series} from={addDaysIso(A, -89)} to={A} kind="line" rolling label="weigh-in" unit="kg"
        ariaLabel="Weigh-ins over the last 90 days with the 7-day average" color={c.series[1]}
        formatValue={v => num(v, 1)} yDomain={['auto', 'auto']} onViewDay={onViewDay} />
      <TrendStatsBlock stats={stats} format={v => `${num(v, 1)} kg`} formatDelta={v => `${signed(v, 1)} kg`} direction={null} rateUnit="kg/week" />
      <p className="text-meta text-fg-muted">
        {w.fatPct != null && <>Latest body fat {num(w.fatPct, 1)}%. </>}
        {w.waistCm != null && w.waistDate && <>Latest waist {num(w.waistCm, 1)} cm ({fmtDayMonth(w.waistDate)}, Hevy). </>}
        Whether this pace is right for your cut, maintenance or gain — and whether it is fat or muscle — is in the Goal progress tab.
      </p>
      {w.whtr != null && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="waist_to_height" ctx={ctx} value={w.whtr} cls={w.whtrCls} />
        </div>
      )}
      {w.bmi != null && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="bmi" ctx={ctx} value={w.bmi} cls={w.bmiCls} />
        </div>
      )}
      {w.bmi == null && <p className="text-meta text-fg-muted">Add your height in the profile to see BMI and waist-to-height.</p>}
    </div>
  )
}

const STATE_TONE: Record<VitalState, Tone> = { inside: 'success', above: 'warn', below: 'warn', unknown: 'neutral' }
const STATE_LABEL: Record<VitalState, string> = { inside: 'Usual', above: 'Above usual', below: 'Below usual', unknown: 'Not enough data' }

export function VitalsDetail({ hero, onViewDay }: Props) {
  const { vitals: v, anchor: A, ctx } = hero
  const c = useChartColors()
  const resp = v.items.find(i => i.key === 'resp')
  const spo2 = v.items.find(i => i.key === 'spo2')
  const respCls = resp?.value != null ? classify('respiratory_rate', resp.value, { ...ctx, baseline: resp.range ? { mean: resp.range.center } : null }) : null
  const spo2Cls = spo2?.value != null ? classify('blood_oxygen', spo2.value, ctx) : null
  const hrvStats = buildTrendStats(v.hrvSeries, { to: A, direction: 'up' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>{v.summary.text}. Each reading is compared with your own usual range, not a population norm, and nothing is added up into a score.</Summary>
      <ul className="flex flex-col divide-y divide-line rounded-row border border-line">
        {v.items.map(i => (
          <li key={i.key} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-fg">{i.label}</p>
              <p className="text-micro font-normal text-fg-muted">{i.rangeRule}</p>
            </div>
            <div className="text-right">
              <p className="text-body font-semibold tabular-nums text-fg">
                {i.key === 'temp' && i.value != null && i.range ? `${signed(i.value - i.range.center, 1)} °C` : `${num(i.value, i.decimals)} ${i.unit}`}
              </p>
              <p className="text-micro font-normal text-fg-muted">
                {i.range ? (i.key === 'temp' ? `usual ± ${num((i.range.high - i.range.low) / 2, 1)} °C` : `usual ${num(i.range.low, i.decimals)}–${num(i.range.high, i.decimals)}`) : 'no usual range yet'}
                {i.date && i.date !== A ? ` · ${fmtDayMonth(i.date)}` : ''}
              </p>
            </div>
            <TonePill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</TonePill>
          </li>
        ))}
      </ul>
      <p className="text-micro font-normal text-fg-faint">
        Apple’s Vitals app also watches sleeping heart rate; Health Auto Export doesn’t send it, so it isn’t counted here.
      </p>
      <div>
        <p className="section-label mb-1">HRV (SDNN), last 90 days</p>
        <DailyTrend series={v.hrvSeries} from={addDaysIso(A, -89)} to={A} kind="dots" rolling label="HRV" unit="ms"
          ariaLabel="Heart rate variability per day, last 90 days, with your usual range" color={c.series[1]}
          band={v.hrvRange ? { y1: v.hrvRange.low, y2: v.hrvRange.high, label: 'your usual range' } : undefined}
          yDomain={['auto', 'auto']} onViewDay={onViewDay} />
      </div>
      <TrendStatsBlock stats={hrvStats} format={x => num(x)} formatDelta={x => `${signed(x)} ms`} direction="up" />
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="heart_rate_variability" ctx={{ ...ctx, baseline: v.hrvRange ? { mean: v.hrvRange.center, sd: (v.hrvRange.high - v.hrvRange.low) / 2 } : null }}
          value={v.hrv7} cls={v.hrvCls} />
      </div>
      {respCls && resp && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="respiratory_rate" ctx={ctx} value={resp.value} cls={respCls} />
        </div>
      )}
      {spo2Cls && spo2 && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="blood_oxygen" ctx={ctx} value={spo2.value} cls={spo2Cls} />
        </div>
      )}
    </div>
  )
}
