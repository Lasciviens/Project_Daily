import { useMemo } from 'react'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { buildUsage, type Usage } from '../foodLibraryModel'
import { useFoodLogRange } from './useFoodLog'

/** How many days of eaten history the Library and Ingredients read. */
export const USAGE_DAYS = 90

/** Times eaten and the last day, per recipe and per library food, over the last 90 days. */
export function useFoodUsage(): { usage: Map<string, Usage>; isLoading: boolean } {
  const today = todayStr()
  const { data = [], isLoading } = useFoodLogRange(shiftDateStr(today, -(USAGE_DAYS - 1)), today)
  const usage = useMemo(() => buildUsage(data), [data])
  return { usage, isLoading }
}
