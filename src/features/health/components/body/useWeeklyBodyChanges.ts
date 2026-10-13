import { useMemo } from 'react'
import { localDayOf, shiftDateStr } from '../../../../shared/utils/dateUtils'
import { dailySeries } from '../../bodyCompositionAggregate'
import { currentDeviceSeries, scaleOnly } from '../../bodyweight'
import { usePhase } from '../../goal/useBodyGoals'
import { useBodyCompositionReports } from '../../hooks/useBodyCompositionReports'
import { useBodyweightSeries } from '../../hooks/useBodyweight'
import { buildWeeklyChanges, shownMetrics, sinceFirstReading, weekStartsFor, type WeeklySeries } from '../../weeklyBodyChanges'
import { LONG_BACK_DAYS, SPAN_DAYS } from '../dateNav'
import type { HealthRange } from '../sectionTypes'

const dayOf = (iso: string) => localDayOf(iso) ?? iso.slice(0, 10)

/** The Body window's weekly rows for the page's period, ending on its day:
 *  weight and body fat from the scale (the same read as the scale charts),
 *  muscle % and body score from the scale's photo reports, judged by the
 *  phase once it has loaded. */
export function useWeeklyBodyChanges({ anchor, period }: Pick<HealthRange, 'anchor' | 'period'>) {
  const weeks = useMemo(() => weekStartsFor(anchor, SPAN_DAYS[period]), [anchor, period])
  // The page's shared long read; a year reaches further back (its oldest
  // week and the week before it).
  const longFrom = shiftDateStr(anchor, -LONG_BACK_DAYS)
  const needFrom = shiftDateStr(weeks[weeks.length - 1], -7)
  const series = useBodyweightSeries(needFrom < longFrom ? needFrom : longFrom, anchor)
  const reports = useBodyCompositionReports()
  const { phase, isLoaded } = usePhase()
  const judgedPhase = isLoaded ? phase : null

  const points = series.data, reportRows = reports.data
  const { rows, first, dropped } = useMemo(() => {
    const scale = scaleOnly(points ?? [])
    const upToAnchor = (s: { date: string; value: number }[]) => s.filter(d => d.date <= anchor)
    const input: WeeklySeries = {
      weight: scale.flatMap(d => (d.kg != null ? [{ date: d.date, value: d.kg }] : [])),
      fat: currentDeviceSeries(scale, 'fatPct').readings,
      muscle: upToAnchor(dailySeries(reportRows ?? [], 'muscle_percent', dayOf)),
      score: upToAnchor(dailySeries(reportRows ?? [], 'body_score', dayOf)),
    }
    return sinceFirstReading(buildWeeklyChanges(input, weeks, anchor, judgedPhase), input)
  }, [points, reportRows, weeks, anchor, judgedPhase])

  return {
    rows,
    /** The first reading, when weeks before it were left out. */
    firstReading: dropped > 0 ? first : null,
    metrics: shownMetrics(rows),
    phase: judgedPhase,
    isLoading: series.isLoading,
    dimmed: series.isPlaceholderData,
  }
}
