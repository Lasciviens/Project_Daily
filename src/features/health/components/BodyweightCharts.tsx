import { useChartColors } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { BODYWEIGHT_SOURCE_LABEL, type BodyweightPoint, type BodyweightSource } from '../bodyweight'
import { daysBetweenIso, fillDays, linearTrendPerDay, rollingMean } from '../healthWindowStats'
import { HealthTrendChart, type TrendPoint } from './HealthTrendChart'
import { fmtDayMonth } from './healthFormat'

// ONE weight chart and ONE body-fat chart from the merged series (smart
// scale + Hevy + Apple Health, see bodyweight.ts). Readings are dots coloured
// by the source that won the day; the line is the 7-day average, which is the
// honest trend — single weigh-ins swing 1-2 kg with water and food.

const STALE_AFTER_DAYS = 3

function useSourceColors(): Record<BodyweightSource, string> {
  const c = useChartColors()
  return { scale: c.series[1], hevy: c.series[2], apple: c.series[0] }
}

interface Props {
  points: BodyweightPoint[]
  latest: BodyweightPoint | null | undefined
  from: string
  to: string
  onViewDay: (date: string) => void
}

export function BodyweightCharts({ points, latest, from, to, onViewDay }: Props) {
  const c = useChartColors()
  const colors = useSourceColors()
  const bySource = new Map(points.map(p => [p.date, p]))

  const weightDense = fillDays(points.map(p => ({ date: p.date, value: p.kg })), from, to)
  const weightMean = rollingMean(weightDense, 7, 2)
  const weightData: TrendPoint[] = weightDense.map((d, i) => ({
    label: fmtDayMonth(d.date), date: d.date, kg: d.value, mean7: weightMean[i].value, source: bySource.get(d.date)?.source,
  }))
  const fatPts = points.filter(p => p.fatPct != null)
  const fatDense = fillDays(fatPts.map(p => ({ date: p.date, value: p.fatPct as number })), from, to)
  const fatMean = rollingMean(fatDense, 7, 2)
  const fatData: TrendPoint[] = fatDense.map((d, i) => ({
    label: fmtDayMonth(d.date), date: d.date, fat: d.value, mean7: fatMean[i].value, source: bySource.get(d.date)?.fatSource ?? undefined,
  }))

  // Trend over the last four weeks of readings, in kg/week — never
  // first-vs-last raw readings, which a single water-heavy morning can flip.
  const recent = points.filter(p => daysBetweenIso(p.date, to) <= 27)
  const trend = recent.length >= 3 && daysBetweenIso(recent[0].date, recent[recent.length - 1].date) >= 7
    ? linearTrendPerDay(recent.map(p => ({ date: p.date, value: p.kg })))
    : null
  const stale = latest ? daysBetweenIso(latest.date, to) : null
  const dot = (p: TrendPoint) => colors[(p.source as BodyweightSource) ?? 'apple'] ?? c.series[0]
  const describe = (p: TrendPoint) => p.source
    ? <p className="text-fg-muted">{BODYWEIGHT_SOURCE_LABEL[p.source as BodyweightSource]}</p>
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="section-label flex items-center gap-1">
            Weight
            <InfoBubble label="Where weight comes from">
              One series from three sources. On a day with more than one, a weight typed into Hevy wins (a deliberate
              entry), then the smart scale, then Apple Health (often a copy of another device's reading).
            </InfoBubble>
          </p>
          <p className="text-kpi font-bold leading-tight tabular-nums text-fg">
            {latest ? latest.kg.toFixed(1) : '—'}{latest && <span className="text-body font-normal text-fg-muted"> kg</span>}
          </p>
          {latest && (
            <p className="text-meta text-fg-muted">
              {fmtDayMonth(latest.date)} · {BODYWEIGHT_SOURCE_LABEL[latest.source]}
              {stale != null && stale >= STALE_AFTER_DAYS && (
                <span data-tone="warn" className="tone-text font-medium"> · {stale} days before the day you're viewing</span>
              )}
            </p>
          )}
        </div>
        {trend && (
          <p className="text-meta text-fg-muted">
            Trend <span className="font-semibold tabular-nums text-fg">{trend.slopePerDay * 7 > 0 ? '+' : trend.slopePerDay * 7 < 0 ? '−' : '±'}{Math.abs(trend.slopePerDay * 7).toFixed(2)} kg/week</span> (last 4 weeks, {trend.n} weigh-ins)
          </p>
        )}
      </div>
      {points.length === 0
        ? <p className="py-6 text-center text-meta text-fg-muted">No weigh-ins in the last 90 days.</p>
        : (
          <HealthTrendChart data={weightData} unit="kg" ariaLabel="Weight per day with 7-day average" height={170}
            formatValue={v => v.toFixed(1)} onViewDay={onViewDay} describe={describe}
            series={[
              { key: 'kg', label: 'weigh-in', color: c.series[1], kind: 'line', dotsOnly: true, dotColor: dot },
              { key: 'mean7', label: '7-day average', color: c.series[1], kind: 'line', dashed: true, connectNulls: true },
            ]} />
        )}
      <SourceLegend colors={colors} used={new Set(points.map(p => p.source))} />

      {fatPts.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="section-label">Body fat</p>
          <HealthTrendChart data={fatData} unit="%" ariaLabel="Body fat per day with 7-day average" height={140}
            formatValue={v => v.toFixed(1)} onViewDay={onViewDay} describe={describe}
            series={[
              { key: 'fat', label: 'reading', color: c.series[2], kind: 'line', dotsOnly: true, dotColor: dot },
              { key: 'mean7', label: '7-day average', color: c.series[2], kind: 'line', dashed: true, connectNulls: true },
            ]} />
        </div>
      )}
    </div>
  )
}

function SourceLegend({ colors, used }: { colors: Record<BodyweightSource, string>; used: Set<BodyweightSource> }) {
  if (!used.size) return null
  return (
    <div className="-mt-2 flex flex-wrap gap-3 text-meta text-fg-muted">
      {(['scale', 'hevy', 'apple'] as const).filter(s => used.has(s)).map(s => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[s] }} />{BODYWEIGHT_SOURCE_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
