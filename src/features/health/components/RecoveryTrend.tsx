import { InfoBubble } from '../../../shared/components/InfoBubble'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { fillDays, personalBaseline, rollingMean } from '../healthWindowStats'
import { useHealthDaily } from '../hooks/useHealthExport'
import { HealthTrendChart } from './HealthTrendChart'
import { fmtAxisDay } from './healthFormat'

// A recovery marker (resting HR, HRV) as a daily trend against YOUR usual
// range: the mean ± 1 standard deviation of the last 60 days. Population
// norms fit Apple's short overnight readings poorly, so the reference is
// personal. HRV adds a 7-day rolling mean, which is what moves meaningfully —
// single nights are noisy. Always at least 30 days of context, even in Day
// mode, because one day of a recovery marker says nothing on its own.

interface Props {
  metric: string
  title: string
  unit: string
  color: string
  from: string
  to: string
  rolling?: boolean
  onViewDay?: (date: string) => void
}

export function RecoveryTrend({ metric, title, unit, color, from, to, rolling, onViewDay }: Props) {
  const histFrom = shiftDateStr(to, -59)
  const contextFrom = shiftDateStr(to, -29)
  const chartFrom = from < contextFrom ? from : contextFrom
  const { data = [], isLoading } = useHealthDaily(metric, histFrom, to)

  const baseline = personalBaseline(data, { from: histFrom, to, minPoints: 14 })
  const dense = fillDays(data, histFrom, to)
  const mean7 = rolling ? rollingMean(dense, 7, 3) : null
  const chart = dense
    .map((d, i) => ({ label: fmtAxisDay(d.date), date: d.date, value: d.value, mean7: mean7?.[i].value ?? null }))
    .filter(d => d.date >= chartFrom)
  const band = baseline?.sd != null
    ? { y1: baseline.mean - baseline.sd, y2: baseline.mean + baseline.sd, label: 'your usual range', color }
    : undefined
  const latest = [...data].reverse().find(d => d.date >= chartFrom)

  if (isLoading) return <div className="h-[140px] rounded-row skeleton" aria-hidden />
  if (!chart.some(d => d.value != null)) return null

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="section-label flex items-center gap-1">
          {title}
          <InfoBubble label={`About ${title}`}>
            The shaded band is your own usual range: the average of the last 60 days, ± one standard deviation
            {baseline ? ` (${baseline.n} days)` : ''}. A reading outside it is unusual for you, not necessarily a
            problem.{rolling ? ' The dashed line is the 7-day average, which is steadier than single nights.' : ''}
          </InfoBubble>
        </p>
        <p className="text-meta text-fg-muted">
          {latest && <><span className="font-semibold tabular-nums text-fg">{Math.round(latest.value)} {unit}</span> latest · </>}
          {baseline?.sd != null
            ? <>usual {Math.round(baseline.mean - baseline.sd)}–{Math.round(baseline.mean + baseline.sd)} {unit}</>
            : 'too few days for a usual range yet'}
        </p>
      </div>
      <HealthTrendChart
        data={chart}
        series={[
          { key: 'value', label: title, color, kind: 'line' },
          ...(rolling ? [{ key: 'mean7', label: '7-day average', color, kind: 'line' as const, dashed: true }] : []),
        ]}
        unit={unit}
        ariaLabel={`${title} per day with your usual range`}
        height={130}
        band={band}
        onViewDay={onViewDay}
      />
    </div>
  )
}
