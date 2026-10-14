import { useMemo } from 'react'
import { localDayOf, shiftDateStr } from '../../../../shared/utils/dateUtils'
import { dailySeries } from '../../bodyCompositionAggregate'
import { currentDeviceSeries, scaleOnly } from '../../bodyweight'
import { usePhase } from '../../goal/useBodyGoals'
import { useBodyCompositionReports } from '../../hooks/useBodyCompositionReports'
import { useBodyweightSeries } from '../../hooks/useBodyweight'
import { buildWeeklyChanges, shownMetrics, sinceFirstReading, weekComment, weekStartsFor, type WeeklySeries } from '../../weeklyBodyChanges'
import { SPAN_DAYS, useRangeWindow } from '../dateNav'
import type { HealthRange } from '../sectionTypes'

const dayOf = (iso: string) => localDayOf(iso) ?? iso.slice(0, 10)

/** The Body window's weekly rows for the page's period, ending on its day:
 *  weight and body fat from the scale (the same read as the scale charts),
 *  muscle % and body score from the scale's photo reports, judged by the
 *  phase once it has loaded, each with its comment line. */
export function useWeeklyBodyChanges(range: Pick<HealthRange, 'anchor' | 'period'>) {
  const { anchor, period } = range
  const weeks = useMemo(() => weekStartsFor(anchor, SPAN_DAYS[period]), [anchor, period])
  // The page's shared read (the scale card and the hero use it too); it
  // already reaches past the oldest week and the week before it.
  const win = useRangeWindow(range)
  const needFrom = shiftDateStr(weeks[weeks.length - 1], -7)
  const series = useBodyweightSeries(needFrom < win.fetchFrom ? needFrom : win.fetchFrom, anchor)
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
  const comments = useMemo(() => rows.map(r => weekComment(r, judgedPhase)), [rows, judgedPhase])

  return {
    rows,
    /** The thin line under each row, in the same order. */
    comments,
    /** The first reading, when weeks before it were left out. */
    firstReading: dropped > 0 ? first : null,
    metrics: shownMetrics(rows),
    phase: judgedPhase,
    isLoading: series.isLoading,
    dimmed: series.isPlaceholderData,
  }
}
