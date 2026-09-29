import { useChartColors } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { currentDeviceSeries, scaleChartDomain, type ScaleDay } from '../bodyweight'
import { daysBetweenIso, fillDays, linearTrendPerDay, rollingMean } from '../healthWindowStats'
import { HealthTrendChart, type TrendPoint, type TrendSeries } from './HealthTrendChart'
import { fmtAxisDate, fmtDayMonth } from './healthFormat'

// The smart scale's weight, body fat and lean mass as plain lines (owner:
// "only show the scale… don't need dots"). Hand-typed Hevy weights are left
// out here (scaleOnly in bodyweight.ts). The weight chart adds the 7-day
// average, the honest trend: single weigh-ins swing 1-2 kg with water and food.
// Body fat and lean mass come from the scale in use only (currentDeviceSeries):
// two scales' estimates don't line up, while their weights do.

const STALE_AFTER_DAYS = 3
// The smallest y-range each chart shows, so a flat week stays flat on screen.
const MIN_SPAN: Record<Field, number> = { kg: 3, fatPct: 3, leanKg: 3 }

interface Props {
  /** Scale readings inside [from, to]. */
  days: ScaleDay[]
  /** The newest scale weight on or before `to` (may be older than `from`). */
  latest: ScaleDay | null
  from: string
  to: string
  onViewDay: (date: string) => void
}

type Field = 'kg' | 'fatPct' | 'leanKg'

function dense(days: ScaleDay[], field: Field, from: string, to: string) {
  const readings = days.filter(d => d[field] != null).map(d => ({ date: d.date, value: d[field] as number }))
  return { readings, filled: fillDays(readings, from, to) }
}

/** A solid line through the readings; a lone reading keeps its dot, since a
 *  line with one point draws nothing. */
function readingLine(key: string, label: string, color: string, count: number): TrendSeries {
  return count >= 2
    ? { key, label, color, kind: 'line', plain: true, connectNulls: true }
    : { key, label, color, kind: 'line' }
}

export function BodyweightCharts({ days, latest, from, to, onViewDay }: Props) {
  const c = useChartColors()

  const weight = dense(days, 'kg', from, to)
  const weightMean = rollingMean(weight.filled, 7, 2)
  const weightData: TrendPoint[] = weight.filled.map((d, i) => ({
    label: fmtAxisDate(d.date), date: d.date, kg: d.value, mean7: weightMean[i].value,
  }))

  // Trend over the last four weeks of readings, in kg/week — never
  // first-vs-last raw readings, which a single water-heavy morning can flip.
  const recent = weight.readings.filter(p => daysBetweenIso(p.date, to) <= 27)
  const trend = recent.length >= 3 && daysBetweenIso(recent[0].date, recent[recent.length - 1].date) >= 7
    ? linearTrendPerDay(recent)
    : null
  const perWeek = trend ? trend.slopePerDay * 7 : null
  const stale = latest ? daysBetweenIso(latest.date, to) : null
  // Body fat and lean mass side by side once the card is wide enough — only
  // when both have readings, so a lone chart keeps the full width.
  const fat = currentDeviceSeries(days, 'fatPct')
  const lean = currentDeviceSeries(days, 'leanKg')
  const pair = fat.readings.length > 0 && lean.readings.length > 0

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="section-label flex items-center gap-1">
            Weight
            <InfoBubble label="Where weight comes from">
              Your smart scale, read from Apple Health — the scale's app writes every weigh-in there. A scale report
              imported from a photo fills a day Apple Health hasn't synced yet. Weights typed into Hevy aren't shown
              here. The dashed line is the 7-day average: a single weigh-in swings 1–2 kg with water and food.
            </InfoBubble>
          </p>
          <p className="text-kpi font-bold leading-tight tabular-nums text-fg">
            {latest?.kg != null ? latest.kg.toFixed(1) : '—'}{latest?.kg != null && <span className="text-body font-normal text-fg-muted"> kg</span>}
          </p>
          {latest && (
            <p className="text-meta text-fg-muted">
              Smart scale · {fmtDayMonth(latest.date)}
              {stale != null && stale >= STALE_AFTER_DAYS && (
                <span data-tone="warn" className="tone-text font-medium"> · {stale} days before the day you're viewing</span>
              )}
            </p>
          )}
        </div>
        {trend && perWeek != null && (
          <p className="text-meta text-fg-muted">
            Trend <span className="font-semibold tabular-nums text-fg">{perWeek > 0 ? '+' : perWeek < 0 ? '−' : '±'}{Math.abs(perWeek).toFixed(2)} kg/week</span> (last 4 weeks, {trend.n} weigh-ins)
          </p>
        )}
      </div>
      {weight.readings.length === 0
        ? <p className="py-6 text-center text-meta text-fg-muted">No scale readings in the last 90 days.</p>
        : (
          <HealthTrendChart data={weightData} unit="kg" ariaLabel="Weight from the smart scale with its 7-day average" height={180}
            formatValue={v => v.toFixed(1)} onViewDay={onViewDay} yDomain={scaleChartDomain(weight.readings.map(r => r.value), MIN_SPAN.kg)}
            series={[
              readingLine('kg', 'weigh-in', c.series[1], weight.readings.length),
              { key: 'mean7', label: '7-day average', color: c.series[1], kind: 'line', dashed: true, connectNulls: true },
            ]} />
        )}

      <div className={`grid grid-cols-1 gap-4 ${pair ? '@2xl:grid-cols-2' : ''}`}>
        <ScaleMetricChart series={fat} field="fatPct" from={from} to={to} onViewDay={onViewDay}
          title="Body fat" unit="%" color={c.series[2]} ariaLabel="Body fat from the smart scale" />
        <ScaleMetricChart series={lean} field="leanKg" from={from} to={to} onViewDay={onViewDay}
          title="Lean mass" unit="kg" color={c.series[4]} ariaLabel="Lean mass from the smart scale"
          info="Everything that isn't fat — muscle, water, bone and organs — as the scale estimates it: your weight minus its fat estimate. It moves with hydration and food in the gut, so read it over weeks, not from one morning." />
      </div>
    </div>
  )
}

function ScaleMetricChart({ series, field, from, to, onViewDay, title, unit, color, ariaLabel, info }: {
  series: ReturnType<typeof currentDeviceSeries>
  field: Field
  from: string
  to: string
  onViewDay: (date: string) => void
  title: string
  unit: string
  color: string
  ariaLabel: string
  info?: string
}) {
  const { readings, since, dropped } = series
  if (!readings.length) return null
  const filled = fillDays(readings, from, to)
  const last = readings[readings.length - 1]
  const data: TrendPoint[] = filled.map(d => ({ label: fmtAxisDate(d.date), date: d.date, value: d.value }))
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="section-label flex items-center gap-1">
          {title}
          {info && <InfoBubble label={`About ${title.toLowerCase()}`}>{info}</InfoBubble>}
        </p>
        <p className="text-meta text-fg-muted">
          <span className="font-semibold tabular-nums text-fg">{last.value.toFixed(1)} {unit}</span> · {fmtDayMonth(last.date)}
        </p>
      </div>
      <HealthTrendChart data={data} unit={unit} ariaLabel={ariaLabel} height={140}
        formatValue={v => v.toFixed(1)} onViewDay={onViewDay} yDomain={scaleChartDomain(readings.map(r => r.value), MIN_SPAN[field])}
        series={[readingLine('value', title.toLowerCase(), color, readings.length)]} />
      {dropped > 0 && since && (
        <p className="flex items-center gap-1 text-micro text-fg-muted">
          Your current scale only, since {fmtDayMonth(since)}
          <InfoBubble label="Why earlier readings are left out">
            {dropped} earlier {dropped === 1 ? 'reading came' : 'readings came'} from a different scale. Scales estimate
            {' '}{title.toLowerCase()} with their own formulas, so readings from two scales don't line up — joining them would
            show a jump that never happened. Weight is the same on both, so the weight chart keeps every reading.
          </InfoBubble>
        </p>
      )}
    </div>
  )
}
