import { useMemo } from 'react'
import { useScheduleBlocks, useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { buildPlansByDate } from '../components/calendar/calendarPlans'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

/** Planned training sessions per day of [from, to]: one-off training blocks +
 *  recurring training templates projected onto each day (calendarPlans.ts).
 *  The calendar and the session popup read it, so both see the same plans. */
export function useTrainingPlansByDate(from: string, to: string): {
  data: Map<string, CalendarPlanItem[]>
  isLoading: boolean
  isError: boolean
} {
  const blocksQ = useTrainingBlocks(from, to)
  const templatesQ = useScheduleBlocks()
  const blocks = blocksQ.data
  const templates = templatesQ.data
  const data = useMemo(() => buildPlansByDate(from, to, blocks ?? [], templates ?? []), [from, to, blocks, templates])
  return { data, isLoading: blocksQ.isLoading || templatesQ.isLoading, isError: blocksQ.isError || templatesQ.isError }
}
