import { differenceInCalendarDays } from 'date-fns'
import { useTasksForDay } from '../../todo/hooks/useTodos'
import type { TaskSection } from '../../todo/types'

function getSectionForDate(date: Date): TaskSection {
  const diff = differenceInCalendarDays(date, new Date())
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff > 1 && diff <= 7) return 'this_week'
  return 'backlog'
}

export function useDayData(date: Date) {
  const section = getSectionForDate(date)
  const query = useTasksForDay(date, section)
  return {
    tasks:     query.data ?? [],
    isLoading: query.isLoading,
    section,
  }
}
